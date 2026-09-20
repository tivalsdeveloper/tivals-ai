import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AI_URL = `${SUPABASE_URL}/functions/v1/tivals-ai-chat`;
const OAUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-oauth`;
const APP_URL = "https://ai.tivalsdeveloper.site/telegram-app.html";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();

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
  const {data,error}=await sb.from("telegram_business_profiles")
    .select("business_name,assistant_name,business_details")
    .eq("telegram_user_id",tg).maybeSingle();
  if(error) throw error;
  return data;
}

async function paidOrOwner(tg:number) {
  const {data:admin}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();
  if(admin) return true;
  const {data}=await sb.from("telegram_subscriptions")
    .select("plan,status,subscription_expiration_date")
    .eq("telegram_user_id",tg).maybeSingle();
  return Boolean(data && data.status==="active" && ["basic","pro"].includes(data.plan) && new Date(data.subscription_expiration_date).getTime()>Date.now());
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
      .select("token_enc,webhook_secret_enc,account_label,is_active")
      .eq("telegram_user_id",tgOwner).maybeSingle();
    if(error || !data || !data.is_active) return json({error:"Connector not found"},404);
    conn={
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
    const message = update?.business_message || update?.message;
    const chatId = Number(message?.chat?.id || 0);
    const senderId = Number(message?.from?.id || 0);
    const text = String(message?.text || "").trim();
    const businessConnectionId = String(message?.business_connection_id || "");
    if (!chatId || !text || message?.from?.is_bot || message?.sender_business_bot || message?.via_bot) return json({ ok: true });
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
      await reply(token, chatId, `Welcome! I am ${conn.account_label || "your Tivals AI bot"}. Send me a question and I will help you.${paywallOwner && senderId===paywallOwner ? "\n\nOwner commands: /app, /connect, /accounts" : ""}`, businessConnectionId);
      return json({ ok: true });
    }
    await telegram(token, "sendChatAction", {
      chat_id: chatId,
      action: "typing",
      ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {})
    });
    const businessProfile=paywallOwner ? await telegramBusinessProfile(paywallOwner) : null;
    const ai = await fetch(AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ model: "auto", business_profile: businessProfile, messages: [{ role: "user", content: text }] })
    });
    const result = await ai.json().catch(() => ({}));
    if (!ai.ok || !result?.reply) throw new Error(result?.error || "The AI is temporarily unavailable.");
    await reply(token, chatId, String(result.reply), businessConnectionId);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});
