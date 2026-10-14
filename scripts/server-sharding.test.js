const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");

function seedLegacyDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE players (
      account TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      map_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `);
  db.prepare("INSERT INTO players (account, name, x, y, map_name, updated_at) VALUES (?, ?, 0, 0, '', ?)")
    .run("legacy-role", "LegacyHero", new Date().toISOString());
  db.exec(`
    CREATE TABLE arena_rankings (
      rank INTEGER PRIMARY KEY,
      account TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mirror_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE phantom_rankings (
      account TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  const seededAt = new Date().toISOString();
  db.prepare("INSERT INTO arena_rankings (rank, account, name, mirror_json, updated_at) VALUES (7, ?, ?, '{}', ?)")
    .run("legacy-role", "LegacyHero", seededAt);
  db.prepare("INSERT INTO phantom_rankings (account, name, points, updated_at) VALUES (?, ?, 12, ?)")
    .run("legacy-role", "LegacyHero", seededAt);
  db.close();
}

function startServer(dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "server.js")], {
      cwd: root,
      env: {
        ...process.env,
        PORT: "0",
        PLAYER_DB_PATH: dbPath,
        ENABLE_BW_OPT: "0",
        NODE_ENV: "test"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server start timeout\n${output}`));
    }, 20000);
    const onOutput = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/\[::\]:(\d+)\//);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, baseUrl: `http://127.0.0.1:${match[1]}`, output: () => output });
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (!/http:\/\/\[::\]:(\d+)\//.test(output)) reject(new Error(`server exited ${code}\n${output}`));
    });
  });
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

async function api(baseUrl, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.admin) headers["x-admin-password"] = "admin123";
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openRoomSocket(baseUrl, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/room?token=${encodeURIComponent(token)}`);
    const messages = [];
    const timer = setTimeout(() => reject(new Error("websocket open timeout")), 5000);
    socket.addEventListener("message", (event) => {
      try { messages.push(JSON.parse(String(event.data))); } catch {}
    });
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({ socket, messages });
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    }, { once: true });
  });
}

async function waitForMessage(messages, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await delay(20);
  }
  return null;
}

test("server and character shards preserve legacy rows and isolate character data", { timeout: 60000 }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-server-shards-"));
  const dbPath = path.join(tempDir, "players.sqlite");
  seedLegacyDatabase(dbPath);
  const running = await startServer(dbPath);
  t.after(async () => {
    await stopServer(running.child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const migratedDb = new DatabaseSync(dbPath);
  const arenaPrimaryKey = migratedDb.prepare("PRAGMA table_info(arena_rankings)").all()
    .filter((column) => column.pk)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  const phantomPrimaryKey = migratedDb.prepare("PRAGMA table_info(phantom_rankings)").all()
    .filter((column) => column.pk)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  assert.deepEqual(arenaPrimaryKey, ["server_id", "rank"]);
  assert.deepEqual(phantomPrimaryKey, ["server_id", "account"]);
  assert.deepEqual(
    { ...migratedDb.prepare("SELECT server_id, rank, account FROM arena_rankings WHERE account = ?").get("legacy-role") },
    { server_id: "penguin_village", rank: 7, account: "legacy-role" }
  );
  assert.deepEqual(
    { ...migratedDb.prepare("SELECT server_id, account, points FROM phantom_rankings WHERE account = ?").get("legacy-role") },
    { server_id: "penguin_village", account: "legacy-role", points: 12 }
  );
  migratedDb.close();

  const servers = await api(running.baseUrl, "/api/servers");
  assert.equal(servers.status, 200);
  assert.equal(servers.payload.channelCount, 6);
  assert.equal(servers.payload.servers.length, 1);
  assert.equal(servers.payload.servers[0].id, "penguin_village");
  assert.equal(servers.payload.servers[0].name, "企鹅村");
  assert.equal(servers.payload.servers[0].channels.length, 6);

  const legacy = await api(running.baseUrl, "/api/admin/players?q=LegacyHero", { admin: true });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.payload.players.length, 1);
  assert.equal(legacy.payload.players[0].characterId, "legacy-role");
  assert.equal(legacy.payload.players[0].ownerAccount, "legacy-role");
  assert.equal(legacy.payload.players[0].serverId, "penguin_village");
  assert.equal(legacy.payload.players[0].characterSlot, 1);

  const register = await api(running.baseUrl, "/api/auth/register", {
    body: { account: "shard-user", password: "pass1234" }
  });
  assert.equal(register.status, 200);
  const loginToken = register.payload.token;

  const emptyCharacters = await api(running.baseUrl, "/api/characters?serverId=penguin_village", { token: loginToken });
  assert.equal(emptyCharacters.status, 200);
  assert.equal(emptyCharacters.payload.maxCharacters, 3);
  assert.deepEqual(emptyCharacters.payload.characters, []);

  const createCharacter = (name, gender, channelId = 1, serverId = "penguin_village", extra = {}) => api(running.baseUrl, "/api/characters", {
    token: loginToken,
    body: { serverId, channelId, name, gender, ...extra }
  });

  const first = await createCharacter("ShardHero1", "男", 1, "penguin_village", {
    selection: { className: "法师", sub: "裁决", petId: 895 }
  });
  assert.equal(first.status, 201);
  assert.ok(first.payload.token);
  assert.equal(first.payload.channelId, 1);
  assert.equal(first.payload.character.characterSlot, 1);
  assert.equal(first.payload.character.gender, "男");
  assert.equal(first.payload.character.selection.className, "初始角色");
  assert.equal(first.payload.character.selection.petId, 486);

  const second = await createCharacter("ShardHero2", "女", 2);
  assert.equal(second.status, 201);
  const third = await createCharacter("ShardHero3", "男", 3);
  assert.equal(third.status, 201);
  const fourth = await createCharacter("ShardHero4", "女", 4);
  assert.equal(fourth.status, 409);
  assert.equal(fourth.payload.error, "character_limit");

  const badChannel = await api(running.baseUrl, "/api/characters/select", {
    token: loginToken,
    body: { serverId: "penguin_village", channelId: 7, characterId: first.payload.characterId }
  });
  assert.equal(badChannel.status, 400);
  assert.equal(badChannel.payload.error, "bad_channel");

  const thirdOnLineOne = await api(running.baseUrl, "/api/characters/select", {
    token: loginToken,
    body: { serverId: "penguin_village", channelId: 1, characterId: third.payload.characterId }
  });
  assert.equal(thirdOnLineOne.status, 200);
  const roomOne = await openRoomSocket(running.baseUrl, first.payload.token);
  const roomSame = await openRoomSocket(running.baseUrl, thirdOnLineOne.payload.token);
  const roomOtherLine = await openRoomSocket(running.baseUrl, second.payload.token);
  roomOne.socket.send(JSON.stringify({ type: "state", peerId: "peer-line-1-a", name: "ShardHero1", mapName: "MapA", full: true }));
  roomSame.socket.send(JSON.stringify({ type: "state", peerId: "peer-line-1-b", name: "ShardHero3", mapName: "MapA", full: true }));
  roomOtherLine.socket.send(JSON.stringify({ type: "state", peerId: "peer-line-2", name: "ShardHero2", mapName: "MapA", full: true }));
  await delay(100);
  roomOne.messages.length = 0;
  roomSame.messages.length = 0;
  roomOtherLine.messages.length = 0;
  roomOne.socket.send(JSON.stringify({ type: "chat", peerId: "peer-line-1-a", text: "same-line" }));
  assert.ok(await waitForMessage(roomSame.messages, (message) => message.type === "chat" && message.text === "same-line"));
  await delay(150);
  assert.equal(roomOtherLine.messages.some((message) => message.type === "chat"), false);
  roomOne.socket.send(JSON.stringify({ type: "privateChat", peerId: "peer-line-1-a", to: "peer-line-2", text: "blocked" }));
  await delay(150);
  assert.equal(roomOtherLine.messages.some((message) => message.type === "privateChat" && message.text === "blocked"), false);
  roomOne.socket.close();
  roomSame.socket.close();
  roomOtherLine.socket.close();

  const saveFirst = await api(running.baseUrl, "/api/player", {
    token: first.payload.token,
    body: { name: "ShardHero1", x: 11, y: 22, mapName: "MapA" }
  });
  assert.equal(saveFirst.status, 200);
  const saveSecond = await api(running.baseUrl, "/api/player", {
    token: second.payload.token,
    body: { name: "ShardHero2", x: 99, y: 88, mapName: "MapB" }
  });
  assert.equal(saveSecond.status, 200);
  const readFirst = await api(running.baseUrl, "/api/player", { token: first.payload.token });
  const readSecond = await api(running.baseUrl, "/api/player", { token: second.payload.token });
  assert.equal(readFirst.payload.player.x, 11);
  assert.equal(readFirst.payload.player.mapName, "MapA");
  assert.equal(readSecond.payload.player.x, 99);
  assert.equal(readSecond.payload.player.mapName, "MapB");

  const createServer = await api(running.baseUrl, "/api/admin/servers", {
    admin: true,
    body: { id: "second_world", name: "Second World" }
  });
  assert.equal(createServer.status, 201);
  assert.equal(createServer.payload.server.channelCount, 6);

  const otherServerRole = await createCharacter("OtherHero", "女", 1, "second_world");
  assert.equal(otherServerRole.status, 201);
  assert.equal(otherServerRole.payload.character.characterSlot, 1);
  assert.equal(otherServerRole.payload.character.serverId, "second_world");

  const hiddenAcrossServer = await api(
    running.baseUrl,
    `/api/player-public?serverId=penguin_village&account=${encodeURIComponent(otherServerRole.payload.characterId)}`
  );
  assert.equal(hiddenAcrossServer.status, 404);

  const crossServerGive = await api(running.baseUrl, "/api/bag/give", {
    token: first.payload.token,
    body: { id: "soul_powder", quantity: 1, toName: "OtherHero" }
  });
  assert.equal(crossServerGive.status, 404);
  assert.equal(crossServerGive.payload.error, "target_not_found");

  const seedRealmData = new DatabaseSync(dbPath);
  seedRealmData.prepare("UPDATE players SET silver = 1000, soul_powder = 10, phantom_fragment = 5 WHERE account = ?")
    .run(first.payload.characterId);
  seedRealmData.prepare("UPDATE players SET silver = 1000, soul_powder = 5 WHERE account = ?")
    .run(second.payload.characterId);
  seedRealmData.prepare("UPDATE players SET silver = 1000, soul_powder = 5 WHERE account = ?")
    .run(third.payload.characterId);
  seedRealmData.prepare("UPDATE players SET silver = 1000, phantom_fragment = 9 WHERE account = ?")
    .run(otherServerRole.payload.characterId);
  seedRealmData.close();

  const uploadPenguinArena = await api(running.baseUrl, "/api/arena/upload", {
    token: first.payload.token,
    body: {}
  });
  const uploadOtherArena = await api(running.baseUrl, "/api/arena/upload", {
    token: otherServerRole.payload.token,
    body: {}
  });
  assert.equal(uploadPenguinArena.status, 200);
  assert.equal(uploadOtherArena.status, 200);
  assert.equal(uploadPenguinArena.payload.rank, 100);
  assert.equal(uploadOtherArena.payload.rank, 100);
  const penguinArena = await api(running.baseUrl, "/api/arena/rankings", { token: first.payload.token });
  const otherArena = await api(running.baseUrl, "/api/arena/rankings", { token: otherServerRole.payload.token });
  assert.equal(penguinArena.payload.rankings[99].account, first.payload.characterId);
  assert.equal(otherArena.payload.rankings[99].account, otherServerRole.payload.characterId);
  assert.equal(penguinArena.payload.rankings.some((entry) => entry.account === otherServerRole.payload.characterId), false);
  assert.equal(otherArena.payload.rankings.some((entry) => entry.account === first.payload.characterId), false);

  const submitPenguinPhantom = await api(running.baseUrl, "/api/phantom/submit", {
    token: first.payload.token,
    body: { quantity: 5 }
  });
  const submitOtherPhantom = await api(running.baseUrl, "/api/phantom/submit", {
    token: otherServerRole.payload.token,
    body: { quantity: 9 }
  });
  assert.equal(submitPenguinPhantom.status, 200);
  assert.equal(submitOtherPhantom.status, 200);
  const penguinPhantom = await api(running.baseUrl, "/api/phantom/status", { token: first.payload.token });
  const otherPhantom = await api(running.baseUrl, "/api/phantom/status", { token: otherServerRole.payload.token });
  assert.equal(penguinPhantom.payload.rankings.some((entry) => entry.account === otherServerRole.payload.characterId), false);
  assert.equal(otherPhantom.payload.rankings.some((entry) => entry.account === first.payload.characterId), false);
  assert.equal(otherPhantom.payload.rankings[0].account, otherServerRole.payload.characterId);

  const createBrag = await api(running.baseUrl, "/api/mad-brag/create", {
    token: first.payload.token,
    body: {
      question: "realm question",
      optionA: "yes",
      optionB: "no",
      correctOption: "A",
      stake: { type: "silver", quantity: 100 }
    }
  });
  assert.equal(createBrag.status, 200);
  const otherBragList = await api(running.baseUrl, "/api/mad-brag/list", { token: otherServerRole.payload.token });
  assert.deepEqual(otherBragList.payload.challenges, []);
  const crossServerAnswer = await api(running.baseUrl, "/api/mad-brag/answer", {
    token: otherServerRole.payload.token,
    body: { challengeId: createBrag.payload.challenge.id, choice: "A" }
  });
  assert.equal(crossServerAnswer.status, 404);
  assert.equal(crossServerAnswer.payload.error, "challenge_not_found");
  const penguinBragList = await api(running.baseUrl, "/api/mad-brag/list", { token: second.payload.token });
  assert.equal(penguinBragList.payload.challenges.length, 1);
  const settleBrag = await api(running.baseUrl, "/api/mad-brag/answer", {
    token: second.payload.token,
    body: { challengeId: createBrag.payload.challenge.id, choice: "A" }
  });
  assert.equal(settleBrag.status, 200);
  assert.equal(settleBrag.payload.won, true);
  const penguinBragRanks = await api(running.baseUrl, "/api/mad-brag/rankings", { token: first.payload.token });
  const otherBragRanks = await api(running.baseUrl, "/api/mad-brag/rankings", { token: otherServerRole.payload.token });
  assert.equal(penguinBragRanks.payload.profit[0].account, second.payload.characterId);
  assert.deepEqual(otherBragRanks.payload.profit, []);
  assert.deepEqual(otherBragRanks.payload.loss, []);

  const tradeSameSocket = await openRoomSocket(running.baseUrl, thirdOnLineOne.payload.token);
  const tradeOtherLineSocket = await openRoomSocket(running.baseUrl, second.payload.token);
  const crossLineGive = await api(running.baseUrl, "/api/bag/give", {
    token: first.payload.token,
    body: { id: "soul_powder", quantity: 1, toName: "ShardHero2" }
  });
  assert.equal(crossLineGive.status, 409);
  assert.equal(crossLineGive.payload.error, "target_not_in_channel");
  const sameLineGive = await api(running.baseUrl, "/api/bag/give", {
    token: first.payload.token,
    body: { id: "soul_powder", quantity: 1, toName: "ShardHero3" }
  });
  assert.equal(sameLineGive.status, 200);
  const crossLineStall = await api(running.baseUrl, "/api/stall/buy", {
    token: first.payload.token,
    body: { sellerAccount: second.payload.characterId, id: "soul_powder", quantity: 1, price: 10 }
  });
  assert.equal(crossLineStall.status, 409);
  assert.equal(crossLineStall.payload.error, "target_not_in_channel");
  const sameLineStall = await api(running.baseUrl, "/api/stall/buy", {
    token: first.payload.token,
    body: { sellerAccount: third.payload.characterId, id: "soul_powder", quantity: 1, price: 10 }
  });
  assert.equal(sameLineStall.status, 200);
  tradeSameSocket.socket.close();
  tradeOtherLineSocket.socket.close();

  const raceRegister = await api(running.baseUrl, "/api/auth/register", {
    body: { account: "race-user", password: "pass1234" }
  });
  const raceCreates = await Promise.all([1, 2, 3, 4].map((index) => api(running.baseUrl, "/api/characters", {
    token: raceRegister.payload.token,
    body: { serverId: "penguin_village", channelId: 1, name: `RaceHero${index}`, gender: index % 2 ? "男" : "女" }
  })));
  assert.deepEqual(raceCreates.map((result) => result.status).sort(), [201, 201, 201, 409]);
});

test("online battle target resolution stays inside the sender realm", () => {
  const createRuntime = require(path.join(root, "联网战斗", "server.js"));
  const sockets = { a: { id: "a" }, b: { id: "b" } };
  const metas = new Map([
    [sockets.a, { peerId: "a", account: "role-a", name: "A", serverId: "penguin_village", channelId: 1, team: { members: [] } }],
    [sockets.b, { peerId: "b", account: "role-b", name: "B", serverId: "penguin_village", channelId: 2, team: { members: [] } }]
  ]);
  const rows = new Map([
    ["role-a", { account: "role-a", name: "A", selection_json: "{}", equipment_json: "[]", equipped_json: "{}" }],
    ["role-b", { account: "role-b", name: "B", selection_json: "{}", equipment_json: "[]", equipped_json: "{}" }]
  ]);
  const sent = [];
  const matches = (meta, realm) => !realm?.serverId || (meta.serverId === realm.serverId && meta.channelId === realm.channelId);
  const findByMeta = (predicate, realm) => [...metas.entries()].find(([, meta]) => predicate(meta) && matches(meta, realm))?.[0] || null;
  const runtime = createRuntime({
    statLimits: { crit: 100, critDamage: 2000 },
    safeJsonArray: (value) => { try { return JSON.parse(value || "[]"); } catch { return []; } },
    safeJsonObject: (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } },
    sample: (items) => items[0],
    activeMercenaryForRow: () => null,
    arenaMirrorForPlayerRow: (row) => ({
      actor: { name: row.name, spriteId: 1, stats: { hp: 100, attack: 10, defense: 0, speed: 10, mana: 10, crit: 0, critDamage: 100 } },
      pet: null,
      mercenary: null,
      selection: {}
    }),
    fetchPlayerRow: (account) => rows.get(account),
    findSocketByPeerId: (peerId, realm) => findByMeta((meta) => meta.peerId === peerId, realm),
    findSocketByAccount: (account, realm) => findByMeta((meta) => meta.account === account, realm),
    findSocketByName: (name, realm) => findByMeta((meta) => meta.name === name, realm),
    getSocketMeta: (socket) => metas.get(socket) || {},
    setSocketMeta: (socket, meta) => metas.set(socket, meta),
    sendSocketJson: (socket, payload) => sent.push({ socket: socket.id, payload }),
    choiceMs: 60000
  });

  assert.equal(runtime.handleRoomMessage({
    type: "battleStart",
    battleId: "cross-line",
    attackerId: "a",
    defenderId: "b",
    defenderAccount: "role-b",
    defenderName: "B",
    pvpMode: "solo"
  }, sockets.a), true);
  assert.deepEqual(sent.map((entry) => ({ socket: entry.socket, type: entry.payload.type, reason: entry.payload.reason })), [
    { socket: "a", type: "battleRejected", reason: "offline" }
  ]);
});

test("room broadcast checks realm before directed and map routing", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const battleRuntimeSource = fs.readFileSync(path.join(root, "联网战斗", "runtime.js"), "utf8");
  assert.match(source, /function shouldForwardRoomMessage[\s\S]*if \(!sameSocketRealm\(senderMeta, clientMeta\)\) return false;[\s\S]*if \(data\.to\)/);
  assert.match(source, /socketMeta\.set\(socket, \{[\s\S]*serverId: authenticatedServerId,[\s\S]*channelId: authenticatedChannelId/);
  assert.match(source, /onlineBattle\.handleDisconnect\(meta\.peerId \|\| "", socketRealm\(meta\)\)/);
  assert.match(battleRuntimeSource, /function handleDisconnect\(peerId = "", realm = null\)[\s\S]*pendingRealm\.serverId !== disconnectedRealm\.serverId[\s\S]*pendingRealm\.channelId !== disconnectedRealm\.channelId/);
});
