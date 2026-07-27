const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createEncounterRuntime } = require(path.resolve(
  __dirname,
  "..",
  "\u8054\u7f51\u6218\u6597",
  "encounter-runtime.js"
));

const FIELD_MAP = "\u539f\u91ce\u602a\u533a";
const HUNT_MAP = "\u5e7b\u5f71\u72e9\u730e\u573a";
const START_TIME = Date.parse("2026-01-01T00:00:00.000Z");
const NORMAL_STEP_MS = 250;
const NORMAL_STEP_PX = 16;
const NORMAL_STEPS_TO_ENCOUNTER = 6;

function createHarness() {
  const sent = [];
  const anomalies = [];
  let currentTime = START_TIME;
  const runtime = createEncounterRuntime({
    now: () => currentTime,
    random: () => 0,
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    recordAnomaly: (...args) => anomalies.push(args)
  });
  return {
    runtime,
    sent,
    anomalies,
    advance: (elapsedMs) => { currentTime += elapsedMs; }
  };
}

function fieldMeta(overrides = {}) {
  return {
    socket: { id: "socket-player" },
    account: "player-one",
    peerId: "peer-player",
    serverId: "realm-a",
    channelId: 3,
    mapName: FIELD_MAP,
    team: { leaderId: "", members: [] },
    ...overrides
  };
}

function continueFieldEncounter(runtime, meta, advance, startX = 0) {
  for (let step = 1; step <= NORMAL_STEPS_TO_ENCOUNTER; step += 1) {
    advance(NORMAL_STEP_MS);
    runtime.observeState(meta, { x: startX + step * NORMAL_STEP_PX, y: 0 });
  }
}

function issueFieldEncounter(runtime, meta, advance, startX = 0) {
  runtime.observeState(meta, { x: startX, y: 0 });
  continueFieldEncounter(runtime, meta, advance, startX);
}

test("normal server-observed movement issues one field encounter", () => {
  const { runtime, sent, anomalies, advance } = createHarness();
  const meta = fieldMeta();

  issueFieldEncounter(runtime, meta, advance);

  assert.equal(anomalies.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].socket, meta.socket);
  assert.deepEqual({
    type: sent[0].payload.type,
    to: sent[0].payload.to,
    wildMonsterId: sent[0].payload.wildMonsterId,
    expiresAt: sent[0].payload.expiresAt
  }, {
    type: "pveEncounter",
    to: "peer-player",
    wildMonsterId: "amumu",
    expiresAt: new Date(START_TIME + NORMAL_STEP_MS * NORMAL_STEPS_TO_ENCOUNTER + 15_000).toISOString()
  });
  assert.match(sent[0].payload.encounterId, /^[A-Za-z0-9_-]{32}$/);
});

test("forged large movement is rejected and does not count toward an encounter", () => {
  const { runtime, sent, anomalies, advance } = createHarness();
  const meta = fieldMeta();

  runtime.observeState(meta, { x: 0, y: 0 });
  advance(100);
  runtime.observeState(meta, { x: 65, y: 0 });

  assert.equal(sent.length, 0);
  assert.deepEqual(anomalies, [[
    "player-one",
    "invalid_encounter_movement",
    { mapName: FIELD_MAP, distance: 65, elapsedMs: 100 },
    2,
    "reject"
  ]]);

  continueFieldEncounter(runtime, meta, advance);
  assert.equal(sent.length, 1);
});

test("server idle encounter requests issue once, reject a pending ticket, and enforce cooldown", () => {
  const { runtime, sent, advance } = createHarness();
  const meta = fieldMeta();

  const first = runtime.requestIdleEncounter(meta);
  assert.equal(first.ok, true);
  assert.equal(first.encounter.monsterId, "amumu");
  assert.equal(sent.length, 1);
  assert.deepEqual(runtime.requestIdleEncounter(meta), { ok: false, error: "pve_encounter_pending" });
  assert.equal(sent.length, 1);

  assert.equal(runtime.consume({
    account: meta.account,
    encounterId: first.encounter.id,
    monsterId: "amumu",
    meta
  }).ok, true);
  assert.deepEqual(runtime.requestIdleEncounter(meta), { ok: false, error: "pve_idle_cooldown" });
  advance(4_999);
  assert.deepEqual(runtime.requestIdleEncounter(meta), { ok: false, error: "pve_idle_cooldown" });
  advance(1);

  const second = runtime.requestIdleEncounter(meta);
  assert.equal(second.ok, true);
  assert.notEqual(second.encounter.id, first.encounter.id);
  assert.equal(sent.length, 2);
});

test("dense forged grid movement is rejected and cannot issue an encounter", () => {
  const { runtime, sent, anomalies, advance } = createHarness();
  const meta = fieldMeta();

  runtime.observeState(meta, { x: 0, y: 0 });
  runtime.observeState(meta, { x: 16, y: 0 });
  advance(1);
  runtime.observeState(meta, { x: 64, y: 0 });

  assert.equal(sent.length, 0);
  assert.deepEqual(anomalies, [
    [
      "player-one",
      "invalid_encounter_movement",
      { mapName: FIELD_MAP, distance: 16, elapsedMs: 0 },
      2,
      "reject"
    ],
    [
      "player-one",
      "invalid_encounter_movement",
      { mapName: FIELD_MAP, distance: 64, elapsedMs: 1 },
      2,
      "reject"
    ]
  ]);
});

test("encounter tickets require matching owner, realm, map, monster, and one-time consumption", () => {
  const { runtime, sent, anomalies, advance } = createHarness();
  const meta = fieldMeta();
  issueFieldEncounter(runtime, meta, advance);
  const encounterId = sent[0].payload.encounterId;

  assert.deepEqual(runtime.consume({
    account: "other-player",
    encounterId,
    monsterId: "amumu",
    meta
  }), { ok: false, error: "pve_encounter_required", status: 409 });
  assert.deepEqual(runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "amumu",
    meta: { ...meta, serverId: "realm-b" }
  }), { ok: false, error: "pve_encounter_required", status: 409 });
  assert.deepEqual(runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "amumu",
    meta: { ...meta, mapName: HUNT_MAP }
  }), { ok: false, error: "pve_encounter_mismatch", status: 409 });
  assert.deepEqual(runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "phantom",
    meta
  }), { ok: false, error: "pve_encounter_mismatch", status: 409 });

  const consumed = runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "amumu",
    meta
  });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.encounter.account, "player-one");
  assert.equal(consumed.encounter.realm, "realm-a:3");
  assert.equal(consumed.encounter.mapName, FIELD_MAP);
  assert.equal(consumed.encounter.monsterId, "amumu");
  assert.deepEqual(runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "amumu",
    meta
  }), { ok: false, error: "pve_encounter_required", status: 409 });
  assert.deepEqual(
    anomalies.map(([account, type, detail, severity, action]) => [
      account,
      type,
      detail.error,
      severity,
      action
    ]),
    [
      ["other-player", "invalid_pve_encounter", "pve_encounter_required", 2, "reject"],
      ["player-one", "invalid_pve_encounter", "pve_encounter_required", 2, "reject"],
      ["player-one", "invalid_pve_encounter", "pve_encounter_mismatch", 2, "reject"],
      ["player-one", "invalid_pve_encounter", "pve_encounter_mismatch", 2, "reject"],
      ["player-one", "invalid_pve_encounter", "pve_encounter_required", 2, "reject"]
    ]
  );
});

test("disconnect invalidates the current socket's encounter ticket", () => {
  const { runtime, sent, anomalies, advance } = createHarness();
  const meta = fieldMeta();
  issueFieldEncounter(runtime, meta, advance);
  const encounterId = sent[0].payload.encounterId;

  assert.deepEqual(runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "amumu",
    meta: { ...meta, peerId: "reconnected-peer" }
  }), { ok: false, error: "pve_encounter_mismatch", status: 409 });
  runtime.handleDisconnect(meta);
  assert.deepEqual(runtime.consume({
    account: meta.account,
    encounterId,
    monsterId: "amumu",
    meta
  }), { ok: false, error: "pve_encounter_required", status: 409 });
  assert.deepEqual(
    anomalies.map(([account, type, detail]) => [account, type, detail.error]),
    [
      ["player-one", "invalid_pve_encounter", "pve_encounter_mismatch"],
      ["player-one", "invalid_pve_encounter", "pve_encounter_required"]
    ]
  );
});
