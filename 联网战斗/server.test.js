const test = require("node:test");
const assert = require("node:assert/strict");

const createOnlineBattleRuntime = require("./server.js");

function createHarness(configureMeta = () => {}, configureRows = () => {}) {
  const sent = [];
  const sockets = {
    a: { id: "a" },
    b: { id: "b" },
    c: { id: "c" },
    d: { id: "d" }
  };
  const metas = new Map([
    [sockets.a, { peerId: "a", account: "acctA", name: "甲", mapName: "map", team: { leaderId: "", members: [] }, leaderId: "", clientMirror: null }],
    [sockets.b, { peerId: "b", account: "acctB", name: "乙", mapName: "map", team: { leaderId: "", members: [] }, leaderId: "", clientMirror: null }],
    [sockets.c, { peerId: "c", account: "acctC", name: "丙", mapName: "map", team: { leaderId: "", members: [] }, leaderId: "", clientMirror: null }],
    [sockets.d, { peerId: "d", account: "acctD", name: "丁", mapName: "map", team: { leaderId: "", members: [] }, leaderId: "", clientMirror: null }]
  ]);
  configureMeta(metas, sockets);
  const rows = new Map([
    ["acctA", { account: "acctA", name: "甲" }],
    ["acctB", { account: "acctB", name: "乙" }],
    ["acctC", { account: "acctC", name: "丙" }],
    ["acctD", { account: "acctD", name: "丁" }]
  ]);
  for (const row of rows.values()) {
    row.inventory_json = "x".repeat(50000);
    row.equipment_json = "x".repeat(50000);
    row.equipped_json = "{}";
    row.selection_json = "{}";
  }
  configureRows(rows);
  const safeJsonArray = (value) => {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const safeJsonObject = (value) => {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const runtime = createOnlineBattleRuntime({
    statLimits: { crit: 100, critDamage: 2000 },
    safeJsonArray,
    safeJsonObject,
    sample: (items) => items[0],
    activeMercenaryForRow: () => null,
    arenaMirrorForPlayerRow: (row) => ({
      actor: {
        name: row.name,
        spriteId: 1,
        stats: { hp: 100, attack: 10, defense: 0, speed: 10, mana: 10, crit: 0, critDamage: 100, skillId: "shining_strike" }
      },
      pet: null,
      mercenary: null,
      selection: {}
    }),
    fetchPlayerRow: (account) => rows.get(account),
    findSocketByPeerId: (peerId) => sockets[peerId] || null,
    findSocketByAccount: (account) => [...metas.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    findSocketByName: (name) => [...metas.entries()].find(([, meta]) => meta.name === name)?.[0] || null,
    sendSocketJson: (socket, payload) => sent.push({ to: socket.id, payload }),
    getSocketMeta: (socket) => metas.get(socket) || {},
    setSocketMeta: (socket, meta) => metas.set(socket, meta),
    consumePveEncounter: () => ({ ok: true }),
    choiceMs: 60_000
  });
  return { runtime, sent, sockets };
}

test("1V1 强杀由服务器直接下发战斗开始", () => {
  const { runtime, sent, sockets } = createHarness();
  assert.equal(runtime.handleRoomMessage({ type: "battleStart", battleId: "solo", attackerId: "a", defenderId: "b" }, sockets.a), true);
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.role, item.payload.roster.map((member) => member.peerId)]), [
    ["a", "teamBattleStart", "attacker", ["a"]],
    ["b", "teamBattleStart", "defender", ["b"]]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "solo" }, sockets.a);
});

test("server downgrades role skill when required weapon is missing", () => {
  const { runtime, sent, sockets } = createHarness(() => {}, (rows) => {
    const row = rows.get("acctA");
    row.selection_json = JSON.stringify({ className: "法师" });
    row.equipment_json = JSON.stringify([]);
    row.equipped_json = JSON.stringify({});
  });
  assert.equal(runtime.handleRoomMessage({ type: "battleStart", battleId: "skill-no-weapon", attackerId: "a", defenderId: "b" }, sockets.a), true);
  sent.length = 0;
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "skill-no-weapon",
    choice: { actions: { "男": { type: "skill", skillId: "role_mage_frost_domain", target: "乙" } } }
  }, sockets.a);
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "skill-no-weapon",
    choice: { actions: { "乙": { type: "attack", target: "男" } } }
  }, sockets.b);
  const turn = sent.find((item) => item.payload.type === "teamBattleTurn")?.payload;
  assert.ok(turn);
  assert.equal(turn.result.events.some((event) => event.type === "skillName" && event.skillName === "冰封万域"), false);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "skill-no-weapon" }, sockets.a);
});

test("server blocks sacrifice role skill without required allies alive", () => {
  const { runtime, sent, sockets } = createHarness(() => {}, (rows) => {
    const row = rows.get("acctA");
    const weapon = { id: "staff-1", type: "staff" };
    const demonWeapon = { id: "demon-staff-1", type: "demon_staff" };
    row.selection_json = JSON.stringify({ className: "法师" });
    row.equipment_json = JSON.stringify([weapon, demonWeapon]);
    row.equipped_json = JSON.stringify({ weapon: weapon.id, demonWeapon: demonWeapon.id });
  });
  assert.equal(runtime.handleRoomMessage({ type: "battleStart", battleId: "skill-no-allies", attackerId: "a", defenderId: "b" }, sockets.a), true);
  sent.length = 0;
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "skill-no-allies",
    choice: { actions: { "男": { type: "skill", skillId: "role_mage_soul_burn", target: "乙" } } }
  }, sockets.a);
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "skill-no-allies",
    choice: { actions: { "乙": { type: "attack", target: "男" } } }
  }, sockets.b);
  const turn = sent.find((item) => item.payload.type === "teamBattleTurn")?.payload;
  assert.ok(turn);
  assert.equal(turn.result.events.some((event) => event.type === "skillName" && event.skillName === "焚灵祭命"), false);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "skill-no-allies" }, sockets.a);
});

test("队 v 队 PK 会展开双方在线队员", () => {
  const { runtime, sent, sockets } = createHarness((metas, sockets) => {
    metas.get(sockets.a).team = { leaderId: "a", members: [{ peerId: "c", account: "acctC", name: "丙" }] };
    metas.get(sockets.b).team = { leaderId: "b", members: [{ peerId: "d", account: "acctD", name: "丁" }] };
  });
  assert.equal(runtime.handleRoomMessage({ type: "battleStart", battleId: "team-pvp", attackerId: "a", defenderId: "b" }, sockets.a), true);
  assert.deepEqual(sent.map((item) => item.to).sort(), ["a", "b", "c", "d"]);
  const attackerStart = sent.find((item) => item.to === "a").payload;
  const defenderStart = sent.find((item) => item.to === "b").payload;
  assert.deepEqual(attackerStart.friendlyRoster.map((member) => member.peerId), ["a", "c"]);
  assert.deepEqual(defenderStart.friendlyRoster.map((member) => member.peerId), ["b", "d"]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "team-pvp" }, sockets.a);
});

test("单人 PVP 显式 solo 时不会被残留队伍状态展开", () => {
  const { runtime, sent, sockets } = createHarness((metas, sockets) => {
    metas.get(sockets.a).team = { leaderId: "a", members: [{ peerId: "c", account: "acctC", name: "中" }] };
    metas.get(sockets.b).team = { leaderId: "b", members: [{ peerId: "d", account: "acctD", name: "丁" }] };
  });
  assert.equal(runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "solo-after-team",
    attackerId: "a",
    defenderId: "b",
    pvpMode: "solo"
  }, sockets.a), true);
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.role, item.payload.roster.map((member) => member.peerId)]), [
    ["a", "teamBattleStart", "attacker", ["a"]],
    ["b", "teamBattleStart", "defender", ["b"]]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "solo-after-team" }, sockets.a);
});

test("API 发起单人 PVP 不经过房间 battleStart 广播", () => {
  const { runtime, sent, sockets } = createHarness();
  const result = runtime.startPvp("acctA", {
    battleId: "api-solo",
    defenderId: "b",
    defenderAccount: "acctB",
    pvpMode: "solo"
  });
  assert.deepEqual(result, { ok: true, battleId: "api-solo" });
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.role]), [
    ["a", "teamBattleStart", "attacker"],
    ["b", "teamBattleStart", "defender"]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "api-solo" }, sockets.a);
});

test("API 发起组队 PVE 不经过房间 teamPveStart 广播", () => {
  const { runtime, sent, sockets } = createHarness((metas, sockets) => {
    metas.get(sockets.a).team = { leaderId: "a", members: [{ peerId: "c", account: "acctC", name: "中" }] };
  });
  const result = runtime.startPve("acctA", {
    battleId: "api-pve",
    wildMonsterId: "amumu",
    encounterId: "api-pve-encounter",
    monsterCount: 1,
    enemies: [{ name: "阿木木", spriteId: 895, battleStats: { hp: 100, attack: 10, defense: 0, speed: 1, mana: 0, crit: 0, critDamage: 100, skillId: "wild_amumu" } }]
  });
  assert.deepEqual(result, { ok: true, battleId: "api-pve" });
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.pvp, item.payload.teamBattleServer]), [
    ["a", "teamBattleStart", false, true],
    ["c", "teamBattleStart", false, true]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "api-pve" }, sockets.a);
});

test("组队 PVE 会进入服务器权威战斗", () => {
  const { runtime, sent, sockets } = createHarness((metas, sockets) => {
    metas.get(sockets.a).team = { leaderId: "a", members: [{ peerId: "c", account: "acctC", name: "丙" }] };
  });
  assert.equal(runtime.handleRoomMessage({
    type: "teamPveStart",
    battleId: "team-pve",
    leaderId: "a",
    wildMonsterId: "amumu",
    encounterId: "team-pve-encounter",
    monsterCount: 1,
    enemies: [{ name: "阿木木", spriteId: 895, battleStats: { hp: 100, attack: 10, defense: 0, speed: 1, mana: 0, crit: 0, critDamage: 100, skillId: "wild_amumu" } }]
  }, sockets.a), true);
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.pvp, item.payload.teamBattleServer]), [
    ["a", "teamBattleStart", false, true],
    ["c", "teamBattleStart", false, true]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "team-pve" }, sockets.a);
});

test("旧 battleChoice 不再广播为客户端间战斗同步", () => {
  const { runtime, sent, sockets } = createHarness();
  assert.equal(runtime.handleRoomMessage({ type: "battleChoice", battleId: "old", choice: {} }, sockets.a), true);
  assert.equal(sent.length, 0);
});

test("客户端 teamBattleEnd 无法终止服务器权威战斗，逃跑会定向通知参与者", () => {
  const { runtime, sent, sockets } = createHarness();
  runtime.handleRoomMessage({ type: "battleStart", battleId: "end", attackerId: "a", defenderId: "b" }, sockets.a);
  sent.length = 0;
  assert.equal(runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "end" }, sockets.a), true);
  assert.equal(sent.length, 0);
  assert.equal(runtime.handleRoomMessage({ type: "battleEscape", battleId: "end", reason: "escape" }, sockets.a), true);
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.to]), [
    ["a", "teamBattleEnd", "a"],
    ["b", "teamBattleEnd", "b"]
  ]);
});
test("teamBattleStart only sends public battle actors", () => {
  const { runtime, sent, sockets } = createHarness();
  assert.equal(runtime.handleRoomMessage({ type: "battleStart", battleId: "payload", attackerId: "a", defenderId: "b" }, sockets.a), true);
  const start = sent.find((item) => item.to === "a").payload;
  assert.equal(start.allies[0].playerRow, undefined);
  assert.equal(start.enemies[0].playerRow, undefined);
  assert.equal(JSON.stringify(start).includes("inventory_json"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(start)) < 5000);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "payload" }, sockets.a);
});

test("1V1 stale defender peer can be resolved by account or name", () => {
  const { runtime, sent, sockets } = createHarness();
  assert.equal(runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "solo-resolve",
    attackerId: "a",
    defenderId: "old-peer-id",
    defenderAccount: "acctB",
    defenderName: "涔?"
  }, sockets.a), true);
  assert.deepEqual(sent.map((item) => [item.to, item.payload.type, item.payload.role]), [
    ["a", "teamBattleStart", "attacker"],
    ["b", "teamBattleStart", "defender"]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "solo-resolve" }, sockets.a);
});
test("阿飞 PVE 胜利后服务器发放 teamBattleReward", () => {
  const sent = [];
  const issued = [];
  const sockets = { a: { id: "a" } };
  const metas = new Map([
    [sockets.a, { peerId: "a", account: "acctA", name: "甲", mapName: "map", team: { leaderId: "a", members: [] }, leaderId: "a", clientMirror: null }]
  ]);
  const rows = new Map([["acctA", { account: "acctA", name: "甲" }]]);
  for (const row of rows.values()) {
    row.inventory_json = "x".repeat(50000);
    row.equipment_json = "x".repeat(50000);
    row.equipped_json = "{}";
    row.selection_json = "{}";
  }
  const safeJsonArray = (value) => {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const safeJsonObject = (value) => {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const runtime = createOnlineBattleRuntime({
    statLimits: { crit: 100, critDamage: 2000 },
    safeJsonArray,
    safeJsonObject,
    sample: (items) => items[0],
    activeMercenaryForRow: () => null,
    arenaMirrorForPlayerRow: (row) => ({
      actor: {
        name: row.name,
        spriteId: 1,
        stats: { hp: 50000000, attack: 50000000, defense: 0, speed: 9999, mana: 100000, crit: 100, critDamage: 500, skillId: "shining_strike" }
      },
      pet: null,
      mercenary: null,
      selection: { className: "剑士", gender: "男" }
    }),
    fetchPlayerRow: (account) => rows.get(account),
    findSocketByPeerId: (peerId) => sockets[peerId] || null,
    findSocketByAccount: (account) => [...metas.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    findSocketByName: () => null,
    sendSocketJson: (socket, payload) => sent.push({ to: socket.id, payload }),
    getSocketMeta: (socket) => metas.get(socket) || {},
    setSocketMeta: (socket, meta) => metas.set(socket, meta),
    consumePveEncounter: () => ({ ok: true }),
    choiceMs: 60000,
    issuePveRewardTickets: (ticket) => {
      issued.push(ticket);
      return `ticket-afei-${issued.length}`;
    }
  });
  const result = runtime.startPve("acctA", {
    battleId: "afei-pve",
    wildMonsterId: "afei",
    monsterCount: 10,
    enemies: [{ name: "阿飞", spriteId: 234, battleStats: { hp: 100, attack: 1, defense: 0, speed: 1, mana: 0, crit: 0, critDamage: 100, skillId: "wild_afei_heal" } }]
  });
  assert.deepEqual(result, { ok: true, battleId: "afei-pve" });
  let rounds = 0;
  let done = false;
  while (rounds < 40) {
    rounds += 1;
    runtime.handleRoomMessage({ type: "teamBattleChoice", battleId: "afei-pve", choice: { actor: { type: "attack" } } }, sockets.a);
    const turns = sent.filter((item) => item.payload.type === "teamBattleTurn" && item.payload.battleId === "afei-pve");
    const last = turns[turns.length - 1];
    if (last?.payload.result?.done) {
      done = true;
      break;
    }
  }
  assert.equal(done, true, "阿飞战斗应在若干回合内结束");
  const reward = sent.find((item) => item.payload.type === "teamBattleReward");
  assert.ok(reward, "胜利后应发出 teamBattleReward");
  assert.equal(reward.payload.wildMonsterId, "afei");
  assert.ok(issued.length >= 1, "issuePveRewardTickets 应被调用");
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "afei-pve" }, sockets.a);
});