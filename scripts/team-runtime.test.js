const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createTeamRuntime } = require("../队伍/server.js");

function createHarness({ disconnectGraceMs, onTeamDisband } = {}) {
  const sent = [];
  const sockets = new Map([
    ["leader", { peerId: "leader", account: "leader-account", name: "Leader", serverId: "realm", channelId: 1, team: { leaderId: "", members: [] }, leaderId: "" }],
    ["member", { peerId: "member", account: "member-account", name: "Member", serverId: "realm", channelId: 1, team: { leaderId: "", members: [] }, leaderId: "" }],
    ["attacker", { peerId: "attacker", account: "attacker-account", name: "Attacker", serverId: "realm", channelId: 1, team: { leaderId: "", members: [] }, leaderId: "" }]
  ]);
  const runtime = createTeamRuntime({
    findSocketByPeerId: (peerId) => [...sockets.entries()].find(([, meta]) => meta.peerId === peerId)?.[0] || null,
    findSocketByAccount: (account) => [...sockets.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    getSocketMeta: (socket) => sockets.get(socket),
    setSocketMeta: (socket, meta) => sockets.set(socket, meta),
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    disconnectGraceMs,
    onTeamDisband
  });
  return { runtime, sent, sockets };
}

test("team membership requires a pending request and is synchronized by the server", () => {
  const { runtime, sent, sockets } = createHarness();

  runtime.handleRoomMessage({ type: "teamAccepted", to: "member", leaderId: "leader", members: [{ peerId: "member" }] }, "leader");
  assert.equal(sockets.get("leader").team.members.length, 0);
  assert.equal(sent.at(-1).payload.error, "team_invite_expired");

  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member", members: [] }, "leader");

  assert.deepEqual(sockets.get("leader").team, {
    leaderId: "leader",
    members: [{ peerId: "member", account: "member-account", name: "Member" }]
  });
  assert.equal(sockets.get("member").leaderId, "leader");
  assert.ok(sent.some((entry) => entry.socket === "member" && entry.payload.type === "teamAccepted"));
});

test("the target can reject a pending team invite without waiting for expiry", () => {
  const { runtime, sent } = createHarness();
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  sent.length = 0;

  runtime.handleRoomMessage({ type: "teamDeclined", to: "member" }, "leader");

  assert.deepEqual(sent, [{
    socket: "member",
    payload: { type: "teamRejected", error: "team_invite_declined" }
  }]);
});

test("a non-leader cannot disband or overwrite a team roster", () => {
  const { runtime, sent, sockets } = createHarness();
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  sent.length = 0;

  runtime.handleRoomMessage({ type: "teamUpdate", leaderId: "member", members: [] }, "member");
  runtime.handleRoomMessage({ type: "teamDisband", leaderId: "leader" }, "member");

  assert.equal(sockets.get("leader").team.members[0].peerId, "member");
  assert.equal(sent.at(-1).payload.error, "team_not_leader");
});

test("a pending invite is cleared when its target joins another team before accepting", () => {
  const { runtime, sent, sockets } = createHarness();
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "attacker" }, "leader");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "leader" }, "attacker");
  sent.length = 0;

  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");

  assert.ok(sent.some((entry) => entry.socket === "member" && entry.payload.error === "team_member_busy"));
  assert.equal(sockets.get("leader").leaderId, "attacker");
  assert.equal(sockets.get("member").leaderId, "");

  runtime.handleRoomMessage({ type: "teamLeave" }, "leader");
  sent.length = 0;
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  assert.equal(sent.at(-1).payload.error, "team_invite_expired");
});

test("the leader receives an empty canonical roster when the final member leaves", () => {
  const { runtime, sent, sockets } = createHarness();
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  sent.length = 0;

  runtime.handleRoomMessage({ type: "teamLeave" }, "member");

  assert.deepEqual(sockets.get("leader").team, { leaderId: "", members: [] });
  assert.deepEqual(sent.at(-1), {
    socket: "leader",
    payload: {
      type: "teamUpdate",
      to: "leader",
      leaderId: "",
      leaderName: "",
      members: []
    }
  });
});

test("a leader teamLeave is a trusted disband and leaves no ghost roster", () => {
  const disbands = [];
  const { runtime, sent, sockets } = createHarness({
    onTeamDisband: (event) => disbands.push(event)
  });
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  sent.length = 0;

  assert.equal(runtime.handleRoomMessage({ type: "teamLeave" }, "leader"), true);
  assert.deepEqual(disbands, [{
    leaderAccount: "leader-account",
    leaderId: "leader",
    realm: { serverId: "realm", channelId: 1 }
  }]);
  assert.deepEqual(sockets.get("leader").team, { leaderId: "", members: [] });
  assert.equal(sockets.get("leader").leaderId, "");
  assert.deepEqual(sockets.get("member").team, { leaderId: "", members: [] });
  assert.equal(sockets.get("member").leaderId, "");
  assert.deepEqual(
    sent.filter((entry) => entry.payload.type === "teamDisband"),
    [{ socket: "member", payload: { type: "teamDisband", to: "member", leaderId: "leader" } }]
  );

  sent.length = 0;
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");

  assert.equal(sent.some((entry) => entry.payload.type === "teamRejected"), false);
  assert.deepEqual(sockets.get("leader").team, {
    leaderId: "leader",
    members: [{ peerId: "member", account: "member-account", name: "Member" }]
  });
  assert.deepEqual(sockets.get("member").team, sockets.get("leader").team);
  assert.equal(disbands.length, 1);
});

test("a reconnecting member restores canonical metadata and receives the team sync", async () => {
  const { runtime, sent, sockets } = createHarness({ disconnectGraceMs: 5 });
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  const memberMeta = sockets.get("member");
  sockets.delete("member");
  runtime.handleDisconnect("member", memberMeta);

  const reconnectedMeta = { ...memberMeta, peerId: "member-reloaded", team: { leaderId: "", members: [] }, leaderId: "" };
  sockets.set("member-reconnected", reconnectedMeta);
  sent.length = 0;
  runtime.handlePeerConnected("member-reloaded", reconnectedMeta);
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(sockets.get("leader").team.members[0].peerId, "member-reloaded");
  assert.deepEqual(reconnectedMeta.team, {
    leaderId: "leader",
    members: [{ peerId: "member-reloaded", account: "member-account", name: "Member" }]
  });
  assert.equal(reconnectedMeta.leaderId, "leader");
  assert.ok(sent.some((entry) => entry.socket === "member-reconnected" && entry.payload.type === "teamUpdate"));
});

test("a reconnecting leader restores its canonical roster", () => {
  const { runtime, sent, sockets } = createHarness({ disconnectGraceMs: 100 });
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  const leaderMeta = sockets.get("leader");
  sockets.delete("leader");
  runtime.handleDisconnect("leader", leaderMeta);

  const reconnectedMeta = { ...leaderMeta, peerId: "leader-reloaded", team: { leaderId: "", members: [] }, leaderId: "" };
  sockets.set("leader-reconnected", reconnectedMeta);
  sent.length = 0;
  runtime.handlePeerConnected("leader-reloaded", reconnectedMeta);

  assert.deepEqual(reconnectedMeta.team, {
    leaderId: "leader-reloaded",
    members: [{ peerId: "member", account: "member-account", name: "Member" }]
  });
  assert.equal(reconnectedMeta.leaderId, "");
  assert.ok(sent.some((entry) => entry.socket === "leader-reconnected" && entry.payload.type === "teamUpdate"));
});

test("a different account cannot inherit a disconnected member slot by reusing its peerId", () => {
  const { runtime, sockets } = createHarness({ disconnectGraceMs: 100 });
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  const memberMeta = sockets.get("member");
  sockets.delete("member");
  runtime.handleDisconnect("member", memberMeta);

  const attackerMeta = {
    peerId: "member",
    account: "attacker-account",
    name: "Attacker",
    serverId: "realm",
    channelId: 1,
    team: { leaderId: "", members: [] },
    leaderId: ""
  };
  sockets.set("attacker", attackerMeta);
  runtime.handlePeerConnected("member", attackerMeta);

  assert.deepEqual(attackerMeta.team, { leaderId: "", members: [] });
  assert.equal(attackerMeta.leaderId, "");
  assert.equal(sockets.get("leader").team.members[0].account, "member-account");
});

test("a disconnected member is removed after the grace period", async () => {
  const { runtime, sockets } = createHarness({ disconnectGraceMs: 5 });
  runtime.handleRoomMessage({ type: "teamJoinRequest", to: "leader" }, "member");
  runtime.handleRoomMessage({ type: "teamAccepted", to: "member" }, "leader");
  const memberMeta = sockets.get("member");
  sockets.delete("member");
  runtime.handleDisconnect("member", memberMeta);
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(sockets.get("leader").team, { leaderId: "", members: [] });
});

test("team battle action maps are restricted to the fighter owner", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "联网战斗", "runtime.js"), "utf8");
  assert.match(source, /const fighter = findFighterByRef\(ownTeam, ref\);\s*if \(fighter\?\.actor\?\.ownerPeerId !== peerId\) return;/);
});

test("server state forwarding replaces client-provided team metadata", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /data\.team = meta\.team \|\| \{ leaderId: "", members: \[\] \};/);
  assert.match(source, /data\.leaderId = data\.team\.leaderId \|\| meta\.leaderId \|\| "";/);
});
