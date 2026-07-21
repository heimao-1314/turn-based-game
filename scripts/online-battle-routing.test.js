const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createRoutingHarness() {
  const createRuntime = require(path.resolve(__dirname, "..", "联网战斗", "server.js"));
  const sent = [];
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
        stats: { hp: 100, attack: 10, defense: 1, speed: 1, mana: 1, crit: 0, critDamage: 100 }
      },
      pet: null,
      mercenary: null
    }),
    activeMercenaryForRow: () => null,
    fetchPlayerRow: (account) => ({
      account,
      name: account === "attacker-account" ? "Attacker" : "Defender",
      selection_json: "{}"
    }),
    findSocketByPeerId: (peerId) => [...sockets.entries()].find(([, meta]) => meta.peerId === peerId)?.[0] || null,
    findSocketByAccount: (account) => [...sockets.entries()].find(([, meta]) => meta.account === account)?.[0] || null,
    findSocketByName: (name) => [...sockets.entries()].find(([, meta]) => meta.name === name)?.[0] || null,
    getSocketMeta: (socket) => sockets.get(socket),
    setSocketMeta: (socket, meta) => sockets.set(socket, meta),
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    choiceMs: 100000
  });

  return { runtime, sent, sockets };
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
