import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@9";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GITHUB_APP_ID = Deno.env.get("GITHUB_APP_ID") || "";
const GITHUB_PRIVATE_KEY = (Deno.env.get("GITHUB_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
const TIKTOK_CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY") || "";
const TIKTOK_CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET") || "";
const STATIC_BASE = "https://ai.tivalsdeveloper.site";
const TIKTOK_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/telegram-oauth/tiktok/callback`;
const TIKTOK_SCOPES = Deno.env.get("TIKTOK_SCOPES") || "user.info.basic";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();

const cors = {
  "Access-Control-Allow-Origin": STATIC_BASE,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function internal(req: Request) {
  return Boolean(SERVICE_KEY && (req.headers.get("authorization") || "") === `Bearer ${SERVICE_KEY}`);
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(s);
}
function unb64(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function aesKey() {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(SERVICE_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(value)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv); out.set(cipher, iv.length);
  return b64(out);
}
async function decrypt(value: string) {
  if (!value) return "";
  const bytes = unb64(value);
  if (bytes.length <= 12) throw new Error("Stored account token is invalid.");
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), cipher);
  return new TextDecoder().decode(plain);
}
function randomState() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
async function stateRow(state: string, provider: string) {
  const { data, error } = await sb.from("telegram_oauth_states").select("*").eq("state", state).eq("provider", provider).maybeSingle();
  if (error || !data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}
async function createState(tg: number, provider: string) {
  const state = randomState();

  // Remove only expired OAuth states. Do not delete still-valid states for the
  // same Telegram user/provider, because older /connect buttons may still be
  // open on the user's phone and should remain usable until they expire.
  await sb.from("telegram_oauth_states")
    .delete()
    .lt("expires_at", new Date().toISOString());

  const ttlMinutes = provider === "tiktok" ? 60 : 15;
  const { error } = await sb.from("telegram_oauth_states").insert({
    state,
    telegram_user_id: tg,
    provider,
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  return state;
}
async function saveConnection(row: any, provider: string, info: any) {
  const { error } = await sb.from("telegram_oauth_connections").upsert({
    telegram_user_id: row.telegram_user_id,
    provider,
    provider_user_id: info.providerUserId || null,
    account_label: info.label || null,
    access_token_enc: await encrypt(info.access || ""),
    refresh_token_enc: info.refresh ? await encrypt(info.refresh) : null,
    token_type: info.tokenType || null,
    scope: info.scope || null,
    expires_at: info.expiresAt || null,
    metadata: info.metadata || {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id,provider" });
  if (error) throw error;
  await sb.from("telegram_oauth_states").delete().eq("state", row.state);
}
function githubAppJwt() {
  if (!GITHUB_APP_ID) throw new Error("GITHUB_APP_ID is missing.");
  if (!GITHUB_PRIVATE_KEY) throw new Error("GITHUB_PRIVATE_KEY is missing.");
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iat: now - 60, exp: now + 540, iss: GITHUB_APP_ID }, GITHUB_PRIVATE_KEY, { algorithm: "RS256", noTimestamp: true });
}
async function githubAppInfo() {
  const r = await fetch("https://api.github.com/app", {
    headers: { authorization: `Bearer ${githubAppJwt()}`, accept: "application/vnd.github+json", "user-agent": "Tivals-AI" },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `GitHub App lookup failed (${r.status}).`);
  return d;
}
async function githubInstallation(id: string) {
  const r = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${githubAppJwt()}`, accept: "application/vnd.github+json", "user-agent": "Tivals-AI" },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `GitHub installation lookup failed (${r.status}).`);
  return d;
}
async function createLink(req: Request, provider: string, tg: number) {
  if (!internal(req)) return json({ error: "Unauthorized" }, 401);
  if (!["gmail", "github", "tiktok"].includes(provider) || !Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid request" }, 400);
  try {
    const state = await createState(tg, provider);
    if (provider === "gmail") {
      return json({ url: `${STATIC_BASE}/telegram-gmail.html?state=${encodeURIComponent(state)}&v=5` });
    }
    if (provider === "tiktok") {
      if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) throw new Error("TikTok connection is not configured yet.");
      const params = new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        response_type: "code",
        scope: TIKTOK_SCOPES,
        redirect_uri: TIKTOK_REDIRECT_URI,
        state,
      });
      return json({ url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` });
    }
    const app = await githubAppInfo();
    if (!app?.slug) throw new Error("GitHub App slug could not be determined.");
    return json({ url: `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new?state=${encodeURIComponent(state)}` });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
}

async function gmailConnection(tg: number) {
  const { data, error } = await sb.from("telegram_oauth_connections")
    .select("provider,account_label,access_token_enc,refresh_token_enc,scope,expires_at,metadata")
    .eq("telegram_user_id", tg).eq("provider", "gmail").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Gmail is not connected. Use /connect first.");
  return data;
}
async function gmailFetchJson(token: string, url: string) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error("Your Gmail permission has expired or is no longer valid. Use /disconnect_gmail, then /connect to reconnect Gmail.");
  if (!r.ok) throw new Error(d?.error?.message || `Gmail request failed (${r.status}).`);
  return d;
}
async function gmailMessages(tg: number, query: string, maxResults: number) {
  const conn = await gmailConnection(tg);
  const token = await decrypt(String(conn.access_token_enc || ""));
  if (!token) throw new Error("Gmail access token is missing. Reconnect Gmail with /connect.");
  const max = Math.max(1, Math.min(10, Number(maxResults || 5)));
  const params = new URLSearchParams({ maxResults: String(max) });
  if (query.trim()) params.set("q", query.trim());
  const list = await gmailFetchJson(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);
  const refs = Array.isArray(list?.messages) ? list.messages.slice(0, max) : [];
  const messages = await Promise.all(refs.map(async (m: any) => {
    const p = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "Subject", "Date", "To"]) p.append("metadataHeaders", h);
    const d = await gmailFetchJson(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(m.id))}?${p.toString()}`);
    const headers = Object.fromEntries((d?.payload?.headers || []).map((h: any) => [String(h.name || "").toLowerCase(), String(h.value || "")]));
    return {
      id: d?.id || m.id,
      thread_id: d?.threadId || m.threadId || null,
      from: headers.from || "Unknown sender",
      to: headers.to || "",
      subject: headers.subject || "(No subject)",
      date: headers.date || "",
      snippet: String(d?.snippet || "").replace(/\s+/g, " ").trim(),
      label_ids: d?.labelIds || [],
    };
  }));
  return { account: conn.account_label || conn?.metadata?.email || "Gmail", messages, result_size: Number(list?.resultSizeEstimate || messages.length) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);

  if (req.method === "GET" && u.pathname.endsWith("/github/setup")) {
    const state = u.searchParams.get("state") || "";
    const installationId = u.searchParams.get("installation_id") || "";
    const fail = (message: string) => Response.redirect(`${STATIC_BASE}/telegram-github.html?ok=0&error=${encodeURIComponent(message)}`, 302);
    const st = await stateRow(state, "github");
    if (!st || !installationId) return fail("The GitHub connection link is invalid or expired. Return to Telegram and run /connect again.");
    try {
      const installation = await githubInstallation(installationId);
      const account = installation?.account?.login || installation?.account?.name || "GitHub account";
      await saveConnection(st, "github", {
        providerUserId: String(installationId),
        label: String(account),
        scope: "github_app_installation",
        metadata: {
          installation_id: Number(installationId),
          account_login: installation?.account?.login || null,
          account_id: installation?.account?.id || null,
          target_type: installation?.target_type || null,
          repository_selection: installation?.repository_selection || null,
          permissions: installation?.permissions || {},
        },
      });
      return Response.redirect(`${STATIC_BASE}/telegram-github.html?ok=1&account=${encodeURIComponent(String(account))}`, 302);
    } catch (e) {
      return fail(String((e as Error)?.message || e));
    }
  }

  if (req.method === "GET" && u.pathname.endsWith("/tiktok/callback")) {
    const state = u.searchParams.get("state") || "";
    const code = u.searchParams.get("code") || "";
    const oauthError = u.searchParams.get("error") || "";
    const oauthDescription = u.searchParams.get("error_description") || "";

    const page = (ok: boolean, title: string, message: string) => new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#101010;color:#fff;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}.card{max-width:520px;background:#1f1f1f;border:1px solid #333;border-radius:18px;padding:24px}.ok{color:#53e08a}.bad{color:#ff7676}p{line-height:1.5;color:#ccc}</style></head><body><div class="card"><h2 class="${ok ? "ok" : "bad"}">${title}</h2><p>${message}</p><p>You can close this page and return to Telegram.</p></div></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
    );

    if (oauthError) return page(false, "TikTok connection failed", oauthDescription || oauthError);

    const st = await stateRow(state, "tiktok");
    if (!st || !code) return page(false, "TikTok connection link is no longer valid", "Return to Telegram, run /connect again, and tap the newest Connect TikTok button. TikTok links are now kept valid for up to 60 minutes.");

    try {
      if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) throw new Error("TikTok app credentials are not configured.");

      const tokenBody = new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: TIKTOK_REDIRECT_URI,
      });

      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token?.access_token) {
        throw new Error(token?.error_description || token?.error || `TikTok token exchange failed (${tokenRes.status}).`);
      }

      const fields = new URLSearchParams({ fields: "open_id,union_id,avatar_url,display_name" });
      const profileRes = await fetch(`https://open.tiktokapis.com/v2/user/info/?${fields.toString()}`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      const profileJson = await profileRes.json().catch(() => ({}));
      if (!profileRes.ok) throw new Error(profileJson?.error?.message || `TikTok profile lookup failed (${profileRes.status}).`);

      const user = profileJson?.data?.user || {};
      const label = String(user.display_name || "TikTok account");

      await saveConnection(st, "tiktok", {
        providerUserId: String(token.open_id || user.open_id || ""),
        label,
        access: String(token.access_token || ""),
        refresh: String(token.refresh_token || ""),
        tokenType: String(token.token_type || "Bearer"),
        scope: String(token.scope || TIKTOK_SCOPES),
        expiresAt: new Date(Date.now() + Math.max(60, Number(token.expires_in || 86400)) * 1000).toISOString(),
        metadata: {
          open_id: token.open_id || user.open_id || null,
          union_id: user.union_id || null,
          display_name: user.display_name || null,
          avatar_url: user.avatar_url || null,
          refresh_expires_in: Number(token.refresh_expires_in || 0) || null,
        },
      });

      return page(true, "TikTok connected", `Connected as <b>${label.replace(/[<>&]/g, "")}</b>.`);
    } catch (e) {
      return page(false, "TikTok connection failed", String((e)?.message || e).replace(/[<>&]/g, ""));
    }
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action = String(body.action || "");
  const provider = String(body.provider || "");
  const tg = Number(body.telegram_user_id || 0);

  if (action === "complete_gmail") {
    const state = String(body.state || "");
    const token = String(body.provider_token || "");
    const refresh = String(body.provider_refresh_token || "");
    const st = await stateRow(state, "gmail");
    if (!st || !token) return json({ error: "Invalid or expired Gmail connection." }, 400);
    try {
      const [profileRes, tokenInfoRes] = await Promise.all([
        fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${token}` } }),
        fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`),
      ]);
      const profile = await profileRes.json().catch(() => ({}));
      const tokenInfo = await tokenInfoRes.json().catch(() => ({}));
      if (!profileRes.ok) throw new Error("Could not verify the Google account.");
      if (!tokenInfoRes.ok) throw new Error("Could not verify Gmail permissions.");
      const granted = String(tokenInfo.scope || "");
      const hasRead = granted.includes("https://www.googleapis.com/auth/gmail.readonly") || granted.includes("https://mail.google.com/");
      const hasSend = granted.includes("https://www.googleapis.com/auth/gmail.send") || granted.includes("https://mail.google.com/");
      if (!hasRead || !hasSend) throw new Error("Gmail read/send permissions were not granted. Please reconnect and approve both permissions.");
      const expiresIn = Number(tokenInfo.expires_in || 3300);
      await saveConnection(st, "gmail", {
        providerUserId: String(profile.sub || ""),
        label: String(profile.email || "Google account"),
        access: token,
        refresh,
        tokenType: "Bearer",
        scope: granted || GMAIL_SCOPES,
        expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
        metadata: { email: profile.email || null, name: profile.name || null, picture: profile.picture || null },
      });
      return json({ ok: true, account: profile.email || "Google account" });
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 500);
    }
  }

  if (action === "create_link") return createLink(req, provider, tg);
  if (!internal(req)) return json({ error: "Unauthorized" }, 401);

  if (action === "status") {
    const { data, error } = await sb.from("telegram_oauth_connections")
      .select("provider,account_label,scope,expires_at,updated_at,metadata")
      .eq("telegram_user_id", tg);
    return error ? json({ error: error.message }, 500) : json({ connections: data || [] });
  }
  if (action === "gmail_messages") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await gmailMessages(tg, String(body.query || ""), Number(body.max_results || 5)));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "disconnect") {
    if (!["gmail", "github", "tiktok"].includes(provider)) return json({ error: "Invalid provider" }, 400);
    const { error } = await sb.from("telegram_oauth_connections").delete().eq("telegram_user_id", tg).eq("provider", provider);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
