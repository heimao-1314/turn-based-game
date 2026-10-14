const test = require("node:test");
const assert = require("node:assert/strict");
const { createWebSocketFrameRuntime } = require("../src/server/realtime/websocket-frame-runtime.js");

function maskedFrame(text, options = {}) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([options.firstByte ?? 0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.from([options.firstByte ?? 0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = options.firstByte ?? 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const encoded = Buffer.from(payload);
  for (let index = 0; index < encoded.length; index += 1) encoded[index] ^= mask[index % 4];
  return Buffer.concat([header, mask, encoded]);
}

test("frame runtime preserves a text frame split across TCP chunks", () => {
  const runtime = createWebSocketFrameRuntime();
  const socket = {};
  const frame = maskedFrame(JSON.stringify({ type: "ping", ts: 123 }));

  assert.deepEqual(runtime.push(socket, frame.subarray(0, 3)).messages, []);
  assert.deepEqual(runtime.push(socket, frame.subarray(3, 11)).messages, []);
  assert.deepEqual(runtime.push(socket, frame.subarray(11)).messages, ['{"type":"ping","ts":123}']);
});

test("frame runtime decodes coalesced frames and fragmented text messages", () => {
  const runtime = createWebSocketFrameRuntime();
  const socket = {};
  const first = maskedFrame("hello ", { firstByte: 0x01 });
  const continuation = maskedFrame("world", { firstByte: 0x80 });
  const next = maskedFrame('{"type":"state"}');

  assert.deepEqual(runtime.push(socket, Buffer.concat([first, continuation, next])).messages, [
    "hello world",
    '{"type":"state"}'
  ]);
});

test("frame runtime rejects an oversized buffered message", () => {
  const errors = [];
  const runtime = createWebSocketFrameRuntime({
    maxMessageBytes: 64 * 1024,
    onProtocolError: (_socket, reason) => errors.push(reason)
  });
  const result = runtime.push({}, maskedFrame("x".repeat(70 * 1024)));

  assert.equal(result.protocolError, "message_limit");
  assert.deepEqual(errors, ["message_limit"]);
});
