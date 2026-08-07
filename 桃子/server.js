const { buildTaoziSystemPrompt } = require("./prompt.js");
const { TAOZI_EMOJI_CATALOG } = require("./emoji-catalog.js");

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 10;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const WELCOME_INSTRUCTION = "玩家刚刚从别的地图回到罗克萨斯家。只输出一句自然亲昵的欢迎气泡，必须自然称呼玩家名字，可以使用一个游戏表情 token，不要解释。";
const EMOJI_TOKENS = new Set(TAOZI_EMOJI_CATALOG.map(({ token }) => token));

function normalizeReply(value, maxLength = 2000) {
  return String(value || "").trim().replace(/\[(?:e|ico)\d+\]/g, (token) => EMOJI_TOKENS.has(token) ? token : "").slice(0, maxLength);
}

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

  async function request(account, messages, playerName, maxReplyLength) {
    if (!apiKey || !baseUrl || !model) return { ok: false, status: 503, error: "taozi_ai_unconfigured" };
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
          messages: [{ role: "system", content: buildTaoziSystemPrompt(playerName) }, ...messages],
          temperature: 0.8,
          max_tokens: 120
        }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      return { ok: false, status: 502, error: "taozi_ai_unavailable" };
    }
    if (response.status === 429) return { ok: false, status: 503, error: "taozi_ai_upstream_busy" };
    if (!response.ok) return { ok: false, status: 502, error: "taozi_ai_upstream_error" };
    const payload = await response.json().catch(() => null);
    const reply = normalizeReply(payload?.choices?.[0]?.message?.content, maxReplyLength);
    if (!reply) return { ok: false, status: 502, error: "taozi_ai_empty_reply" };
    return { ok: true, reply };
  }

  async function chat(account, data, playerName = account) {
    const messages = normalizeMessages(data);
    if (!messages) return { ok: false, status: 400, error: "invalid_taozi_message" };
    return request(account, messages, playerName);
  }

  function welcome(account, playerName = account) {
    return request(account, [{ role: "user", content: WELCOME_INSTRUCTION }], playerName, 120);
  }

  return { chat, welcome };
}

module.exports = { createTaoziRuntime, MAX_MESSAGE_LENGTH, MAX_HISTORY_MESSAGES };
