const test = require("node:test");
const assert = require("node:assert/strict");
const { createTeamStateMachine } = require("../server/team-state-machine.js");

const realm = { serverId: "realm-a", channelId: 1 };
const leader = { ...realm, account: "leader", name: "Leader", peerId: "peer-leader" };
const member = { ...realm, account: "member", name: "Member", peerId: "peer-member" };

function command(type, requestId, payload = {}) {
  return { type, requestId: `request-${requestId}-000000`, payload };
}

function harness(options = {}) {
  let sequence = 0;
  let timestamp = options.timestamp || 1_700_000_000_000;
  const anomalies = [];
  const events = [];
  const runtime = createTeamStateMachine({
    now: () => timestamp,
    createId: (kind) => `${kind}-${++sequence}`,
    inviteTtlMs: options.inviteTtlMs || 100,
    requestTtlMs: 1_000,
    recordAnomaly: (...entry) => anomalies.push(entry),
    recordEvent: (...entry) => events.push(entry)
  });
  return { runtime, anomalies, events, advance: (ms) => { timestamp += ms; } };
}

function createAndInvite(runtime) {
  const created = runtime.execute(command("team.v2.create", "create"), leader);
  const invited = runtime.execute(command("team.v2.invite", "invite", {
    teamId: created.teamId,
    teamRevision: created.revision,
    targetAccount: member.account
  }), leader);
  return { created, invited };
}

test("create, invite, accept and reconnect use account identity with monotonic revisions", () => {
  const { runtime } = harness();
  const { created, invited } = createAndInvite(runtime);
  const accepted = runtime.execute(command("team.v2.invite.respond", "accept", {
    inviteId: invited.invite.id,
    response: "accept"
  }), member);

  assert.equal(created.revision, 1);
  assert.equal(accepted.revision, 2);
  assert.deepEqual(accepted.snapshot.members.map((item) => item.account), ["leader", "member"]);

  const recovered = runtime.reconnect({ ...member, peerId: "peer-member-new" });
  assert.equal(recovered.revision, 3);
  assert.equal(recovered.members[1].currentPeerId, "peer-member-new");
});

test("replaying a request returns its original result without applying it twice", () => {
  const { runtime } = harness();
  const first = runtime.execute(command("team.v2.create", "same"), leader);
  const replay = runtime.execute(command("team.v2.create", "same"), leader);

  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.teamId, first.teamId);
  assert.equal(replay.revision, 1);
});

test("reusing a request id with a different payload is rejected and audited", () => {
  const { runtime, anomalies } = harness();
  const created = runtime.execute(command("team.v2.create", "create"), leader);
  runtime.execute(command("team.v2.invite", "reused", {
    teamId: created.teamId,
    teamRevision: created.revision,
    targetAccount: "first"
  }), leader);
  const reused = runtime.execute(command("team.v2.invite", "reused", {
    teamId: created.teamId,
    teamRevision: created.revision,
    targetAccount: "second"
  }), leader);

  assert.equal(reused.error, "team_command_duplicate");
  assert.equal(anomalies.at(-1)[1], "team_request_id_reuse");
});

test("expired invites, stale revisions and cross-account acceptance are rejected", () => {
  const { runtime, anomalies, advance } = harness({ inviteTtlMs: 20 });
  const { created, invited } = createAndInvite(runtime);
  const stale = runtime.execute(command("team.v2.invite", "stale", {
    teamId: created.teamId,
    teamRevision: 99,
    targetAccount: "other"
  }), leader);
  const forged = runtime.execute(command("team.v2.invite.respond", "forged", {
    inviteId: invited.invite.id,
    response: "accept"
  }), { ...realm, account: "attacker", peerId: "attacker-peer" });
  advance(21);
  const expired = runtime.execute(command("team.v2.invite.respond", "expired", {
    inviteId: invited.invite.id,
    response: "accept"
  }), member);

  assert.equal(stale.error, "team_revision_conflict");
  assert.equal(forged.error, "team_command_invalid");
  assert.equal(expired.error, "team_invite_expired");
  assert.equal(anomalies.at(-1)[1], "team_invite_impersonation");
});

test("an invite cannot name a different team even with a valid revision", () => {
  const { runtime } = harness();
  const created = runtime.execute(command("team.v2.create", "create"), leader);
  const result = runtime.execute(command("team.v2.invite", "wrong-team", {
    teamId: "team-controlled-by-someone-else",
    teamRevision: created.revision,
    targetAccount: member.account
  }), leader);

  assert.equal(result.error, "team_not_found");
});

test("only the leader can kick or disband and leaving updates the canonical snapshot", () => {
  const { runtime } = harness();
  const { invited } = createAndInvite(runtime);
  const accepted = runtime.execute(command("team.v2.invite.respond", "accept", {
    inviteId: invited.invite.id,
    response: "accept"
  }), member);
  const forbidden = runtime.execute(command("team.v2.disband", "forbidden", {
    teamId: accepted.teamId,
    teamRevision: accepted.revision
  }), member);
  const left = runtime.execute(command("team.v2.leave", "leave", {
    teamId: accepted.teamId,
    teamRevision: accepted.revision
  }), member);
  const disbanded = runtime.execute(command("team.v2.disband", "disband", {
    teamId: left.teamId,
    teamRevision: left.revision
  }), leader);

  assert.equal(forbidden.error, "team_not_leader");
  assert.deepEqual(left.snapshot.members.map((item) => item.account), ["leader"]);
  assert.equal(disbanded.snapshot.status, "disbanded");
  assert.equal(disbanded.revision, 4);
});

test("identity fields in client payloads are never accepted", () => {
  const { runtime, anomalies } = harness();
  const result = runtime.execute(command("team.v2.create", "forged", {
    account: "victim",
    members: [{ account: "victim" }]
  }), leader);

  assert.equal(result.error, "team_command_invalid");
  assert.equal(anomalies.at(-1)[1], "team_identity_override");
});
