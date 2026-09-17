import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TELEGRAM_API = "https://api.telegram.org";
const TIVALS_AI_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat";
const YOUTUBE_SEARCH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/youtube-search";
const PIXAZO_STUDIO_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/pixazo-studio";
const OAUTH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/telegram-oauth";
const PUBLIC_WEBHOOK_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-telegram";
const VERSION = 23;

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

  raw = raw.replace(/```(?:[a-zA-Z0-9_+.#-]+)?\s*\n?([\s\S]+)$/g, (_m, code) => {
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
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < 1200) cut = rest.lastIndexOf("\n", limit);
    if (cut < 1200) cut = rest.lastIndexOf(" ", limit);
    if (cut < 1200) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
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

async function sendHtml(chatId: number|string, html: string) {
  for (const part of splitText(html)) {
    const p: any = {
      chat_id: chatId,
      text: part,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true }
    };
    try {
      await telegram("sendMessage", p);
    } catch {
      await telegram("sendMessage", { chat_id: chatId, text: stripTags(part) });
    }
  }
}
async function sendFormatted(chatId: number|string, text: string) {
  return sendHtml(chatId, mdToHtml(text));
}

async function syncWebhook() {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  const payload: any = {
    url: PUBLIC_WEBHOOK_URL,
    allowed_updates: ["message"],
    drop_pending_updates: false
  };
  if (secret) payload.secret_token = secret;
  return telegram("setWebhook", payload);
}

const TELEGRAM_STYLE =
  "Reply for Telegram on a small phone screen. Be concise. Use short sections, Markdown bold/headings and fenced code blocks when needed. Never output horizontal rules such as --- or ***. If the user asks to learn a broad topic, teach one focused lesson at a time and end with one short practice task. For cybersecurity topics, keep examples within authorized labs or systems the user owns or has permission to test.";

async function fetchJson(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    const d = await r.json().catch(() => ({}));
    return { r, d };
  } finally {
    clearTimeout(timer);
  }
}

async function askAI(message: string) {
  const messages = [
    { role: "system", content: TELEGRAM_STYLE },
    { role: "user", content: message }
  ];
  try {
    const { r, d } = await fetchJson(TIVALS_AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "tivals-ai", messages })
    }, 26000);

    if (r.ok && d?.reply) return String(d.reply);
    throw new Error(d?.error || `Tivals AI failed (${r.status}).`);
  } catch (e) {
    const raw = String((e as Error)?.name || "") + " " + String((e as Error)?.message || e || "");
    if (/AbortError|aborted|timeout|timed out/i.test(raw)) throw new Error("AI_TEMPORARILY_UNAVAILABLE");
    throw e;
  }
}

function instantReply(text: string) {
  const t = text.trim().toLowerCase();
  if (/^(hi|hello|hey|hello there|good morning|good afternoon|good evening)[!. ]*$/.test(t)) {
    return "👋 Hi! How can I help you today?";
  }
  if (/^(topic|topics|learn|study)[!. ]*$/.test(t)) {
    return "📚 What topic would you like to learn?\n\nFor example: **Python**, **English**, **Cybersecurity**, **Mathematics**, or **Web development**.";
  }
  return "";
}

function friendlyError(e: unknown) {
  const m = String((e as Error)?.message || e || "");
  if (/AI_TEMPORARILY_UNAVAILABLE|AbortError|aborted|timed out|timeout|temporarily unavailable|all configured ai providers/i.test(m)) {
    return "Tivals AI is temporarily unavailable. Please try again shortly.";
  }
  return m || "Something went wrong. Please try again.";
}

async function oauthCall(action: string, tg: number, provider = "", extra: Record<string,unknown> = {}) {
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

async function connectMenu(chatId: number|string, tg: number) {
  const rows: any[][] = [];
  for (const [provider, label] of [["gmail","📧 Connect Gmail"],["github","🐙 Connect GitHub"]] as const) {
    try {
      const d = await oauthCall("create_link", tg, provider);
      if (d?.url) rows.push([{ text: label, url: d.url }]);
    } catch {}
  }
  if (!rows.length) return sendFormatted(chatId, "⚠️ Account connections are temporarily unavailable.");
  await telegram("sendMessage", {
    chat_id: chatId,
    text: "🔐 <b>Connect accounts to Tivals AI</b>\n\nChoose an account to connect.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows }
  });
}

function gmailIntent(text: string) {
  const t = text.trim();
  if (/^\/emails(?:\s|$)/i.test(t) || /^(?:check|show|read|get|see)\s+(?:my\s+)?(?:latest\s+|recent\s+)?emails?\b/i.test(t)) {
    return { matched: true, query: "", title: "Latest emails" };
  }
  if (/^\/unread(?:\s|$)/i.test(t) || /\bunread\s+emails?\b/i.test(t)) {
    return { matched: true, query: "is:unread", title: "Unread emails" };
  }
  const m = t.match(/(?:emails?|messages?)\s+from\s+(.+)$/i);
  if (m?.[1]) return { matched: true, query: `from:${m[1].trim()}`, title: `Emails from ${m[1].trim()}` };
  return { matched: false, query: "", title: "" };
}

async function handleGmail(chatId: number|string, tg: number, intent: any) {
  const d = await oauthCall("gmail_messages", tg, "gmail", { query: intent.query, max_results: 5 });
  const list = Array.isArray(d?.messages) ? d.messages : [];
  if (!list.length) return sendHtml(chatId, `📧 <b>${esc(intent.title)}</b>\n\nNo matching emails found.`);
  const blocks = list.map((m:any, i:number) =>
    `<b>${i+1}. ${esc(String(m?.subject || "(No subject)"))}</b>\nFrom: ${esc(String(m?.from || "Unknown sender"))}${m?.snippet ? `\n${esc(String(m.snippet).slice(0,220))}` : ""}`
  );
  await sendHtml(chatId, `📧 <b>${esc(intent.title)}</b>\n\n${blocks.join("\n\n")}`);
}

function youtubeQuery(text: string) {
  for (const p of [
    /^\s*search\s+(.+?)\s+on\s+youtube\s*[.!]?\s*$/i,
    /^\s*youtube\s+(?:search\s+)?(?:for\s+)?(.+?)\s*[.!]?\s*$/i
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
    body: JSON.stringify({ query, maxResults: 5 })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("YouTube search failed.");
  return Array.isArray(d?.videos) ? d.videos : [];
}

function ytHtml(q: string, v: any[]) {
  if (!v.length) return `🔎 No YouTube videos found for <b>${esc(q)}</b>.`;
  return `🔎 <b>YouTube results for “${esc(q)}”</b>\n\n` +
    v.map((x:any, i:number) =>
      `${i+1}. <b>${esc(String(x?.title || "Untitled"))}</b>${x?.url ? `\n<a href="${esc(String(x.url))}">▶ Watch</a>` : ""}`
    ).join("\n\n");
}

function imagePrompt(text: string) {
  const m = text.match(/^\s*(?:create|generate|make|draw)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|illustration)\s+(?:of\s+)?(.+?)\s*[.!]?\s*$/i);
  return m?.[1]?.trim() || "";
}

function findUrl(v: any): string {
  if (typeof v === "string" && /^https?:\/\//i.test(v) && !/\.mp4(?:\?|$)/i.test(v)) return v;
  if (v && typeof v === "object") {
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      const u = findUrl(x);
      if (u) return u;
    }
  }
  return "";
}

async function generateImage(prompt: string) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const r = await fetch(PIXAZO_STUDIO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ type: "image", prompt })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Image generation failed.");
  const u = findUrl(d);
  if (!u) throw new Error("Image provider returned no image URL.");
  return u;
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("sync") === "1") {
      try {
        await syncWebhook();
        return json({ ok: true, webhook_synced: true, allowed_updates: ["message"], callback_buttons: false });
      } catch (e) {
        return json({ ok: false, error: friendlyError(e) }, 500);
      }
    }
    return json({
      ok: true,
      service: "Tivals AI Telegram webhook",
      version: VERSION,
      callback_buttons: false,
      business_messages: false,
      ai_route: "tivals-ai-chat-only"
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  if (secret && (req.headers.get("x-telegram-bot-api-secret-token") || "") !== secret) {
    return json({ error: "Unauthorized webhook." }, 401);
  }

  let update: any;
  try { update = await req.json(); }
  catch { return json({ error: "Invalid Telegram update." }, 400); }

  if (update?.business_connection || update?.business_message || update?.callback_query) {
    return json({ ok: true, ignored: true });
  }

  const message = update?.message;
  const chatId = message?.chat?.id;
  const tg = Number(message?.from?.id || 0);
  if (!chatId) return json({ ok: true, ignored: true });

  const text = String(message?.text || "").trim();
  if (!text) return json({ ok: true, ignored: true });

  try {
    if (text === "/start" || text.startsWith("/start ")) {
      await sendFormatted(chatId, "👋 **Hi! I'm Tivals AI.**\n\nAsk me questions, learn a topic, check Gmail, search YouTube, or generate an image.");
      return json({ ok: true });
    }

    if (text === "/help") {
      await sendFormatted(chatId, "**Tivals AI**\n\n/connect — Connect Gmail or GitHub\n/emails — Latest Gmail\n/unread — Unread Gmail\n/channel @channel Your message — Post to a channel you administer\n\nYou can also say **Teach me Python** or **Search networking on YouTube**.");
      return json({ ok: true });
    }

    if (text === "/connect") {
      if (!tg) throw new Error("Telegram user ID unavailable.");
      await connectMenu(chatId, tg);
      return json({ ok: true });
    }

    if (text === "/accounts") {
      if (!tg) throw new Error("Telegram user ID unavailable.");
      const d = await oauthCall("status", tg);
      const list = Array.isArray(d?.connections) ? d.connections : [];
      await sendFormatted(
        chatId,
        list.length
          ? `**Connected accounts**\n\n${list.map((x:any) => `• ${x.provider}: ${x.account_label || "Connected"}`).join("\n")}`
          : "**Connected accounts**\n\nNo accounts connected."
      );
      return json({ ok: true });
    }

    const quick = instantReply(text);
    if (quick) {
      await sendFormatted(chatId, quick);
      return json({ ok: true, route: "instant" });
    }

    if (/^\/channel(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (message?.chat?.type !== "private") {
        await sendFormatted(chatId, "⚠️ Use /channel from a private chat with me.");
        return json({ ok: false, route: "channel-post" });
      }
      if (!tg) throw new Error("Telegram user ID unavailable.");

      const m = text.match(/^\/channel(?:@\w+)?\s+(@[A-Za-z0-9_]{5,}|-100\d+)\s+([\s\S]+)$/i);
      if (!m) {
        await sendFormatted(chatId, "**Channel posting**\n\nUse: `/channel @channelusername Your message`\n\nFirst add me to the channel as an administrator with permission to post messages.");
        return json({ ok: false, route: "channel-post-help" });
      }

      const target = m[1];
      const channelText = m[2].trim();
      const member = await telegram("getChatMember", { chat_id: target, user_id: tg });
      const status = String(member?.result?.status || "");
      if (!["creator", "administrator"].includes(status)) {
        await sendFormatted(chatId, "⚠️ You must be an administrator of that channel before you can post through Tivals AI.");
        return json({ ok: false, route: "channel-post-denied" });
      }

      try {
        await sendFormatted(target, channelText);
        await sendFormatted(chatId, `✅ Posted to **${target}**.`);
        return json({ ok: true, route: "channel-post" });
      } catch (e) {
        const msg = String((e as Error)?.message || e || "");
        if (/not enough rights|CHAT_ADMIN_REQUIRED|forbidden|not found/i.test(msg)) {
          await sendFormatted(chatId, "⚠️ I couldn't post there. Add Tivals AI to the channel as an administrator and enable **Post Messages**, then try again.");
          return json({ ok: false, route: "channel-post-permission" });
        }
        throw e;
      }
    }

    await telegram("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

    const gi = gmailIntent(text);
    if (gi.matched) {
      if (!tg) throw new Error("Telegram user ID unavailable.");
      await handleGmail(chatId, tg, gi);
      return json({ ok: true, route: "gmail" });
    }

    const yt = youtubeQuery(text);
    if (yt) {
      await sendHtml(chatId, ytHtml(yt, await searchYouTube(yt)));
      return json({ ok: true, route: "youtube" });
    }

    const img = imagePrompt(text);
    if (img) {
      const url = await generateImage(img);
      await telegram("sendPhoto", {
        chat_id: chatId,
        photo: url,
        caption: `🎨 <b>Generated image</b>\n${esc(img.slice(0,500))}`,
        parse_mode: "HTML"
      });
      return json({ ok: true, route: "image" });
    }

    const answer = await askAI(text);
    await sendFormatted(chatId, answer);
    return json({ ok: true, route: "ai" });
  } catch (e) {
    await sendFormatted(chatId, `⚠️ ${friendlyError(e)}`).catch(() => {});
    return json({ ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});