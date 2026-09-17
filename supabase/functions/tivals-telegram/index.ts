import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TELEGRAM_API = "https://api.telegram.org";
const TIVALS_AI_URL = "https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function splitTelegramText(text: string, limit = 4000) {
  const clean = String(text || "").trim();
  if (!clean) return ["I couldn't generate a response. Please try again."];
  if (clean.length <= limit) return [clean];

  const parts: string[] = [];
  let remaining = clean;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");

  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.description || `Telegram ${method} failed (${response.status}).`);
  }
  return data;
}

async function askTivalsAI(message: string) {
  const response = await fetch(TIVALS_AI_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.reply) {
    throw new Error(data?.error || `Tivals AI failed (${response.status}).`);
  }
  return String(data.reply);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "Tivals AI Telegram webhook" });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
  if (expectedSecret) {
    const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (receivedSecret !== expectedSecret) return json({ error: "Unauthorized webhook." }, 401);
  }

  if (!Deno.env.get("TELEGRAM_BOT_TOKEN")) {
    return json({ error: "Telegram bot token is not configured." }, 503);
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return json({ error: "Invalid Telegram update." }, 400);
  }

  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();

  if (!chatId || !text) return json({ ok: true, ignored: true });

  try {
    if (text === "/start" || text.startsWith("/start ")) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Hi! I’m Tivals AI. Send me a question and I’ll help with coding, writing, learning, research and more.",
      });
      return json({ ok: true });
    }

    if (text === "/help") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Send any text question to chat with Tivals AI. Commands: /start, /help.",
      });
      return json({ ok: true });
    }

    await telegram("sendChatAction", { chat_id: chatId, action: "typing" });
    const reply = await askTivalsAI(text);

    for (const part of splitTelegramText(reply)) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: part,
        disable_web_page_preview: true,
      });
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error", error);
    try {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Tivals AI is temporarily unavailable. Please try again shortly.",
      });
    } catch {
      // Ignore secondary Telegram failures so the webhook still responds.
    }
    return json({ ok: false, error: String((error as Error)?.message || error) }, 200);
  }
});
