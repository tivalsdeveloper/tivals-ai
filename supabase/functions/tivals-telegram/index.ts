import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TELEGRAM_API = "https://api.telegram.org";
const TIVALS_AI_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat";
const YOUTUBE_SEARCH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/youtube-search";
const PIXAZO_STUDIO_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/pixazo-studio";
const OAUTH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/telegram-oauth";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const APPMIX_BASE = "https://api.apmix.ai/v1";
const PUBLIC_WEBHOOK_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-telegram";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function esc(v: string) { return String(v || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function stripTags(v: string) { return String(v || "").replace(/<[^>]+>/g, ""); }
function mdToHtml(input: string) {
  let raw = String(input || "").trim();
  if (!raw) return "I couldn't generate a response.";
  const blocks: string[] = [];
  raw = raw.replace(/```(?:[a-zA-Z0-9_+.#-]+)?\s*\n?([\s\S]*?)```/g, (_m, code) => {
    const token = `@@CODE_${blocks.length}@@`;
    blocks.push(`<pre><code>${esc(String(code || "").trim())}</code></pre>`);
    return token;
  });
  let t = esc(raw)
    .replace(/^\s*(?:---+|___+|\*\*\*+)\s*$/gm, "")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\n{3,}/g, "\n\n");
  blocks.forEach((b, i) => { t = t.replace(`@@CODE_${i}@@`, b); });
  return t.trim();
}
function splitText(text: string, limit = 3500) {
  if (text.length <= limit) return [text];
  const out: string[] = []; let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < 1200) cut = rest.lastIndexOf("\n", limit);
    if (cut < 1200) cut = rest.lastIndexOf(" ", limit);
    if (cut < 1200) cut = limit;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest); return out;
}
async function telegram(method: string, payload: Record<string, unknown>) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  const r = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.description || `Telegram ${method} failed (${r.status}).`);
  return d;
}
async function sendHtml(chatId: number|string, html: string, business?: string) {
  for (const part of splitText(html)) {
    const p: any = { chat_id: chatId, text: part, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (business) p.business_connection_id = business;
    try { await telegram("sendMessage", p); }
    catch { const q:any = { chat_id: chatId, text: stripTags(part) }; if (business) q.business_connection_id = business; await telegram("sendMessage", q); }
  }
}
async function sendFormatted(chatId:number|string, text:string, business?:string) { return sendHtml(chatId, mdToHtml(text), business); }

async function syncWebhook() {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  const payload:any = {
    url: PUBLIC_WEBHOOK_URL,
    allowed_updates: ["message", "business_message", "business_connection", "callback_query"],
    drop_pending_updates: false
  };
  if (secret) payload.secret_token = secret;
  return telegram("setWebhook", payload);
}

const TELEGRAM_STYLE = "Reply for Telegram on a small phone screen. Be concise. Use short sections, Markdown bold/headings and fenced code blocks when needed. Never output horizontal rules such as --- or ***. If the user asks to learn a broad topic, teach one focused lesson at a time and end with one short practice task. For cybersecurity topics, keep examples within authorized labs or systems the user owns or has permission to test.";
async function fetchJson(url:string, init:RequestInit, ms:number) {
  const c = new AbortController(); const timer = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { ...init, signal:c.signal }); const d = await r.json().catch(()=>({})); return {r,d}; }
  finally { clearTimeout(timer); }
}
function chatContent(d:any) {
  const c = d?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.map((x:any)=>typeof x === "string" ? x : x?.text || "").join("").trim();
  return "";
}
async function askAI(message:string) {
  const messages = [{role:"system",content:TELEGRAM_STYLE},{role:"user",content:message}];
  const providers: Promise<string>[] = [];
  providers.push((async()=>{
    const {r,d}=await fetchJson(TIVALS_AI_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"tivals-ai",messages})},18000);
    if(r.ok&&d?.reply) return String(d.reply); throw new Error(d?.error||`Tivals AI ${r.status}`);
  })());
  const open=Deno.env.get("OPENROUTER_API_KEY")||"";
  if(open) providers.push((async()=>{
    const {r,d}=await fetchJson(`${OPENROUTER_BASE}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${open}`,"Content-Type":"application/json","HTTP-Referer":"https://ai.tivalsdeveloper.site/","X-OpenRouter-Title":"Tivals AI Telegram"},body:JSON.stringify({model:"openrouter/free",messages,max_tokens:1300,temperature:0.35})},18000);
    const txt=chatContent(d); if(r.ok&&txt) return txt; throw new Error("OpenRouter failed");
  })());
  try { return await Promise.any(providers); } catch {}
  const app=Deno.env.get("APPMIX_API_KEY")||"";
  if(app) {
    const fallbacks=["openai/gpt-4.1-free","google/gemini-3-flash-preview-free"].map(model=>(async()=>{
      const {r,d}=await fetchJson(`${APPMIX_BASE}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${app}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages,max_tokens:1300,temperature:0.35})},14000);
      const txt=chatContent(d); if(r.ok&&txt) return txt; throw new Error(`${model} failed`);
    })());
    try { return await Promise.any(fallbacks); } catch {}
  }
  throw new Error("AI_TEMPORARILY_UNAVAILABLE");
}
function friendlyError(e:unknown) {
  const m=String((e as Error)?.message||e||"");
  if(/AI_TEMPORARILY_UNAVAILABLE|AbortError|aborted|timed out|timeout/i.test(m)) return "Tivals AI is taking longer than expected. Please try again in a moment.";
  return m || "Something went wrong. Please try again.";
}

function learningTopic(text:string) {
  const m=String(text||"").trim().match(/^(?:teach\s+me|help\s+me\s+learn|learn)\s+(?:about\s+)?(.{2,50}?)[.!?]?$/i);
  return m?.[1]?.trim()||"";
}
async function sendLearningControls(chatId:number|string, topic:string, business?:string) {
  const safe=String(topic||"this topic").replace(/[\n\r|]/g," ").trim().slice(0,36)||"this topic";
  const p:any={chat_id:chatId,text:`📚 <b>Continue learning ${esc(safe)}</b>`,parse_mode:"HTML",reply_markup:{inline_keyboard:[
    [{text:"➡️ Next lesson",callback_data:`learn_next|${safe}`},{text:"📝 Try an exercise",callback_data:`learn_exercise|${safe}`}],
    [{text:"💡 Explain again",callback_data:`learn_explain|${safe}`},{text:"🏠 Main menu",callback_data:"learn_menu|"}]
  ]}};
  if(business) p.business_connection_id=business; await telegram("sendMessage",p);
}

async function oauthCall(action:string,tg:number,provider="",extra:Record<string,unknown>={}) {
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const r=await fetch(OAUTH_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},body:JSON.stringify({action,telegram_user_id:tg,provider,...extra})});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d?.error||`Account request failed (${r.status}).`); return d;
}
async function connectMenu(chatId:number|string,tg:number,business?:string) {
  const rows:any[][]=[];
  for(const [provider,label] of [["gmail","📧 Connect Gmail"],["github","🐙 Connect GitHub"]] as const){try{const d=await oauthCall("create_link",tg,provider);if(d?.url)rows.push([{text:label,url:d.url}]);}catch{}}
  if(!rows.length) return sendFormatted(chatId,"⚠️ Account connections are temporarily unavailable.",business);
  const p:any={chat_id:chatId,text:"🔐 <b>Connect accounts to Tivals AI</b>\n\nChoose an account to connect.",parse_mode:"HTML",reply_markup:{inline_keyboard:rows}};if(business)p.business_connection_id=business;await telegram("sendMessage",p);
}
function gmailIntent(text:string) {
  const t=text.trim();
  if(/^\/emails(?:\s|$)/i.test(t)||/^(?:check|show|read|get|see)\s+(?:my\s+)?(?:latest\s+|recent\s+)?emails?\b/i.test(t)) return {matched:true,query:"",title:"Latest emails"};
  if(/^\/unread(?:\s|$)/i.test(t)||/\bunread\s+emails?\b/i.test(t)) return {matched:true,query:"is:unread",title:"Unread emails"};
  const m=t.match(/(?:emails?|messages?)\s+from\s+(.+)$/i); if(m?.[1]) return {matched:true,query:`from:${m[1].trim()}`,title:`Emails from ${m[1].trim()}`};
  return {matched:false,query:"",title:""};
}
async function handleGmail(chatId:number|string,tg:number,intent:any,business?:string){
  const d=await oauthCall("gmail_messages",tg,"gmail",{query:intent.query,max_results:5}); const list=Array.isArray(d?.messages)?d.messages:[];
  if(!list.length) return sendHtml(chatId,`📧 <b>${esc(intent.title)}</b>\n\nNo matching emails found.`,business);
  const blocks=list.map((m:any,i:number)=>`<b>${i+1}. ${esc(String(m?.subject||"(No subject)"))}</b>\nFrom: ${esc(String(m?.from||"Unknown sender"))}${m?.snippet?`\n${esc(String(m.snippet).slice(0,220))}`:""}`);
  await sendHtml(chatId,`📧 <b>${esc(intent.title)}</b>\n\n${blocks.join("\n\n")}`,business);
}
function youtubeQuery(text:string){for(const p of [/^\s*search\s+(.+?)\s+on\s+youtube\s*[.!]?\s*$/i,/^\s*youtube\s+(?:search\s+)?(?:for\s+)?(.+?)\s*[.!]?\s*$/i]){const m=text.match(p);if(m?.[1])return m[1].trim();}return "";}
async function searchYouTube(query:string){const r=await fetch(YOUTUBE_SEARCH_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query,maxResults:5})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error("YouTube search failed.");return Array.isArray(d?.videos)?d.videos:[];}
function ytHtml(q:string,v:any[]){if(!v.length)return `🔎 No YouTube videos found for <b>${esc(q)}</b>.`;return `🔎 <b>YouTube results for “${esc(q)}”</b>\n\n`+v.map((x:any,i:number)=>`${i+1}. <b>${esc(String(x?.title||"Untitled"))}</b>${x?.url?`\n<a href="${esc(String(x.url))}">▶ Watch</a>`:""}`).join("\n\n");}
function imagePrompt(text:string){const m=text.match(/^\s*(?:create|generate|make|draw)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|illustration)\s+(?:of\s+)?(.+?)\s*[.!]?\s*$/i);return m?.[1]?.trim()||"";}
function findUrl(v:any):string{if(typeof v==="string"&&/^https?:\/\//i.test(v)&&!/\.mp4(?:\?|$)/i.test(v))return v;if(v&&typeof v==="object"){for(const x of Array.isArray(v)?v:Object.values(v)){const u=findUrl(x);if(u)return u;}}return "";}
async function generateImage(prompt:string){const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";const r=await fetch(PIXAZO_STUDIO_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`,apikey:key},body:JSON.stringify({type:"image",prompt})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error("Image generation failed.");const u=findUrl(d);if(!u)throw new Error("Image provider returned no image URL.");return u;}

Deno.serve(async(req:Request)=>{
  if(req.method==="GET"){
    const u=new URL(req.url);
    if(u.searchParams.get("sync")==="1"){
      try{await syncWebhook();return json({ok:true,webhook_synced:true,callback_buttons:true});}
      catch(e){return json({ok:false,error:friendlyError(e)},500);}
    }
    return json({ok:true,service:"Tivals AI Telegram webhook",version:19,callback_buttons:true,fast_fallback:true});
  }
  if(req.method!=="POST")return json({error:"Method not allowed."},405);
  const secret=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
  if(secret&&(req.headers.get("x-telegram-bot-api-secret-token")||"")!==secret)return json({error:"Unauthorized webhook."},401);
  let update:any;try{update=await req.json();}catch{return json({error:"Invalid Telegram update."},400);}
  if(update?.business_connection)return json({ok:true});

  const cb=update?.callback_query;
  if(cb?.message?.chat?.id&&String(cb?.data||"").startsWith("learn_")){
    const chatId=cb.message.chat.id;const [action,topicRaw=""]=String(cb.data).split("|");const topic=topicRaw.trim()||"this topic";
    await telegram("answerCallbackQuery",{callback_query_id:cb.id}).catch(()=>{});
    try{
      if(action==="learn_menu"){await sendFormatted(chatId,"🏠 **Tivals AI**\n\nAsk me anything, or say **Teach me Python**.");return json({ok:true,route:"learning-menu"});}
      await telegram("sendChatAction",{chat_id:chatId,action:"typing"}).catch(()=>{});
      const prompt=action==="learn_next"?`Teach the next focused lesson in ${topic}. Do not repeat the previous lesson. Include one short example and one practice task.`:action==="learn_exercise"?`Give one short beginner-friendly exercise about ${topic}. Do not reveal the answer immediately.`:`Explain ${topic} again in simpler language with one easy example.`;
      const answer=await askAI(prompt);await sendFormatted(chatId,answer);await sendLearningControls(chatId,topic);return json({ok:true,route:"learning-control"});
    }catch(e){await sendFormatted(chatId,`⚠️ ${friendlyError(e)}`).catch(()=>{});return json({ok:false},200);}
  }

  const bm=update?.business_message;
  // Ignore outgoing business messages created by this bot, otherwise Telegram
  // sends them back as business_message updates and the bot replies to itself.
  if(bm&&(bm?.sender_business_bot||bm?.via_bot||bm?.from?.is_bot))return json({ok:true,ignored:true,reason:"outgoing-business-message"});
  const message=bm||update?.message;const business=bm?.business_connection_id||undefined;
  const chatId=message?.chat?.id;const tg=Number(message?.from?.id||0);if(!chatId)return json({ok:true,ignored:true});
  const text=String(message?.text||"").trim();if(!text)return json({ok:true,ignored:true});
  try{
    if(text==="/start"||text.startsWith("/start ")){await sendFormatted(chatId,"👋 **Hi! I'm Tivals AI.**\n\nAsk me questions, learn a topic, check Gmail, search YouTube, or generate an image.",business);return json({ok:true});}
    if(text==="/help"){await sendFormatted(chatId,"**Tivals AI**\n\n/connect — Connect Gmail or GitHub\n/emails — Latest Gmail\n/unread — Unread Gmail\n\nYou can also say **Teach me Python** or **Search networking on YouTube**.",business);return json({ok:true});}
    if(text==="/connect"){if(!tg)throw new Error("Telegram user ID unavailable.");await connectMenu(chatId,tg,business);return json({ok:true});}
    if(text==="/accounts"){if(!tg)throw new Error("Telegram user ID unavailable.");const d=await oauthCall("status",tg);const list=Array.isArray(d?.connections)?d.connections:[];await sendFormatted(chatId,list.length?`**Connected accounts**\n\n${list.map((x:any)=>`• ${x.provider}: ${x.account_label||"Connected"}`).join("\n")}`:"**Connected accounts**\n\nNo accounts connected.",business);return json({ok:true});}
    await telegram("sendChatAction",{chat_id:chatId,action:"typing",...(business?{business_connection_id:business}:{})}).catch(()=>{});
    const gi=gmailIntent(text);if(gi.matched){if(!tg)throw new Error("Telegram user ID unavailable.");await handleGmail(chatId,tg,gi,business);return json({ok:true,route:"gmail"});}
    const yt=youtubeQuery(text);if(yt){await sendHtml(chatId,ytHtml(yt,await searchYouTube(yt)),business);return json({ok:true,route:"youtube"});}
    const img=imagePrompt(text);if(img){const url=await generateImage(img);const p:any={chat_id:chatId,photo:url,caption:`🎨 <b>Generated image</b>\n${esc(img.slice(0,500))}`,parse_mode:"HTML"};if(business)p.business_connection_id=business;await telegram("sendPhoto",p);return json({ok:true,route:"image"});}
    const topic=learningTopic(text);const answer=await askAI(text);await sendFormatted(chatId,answer,business);if(topic)await sendLearningControls(chatId,topic,business);return json({ok:true,route:"ai"});
  }catch(e){await sendFormatted(chatId,`⚠️ ${friendlyError(e)}`,business).catch(()=>{});return json({ok:false,error:String((e as Error)?.message||e)},200);}
});
