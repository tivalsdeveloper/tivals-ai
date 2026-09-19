import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const OAUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-oauth`;
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
  const [{data:sub},{data:usage},{data:settings},connections] = await Promise.all([
    sb.from("telegram_subscriptions").select("plan,status,stars_amount,is_recurring,subscription_expiration_date").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle(),
    sb.from("telegram_user_settings").select("response_style,notifications,tool_suggestions").eq("telegram_user_id",tg).maybeSingle(),
    oauth("status",tg)
  ]);
  const active = Boolean(sub && sub.status==="active" && new Date(sub.subscription_expiration_date).getTime() > Date.now());
  const plan = active && (sub.plan==="basic" || sub.plan==="pro") ? sub.plan : "free";
  const list = Array.isArray(connections?.connections) ? connections.connections : [];
  return {
    plan:{ id:plan, ...plans[plan], active, expiration:active ? sub.subscription_expiration_date : null },
    usage:{ ai:Number(usage?.ai_messages||0), images:Number(usage?.image_generations||0) },
    settings: settings || {response_style:"balanced",notifications:true,tool_suggestions:true},
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
