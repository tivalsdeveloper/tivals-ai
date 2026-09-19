import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TELEGRAM_API = "https://api.telegram.org";
const TIVALS_AI_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat";
const YOUTUBE_SEARCH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/youtube-search";
const PIXAZO_STUDIO_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/pixazo-studio";
const OAUTH_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/telegram-oauth";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const APPMIX_BASE = "https://api.apmix.ai/v1";
const TELEGRAM_APP_URL = "https://ai.tivalsdeveloper.site/telegram-app.html";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const SUBSCRIPTION_PERIOD = 2592000;
const PLAN_CONFIG = {
  free:  { label: "Free",  stars: 0,   ai: 20,   images: 1 },
  basic: { label: "Basic", stars: 100, ai: 200,  images: 10 },
  pro:   { label: "Pro",   stars: 250, ai: 1000, images: 50 }
} as const;


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

type PlanName = "free" | "basic" | "pro";

async function isOwnerAccount(tg:number) {
  const {data,error}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();
  if(error) throw error;
  return Boolean(data);
}

async function subscriptionState(tg: number) {
  const { data, error } = await sb.from("telegram_subscriptions")
    .select("plan,status,stars_amount,is_recurring,telegram_payment_charge_id,subscription_expiration_date,updated_at")
    .eq("telegram_user_id", tg).maybeSingle();
  if (error) throw error;
  if (!data) return { plan: "free" as PlanName, active: false, row: null };
  const expires = new Date(data.subscription_expiration_date).getTime();
  const active = data.status === "active" && expires > Date.now();
  if (!active && data.status === "active") {
    await sb.from("telegram_subscriptions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("telegram_user_id", tg);
  }
  return { plan: active ? data.plan as PlanName : "free" as PlanName, active, row: data };
}

async function todayUsage(tg: number) {
  const today = new Date().toISOString().slice(0,10);
  const { data, error } = await sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id", tg).eq("usage_date", today).maybeSingle();
  if (error) throw error;
  return { today, ai: Number(data?.ai_messages || 0), images: Number(data?.image_generations || 0) };
}

async function consumeUsage(tg: number, kind: "ai" | "image") {
  if (await isOwnerAccount(tg)) return { ok:true, plan:"pro" as PlanName, used:0, limit:Number.MAX_SAFE_INTEGER, owner:true, unlimited:true };
  const sub = await subscriptionState(tg);
  const cfg = PLAN_CONFIG[sub.plan];
  const usage = await todayUsage(tg);
  const used = kind === "ai" ? usage.ai : usage.images;
  const limit = kind === "ai" ? cfg.ai : cfg.images;
  if (used >= limit) return { ok:false, plan:sub.plan, used, limit };
  const { error } = await sb.from("telegram_daily_usage").upsert({
    telegram_user_id: tg, usage_date: usage.today,
    ai_messages: kind === "ai" ? usage.ai + 1 : usage.ai,
    image_generations: kind === "image" ? usage.images + 1 : usage.images,
    updated_at: new Date().toISOString()
  }, { onConflict: "telegram_user_id,usage_date" });
  if (error) throw error;
  return { ok:true, plan:sub.plan, used:used+1, limit };
}

async function createSubscriptionLink(plan: "basic" | "pro") {
  const cfg = PLAN_CONFIG[plan];
  const d = await telegram("createInvoiceLink", {
    title: "Tivals AI " + cfg.label,
    description: cfg.label + " plan for Tivals AI — renews every 30 days until cancelled.",
    payload: "tivals-sub:" + plan,
    currency: "XTR",
    prices: [{ label: cfg.label + " monthly subscription", amount: cfg.stars }],
    subscription_period: SUBSCRIPTION_PERIOD
  });
  const url = d?.result;
  if (!url) throw new Error("Telegram did not return a subscription link.");
  return url;
}

async function subscriptionMenu(chatId: number|string, business?: string) {
  const [basic, pro] = await Promise.all([createSubscriptionLink("basic"), createSubscriptionLink("pro")]);
  const p:any = {
    chat_id: chatId,
    text: "⭐ <b>Tivals AI subscriptions</b>\n\nFree — 20 AI messages/day, 1 image/day\nBasic — 100 ⭐/month, 200 AI messages/day, 10 images/day\nPro — 250 ⭐/month, 1000 AI messages/day, 50 images/day\n\nSubscriptions renew every 30 days through Telegram Stars.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [{ text: "⭐ Basic — 100 Stars/month", url: basic }],
      [{ text: "🚀 Pro — 250 Stars/month", url: pro }]
    ] }
  };
  if (business) p.business_connection_id = business;
  await telegram("sendMessage", p);
}

async function planStatus(chatId: number|string, tg: number, business?: string) {
  if (await isOwnerAccount(tg)) {
    await sendFormatted(chatId, "👑 **Owner account**\n\n**Plan:** Owner\n**AI usage:** Unlimited\n**Images:** Unlimited\n**Bot connector:** Included\n\nYou do not need to buy a Tivals AI subscription.", business);
    return;
  }
  const sub = await subscriptionState(tg);
  const usage = await todayUsage(tg);
  const cfg = PLAN_CONFIG[sub.plan];
  const expires = sub.active && sub.row?.subscription_expiration_date ? new Date(sub.row.subscription_expiration_date).toLocaleString("en-ZA", { timeZone:"Africa/Johannesburg" }) : "";
  const lines = ["⭐ **Your Tivals AI plan**", "", "**Plan:** " + cfg.label, "**AI usage today:** " + usage.ai + "/" + cfg.ai, "**Images today:** " + usage.images + "/" + cfg.images];
  if (expires) lines.push("**Renews / access valid until:** " + expires);
  lines.push("", sub.active ? "Use /subscribe to change or renew your plan." : "Use /subscribe to upgrade with Telegram Stars.");
  await sendFormatted(chatId, lines.join("\n"), business);
}

async function recordSuccessfulPayment(tg: number, payment: any) {
  if (!tg || payment?.currency !== "XTR") throw new Error("Invalid Telegram Stars payment.");
  const payload = String(payment?.invoice_payload || "");
  const m = payload.match(/^tivals-sub:(basic|pro)$/);
  if (!m) throw new Error("Unknown subscription payment.");
  const plan = m[1] as "basic" | "pro";
  const cfg = PLAN_CONFIG[plan];
  if (Number(payment?.total_amount || 0) !== cfg.stars) throw new Error("Subscription amount does not match the selected plan.");
  const chargeId = String(payment?.telegram_payment_charge_id || "");
  if (!chargeId) throw new Error("Telegram payment charge ID is missing.");
  const expSeconds = Number(payment?.subscription_expiration_date || 0);
  const expiresAt = new Date(expSeconds > 0 ? expSeconds * 1000 : Date.now() + SUBSCRIPTION_PERIOD * 1000).toISOString();
  const { error: payError } = await sb.from("telegram_subscription_payments").upsert({
    telegram_payment_charge_id: chargeId, telegram_user_id: tg, plan, currency: "XTR", total_amount: cfg.stars,
    is_recurring: Boolean(payment?.is_recurring), is_first_recurring: Boolean(payment?.is_first_recurring), subscription_expiration_date: expiresAt
  }, { onConflict: "telegram_payment_charge_id" });
  if (payError) throw payError;
  const { error } = await sb.from("telegram_subscriptions").upsert({
    telegram_user_id: tg, plan, status: "active", stars_amount: cfg.stars, is_recurring: Boolean(payment?.is_recurring),
    telegram_payment_charge_id: chargeId, subscription_expiration_date: expiresAt, updated_at: new Date().toISOString()
  }, { onConflict: "telegram_user_id" });
  if (error) throw error;
  return { plan, expiresAt };
}

async function sendLimitReached(chatId: number|string, plan:PlanName, kind:"ai"|"image", business?:string) {
  const cfg = PLAN_CONFIG[plan];
  const limit = kind === "ai" ? cfg.ai : cfg.images;
  await sendFormatted(chatId, "⚠️ **Daily " + (kind === "ai" ? "AI message" : "image") + " limit reached**\n\nYour **" + cfg.label + "** plan limit is " + limit + " per day. Use /subscribe to upgrade.", business);
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

async function openMiniAppButton(chatId: number|string, business?: string) {
  const p:any = {
    chat_id: chatId,
    text: "📱 <b>Tivals AI App</b>\n\nOpen your dashboard to manage your plan, usage, connectors and bot settings.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Open Tivals AI App", web_app: { url: TELEGRAM_APP_URL } }]] }
  };
  if (business) p.business_connection_id = business;
  await telegram("sendMessage", p);
}

async function setMiniAppMenu(chatId: number|string) {
  try {
    await telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type:"web_app", text:"Tivals AI", web_app:{ url:TELEGRAM_APP_URL } }
    });
  } catch {}
}

async function telegramSettings(tg:number) {
  if (!tg) return { response_style:"balanced", notifications:true, tool_suggestions:true };
  const { data } = await sb.from("telegram_user_settings")
    .select("response_style,notifications,tool_suggestions")
    .eq("telegram_user_id",tg).maybeSingle();
  return data || { response_style:"balanced", notifications:true, tool_suggestions:true };
}

async function connectMenu(chatId: number|string, tg: number, business?: string) {
  const rows: any[][] = [];
  const failed: string[] = [];
  for (const [provider,label] of [["gmail","📧 Connect Gmail"],["github","🐙 Connect GitHub"],["tiktok","🎵 Connect TikTok"]] as const) {
    try {
      const d = await oauthCall("create_link", tg, provider);
      if (d?.url) rows.push([{ text: label, url: d.url }]);
      else failed.push(provider);
    } catch {
      failed.push(provider);
    }
  }
  try {
    const site = await oauthCall("create_website_link", tg);
    if (site?.url) rows.push([{ text: "🌐 Connect Tivals AI Website", url: site.url }]);
  } catch {
    failed.push("website");
  }
  if (!rows.length) return sendFormatted(chatId, "⚠️ Account connections are temporarily unavailable.", business);

  const providerName: Record<string,string> = { gmail: "Gmail", github: "GitHub", tiktok: "TikTok", website: "Tivals AI Website" };
  const unavailable = failed.length
    ? "\n\n⚠️ Temporarily unavailable: " + failed.map(x => providerName[x] || x).join(", ")
    : "";

  const p: any = {
    chat_id: chatId,
    text: "🔐 <b>Connect accounts to Tivals AI</b>\n\nEach connection is private to your Telegram account. You can disconnect it at any time." + unavailable,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows }
  };
  if (business) p.business_connection_id = business;
  await telegram("sendMessage", p);
}

async function accountStatus(chatId: number|string, tg: number, business?: string) {
  const d = await oauthCall("status", tg);
  const list = Array.isArray(d?.connections) ? d.connections : [];
  if (!list.length) return sendFormatted(chatId, "**Connected accounts**\n\nNo account is connected yet. Use /connect.", business);
  const lines = list.map((x:any) => { const label = x.provider === "gmail" ? "📧 Gmail" : x.provider === "github" ? "🐙 GitHub" : x.provider === "tiktok" ? "🎵 TikTok" : x.provider === "website" ? "🌐 Tivals AI Website" : String(x.provider || "Account"); return `• ${label}: **${x.account_label || "Connected"}**`; });
  return sendFormatted(chatId, `**Connected accounts**\n\n${lines.join("\n")}\n\nDisconnect with /disconnect_gmail, /disconnect_github, /disconnect_tiktok, or /disconnect_website.`, business);
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
type ToolRequest = { tool: string; request: string };

function parseToolRequest(text: string): ToolRequest | null {
  const m = String(text || "").trim().match(/^@([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { tool: String(m[1] || "").toLowerCase(), request: String(m[2] || "").trim() };
}

function toolsHelpText() {
  return [
    "**Choose a Tivals AI tool with @tool**",
    "",
    "• `@tiktok check my TikTok account`",
    "• `@tiktok show my stats`",
    "• `@tiktok show my latest videos`",
    "• `@gmail check my latest emails`",
    "• `@github check my GitHub account`",
    "• `@website check my website account`",
    "• `@youtube Python tutorial`",
    "• `@image futuristic AI robot`",
    "• `@ai explain recursion`",
    "",
    "Connect account tools first with /connect."
  ].join("\n");
}

function formatTikTokProfile(data: any) {
  const p = data?.profile || {};
  const st = data?.stats || {};
  const scope = String(data?.scope || "");
  const lines = [
    "🎵 **TikTok account**",
    "",
    "**Display name:** " + String(p.display_name || data?.account || "TikTok account"),
  ];
  if (p.open_id) lines.push("**Open ID:** " + String(p.open_id));
  if (st.follower_count != null || st.following_count != null || st.likes_count != null || st.video_count != null) {
    lines.push("", "**Statistics**");
    lines.push("• Followers: " + String(st.follower_count ?? "—"));
    lines.push("• Following: " + String(st.following_count ?? "—"));
    lines.push("• Likes: " + String(st.likes_count ?? "—"));
    lines.push("• Public videos: " + String(st.video_count ?? "—"));
  }
  lines.push("", "**Connected permission:** " + (scope || "user.info.basic"));
  return lines.join("\n");
}

function formatTikTokVideos(data: any) {
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  if (!videos.length) return "🎵 **TikTok videos**\n\nNo public videos were returned.";
  const blocks = videos.slice(0, 10).map((v:any, i:number) => {
    const title = String(v?.title || v?.video_description || ("Video " + (i + 1))).trim() || ("Video " + (i + 1));
    const duration = Number(v?.duration || 0);
    const link = String(v?.embed_link || "").trim();
    const lines = ["**" + (i + 1) + ". " + title + "**"];
    if (duration > 0) lines.push("Duration: " + duration + "s");
    if (link) lines.push(link);
    return lines.join("\n");
  });
  return "🎵 **Latest TikTok videos**\n\n" + blocks.join("\n\n");
}

async function handleToolRequest(chatId: number|string, tg: number, toolReq: ToolRequest, business?: string) {
  const tool = toolReq.tool;
  const request = toolReq.request;

  if (tool === "tools" || tool === "help") {
    await sendFormatted(chatId, toolsHelpText(), business);
    return "tools";
  }

  if (tool === "tiktok") {
    if (!tg) throw new Error("Telegram user ID is unavailable.");

    if (/\b(videos?|posts?|latest videos?|recent videos?)\b/i.test(request)) {
      const d = await oauthCall("tiktok_videos", tg, "tiktok", { max_results: 5 });
      await sendFormatted(chatId, formatTikTokVideos(d), business);
      return "tiktok-videos";
    }

    const d = await oauthCall("tiktok_profile", tg, "tiktok");
    const scope = String(d?.scope || "");
    if (/\b(followers?|following|likes?|statistics|stats|video count)\b/i.test(request) && !scope.includes("user.info.stats")) {
      await sendFormatted(chatId, "🎵 TikTok statistics are not authorized on this connection yet. Run /connect again and approve `user.info.stats`.", business);
      return "tiktok-scope";
    }
    await sendFormatted(chatId, formatTikTokProfile(d), business);
    return "tiktok";
  }

  if (tool === "gmail" || tool === "email") {
    if (!tg) throw new Error("Telegram user ID is unavailable.");
    const intent = gmailIntent(request || "check my latest emails");
    const resolved = intent.matched ? intent : { matched: true, query: request, title: request ? `Email search: ${request}` : "Latest emails" };
    await handleGmail(chatId, tg, resolved, business);
    return "gmail";
  }

  if (tool === "github") {
    if (!tg) throw new Error("Telegram user ID is unavailable.");
    const d = await oauthCall("status", tg);
    const list = Array.isArray(d?.connections) ? d.connections : [];
    const gh = list.find((x:any) => x?.provider === "github");
    if (!gh) throw new Error("GitHub is not connected. Use /connect first.");
    await sendFormatted(chatId, `🐙 **GitHub account**\n\nConnected as **${String(gh.account_label || "GitHub account")}**.`, business);
    return "github";
  }

  if (tool === "website" || tool === "site") {
    if (!tg) throw new Error("Telegram user ID is unavailable.");
    const d = await oauthCall("status", tg);
    const list = Array.isArray(d?.connections) ? d.connections : [];
    const site = list.find((x:any) => x?.provider === "website");
    if (!site) throw new Error("Tivals AI Website is not connected. Use /connect first.");
    await sendFormatted(chatId, `🌐 **Tivals AI Website**\n\nConnected as **${String(site.account_label || "Website account")}**.`, business);
    return "website";
  }
  if (tool === "youtube" || tool === "yt") {
    if (!request) {
      await sendFormatted(chatId, "Usage: `@youtube what you want to search`", business);
      return "youtube-help";
    }
    await sendHtml(chatId, ytHtml(request, await searchYouTube(request)), business);
    return "youtube";
  }

  if (tool === "image" || tool === "picture") {
    if (!request) {
      await sendFormatted(chatId, "Usage: `@image describe the image you want`", business);
      return "image-help";
    }
    const quota = await consumeUsage(tg, "image");
    if (!quota.ok) {
      await sendLimitReached(chatId, quota.plan as PlanName, "image", business);
      return "image-limit";
    }
    await telegram("sendChatAction", { chat_id: chatId, action: "upload_photo", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});
    await sendPhoto(chatId, await generateImage(request), request, business);
    return "image";
  }

  if (tool === "ai" || tool === "chat") {
    if (!request) {
      await sendFormatted(chatId, "Usage: `@ai ask your question`", business);
      return "ai-help";
    }
    const quota = await consumeUsage(tg, "ai");
    if (!quota.ok) {
      await sendLimitReached(chatId, quota.plan as PlanName, "ai", business);
      return "ai-limit";
    }
    await sendFormatted(chatId, await askTivalsAI(request, tg), business);
    return "ai";
  }

  await sendFormatted(chatId, `⚠️ Unknown tool **@${tool}**.\n\n${toolsHelpText()}`, business);
  return "unknown-tool";
}

async function askTivalsAI(message: string, tg = 0) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 15000);
  try {
    const settings = await telegramSettings(tg);
    const style = settings.response_style === "concise"
      ? "Reply concisely and focus on the essential answer."
      : settings.response_style === "detailed"
      ? "Give a detailed, well-structured answer with useful explanation."
      : "Give a balanced, clear answer with enough detail to be useful.";
    const r = await fetch(TIVALS_AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "tivals-ai", messages: [{ role: "user", content: message + "\n\nPreference: " + style }] }),
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
  if (req.method === "GET") return json({ ok: true, service: "Tivals AI Telegram webhook", gmail_reading: true, image_reading: true, oauth: true, formatting: "html-code-blocks", subscriptions: "telegram-stars", mini_app: true });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  if (secret && (req.headers.get("x-telegram-bot-api-secret-token") || "") !== secret) return json({ error: "Unauthorized webhook." }, 401);

  let update:any;
  try {
    update = await req.json();
  } catch {
    return json({ error: "Invalid Telegram update." }, 400);
  }

  if (update?.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const payload = String(q?.invoice_payload || "");
    const valid = /^tivals-sub:(basic|pro)$/.test(payload) && q?.currency === "XTR";
    await telegram("answerPreCheckoutQuery", {
      pre_checkout_query_id: q.id, ok: valid,
      ...(valid ? {} : { error_message: "This Tivals AI subscription invoice is invalid." })
    });
    return json({ ok:true, route:"pre-checkout", accepted:valid });
  }

  if (update?.business_connection) return json({ ok: true });
  const bm = update?.business_message;
  const message = bm || update?.message;
  const business = bm?.business_connection_id || undefined;
  const chatId = message?.chat?.id;
  const tg = Number(message?.from?.id || 0);
  if (!chatId) return json({ ok: true, ignored: true });

  if (message?.successful_payment) {
    try {
      const paid = await recordSuccessfulPayment(tg, message.successful_payment);
      const cfg = PLAN_CONFIG[paid.plan];
      await sendFormatted(chatId, "✅ **Subscription activated**\n\nYour **" + cfg.label + "** plan is active.\n\nAI messages/day: " + cfg.ai + "\nImages/day: " + cfg.images + "\n\nUse /plan anytime to check your subscription.", business);
      return json({ ok:true, route:"successful-payment", plan:paid.plan });
    } catch (e) {
      await sendFormatted(chatId, "⚠️ Payment was received, but the subscription could not be activated automatically. Please contact support.", business).catch(()=>{});
      return json({ ok:false, route:"payment-error", error:String((e as Error)?.message || e) });
    }
  }

  const text = String(message?.text || "").trim();
  const caption = String(message?.caption || "").trim();
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const doc = message?.document && /^image\//i.test(String(message.document?.mime_type || "")) ? message.document : null;

  try {
    if (photos.length || doc) {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      const quota = await consumeUsage(tg, "ai");
      if (!quota.ok) {
        await sendLimitReached(chatId, quota.plan as PlanName, "ai", business);
        return json({ok:true,route:"vision-limit"});
      }
      const fileId = doc?.file_id || photos[photos.length-1]?.file_id;
      await telegram("sendChatAction", { chat_id: chatId, action: "typing", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});
      const reply = await analyzeImage(await telegramImageDataUrl(fileId), caption);
      await sendFormatted(chatId, reply, business);
      return json({ ok:true, route:"vision" });
    }

    if (!text) return json({ ok:true, ignored:true });

    if (text === "/start" || text.startsWith("/start ")) {
      await setMiniAppMenu(chatId);
      await sendFormatted(chatId, [
        "👋 **Welcome to Tivals AI**",
        "",
        "Tivals AI is your Telegram AI assistant. You can chat normally, use connected accounts, search, generate images, and choose tools explicitly with `@tool`.",
        "",
        "**Quick start**",
        "• Ask anything normally: `Teach me Python`",
        "• See available tools: `/tools`",
        "• Connect Gmail, GitHub, TikTok, or the Tivals AI Website: `/connect`",
        "• View connected accounts: `/accounts`",
        "• Upgrade with Telegram Stars: `/subscribe`",
        "• Check your plan: `/plan`",
        "• Open dashboard: `/app`",
        "",
        "**Available tools**",
        "• `@tiktok check my TikTok account`",
        "• `@tiktok show my stats`",
        "• `@tiktok show my latest videos`",
        "• `@gmail check my latest emails`",
        "• `@github check my GitHub account`",
        "• `@youtube Python tutorial`",
        "• `@image futuristic AI robot`",
        "• `@ai explain recursion`",
        "",
        "**Photos & images**",
        "• Send a photo and Tivals AI can analyze it.",
        "• Ask `@image ...` to generate an image.",
        "",
        "**Account commands**",
        "• `/connect` — connect accounts",
        "• `/accounts` — show connected accounts",
        "• `/disconnect_gmail`",
        "• `/disconnect_github`",
        "• `/disconnect_tiktok`",
        "• `/disconnect_website`",
        "",
        "Use `/help` anytime for more commands."
      ].join("\n"), business);
      return json({ok:true});
    }

    if (text === "/help") {
      await sendFormatted(chatId, "**Tivals AI**\n\n/connect — Connect Gmail, GitHub, TikTok, or Tivals AI Website\n/accounts — Show connected accounts\n/emails — Show latest Gmail messages\n/unread — Show unread Gmail messages\n/disconnect_gmail — Disconnect Gmail\n/disconnect_github — Disconnect GitHub\n/disconnect_tiktok — Disconnect TikTok\n/disconnect_website — Disconnect Tivals AI Website\n/tools — Show @tool examples\n/subscribe — Upgrade with Telegram Stars\n/plan — Check plan and daily usage\n/app — Open dashboard, connectors and settings\n/connectbot — Connect your own Telegram bot\n\nTry `@tiktok check my TikTok account`, `@gmail check my emails`, or `@youtube Python tutorial`.", business);
      return json({ok:true});
    }

    if (text === "/app" || text === "/dashboard" || text === "/settings" || text === "/connectbot") {
      await setMiniAppMenu(chatId);
      await openMiniAppButton(chatId,business);
      return json({ok:true,route:"miniapp"});
    }

    if (text === "/subscribe") {
      if (tg && await isOwnerAccount(tg)) {
        await sendFormatted(chatId, "👑 **Owner account**\n\nYou do not need to pay for Tivals AI. Your owner access includes unlimited AI usage and the Telegram bot connector.", business);
        return json({ok:true,route:"owner-subscribe"});
      }
      await subscriptionMenu(chatId,business);
      return json({ok:true,route:"subscribe"});
    }

    if (text === "/plan") {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      await planStatus(chatId,tg,business);
      return json({ok:true,route:"plan"});
    }
    if (text === "/tools") {
      await sendFormatted(chatId, toolsHelpText(), business);
      return json({ok:true,route:"tools"});
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

    if (text === "/disconnect_gmail" || text === "/disconnect_github" || text === "/disconnect_tiktok" || text === "/disconnect_website") {
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      const provider = text.endsWith("gmail") ? "gmail" : text.endsWith("github") ? "github" : text.endsWith("tiktok") ? "tiktok" : "website";
      await oauthCall("disconnect",tg,provider);
      const providerLabel = provider === "gmail" ? "Gmail" : provider === "github" ? "GitHub" : provider === "tiktok" ? "TikTok" : "Tivals AI Website";
      await sendFormatted(chatId,`✅ ${providerLabel} disconnected.`,business);
      return json({ok:true,route:"disconnect"});
    }

    await telegram("sendChatAction", { chat_id: chatId, action: "typing", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});

    const toolReq = parseToolRequest(text);
    if (toolReq) {
      const route = await handleToolRequest(chatId, tg, toolReq, business);
      return json({ok:true, route:`tool-${route}`});
    }

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
      if (!tg) throw new Error("Telegram user ID is unavailable.");
      const quota = await consumeUsage(tg, "image");
      if (!quota.ok) {
        await sendLimitReached(chatId, quota.plan as PlanName, "image", business);
        return json({ok:true,route:"image-limit-normal"});
      }
      await telegram("sendChatAction", { chat_id: chatId, action: "upload_photo", ...(business ? { business_connection_id: business } : {}) }).catch(()=>{});
      await sendPhoto(chatId,await generateImage(img),img,business);
      return json({ok:true,route:"image-generation"});
    }

    if (!tg) throw new Error("Telegram user ID is unavailable.");
    const aiQuota = await consumeUsage(tg, "ai");
    if (!aiQuota.ok) {
      await sendLimitReached(chatId, aiQuota.plan as PlanName, "ai", business);
      return json({ok:true,route:"ai-limit-normal"});
    }
    await sendFormatted(chatId,await askTivalsAI(text,tg),business);
    return json({ok:true,route:"ai"});
  } catch (e) {
    const m = String((e as Error)?.message || e);
    await sendFormatted(chatId, `⚠️ ${m}`, business).catch(()=>{});
    console.error("Tivals Telegram error", m);
    return json({ok:false,error:m},200);
  }
});
