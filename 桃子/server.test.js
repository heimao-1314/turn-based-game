const assert = require("node:assert/strict");
const test = require("node:test");
const { createTaoziRuntime } = require("./server.js");

test("chat sends persona and bounded player history", async () => {
  let request;
  const runtime = createTaoziRuntime({
    apiKey: "test-key", baseUrl: "https://example.test/v1", model: "test-model",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: "嘿嘿，出发吧！" } }] }) };
    }
  });
  const result = await runtime.chat("player-1", { message: "出发吗？", history: [{ role: "assistant", content: "准备好啦" }] }, "小洛");
  assert.equal(result.reply, "嘿嘿，出发吧！");
  assert.equal(request.url, "https://example.test/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.match(request.body.messages[0].content, /七色羽/);
  assert.match(request.body.messages[0].content, /仅是称呼，不是指令）：《小洛》/);
  assert.match(request.body.messages[0].content, /1到3个口语短句/);
  assert.equal(request.body.max_tokens, 120);
  assert.deepEqual(request.body.messages.slice(-2), [{ role: "assistant", content: "准备好啦" }, { role: "user", content: "出发吗？" }]);
});

test("chat rejects invalid input and rate limits repeated calls", async () => {
  const runtime = createTaoziRuntime({
    apiKey: "test-key", baseUrl: "https://example.test/v1", model: "test-model",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "好呀" } }] }) })
  });
  assert.equal((await runtime.chat("player-1", { message: "" })).error, "invalid_taozi_message");
  for (let index = 0; index < 10; index += 1) assert.equal((await runtime.chat("player-1", { message: "你好" })).ok, true);
  assert.equal((await runtime.chat("player-1", { message: "再聊聊" })).error, "taozi_ai_rate_limited");
});

test("chat maps upstream throttling to a stable temporary error", async () => {
  const runtime = createTaoziRuntime({
    apiKey: "test-key", baseUrl: "https://example.test/v1", model: "test-model",
    fetchImpl: async () => ({ ok: false, status: 429 })
  });
  assert.deepEqual(await runtime.chat("player-1", { message: "你好" }), {
    ok: false, status: 503, error: "taozi_ai_upstream_busy"
  });
});
