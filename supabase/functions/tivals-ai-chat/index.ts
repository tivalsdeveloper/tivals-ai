const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

const APINEX_BASE = "https://api.apinex.bond/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const APPMIX_BASE = "https://api.apmix.ai/v1";
const VERSION = 22;

// Current AppMix free model ids from the provider catalog. These are only used
// as a recovery list when /v1/models does not return a parseable list.
const APPMIX_FREE_MODELS = [
  "anthropic/claude-sonnet-4-6-free",
  "anthropic/claude-opus-5-free",
  "anthropic/claude-opus-4-8-free",
  "anthropic/claude-opus-4-7-free",
  "google/gemini-3-flash-preview-free",
  "zai/glm-5.2-free",
  "openai/gpt-4.1-free"
];

type ProviderName = "appmix" | "apinex" | "openrouter";
const cooldownUntil: Record<ProviderName, number> = { appmix: 0, apinex: 0, openrouter: 0 };
let appMixWorkingModel = "";
let apinexWorkingModel = "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
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
  if (Array.isArray(c)) return c.map((x:any) => typeof x === "string" ? x : x?.text || "").join("").trim();
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
  if (/429|rate|quota|allowance|insufficient_quota|allowance_exhausted|limit/i.test(s)) return "rate_limited";
  if (/model.*not.*found|unknown model|retired model|model_unavailable/i.test(s)) return "model_unavailable";
  if (/no_models|no_free_models/i.test(s)) return s;
  return s.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180) || "failed";
}

function setCooldown(provider: ProviderName, reason: string) {
  if (reason === "rate_limited") cooldownUntil[provider] = Date.now() + 10 * 60_000;
  else if (reason === "unauthorized") cooldownUntil[provider] = Date.now() + 30 * 60_000;
  else if (reason === "timeout") cooldownUntil[provider] = Date.now() + 60_000;
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
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
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
  if (!r.ok) throw new Error(`${r.status} ${d?.error?.code || ""} ${d?.error?.message || d?.message || "models request failed"}`.trim());
  return extractModelIds(d);
}

async function tryModels(
  provider: ProviderName,
  models: string[],
  run: (model: string) => Promise<string>,
  maxCandidates = 4
) {
  let last = "no_models";
  const seen = new Set<string>();
  const candidates = models.filter(m => m && !seen.has(m) && seen.add(m)).slice(0, maxCandidates);
  for (const model of candidates) {
    try {
      const reply = await run(model);
      return { reply, route: `${provider}:${model}`, model };
    } catch (e) {
      last = safeErr(e);
      if (last === "rate_limited" || last === "unauthorized" || last === "timeout") {
        setCooldown(provider, last);
        break;
      }
      // Only try another model when the model itself is unavailable.
      if (last !== "model_unavailable") break;
    }
  }
  throw new Error(last);
}

async function callAppMix(key: string, prompt: any[]) {
  if (inCooldown("appmix")) throw new Error("cooldown");

  let discovered: string[] = [];
  try { discovered = await listModels(APPMIX_BASE, key, 3000); }
  catch (e) {
    const reason = safeErr(e);
    if (reason === "rate_limited" || reason === "unauthorized" || reason === "timeout") {
      setCooldown("appmix", reason);
      throw new Error(reason);
    }
  }

  const freeDiscovered = discovered.filter(id => /-free(?:$|\b)/i.test(id) || /free/i.test(id));
  const models = [
    ...(appMixWorkingModel ? [appMixWorkingModel] : []),
    ...freeDiscovered,
    ...APPMIX_FREE_MODELS
  ];

  const result = await tryModels(
    "appmix",
    models,
    m => callProvider(`${APPMIX_BASE}/chat/completions`, key, m, prompt, {}, 10000),
    7
  );
  appMixWorkingModel = result.model;
  return result;
}

async function callApinex(key: string, prompt: any[]) {
  if (inCooldown("apinex")) throw new Error("cooldown");

  let models: string[] = [];
  if (apinexWorkingModel) models.push(apinexWorkingModel);
  if (!apinexWorkingModel) {
    try {
      models = (await listModels(APINEX_BASE, key, 3000)).filter(id => id.startsWith("free/"));
    } catch (e) {
      const reason = safeErr(e);
      setCooldown("apinex", reason);
      throw new Error(reason);
    }
  }
  if (!models.length) throw new Error("no_free_models");

  const result = await tryModels(
    "apinex",
    models,
    m => callProvider(`${APINEX_BASE}/chat/completions`, key, m, prompt, {}, 9000),
    2
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
    return { reply, route: "openrouter:free", model: "openrouter/free" };
  } catch (e) {
    const reason = safeErr(e);
    setCooldown("openrouter", reason);
    throw new Error(reason);
  }
}

async function providerStatus(apinex: string, open: string, app: string) {
  const providers: any[] = [];

  if (app) {
    try {
      const models = await listModels(APPMIX_BASE, app, 3000);
      providers.push({ name: "AppMix", configured: true, models_visible: models.length, recovery_models: APPMIX_FREE_MODELS.length, cooldown_ms: Math.max(0, cooldownUntil.appmix - Date.now()) });
    } catch (e) {
      providers.push({ name: "AppMix", configured: true, error: safeErr(e), recovery_models: APPMIX_FREE_MODELS.length });
    }
  } else providers.push({ name: "AppMix", configured: false });

  if (apinex) {
    try {
      const models = (await listModels(APINEX_BASE, apinex, 3000)).filter(id => id.startsWith("free/"));
      providers.push({ name: "Apinex", configured: true, free_models_visible: models.length, cooldown_ms: Math.max(0, cooldownUntil.apinex - Date.now()) });
    } catch (e) {
      providers.push({ name: "Apinex", configured: true, error: safeErr(e) });
    }
  } else providers.push({ name: "Apinex", configured: false });

  providers.push(open
    ? { name: "OpenRouter", configured: true, cooldown_ms: Math.max(0, cooldownUntil.openrouter - Date.now()) }
    : { name: "OpenRouter", configured: false });

  return providers;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const apinex = Deno.env.get("APINEX_API_KEY") || "";
  const open = Deno.env.get("OPENROUTER_API_KEY") || "";
  const app = Deno.env.get("APPMIX_API_KEY") || "";

  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("health") === "1") {
      return json({
        ok: true,
        service: "tivals-ai-chat",
        version: VERSION,
        routing: "sequential",
        provider_racing: false,
        completion_tested: false,
        note: "Health checks do not consume AI completions.",
        providers: await providerStatus(apinex, open, app)
      });
    }
    return json({ ok: true, service: "tivals-ai-chat", version: VERSION, routing: "sequential", provider_racing: false });
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
    content: "You are Tivals AI, a capable general-purpose assistant. Give accurate, direct, phone-friendly answers. Use Markdown. For learning requests, teach one focused lesson at a time and include a short practice task."
  };
  const prompt = [system, ...messages.filter((m:any) => m.role !== "system")];
  const failures: { provider: string, error: string }[] = [];

  // AppMix first during recovery because the previous Telegram regression exhausted
  // the other free-provider rate limits. Providers are still called one at a time.
  if (app) {
    try {
      const result = await callAppMix(app, prompt);
      return json({ reply: result.reply, model: "tivals-ai", provider: "Tivals AI", route: result.route });
    } catch (e) { failures.push({ provider: "AppMix", error: safeErr(e) }); }
  }

  if (apinex) {
    try {
      const result = await callApinex(apinex, prompt);
      return json({ reply: result.reply, model: "tivals-ai", provider: "Tivals AI", route: result.route });
    } catch (e) { failures.push({ provider: "Apinex", error: safeErr(e) }); }
  }

  if (open) {
    try {
      const result = await callOpenRouter(open, prompt);
      return json({ reply: result.reply, model: "tivals-ai", provider: "Tivals AI", route: result.route });
    } catch (e) { failures.push({ provider: "OpenRouter", error: safeErr(e) }); }
  }

  if (!app && !apinex && !open) return json({ error: "Tivals AI is not configured.", code: "NO_PROVIDER_KEYS" }, 503);

  return json({
    error: "All configured AI providers are currently unavailable. Please try again shortly.",
    code: "ALL_PROVIDERS_FAILED",
    failures
  }, 502);
});
