import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TELEGRAM_API = "https://api.telegram.org";
const TIVALS_AI_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat";
const YOUTUBE_SEARCH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/youtube-search";
const PIXAZO_STUDIO_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/pixazo-studio";
const OAUTH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/telegram-oauth";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const APPMIX_BASE = "https://api.apmix.ai/v1";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function esc(v: string) {
  return String(v || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function stripTags(v: string) {
  return String(v || "").replace(/<[^>]+>/g, "");
}

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

  // Normal fenced blocks: ```python ... ```
  raw = raw.replace(/```([a-zA-Z0-9_+.#-]*)\s*\n([\s\S]*?)```/g, (_m, lang, code) => addCodeBlock(lang, code));

  // Fenced blocks without a language label.
  raw = raw.replace(/```\s*\n?([\s\S]*?)```/g, (_m, code) => addCodeBlock("", code));

  // Recover a trailing unclosed fence so Telegram never shows literal ``` markers.
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

  codeBlocks.forEach((block, i) => {
    t = t.replace(`@@TIVALS_CODE_${i}@@`, block);
  });

  return t.trim();
}

function splitText(text: string, limit = 3500) {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let r = text;
  while (r.length > limit) {
    let c = r.lastIndexOf("\n\n", limit);
    if (c < 1800) c = r.lastIndexOf("\n", limit);
    if (c < 1800) c = r.lastIndexOf(" ", limit);
    if (c < 1800) c = limit;
    out.push(r.slice(0,c).trim());
    r = r.slice(c).trim();
  }
  if (r) out.push(r);
  return out;
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  const r = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.description || `Telegram ${method} failed (${r.status}).`);
  return d;
}

async function sendHtml(chatId: number|string, html: string, business?: string) {
  for (const part of splitText(html)) {
    const p: any = { chat_id: chatId, text: part, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (business) p.business_connection_id = business;
    try {
      await telegram("sendMessage", p);
    } catch {
      const q: any = { chat_id: chatId, text: stripTags(part) };
      if (business) q.business_connection_id = business;
      await telegram("sendMessage", q);
    }
  }
}

async function sendFormatted(chatId: number|string, text: string, business?: string) {
  return sendHtml(chatId, mdToHtml(text), business);
}

async function oauthCall(action: string, tg: number, provider = "", extra: Record<string, unknown> = {}) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const r = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ action, telegram_user_id: tg, provider, ...extra })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Account request failed (${r.status}).`);
  return d;
}

async function connectMenu(chatId: number|string, tg: number, business?: string) {
  const rows: any[][] = [];
  for (const [provider,label] of [["gmail","📧 Connect Gmail"],["github","🐙 Connect GitHub"]] as const) {
    try {
      const d = await oauthCall("create_link", tg, provider);
      if (d?.url) rows.push([{ text: label, url: d.url }]);
    } catch {}
  }
  if (!rows.length) return sendFormatted(chatId, "⚠️ Account connections are temporarily unavailable.", business);
  const p: any = {
    chat_id: chatId,
    text: "🔐 <b>Connect accounts to Tivals AI</b>\n\nEach connection is private to your Telegram account. You can disconnect it at any time.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows }
  };
  if (business) p.business_connection_id = business;
  await telegram("sendMessage", p);
}

async function accountStatus(chatId: number|string, tg: number, business?: string) {
  const d = await oauthCall("status", tg);
  const list = Array.isArray(d?.connections) ? d.connections : [];
  if (!list.length) return sendFormatted(chatId, "**Connected accounts**\n\nNo Gmail or GitHub account is connected yet. Use /connect.", business);
  const lines = list.map((x:any) => `• ${x.provider === "gmail" ? "📧 Gmail" : "🐙 GitHub"}: **${x.account_label || "Connected"}**`);
  return sendFormatted(chatId, `**Connected accounts**\n\n${lines.join("\n")}\n\nDisconnect with /disconnect_gmail or /disconnect_github.`, business);
}

function gmailIntent(text: string): { matched: boolean; query: string; title: string } {
  const t = text.trim();
  if (/^\/emails(?:\s|$)/i.test(t) || /^(?:check|show|read|get|see)\s+(?:my\s+)?(?:latest\s+|recent\s+)?emails?\b/i.test(t) || /^(?:any|do i have)\s+(?:new\s+)?emails?\b/i.test(t)) return { matched: true, query: "", title: "Latest emails" };
  if (/^\/unread(?:\s|$)/i.test(t) || /\bunread\s+emails?\b/i.test(t) || /\bnew\s+emails?\b/i.test(t)) return { matched: true, query: "is:unread", title: "Unread emails" };
  let m = t.match(/(?:emails?|messages?)\s+from\s+(.+)$/i) || t.match(/(?:find|show|check)\s+(?:my\s+)?emails?\s+from\s+(.+)$/i);
  if (m?.[1]) return { matched: true, query: `from:${m[1].trim()}`, title: `Emails from ${m[1].trim()}` };
  m = t.match(/(?:find|search|look for)\s+(?:my\s+)?emails?\s+(?:for|about|with)\s+(.+)$/i);
  if (m?.[1]) return { matched: true, query: m[1].trim(), title: `Email search: ${m[1].trim()}` };
  if (/\b(?:in|from)\s+my\s+(?:gmail|email|inbox)\b/i.test(t) && /\b(?:find|search|check|show|read)\b/i.test(t)) return {
    matched: true,
    query: t.replace(/\b(?:find|search|check|show|read)\b/ig, "").replace(/\b(?:in|from)\s+my\s+(?:gmail|email|inbox)\b/ig, "").trim(),
    title: "Email search"
  };
  return { matched: false, query: "", title: "" };
}

function cleanFrom(v: string) {
  return String(v || "Unknown sender").replace(/<([^>]+)>/g, "<$1>").trim();
}

function formatEmails(data: any, title: string) {
  const list = Array.isArray(data?.messages) ? data.messages : [];
  const account = data?.account ? `\n📮 <b>${esc(String(data.account))}</b>` : "";
  if (!list.length) return `📧 <b>${esc(title)}</b>${account}\n\nNo matching emails found.`;
  const blocks = list.map((m:any,i:number) => {
    const unread = Array.isArray(m?.label_ids) && m.label_ids.includes("UNREAD") ? "🔵 " : "";
    const snip = String(m?.snippet || "").slice(0, 260);
    return `<b>${i+1}. ${unread}${esc(String(m?.subject || "(No subject)"))}</b>\nFrom: ${esc(cleanFrom(m?.from))}${m?.date ? `\nDate: ${esc(String(m.date))}` : ""}${snip ? `\n${esc(snip)}` : ""}`;
  });
  return `📧 <b>${esc(title)}</b>${account}\n\n${blocks.join("\n\n")}\n\n<i>Use “unread emails”, “emails from NAME”, or “search my emails for WORDS” to narrow the results.</i>`;
}

async function handleGmail(chatId: number|string, tg: number, intent: {query:string;title:string}, business?: string) {
  const d = await oauthCall("gmail_messages", tg, "gmail", { query: intent.query, max_results: 5 });
  await sendHtml(chatId, formatEmails(d, intent.title), business);
}

async function askTivalsAI(message: string) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(TIVALS_AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "tivals-ai", messages: [{ role: "user", content: message }] }),
      signal: c.signal
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.reply) throw new Error(d?.error || `Tivals AI failed (${r.status}).`);
    return String(d.reply);
  } finally {
    clearTimeout(timer);
  }
}

function youtubeQuery(text: string) {
  for (const p of [
    /^\s*search\s+(.+?)\s+on\s+youtube\s*[.!]?\s*$/i,
    /^\s*youtube\s+(?:search\s+)?(?:for\s+)?(.+?)\s*[.!]?\s*$/i,
    /^\s*find\s+(.+?)\s+on\s+youtube\s*[.!]?\s*$/i
  ]) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

async function searchYouTube(query: string) {
  const r = await fetch(YOUTUBE_SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, maxResults: 6 })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.details || d?.error || "YouTube search failed.");
  return Array.isArray(d?.videos) ? d.videos : [];
}

function ytHtml(q: string, videos: any[]) {
  if (!videos.length) return `🔎 No YouTube videos found for <b>${esc(q)}</b>.`;
  return `🔎 <b>YouTube results for “${esc(q)}”</b>\n\n` + videos.slice(0,6).map((x:any,i:number) => `${i+1}. <b>${esc(String(x?.title || "Untitled"))}</b>\n${esc(String(x?.channelTitle || ""))}${x?.url ? `\n<a href="${esc(String(x.url))}">▶ Watch on YouTube</a>` : ""}`).join("\n\n");
}

function imagePrompt(text: string) {
  for (const p of [
    /^\s*(?:create|generate|make|draw)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|illustration)\s+(?:of\s+)?(.+?)\s*[.!]?\s*$/i,
    /^\s*(?:create|generate|make|draw)\s+(.+?)\s+(?:image|picture|photo|artwork|illustration)\s*[.!]?\s*$/i,
    /^\s*image\s+(?:of\s+)?(.+?)\s*[.!]?\s*$/i
  ]) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function findImageUrl(value: any): string {
  const seen = new Set<any>();
  const visit = (v:any):string => {
    if (v == null) return "";
    if (typeof v === "string") return /^https?:\/\//i.test(v) && !/\.mp4(?:\?|$)/i.test(v) ? v : "";
    if (typeof v !== "object" || seen.has(v)) return "";
    seen.add(v);
    for (const k of ["url","image","imageUrl","image_url","output","media","data","images","result","results"]) {
      if (k in v) {
        const f = visit(v[k]);
        if (f) return f;
      }
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      const f = visit(x);
      if (f) return f;
    }
    return "";
  };
  return visit(value);
}

async function generateImage(prompt: string) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const r = await fetch(PIXAZO_STUDIO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ type: "image", prompt })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Image generation failed.");
  const u = findImageUrl(d);
  if (!u) throw new Error("Image provider returned no image URL.");
  return u;
}

async function sendPhoto(chatId:number|string, url:string, prompt:string, business?:string) {
  const p:any = {
    chat_id: chatId,
    photo: url,
    caption: `🎨 <b>Generated image</b>\n${esc(prompt.slice(0,700))}`,
    parse_mode: "HTML"
  };
  if (business) p.business_connection_id = business;
  await telegram("sendPhoto", p);
}

function bytesToB64(bytes: Uint8Array) {
  let s="";
  for(let i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return btoa(s);
}

async function telegramImageDataUrl(fileId:string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const info = await telegram("getFile", { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) throw new Error("Telegram did not return the image path.");
  const r = await fetch(`${TELEGRAM_API}/file/bot${token}/${path}`);
  if (!r.ok) throw new Error("Could not download the Telegram image.");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > 8*1024*1024) throw new Error("Image is too large.");
  const type = r.headers.get("content-type") || "image/jpeg";
  return `data:${type};base64,${bytesToB64(bytes)}`;
}

function visionText(d:any) {
  const c=d?.choices?.[0]?.message?.content;
  if(typeof c==="string") return c.trim();
  if(Array.isArray(c)) return c.map((x:any)=>typeof x==="string"?x:x?.text||"").join("").trim();
  return "";
}

async function analyzeImage(dataUrl:string, question:string) {
  const open = Deno.env.get("OPENROUTER_API_KEY") || "";
  if (open) {
    try {
      const r=await fetch(`${OPENROUTER_BASE}/chat/completions`,{
        method:"POST",
        headers:{Authorization:`Bearer ${open}`,"Content-Type":"application/json","HTTP-Referer":"https://ai.tivalsdeveloper.site/","X-OpenRouter-Title":"Tivals AI"},
        body:JSON.stringify({model:"openrouter/free",messages:[{role:"user",content:[{type:"text",text:question||"Describe this image and explain important visible text or details."},{type:"image_url",image_url:{url:dataUrl}}]}],max_tokens:1400,temperature:0.2})
      });
      const d=await r.json().catch(()=>({}));
      const txt=visionText(d);
      if(r.ok&&txt) return txt;
    } catch {}
  }

  const app=Deno.env.get("APPMIX_API_KEY")||"";
  if(!app) throw new Error("Vision is temporarily unavailable.");
  for(const model of ["openai/gpt-4.1-free","google/gemini-3-flash-preview-free"]) {
    try {
      const r=await fetch(`${APPMIX_BASE}/chat/completions`,{
        method:"POST",
        headers:{Authorization:`Bearer ${app}`,"Content-Type":"application/json"},
        body:JSON.stringify({model,messages:[{role:"user",content:[{type:"text",text:question||"Describe this image and explain important visible text or details."},{type:"image_url",image_url:{url:dataUrl}}]}],max_tokens:1200,temperature:0.2})
      });
      const d=await r.json().catch(()=>({}));
      const txt=visionText(d);
      if(r.ok&&txt) return txt;
    } catch {}
  }
  throw new Error("Vision is temporarily unavailable.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return json({ ok: true, service: "Tivals AI Telegram webhook", gmail_reading: true, image_reading: true, oauth: true, formatting: "html-code-blocks" });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  if (secret && (req.headers.get("x-telegram-bot-api-secret-token") || "") !== secret) return json({ error: "Unauthorized webhook." }, 401);

  let update:any;
  try {
    update = await req.json();
  } catch {
    return json({ error: "Invalid Telegram update." }, 400);
  }

  if (update?.business_connection) return json({ ok: true });
  const bm = update?.business_message;
  const message = bm || update?.message;
  const business = bm?.business_connection_id || undefined;
  const chatId = message?.chat?.id;
  const tg = Number(message?.from?.id || 0);
  if (!chatId) return json({ ok: true, ignored: true });

  const text = String(message?.text || "").trim();
  const caption = String(message?.caption || "").trim();
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const doc = message?.document && /^image\//i.test(String(message.document?.mime_type || "")) ? message.document : null;

  try {
    if (photos.length || doc) {
      const fileId = doc?.file_id || photos[photos.length-1]?.file_id;
      await telegram("sendChatAction", { chat_id: chatId, action: "typing", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});
      const reply = await analyzeImage(await telegramImageDataUrl(fileId), caption);
      await sendFormatted(chatId, reply, business);
      return json({ ok:true, route:"vision" });
    }

    if (!text) return json({ ok:true, ignored:true });

    if (text === "/start" || text.startsWith("/start ")) {
      await sendFormatted(chatId, "👋 **Hi! I'm Tivals AI.**\n\nAsk questions, check Gmail, search YouTube, generate images, analyze photos, or connect Gmail and GitHub with /connect.", business);
      return json({ok:true});
    }

    if (text === "/help") {
      await sendFormatted(chatId, "**Tivals AI**\n\n/connect — Connect Gmail or GitHub\n/accounts — Show connected accounts\n/emails — Show latest Gmail messages\n/unread — Show unread Gmail messages\n/disconnect_gmail — Disconnect Gmail\n/disconnect_github — Disconnect GitHub\n\nYou can also say “check my emails”, “emails from SPU”, or “search my emails for application”.", business);
      return json({ok:true});
    }

    if (text === "/connect") {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      await connectMenu(chatId,tg,business);
      return json({ok:true,route:"connect"});
    }

    if (text === "/accounts") {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      await accountStatus(chatId,tg,business);
      return json({ok:true,route:"accounts"});
    }

    if (text === "/disconnect_gmail" || text === "/disconnect_github") {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      const provider = text.endsWith("gmail") ? "gmail" : "github";
      await oauthCall("disconnect",tg,provider);
      await sendFormatted(chatId,`✅ ${provider === "gmail" ? "Gmail" : "GitHub"} disconnected.`,business);
      return json({ok:true,route:"disconnect"});
    }

    await telegram("sendChatAction", { chat_id: chatId, action: "typing", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});

    const gi = gmailIntent(text);
    if (gi.matched) {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      await handleGmail(chatId,tg,gi,business);
      return json({ok:true,route:"gmail"});
    }

    const yt = youtubeQuery(text);
    if (yt) {
      await sendHtml(chatId,ytHtml(yt,await searchYouTube(yt)),business);
      return json({ok:true,route:"youtube"});
    }

    const img = imagePrompt(text);
    if (img) {
      await telegram("sendChatAction", { chat_id: chatId, action: "upload_photo", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});
      await sendPhoto(chatId,await generateImage(img),img,business);
      return json({ok:true,route:"image-generation"});
    }

    await sendFormatted(chatId,await askTivalsAI(text),business);
    return json({ok:true,route:"ai"});
  } catch (e) {
    const m = String((e as Error)?.message || e);
    await sendFormatted(chatId, `⚠️ ${m}`, business).catch(()=>{});
    console.error("Tivals Telegram error", m);
    return json({ok:false,error:m},200);
  }
});
