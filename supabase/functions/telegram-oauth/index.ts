import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8, importJWK } from "https://deno.land/x/jose@v4.15.5/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GITHUB_APP_ID = Deno.env.get("GITHUB_APP_ID") || "";
const GITHUB_PRIVATE_KEY = (Deno.env.get("GITHUB_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
const TIKTOK_CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY") || "";
const TIKTOK_CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET") || "";
const STATIC_BASE = "https://ai.tivalsdeveloper.site";
const TIKTOK_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/telegram-oauth/tiktok/callback`;
const TIKTOK_SCOPES = Deno.env.get("TIKTOK_SCOPES") || "user.info.basic,user.info.stats,video.list";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
const USER_TELEGRAM_WEBHOOK = `${SUPABASE_URL}/functions/v1/tivals-user-telegram`;
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
async function webUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function createTelegramWebsiteLink(tg: number) {
  if (!Number.isSafeInteger(tg) || tg <= 0) throw new Error("Invalid Telegram user.");
  const state = "site_" + randomState();
  await sb.from("telegram_web_link_states").delete().lt("expires_at", new Date().toISOString());
  await sb.from("telegram_web_link_states").delete().eq("telegram_user_id", tg);
  const { error } = await sb.from("telegram_web_link_states").insert({
    state, telegram_user_id: tg,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  return { url: STATIC_BASE + "/?telegram_link=" + encodeURIComponent(state) };
}

async function completeTelegramWebsiteLink(user: any, state: string) {
  if (!state) throw new Error("Website connection code is missing.");
  const { data: row, error } = await sb.from("telegram_web_link_states")
    .select("*").eq("state", state).maybeSingle();
  if (error || !row || new Date(row.expires_at).getTime() < Date.now()) throw new Error("This Telegram website connection link is invalid or expired. Run /connect in Telegram again.");
  const label = String(user?.user_metadata?.username || user?.user_metadata?.full_name || user?.email || "Tivals AI account");
  const { error: upsertError } = await sb.from("telegram_web_links").upsert({
    telegram_user_id: row.telegram_user_id, user_id: user.id, account_label: label,
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" });
  if (upsertError) throw upsertError;
  await sb.from("telegram_web_link_states").delete().eq("state", state);
  return { ok:true, telegram_user_id:row.telegram_user_id, account_label:label };
}

async function telegramWebsiteLink(tg: number) {
  const { data, error } = await sb.from("telegram_web_links")
    .select("telegram_user_id,user_id,account_label,updated_at").eq("telegram_user_id", tg).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function webStateRow(state: string, provider: string) {
  const { data, error } = await sb.from("tivals_web_oauth_states")
    .select("*").eq("state", state).eq("provider", provider).maybeSingle();
  if (error || !data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

async function createWebState(userId: string, provider: string) {
  const state = "web_" + randomState();
  await sb.from("tivals_web_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await sb.from("tivals_web_oauth_states").insert({
    state, user_id: userId, provider,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  return state;
}

async function saveWebConnection(row: any, provider: string, info: any) {
  const { error } = await sb.from("tivals_web_oauth_connections").upsert({
    user_id: row.user_id,
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
  }, { onConflict: "user_id,provider" });
  if (error) throw error;
  await sb.from("tivals_web_oauth_states").delete().eq("state", row.state);
}

async function webTikTokConnection(userId: string) {
  const { data, error } = await sb.from("tivals_web_oauth_connections")
    .select("provider,account_label,access_token_enc,refresh_token_enc,scope,expires_at,metadata")
    .eq("user_id", userId).eq("provider", "tiktok").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("TikTok is not connected. Open TikTok tools and connect your account.");
  return data;
}

async function webTelegramPaidAccess(userId:string) {
  const {data:link,error}=await sb.from("telegram_web_links")
    .select("telegram_user_id")
    .eq("user_id",userId).maybeSingle();
  if(error) throw error;
  if(!link?.telegram_user_id) return {allowed:false,reason:"Connect your Telegram account to Tivals AI first."};
  const tg=Number(link.telegram_user_id);
  const {data:admin}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();
  if(admin) return {allowed:true,owner:true,telegram_user_id:tg};
  const {data:sub}=await sb.from("telegram_subscriptions")
    .select("plan,status,subscription_expiration_date")
    .eq("telegram_user_id",tg).maybeSingle();
  const active=Boolean(sub && sub.status==="active" && ["basic","pro"].includes(sub.plan) && new Date(sub.subscription_expiration_date).getTime()>Date.now());
  return active
    ? {allowed:true,owner:false,telegram_user_id:tg,plan:sub.plan}
    : {allowed:false,reason:"A paid Basic or Pro Telegram subscription is required to connect your own bot."};
}

async function webTelegramConnection(userId: string) {
  const { data, error } = await sb.from("tivals_web_oauth_connections")
    .select("provider,provider_user_id,account_label,access_token_enc,refresh_token_enc,updated_at,metadata")
    .eq("user_id", userId).eq("provider", "telegram").maybeSingle();
  if (error) throw error;
  return data;
}

async function telegramBotCall(token: string, method: string, payload?: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, payload ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.description || `Telegram ${method} failed (${r.status}).`);
  return d;
}

function telegramWebhookSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function connectWebTelegram(userId: string, rawToken: string) {
  const token = rawToken.trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{25,}$/.test(token)) throw new Error("Enter a valid Telegram bot token from BotFather.");
  const me = await telegramBotCall(token, "getMe");
  if (!me?.result?.is_bot) throw new Error("This token does not belong to a Telegram bot.");
  const secret = telegramWebhookSecret();
  await telegramBotCall(token, "setWebhook", {
    url: `${USER_TELEGRAM_WEBHOOK}?owner=${encodeURIComponent(userId)}`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  const bot = me.result;
  const { error } = await sb.from("tivals_web_oauth_connections").upsert({
    user_id: userId,
    provider: "telegram",
    provider_user_id: String(bot.id || ""),
    account_label: bot.username ? `@${bot.username}` : String(bot.first_name || "Telegram bot"),
    access_token_enc: await encrypt(token),
    refresh_token_enc: await encrypt(secret),
    token_type: "Bot",
    scope: "messages",
    metadata: { username: bot.username || null, first_name: bot.first_name || null, can_join_groups: Boolean(bot.can_join_groups) },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider" });
  if (error) throw error;
  return { connected: true, account_label: bot.username ? `@${bot.username}` : String(bot.first_name || "Telegram bot"), username: bot.username || null };
}

async function webTikTokProfile(userId: string) {
  const conn = await webTikTokConnection(userId);
  const token = await decrypt(String(conn.access_token_enc || ""));
  const scope = String(conn.scope || "");
  const granted = scope.split(",").map((x:string) => x.trim());
  const fieldsList = ["open_id","union_id","avatar_url","display_name"];
  if (granted.includes("user.info.stats")) fieldsList.push("follower_count","following_count","likes_count","video_count");
  const params = new URLSearchParams({ fields: fieldsList.join(",") });
  const r = await fetch("https://open.tiktokapis.com/v2/user/info/?" + params.toString(), {
    headers: { authorization: "Bearer " + token },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || ("TikTok request failed (" + r.status + ")."));
  const u = d?.data?.user || {};
  return {
    account: conn.account_label || u.display_name || "TikTok account",
    scope,
    profile: { display_name: u.display_name || conn.account_label || "TikTok account", avatar_url: u.avatar_url || null },
    stats: { follower_count:u.follower_count ?? null, following_count:u.following_count ?? null, likes_count:u.likes_count ?? null, video_count:u.video_count ?? null }
  };
}

async function webTikTokVideos(userId: string, maxResults = 5) {
  const conn = await webTikTokConnection(userId);
  const scope = String(conn.scope || "");
  if (!scope.split(",").map((x:string)=>x.trim()).includes("video.list")) throw new Error("TikTok video access is not authorized. Reconnect TikTok and approve video.list.");
  const token = await decrypt(String(conn.access_token_enc || ""));
  const params = new URLSearchParams({ fields:"id,title,video_description,duration,cover_image_url,embed_link,create_time" });
  const r = await fetch("https://open.tiktokapis.com/v2/video/list/?" + params.toString(), {
    method:"POST", headers:{ authorization:"Bearer " + token, "content-type":"application/json" },
    body:JSON.stringify({ max_count:Math.max(1,Math.min(20,Number(maxResults||5))) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || ("TikTok video request failed (" + r.status + ")."));
  return { account:conn.account_label || "TikTok account", scope, videos:Array.isArray(d?.data?.videos)?d.data.videos:[], has_more:Boolean(d?.data?.has_more) };
}
function ghB64u(b: Uint8Array) {
  let x = "";
  for (const v of b) x += String.fromCharCode(v);
  return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function ghReadLen(b: Uint8Array, o: number) {
  let l = b[o++];
  if (!(l & 128)) return { length: l, offset: o };
  const c = l & 127;
  l = 0;
  for (let i = 0; i < c; i++) l = (l << 8) | b[o++];
  return { length: l, offset: o };
}
function ghReadInt(b: Uint8Array, o: number) {
  if (b[o++] !== 2) throw new Error("Invalid RSA private key.");
  const r = ghReadLen(b, o);
  o = r.offset;
  let v = b.slice(o, o + r.length);
  o += r.length;
  while (v.length > 1 && v[0] === 0) v = v.slice(1);
  return { value: v, offset: o };
}
async function githubPrivateKey() {
  const pem = GITHUB_PRIVATE_KEY.trim();
  if (!pem) throw new Error("GITHUB_PRIVATE_KEY is missing.");
  if (pem.includes("BEGIN PRIVATE KEY")) return importPKCS8(pem, "RS256");
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("Unsupported GitHub private key format.");

  const bin = atob(pem.replace("-----BEGIN RSA PRIVATE KEY-----", "").replace("-----END RSA PRIVATE KEY-----", "").replace(/\s/g, ""));
  const b = Uint8Array.from(bin, c => c.charCodeAt(0));
  let o = 0;
  if (b[o++] !== 48) throw new Error("Invalid PKCS#1 RSA key.");
  o = ghReadLen(b, o).offset;
  o = ghReadInt(b, o).offset;
  const n = ghReadInt(b, o); o = n.offset;
  const e = ghReadInt(b, o); o = e.offset;
  const d = ghReadInt(b, o); o = d.offset;
  const p = ghReadInt(b, o); o = p.offset;
  const q = ghReadInt(b, o); o = q.offset;
  const dp = ghReadInt(b, o); o = dp.offset;
  const dq = ghReadInt(b, o); o = dq.offset;
  const qi = ghReadInt(b, o);
  return importJWK({
    kty: "RSA", alg: "RS256",
    n: ghB64u(n.value), e: ghB64u(e.value), d: ghB64u(d.value),
    p: ghB64u(p.value), q: ghB64u(q.value), dp: ghB64u(dp.value),
    dq: ghB64u(dq.value), qi: ghB64u(qi.value)
  }, "RS256");
}
async function githubAppJwt() {
  if (!GITHUB_APP_ID) throw new Error("GITHUB_APP_ID is missing.");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 540)
    .setIssuer(GITHUB_APP_ID)
    .sign(await githubPrivateKey());
}
async function githubAppInfo() {
  const r = await fetch("https://api.github.com/app", {
    headers: { authorization: `Bearer ${await githubAppJwt()}`, accept: "application/vnd.github+json", "user-agent": "Tivals-AI" },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `GitHub App lookup failed (${r.status}).`);
  return d;
}
async function githubInstallation(id: string) {
  const r = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${await githubAppJwt()}`, accept: "application/vnd.github+json", "user-agent": "Tivals-AI" },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `GitHub installation lookup failed (${r.status}).`);
  return d;
}
async function githubConnection(tg: number) {
  const { data, error } = await sb.from("telegram_oauth_connections")
    .select("provider,account_label,scope,metadata")
    .eq("telegram_user_id", tg).eq("provider", "github").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("GitHub is not connected. Use /connect first.");
  return data;
}
async function githubInstallationAccess(tg: number) {
  const conn = await githubConnection(tg);
  const installationId = Number(conn?.metadata?.installation_id || 0);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("The GitHub connection is incomplete. Disconnect GitHub, then use /connect again.");
  }
  const tokenRes = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await githubAppJwt()}`,
      accept: "application/vnd.github+json",
      "user-agent": "Tivals-AI",
    },
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData?.token) {
    throw new Error(tokenData?.message || `GitHub access failed (${tokenRes.status}). Reconnect GitHub with /connect.`);
  }
  return { conn, token: String(tokenData.token), permissions: tokenData?.permissions || conn?.metadata?.permissions || {} };
}
async function githubJson(token: string, url: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "Tivals-AI",
      ...(init?.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `GitHub request failed (${r.status}).`);
  return d;
}
async function githubRepositories(tg: number, maxResults = 10) {
  const { conn, token } = await githubInstallationAccess(tg);
  const limit = Math.max(1, Math.min(20, Number(maxResults || 10)));
  const repoData = await githubJson(token, `https://api.github.com/installation/repositories?per_page=${limit}`);
  const repositories = (Array.isArray(repoData?.repositories) ? repoData.repositories : []).slice(0, limit).map((repo: any) => ({
    name: String(repo?.name || ""),
    full_name: String(repo?.full_name || repo?.name || ""),
    private: Boolean(repo?.private),
    description: String(repo?.description || ""),
    html_url: String(repo?.html_url || ""),
    default_branch: String(repo?.default_branch || ""),
    updated_at: repo?.updated_at || null,
  }));
  return {
    account: conn.account_label || conn?.metadata?.account_login || "GitHub account",
    repository_selection: conn?.metadata?.repository_selection || null,
    total_count: Number(repoData?.total_count || repositories.length),
    repositories,
  };
}
function githubRepositoryName(value: string) {
  const name = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Choose a valid connected repository.");
  return name;
}
async function githubRepositoryContext(tg: number, repository: string) {
  const fullName = githubRepositoryName(repository);
  const { token, permissions } = await githubInstallationAccess(tg);
  const base = `https://api.github.com/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;
  const [repo, root, commits, issues, readmeResponse] = await Promise.all([
    githubJson(token, base),
    githubJson(token, `${base}/contents`).catch(() => []),
    githubJson(token, `${base}/commits?per_page=5`).catch(() => []),
    githubJson(token, `${base}/issues?state=open&per_page=8`).catch(() => []),
    fetch(`${base}/readme`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github.raw+json", "user-agent": "Tivals-AI" } }).catch(() => null),
  ]);
  const readme = readmeResponse?.ok ? (await readmeResponse.text()).slice(0, 7000) : "";
  return {
    repository: {
      full_name: repo?.full_name || fullName,
      description: repo?.description || "",
      private: Boolean(repo?.private),
      default_branch: repo?.default_branch || "",
      language: repo?.language || null,
      stars: Number(repo?.stargazers_count || 0),
      open_issues_count: Number(repo?.open_issues_count || 0),
      updated_at: repo?.updated_at || null,
      html_url: repo?.html_url || "",
    },
    permissions: { contents: permissions?.contents || null, issues: permissions?.issues || null, pull_requests: permissions?.pull_requests || null },
    root_files: (Array.isArray(root) ? root : []).slice(0, 40).map((x: any) => ({ name:x?.name || "", path:x?.path || "", type:x?.type || "" })),
    recent_commits: (Array.isArray(commits) ? commits : []).slice(0, 5).map((x: any) => ({
      sha: String(x?.sha || "").slice(0, 12), message: String(x?.commit?.message || "").slice(0, 500),
      author: x?.commit?.author?.name || x?.author?.login || "", date: x?.commit?.author?.date || null,
    })),
    open_issues: (Array.isArray(issues) ? issues : []).filter((x: any) => !x?.pull_request).slice(0, 8).map((x: any) => ({
      number: x?.number, title: String(x?.title || "").slice(0, 300), state: x?.state || "open", html_url: x?.html_url || "",
    })),
    readme,
  };
}
async function githubCreateIssue(tg: number, repository: string, title: string, issueBody: string) {
  const fullName = githubRepositoryName(repository);
  const safeTitle = title.replace(/[\r\n]+/g, " ").trim().slice(0, 240);
  const safeBody = issueBody.trim().slice(0, 20000);
  if (!safeTitle || !safeBody) throw new Error("GitHub issue title and description are required.");
  const { token, permissions } = await githubInstallationAccess(tg);
  if (permissions?.issues !== "write") throw new Error("The GitHub App does not have Issues write permission.");
  const d = await githubJson(token, `https://api.github.com/repos/${fullName.split("/").map(encodeURIComponent).join("/")}/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: safeTitle, body: safeBody }),
  });
  return { ok:true, number:d?.number || null, html_url:d?.html_url || null, title:d?.title || safeTitle };
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

async function tiktokConnection(tg: number) {
  const { data, error } = await sb.from("telegram_oauth_connections")
    .select("provider,account_label,access_token_enc,refresh_token_enc,scope,expires_at,metadata")
    .eq("telegram_user_id", tg).eq("provider", "tiktok").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("TikTok is not connected. Use /connect first.");
  return data;
}

async function tiktokProfile(tg: number) {
  const conn = await tiktokConnection(tg);
  const token = await decrypt(String(conn.access_token_enc || ""));
  if (!token) throw new Error("TikTok access token is missing. Reconnect TikTok with /connect.");

  const scope = String(conn.scope || "");
  const granted = scope.split(",").map((x:string) => x.trim());
  const fieldList = ["open_id", "union_id", "avatar_url", "display_name"];
  if (granted.includes("user.info.stats")) {
    fieldList.push("follower_count", "following_count", "likes_count", "video_count");
  }

  const fields = new URLSearchParams({ fields: fieldList.join(",") });
  const r = await fetch("https://open.tiktokapis.com/v2/user/info/?" + fields.toString(), {
    headers: { authorization: "Bearer " + token },
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    throw new Error("TikTok permission has expired or is no longer valid. Use /disconnect_tiktok, then /connect to reconnect.");
  }
  if (!r.ok) throw new Error(d?.error?.message || ("TikTok request failed (" + r.status + ")."));

  const user = d?.data?.user || {};
  return {
    account: conn.account_label || user.display_name || "TikTok account",
    scope,
    profile: {
      display_name: user.display_name || conn.account_label || "TikTok account",
      avatar_url: user.avatar_url || conn?.metadata?.avatar_url || null,
      open_id: user.open_id || conn?.metadata?.open_id || null,
      union_id: user.union_id || conn?.metadata?.union_id || null,
    },
    stats: {
      follower_count: user.follower_count ?? null,
      following_count: user.following_count ?? null,
      likes_count: user.likes_count ?? null,
      video_count: user.video_count ?? null,
    },
  };
}

async function tiktokVideos(tg: number, maxResults = 5) {
  const conn = await tiktokConnection(tg);
  const scope = String(conn.scope || "");
  const granted = scope.split(",").map((x:string) => x.trim());
  if (!granted.includes("video.list")) throw new Error("TikTok video access is not authorized yet. Reconnect with /connect and approve video.list.");
  const token = await decrypt(String(conn.access_token_enc || ""));
  if (!token) throw new Error("TikTok access token is missing. Reconnect TikTok with /connect.");

  const maxCount = Math.max(1, Math.min(20, Number(maxResults || 5)));
  const fields = new URLSearchParams({ fields: "id,title,video_description,duration,cover_image_url,embed_link,create_time" });
  const r = await fetch("https://open.tiktokapis.com/v2/video/list/?" + fields.toString(), {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ max_count: maxCount }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error("TikTok video permission has expired or is not authorized. Reconnect TikTok with /connect.");
  if (!r.ok) throw new Error(d?.error?.message || ("TikTok video request failed (" + r.status + ")."));
  return {
    account: conn.account_label || "TikTok account",
    scope,
    videos: Array.isArray(d?.data?.videos) ? d.data.videos : [],
    cursor: d?.data?.cursor ?? null,
    has_more: Boolean(d?.data?.has_more),
  };
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
function gmailRawMessage(recipient: string, subject: string, body: string) {
  const safeRecipient = recipient.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(safeRecipient) || /[\r\n]/.test(safeRecipient)) {
    throw new Error("Enter one valid recipient email address.");
  }
  const safeSubject = subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const safeBody = body.replace(/\r?\n/g, "\r\n").slice(0, 10000);
  if (!safeSubject || !safeBody.trim()) throw new Error("Email subject and message are required.");
  const subjectBytes = new TextEncoder().encode(safeSubject);
  const encodedSubject = b64(subjectBytes);
  const raw = [
    `To: ${safeRecipient}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    safeBody,
  ].join("\r\n");
  return b64(new TextEncoder().encode(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function gmailSend(tg: number, recipient: string, subject: string, body: string) {
  const conn = await gmailConnection(tg);
  const scope = String(conn.scope || "");
  if (!scope.includes("gmail.send") && !scope.includes("mail.google.com")) {
    throw new Error("Gmail send permission is not authorized. Disconnect Gmail, then use /connect and approve sending permission.");
  }
  const token = await decrypt(String(conn.access_token_enc || ""));
  if (!token) throw new Error("Gmail access token is missing. Reconnect Gmail with /connect.");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: gmailRawMessage(recipient, subject, body) }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    throw new Error("Your Gmail send permission has expired or is no longer valid. Disconnect Gmail, then use /connect to reconnect.");
  }
  if (!r.ok) throw new Error(d?.error?.message || `Gmail send failed (${r.status}).`);
  return { ok: true, message_id: d?.id || null, thread_id: d?.threadId || null };
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

  if (req.method === "GET" && u.pathname.endsWith("/github/health")) {
    try {
      const app = await githubAppInfo();
      return json({
        ok: true,
        app_slug: app?.slug || null,
        app_name: app?.name || null,
        app_id_configured: Boolean(GITHUB_APP_ID),
        private_key_configured: Boolean(GITHUB_PRIVATE_KEY),
      });
    } catch (e) {
      return json({
        ok: false,
        error: String((e as Error)?.message || e),
        app_id_configured: Boolean(GITHUB_APP_ID),
        private_key_configured: Boolean(GITHUB_PRIVATE_KEY),
      }, 200);
    }
  }
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

    const page = (ok: boolean, _title: string, message: string, account = "") => {
      const params = new URLSearchParams({ ok: ok ? "1" : "0" });
      if (account) params.set("account", account);
      if (!ok && message) params.set("error", message.slice(0, 300));
      return Response.redirect(`${STATIC_BASE}/telegram-tiktok.html?${params.toString()}`, 302);
    };

    if (oauthError) return page(false, "TikTok connection failed", oauthDescription || oauthError);

    const st = await stateRow(state, "tiktok");
    const webSt = st ? null : await webStateRow(state, "tiktok");
    if ((!st && !webSt) || !code) return page(false, "TikTok connection link is no longer valid", "The connection link is invalid or expired. Start a new TikTok connection and try again.");

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

      const info = {
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
      };

      if (webSt) {
        await saveWebConnection(webSt, "tiktok", info);
        return Response.redirect(STATIC_BASE + "/?tiktok=connected", 302);
      }

      await saveConnection(st, "tiktok", info);
      return page(true, "TikTok connected", "Connected.", label);
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

  if (action === "complete_telegram_website_link") {
    const user = await webUser(req);
    if (!user) return json({ error:"Sign in to Tivals AI to finish connecting Telegram." }, 401);
    try { return json(await completeTelegramWebsiteLink(user, String(body.state || ""))); }
    catch (e) { return json({ error:String((e as Error)?.message || e) }, 400); }
  }

  if (action === "web_telegram_link_status") {
    const user = await webUser(req);
    if (!user) return json({ error:"Sign in to Tivals AI first." }, 401);
    const { data, error } = await sb.from("telegram_web_links").select("telegram_user_id,account_label,updated_at").eq("user_id",user.id).maybeSingle();
    return error ? json({ error:error.message },500) : json({ connected:Boolean(data), connection:data || null });
  }
  if (action === "create_web_tiktok_link") {
    const user = await webUser(req);
    if (!user) return json({ error: "Sign in to Tivals AI first." }, 401);
    try {
      if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) throw new Error("TikTok connection is not configured yet.");
      const state = await createWebState(user.id, "tiktok");
      const params = new URLSearchParams({ client_key:TIKTOK_CLIENT_KEY, response_type:"code", scope:TIKTOK_SCOPES, redirect_uri:TIKTOK_REDIRECT_URI, state });
      return json({ url:"https://www.tiktok.com/v2/auth/authorize/?" + params.toString() });
    } catch (e) { return json({ error:String((e as Error)?.message || e) }, 500); }
  }

  if (action === "web_tiktok_status" || action === "web_tiktok_profile" || action === "web_tiktok_videos" || action === "web_tiktok_disconnect") {
    const user = await webUser(req);
    if (!user) return json({ error:"Sign in to Tivals AI first." }, 401);
    try {
      if (action === "web_tiktok_status") {
        const { data, error } = await sb.from("tivals_web_oauth_connections").select("provider,account_label,scope,expires_at,updated_at,metadata").eq("user_id",user.id).eq("provider","tiktok").maybeSingle();
        if (error) throw error;
        return json({ connected:Boolean(data), connection:data || null });
      }
      if (action === "web_tiktok_profile") return json(await webTikTokProfile(user.id));
      if (action === "web_tiktok_videos") return json(await webTikTokVideos(user.id, Number(body.max_results || 5)));
      const { error } = await sb.from("tivals_web_oauth_connections").delete().eq("user_id",user.id).eq("provider","tiktok");
      if (error) throw error;
      return json({ ok:true });
    } catch (e) { return json({ error:String((e as Error)?.message || e) }, 400); }
  }
  if (["web_telegram_connect", "web_telegram_status", "web_telegram_test", "web_telegram_disconnect"].includes(action)) {
    const user = await webUser(req);
    if (!user) return json({ error: "Sign in to Tivals AI first." }, 401);
    try {
      if (action === "web_telegram_connect") {
        const access=await webTelegramPaidAccess(user.id);
        if(!access.allowed) throw new Error(access.reason || "A paid subscription is required.");
        return json(await connectWebTelegram(user.id, String(body.bot_token || "")));
      }
      const conn = await webTelegramConnection(user.id);
      if (action === "web_telegram_status") return json({ connected: Boolean(conn), connection: conn ? { account_label: conn.account_label, updated_at: conn.updated_at, metadata: conn.metadata } : null });
      if (!conn) throw new Error("No Telegram bot is connected.");
      const token = await decrypt(String(conn.access_token_enc || ""));
      if (action === "web_telegram_test") {
        const info = await telegramBotCall(token, "getWebhookInfo");
        return json({ ok: true, account_label: conn.account_label, webhook: { pending_updates: Number(info?.result?.pending_update_count || 0), last_error: info?.result?.last_error_message || null } });
      }
      await telegramBotCall(token, "deleteWebhook", { drop_pending_updates: false });
      const { error } = await sb.from("tivals_web_oauth_connections").delete().eq("user_id", user.id).eq("provider", "telegram");
      if (error) throw error;
      return json({ ok: true });
    } catch (e) { return json({ error: String((e as Error)?.message || e) }, 400); }
  }
  if (action === "create_website_link") {
    if (!internal(req)) return json({ error:"Unauthorized" },401);
    try { return json(await createTelegramWebsiteLink(tg)); }
    catch (e) { return json({ error:String((e as Error)?.message || e) },400); }
  }
  if (action === "create_link") return createLink(req, provider, tg);
  if (!internal(req)) return json({ error: "Unauthorized" }, 401);

  if (action === "status") {
    const { data, error } = await sb.from("telegram_oauth_connections")
      .select("provider,account_label,scope,expires_at,updated_at,metadata")
      .eq("telegram_user_id", tg);
    if (error) return json({ error:error.message },500);
    const website = await telegramWebsiteLink(tg);
    const connections = [...(data || [])];
    if (website) connections.push({ provider:"website", account_label:website.account_label || "Tivals AI website", updated_at:website.updated_at, metadata:{ user_id:website.user_id } });
    return json({ connections });
  }
  if (action === "gmail_messages") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await gmailMessages(tg, String(body.query || ""), Number(body.max_results || 5)));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "gmail_send") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await gmailSend(tg, String(body.recipient || ""), String(body.subject || ""), String(body.email_body || "")));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "github_repositories") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await githubRepositories(tg, Number(body.max_results || 10)));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "github_repository_context") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await githubRepositoryContext(tg, String(body.repository || "")));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "github_create_issue") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await githubCreateIssue(tg, String(body.repository || ""), String(body.title || ""), String(body.issue_body || "")));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "tiktok_profile") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await tiktokProfile(tg));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "tiktok_videos") {
    try {
      if (!Number.isSafeInteger(tg) || tg <= 0) return json({ error: "Invalid Telegram user." }, 400);
      return json(await tiktokVideos(tg, Number(body.max_results || 5)));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400);
    }
  }
  if (action === "disconnect") {
    if (provider === "website") {
      const { error } = await sb.from("telegram_web_links").delete().eq("telegram_user_id", tg);
      return error ? json({ error:error.message },500) : json({ ok:true });
    }
    if (!["gmail", "github", "tiktok"].includes(provider)) return json({ error: "Invalid provider" }, 400);
    const { error } = await sb.from("telegram_oauth_connections").delete().eq("telegram_user_id", tg).eq("provider", provider);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
