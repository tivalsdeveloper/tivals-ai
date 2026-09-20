import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

const APINEX_BASE = "https://api.apinex.bond/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const APPMIX_BASE = "https://api.apmix.ai/v1";
const BAZAARLINK_BASE = "https://api.bazaarlink.ai/v1";
const VERSION = 26;

type WidgetConfig = {
  public_key: string;
  business_name: string;
  assistant_name: string;
  business_description: string;
  services: string;
  contact_details: string;
  faq: string;
  instructions: string;
  welcome_message: string;
  allowed_domains: string[];
  is_active: boolean;
};

const APPMIX_FREE_MODELS = [
  "anthropic/claude-sonnet-4-6-free",
  "anthropic/claude-opus-5-free",
  "anthropic/claude-opus-4-8-free",
  "anthropic/claude-opus-4-7-free",
  "google/gemini-3-flash-preview-free",
  "zai/glm-5.2-free",
  "openai/gpt-4.1-free"
];

const APINEX_FALLBACK_MODELS = ["free/gemini-3.1-pro"];

type ProviderName = "bazaarlink" | "appmix" | "apinex" | "openrouter";
type SelectedModel = { provider: ProviderName; model: string };
type PublicModel = { id: string; name: string; provider?: string; model?: string };

const cooldownUntil: Record<ProviderName, number> = {
  bazaarlink: 0,
  appmix: 0,
  apinex: 0,
  openrouter: 0
};

let appMixWorkingModel = "";
let apinexWorkingModel = "";
let bazaarWorkingModel = "";

function responseHeaders(origin = "") {
  return { ...cors, "Access-Control-Allow-Origin": origin || "*", "Vary": "Origin" };
}

function json(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(origin) });
}

function normalizeHost(value: string) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try { return new URL(raw.includes("://") ? raw : `https://${raw}`).host.replace(/^www\./, ""); }
  catch { return raw.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, ""); }
}

function domainAllowed(origin: string, domains: string[]) {
  if (!origin) return false;
  let host = "";
  try { host = normalizeHost(new URL(origin).host); } catch { return false; }
  return (domains || []).some(value => {
    const domain = normalizeHost(value);
    if (!domain) return false;
    if (domain.startsWith("*.")) return host.endsWith(domain.slice(1)) && host !== domain.slice(2);
    return host === domain;
  });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

async function loadWidget(publicKey: string) {
  if (!publicKey) return null;
  const admin = adminClient();
  if (!admin) throw new Error("Widget configuration service is unavailable.");
  const { data, error } = await admin.from("widget_configs").select("public_key,business_name,assistant_name,business_description,services,contact_details,faq,instructions,welcome_message,allowed_domains,is_active").eq("public_key", publicKey).maybeSingle();
  if (error) throw error;
  return data as WidgetConfig | null;
}

function widgetSystem(config: WidgetConfig) {
  return [
    `Your name is ${config.assistant_name || "Tivals AI"}. You are the website assistant for ${config.business_name || "this business"}.`,
    "Use that assistant name when introducing yourself or when a visitor asks your name. Do not claim to be a different business or assistant.",
    "Use the verified business information below as the source of truth. Never invent prices, policies, contact details, services, availability, or guarantees. If the answer is not in the business information, say you do not have that detail and suggest contacting the business.",
    config.business_description && `ABOUT: ${config.business_description}`,
    config.services && `PRODUCTS OR SERVICES: ${config.services}`,
    config.contact_details && `CONTACT DETAILS: ${config.contact_details}`,
    config.faq && `FAQ: ${config.faq}`,
    config.instructions && `OWNER INSTRUCTIONS: ${config.instructions}`,
    "Keep answers concise, friendly, and suitable for website visitors."
  ].filter(Boolean).join("\n\n").slice(0, 14000);
}

function cleanMessages(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v.slice(-16).map((m:any) => ({
    role: ["assistant", "system"].includes(m?.role) ? m.role : "user",
    content: String(m?.content || "").slice(0, 16000)
  })).filter((m:any) => m.content);
}

function replyFrom(d: any) {
  const c = d?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c.map((x:any) => typeof x === "string" ? x : x?.text || "").join("").trim();
  }
  return "";
}

async function fetchJson(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    const raw = await r.text();
    let d: any = {};
    try { d = JSON.parse(raw); }
    catch { d = { error: { message: raw } }; }
    return { r, d, raw };
  } finally {
    clearTimeout(timer);
  }
}

function safeErr(e: unknown) {
  const s = String((e as Error)?.message || e || "");
  if (/abort|timeout|timed out/i.test(s)) return "timeout";
  if (/401|unauthor|invalid api|invalid key|key_expired/i.test(s)) return "unauthorized";
  if (/402|insufficient.*credit|payment required/i.test(s)) return "no_credits";
  if (/429|rate|quota|allowance|insufficient_quota|allowance_exhausted|limit/i.test(s)) return "rate_limited";
  if (/model.*not.*found|unknown model|retired model|model_unavailable|model_not_available/i.test(s)) return "model_unavailable";
  if (/no_models|no_free_models/i.test(s)) return s;
  return s.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180) || "failed";
}

function setCooldown(provider: ProviderName, reason: string) {
  if (reason === "rate_limited") cooldownUntil[provider] = Date.now() + 10 * 60_000;
  else if (reason === "unauthorized") cooldownUntil[provider] = Date.now() + 30 * 60_000;
  else if (reason === "timeout") cooldownUntil[provider] = Date.now() + 60_000;
  else if (reason === "no_credits") cooldownUntil[provider] = Date.now() + 10 * 60_000;
}

function inCooldown(provider: ProviderName) {
  return Date.now() < cooldownUntil[provider];
}

async function callProvider(
  url: string,
  key: string,
  model: string,
  messages: any[],
  headers: Record<string,string> = {},
  timeout = 10000,
  maxTokens = 1400
) {
  const { r, d } = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.3 })
  }, timeout);

  if (!r.ok) {
    const code = d?.error?.code || d?.code || "";
    const message = d?.error?.message || d?.message || `HTTP ${r.status}`;
    throw new Error(`${r.status} ${code} ${message}`.trim());
  }
  const reply = replyFrom(d);
  if (!reply) throw new Error("empty response");
  return reply;
}

function extractModelIds(d: any) {
  const out = new Set<string>();
  const walk = (v: any, depth = 0) => {
    if (depth > 5 || v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (typeof v !== "object") return;

    for (const key of ["id", "model", "model_id", "slug"]) {
      const x = v?.[key];
      if (typeof x === "string" && x.includes("/")) out.add(x);
    }
    for (const key of ["data", "models", "items", "result", "results"]) {
      if (v?.[key] != null) walk(v[key], depth + 1);
    }
  };
  walk(d);
  if (Array.isArray(d)) {
    for (const x of d) if (typeof x === "string" && x.includes("/")) out.add(x);
  }
  return [...out];
}

async function listModels(base: string, key: string, timeout = 3500) {
  const { r, d } = await fetchJson(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` }
  }, timeout);
  if (!r.ok) {
    throw new Error(`${r.status} ${d?.error?.code || ""} ${d?.error?.message || d?.message || "models request failed"}`.trim());
  }
  return { ids: extractModelIds(d), raw: d };
}

function uniqueModels(models: string[]) {
  return [...new Set(models.filter(Boolean))];
}

function isZeroPrice(v: unknown) {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n === 0;
}

function bazaarFreeModels(raw: any) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const aliases = Array.isArray(row?.aliases) ? row.aliases.map((x:any) => String(x || "").trim()).filter(Boolean) : [];
    const ownedBy = String(row?.owned_by || "").trim();
    const pricing = row?.pricing || {};
    const zero = isZeroPrice(pricing?.prompt) && isZeroPrice(pricing?.completion);
    const candidates = [id, ...aliases];

    let model = candidates.find(x => x === "auto:free" || /:free$/i.test(x)) || "";
    if (!model && zero) {
      model = aliases.find((x:string) => x.includes("/")) || (ownedBy && id && !id.includes("/") ? `${ownedBy}/${id}` : id);
    }
    if (!model || seen.has(model)) continue;

    const name = String(row?.name || "").trim() || model;
    seen.add(model);
    out.push({ id: model, name });
  }

  if (!seen.has("auto:free")) out.unshift({ id: "auto:free", name: "BazaarLink Auto Free" });
  return out;
}

function prettyModelName(model: string, provider: ProviderName) {
  const known: Record<string,string> = {
    "free/gemini-3.1-pro": "Gemini 3.1 Pro",
    "google/gemini-3-flash-preview-free": "Gemini 3 Flash Preview",
    "anthropic/claude-sonnet-4-6-free": "Claude Sonnet 4.6",
    "anthropic/claude-opus-5-free": "Claude Opus 5",
    "anthropic/claude-opus-4-8-free": "Claude Opus 4.8",
    "anthropic/claude-opus-4-7-free": "Claude Opus 4.7",
    "zai/glm-5.2-free": "GLM 5.2",
    "openai/gpt-4.1-free": "GPT-4.1",
    "openrouter/free": "OpenRouter Free Router",
    "auto:free": "BazaarLink Auto Free"
  };
  if (known[model]) return known[model];

  let name = model.split("/").pop() || model;
  name = name
    .replace(/:free$/i, "")
    .replace(/-free$/i, "")
    .replace(/-preview$/i, " Preview")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
  return name || provider;
}

function providerLabel(provider: ProviderName) {
  if (provider === "bazaarlink") return "BazaarLink";
  if (provider === "appmix") return "AppMix";
  if (provider === "apinex") return "Apinex";
  return "OpenRouter";
}

function publicModel(provider: ProviderName, model: string, name?: string): PublicModel {
  const label = providerLabel(provider);
  return {
    id: `${provider}:${model}`,
    name: `${name || prettyModelName(model, provider)} · ${label}`,
    provider: label,
    model
  };
}

async function getPublicModels(apinex: string, open: string, app: string, bazaar: string) {
  const models: PublicModel[] = [{ id: "auto", name: "Auto (Recommended)" }];

  if (bazaar) {
    try {
      const { raw } = await listModels(BAZAARLINK_BASE, bazaar, 3500);
      const free = bazaarFreeModels(raw).slice(0, 20);
      for (const item of free) models.push(publicModel("bazaarlink", item.id, item.name));
    } catch {
      models.push(publicModel("bazaarlink", "auto:free", "BazaarLink Auto Free"));
    }
  }

  if (app) {
    let discovered: string[] = [];
    try { discovered = (await listModels(APPMIX_BASE, app, 3000)).ids; } catch {}
    const free = discovered.filter(id => /-free(?:$|\b)/i.test(id) || /free/i.test(id));
    const candidates = uniqueModels([...(free.length ? free : discovered), ...APPMIX_FREE_MODELS]).slice(0, 16);
    for (const model of candidates) models.push(publicModel("appmix", model));
  }

  if (apinex) {
    let discovered: string[] = [];
    try { discovered = (await listModels(APINEX_BASE, apinex, 3000)).ids.filter(id => id.startsWith("free/")); } catch {}
    const candidates = uniqueModels([...discovered, ...APINEX_FALLBACK_MODELS]).slice(0, 16);
    for (const model of candidates) models.push(publicModel("apinex", model));
  }

  if (open) models.push(publicModel("openrouter", "openrouter/free"));
  return models;
}

function parseSelectedModel(value: unknown): SelectedModel | null {
  const id = String(value || "").trim();
  if (!id || id === "auto" || id === "tivals-ai") return null;

  const colon = id.indexOf(":");
  if (colon > 0) {
    const provider = id.slice(0, colon) as ProviderName;
    const model = id.slice(colon + 1);
    if (["bazaarlink", "appmix", "apinex", "openrouter"].includes(provider) && model) {
      return { provider, model };
    }
  }

  // Legacy ids kept for existing browser localStorage values.
  if (id.startsWith("free/")) return { provider: "apinex", model: id };
  if (id === "openrouter/free") return { provider: "openrouter", model: id };
  if (id === "auto:free" || /:free$/i.test(id)) return { provider: "bazaarlink", model: id };
  if (/-free(?:$|\b)/i.test(id)) return { provider: "appmix", model: id };
  return null;
}

async function tryModels(
  provider: ProviderName,
  models: string[],
  run: (model: string) => Promise<string>,
  maxCandidates = 4
) {
  let last = "no_models";
  const candidates = uniqueModels(models).slice(0, maxCandidates);

  for (const model of candidates) {
    try {
      const reply = await run(model);
      return { reply, route: `${provider}:${model}`, model };
    } catch (e) {
      last = safeErr(e);
      if (["rate_limited", "unauthorized", "timeout", "no_credits"].includes(last)) {
        setCooldown(provider, last);
        break;
      }
      if (last !== "model_unavailable") break;
    }
  }
  throw new Error(last);
}

async function callBazaarLink(key: string, prompt: any[], excluded: string[] = []) {
  if (inCooldown("bazaarlink")) throw new Error("cooldown");

  let models: string[] = [];
  if (bazaarWorkingModel) models.push(bazaarWorkingModel);
  try {
    const { raw } = await listModels(BAZAARLINK_BASE, key, 3500);
    models.push(...bazaarFreeModels(raw).map(x => x.id));
  } catch (e) {
    const reason = safeErr(e);
    if (["rate_limited", "unauthorized", "timeout", "no_credits"].includes(reason)) {
      setCooldown("bazaarlink", reason);
      throw new Error(reason);
    }
  }

  models.push("auto:free");
  const excludedSet = new Set(excluded);
  models = uniqueModels(models).filter(m => !excludedSet.has(m));

  const result = await tryModels(
    "bazaarlink",
    models,
    m => callProvider(
      `${BAZAARLINK_BASE}/chat/completions`,
      key,
      m,
      prompt,
      { "X-Free-Fallback": "false" },
      10000
    ),
    3
  );
  bazaarWorkingModel = result.model;
  return result;
}

async function callAppMix(key: string, prompt: any[], excluded: string[] = []) {
  if (inCooldown("appmix")) throw new Error("cooldown");

  let discovered: string[] = [];
  try { discovered = (await listModels(APPMIX_BASE, key, 3000)).ids; }
  catch (e) {
    const reason = safeErr(e);
    if (["rate_limited", "unauthorized", "timeout", "no_credits"].includes(reason)) {
      setCooldown("appmix", reason);
      throw new Error(reason);
    }
  }

  const freeDiscovered = discovered.filter(id => /-free(?:$|\b)/i.test(id) || /free/i.test(id));
  const excludedSet = new Set(excluded);
  const models = uniqueModels([
    ...(appMixWorkingModel ? [appMixWorkingModel] : []),
    ...freeDiscovered,
    ...APPMIX_FREE_MODELS
  ]).filter(m => !excludedSet.has(m));

  const result = await tryModels(
    "appmix",
    models,
    m => callProvider(`${APPMIX_BASE}/chat/completions`, key, m, prompt, {}, 10000),
    7
  );
  appMixWorkingModel = result.model;
  return result;
}

async function callApinex(key: string, prompt: any[], excluded: string[] = []) {
  if (inCooldown("apinex")) throw new Error("cooldown");

  let models: string[] = [];
  if (apinexWorkingModel) models.push(apinexWorkingModel);
  try {
    models.push(...(await listModels(APINEX_BASE, key, 3000)).ids.filter(id => id.startsWith("free/")));
  } catch (e) {
    if (!models.length) {
      const reason = safeErr(e);
      if (["rate_limited", "unauthorized", "timeout", "no_credits"].includes(reason)) {
        setCooldown("apinex", reason);
        throw new Error(reason);
      }
    }
  }

  models.push(...APINEX_FALLBACK_MODELS);
  const excludedSet = new Set(excluded);
  models = uniqueModels(models).filter(m => !excludedSet.has(m));
  if (!models.length) throw new Error("no_free_models");

  const result = await tryModels(
    "apinex",
    models,
    m => callProvider(`${APINEX_BASE}/chat/completions`, key, m, prompt, {}, 9000),
    3
  );
  apinexWorkingModel = result.model;
  return result;
}

async function callOpenRouter(key: string, prompt: any[]) {
  if (inCooldown("openrouter")) throw new Error("cooldown");
  try {
    const reply = await callProvider(
      `${OPENROUTER_BASE}/chat/completions`,
      key,
      "openrouter/free",
      prompt,
      {
        "HTTP-Referer": "https://ai.tivalsdeveloper.site/",
        "X-OpenRouter-Title": "Tivals AI"
      },
      10000
    );
    return { reply, route: "openrouter:openrouter/free", model: "openrouter/free" };
  } catch (e) {
    const reason = safeErr(e);
    if (["rate_limited", "unauthorized", "timeout", "no_credits"].includes(reason)) setCooldown("openrouter", reason);
    throw new Error(reason);
  }
}

async function callSpecificModel(
  selected: SelectedModel,
  prompt: any[],
  keys: { bazaar: string; app: string; apinex: string; apinexBackup: string; open: string }
) {
  const { provider, model } = selected;
  if (inCooldown(provider)) throw new Error("cooldown");

  const key = provider === "bazaarlink" ? keys.bazaar
    : provider === "appmix" ? keys.app
    : provider === "apinex" ? keys.apinex
    : keys.open;
  if (!key) throw new Error("provider_not_configured");

  try {
    if (provider === "bazaarlink") {
      const reply = await callProvider(
        `${BAZAARLINK_BASE}/chat/completions`, key, model, prompt,
        { "X-Free-Fallback": "false" }, 10000
      );
      bazaarWorkingModel = model;
      return { reply, route: `bazaarlink:${model}`, model };
    }
    if (provider === "appmix") {
      const reply = await callProvider(`${APPMIX_BASE}/chat/completions`, key, model, prompt, {}, 10000);
      appMixWorkingModel = model;
      return { reply, route: `appmix:${model}`, model };
    }
    if (provider === "apinex") {
      const apinexKeys = [keys.apinex, keys.apinexBackup].filter(Boolean);
      if (!apinexKeys.length) throw new Error("provider_not_configured");
      let lastError: unknown = new Error("provider_not_configured");
      for (let i = 0; i < apinexKeys.length; i++) {
        try {
          const reply = await callProvider(`${APINEX_BASE}/chat/completions`, apinexKeys[i], model, prompt, {}, 9000);
          apinexWorkingModel = model;
          return { reply, route: `apinex${i === 0 ? "" : "-backup"}:${model}`, model };
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    }
    return await callOpenRouter(key, prompt);
  } catch (e) {
    const reason = safeErr(e);
    if (["rate_limited", "unauthorized", "timeout", "no_credits"].includes(reason)) setCooldown(provider, reason);
    throw new Error(reason);
  }
}

async function providerStatus(keys: { bazaar: string; app: string; apinex: string; apinexBackup: string; open: string }) {
  const providers: any[] = [];

  if (keys.bazaar) {
    try {
      const { raw } = await listModels(BAZAARLINK_BASE, keys.bazaar, 3500);
      providers.push({
        name: "BazaarLink",
        configured: true,
        free_models_visible: bazaarFreeModels(raw).length,
        cooldown_ms: Math.max(0, cooldownUntil.bazaarlink - Date.now())
      });
    } catch (e) {
      providers.push({ name: "BazaarLink", configured: true, error: safeErr(e) });
    }
  } else providers.push({ name: "BazaarLink", configured: false });

  if (keys.app) {
    try {
      const models = (await listModels(APPMIX_BASE, keys.app, 3000)).ids;
      providers.push({ name: "AppMix", configured: true, models_visible: models.length, cooldown_ms: Math.max(0, cooldownUntil.appmix - Date.now()) });
    } catch (e) {
      providers.push({ name: "AppMix", configured: true, error: safeErr(e) });
    }
  } else providers.push({ name: "AppMix", configured: false });

  if (keys.apinex || keys.apinexBackup) {
    let primaryOk = false;
    let backupOk = false;
    let visible = 0;
    let lastError = "";
    if (keys.apinex) {
      try {
        const models = (await listModels(APINEX_BASE, keys.apinex, 3000)).ids.filter(id => id.startsWith("free/"));
        visible = Math.max(visible, models.length);
        primaryOk = true;
      } catch (e) { lastError = safeErr(e); }
    }
    if (keys.apinexBackup) {
      try {
        const models = (await listModels(APINEX_BASE, keys.apinexBackup, 3000)).ids.filter(id => id.startsWith("free/"));
        visible = Math.max(visible, models.length);
        backupOk = true;
      } catch (e) { if (!lastError) lastError = safeErr(e); }
    }
    providers.push({
      name: "Apinex",
      configured: true,
      primary_configured: Boolean(keys.apinex),
      backup_configured: Boolean(keys.apinexBackup),
      primary_ok: primaryOk,
      backup_ok: backupOk,
      free_models_visible: visible,
      cooldown_ms: Math.max(0, cooldownUntil.apinex - Date.now()),
      ...(primaryOk || backupOk || !lastError ? {} : { error: lastError })
    });
  } else providers.push({ name: "Apinex", configured: false, backup_configured: false });

  providers.push(keys.open
    ? { name: "OpenRouter", configured: true, cooldown_ms: Math.max(0, cooldownUntil.openrouter - Date.now()) }
    : { name: "OpenRouter", configured: false });

  return providers;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const widgetKey = url.searchParams.get("widget") || "";
  const origin = req.headers.get("Origin") || "";
  let widget: WidgetConfig | null = null;

  if (widgetKey) {
    try { widget = await loadWidget(widgetKey); }
    catch { return json({ error: "Widget configuration could not be loaded." }, 503, origin); }
    if (!widget || !widget.is_active) return json({ error: "This widget is inactive or invalid." }, 403, origin);
    if (!domainAllowed(origin, widget.allowed_domains)) return json({ error: "This domain is not authorized to use this Tivals AI widget.", code: "DOMAIN_NOT_ALLOWED" }, 403, origin);
  }

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(widget ? origin : "") });

  const keys = {
    bazaar: Deno.env.get("BAZAARLINK_API_KEY") || "",
    app: Deno.env.get("APPMIX_API_KEY") || "",
    apinex: Deno.env.get("APINEX_API_KEY") || "",
    apinexBackup: Deno.env.get("APINEX_API_KEY_BACKUP") || "",
    open: Deno.env.get("OPENROUTER_API_KEY") || ""
  };

  if (req.method === "GET") {
    const u = url;

    if (u.searchParams.get("models") === "1") {
      const models = await getPublicModels(keys.apinex || keys.apinexBackup, keys.open, keys.app, keys.bazaar);
      return json({ ok: true, version: VERSION, models, count: models.length });
    }

    if (u.searchParams.get("health") === "1") {
      return json({
        ok: true,
        service: "tivals-ai-chat",
        version: VERSION,
        routing: "sequential",
        provider_racing: false,
        completion_tested: false,
        note: "Health checks only list provider/model availability and do not send AI completion requests.",
        providers: await providerStatus(keys)
      });
    }

    return json({
      ok: true,
      service: "tivals-ai-chat",
      version: VERSION,
      routing: "sequential",
      provider_racing: false,
      selected_model_supported: true,
      configured_providers: [
        ...(keys.bazaar ? ["BazaarLink"] : []),
        ...(keys.app ? ["AppMix"] : []),
        ...(keys.apinex || keys.apinexBackup ? ["Apinex"] : []),
        ...(keys.open ? ["OpenRouter"] : [])
      ]
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON request." }, 400); }

  const messages = cleanMessages(body?.messages);
  if (!messages.length && body?.message) messages.push({ role: "user", content: String(body.message).slice(0,16000) });
  if (!messages.length) return json({ error: "Please enter a message." }, 400);

  const system = {
    role: "system",
    content: widget ? widgetSystem(widget) : "You are Tivals AI, a capable general-purpose assistant. Give accurate, direct, phone-friendly answers. Use Markdown. For learning requests, teach one focused lesson at a time and include a short practice task."
  };
  const prompt = [system, ...messages.filter((m:any) => m.role !== "system")];
  if (widget) adminClient()?.rpc("record_widget_request", { p_public_key: widget.public_key }).then(() => {}).catch(() => {});
  const selected = parseSelectedModel(body?.model);
  const failures: { provider: string; error: string }[] = [];
  const excluded: Partial<Record<ProviderName,string[]>> = {};

  if (selected) {
    try {
      const result = await callSpecificModel(selected, prompt, keys);
      return json({ reply: result.reply, model: selected.model, provider: providerLabel(selected.provider), route: result.route, selected: true }, 200, widget ? origin : "");
    } catch (e) {
      failures.push({ provider: `${providerLabel(selected.provider)}:${selected.model}`, error: safeErr(e) });
      excluded[selected.provider] = [selected.model];
    }
  }

  // Sequential fallback. BazaarLink is first because its auto:free route is designed
  // specifically for free model selection and X-Free-Fallback:false prevents paid fallback.
  if (keys.bazaar) {
    try {
      const result = await callBazaarLink(keys.bazaar, prompt, excluded.bazaarlink || []);
      return json({ reply: result.reply, model: result.model, provider: "BazaarLink", route: result.route, fallback: !!selected }, 200, widget ? origin : "");
    } catch (e) { failures.push({ provider: "BazaarLink", error: safeErr(e) }); }
  }

  if (keys.app) {
    try {
      const result = await callAppMix(keys.app, prompt, excluded.appmix || []);
      return json({ reply: result.reply, model: result.model, provider: "AppMix", route: result.route, fallback: !!selected }, 200, widget ? origin : "");
    } catch (e) { failures.push({ provider: "AppMix", error: safeErr(e) }); }
  }

  if (keys.apinex || keys.apinexBackup) {
    if (keys.apinex) {
      try {
        const result = await callApinex(keys.apinex, prompt, excluded.apinex || []);
        return json({ reply: result.reply, model: result.model, provider: "Apinex", route: result.route, fallback: !!selected }, 200, widget ? origin : "");
      } catch (e) { failures.push({ provider: "Apinex primary", error: safeErr(e) }); }
    }
    if (keys.apinexBackup) {
      try {
        cooldownUntil.apinex = 0;
        const result = await callApinex(keys.apinexBackup, prompt, excluded.apinex || []);
        return json({ reply: result.reply, model: result.model, provider: "Apinex Backup", route: result.route.replace("apinex:", "apinex-backup:"), fallback: true }, 200, widget ? origin : "");
      } catch (e) { failures.push({ provider: "Apinex backup", error: safeErr(e) }); }
    }
  }

  if (keys.open) {
    try {
      const result = await callOpenRouter(keys.open, prompt);
      return json({ reply: result.reply, model: result.model, provider: "OpenRouter", route: result.route, fallback: !!selected }, 200, widget ? origin : "");
    } catch (e) { failures.push({ provider: "OpenRouter", error: safeErr(e) }); }
  }

  if (!keys.bazaar && !keys.app && !keys.apinex && !keys.apinexBackup && !keys.open) {
    return json({ reply: "Tivals AI is not configured yet. Please add at least one AI provider key.", model: "system", provider: "Tivals AI", code: "NO_PROVIDER_KEYS" }, 200);
  }

  // Return a single friendly reply instead of a failing HTTP status. The website has an
  // older client-side retry loop; a 200 reply prevents it from repeatedly hitting every
  // model/provider again when all providers are already unavailable.
  return json({
    reply: "All configured AI providers are currently unavailable or rate-limited. Please try again shortly.",
    model: "system",
    provider: "Tivals AI",
    code: "ALL_PROVIDERS_FAILED",
    failures
  }, 200);
});
