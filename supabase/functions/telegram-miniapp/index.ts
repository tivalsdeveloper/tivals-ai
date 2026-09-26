import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const OAUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-oauth`;
const OWNED_BOT_WEBHOOK = `${SUPABASE_URL}/functions/v1/tivals-user-telegram`;
const TIVALS_AI_URL = `${SUPABASE_URL}/functions/v1/tivals-ai-chat`;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const AIMLAPI_BASE = "https://api.aimlapi.com/v1";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });
const voiceBuckets = new Map<number,{count:number;resetAt:number}>();
const BOT_PROFILE_COLUMNS = "bot_id,username,account_label,is_active,connected_at,updated_at,bot_name,bot_purpose,personality,custom_instructions,subjects,education_level,teaching_style,language,welcome_message,voice_mode,group_mode,channel_mode,owner_only_invites,timezone";

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
function fromB64(value:string) {
  const raw=atob(value);const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
function takeVoiceRate(tg:number) {
  const now=Date.now(),bucket=voiceBuckets.get(tg);
  if(!bucket||bucket.resetAt<=now){voiceBuckets.set(tg,{count:1,resetAt:now+60_000});return true;}
  if(bucket.count>=6)return false;
  bucket.count+=1;return true;
}
function voiceFormat(value:string) {
  const v=String(value||"").toLowerCase();
  if(["webm","mp3","m4a","aac","wav","ogg","flac"].includes(v))return v;
  return "webm";
}
async function transcribeVoice(bytes:Uint8Array,format:string) {
  const key=Deno.env.get("OPENROUTER_API_KEY")||"";
  if(key)try{const r=await fetch(`${OPENROUTER_BASE}/audio/transcriptions`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://ai.tivalsdeveloper.site/","X-OpenRouter-Title":"Tivals AI"},body:JSON.stringify({model:"openai/whisper-large-v3",input_audio:{data:b64(bytes),format:voiceFormat(format)},response_format:"json",temperature:0})});const d=await r.json().catch(()=>({}));const text=String(d?.text||"").trim();if(r.ok&&text)return text.slice(0,4000)}catch{}
  const backup=Deno.env.get("AIMLAPI_API_KEY")||"";if(!backup)throw new Error("Voice recognition is temporarily unavailable. Please try again later.");
  try{
    const kind=voiceFormat(format),mime=kind==="mp3"?"audio/mpeg":kind==="m4a"?"audio/mp4":`audio/${kind}`;
    const form=new FormData();form.append("model","#g1_whisper-small");form.append("audio",new Blob([bytes],{type:mime}),`voice.${kind}`);
    const created=await fetch(`${AIMLAPI_BASE}/stt/create`,{method:"POST",headers:{Authorization:`Bearer ${backup}`},body:form});const c=await created.json().catch(()=>({}));if(!created.ok||!c?.generation_id)throw new Error("create_failed");
    for(let i=0;i<24;i++){await new Promise(resolve=>setTimeout(resolve,2000));const r=await fetch(`${AIMLAPI_BASE}/stt/${encodeURIComponent(String(c.generation_id))}`,{headers:{Authorization:`Bearer ${backup}`}});const d=await r.json().catch(()=>({}));const text=String(d?.output?.text||d?.result?.text||d?.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript||d?.output?.results?.channels?.[0]?.alternatives?.[0]?.transcript||"").trim();if(r.ok&&text)return text.slice(0,4000);if(["error","failed","cancelled"].includes(String(d?.status||"").toLowerCase()))break;}
  }catch{}
  throw new Error("Voice recognition is temporarily unavailable. Please try again later.");
}
async function synthesizeVoice(text:string) {
  const key=Deno.env.get("OPENROUTER_API_KEY")||"";
  if(key)try{const r=await fetch(`${OPENROUTER_BASE}/audio/speech`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://ai.tivalsdeveloper.site/","X-OpenRouter-Title":"Tivals AI"},body:JSON.stringify({model:"mistralai/voxtral-mini-tts-2603",input:String(text||"").slice(0,3500),voice:"en_paul_neutral",response_format:"mp3",speed:1})});if(r.ok){const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length)return bytes}}catch{}
  const backup=Deno.env.get("AIMLAPI_API_KEY")||"";if(!backup)throw new Error("Voice replies are temporarily unavailable.");const r=await fetch(`${AIMLAPI_BASE}/tts`,{method:"POST",headers:{Authorization:`Bearer ${backup}`,"Content-Type":"application/json"},body:JSON.stringify({model:"openai/tts-1",text:String(text||"").slice(0,3500),voice:"alloy",response_format:"mp3",speed:1})});const d=await r.json().catch(()=>({}));const url=String(d?.audio?.url||d?.url||"");if(!r.ok||!url)throw new Error("Voice replies are temporarily unavailable.");const audio=await fetch(url);if(!audio.ok)throw new Error("Voice replies are temporarily unavailable.");return new Uint8Array(await audio.arrayBuffer());
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
async function decrypt(value:string) {
  const raw=atob(String(value||"")); const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  const iv=bytes.slice(0,12),cipher=bytes.slice(12);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},await aesKey(),cipher);
  return new TextDecoder().decode(plain);
}
function randomSecret() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function isAdmin(tg:number) {
  const {data}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();
  return Boolean(data);
}
async function consumeAiUsage(tg:number) {
  if(await isAdmin(tg))return;
  const access=await paidAccess(tg),limit=access.plan==="pro"?1000:access.plan==="basic"?200:20;
  const today=new Date().toISOString().slice(0,10);
  const {data,error}=await sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle();
  if(error)throw error;
  const used=Number(data?.ai_messages||0);if(used>=limit)throw new Error("Your daily AI message limit has been reached.");
  const {error:upsertError}=await sb.from("telegram_daily_usage").upsert({telegram_user_id:tg,usage_date:today,ai_messages:used+1,image_generations:Number(data?.image_generations||0),updated_at:new Date().toISOString()},{onConflict:"telegram_user_id,usage_date"});
  if(upsertError)throw upsertError;
}

async function voiceBusinessProfile(tg:number) {
  const [{data:profile},{data:catalog},{data:specialists},{data:faqs}]=await Promise.all([
    sb.from("telegram_business_profiles").select("business_name,assistant_name,business_details,email,phone,address,website_url,payment_options,business_hours,booking_reminders,booking_confirmations,booking_instructions").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_business_catalog").select("item_type,name,price,currency,details,available").eq("telegram_user_id",tg).eq("available",true).order("sort_order"),
    sb.from("telegram_business_specialists").select("first_name,last_name,about,services").eq("telegram_user_id",tg).eq("active",true).order("sort_order"),
    sb.from("telegram_business_faqs").select("question,answer").eq("telegram_user_id",tg).order("sort_order")
  ]);
  return profile?{...profile,catalog:catalog||[],specialists:specialists||[],faqs:faqs||[]}:null;
}

async function voiceAiReply(tg:number,transcript:string,history:any[]) {
  const safeHistory=(Array.isArray(history)?history:[]).slice(-6).map((m:any)=>({role:m?.role==="assistant"?"assistant":"user",content:String(m?.content||"").slice(0,1500)})).filter((m:any)=>m.content);
  const r=await fetch(TIVALS_AI_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${SERVICE_KEY}`},body:JSON.stringify({model:"tivals-ai",business_profile:await voiceBusinessProfile(tg),messages:[...safeHistory,{role:"user",content:transcript+"\n\nReply naturally for a spoken conversation. Be clear and concise."}]})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d?.reply)throw new Error(d?.error||"Tivals AI could not answer.");
  return String(d.reply).slice(0,3500);
}
async function paidAccess(tg:number) {
  if (await isAdmin(tg)) return {allowed:true,owner:true,plan:"owner"};
  const {data}=await sb.from("telegram_subscriptions")
    .select("plan,status,subscription_expiration_date")
    .eq("telegram_user_id",tg).maybeSingle();
  const active=Boolean(data && data.status==="active" && new Date(data.subscription_expiration_date).getTime()>Date.now() && ["basic","pro"].includes(data.plan));
  return {allowed:true,owner:false,plan:active?data.plan:"free"};
}
async function personalBotAccess(tg:number) {
  if(await isAdmin(tg))return{allowed:true,owner:true,plan:"owner",trial:false,trial_expires_at:null};
  const {data:sub}=await sb.from("telegram_subscriptions").select("plan,status,subscription_expiration_date").eq("telegram_user_id",tg).maybeSingle();
  const subscribed=Boolean(sub&&sub.status==="active"&&["basic","pro"].includes(sub.plan)&&new Date(sub.subscription_expiration_date).getTime()>Date.now());
  if(subscribed)return{allowed:true,owner:false,plan:String(sub.plan),trial:false,trial_expires_at:null};
  let {data:trial,error}=await sb.from("telegram_personal_bot_trials").select("started_at,expires_at").eq("telegram_user_id",tg).maybeSingle();
  if(error)throw error;
  if(!trial){const made=await sb.from("telegram_personal_bot_trials").insert({telegram_user_id:tg}).select("started_at,expires_at").single();if(made.error)throw made.error;trial=made.data;}
  const allowed=new Date(trial.expires_at).getTime()>Date.now();return{allowed,owner:false,plan:allowed?"trial":"expired",trial:true,trial_expires_at:trial.expires_at};
}
async function ownedBot(tg:number) {
  const {data,error}=await sb.from("telegram_owned_bots")
    .select(BOT_PROFILE_COLUMNS)
    .eq("telegram_user_id",tg).maybeSingle();
  if(error) throw error;
  return data;
}
async function syncOwnedBotSetup(tg:number) {
  const {data}=await sb.from("telegram_owned_bots")
    .select("token_enc,webhook_secret_enc,is_active")
    .eq("telegram_user_id",tg).maybeSingle();
  if(!data?.is_active||!data?.token_enc||!data?.webhook_secret_enc) return;
  const [token,secret]=await Promise.all([decrypt(String(data.token_enc)),decrypt(String(data.webhook_secret_enc))]);
  await botApi(token,"setWebhook",{
    url:OWNED_BOT_WEBHOOK+"?tg_owner="+encodeURIComponent(String(tg)),
    secret_token:secret,
    allowed_updates:["message","business_message","business_connection","callback_query","my_chat_member","channel_post"],
    drop_pending_updates:false
  });
  await botApi(token,"setChatMenuButton",{
    menu_button:{type:"web_app",text:"My Bot",web_app:{url:"https://ai.tivalsdeveloper.site/telegram-personal-bot.html?v=20260926-2"}}
  }).catch(()=>null);
}

function botCommands(purpose:string) {
  const base=[
    {command:"start",description:"Start a conversation"},
    {command:"newchat",description:"Start a fresh private chat"},
    {command:"chats",description:"Continue a previous private chat"},
    {command:"remind",description:"Create a personal reminder"},
    {command:"reminders",description:"View upcoming reminders"},
    {command:"ask",description:"Ask the bot in a group or channel"},
    {command:"app",description:"Open the owner dashboard"},
    {command:"grouphelp",description:"How to use this bot in groups"},
    {command:"connect",description:"Owner: connect tools"},
    {command:"accounts",description:"Owner: view connected tools"}
  ];
  if(["education","coding","math"].includes(purpose))base.push(
    {command:"lesson",description:"Start a lesson on a topic"},
    {command:"explain",description:"Explain a concept clearly"},
    {command:"quiz",description:"Create a short quiz"},
    {command:"practice",description:"Give practice questions"}
  );
  return base;
}

function validTimezone(value:string) {
  try{new Intl.DateTimeFormat("en",{timeZone:value}).format(new Date());return true;}catch{return false;}
}

async function syncBotPresentation(token:string,profile:any) {
  const name=String(profile?.bot_name||"My AI").trim().slice(0,64)||"My AI";
  const purpose=String(profile?.bot_purpose||"general");
  const subjects=Array.isArray(profile?.subjects)?profile.subjects.slice(0,8).join(", "):"";
  const description=String(profile?.custom_instructions||profile?.personality||"").trim().slice(0,430);
  const short=purpose==="coding"?"A personal programming tutor":purpose==="math"?"A personal mathematics tutor":purpose==="education"?`A personal tutor${subjects?` for ${subjects}`:""}`:"A personal AI assistant";
  await Promise.all([
    botApi(token,"setMyName",{name}),
    botApi(token,"setMyShortDescription",{short_description:short.slice(0,120)}),
    botApi(token,"setMyDescription",{description:(description||`${name} is a helpful, natural AI assistant.`).slice(0,512)}),
    botApi(token,"setMyCommands",{commands:botCommands(purpose)})
  ]);
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
  const access=await personalBotAccess(tg);if(!access.allowed)throw new Error("Your personal bot free trial has ended. Choose Basic or Pro to reconnect or continue using it.");
  const token=String(rawToken||"").trim();
  if(!/^\d{5,}:[A-Za-z0-9_-]{25,}$/.test(token)) throw new Error("Enter a valid BotFather token.");
  const me=await botApi(token,"getMe");
  if(!me?.is_bot) throw new Error("This token does not belong to a Telegram bot.");

  const botId=Number(me.id);
  const {data:claimed,error:claimLookupError}=await sb.from("telegram_owned_bots")
    .select("telegram_user_id")
    .eq("bot_id",botId)
    .maybeSingle();
  if(claimLookupError) throw claimLookupError;
  if(claimed && Number(claimed.telegram_user_id)!==tg) {
    throw new Error("This Telegram bot is already connected to another Tivals AI account.");
  }

  const secret=randomSecret();
  const {error}=await sb.from("telegram_owned_bots").upsert({
    telegram_user_id:tg,
    bot_id:botId,
    username:me.username||null,
    account_label:me.username?`@${me.username}`:String(me.first_name||"Telegram bot"),
    bot_name:String(me.first_name||"My AI").slice(0,64),
    token_enc:await encrypt(token),
    webhook_secret_enc:await encrypt(secret),
    is_active:true,
    updated_at:new Date().toISOString()
  },{onConflict:"telegram_user_id"});
  if(error) {
    if(String(error.code||"")==="23505") {
      throw new Error("This Telegram bot is already connected to another Tivals AI account.");
    }
    throw error;
  }

  try {
    await botApi(token,"setWebhook",{
      url:OWNED_BOT_WEBHOOK+"?tg_owner="+encodeURIComponent(String(tg)),
      secret_token:secret,
      allowed_updates:["message","business_message","business_connection","callback_query","my_chat_member","channel_post"],
      drop_pending_updates:false
    });
    await botApi(token,"setChatMenuButton",{
      menu_button:{type:"web_app",text:"My Bot",web_app:{url:"https://ai.tivalsdeveloper.site/telegram-personal-bot.html?v=20260926-2"}}
    }).catch(()=>null);
    await syncBotPresentation(token,{bot_name:String(me.first_name||"My AI"),bot_purpose:"general"}).catch(()=>null);
  } catch(e) {
    await sb.from("telegram_owned_bots")
      .update({is_active:false,updated_at:new Date().toISOString()})
      .eq("telegram_user_id",tg)
      .eq("bot_id",botId);
    throw e;
  }

  return {connected:true,account_label:me.username?`@${me.username}`:String(me.first_name||"Telegram bot")};
}
async function verifyInitData(initData:string,token:string) {
  if(!token||!initData) return null;
  const p=new URLSearchParams(initData);
  const hash=p.get("hash")||"";
  if(!hash) return null;
  p.delete("hash");
  const dataCheck=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
  const secret=await hmac(new TextEncoder().encode("WebAppData"),token);
  if(hex(await hmac(secret,dataCheck))!==hash) return null;
  const authDate=Number(p.get("auth_date")||0);
  const age=Math.floor(Date.now()/1000)-authDate;
  if(!authDate||age<0||age>900) return null;
  try{const user=JSON.parse(p.get("user")||"{}");return user?.id?user:null}catch{return null}
}
async function validateInitData(initData:string) {
  const mainUser=await verifyInitData(initData,BOT_TOKEN);
  if(mainUser) return mainUser;
  let candidate:any=null;
  try{candidate=JSON.parse(new URLSearchParams(initData).get("user")||"{}")}catch{}
  const tg=Number(candidate?.id||0);
  if(!tg) return null;
  const {data}=await sb.from("telegram_owned_bots").select("token_enc,is_active").eq("telegram_user_id",tg).maybeSingle();
  if(!data?.is_active||!data?.token_enc) return null;
  try{return await verifyInitData(initData,await decrypt(String(data.token_enc)))}catch{return null}
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
  await syncOwnedBotSetup(tg).catch(()=>{});
  const today = new Date().toISOString().slice(0,10);
  const [{data:sub},{data:usage},{data:settings},{data:businessProfile},{data:catalog},{data:specialists},{data:faqs},connections,admin,bot,{data:websiteWidget}] = await Promise.all([
    sb.from("telegram_subscriptions").select("plan,status,stars_amount,is_recurring,subscription_expiration_date").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle(),
    sb.from("telegram_user_settings").select("response_style,notifications,tool_suggestions").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_business_profiles").select("business_name,assistant_name,business_details,email,phone,address,website_url,payment_options,business_hours,booking_reminders,booking_confirmations,booking_instructions,updated_at").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_business_catalog").select("id,item_type,name,price,currency,details,available,sort_order").eq("telegram_user_id",tg).order("sort_order").order("created_at"),
    sb.from("telegram_business_specialists").select("id,first_name,last_name,about,services,active,sort_order").eq("telegram_user_id",tg).order("sort_order").order("created_at"),
    sb.from("telegram_business_faqs").select("id,question,answer,sort_order").eq("telegram_user_id",tg).order("sort_order").order("created_at"),
    oauth("status",tg).catch(()=>({connections:[]})),
    isAdmin(tg),
    ownedBot(tg),
    sb.from("telegram_website_widgets").select("public_key,allowed_domains,welcome_message,position,is_active,request_count,last_used_at,updated_at").eq("telegram_user_id",tg).maybeSingle()
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
    business_profile: businessProfile || {
      business_name:"",assistant_name:"Tivals AI",business_details:"",email:"",phone:"",address:"",
      website_url:"",payment_options:"",business_hours:{},booking_reminders:false,
      booking_confirmations:false,booking_instructions:"",updated_at:null
    },
    business_knowledge:{catalog:catalog||[],specialists:specialists||[],faqs:faqs||[]},
    website_widget:websiteWidget || null,
    bot_connector:{
      connected:Boolean(bot?.is_active),account_label:bot?.account_label||"",username:bot?.username||"",allowed:true,
      bot_name:bot?.bot_name||"My AI",bot_purpose:bot?.bot_purpose||"general",
      personality:bot?.personality||"Friendly, natural and helpful",custom_instructions:bot?.custom_instructions||"",
      subjects:Array.isArray(bot?.subjects)?bot.subjects:[],education_level:bot?.education_level||"all",
      teaching_style:bot?.teaching_style||"adaptive",language:bot?.language||"auto",
      welcome_message:bot?.welcome_message||"Hi! How can I help you today?",voice_mode:bot?.voice_mode||"voice_messages",
      group_mode:bot?.group_mode||"mentions",channel_mode:bot?.channel_mode||"commands",
      owner_only_invites:bot?.owner_only_invites!==false
    },
    connectors:["gmail","github","tiktok","website"].map(provider=>{
      const hit=list.find((x:any)=>x?.provider===provider);
      return { provider, connected:Boolean(hit), account_label:hit?.account_label || "" };
    })
  };
}

async function getPersonalBotDashboard(tg:number) {
  const today=new Date().toISOString().slice(0,10);
  const [{data:usage},{data:bot},access,accountData,{data:monitor}]=await Promise.all([
    sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle(),
    ownedBot(tg),
    personalBotAccess(tg),
    oauth("status",tg).catch(()=>({connections:[]})),
    sb.from("telegram_gmail_monitor_settings").select("enabled,interval_minutes,auto_draft_replies,last_checked_at,last_success_at,last_error").eq("telegram_user_id",tg).maybeSingle()
  ]);
  const connections=Array.isArray(accountData?.connections)?accountData.connections:[];
  const planId=access.owner?"owner":access.plan;
  const planData=access.owner?{id:"owner",label:"Owner",ai:null,images:null,active:true,trial:false,expiration:null}:{id:planId,label:planId==="pro"?"Pro":planId==="basic"?"Basic":planId==="trial"?"7-day trial":"Trial ended",ai:planId==="pro"?1000:planId==="basic"?200:20,images:planId==="pro"?50:planId==="basic"?10:1,active:access.allowed,trial:Boolean(access.trial),expiration:access.trial_expires_at};
  return {
    plan:planData,
    usage:{ai:Number(usage?.ai_messages||0),images:Number(usage?.image_generations||0)},
    connectors:["gmail","github"].map(provider=>{const hit=connections.find((x:any)=>x?.provider===provider);return{provider,connected:Boolean(hit&&!hit.needs_reconnect),account_label:hit?.account_label||"",persistent_until:hit?.persistent_until||null,needs_reconnect:Boolean(hit?.needs_reconnect)};}),
    gmail_monitor:{enabled:Boolean(monitor?.enabled),interval_minutes:Number(monitor?.interval_minutes||60),auto_draft_replies:monitor?.auto_draft_replies!==false,last_checked_at:monitor?.last_checked_at||null,last_success_at:monitor?.last_success_at||null,last_error:monitor?.last_error||""},
    bot_connector:{
      connected:Boolean(bot?.is_active),account_label:bot?.account_label||"",username:bot?.username||"",
      bot_name:bot?.bot_name||"My AI",bot_purpose:bot?.bot_purpose||"general",
      personality:bot?.personality||"Friendly, natural and helpful",custom_instructions:bot?.custom_instructions||"",
      subjects:Array.isArray(bot?.subjects)?bot.subjects:[],education_level:bot?.education_level||"all",
      teaching_style:bot?.teaching_style||"adaptive",language:bot?.language||"auto",
      welcome_message:bot?.welcome_message||"Hi! How can I help you today?",voice_mode:bot?.voice_mode||"voice_messages",
      group_mode:bot?.group_mode||"mentions",channel_mode:bot?.channel_mode||"commands",owner_only_invites:bot?.owner_only_invites!==false,
      timezone:bot?.timezone||"Africa/Johannesburg"
    }
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
    if(action==="voice_chat") {
      if(!takeVoiceRate(tg))return json({error:"Please wait a moment before speaking again."},429);
      const encoded=String(body?.audio_base64||"");
      if(!encoded||encoded.length>8_000_000)return json({error:"The recording is missing or too large. Keep each turn under 45 seconds."},400);
      let audio:Uint8Array;
      try{audio=fromB64(encoded);}catch{return json({error:"The recording could not be read."},400);}
      if(!audio.length||audio.length>6_000_000)return json({error:"Keep each voice turn under 45 seconds."},400);
      await consumeAiUsage(tg);
      const transcript=await transcribeVoice(audio,String(body?.audio_format||"webm"));
      const reply=await voiceAiReply(tg,transcript,body?.history);
      const spoken=await synthesizeVoice(reply);
      return json({ok:true,transcript,reply,audio_base64:b64(spoken),audio_mime:"audio/mpeg"});
    }

    if (action==="dashboard") return json({ok:true,user,dashboard:await getDashboard(tg)});
    if (action==="personal_bot_dashboard") return json({ok:true,user,dashboard:await getPersonalBotDashboard(tg)});

    if(action==="disconnect_personal_connector") {
      const provider=String(body?.provider||"");
      if(!["gmail","github"].includes(provider))return json({error:"Unknown connector"},400);
      await oauth("disconnect",tg,provider);
      if(provider==="gmail")await sb.from("telegram_gmail_monitor_settings").update({enabled:false,last_error:"Gmail disconnected.",updated_at:new Date().toISOString()}).eq("telegram_user_id",tg);
      return json({ok:true,provider});
    }

    if(action==="save_gmail_monitoring") {
      const access=await personalBotAccess(tg);if(!access.allowed)return json({error:"Your free trial has ended. Choose Basic or Pro to enable Gmail monitoring."},403);
      const enabled=Boolean(body?.enabled),{data:bot}=await sb.from("telegram_owned_bots").select("is_active").eq("telegram_user_id",tg).maybeSingle();
      if(enabled&&!bot?.is_active)return json({error:"Connect your personal Telegram bot first."},400);
      const status=await oauth("status",tg),gmail=(status?.connections||[]).find((x:any)=>x?.provider==="gmail");
      if(enabled&&(!gmail||gmail.needs_reconnect))return json({error:"Connect Gmail before enabling hourly monitoring."},400);
      const row={telegram_user_id:tg,enabled,notify_chat_id:tg,interval_minutes:60,auto_draft_replies:true,last_error:null,updated_at:new Date().toISOString()};
      const {data,error}=await sb.from("telegram_gmail_monitor_settings").upsert(row,{onConflict:"telegram_user_id"}).select("enabled,interval_minutes,auto_draft_replies,last_checked_at,last_success_at,last_error").single();if(error)throw error;
      return json({ok:true,gmail_monitor:data});
    }

    if (action==="save_website_widget") {
      const raw=String(body?.domain||"").trim().toLowerCase();
      let domain="";
      try { domain=new URL(raw.includes("://")?raw:"https://"+raw).hostname.toLowerCase().replace(/^www\./,""); } catch {}
      if(!domain || domain.length>253 || !/^[a-z0-9.-]+$/.test(domain) || (!domain.includes(".") && domain!=="localhost")) {
        return json({error:"Enter a valid website domain, for example example.com."},400);
      }
      const welcome=String(body?.welcome_message||"Hi! How can I help?").trim().slice(0,240) || "Hi! How can I help?";
      const position=body?.position==="left"?"left":"right";
      const row={telegram_user_id:tg,allowed_domains:[domain],welcome_message:welcome,position,is_active:true,updated_at:new Date().toISOString()};
      const {data,error}=await sb.from("telegram_website_widgets").upsert(row,{onConflict:"telegram_user_id"})
        .select("public_key,allowed_domains,welcome_message,position,is_active,request_count,last_used_at,updated_at").single();
      if(error) throw error;
      return json({ok:true,website_widget:data});
    }

    if (action==="disconnect_website_widget") {
      const {data,error}=await sb.from("telegram_website_widgets")
        .update({is_active:false,updated_at:new Date().toISOString()})
        .eq("telegram_user_id",tg)
        .select("public_key,allowed_domains,welcome_message,position,is_active,request_count,last_used_at,updated_at").maybeSingle();
      if(error) throw error;
      return json({ok:true,website_widget:data||null});
    }

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

    if(action==="save_own_bot_profile" || action==="save_personal_bot_profile") {
      const access=await personalBotAccess(tg);if(!access.allowed)return json({error:"Your personal bot free trial has ended. Choose Basic or Pro to continue."},403);
      const purposes=["general","education","coding","math","custom"];
      const levels=["primary","secondary","college","professional","all"];
      const teaching=["adaptive","step_by_step","socratic","concise","detailed"];
      const voices=["off","voice_messages","always"];
      const groups=["off","mentions","all"];
      const channels=["off","commands","all"];
      const botName=String(body?.bot_name||"").trim().slice(0,64);
      if(!botName)return json({error:"Enter a name for your bot."},400);
      const subjects=(Array.isArray(body?.subjects)?body.subjects:String(body?.subjects||"").split(","))
        .map((x:any)=>String(x).trim().slice(0,80)).filter(Boolean).slice(0,20);
      const timezone=String(body?.timezone||"Africa/Johannesburg").trim().slice(0,80)||"Africa/Johannesburg";
      if(!validTimezone(timezone))return json({error:"Choose a valid timezone, for example Africa/Johannesburg."},400);
      const row={
        bot_name:botName,
        bot_purpose:purposes.includes(String(body?.bot_purpose))?String(body.bot_purpose):"general",
        personality:String(body?.personality||"").trim().slice(0,1000)||"Friendly, natural and helpful",
        custom_instructions:String(body?.custom_instructions||"").trim().slice(0,8000),subjects,
        education_level:levels.includes(String(body?.education_level))?String(body.education_level):"all",
        teaching_style:teaching.includes(String(body?.teaching_style))?String(body.teaching_style):"adaptive",
        language:String(body?.language||"auto").trim().slice(0,60)||"auto",
        welcome_message:String(body?.welcome_message||"").trim().slice(0,500)||"Hi! How can I help you today?",
        voice_mode:voices.includes(String(body?.voice_mode))?String(body.voice_mode):"voice_messages",
        group_mode:groups.includes(String(body?.group_mode))?String(body.group_mode):"mentions",
        channel_mode:channels.includes(String(body?.channel_mode))?String(body.channel_mode):"commands",
        owner_only_invites:body?.owner_only_invites!==false,
        timezone,
        updated_at:new Date().toISOString()
      };
      const {data:current,error:currentError}=await sb.from("telegram_owned_bots").select("token_enc,is_active").eq("telegram_user_id",tg).maybeSingle();
      if(currentError)throw currentError;if(!current?.is_active||!current?.token_enc)return json({error:"Connect your Telegram bot first."},400);
      const {data,error}=await sb.from("telegram_owned_bots").update(row).eq("telegram_user_id",tg).select(BOT_PROFILE_COLUMNS).single();
      if(error)throw error;
      await syncBotPresentation(await decrypt(String(current.token_enc)),data).catch(()=>null);
      return json({ok:true,bot:data});
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

    if (action==="save_business_profile") {
      const businessName=String(body?.business_name||"").trim().slice(0,120);
      const assistantName=String(body?.assistant_name||"").trim().slice(0,80);
      const businessDetails=String(body?.business_details||"").trim().slice(0,8000);
      const websiteUrl=String(body?.website_url||"").trim().slice(0,500);
      if(!businessName) return json({error:"Enter your business name."},400);
      if(!assistantName) return json({error:"Enter the name your AI should use."},400);
      if(websiteUrl && !/^https?:\/\//i.test(websiteUrl)) return json({error:"Website must start with https:// or http://."},400);
      const hours=body?.business_hours && typeof body.business_hours==="object" && !Array.isArray(body.business_hours) ? body.business_hours : {};
      if(JSON.stringify(hours).length>5000) return json({error:"Business hours are too long."},400);
      const row={
        telegram_user_id:tg,business_name:businessName,assistant_name:assistantName,business_details:businessDetails,
        email:String(body?.email||"").trim().slice(0,160),phone:String(body?.phone||"").trim().slice(0,60),
        address:String(body?.address||"").trim().slice(0,500),website_url:websiteUrl,
        payment_options:String(body?.payment_options||"").trim().slice(0,1000),business_hours:hours,
        booking_reminders:Boolean(body?.booking_reminders),booking_confirmations:Boolean(body?.booking_confirmations),
        booking_instructions:String(body?.booking_instructions||"").trim().slice(0,2000),updated_at:new Date().toISOString()
      };
      const {data,error}=await sb.from("telegram_business_profiles").upsert(row,{onConflict:"telegram_user_id"})
        .select("business_name,assistant_name,business_details,email,phone,address,website_url,payment_options,business_hours,booking_reminders,booking_confirmations,booking_instructions,updated_at").single();
      if(error) throw error;
      return json({ok:true,business_profile:data});
    }

    if (action==="save_catalog_item") {
      const id=String(body?.id||"");
      if(id && !/^[0-9a-f-]{36}$/i.test(id)) return json({error:"Invalid catalog item."},400);
      const itemType=body?.item_type==="service"?"service":"product";
      const name=String(body?.name||"").trim().slice(0,160);
      if(!name) return json({error:"Enter the product or service name."},400);
      const row={telegram_user_id:tg,item_type:itemType,name,price:String(body?.price||"").trim().slice(0,80),currency:String(body?.currency||"ZAR").trim().toUpperCase().slice(0,8)||"ZAR",details:String(body?.details||"").trim().slice(0,4000),available:body?.available!==false,updated_at:new Date().toISOString()};
      const q=id?sb.from("telegram_business_catalog").update(row).eq("id",id).eq("telegram_user_id",tg):sb.from("telegram_business_catalog").insert(row);
      const {data,error}=await q.select("id,item_type,name,price,currency,details,available,sort_order").single();
      if(error) throw error;
      return json({ok:true,item:data});
    }

    if (action==="save_specialist") {
      const id=String(body?.id||"");
      if(id && !/^[0-9a-f-]{36}$/i.test(id)) return json({error:"Invalid specialist."},400);
      const firstName=String(body?.first_name||"").trim().slice(0,80);
      if(!firstName) return json({error:"Enter the specialist's first name."},400);
      const services=Array.isArray(body?.services)?body.services.map((x:any)=>String(x).trim().slice(0,160)).filter(Boolean).slice(0,30):[];
      const row={telegram_user_id:tg,first_name:firstName,last_name:String(body?.last_name||"").trim().slice(0,80),about:String(body?.about||"").trim().slice(0,3000),services,active:body?.active!==false,updated_at:new Date().toISOString()};
      const q=id?sb.from("telegram_business_specialists").update(row).eq("id",id).eq("telegram_user_id",tg):sb.from("telegram_business_specialists").insert(row);
      const {data,error}=await q.select("id,first_name,last_name,about,services,active,sort_order").single();
      if(error) throw error;
      return json({ok:true,specialist:data});
    }

    if (action==="save_faq") {
      const id=String(body?.id||"");
      if(id && !/^[0-9a-f-]{36}$/i.test(id)) return json({error:"Invalid FAQ."},400);
      const question=String(body?.question||"").trim().slice(0,500);
      const answer=String(body?.answer||"").trim().slice(0,4000);
      if(!question||!answer) return json({error:"Enter both the question and answer."},400);
      const row={telegram_user_id:tg,question,answer,updated_at:new Date().toISOString()};
      const q=id?sb.from("telegram_business_faqs").update(row).eq("id",id).eq("telegram_user_id",tg):sb.from("telegram_business_faqs").insert(row);
      const {data,error}=await q.select("id,question,answer,sort_order").single();
      if(error) throw error;
      return json({ok:true,faq:data});
    }

    if (action==="delete_business_item") {
      const id=String(body?.id||"");
      const kind=String(body?.kind||"");
      const tables:any={catalog:"telegram_business_catalog",specialist:"telegram_business_specialists",faq:"telegram_business_faqs"};
      if(!tables[kind]||!/^[0-9a-f-]{36}$/i.test(id)) return json({error:"Invalid item."},400);
      const {error}=await sb.from(tables[kind]).delete().eq("id",id).eq("telegram_user_id",tg);
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
