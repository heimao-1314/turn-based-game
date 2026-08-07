const { TAOZI_SYSTEM_PROMPT } = require("./prompt.js");

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 10;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;

function createTaoziRuntime({ apiKey, baseUrl, model, fetchImpl = fetch, now = Date.now, recordAnomaly = () => {} }) {
  const attempts = new Map();

  function consumeRateLimit(account) {
    const cutoff = now() - RATE_WINDOW_MS;
    const recent = (attempts.get(account) || []).filter((time) => time > cutoff);
    if (recent.length >= RATE_LIMIT) return false;
    recent.push(now());
    attempts.set(account, recent);
    return true;
  }

  function normalizeMessages(data) {
    const message = String(data?.message || "").trim();
    if (!message || message.length > MAX_MESSAGE_LENGTH) return null;
    const history = Array.isArray(data?.history) ? data.history.slice(-MAX_HISTORY_MESSAGES) : [];
    const safeHistory = history.flatMap((entry) => {
      const role = entry?.role === "assistant" ? "assistant" : entry?.role === "user" ? "user" : "";
      const content = String(entry?.content || "").trim().slice(0, MAX_MESSAGE_LENGTH);
      return role && content ? [{ role, content }] : [];
    });
    return [...safeHistory, { role: "user", content: message }];
  }

  async function chat(account, data) {
    if (!apiKey || !baseUrl || !model) return { ok: false, status: 503, error: "taozi_ai_unconfigured" };
    const messages = normalizeMessages(data);
    if (!messages) return { ok: false, status: 400, error: "invalid_taozi_message" };
    if (!consumeRateLimit(account)) {
      recordAnomaly(account, "taozi_ai_rate_limited", { windowMs: RATE_WINDOW_MS }, 1, "reject");
      return { ok: false, status: 429, error: "taozi_ai_rate_limited" };
    }

    const endpoint = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: TAOZI_SYSTEM_PROMPT }, ...messages],
          temperature: 0.8,
          max_tokens: 350
        }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      return { ok: false, status: 502, error: "taozi_ai_unavailable" };
    }
    if (response.status === 429) return { ok: false, status: 503, error: "taozi_ai_upstream_busy" };
    if (!response.ok) return { ok: false, status: 502, error: "taozi_ai_upstream_error" };
    const payload = await response.json().catch(() => null);
    const reply = String(payload?.choices?.[0]?.message?.content || "").trim().slice(0, 2000);
    if (!reply) return { ok: false, status: 502, error: "taozi_ai_empty_reply" };
    return { ok: true, reply };
  }

  return { chat };
}

module.exports = { createTaoziRuntime, MAX_MESSAGE_LENGTH, MAX_HISTORY_MESSAGES };
