const test = require("node:test");
const assert = require("node:assert/strict");
const { createOnlineStatsRuntime } = require("../src/server/admin/online-stats-runtime.js");

function fakeSocket(meta, destroyed = false) {
  const socket = { destroyed };
  return { socket, meta };
}

test("counts unique authenticated accounts per server and channel", () => {
  const { socket: active, meta: activeMeta } = fakeSocket({ account: "hero-1", serverId: "server-a", channelId: 1 });
  const { socket: duplicate, meta: duplicateMeta } = fakeSocket({ account: "hero-1", serverId: "server-a", channelId: 1 });
  const { socket: otherChannel, meta: otherChannelMeta } = fakeSocket({ account: "hero-2", serverId: "server-a", channelId: 2 });
  const { socket: otherServer, meta: otherServerMeta } = fakeSocket({ account: "hero-3", serverId: "server-b", channelId: 1 });
  const { socket: destroyed, meta: destroyedMeta } = fakeSocket({ account: "hero-4", serverId: "server-a", channelId: 1 }, true);
  const { socket: anonymous, meta: anonymousMeta } = fakeSocket({ serverId: "server-a", channelId: 1 });
  const sockets = new Set([active, duplicate, otherChannel, otherServer, destroyed, anonymous]);
  const socketMeta = new Map([
    [active, activeMeta],
    [duplicate, duplicateMeta],
    [otherChannel, otherChannelMeta],
    [otherServer, otherServerMeta],
    [destroyed, destroyedMeta],
    [anonymous, anonymousMeta]
  ]);
  const runtime = createOnlineStatsRuntime({ sockets, socketMeta });
  assert.deepEqual(runtime.countsForServer("server-a", 2), {
    onlineCount: 2,
    channels: [
      { id: 1, name: "1线", onlineCount: 1 },
      { id: 2, name: "2线", onlineCount: 1 }
    ]
  });
});

test("ignores invalid channel assignments", () => {
  const { socket, meta } = fakeSocket({ account: "hero", serverId: "server-a", channelId: 9 });
  const runtime = createOnlineStatsRuntime({ sockets: new Set([socket]), socketMeta: new Map([[socket, meta]]) });
  assert.equal(runtime.countsForServer("server-a", 2).onlineCount, 0);
});

test("returns zero for empty registry and unknown server", () => {
  const runtime = createOnlineStatsRuntime({ sockets: new Set(), socketMeta: new Map() });
  assert.equal(runtime.countsForServer("server-a", 3).onlineCount, 0);
  assert.equal(runtime.countsForServer("server-a", 3).channels.length, 3);
});

test("defaults channel count to at least one line", () => {
  const { socket, meta } = fakeSocket({ account: "hero", serverId: "server-a", channelId: 1 });
  const runtime = createOnlineStatsRuntime({ sockets: new Set([socket]), socketMeta: new Map([[socket, meta]]) });
  const result = runtime.countsForServer("server-a", 0);
  assert.equal(result.channels.length, 1);
  assert.equal(result.onlineCount, 1);
});

test("normalizes queried server id", () => {
  const { socket, meta } = fakeSocket({ account: "hero", serverId: "server-a", channelId: 1 });
  const runtime = createOnlineStatsRuntime({ sockets: new Set([socket]), socketMeta: new Map([[socket, meta]]) });
  assert.equal(runtime.countsForServer("  server-a  ", 1).onlineCount, 1);
});

test("throws when required dependencies are missing", () => {
  assert.throws(() => createOnlineStatsRuntime({}), /online_stats_dependencies_required/);
  assert.throws(() => createOnlineStatsRuntime({ sockets: new Set() }), /online_stats_dependencies_required/);
});
