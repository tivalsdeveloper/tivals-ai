const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

const APINEX_BASE = "https://api.apinex.bond/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const APPMIX_BASE = "https://api.apmix.ai/v1";
const VERSION = 21;

type ProviderName = "apinex" | "openrouter" | "appmix";
const cooldownUntil: Record<ProviderName, number> = {
  apinex: 0,
  openrouter: 0,
  appmix: 0
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

function replyFrom(d: any) {
  const c = d?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c.map((x:any) => typeof x === "string" ? x : x?.text || "").join("").trim();
  }
  return "";
}

function cleanMessages(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v
    .slice(-16)
    .map((m:any) => ({
      role: ["assistant", "system"].includes(m?.role) ? m.role : "user",
      content: String(m?.content || "").slice(0, 16000)
    }))
    .filter((m:any) => m.content);
}

async function fetchJson(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    const raw = await r.text();
    let d: any = {};
    try { d = JSON.parse(raw); }
    catch { d = { error: { message: raw } }; }
    return { r, d };
  } finally {
    clearTimeout(t);
  }
}

function safeErr(e: unknown) {
  const s = String((e as Error)?.message || e || "");
  if (/abort|timeout|timed out/i.test(s)) return "timeout";
  if (/401|unauthor|invalid api|invalid key|key_expired/i.test(s)) return "unauthorized";
  if (/429|rate|quota|allowance|limit/i.test(s)) return "rate_limited";
  if (/model.*not.*found|unknown model|retired model/i.test(s)) return "model_unavailable";
  if (/no_models_returned|no_free_models/i.test(s)) return s;
  return s.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180) || "failed";
}

function maybeCooldown(provider: ProviderName, reason: string) {
  if (reason === "rate_limited") cooldownUntil[provider] = Date.now() + 5 * 60_000;
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
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3
    })
  }, timeout);

  if (!r.ok) throw new Error(d?.error?.message || d?.message || `HTTP ${r.status}`);
  const reply = replyFrom(d);
  if (!reply) throw new Error("empty response");
  return reply;
}

function modelIds(d: any) {
  const raw = Array.isArray(d)
    ? d
    : Array.isArray(d?.data)
      ? d.data
      : Array.isArray(d?.models)
        ? d.models
        : Array.isArray(d?.result)
          ? d.result
          : [];
  return raw
    .map((x:any) => typeof x === "string" ? x : String(x?.id || x?.model || x?.name || ""))
    .filter(Boolean);
}

async function listModels(base: string, key: string, timeout = 3500) {
  const { r, d } = await fetchJson(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` }
  }, timeout);
  if (!r.ok) throw new Error(d?.error?.message || d?.message || `HTTP ${r.status}`);
  return modelIds(d);
}

async function tryModelsSequentially(
  provider: ProviderName,
  models: string[],
  run: (model: string) => Promise<string>
) {
  if (!models.length) throw new Error("no_models_returned");
  const candidates = models.slice(0, 2);
  let last = "failed";

  for (let i = 0; i < candidates.length; i++) {
    try {
      return {
        reply: await run(candidates[i]),
        route: `${provider}:${candidates[i]}`
      };
    } catch (e) {
      last = safeErr(e);
      maybeCooldown(provider, last);
      if (last !== "model_unavailable") break;
    }
  }

  throw new Error(last);
}

async function callApinex(key: string, prompt: any[]) {
  if (inCooldown("apinex")) throw new Error("cooldown");
  const models = (await listModels(APINEX_BASE, key))
    .filter((id:string) => id.startsWith("free/"));
  if (!models.length) throw new Error("no_free_models");

  return tryModelsSequentially(
    "apinex",
    models,
    model => callProvider(`${APINEX_BASE}/chat/completions`, key, model, prompt, {}, 9000)
  );
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
    return { reply, route: "openrouter:free" };
  } catch (e) {
    const reason = safeErr(e);
    maybeCooldown("openrouter", reason);
    throw new Error(reason);
  }
}

async function callAppMix(key: string, prompt: any[]) {
  if (inCooldown("appmix")) throw new Error("cooldown");
  let all: string[];
  try {
    all = await listModels(APPMIX_BASE, key);
  } catch (e) {
    const reason = safeErr(e);
    maybeCooldown("appmix", reason);
    throw new Error(reason);
  }

  const free = all.filter((id:string) => /-free(?:$|\b)/i.test(id) || /free/i.test(id));
  const models = free.length ? free : all;
  if (!models.length) throw new Error("no_models_returned");

  return tryModelsSequentially(
    "appmix",
    models,
    model => callProvider(`${APPMIX_BASE}/chat/completions`, key, model, prompt, {}, 9500)
  );
}

async function safeHealth(apinex: string, open: string, app: string) {
  const results: any[] = [];

  if (apinex) {
    try {
      const models = (await listModels(APINEX_BASE, apinex, 3000)).filter((id:string) => id.startsWith("free/"));
      results.push({
        name: "Apinex",
        configured: true,
        completion_tested: false,
        free_models_visible: models.length,
        cooldown_ms: Math.max(0, cooldownUntil.apinex - Date.now())
      });
    } catch (e) {
      results.push({ name: "Apinex", configured: true, completion_tested: false, error: safeErr(e) });
    }
  } else {
    results.push({ name: "Apinex", configured: false });
  }

  if (open) {
    results.push({
      name: "OpenRouter",
      configured: true,
      completion_tested: false,
      cooldown_ms: Math.max(0, cooldownUntil.openrouter - Date.now())
    });
  } else {
    results.push({ name: "OpenRouter", configured: false });
  }

  if (app) {
    try {
      const models = await listModels(APPMIX_BASE, app, 3000);
      results.push({
        name: "AppMix",
        configured: true,
        completion_tested: false,
        models_visible: models.length,
        cooldown_ms: Math.max(0, cooldownUntil.appmix - Date.now())
      });
    } catch (e) {
      results.push({ name: "AppMix", configured: true, completion_tested: false, error: safeErr(e) });
    }
  } else {
    results.push({ name: "AppMix", configured: false });
  }

  return results;
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
        note: "This health check does not send AI completion requests or consume model quota.",
        providers: await safeHealth(apinex, open, app)
      });
    }

    return json({
      ok: true,
      service: "tivals-ai-chat",
      version: VERSION,
      routing: "sequential",
      provider_racing: false,
      configured_providers: [
        ...(apinex ? ["Apinex"] : []),
        ...(open ? ["OpenRouter"] : []),
        ...(app ? ["AppMix"] : [])
      ]
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON request." }, 400); }

  const messages = cleanMessages(body?.messages);
  if (!messages.length && body?.message) {
    messages.push({ role: "user", content: String(body.message).slice(0,16000) });
  }
  if (!messages.length) return json({ error: "Please enter a message." }, 400);

  const system = {
    role: "system",
    content: "You are Tivals AI, a capable general-purpose assistant. Give accurate, direct, phone-friendly answers. Use Markdown. For learning requests, teach one focused lesson at a time and include a short practice task."
  };
  const prompt = [system, ...messages.filter((m:any) => m.role !== "system")];

  const failures: { provider: string, error: string }[] = [];

  if (apinex) {
    try {
      const result = await callApinex(apinex, prompt);
      return json({ reply: result.reply, model: "tivals-ai", provider: "Tivals AI", route: result.route });
    } catch (e) {
      failures.push({ provider: "Apinex", error: safeErr(e) });
    }
  }

  if (open) {
    try {
      const result = await callOpenRouter(open, prompt);
      return json({ reply: result.reply, model: "tivals-ai", provider: "Tivals AI", route: result.route });
    } catch (e) {
      failures.push({ provider: "OpenRouter", error: safeErr(e) });
    }
  }

  if (app) {
    try {
      const result = await callAppMix(app, prompt);
      return json({ reply: result.reply, model: "tivals-ai", provider: "Tivals AI", route: result.route });
    } catch (e) {
      failures.push({ provider: "AppMix", error: safeErr(e) });
    }
  }

  if (!apinex && !open && !app) {
    return json({ error: "Tivals AI is not configured.", code: "NO_PROVIDER_KEYS" }, 503);
  }

  return json({
    error: "All configured AI providers are currently unavailable. Please try again shortly.",
    code: "ALL_PROVIDERS_FAILED",
    failures
  }, 502);
});