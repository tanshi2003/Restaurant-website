"use strict";

const rateBuckets = new Map();
const ALLOWED_ORIGINS = new Set([
  "https://tanshi2003.github.io"
]);

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function getAllowedOrigin(origin) {
  if (!origin) return "";
  const isLocal = /^http:\/\/localhost(?::\d+)?$/i.test(origin);
  const isVercel = /^https:\/\/[a-z0-9.-]+\.vercel\.app$/i.test(origin);
  return ALLOWED_ORIGINS.has(origin) || isLocal || isVercel ? origin : "";
}

function safeModelName() {
  const configured = String(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
  return /^[a-zA-Z0-9._-]{3,100}$/.test(configured) ? configured : "gemini-3.5-flash-lite";
}

module.exports = async function handler(req, res) {
  const origin = String(req.headers.origin || "");
  const allowedOrigin = getAllowedOrigin(origin);

  if (origin && !allowedOrigin) {
    return send(res, 403, { code: "ORIGIN_NOT_ALLOWED", error: "This website is not allowed to use Olive." });
  }

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = safeModelName();

  // Safe diagnostic endpoint: reports configuration state, never the secret itself.
  if (req.method === "GET") {
    return send(res, 200, {
      service: "Olive AI food guide",
      status: apiKey ? "online" : "needs_configuration",
      configured: Boolean(apiKey),
      provider: "Google Gemini",
      model
    });
  }

  if (req.method !== "POST") {
    return send(res, 405, { code: "METHOD_NOT_ALLOWED", error: "Use POST to send Olive a message." });
  }

  if (!apiKey) {
    return send(res, 503, {
      code: "API_KEY_MISSING",
      error: "GEMINI_API_KEY is not configured in the Vercel project."
    });
  }

  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || String(req.socket?.remoteAddress || "unknown");
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start > 60000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count++;
  rateBuckets.set(ip, bucket);

  if (bucket.count > 20) {
    return send(res, 429, { code: "RATE_LIMITED", error: "A few too many messages arrived together. Please wait a minute and try again." });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return send(res, 400, { code: "INVALID_JSON", error: "The chat request was not valid JSON." });
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return send(res, 400, { code: "INVALID_REQUEST", error: "The chat request is missing its message." });
  }

  const rawHistory = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const contents = [];
  let previousRole = null;

  for (const item of rawHistory) {
    if (!item || (item.role !== "user" && item.role !== "model") || typeof item.text !== "string") continue;
    const text = item.text.trim().slice(0, 1200);
    if (!text || item.role === previousRole) continue;
    contents.push({ role: item.role, parts: [{ text }] });
    previousRole = item.role;
  }

  while (contents.length && contents[0].role === "model") contents.shift();

  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return send(res, 400, { code: "MESSAGE_REQUIRED", error: "Type a food question to start chatting with Olive." });
  }

  const menu = Array.isArray(body.menuContext)
    ? body.menuContext.slice(0, 30).map((dish) => ({
        name: String(dish?.name || "").slice(0, 100),
        category: String(dish?.category || "").slice(0, 60),
        section: String(dish?.section || "").slice(0, 80),
        subcategory: String(dish?.subcategory || "").slice(0, 60),
        price: Number.isFinite(Number(dish?.price)) ? Number(dish.price) : null,
        diet: dish?.diet === "nonveg" ? "Non-veg" : dish?.diet === "unknown" ? "Check with kitchen" : "Veg",
        description: String(dish?.description || "").slice(0, 200)
      })).filter(dish => dish.name)
    : [];

  if (!menu.length) {
    return send(res, 400, { code: "MENU_CONTEXT_MISSING", error: "The menu did not load correctly. Refresh the page and try again." });
  }

  const systemPrompt = [
    "You are Olive, the friendly AI food guide for Saffron & Stone, a multi-cuisine restaurant and premium cafe.",
    "Help guests understand dishes, common ingredients, flavours, cuisine styles, dietary labels, and choose what to order.",
    "Be conversational and remember the full conversation history. Ask one brief follow-up when useful.",
    "The MENU CONTEXT is the only source of truth for this restaurant's listed dish names, sample prices, categories and dietary labels. Never invent restaurant dishes, prices, availability or dietary claims.",
    "You may explain what a dish traditionally is and what it usually tastes like using general culinary knowledge. Make clear that the restaurant's exact recipe can vary.",
    "If dietary status says Check with kitchen, never label it veg or non-veg. Ask the guest to confirm directly with restaurant staff.",
    "Never guess about allergens, cross-contamination, Jain suitability, halal status or exact preparation. Ask the guest to confirm these with the kitchen.",
    "Recommend up to three matching dishes from the supplied menu. Include listed price and dietary label where helpful.",
    "If a guest asks an unrelated question, gently guide the conversation back to food and the menu.",
    "Never claim to place an order, reserve a table, take payment or confirm stock.",
    "Keep answers warm, clear and concise, usually 2 to 5 sentences.",
    "",
    "MENU CONTEXT:",
    JSON.stringify(menu)
  ].join("\n");

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);

    let googleResponse;
    try {
      googleResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 520 }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const result = await googleResponse.json().catch(() => ({}));

    if (!googleResponse.ok) {
      const providerText = String(result?.error?.message || "");
      const providerStatus = String(result?.error?.status || "");

      if (googleResponse.status === 401 || googleResponse.status === 403) {
        return send(res, 502, {
          code: "API_KEY_REJECTED",
          error: "Google rejected the Gemini API key. Check the key and its Gemini API permissions in Vercel."
        });
      }
      if (googleResponse.status === 404) {
        return send(res, 502, {
          code: "MODEL_NOT_FOUND",
          error: "The configured Gemini model was not found. Remove GEMINI_MODEL from Vercel or set it to gemini-3.5-flash-lite."
        });
      }
      if (googleResponse.status === 429 || providerStatus === "RESOURCE_EXHAUSTED") {
        return send(res, 429, {
          code: "GEMINI_QUOTA",
          error: "Gemini has reached a quota or rate limit. Check Google AI Studio usage and try again later."
        });
      }
      console.error("Gemini request failed:", googleResponse.status, providerText.slice(0, 500));
      return send(res, 502, {
        code: "GEMINI_UPSTREAM",
        error: "Google Gemini could not answer right now. Please try again in a moment."
      });
    }

    const candidate = result?.candidates?.[0];
    const reply = (candidate?.content?.parts || [])
      .map(part => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();

    if (!reply) {
      if (candidate?.finishReason === "SAFETY") {
        return send(res, 422, {
          code: "RESPONSE_BLOCKED",
          error: "I couldn't answer that wording. Try asking about a particular dish or cuisine."
        });
      }
      return send(res, 502, {
        code: "EMPTY_MODEL_RESPONSE",
        error: "Gemini returned an empty answer. Please try your question again."
      });
    }

    return send(res, 200, { reply, model });
  } catch (error) {
    if (error?.name === "AbortError") {
      return send(res, 504, {
        code: "GEMINI_TIMEOUT",
        error: "Gemini took too long to answer. Please try again."
      });
    }
    console.error("Olive API error:", error?.message || error);
    return send(res, 500, {
      code: "OLIVE_SERVER_ERROR",
      error: "Olive hit a server error. Please try again in a moment."
    });
  }
};
