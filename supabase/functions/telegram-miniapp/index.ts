import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const OAUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-oauth`;
const OWNED_BOT_WEBHOOK = `${SUPABASE_URL}/functions/v1/tivals-user-telegram`;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

const cors = {
  "Access-Control-Allow-Origin":"https://ai.tivalsdeveloper.site",
  "Access-Control-Allow-Headers":"content-type, authorization",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Content-Type":"application/json; charset=utf-8"
};

function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function hmac(key: Uint8Array | ArrayBuffer, data: string) {
  const k = await crypto.subtle.importKey("raw", key, {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}
const enc = new TextEncoder();

function b64(bytes: Uint8Array) {
  let out="";
  for (let i=0;i<bytes.length;i+=0x8000) out += String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return btoa(out);
}
async function aesKey() {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(SERVICE_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt","decrypt"]);
}
async function encrypt(value:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await aesKey(),enc.encode(value)));
  const out=new Uint8Array(iv.length+cipher.length); out.set(iv); out.set(cipher,iv.length);
  return b64(out);
}
function randomSecret() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function isAdmin(tg:number) {
  const {data}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();
  return Boolean(data);
}
async function paidAccess(tg:number) {
  if (await isAdmin(tg)) return {allowed:true,owner:true,plan:"owner"};
  const {data}=await sb.from("telegram_subscriptions")
    .select("plan,status,subscription_expiration_date")
    .eq("telegram_user_id",tg).maybeSingle();
  const active=Boolean(data && data.status==="active" && new Date(data.subscription_expiration_date).getTime()>Date.now() && ["basic","pro"].includes(data.plan));
  return {allowed:active,owner:false,plan:active?data.plan:"free"};
}
async function ownedBot(tg:number) {
  const {data,error}=await sb.from("telegram_owned_bots")
    .select("bot_id,username,account_label,is_active,connected_at,updated_at")
    .eq("telegram_user_id",tg).maybeSingle();
  if(error) throw error;
  return data;
}
async function botApi(token:string, method:string, payload?:Record<string,unknown>) {
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`, payload ? {
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
  } : undefined);
  const d=await r.json().catch(()=>({}));
  if(!r.ok || d?.ok===false) throw new Error(d?.description || `Telegram ${method} failed.`);
  return d?.result;
}
async function connectOwnedBot(tg:number,rawToken:string) {
  const access=await paidAccess(tg);
  if(!access.allowed) throw new Error("A paid Basic or Pro subscription is required to connect your own Telegram bot.");
  const token=String(rawToken||"").trim();
  if(!/^\d{5,}:[A-Za-z0-9_-]{25,}$/.test(token)) throw new Error("Enter a valid BotFather token.");
  const me=await botApi(token,"getMe");
  if(!me?.is_bot) throw new Error("This token does not belong to a Telegram bot.");
  const secret=randomSecret();
  await botApi(token,"setWebhook",{
    url:`${OWNED_BOT_WEBHOOK}?tg_owner=${encodeURIComponent(String(tg))}`,
    secret_token:secret,
    allowed_updates:["message"],
    drop_pending_updates:false
  });
  const {error}=await sb.from("telegram_owned_bots").upsert({
    telegram_user_id:tg,
    bot_id:Number(me.id),
    username:me.username||null,
    account_label:me.username?`@${me.username}`:String(me.first_name||"Telegram bot"),
    token_enc:await encrypt(token),
    webhook_secret_enc:await encrypt(secret),
    is_active:true,
    updated_at:new Date().toISOString()
  },{onConflict:"telegram_user_id"});
  if(error) throw error;
  return {connected:true,account_label:me.username?`@${me.username}`:String(me.first_name||"Telegram bot")};
}
async function validateInitData(initData: string) {
  if (!BOT_TOKEN || !initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash") || "";
  if (!hash) return null;
  p.delete("hash");
  const entries = [...p.entries()].sort(([a],[b])=>a.localeCompare(b));
  const dataCheck = entries.map(([k,v])=>`${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const expected = hex(await hmac(secret, dataCheck));
  if (expected !== hash) return null;

  const authDate = Number(p.get("auth_date") || 0);
  if (!authDate || Date.now()/1000 - authDate > 86400) return null;

  try {
    const user = JSON.parse(p.get("user") || "{}");
    if (!user?.id) return null;
    return user;
  } catch { return null; }
}
async function oauth(action:string, tg:number, provider="", extra:Record<string,unknown>={}) {
  const r = await fetch(OAUTH_URL, {
    method:"POST",
    headers:{ "content-type":"application/json", authorization:`Bearer ${SERVICE_KEY}` },
    body:JSON.stringify({ action, telegram_user_id:tg, provider, ...extra })
  });
  const d = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(d?.error || "Connector request failed.");
  return d;
}
async function telegram(method:string, payload:Record<string,unknown>) {
  if (!BOT_TOKEN) throw new Error("Telegram bot token is unavailable.");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload)
  });
  const d = await r.json().catch(()=>({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.description || "Telegram request failed.");
  return d?.result;
}
const plans = {
  free:{label:"Free",stars:0,ai:20,images:1},
  basic:{label:"Basic",stars:100,ai:200,images:10},
  pro:{label:"Pro",stars:250,ai:1000,images:50}
} as const;

async function getDashboard(tg:number) {
  const today = new Date().toISOString().slice(0,10);
  const [{data:sub},{data:usage},{data:settings},connections,admin,bot] = await Promise.all([
    sb.from("telegram_subscriptions").select("plan,status,stars_amount,is_recurring,subscription_expiration_date").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle(),
    sb.from("telegram_user_settings").select("response_style,notifications,tool_suggestions").eq("telegram_user_id",tg).maybeSingle(),
    oauth("status",tg),
    isAdmin(tg),
    ownedBot(tg)
  ]);
  const active = Boolean(sub && sub.status==="active" && new Date(sub.subscription_expiration_date).getTime() > Date.now());
  const plan = admin ? "owner" : active && (sub.plan==="basic" || sub.plan==="pro") ? sub.plan : "free";
  const list = Array.isArray(connections?.connections) ? connections.connections : [];
  const planData = admin
    ? {id:"owner",label:"Owner",stars:0,ai:null,images:null,active:true,expiration:null}
    : { id:plan, ...plans[plan as "free"|"basic"|"pro"], active, expiration:active ? sub.subscription_expiration_date : null };
  return {
    owner:admin,
    plan:planData,
    usage:{ ai:Number(usage?.ai_messages||0), images:Number(usage?.image_generations||0) },
    settings: settings || {response_style:"balanced",notifications:true,tool_suggestions:true},
    bot_connector:{ connected:Boolean(bot?.is_active), account_label:bot?.account_label||"", username:bot?.username||"", allowed:admin||active },
    connectors:["gmail","github","tiktok","website"].map(provider=>{
      const hit=list.find((x:any)=>x?.provider===provider);
      return { provider, connected:Boolean(hit), account_label:hit?.account_label || "" };
    })
  };
}

Deno.serve(async req => {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if (req.method==="GET") return json({ok:true,service:"telegram-miniapp"});
  if (req.method!=="POST") return json({error:"Method not allowed"},405);

  let body:any={};
  try { body=await req.json(); } catch { return json({error:"Invalid JSON"},400); }
  const user = await validateInitData(String(body?.init_data || ""));
  if (!user) return json({error:"Open this dashboard from the Tivals AI Telegram bot."},401);
  const tg = Number(user.id);
  const action = String(body?.action || "dashboard");

  try {
    if (action==="dashboard") return json({ok:true,user,dashboard:await getDashboard(tg)});

    if (action==="connector_link") {
      const provider=String(body?.provider||"");
      if (!["gmail","github","tiktok","website"].includes(provider)) return json({error:"Unknown connector"},400);
      const d = provider==="website" ? await oauth("create_website_link",tg) : await oauth("create_link",tg,provider);
      return json({ok:true,url:d?.url||""});
    }

    if (action==="connect_own_bot") {
      const d=await connectOwnedBot(tg,String(body?.bot_token||""));
      return json({ok:true,...d});
    }

    if (action==="own_bot_status") {
      const access=await paidAccess(tg);
      return json({ok:true,access,bot:await ownedBot(tg)});
    }

    if (action==="disconnect_own_bot") {
      const {data}=await sb.from("telegram_owned_bots").select("token_enc").eq("telegram_user_id",tg).maybeSingle();
      if(data?.token_enc){
        try{
          const raw=atob(String(data.token_enc)); const bytes=new Uint8Array(raw.length);
          for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
          const iv=bytes.slice(0,12),cipher=bytes.slice(12);
          const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},await aesKey(),cipher);
          await botApi(new TextDecoder().decode(plain),"deleteWebhook",{drop_pending_updates:false});
        }catch{}
      }
      const {error}=await sb.from("telegram_owned_bots").delete().eq("telegram_user_id",tg);
      if(error) throw error;
      return json({ok:true});
    }

    if (action==="save_settings") {
      const style = ["concise","balanced","detailed"].includes(String(body?.response_style)) ? String(body.response_style) : "balanced";
      const row = {
        telegram_user_id:tg,
        response_style:style,
        notifications:Boolean(body?.notifications),
        tool_suggestions:Boolean(body?.tool_suggestions),
        updated_at:new Date().toISOString()
      };
      const {error}=await sb.from("telegram_user_settings").upsert(row,{onConflict:"telegram_user_id"});
      if (error) throw error;
      return json({ok:true,settings:row});
    }

    if (action==="subscribe") {
      if (await isAdmin(tg)) return json({ok:false,owner:true,error:"Owner accounts do not need to pay for Tivals AI."},400);
      const plan=String(body?.plan||"");
      if (plan!=="basic" && plan!=="pro") return json({error:"Choose Basic or Pro."},400);
      const cfg=plans[plan];
      const url=await telegram("createInvoiceLink",{
        title:`Tivals AI ${cfg.label}`,
        description:`${cfg.label} plan for Tivals AI — renews every 30 days until cancelled.`,
        payload:`tivals-sub:${plan}`,
        currency:"XTR",
        prices:[{label:`${cfg.label} monthly subscription`,amount:cfg.stars}],
        subscription_period:2592000
      });
      return json({ok:true,url});
    }

    return json({error:"Unknown action"},400);
  } catch(e) {
    return json({error:String((e as Error)?.message || e)},400);
  }
});
