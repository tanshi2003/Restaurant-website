const ALLOWED_ORIGINS = new Set([
  "https://tanshi2003.github.io"
]);

const rateBuckets = new Map();

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function corsHeaders(origin) {
  if (!origin) return {};
  const local = /^http:\/\/localhost(?::\d+)?$/i.test(origin);
  const vercel = /^https:\/\/[a-z0-9.-]+\.vercel\.app$/i.test(origin);
  if (!ALLOWED_ORIGINS.has(origin) && !local && !vercel) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function readModel() {
  const value = String(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
  return /^[a-zA-Z0-9._-]{3,100}$/.test(value) ? value : "gemini-3.5-flash-lite";
}

function buildMenuContext(rawMenu) {
  if (!Array.isArray(rawMenu)) return [];
  return rawMenu.slice(0, 30).map((dish) => ({
    name: String(dish?.name || "").slice(0, 100),
    category: String(dish?.category || "").slice(0, 60),
    section: String(dish?.section || "").slice(0, 80),
    subcategory: String(dish?.subcategory || "").slice(0, 60),
    price: Number.isFinite(Number(dish?.price)) ? Number(dish.price) : null,
    diet: dish?.diet === "nonveg"
      ? "Non-veg"
      : dish?.diet === "unknown"
        ? "Check with kitchen"
        : "Veg",
    description: String(dish?.description || "").slice(0, 200)
  })).filter((dish) => dish.name);
}

function buildHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  const history = [];
  let previousRole = null;

  for (const item of rawHistory.slice(-10)) {
    if (!item || (item.role !== "user" && item.role !== "model") || typeof item.text !== "string") continue;
    const text = item.text.trim().slice(0, 1200);
    if (!text || item.role === previousRole) continue;
    history.push({ role: item.role, parts: [{ text }] });
    previousRole = item.role;
  }

  while (history.length && history[0].role === "model") history.shift();
  return history;
}

const SYSTEM_PROMPT = [
  "You are Olive, the friendly AI food guide for Saffron & Stone, a multi-cuisine restaurant and premium cafe.",
  "Help guests understand dishes, common ingredients, flavours, cuisine styles, dietary labels and decide what to order.",
  "Be conversational and remember the conversation history. Ask one short follow-up question when useful.",
  "The supplied MENU CONTEXT is the only source of truth for this restaurant's listed dish names, prices, categories and dietary labels. Never invent restaurant dishes, prices, availability or dietary claims.",
  "You may explain what a dish traditionally is and what it usually tastes like using general culinary knowledge. Mention that exact restaurant preparation can vary.",
  "If dietary status says Check with kitchen, do not label it vegetarian or non-vegetarian. Advise the guest to confirm with restaurant staff.",
  "Never guess about allergens, cross-contamination, Jain suitability, halal status or exact preparation. Ask the guest to confirm these with the kitchen.",
  "Recommend up to three dishes from the supplied menu. Include listed prices and dietary labels where useful.",
  "For unrelated questions, gently guide the conversation back to food.",
  "Never claim to place an order, reserve a table, take payment or confirm stock.",
  "Keep replies warm, useful and concise, usually 2 to 5 sentences."
].join("\n");

export default {
  async fetch(request) {
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin);

    if (cors === null) {
      return json({ code: "ORIGIN_NOT_ALLOWED", error: "This website is not allowed to use Olive." }, 403);
    }

    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors || {} });
    }

    if (method === "GET") {
      const configured = Boolean(String(process.env.GEMINI_API_KEY || "").trim());
      return json({
        service: "Olive AI food guide",
        status: configured ? "online" : "needs_configuration",
        configured,
        provider: "Google Gemini",
        model: readModel()
      }, 200, cors || {});
    }

    if (method !== "POST") {
      return json({ code: "METHOD_NOT_ALLOWED", error: "Use POST to send Olive a message." }, 405, cors || {});
    }

    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return json({
        code: "API_KEY_MISSING",
        error: "GEMINI_API_KEY is not configured in the Vercel project."
      }, 503, cors || {});
    }

    const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ip = forwarded || "unknown";
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || { start: now, count: 0 };

    if (now - bucket.start > 60000) {
      bucket.start = now;
      bucket.count = 0;
    }
    bucket.count++;
    rateBuckets.set(ip, bucket);

    if (bucket.count > 20) {
      return json({
        code: "RATE_LIMITED",
        error: "A few too many messages arrived together. Please wait a minute and try again."
      }, 429, cors || {});
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ code: "INVALID_JSON", error: "The chat request was not valid JSON." }, 400, cors || {});
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ code: "INVALID_REQUEST", error: "The chat request is missing its message." }, 400, cors || {});
    }

    const contents = buildHistory(body.history);
    if (!contents.length || contents[contents.length - 1].role !== "user") {
      return json({ code: "MESSAGE_REQUIRED", error: "Type a food question to start chatting with Olive." }, 400, cors || {});
    }

    const menu = buildMenuContext(body.menuContext);
    if (!menu.length) {
      return json({ code: "MENU_CONTEXT_MISSING", error: "The menu did not load correctly. Refresh the page and try again." }, 400, cors || {});
    }

    const model = readModel();
    const systemInstruction = SYSTEM_PROMPT + "\n\nMENU CONTEXT:\n" + JSON.stringify(menu);
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      let upstream;

      try {
        upstream = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: { maxOutputTokens: 520 }
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const result = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        const providerStatus = String(result?.error?.status || "");
        const providerMessage = String(result?.error?.message || "");

        if (upstream.status === 401 || upstream.status === 403) {
          return json({
            code: "API_KEY_REJECTED",
            error: "Google rejected the Gemini API key. Check its value and Gemini API permissions in Vercel."
          }, 502, cors || {});
        }

        if (upstream.status === 404) {
          return json({
            code: "MODEL_NOT_FOUND",
            error: "The configured Gemini model was not found. Remove GEMINI_MODEL in Vercel to use the default model."
          }, 502, cors || {});
        }

        if (upstream.status === 429 || providerStatus === "RESOURCE_EXHAUSTED") {
          return json({
            code: "GEMINI_QUOTA",
            error: "Gemini has reached a quota or rate limit. Check Google AI Studio usage and try again later."
          }, 429, cors || {});
        }

        console.error("Gemini request failed:", upstream.status, providerMessage.slice(0, 400));
        return json({
          code: "GEMINI_UPSTREAM",
          error: "Google Gemini could not answer right now. Please try again in a moment."
        }, 502, cors || {});
      }

      const candidate = result?.candidates?.[0];
      const reply = (candidate?.content?.parts || [])
        .map((part) => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim();

      if (!reply) {
        if (candidate?.finishReason === "SAFETY") {
          return json({
            code: "RESPONSE_BLOCKED",
            error: "I couldn't answer that wording. Try asking about a dish or cuisine."
          }, 422, cors || {});
        }

        return json({
          code: "EMPTY_MODEL_RESPONSE",
          error: "Gemini returned an empty answer. Please try your question again."
        }, 502, cors || {});
      }

      return json({ reply, model }, 200, cors || {});
    } catch (error) {
      if (error?.name === "AbortError") {
        return json({
          code: "GEMINI_TIMEOUT",
          error: "Gemini took too long to answer. Please try again."
        }, 504, cors || {});
      }

      console.error("Olive API error:", error?.message || error);
      return json({
        code: "OLIVE_SERVER_ERROR",
        error: "Olive hit a server error. Please try again in a moment."
      }, 500, cors || {});
    }
  }
};
