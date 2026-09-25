import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AI_URL = `${SUPABASE_URL}/functions/v1/tivals-ai-chat`;
const OAUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-oauth`;
const APP_URL = "https://ai.tivalsdeveloper.site/telegram-app.html";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const seenUpdates = new Map<string, number>();
const chatBuckets = new Map<string, { count:number; resetAt:number }>();
const botIdentity = new Map<string, { id:number; username:string }>();
const conversationMemory = new Map<string,{messages:Array<{role:"user"|"assistant";content:string}>;expires:number}>();

function acceptUpdate(key:string) {
  const now=Date.now(),expires=seenUpdates.get(key)||0;
  if(expires>now)return false;
  seenUpdates.set(key,now+10*60_000);
  if(seenUpdates.size>5000)for(const [k,v] of seenUpdates)if(v<=now)seenUpdates.delete(k);
  return true;
}
function acceptChat(key:string) {
  const now=Date.now(),bucket=chatBuckets.get(key);
  if(!bucket||bucket.resetAt<=now){chatBuckets.set(key,{count:1,resetAt:now+60_000});return true;}
  if(bucket.count>=12)return false;
  bucket.count+=1;return true;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function unb64(value: string) {
  const raw = atob(value); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function aesKey() {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(SERVICE_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}
async function decrypt(value: string) {
  const bytes = unb64(value); const iv = bytes.slice(0, 12); const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), cipher);
  return new TextDecoder().decode(plain);
}
async function telegram(token: string, method: string, payload: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.description || `Telegram ${method} failed.`);
  return d;
}
function bytesToB64(bytes:Uint8Array) {
  let out="";for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return btoa(out);
}
async function telegramVoice(token:string,chatId:number,audio:Uint8Array,caption:string,business="") {
  const form=new FormData();form.append("chat_id",String(chatId));form.append("voice",new Blob([audio],{type:"audio/mpeg"}),"reply.mp3");
  form.append("caption",String(caption||"").slice(0,900));if(business)form.append("business_connection_id",business);
  const r=await fetch(`https://api.telegram.org/bot${token}/sendVoice`,{method:"POST",body:form});const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok===false)throw new Error(d?.description||"Telegram voice reply failed.");return d;
}
async function telegramFileBytes(token:string,fileId:string,maxBytes=6_000_000) {
  const info=await telegram(token,"getFile",{file_id:fileId});const path=info?.result?.file_path;if(!path)throw new Error("Telegram did not return the voice file.");
  const r=await fetch(`https://api.telegram.org/file/bot${token}/${path}`);if(!r.ok)throw new Error("Could not download the voice message.");
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>maxBytes)throw new Error("Please keep voice messages under 90 seconds.");return bytes;
}
function audioFormat(mime:string){const v=String(mime||"").toLowerCase();if(v.includes("webm"))return"webm";if(v.includes("mpeg")||v.includes("mp3"))return"mp3";if(v.includes("mp4")||v.includes("m4a"))return"m4a";if(v.includes("aac"))return"aac";if(v.includes("wav"))return"wav";return"ogg"}
async function transcribeVoice(bytes:Uint8Array,mime:string){const key=Deno.env.get("OPENROUTER_API_KEY")||"";if(!key)throw new Error("Voice recognition is not configured.");const r=await fetch(`${OPENROUTER_BASE}/audio/transcriptions`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://ai.tivalsdeveloper.site/","X-OpenRouter-Title":"Tivals AI"},body:JSON.stringify({model:"openai/whisper-large-v3",input_audio:{data:bytesToB64(bytes),format:audioFormat(mime)},response_format:"json",temperature:0})});const d=await r.json().catch(()=>({}));const text=String(d?.text||"").trim();if(!r.ok||!text)throw new Error(d?.error?.message||d?.error||"I could not understand that voice message.");return text.slice(0,4000)}
async function synthesizeVoice(text:string){const key=Deno.env.get("OPENROUTER_API_KEY")||"";if(!key)throw new Error("Voice replies are not configured.");const r=await fetch(`${OPENROUTER_BASE}/audio/speech`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://ai.tivalsdeveloper.site/","X-OpenRouter-Title":"Tivals AI"},body:JSON.stringify({model:"mistralai/voxtral-mini-tts-2603",input:String(text||"").slice(0,3500),voice:"en_paul_neutral",response_format:"mp3",speed:1})});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d?.error?.message||d?.error||"Voice generation failed.");}return new Uint8Array(await r.arrayBuffer())}
async function groupMessageAllowed(token:string,connectorKey:string,message:any,text:string) {
  if(String(message?.chat?.type||"private")==="private")return true;
  let me=botIdentity.get(connectorKey);
  if(!me){const d=await telegram(token,"getMe",{});me={id:Number(d?.result?.id||0),username:String(d?.result?.username||"")};botIdentity.set(connectorKey,me);}
  const repliedToBot=Number(message?.reply_to_message?.from?.id||0)===me.id;
  const mentioned=Boolean(me.username&&new RegExp(`@${me.username.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(text));
  return repliedToBot||mentioned;
}
async function businessBelongsToOwner(token: string, businessConnectionId: string, ownerId: number) {
  if (!businessConnectionId || !ownerId) return false;
  try {
    const d = await telegram(token, "getBusinessConnection", { business_connection_id: businessConnectionId });
    const connection = d?.result;
    return Number(connection?.user?.id || 0) === ownerId && connection?.is_enabled !== false;
  } catch {
    return false;
  }
}
function esc(v: string) {
  return String(v || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
async function oauth(action:string,tg:number,provider="",extra:Record<string,unknown>={}) {
  const r=await fetch(OAUTH_URL,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+SERVICE_KEY},body:JSON.stringify({action,telegram_user_id:tg,provider,...extra})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d?.error||"Connector request failed.");
  return d;
}
async function ownerConnectMenu(token:string,chatId:number,tg:number,business="") {
  const rows:any[][]=[];
  for(const [provider,label] of [["gmail","📧 Connect Gmail"],["github","🐙 Connect GitHub"],["tiktok","🎵 Connect TikTok"]] as const){
    try{const d=await oauth("create_link",tg,provider);if(d?.url)rows.push([{text:label,url:d.url}])}catch{}
  }
  try{const d=await oauth("create_website_link",tg);if(d?.url)rows.push([{text:"🌐 Connect Tivals AI Website",url:d.url}])}catch{}
  await telegram(token,"sendMessage",{chat_id:chatId,text:"🔐 <b>Connect tools to your bot</b>\n\nThese connections belong to the bot owner and are never shown to visitors.",parse_mode:"HTML",reply_markup:{inline_keyboard:rows},...(business?{business_connection_id:business}:{})});
}
async function ownerAccounts(token:string,chatId:number,tg:number,business="") {
  const d=await oauth("status",tg);const list=Array.isArray(d?.connections)?d.connections:[];
  const labels:any={gmail:"📧 Gmail",github:"🐙 GitHub",tiktok:"🎵 TikTok",website:"🌐 Tivals AI Website"};
  const text=list.length?"<b>Connected tools</b>\n\n"+list.map((x:any)=>"• "+(labels[x.provider]||x.provider)+": <b>"+esc(x.account_label||"Connected")+"</b>").join("\n"):"<b>Connected tools</b>\n\nNo tools connected yet. Use /connect.";
  await telegram(token,"sendMessage",{chat_id:chatId,text,parse_mode:"HTML",...(business?{business_connection_id:business}:{})});
}
async function ownerApp(token:string,chatId:number,business="") {
  await telegram(token,"sendMessage",{chat_id:chatId,text:"📱 <b>Tivals AI App</b>\n\nOpen the dashboard to connect tools and manage your bot.",parse_mode:"HTML",reply_markup:{inline_keyboard:[[{text:"Open Tivals AI App",web_app:{url:APP_URL}}]]},...(business?{business_connection_id:business}:{})});
}
async function sendToolSuggestions(token:string,chatId:number,business="") {
  await telegram(token,"sendMessage",{chat_id:chatId,text:"Choose a Tivals AI tool:",reply_markup:{inline_keyboard:[
    [{text:"🎵 TikTok",callback_data:"tool_suggest:tiktok"},{text:"📧 Gmail",callback_data:"tool_suggest:gmail"}],
    [{text:"🐙 GitHub",callback_data:"tool_suggest:github"},{text:"▶️ YouTube",callback_data:"tool_suggest:youtube"}],
    [{text:"🎨 Image",callback_data:"tool_suggest:image"},{text:"✨ AI",callback_data:"tool_suggest:ai"}]
  ]},...(business?{business_connection_id:business}:{})});
}
const TOOL_SUGGESTION_TEXT:Record<string,string>={
  tiktok:"🎵 **TikTok**\n\nType: `@tiktok check my TikTok account`",
  gmail:"📧 **Gmail**\n\nType: `@gmail check my latest emails`\nBot owner: use `/connect` first.",
  github:"🐙 **GitHub**\n\nType: `@github check my GitHub account`\nBot owner: use `/connect` first.",
  youtube:"▶️ **YouTube**\n\nType: `@youtube Python tutorial`",
  image:"🎨 **Image**\n\nType: `@image futuristic AI robot`",
  ai:"✨ **AI**\n\nType: `@ai explain recursion`"
};
function mdToHtml(input: string) {
  let raw = String(input || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "I couldn't generate a response.";

  const codeBlocks: string[] = [];
  const addCodeBlock = (language: string, code: string) => {
    const token = `@@TIVALS_CODE_${codeBlocks.length}@@`;
    const lang = String(language || "").replace(/[^a-zA-Z0-9_+.#-]/g, "");
    const cls = lang ? ` class="language-${lang}"` : "";
    codeBlocks.push(`<pre><code${cls}>${esc(String(code || "").trim())}</code></pre>`);
    return token;
  };

  raw = raw.replace(/```([a-zA-Z0-9_+.#-]*)\s*\n([\s\S]*?)```/g, (_m, lang, code) => addCodeBlock(lang, code));
  raw = raw.replace(/```\s*\n?([\s\S]*?)```/g, (_m, code) => addCodeBlock("", code));
  raw = raw.replace(/```([a-zA-Z0-9_+.#-]*)\s*\n([\s\S]+)$/g, (_m, lang, code) => addCodeBlock(lang, code));

  let t = esc(raw)
    .replace(/^\s*(?:---+|___+|\*\*\*+)\s*$/gm, "")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\n{3,}/g, "\n\n");

  codeBlocks.forEach((block, i) => { t = t.replace(`@@TIVALS_CODE_${i}@@`, block); });
  return t.trim();
}
function splitHtml(text: string, limit = 3500) {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < 1800) cut = rest.lastIndexOf("\n", limit);
    if (cut < 1800) cut = rest.lastIndexOf(" ", limit);
    if (cut < 1800) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
async function reply(token: string, chatId: number, text: string, businessConnectionId = "") {
  const html = mdToHtml(text);
  for (const part of splitHtml(html)) {
    try {
      await telegram(token, "sendMessage", {
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {})
      });
    } catch {
      await telegram(token, "sendMessage", {
        chat_id: chatId,
        text: part.replace(/<[^>]+>/g, ""),
        link_preview_options: { is_disabled: true },
        ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {})
      });
    }
  }
}

async function telegramBusinessProfile(tg:number) {
  if(!tg) return null;
  const [{data:profile,error},{data:catalog},{data:specialists},{data:faqs}] = await Promise.all([
    sb.from("telegram_business_profiles").select("business_name,assistant_name,business_details,email,phone,address,website_url,payment_options,business_hours,booking_reminders,booking_confirmations,booking_instructions").eq("telegram_user_id",tg).maybeSingle(),
    sb.from("telegram_business_catalog").select("item_type,name,price,currency,details,available").eq("telegram_user_id",tg).eq("available",true).order("sort_order"),
    sb.from("telegram_business_specialists").select("first_name,last_name,about,services").eq("telegram_user_id",tg).eq("active",true).order("sort_order"),
    sb.from("telegram_business_faqs").select("question,answer").eq("telegram_user_id",tg).order("sort_order")
  ]);
  if(error) throw error;
  return profile ? {...profile,catalog:catalog||[],specialists:specialists||[],faqs:faqs||[]} : null;
}

function personalBotSystem(profile:any) {
  const name=String(profile?.bot_name||profile?.account_label||"AI assistant").slice(0,64);
  const purpose=String(profile?.bot_purpose||"general");
  const subjects=Array.isArray(profile?.subjects)?profile.subjects.map((x:any)=>String(x).slice(0,80)).filter(Boolean).slice(0,20):[];
  const lines=[
    `Your name is ${name}. Speak naturally, warmly and conversationally, like a thoughtful human assistant.`,
    `Personality: ${String(profile?.personality||"Friendly, natural and helpful").slice(0,1000)}.`,
    `Use ${String(profile?.language||"the user's language").slice(0,60)==="auto"?"the same language as the user":String(profile.language).slice(0,60)}.`,
    "Never pretend to have done a real-world action you did not do. Be honest when uncertain."
  ];
  if(["education","coding","math"].includes(purpose)){
    lines.push(
      `You are an educational tutor for level: ${String(profile?.education_level||"all")}.`,
      `Teaching style: ${String(profile?.teaching_style||"adaptive").replace(/_/g," ")}.`,
      subjects.length?`Focus subjects: ${subjects.join(", ")}.`:"Teach the subject requested by the learner.",
      "Teach for understanding: explain concepts clearly, use worked examples, ask a short checking question when useful, and adapt difficulty to the learner.",
      "For mathematics, show the reasoning and verify calculations. For programming, provide correct runnable examples, explain errors, and format code in fenced code blocks.",
      "For quizzes, do not reveal answers until the learner responds unless they explicitly ask for the solutions."
    );
  }
  if(purpose==="coding")lines.push("Prioritize programming, debugging, software engineering and computer science education.");
  if(purpose==="math")lines.push("Prioritize mathematics, step-by-step problem solving and checking final answers.");
  if(String(profile?.custom_instructions||"").trim())lines.push(`Creator instructions: ${String(profile.custom_instructions).slice(0,8000)}`);
  return lines.join("\n\n").slice(0,12000);
}

function commandPrompt(text:string) {
  const ask=String(text||"").match(/^\/ask(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/i);
  if(ask)return String(ask[1]||"").trim()||"Ask the user what they would like help with.";
  const m=String(text||"").match(/^\/(lesson|explain|quiz|practice)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/i);
  if(!m)return text;
  const topic=String(m[2]||"").trim();
  if(!topic)return `Ask what topic the learner wants for the ${m[1].toLowerCase()}.`;
  const action=m[1].toLowerCase();
  if(action==="lesson")return `Teach a structured mini-lesson about: ${topic}`;
  if(action==="explain")return `Explain this clearly at the learner's level: ${topic}`;
  if(action==="quiz")return `Create a 5-question interactive quiz about: ${topic}. Ask the questions first without the answers.`;
  return `Give progressive practice questions about: ${topic}. Include hints, but wait before revealing full solutions.`;
}

function memoryMessages(key:string) {
  const now=Date.now(),item=conversationMemory.get(key);
  if(!item||item.expires<=now){conversationMemory.delete(key);return [];}return item.messages;
}
function remember(key:string,user:string,assistant:string) {
  conversationMemory.set(key,{messages:[...memoryMessages(key),{role:"user",content:user.slice(0,3000)},{role:"assistant",content:assistant.slice(0,3000)}].slice(-8),expires:Date.now()+30*60_000});
  if(conversationMemory.size>2000)for(const [k,v] of conversationMemory)if(v.expires<=Date.now())conversationMemory.delete(k);
}
async function personalAi(profile:any,businessProfile:any,memoryKey:string,userText:string) {
  const prompt=commandPrompt(userText);
  const ai=await fetch(AI_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${SERVICE_KEY}`},body:JSON.stringify({model:"auto",business_profile:businessProfile,messages:[{role:"system",content:personalBotSystem(profile)},...memoryMessages(memoryKey),{role:"user",content:prompt}]})});
  const result=await ai.json().catch(()=>({}));if(!ai.ok||!result?.reply)throw new Error(result?.error||"The AI is temporarily unavailable.");
  const answer=String(result.reply);remember(memoryKey,prompt,answer);return answer;
}

async function consumeOwnerAiUsage(tg:number) {
  const {data:admin}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();
  if(admin)return;
  const {data}=await sb.from("telegram_subscriptions")
    .select("plan,status,subscription_expiration_date")
    .eq("telegram_user_id",tg).maybeSingle();
  const active=Boolean(data&&data.status==="active"&&["basic","pro"].includes(data.plan)&&new Date(data.subscription_expiration_date).getTime()>Date.now());
  const plan=active?String(data.plan):"free",limit=plan==="pro"?1000:plan==="basic"?200:20;
  const today=new Date().toISOString().slice(0,10);
  const {data:usage,error}=await sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle();
  if(error)throw error;
  const used=Number(usage?.ai_messages||0);if(used>=limit)throw new Error("This bot has reached its daily AI limit. The creator can upgrade the plan in /app.");
  const {error:upsertError}=await sb.from("telegram_daily_usage").upsert({telegram_user_id:tg,usage_date:today,ai_messages:used+1,image_generations:Number(usage?.image_generations||0),updated_at:new Date().toISOString()},{onConflict:"telegram_user_id,usage_date"});
  if(upsertError)throw upsertError;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const u = new URL(req.url);
  const owner = u.searchParams.get("owner") || "";
  const tgOwner = Number(u.searchParams.get("tg_owner") || 0);

  let conn:any=null;
  let paywallOwner=0;

  if (tgOwner > 0) {
    const {data,error}=await sb.from("telegram_owned_bots")
      .select("token_enc,webhook_secret_enc,account_label,is_active,bot_name,bot_purpose,personality,custom_instructions,subjects,education_level,teaching_style,language,welcome_message,voice_mode,group_mode,channel_mode,owner_only_invites")
      .eq("telegram_user_id",tgOwner).maybeSingle();
    if(error || !data || !data.is_active) return json({error:"Connector not found"},404);
    conn={
      ...data,
      access_token_enc:data.token_enc,
      refresh_token_enc:data.webhook_secret_enc,
      account_label:data.account_label
    };
    paywallOwner=tgOwner;
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(owner)) return json({ error: "Invalid connector" }, 400);
    const { data, error } = await sb.from("tivals_web_oauth_connections")
      .select("access_token_enc,refresh_token_enc,account_label")
      .eq("user_id", owner).eq("provider", "telegram").maybeSingle();
    if (error || !data) return json({ error: "Connector not found" }, 404);
    conn=data;
  }

  try {
    const [token, secret] = await Promise.all([decrypt(String(conn.access_token_enc || "")), decrypt(String(conn.refresh_token_enc || ""))]);
    if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return json({ error: "Unauthorized" }, 401);

    const update = await req.json();
    const connectorKey=paywallOwner?`tg:${paywallOwner}`:`web:${owner}`;
    const updateId=Number(update?.update_id);
    if(Number.isFinite(updateId)&&!acceptUpdate(`${connectorKey}:${updateId}`))return json({ok:true,ignored:true,reason:"duplicate-update"});
    if(paywallOwner&&update?.my_chat_member){
      const membership=update.my_chat_member,chat=membership?.chat||{},actor=Number(membership?.from?.id||0);
      const status=String(membership?.new_chat_member?.status||""),joined=["member","administrator","restricted"].includes(status);
      const groupLike=["group","supergroup","channel"].includes(String(chat?.type||""));
      if(joined&&groupLike&&conn.owner_only_invites!==false&&actor!==paywallOwner){
        if(chat.type!=="channel")await telegram(token,"sendMessage",{chat_id:chat.id,text:"Only my creator can add me to a group. I’m leaving this chat for security."}).catch(()=>{});
        await telegram(token,"leaveChat",{chat_id:chat.id}).catch(()=>{});
        return json({ok:true,route:"unauthorized-chat-left"});
      }
      if(joined&&groupLike&&actor===paywallOwner&&chat.type!=="channel"){
        await telegram(token,"sendMessage",{chat_id:chat.id,text:`✅ ${conn.bot_name||"Your AI bot"} is ready. Mention me, reply to one of my messages, or use /grouphelp.`}).catch(()=>{});
      }
      return json({ok:true,route:joined?"owner-chat-approved":"membership-updated"});
    }
    if (paywallOwner && update?.business_connection) {
      const connectionOwner = Number(update.business_connection?.user?.id || 0);
      return json({
        ok: true,
        route: connectionOwner === paywallOwner ? "business-owner-verified" : "business-owner-rejected"
      });
    }
    if(update?.callback_query){
      const q=update.callback_query,data=String(q?.data||"");
      if(data.startsWith("tool_suggest:")){
        await telegram(token,"answerCallbackQuery",{callback_query_id:q.id}).catch(()=>{});
        const tool=data.slice("tool_suggest:".length),callbackChat=Number(q?.message?.chat?.id||0),callbackBusiness=String(q?.message?.business_connection_id||"");
        if (paywallOwner && callbackBusiness && !(await businessBelongsToOwner(token, callbackBusiness, paywallOwner))) {
          return json({ ok: true, route: "business-owner-rejected" });
        }
        if(callbackChat&&TOOL_SUGGESTION_TEXT[tool])await reply(token,callbackChat,TOOL_SUGGESTION_TEXT[tool],callbackBusiness);
        return json({ok:true,route:"tool-suggestion",tool});
      }
    }
    const channelPost=Boolean(update?.channel_post);
    const message = update?.business_message || update?.message || update?.channel_post;
    const chatId = Number(message?.chat?.id || 0);
    const senderId = Number(message?.from?.id || 0);
    let text = String(message?.text || message?.caption || "").trim();
    const voice=message?.voice||null;
    const businessConnectionId = String(message?.business_connection_id || "");
    const chatType=String(message?.chat?.type||"private");
    if (!chatId || (!text&&!voice) || message?.from?.is_bot || message?.sender_business_bot || message?.via_bot) return json({ ok: true });
    if(channelPost){
      const mode=String(conn.channel_mode||"commands");
      if(mode==="off")return json({ok:true,ignored:true,reason:"channel-disabled"});
      const addressed=/^\/(?:ask|lesson|explain|quiz|practice)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)||await groupMessageAllowed(token,connectorKey,message,text);
      if(mode!=="all"&&!addressed)return json({ok:true,ignored:true,reason:"channel-command-required"});
      text=text.replace(/^\/ask(?:@[A-Za-z0-9_]+)?\s*/i,"").trim();
    } else if(!update?.business_message&&chatType!=="private"){
      const mode=String(conn.group_mode||"mentions");
      if(mode==="off")return json({ok:true,ignored:true,reason:"groups-disabled"});
      const groupCommand=/^\/(?:ask|lesson|explain|quiz|practice|grouphelp)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text);
      if(mode!=="all"&&!groupCommand&&!await groupMessageAllowed(token,connectorKey,message,text))return json({ok:true,ignored:true,reason:"group-message-not-addressed"});
    }
    if(!acceptChat(`${connectorKey}:${chatId}:${senderId}`))return json({ok:true,ignored:true,reason:"rate-limited"});
    if (paywallOwner && update?.business_message && !(await businessBelongsToOwner(token, businessConnectionId, paywallOwner))) {
      return json({ ok: true, route: "business-owner-rejected" });
    }
    // A message sent manually by the connected business-account owner is outgoing.
    // Ignore it so automation never answers the owner while they are talking to a customer.
    if (paywallOwner && update?.business_message && senderId === paywallOwner) {
      return json({ ok: true, ignored: true, reason: "outgoing-owner-message" });
    }
    if (paywallOwner && senderId === paywallOwner && ["/app","/dashboard","/settings"].includes(text)) {
      await ownerApp(token,chatId,businessConnectionId); return json({ok:true,route:"owner-app"});
    }
    if (paywallOwner && senderId === paywallOwner && text === "/connect") {
      await ownerConnectMenu(token,chatId,paywallOwner,businessConnectionId); return json({ok:true,route:"owner-connect"});
    }
    if (paywallOwner && senderId === paywallOwner && text === "/accounts") {
      await ownerAccounts(token,chatId,paywallOwner,businessConnectionId); return json({ok:true,route:"owner-accounts"});
    }
    if (paywallOwner && senderId !== paywallOwner && ["/app","/dashboard","/settings","/connect","/accounts"].includes(text)) {
      await reply(token,chatId,"Only the bot owner can manage this bot's apps and connected tools.",businessConnectionId); return json({ok:true,route:"owner-only"});
    }
    if (text === "@") {
      await sendToolSuggestions(token,chatId,businessConnectionId);
      return json({ok:true,route:"tool-suggestions"});
    }
    if (/^\/start(?:\s|$)/i.test(text)) {
      await reply(token, chatId, `${conn.welcome_message||`Hi! I am ${conn.bot_name||conn.account_label||"your AI assistant"}. How can I help?`}${paywallOwner && senderId===paywallOwner ? "\n\nOwner commands: /app, /connect, /accounts" : ""}`, businessConnectionId);
      return json({ ok: true });
    }
    if(/^\/grouphelp(?:@[A-Za-z0-9_]+)?$/i.test(text)){
      await reply(token,chatId,"In groups, mention me or reply to one of my messages. Educational commands: `/lesson topic`, `/explain topic`, `/quiz topic`, and `/practice topic`. In channels, use `/ask question` or an educational command. Only my creator is allowed to add me to groups or channels.",businessConnectionId);
      return json({ok:true,route:"group-help"});
    }
    if(voice){
      const duration=Number(voice?.duration||0),size=Number(voice?.file_size||0);if(duration>90||size>6_000_000)throw new Error("Please keep voice messages under 90 seconds.");
      await telegram(token,"sendChatAction",{chat_id:chatId,action:"record_voice",...(businessConnectionId?{business_connection_id:businessConnectionId}:{})}).catch(()=>{});
      text=await transcribeVoice(await telegramFileBytes(token,String(voice?.file_id||"")),String(voice?.mime_type||"audio/ogg"));
    }
    await telegram(token, "sendChatAction", {
      chat_id: chatId,
      action: "typing",
      ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {})
    });
    if(paywallOwner)await consumeOwnerAiUsage(paywallOwner);
    const businessProfile=paywallOwner ? await telegramBusinessProfile(paywallOwner) : null;
    const answer=await personalAi(conn,businessProfile,`${connectorKey}:${chatId}:${senderId||"channel"}`,text);
    const shouldSpeak=String(conn.voice_mode||"voice_messages")==="always"||(Boolean(voice)&&String(conn.voice_mode||"voice_messages")!=="off");
    if(shouldSpeak){
      try{await telegramVoice(token,chatId,await synthesizeVoice(answer),answer,businessConnectionId)}catch{await reply(token,chatId,answer,businessConnectionId)}
    } else await reply(token,chatId,answer,businessConnectionId);
    return json({ ok: true,route:voice?"voice":"ai" });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});
