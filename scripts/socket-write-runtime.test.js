const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createSocketWriteRuntime } = require("../src/server/realtime/socket-write-runtime.js");

class BackpressuredSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writes = [];
    this.backpressured = true;
    this.writableLength = 0;
  }

  write(frame) {
    this.writes.push(frame);
    if (this.backpressured) this.writableLength += Buffer.byteLength(frame);
    return !this.backpressured;
  }

  destroy() {
    this.destroyed = true;
  }
}

test("socket writer keeps one drain listener and flushes queued frames in order", () => {
  const socket = new BackpressuredSocket();
  const recorded = [];
  const runtime = createSocketWriteRuntime({
    onWrite: (type, bytes) => recorded.push({ type, bytes })
  });

  for (let index = 0; index < 20; index += 1) {
    runtime.write(socket, Buffer.from(`frame-${index}`), "state");
  }

  assert.equal(socket.listenerCount("drain"), 1);
  assert.deepEqual(socket.writes.map(String), ["frame-0"]);

  socket.backpressured = false;
  socket.writableLength = 0;
  socket.emit("drain");

  assert.equal(socket.listenerCount("drain"), 0);
  assert.deepEqual(socket.writes.map(String), Array.from({ length: 20 }, (_, index) => `frame-${index}`));
  assert.equal(recorded.length, 20);
});

test("socket writer disconnects a client whose reliable queue exceeds the cap", () => {
  const socket = new BackpressuredSocket();
  const overflows = [];
  const runtime = createSocketWriteRuntime({
    maxQueuedBytes: 64 * 1024,
    onOverflow: (_socket, detail) => overflows.push(detail)
  });

  runtime.write(socket, Buffer.alloc(32 * 1024), "chat");
  runtime.write(socket, Buffer.alloc(40 * 1024), "chat");
  runtime.write(socket, Buffer.alloc(40 * 1024), "chat");

  assert.equal(socket.destroyed, true);
  assert.equal(socket.listenerCount("drain"), 0);
  assert.equal(overflows.length, 1);
  assert.ok(overflows[0].queuedBytes > 64 * 1024);
});

test("socket writer coalesces replaceable state without reordering reliable messages", () => {
  const socket = new BackpressuredSocket();
  const runtime = createSocketWriteRuntime({ maxQueuedBytes: 64 * 1024 });

  runtime.write(socket, Buffer.from("in-flight"), "chat");
  runtime.write(socket, Buffer.from("state-a-1"), "state", { coalesceKey: "state:peer-a" });
  runtime.write(socket, Buffer.from("chat-1"), "chat");
  runtime.write(socket, Buffer.from("state-a-2"), "state", { coalesceKey: "state:peer-a" });
  runtime.write(socket, Buffer.from("chat-2"), "chat");
  runtime.write(socket, Buffer.from("state-b"), "state", { coalesceKey: "state:peer-b" });

  socket.backpressured = false;
  socket.writableLength = 0;
  socket.emit("drain");

  assert.equal(socket.destroyed, false);
  assert.deepEqual(socket.writes.map(String), ["in-flight", "state-a-2", "chat-1", "chat-2", "state-b"]);
});
