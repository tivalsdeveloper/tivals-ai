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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const owner = new URL(req.url).searchParams.get("owner") || "";
  if (!/^[0-9a-f-]{36}$/i.test(owner)) return json({ error: "Invalid connector" }, 400);
  const { data: conn, error } = await sb.from("tivals_web_oauth_connections")
    .select("access_token_enc,refresh_token_enc,account_label")
    .eq("user_id", owner).eq("provider", "telegram").maybeSingle();
  if (error || !conn) return json({ error: "Connector not found" }, 404);
  try {
    const [token, secret] = await Promise.all([decrypt(String(conn.access_token_enc || "")), decrypt(String(conn.refresh_token_enc || ""))]);
    if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return json({ error: "Unauthorized" }, 401);
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
