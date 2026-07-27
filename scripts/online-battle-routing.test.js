const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createRoutingHarness({ playerStats, issuePveRewardTickets, consumePveEncounter, canStartPve, fetchPlayerRow, requestPveIdleEncounter } = {}) {
  const createRuntime = require(path.resolve(__dirname, "..", "联网战斗", "server.js"));
  const sent = [];
  const defaultPlayerStats = {
    hp: 100,
    attack: 10,
    defense: 1,
    speed: 1,
    mana: 1,
    crit: 0,
    critDamage: 100
  };
  const sockets = new Map([
    ["attacker-socket", { peerId: "attacker-peer", account: "attacker-account", name: "Attacker", mapName: "field", team: { leaderId: "", members: [] }, clientMirror: null }],
    ["defender-socket", { peerId: "fresh-defender-peer", account: "defender-account", name: "Defender", mapName: "field", team: { leaderId: "", members: [] }, clientMirror: null }]
  ]);

  const runtime = createRuntime({
    statLimits: { hp: 9999999, attack: 9999999, defense: 9999999, speed: 9999999, mana: 9999999, crit: 100, critDamage: 9999 },
    safeJsonArray: () => [],
    safeJsonObject: () => ({}),
    sample: (items) => items[0],
    arenaMirrorForPlayerRow: (row) => ({
      selection: {},
      actor: {
        name: row.name,
        spriteId: 1,
        x: 0,
        y: 0,
        direction: "down",
        stats: playerStats || defaultPlayerStats
      },
      pet: null,
      mercenary: null
    }),
    activeMercenaryForRow: () => null,
    fetchPlayerRow: fetchPlayerRow || ((account) => ({
      account,
      name: account === "attacker-account" ? "Attacker" : "Defender",
      selection_json: "{}"
    })),
    findSocketByPeerId: (peerId) => [...sockets.entries()].find(([, meta]) => meta.peerId === peerId)?.[0] || null,
    findSocketByAccount: (account) => [...sockets.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    findSocketByName: (name) => [...sockets.entries()].find(([, meta]) => meta.name === name)?.[0] || null,
    getSocketMeta: (socket) => sockets.get(socket),
    setSocketMeta: (socket, meta) => sockets.set(socket, meta),
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    issuePveRewardTickets,
    consumePveEncounter,
    canStartPve,
    requestPveIdleEncounter,
    choiceMs: 100000
  });

  return { runtime, sent, sockets };
}

function createTeamDisbandBattleHarness() {
  const { runtime: onlineBattle, sent, sockets } = createRoutingHarness();
  const realm = { serverId: "team-disband-realm", channelId: 1 };
  for (const socket of ["attacker-socket", "defender-socket"]) {
    Object.assign(sockets.get(socket), realm);
  }
  sockets.set("member-socket", {
    peerId: "member-peer",
    account: "member-account",
    name: "Member",
    mapName: "field",
    ...realm,
    team: { leaderId: "", members: [] },
    clientMirror: null
  });
  const disbands = [];
  const { createTeamRuntime } = require(path.resolve(__dirname, "..", "\u961f\u4f0d", "server.js"));
  const teamRuntime = createTeamRuntime({
    findSocketByPeerId: (peerId) => [...sockets.entries()].find(([, meta]) => meta.peerId === peerId)?.[0] || null,
    findSocketByAccount: (account) => [...sockets.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    getSocketMeta: (socket) => sockets.get(socket),
    setSocketMeta: (socket, meta) => sockets.set(socket, meta),
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    onTeamDisband: (event) => {
      disbands.push(event);
      return onlineBattle.endTeamBattlesForLeader(event.leaderAccount, event.realm);
    }
  });
  return { onlineBattle, teamRuntime, sent, sockets, realm, disbands };
}

function formAttackerTeam(teamRuntime) {
  assert.equal(teamRuntime.handleRoomMessage({ type: "teamJoinRequest", to: "attacker-peer" }, "member-socket"), true);
  assert.equal(teamRuntime.handleRoomMessage({ type: "teamAccepted", to: "member-peer" }, "attacker-socket"), true);
}

test("team PvP battle start falls back to defender account when peerId is stale", () => {
  const { runtime, sent } = createRoutingHarness();

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-1",
    attackerId: "attacker-peer",
    defenderId: "stale-defender-peer",
    defenderAccount: "defender-account",
    defenderName: "Defender"
  }, "attacker-socket");
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "battle-1" }, "attacker-socket");

  const starts = sent.filter((item) => item.payload.type === "teamBattleStart");
  assert.equal(starts.length, 2);
  assert.deepEqual(
    starts.map((item) => ({ socket: item.socket, to: item.payload.to, role: item.payload.role })),
    [
      { socket: "attacker-socket", to: "attacker-peer", role: "attacker" },
      { socket: "defender-socket", to: "fresh-defender-peer", role: "defender" }
    ]
  );
});

test("a defender account hint cannot be redirected through a reused stale peerId", () => {
  const { runtime, sent, sockets } = createRoutingHarness();
  sockets.set("reused-stale-peer-socket", {
    peerId: "stale-defender-peer",
    account: "unrelated-account",
    name: "Unrelated",
    mapName: "field",
    team: { leaderId: "", members: [] },
    clientMirror: null
  });

  assert.equal(runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "account-first-defender",
    attackerId: "attacker-peer",
    defenderId: "stale-defender-peer",
    defenderAccount: "defender-account",
    defenderName: "Defender"
  }, "attacker-socket"), true);

  assert.deepEqual(
    sent.filter((item) => item.payload.type === "teamBattleStart").map((item) => item.socket),
    ["attacker-socket", "defender-socket"]
  );
  runtime.handleRoomMessage({ type: "battleEscape", battleId: "account-first-defender", reason: "escape" }, "attacker-socket");
});

test("idle PVE requests only ask the server encounter issuer", () => {
  const requests = [];
  const { runtime, sent } = createRoutingHarness({
    requestPveIdleEncounter: (meta) => requests.push(meta)
  });

  assert.equal(runtime.handleRoomMessage({ type: "pveIdleEncounterRequest" }, "attacker-socket"), true);
  assert.deepEqual(requests.map((meta) => ({
    socket: meta.socket,
    account: meta.account,
    peerId: meta.peerId,
    mapName: meta.mapName
  })), [{
    socket: "attacker-socket",
    account: "attacker-account",
    peerId: "attacker-peer",
    mapName: "field"
  }]);
  assert.equal(sent.length, 0);
});

test("single-player server PVE starts and issues one owner-bound reward ticket after victory", () => {
  const issuedTickets = [];
  const consumedEncounters = [];
  const { runtime, sent } = createRoutingHarness({
    playerStats: {
      hp: 9999999,
      attack: 9999999,
      defense: 9999999,
      speed: 9999999,
      mana: 1,
      crit: 0,
      critDamage: 100,
      forceBasicAttack: true
    },
    issuePveRewardTickets: (ticket) => {
      issuedTickets.push(ticket);
      return "server-issued-solo-pve-ticket";
    },
    consumePveEncounter: ({ account, encounterId, monsterId, meta }) => {
      consumedEncounters.push({ account, encounterId, monsterId, peerId: meta.peerId });
      return encounterId === "solo-pve-encounter" ? { ok: true } : { ok: false, error: "pve_encounter_required" };
    }
  });

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "solo-pve-reward",
    wildMonsterId: "amumu",
    encounterId: "solo-pve-encounter",
    monsterCount: 999,
    enemies: [{
      name: "forged enemy",
      spriteId: 1,
      battleStats: { hp: 1, attack: 0, defense: 0, speed: 1, mana: 0, crit: 0, critDamage: 100 }
    }]
  }), { ok: true, battleId: "solo-pve-reward" });

  const starts = sent.filter((item) => item.payload.type === "teamBattleStart");
  assert.deepEqual(starts.map((item) => ({
    socket: item.socket,
    to: item.payload.to,
    pvp: item.payload.pvp,
    teamBattleServer: item.payload.teamBattleServer,
    roster: item.payload.roster.map((member) => member.account),
    enemySpriteIds: item.payload.enemies.map((enemy) => enemy.spriteId),
    monsterCount: item.payload.monsterCount
  })), [{
    socket: "attacker-socket",
    to: "attacker-peer",
    pvp: false,
    teamBattleServer: true,
    roster: ["attacker-account"],
    enemySpriteIds: [895],
    monsterCount: 1
  }]);
  assert.deepEqual(consumedEncounters, [{
    account: "attacker-account",
    encounterId: "solo-pve-encounter",
    monsterId: "amumu",
    peerId: "attacker-peer"
  }]);

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "solo-pve-parallel",
    wildMonsterId: "amumu",
    encounterId: "unused-while-active"
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "solo-pve-parallel" });
  assert.equal(sent.filter((item) => item.payload.type === "teamBattleStart").length, 1);
  assert.equal(consumedEncounters.length, 1);

  sent.length = 0;
  assert.equal(runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "solo-pve-reward",
    choice: { actions: { Attacker: { type: "attack", target: "enemy-0-actor-895" } } }
  }, "attacker-socket"), true);

  assert.deepEqual(issuedTickets, [{
    battleId: "solo-pve-reward",
    account: "attacker-account",
    monsterId: "amumu",
    monsterCount: 1
  }]);
  const reward = sent.find((item) => item.payload.type === "teamBattleReward");
  assert.deepEqual(reward && {
    socket: reward.socket,
    to: reward.payload.to,
    battleId: reward.payload.battleId,
    wildMonsterId: reward.payload.wildMonsterId,
    monsterCount: reward.payload.monsterCount,
    rewardTicket: reward.payload.rewardTicket
  }, {
    socket: "attacker-socket",
    to: "attacker-peer",
    battleId: "solo-pve-reward",
    wildMonsterId: "amumu",
    monsterCount: 1,
    rewardTicket: "server-issued-solo-pve-ticket"
  });

  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "solo-pve-reward",
    choice: { actions: { Attacker: { type: "attack", target: "enemy-0-actor-895" } } }
  }, "attacker-socket");
  assert.equal(issuedTickets.length, 1);
});

test("ordinary PVE rejects missing or failed server encounters before creating a session", () => {
  const { runtime, sent } = createRoutingHarness();

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "missing-encounter-runtime",
    wildMonsterId: "amumu",
    encounterId: "forged"
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "missing-encounter-runtime" });
  assert.deepEqual(sent.map((item) => [item.payload.type, item.payload.reason]), [
    ["battleRejected", "pve_encounter_required"]
  ]);

  const attempts = [];
  const rejected = createRoutingHarness({
    consumePveEncounter: (payload) => {
      attempts.push(payload);
      return { ok: false, error: "pve_encounter_mismatch" };
    }
  });
  assert.deepEqual(rejected.runtime.startPve("attacker-account", {
    battleId: "invalid-encounter",
    wildMonsterId: "phantom",
    encounterId: "stale-encounter"
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "invalid-encounter" });
  assert.deepEqual(rejected.sent.map((item) => [item.payload.type, item.payload.reason]), [
    ["battleRejected", "pve_encounter_mismatch"]
  ]);
  assert.deepEqual(attempts.map((payload) => ({
    account: payload.account,
    encounterId: payload.encounterId,
    monsterId: payload.monsterId,
    peerId: payload.meta.peerId
  })), [{
    account: "attacker-account",
    encounterId: "stale-encounter",
    monsterId: "phantom",
    peerId: "attacker-peer"
  }]);
  assert.equal(rejected.sent.some((item) => item.payload.type === "teamBattleStart"), false);
});

test("ordinary PVE validates its server-built roster before consuming an encounter", () => {
  let consumed = 0;
  const { runtime, sent } = createRoutingHarness({
    fetchPlayerRow: () => null,
    consumePveEncounter: () => {
      consumed += 1;
      return { ok: true };
    }
  });

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "offline-before-consume",
    wildMonsterId: "amumu",
    encounterId: "must-remain-usable"
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "offline-before-consume" });
  assert.equal(consumed, 0);
  assert.deepEqual(sent.map((item) => [item.payload.type, item.payload.reason]), [
    ["battleRejected", "offline"]
  ]);
});

test("ordinary wild battles require a server encounter, never claim locally, and retry a failed ticket claim", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /const encounterWildBattle = target\?\.wildMonsterId === "amumu" \|\| target\?\.wildMonsterId === "phantom";/);
  assert.match(appSource, /if \(encounterWildBattle && !encounterId\) return;/);
  assert.match(appSource, /const ordinaryServerWildBattle = battle\.wildMonsterId === "amumu" \|\| battle\.wildMonsterId === "phantom";/);
  assert.match(appSource, /&& !ordinaryServerWildBattle && !battle\.rewardClaimed\) \{/);
  assert.match(appSource, /const granted = await grantWildBattleReward\(msg\.wildMonsterId, msg\.monsterCount \|\| 1, msg\.rewardTicket\);/);
  assert.match(appSource, /if \(!granted\) \{\s*state\.claimedTeamRewardIds\.delete\(rewardId\);\s*return;/);
  assert.match(appSource, /const recoveredReward = msg\.recovered === true && isDirectedToMe\(msg\);\s*if \(!recoveredReward && !isActiveTeamBattleMessage\(msg\) && teamBattleInbox\?\.queue\(msg\)\)/);
  assert.match(appSource, /if \(!recoveredReward && !isActiveTeamBattleMessage\(msg\) && teamBattleInbox\?\.queue\(msg\)\) \{[\s\S]*?\} else \{\s*await acceptTeamBattleReward\(msg\);\s*\}/);
  assert.match(appSource, /if \(!options\.allowPreparedBattle && !recoveredReward && !isActiveTeamBattleMessage\(msg\)\) return;/);
  const startBattleSource = appSource.slice(appSource.indexOf("async function startBattle"), appSource.indexOf("async function startWildBattle"));
  assert.ok(startBattleSource.indexOf("if (serverAuthoritativeWildBattle)") < startBattleSource.indexOf("if (await refreshClientVersion"));
  const startWildBattleSource = appSource.slice(appSource.indexOf("async function startWildBattle"), appSource.indexOf("function handleBattleRejected"));
  assert.doesNotMatch(startWildBattleSource, /await Promise\.all\(\[loadSprite/);
});

test("only the canonical team leader may start a team PVE battle", () => {
  const consumedEncounters = [];
  const { runtime, sent, sockets } = createRoutingHarness({
    consumePveEncounter: (payload) => {
      consumedEncounters.push(payload);
      return { ok: true };
    }
  });
  const attacker = sockets.get("attacker-socket");
  const leader = sockets.get("defender-socket");
  attacker.leaderId = leader.peerId;
  attacker.team = { leaderId: leader.peerId, members: [{ peerId: attacker.peerId, account: attacker.account, name: attacker.name }] };
  leader.team = { leaderId: leader.peerId, members: [{ peerId: attacker.peerId, account: attacker.account, name: attacker.name }] };

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "member-forged-leader",
    wildMonsterId: "amumu",
    encounterId: "valid-but-not-leader",
    leaderId: attacker.peerId
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "member-forged-leader" });
  assert.equal(consumedEncounters.length, 0);
  assert.deepEqual(sent.map((item) => [item.payload.type, item.payload.reason]), [
    ["battleRejected", "team_leader_required"]
  ]);
});

test("team PVE rejects before consuming an encounter when any participant is already in battle", () => {
  const consumedEncounters = [];
  const { runtime, sent, sockets } = createRoutingHarness({
    consumePveEncounter: (payload) => {
      consumedEncounters.push(payload);
      return { ok: true };
    }
  });
  const attacker = sockets.get("attacker-socket");
  const member = {
    peerId: "member-peer",
    account: "member-account",
    name: "Member",
    mapName: "field",
    leaderId: "attacker-peer",
    team: { leaderId: "attacker-peer", members: [{ peerId: "member-peer", account: "member-account", name: "Member" }] },
    clientMirror: null
  };
  sockets.set("member-socket", member);
  attacker.team = { leaderId: attacker.peerId, members: [{ peerId: member.peerId, account: member.account, name: member.name }] };

  assert.equal(runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "member-active-pvp",
    attackerId: member.peerId,
    defenderId: "fresh-defender-peer",
    pvpMode: "solo"
  }, "member-socket"), true);
  sent.length = 0;

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "team-member-active",
    wildMonsterId: "amumu",
    encounterId: "must-not-consume"
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "team-member-active" });
  assert.equal(consumedEncounters.length, 0);
  assert.deepEqual(sent.map((item) => [item.payload.type, item.payload.reason]), [
    ["battleRejected", "battle_in_progress"]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "member-active-pvp" }, "member-socket");
});

test("a reconnect with a new peerId cannot start a second PVE for the same account", () => {
  const { runtime, sent, sockets } = createRoutingHarness({
    consumePveEncounter: () => ({ ok: true })
  });
  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "first-account-locked-pve",
    wildMonsterId: "amumu",
    encounterId: "first-encounter"
  }), { ok: true, battleId: "first-account-locked-pve" });

  sockets.delete("attacker-socket");
  sockets.set("attacker-reconnected-socket", {
    peerId: "attacker-reconnected-peer",
    account: "attacker-account",
    name: "Attacker",
    mapName: "field",
    team: { leaderId: "", members: [] },
    clientMirror: null
  });
  sent.length = 0;

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "forged-parallel-after-reconnect",
    wildMonsterId: "amumu",
    encounterId: "second-encounter"
  }), { ok: false, status: 409, error: "battle_start_rejected", battleId: "forged-parallel-after-reconnect" });
  assert.deepEqual(sent.map((item) => [item.payload.type, item.payload.reason]), [
    ["battleRejected", "battle_in_progress"]
  ]);
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "first-account-locked-pve" }, "attacker-reconnected-socket");
});

test("Afei boss victory does not issue an ordinary wild reward ticket", () => {
  const issuedTickets = [];
  const { runtime, sent } = createRoutingHarness({
    playerStats: {
      hp: 9999999,
      attack: 9999999,
      defense: 9999999,
      speed: 9999999,
      mana: 1,
      crit: 0,
      critDamage: 100,
      skillId: "sword_guard",
      skillIds: ["sword_guard"]
    },
    issuePveRewardTickets: (ticket) => {
      issuedTickets.push(ticket);
      return "must-not-be-issued";
    }
  });

  assert.deepEqual(runtime.startPve("attacker-account", {
    battleId: "afei-without-wild-ticket",
    wildMonsterId: "afei"
  }), { ok: true, battleId: "afei-without-wild-ticket" });
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "afei-without-wild-ticket",
    choice: { actions: { Attacker: { type: "skill", skillId: "sword_guard" } } }
  }, "attacker-socket");

  assert.equal(issuedTickets.length, 0);
  assert.equal(sent.some((item) => item.payload.type === "teamBattleReward"), false);
  assert.equal(sent.some((item) => item.payload.type === "teamBattleEnd"), true);
});

test("cover login is default and classic login stays switchable from admin", () => {
  const indexSource = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  const adminHtmlSource = fs.readFileSync(path.resolve(__dirname, "..", "admin.html"), "utf8");
  const adminSource = fs.readFileSync(path.resolve(__dirname, "..", "admin.js"), "utf8");
  assert.match(indexSource, /id="coverLogin"[\s\S]*登录封面\.png[\s\S]*id="coverArrow"[\s\S]*cover1\.png/);
  assert.match(indexSource, /id="coverControlPad"[\s\S]*aria-label="登录按键"/);
  assert.match(indexSource, /data-cover-index="0"[\s\S]*aria-label="快速进入"[\s\S]*data-cover-index="4"[\s\S]*aria-label="退出游戏"/);
  assert.doesNotMatch(indexSource, /id="coverDialogCancel"|id="coverInfoClose"|cover-dialog-actions/);
  assert.match(indexSource, /cover-menu-title[\s\S]*cover-menu-body[\s\S]*data-network-index="0"[\s\S]*main-menu-item submenu-item/);
  assert.match(appSource, /loginVisual:\s*\{\s*mode:\s*"cover"\s*\}/);
  assert.match(appSource, /function saveAuthCache\(account\)[\s\S]*JSON\.stringify\(\{ account \}\)/);
  assert.doesNotMatch(appSource, /JSON\.stringify\(\{ account, password \}\)/);
  assert.match(appSource, /positions:\s*\[64\.0436,\s*70\.3282,\s*76\.3365,\s*82\.5519,\s*88\.9055\]/);
  const stylesSource = fs.readFileSync(path.resolve(__dirname, "..", "styles.css"), "utf8");
  assert.match(stylesSource, /--cover-arrow-left:\s*67\.035%;[\s\S]*\.cover-arrow\s*\{[\s\S]*left:\s*var\(--cover-arrow-left\);/);
  assert.match(stylesSource, /\.cover-control-pad\s*\{[\s\S]*按键图片\.png/);
  assert.match(stylesSource, /\.cover-login\s*\{[\s\S]*justify-content:\s*flex-start;/);
  assert.match(stylesSource, /\.cover-login\s*\{[\s\S]*font-family:\s*var\(--font-ui/);
  assert.match(stylesSource, /\.cover-dialog\s*\{[\s\S]*align-items:\s*start;[\s\S]*justify-items:\s*center;/);
  assert.match(stylesSource, /\.cover-dialog\s*\{[\s\S]*pointer-events:\s*none;/);
  assert.match(stylesSource, /\.cover-dialog-panel\s*\{[\s\S]*font-family:\s*var\(--font-ui[\s\S]*pointer-events:\s*auto;/);
  assert.match(stylesSource, /\.cover-menu-title\s*\{[\s\S]*font-size:\s*14px;/);
  assert.match(stylesSource, /\.cover-menu-body\s*\{[\s\S]*font-size:\s*13px;/);
  assert.match(stylesSource, /\.cover-network-options \.main-menu-item\s*\{[\s\S]*grid-template-columns:\s*24px minmax\(0, 1fr\);/);
  assert.match(appSource, /function setupCoverControlPad\(\)[\s\S]*keyFromPointer[\s\S]*activateCoverSelection\(state\.coverLoginIndex\)/);
  assert.match(appSource, /"1":\s*"confirm"[\s\S]*"5":\s*"nearby"[\s\S]*"3":\s*"back"/);
  assert.match(appSource, /function handleCoverSubmenuKey\(key\)[\s\S]*key === "confirm" \|\| key === "nearby"[\s\S]*requestSubmit\(\)[\s\S]*key === "confirm" \|\| key === "nearby"[\s\S]*confirmCoverNetworkSelection\(\)/);
  assert.match(appSource, /function decorateCoverDialog\(dialog\)[\s\S]*decorateMenuFrame/);
  assert.doesNotMatch(appSource, /openCoverLoginDialog\(\)[\s\S]{0,500}\.focus\(\)/);
  assert.match(appSource, /autoRegister:\s*true/);
  assert.match(serverSource, /function loginVisualSetting\(\)[\s\S]*appSetting\("login_visual", \{[\s\S]*mode: "cover"/);
  assert.match(serverSource, /url\.pathname === "\/api\/admin\/login-visual"/);
  assert.match(adminHtmlSource, /id="loginVisualModeInput"[\s\S]*value="cover"[\s\S]*value="classic"/);
  assert.match(adminSource, /\/api\/admin\/login-visual/);
});

test("team PvP battle start uses current sender peerId when attacker peerId is stale", () => {
  const { runtime, sent } = createRoutingHarness();

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-stale-attacker",
    attackerId: "stale-attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "battle-stale-attacker" }, "attacker-socket");

  const starts = sent.filter((item) => item.payload.type === "teamBattleStart");
  assert.equal(starts.length, 2);
  assert.deepEqual(
    starts.map((item) => ({ socket: item.socket, to: item.payload.to, role: item.payload.role })),
    [
      { socket: "attacker-socket", to: "attacker-peer", role: "attacker" },
      { socket: "defender-socket", to: "fresh-defender-peer", role: "defender" }
    ]
  );
});

test("team PvP battle start reports offline instead of silently dropping stale defender", () => {
  const { runtime, sent } = createRoutingHarness();

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-offline",
    attackerId: "attacker-peer",
    defenderId: "stale-defender-peer"
  }, "attacker-socket");

  assert.deepEqual(
    sent.map((item) => ({ socket: item.socket, type: item.payload.type, reason: item.payload.reason })),
    [{ socket: "attacker-socket", type: "battleRejected", reason: "offline" }]
  );
});

test("team battle escape broadcasts an escape end to both sides", () => {
  const { runtime, sent } = createRoutingHarness();

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-escape",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  sent.length = 0;

  runtime.handleRoomMessage({
    type: "battleEscape",
    battleId: "battle-escape",
    reason: "escape",
    peerId: "attacker-peer"
  }, "attacker-socket");

  const ends = sent.filter((item) => item.payload.type === "teamBattleEnd");
  assert.equal(ends.length, 2);
  assert.deepEqual(
    ends.map((item) => ({ socket: item.socket, to: item.payload.to, reason: item.payload.reason, escapedPeerId: item.payload.escapedPeerId })),
    [
      { socket: "attacker-socket", to: "attacker-peer", reason: "escape", escapedPeerId: "attacker-peer" },
      { socket: "defender-socket", to: "fresh-defender-peer", reason: "escape", escapedPeerId: "attacker-peer" }
    ]
  );
});

test("trusted team disband ends the leader's active battle for every participant", () => {
  const { runtime: onlineBattle, sent, sockets } = createRoutingHarness();
  const { createTeamRuntime } = require(path.resolve(__dirname, "..", "\u961f\u4f0d", "server.js"));
  const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /onTeamDisband:\s*\(\{\s*leaderAccount,\s*realm\s*\}\)\s*=>\s*onlineBattle\?\.endTeamBattlesForLeader\(leaderAccount,\s*realm\)/);
  const realm = { serverId: "team-disband-realm", channelId: 1 };
  for (const socket of ["attacker-socket", "defender-socket"]) {
    Object.assign(sockets.get(socket), realm);
  }
  sockets.set("member-socket", {
    peerId: "member-peer",
    account: "member-account",
    name: "Member",
    mapName: "field",
    ...realm,
    team: { leaderId: "", members: [] },
    clientMirror: null
  });

  const teamRuntime = createTeamRuntime({
    findSocketByPeerId: (peerId) => [...sockets.entries()].find(([, meta]) => meta.peerId === peerId)?.[0] || null,
    findSocketByAccount: (account) => [...sockets.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    getSocketMeta: (socket) => sockets.get(socket),
    setSocketMeta: (socket, meta) => sockets.set(socket, meta),
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    onTeamDisband: ({ leaderAccount, realm: disbandRealm }) => onlineBattle.endTeamBattlesForLeader(leaderAccount, disbandRealm)
  });

  teamRuntime.handleRoomMessage({ type: "teamJoinRequest", to: "attacker-peer" }, "member-socket");
  teamRuntime.handleRoomMessage({ type: "teamAccepted", to: "member-peer" }, "attacker-socket");
  sent.length = 0;

  onlineBattle.handleRoomMessage({
    type: "battleStart",
    battleId: "team-disband-active",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  assert.equal(sent.filter((item) => item.payload.type === "teamBattleStart").length, 3);
  sent.length = 0;

  assert.equal(teamRuntime.handleRoomMessage({ type: "teamDisband" }, "attacker-socket"), true);
  const ends = sent.filter((item) => item.payload.type === "teamBattleEnd");
  assert.deepEqual(
    ends.map((item) => ({ socket: item.socket, to: item.payload.to, battleId: item.payload.battleId, reason: item.payload.reason })),
    [
      { socket: "attacker-socket", to: "attacker-peer", battleId: "team-disband-active", reason: "team_disbanded" },
      { socket: "member-socket", to: "member-peer", battleId: "team-disband-active", reason: "team_disbanded" },
      { socket: "defender-socket", to: "fresh-defender-peer", battleId: "team-disband-active", reason: "team_disbanded" }
    ]
  );

  sent.length = 0;
  onlineBattle.handleRoomMessage({
    type: "battleStart",
    battleId: "team-disband-restart",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  assert.equal(sent.filter((item) => item.payload.type === "teamBattleStart").length, 2);
  onlineBattle.handleRoomMessage({ type: "battleEscape", battleId: "team-disband-restart", reason: "escape" }, "attacker-socket");
});

test("team disband does not end a leader's active solo PvP battle", () => {
  const { onlineBattle, teamRuntime, sent, disbands } = createTeamDisbandBattleHarness();
  formAttackerTeam(teamRuntime);
  sent.length = 0;

  assert.equal(onlineBattle.handleRoomMessage({
    type: "battleStart",
    battleId: "team-leader-solo-survives-disband",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account",
    pvpMode: "solo"
  }, "attacker-socket"), true);
  assert.deepEqual(
    sent.filter((entry) => entry.payload.type === "teamBattleStart").map((entry) => entry.socket),
    ["attacker-socket", "defender-socket"]
  );
  sent.length = 0;

  assert.equal(teamRuntime.handleRoomMessage({ type: "teamDisband" }, "attacker-socket"), true);
  assert.deepEqual(disbands, [{
    leaderAccount: "attacker-account",
    leaderId: "attacker-peer",
    realm: { serverId: "team-disband-realm", channelId: 1 }
  }]);
  assert.equal(
    sent.some((entry) => entry.payload.type === "teamBattleEnd" && entry.payload.reason === "team_disbanded"),
    false
  );

  sent.length = 0;
  assert.equal(onlineBattle.handleRoomMessage({
    type: "battleEscape",
    battleId: "team-leader-solo-survives-disband",
    reason: "escape"
  }, "attacker-socket"), true);
  assert.deepEqual(
    sent.filter((entry) => entry.payload.type === "teamBattleEnd").map((entry) => ({ socket: entry.socket, reason: entry.payload.reason })),
    [
      { socket: "attacker-socket", reason: "escape" },
      { socket: "defender-socket", reason: "escape" }
    ]
  );
});

test("the final member leaving ends its active team battle through trusted disband", () => {
  const { onlineBattle, teamRuntime, sent, sockets, disbands } = createTeamDisbandBattleHarness();
  formAttackerTeam(teamRuntime);
  sent.length = 0;

  assert.equal(onlineBattle.handleRoomMessage({
    type: "battleStart",
    battleId: "final-member-leave-ends-team-battle",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket"), true);
  assert.equal(sent.filter((entry) => entry.payload.type === "teamBattleStart").length, 3);
  sent.length = 0;

  assert.equal(teamRuntime.handleRoomMessage({ type: "teamLeave" }, "member-socket"), true);
  assert.deepEqual(disbands, [{
    leaderAccount: "attacker-account",
    leaderId: "attacker-peer",
    realm: { serverId: "team-disband-realm", channelId: 1 }
  }]);
  assert.deepEqual(sockets.get("attacker-socket").team, { leaderId: "", members: [] });
  assert.deepEqual(sockets.get("member-socket").team, { leaderId: "", members: [] });
  assert.deepEqual(
    sent.filter((entry) => entry.payload.type === "teamBattleEnd").map((entry) => ({
      socket: entry.socket,
      to: entry.payload.to,
      battleId: entry.payload.battleId,
      reason: entry.payload.reason
    })),
    [
      { socket: "attacker-socket", to: "attacker-peer", battleId: "final-member-leave-ends-team-battle", reason: "team_disbanded" },
      { socket: "member-socket", to: "member-peer", battleId: "final-member-leave-ends-team-battle", reason: "team_disbanded" },
      { socket: "defender-socket", to: "fresh-defender-peer", battleId: "final-member-leave-ends-team-battle", reason: "team_disbanded" }
    ]
  );

  sent.length = 0;
  assert.equal(onlineBattle.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-after-final-member-leave",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account",
    pvpMode: "solo"
  }, "attacker-socket"), true);
  assert.deepEqual(
    sent.filter((entry) => entry.payload.type === "teamBattleStart").map((entry) => entry.socket),
    ["attacker-socket", "defender-socket"]
  );
  onlineBattle.handleRoomMessage({ type: "battleEscape", battleId: "battle-after-final-member-leave", reason: "escape" }, "attacker-socket");
});

test("a different account reusing a participant peerId cannot control or end its battle", () => {
  const { runtime, sent, sockets } = createRoutingHarness();
  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "account-bound-session",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  sent.length = 0;

  const originalAttacker = sockets.get("attacker-socket");
  sockets.set("attacker-socket", { ...originalAttacker, account: "intruder-account", name: "Intruder" });
  sockets.set("attacker-reconnected", { ...originalAttacker, peerId: "attacker-new-peer" });

  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "account-bound-session",
    choice: { actions: {} }
  }, "attacker-socket");
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "account-bound-session" }, "attacker-socket");
  assert.equal(sent.length, 0);

  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "account-bound-session",
    choice: { actions: {} }
  }, "attacker-reconnected");
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "account-bound-session",
    choice: { actions: {} }
  }, "defender-socket");

  const turnRecipients = sent
    .filter((item) => item.payload.type === "teamBattleTurn")
    .map((item) => item.socket)
    .sort();
  assert.deepEqual(turnRecipients, ["attacker-reconnected", "defender-socket"]);
});

test("PVP rejects duplicate and parallel starts for an active account", () => {
  const { runtime, sent } = createRoutingHarness();
  const start = (battleId) => runtime.handleRoomMessage({
    type: "battleStart",
    battleId,
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");

  assert.equal(start("active-first"), true);
  sent.length = 0;
  assert.equal(start("active-second"), true);
  assert.deepEqual(sent.map((item) => [item.socket, item.payload.type, item.payload.reason]), [
    ["attacker-socket", "battleRejected", "battle_in_progress"]
  ]);

  sent.length = 0;
  assert.equal(start("active-first"), true);
  assert.deepEqual(sent.map((item) => [item.socket, item.payload.type, item.payload.reason]), [
    ["attacker-socket", "battleRejected", "battle_in_progress"]
  ]);
});

test("PVP requires both participants to report the same current map", () => {
  const { runtime, sent, sockets } = createRoutingHarness();
  sockets.set("defender-socket", { ...sockets.get("defender-socket"), mapName: "remote-map" });

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "cross-map",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");

  assert.deepEqual(sent.map((item) => [item.socket, item.payload.type, item.payload.reason]), [
    ["attacker-socket", "battleRejected", "different_map"]
  ]);

  sent.length = 0;
  sockets.set("attacker-socket", { ...sockets.get("attacker-socket"), mapName: "" });
  sockets.set("defender-socket", { ...sockets.get("defender-socket"), mapName: "field" });
  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "missing-map",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  assert.deepEqual(sent.map((item) => [item.socket, item.payload.type, item.payload.reason]), [
    ["attacker-socket", "battleRejected", "different_map"]
  ]);
});

test("battle delivery follows account when a mobile client reconnects with a new peerId", () => {
  const { runtime, sent, sockets } = createRoutingHarness();

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-reconnect",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");
  sent.length = 0;

  const defender = sockets.get("defender-socket");
  sockets.set("defender-socket", { ...defender, peerId: "mobile-data-peer" });
  runtime.handleDisconnect("fresh-defender-peer");
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "battle-reconnect",
    choice: { actions: {} }
  }, "attacker-socket");
  runtime.handleRoomMessage({
    type: "teamBattleChoice",
    battleId: "battle-reconnect",
    choice: { actions: {} }
  }, "defender-socket");

  const defenderTurnOrEnd = sent.find((item) => item.socket === "defender-socket");
  assert.ok(defenderTurnOrEnd);
  assert.equal(defenderTurnOrEnd.payload.to, "mobile-data-peer");
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "battle-reconnect" }, "attacker-socket");
});

test("teamBattleStart roster carries account for mobile-network identity matching", () => {
  const { runtime, sent } = createRoutingHarness();

  runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "battle-account-roster",
    attackerId: "attacker-peer",
    defenderId: "fresh-defender-peer",
    defenderAccount: "defender-account"
  }, "attacker-socket");

  const attackerStart = sent.find((item) => item.socket === "attacker-socket" && item.payload.type === "teamBattleStart").payload;
  const defenderStart = sent.find((item) => item.socket === "defender-socket" && item.payload.type === "teamBattleStart").payload;
  assert.equal(attackerStart.roster[0].account, "attacker-account");
  assert.equal(defenderStart.roster[0].account, "defender-account");
  runtime.handleRoomMessage({ type: "teamBattleEnd", battleId: "battle-account-roster" }, "attacker-socket");
});

test("client accepts server battle start by pending battleId or stable account", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "队伍", "runtime.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);

  const state = {
    peerId: "current-mobile-peer",
    account: "acct-mobile",
    pendingBattleInvite: { battleId: "pending-battle" },
    pendingTeamPveBattleId: "",
    team: { members: [] },
    followLeaderId: ""
  };
  const runtime = sandbox.window.TeamRuntime.createRuntime({
    getState: () => state,
    getPlayerName: () => "MobileHero",
    getAccount: () => state.account,
    resolvePeerId: (peerId) => peerId,
    findPeerIdByName: () => "",
    sendRoomMessage: () => {},
    peerById: () => null,
    fighterRef: () => ""
  });

  assert.equal(runtime.isTeamMessageForMe({ type: "teamBattleStart", battleId: "pending-battle", to: "stale-peer", roster: [] }), true);
  state.pendingBattleInvite = null;
  assert.equal(runtime.isTeamMessageForMe({
    type: "teamBattleStart",
    battleId: "account-battle",
    to: "stale-peer",
    roster: [{ peerId: "old-peer", account: "acct-mobile", name: "OldName" }]
  }), true);
});
test("client no longer emits deprecated P2P battle sync messages", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  assert.equal(/type:\s*["']battleStart["']/.test(appSource), false);
  assert.equal(/type:\s*["']teamPveStart["']/.test(appSource), false);
  assert.equal(/type:\s*["']battleAccepted["']/.test(appSource), false);
  assert.equal(/type:\s*["']battleChoice["']/.test(appSource), false);
  assert.equal(/type:\s*["']battleTurn["']/.test(appSource), false);
});

test("PVP starts manual while PVE follows auto-battle setting", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /const serverAutoBattle = msg\.teamBattleServer === true && msg\.pvp !== true && state\.autoBattlePersistent === true;/);
  assert.match(appSource, /autoBattle: serverAutoBattle/);
  assert.match(appSource, /if \(battle\.pvp\) return;\s*setAutoBattle\(true\);/);
});

test("team-server auto battle uses local owner matching for actor skill strategy", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /function fighterOwnedByLocalPlayer\(fighter\)/);
  assert.match(appSource, /if \(fighterOwnedByLocalPlayer\(fighter\)\) return autoStrategyEntry\("actor"\);/);
  assert.match(appSource, /fighter\?\.actor\?\.isMercenary \|\| fighterOwnedByLocalPlayer\(fighter\) \|\| fighter\?\.actor\?\.isPet/);
});

test("title equip refreshes server stats immediately", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /if \(url\.pathname === "\/api\/title\/equip"\)[\s\S]*player: playerRowToApi\(next\)/);
  assert.match(appSource, /function applyPlayerStateResult\(player\)[\s\S]*if \(player\.serverStats\) state\.serverStats = player\.serverStats;/);
  assert.match(appSource, /const result = await postApi\("\/api\/title\/equip"[\s\S]*applyPlayerStateResult\(result\.player\);[\s\S]*broadcastState\(true\);/);
});

test("arena mercenary keeps elf spring skill and rebirth is 75 percent", () => {
  const skillsSource = fs.readFileSync(path.resolve(__dirname, "..", "战斗", "skills.js"), "utf8");
  const arenaSource = fs.readFileSync(path.resolve(__dirname, "..", "全服竞技场", "server.js"), "utf8");
  assert.match(skillsSource, /holy_rebirth:\s*\{[^}]*passiveRebirthChance:\s*0\.75/);
  assert.match(arenaSource, /if \(fighter\?\.actor\?\.isMercenary && active\.includes\("holy_elf_spring"\)\) return "holy_elf_spring";/);
  assert.match(arenaSource, /extraSkills:\s*Array\.isArray\(actor\.extraSkills\)[\s\S]*opts\.mercenaryData\?\.extraSkills/);
  assert.match(arenaSource, /mercenaries_json:\s*row\.mercenaries_json \|\| "\[\]"/);
});

test("battle canvas loads auto prompt and click effect images", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /state\.images\.get\("资源\/图片\/自动战斗\.png"\)/);
  assert.match(appSource, /state\.images\.get\("资源\/图片\/点击\.png"\)/);
  assert.match(appSource, /function drawAutoBattlePrompt\(ctx, width, now\)[\s\S]*battle\?\.autoBattle/);
  assert.match(appSource, /const scale = Math\.min\(1\.18, Math\.max\(0\.85, width \* 0\.32 \/ image\.width\)\);/);
  assert.match(appSource, /function drawCanvasClickEffects\(ctx, now, effects, setEffects\)[\s\S]*const frameW = 12;[\s\S]*frame >= 3/);
  assert.match(appSource, /\$\("#gameCanvas"\)\.addEventListener\("pointerdown", \(event\) => \{\s*addMapClickEffect\(event\);/);
  assert.match(appSource, /\$\("#battleCanvas"\)\.addEventListener\("pointerdown", addBattleClickEffect\);/);
});

test("chocobo has innate holy combo and zeus field is panel stats", () => {
  const petSource = fs.readFileSync(path.resolve(__dirname, "..", "宠物模块", "宠物目录.js"), "utf8");
  const skillsSource = fs.readFileSync(path.resolve(__dirname, "..", "战斗", "skills.js"), "utf8");
  const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  assert.match(petSource, /297:\s*"pet_default"/);
  assert.match(petSource, /297:\s*\["holy_chocobo_combo"\]/);
  assert.match(skillsSource, /holy_chocobo_combo:\s*\{[^}]*passiveComboBasic:\s*true/);
  assert.match(skillsSource, /holy_zeus_field:\s*\{[^}]*panelStatMultiplier:\s*1\.3/);
  assert.match(appSource, /function applyZeusFieldPanelStats\(stats\)[\s\S]*stats\[stat\] = Math\.round\(\(stats\[stat\] \|\| 0\) \* 1\.3\);/);
  assert.match(appSource, /learnedSkillIds\.includes\("holy_zeus_field"\)\) applyZeusFieldPanelStats\(stats\);/);
  assert.match(serverSource, /function applyZeusFieldPanelStats\(stats\)[\s\S]*stats\[stat\] = Math\.round\(\(stats\[stat\] \|\| 0\) \* 1\.3\);/);
  assert.match(serverSource, /learnedSkillIds\.includes\("holy_zeus_field"\)\) applyZeusFieldPanelStats\(stats\);/);
});
