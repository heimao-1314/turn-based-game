const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadClient() {
  const intervals = [];
  const context = {
    window: {
      setInterval: (callback) => { intervals.push(callback); return intervals.length; },
      clearInterval: () => {}
    },
    URL,
    encodeURIComponent
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../联网战斗/client.js"), "utf8"), context);
  return { client: context.window.OnlineBattleClient, intervals };
}

test("heartbeat does not reject a connection merely because the browser timer was delayed", () => {
  let now = 1000;
  const { client } = loadClient();
  const sent = [];
  const timeouts = [];
  const socket = { readyState: 1, send: (message) => sent.push(JSON.parse(message)) };
  const heartbeat = client.createHeartbeatRuntime({
    getSocket: () => socket,
    getPeerId: () => "peer-a",
    intervalMs: 10000,
    timeoutMs: 90000,
    now: () => now,
    onTimeout: () => timeouts.push(now)
  });

  heartbeat.start();
  now += 60000;
  heartbeat.tick();
  assert.equal(timeouts.length, 0);
  assert.equal(sent.length, 1);

  now += 91000;
  heartbeat.tick();
  assert.deepEqual(timeouts, [152000]);
});

test("pong clears the outstanding heartbeat deadline", () => {
  let now = 1000;
  const { client } = loadClient();
  let timedOut = false;
  const socket = { readyState: 1, send: () => {} };
  const heartbeat = client.createHeartbeatRuntime({
    getSocket: () => socket,
    timeoutMs: 90000,
    now: () => now,
    onTimeout: () => { timedOut = true; }
  });
  heartbeat.start();
  now += 60000;
  heartbeat.markPong();
  now += 60000;
  heartbeat.tick();
  assert.equal(timedOut, false);
});
