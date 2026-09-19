import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AI_URL = `${SUPABASE_URL}/functions/v1/tivals-ai-chat`;
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
function esc(v: string) {
  return String(v || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
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
async function reply(token: string, chatId: number, text: string) {
  const html = mdToHtml(text);
  for (const part of splitHtml(html)) {
    try {
      await telegram(token, "sendMessage", {
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true }
      });
    } catch {
      await telegram(token, "sendMessage", {
        chat_id: chatId,
        text: part.replace(/<[^>]+>/g, ""),
        link_preview_options: { is_disabled: true }
      });
    }
  }
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

    if (paywallOwner && !(await paidOrOwner(paywallOwner))) {
      const update = await req.json().catch(()=>({}));
      const chatId = Number(update?.message?.chat?.id || 0);
      if (chatId) await reply(token, chatId, "This bot's Tivals AI subscription is inactive. Please ask the bot owner to renew their Tivals AI plan.");
      return json({ ok:true, route:"subscription-inactive" });
    }

    const update = await req.json();
    const message = update?.message;
    const chatId = Number(message?.chat?.id || 0);
    const text = String(message?.text || "").trim();
    if (!chatId || !text) return json({ ok: true });
    if (/^\/start(?:\s|$)/i.test(text)) {
      await reply(token, chatId, `Welcome! I am ${conn.account_label || "your Tivals AI bot"}. Send me a question and I will help you.`);
      return json({ ok: true });
    }
    await telegram(token, "sendChatAction", { chat_id: chatId, action: "typing" });
    const ai = await fetch(AI_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: text }] }) });
    const result = await ai.json().catch(() => ({}));
    if (!ai.ok || !result?.reply) throw new Error(result?.error || "The AI is temporarily unavailable.");
    await reply(token, chatId, String(result.reply));
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});
