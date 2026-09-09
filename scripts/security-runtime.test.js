const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createAuthRuntime, legacyPasswordHash } = require("../src/server/auth/runtime.js");
const { createRedeemCodeRuntime, codeHash } = require("../src/server/economy/redeem-code-runtime.js");
const { createRewardTicketRuntime } = require("../战斗/reward-ticket-runtime.js");
const { createRewardDeliveryRuntime } = require("../战斗/reward-delivery-runtime.js");

function authDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE accounts (account TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  return db;
}

test("legacy password is upgraded to scrypt after a successful login", () => {
  const db = authDb();
  db.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?)").run("player", legacyPasswordHash("secret"), "now", "now");
  const runtime = createAuthRuntime({ db });
  assert.equal(runtime.verifyAccountPassword("player", "secret", "127.0.0.1").ok, true);
  assert.match(db.prepare("SELECT password_hash FROM accounts WHERE account = ?").get("player").password_hash, /^scrypt\$/);
});

test("login attempts are rate limited after repeated failures", () => {
  const db = authDb();
  const runtime = createAuthRuntime({ db });
  for (let index = 0; index < 10; index += 1) runtime.verifyAccountPassword("missing", "wrong", "127.0.0.1");
  assert.equal(runtime.verifyAccountPassword("missing", "wrong", "127.0.0.1").error, "auth_rate_limited");
});

test("local proxy requests bypass authentication rate limits", () => {
  const runtime = createAuthRuntime({ db: authDb() });
  for (let index = 0; index < 10; index += 1) runtime.verifyAccountPassword("missing", "wrong", "203.0.113.10");
  assert.equal(
    runtime.verifyAccountPassword("missing", "wrong", "203.0.113.10", { skipRateLimit: true }).error,
    "bad_credentials"
  );
});

test("registrations are rate limited per source IP", () => {
  const runtime = createAuthRuntime({ db: authDb() });
  for (let index = 0; index < 5; index += 1) assert.equal(runtime.consumeRegistration("127.0.0.1"), true);
  assert.equal(runtime.consumeRegistration("127.0.0.1"), false);
});

test("local proxy requests bypass registration rate limits", () => {
  const runtime = createAuthRuntime({ db: authDb() });
  for (let index = 0; index < 6; index += 1) assert.equal(runtime.consumeRegistration("127.0.0.1", { skipRateLimit: true }), true);
});

test("redeem code grants once and rejects a duplicate claim", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE players (account TEXT PRIMARY KEY, soul_powder INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '')");
  db.prepare("INSERT INTO players (account) VALUES (?)").run("player");
  const runtime = createRedeemCodeRuntime({ db, itemColumnForId: (id) => id === "soul_powder" ? "soul_powder" : "" });
  db.prepare(`INSERT INTO redeem_codes (code_hash, rewards_json, max_claims, claimed_count, per_account_limit, enabled, created_at, updated_at)
    VALUES (?, ?, 1, 0, 1, 1, ?, ?)`).run(codeHash("WELCOME"), JSON.stringify({ soul_powder: 50 }), new Date().toISOString(), new Date().toISOString());
  assert.equal(runtime.claim("player", "welcome").ok, true);
  assert.equal(db.prepare("SELECT soul_powder FROM players WHERE account = ?").get("player").soul_powder, 50);
  assert.equal(runtime.claim("player", "welcome").error, "code_exhausted");
});

test("redeem code grants the seven-day phantom first-place title once", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE players (account TEXT PRIMARY KEY, soul_powder INTEGER NOT NULL DEFAULT 0, claimed_titles_json TEXT NOT NULL DEFAULT '[]', equipped_title TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");
  db.prepare("INSERT INTO players (account) VALUES (?)").run("player");
  const runtime = createRedeemCodeRuntime({
    db,
    itemColumnForId: (id) => id === "soul_powder" ? "soul_powder" : "",
    titleReward: { id: "phantom_title_first_7d", title: "幻影狩猎者（1）", durationMs: 7 * 24 * 60 * 60 * 1000 }
  });
  db.prepare(`INSERT INTO redeem_codes (code_hash, rewards_json, max_claims, claimed_count, per_account_limit, enabled, created_at, updated_at)
    VALUES (?, ?, 0, 0, 1, 1, ?, ?)`).run(codeHash("TITLE"), JSON.stringify({ soul_powder: 1, phantom_title_first_7d: 1 }), new Date().toISOString(), new Date().toISOString());
  assert.equal(runtime.claim("player", "title").ok, true);
  const player = db.prepare("SELECT * FROM players WHERE account = ?").get("player");
  assert.equal(player.equipped_title, "幻影狩猎者（1）");
  assert.equal(JSON.parse(player.claimed_titles_json)[0].title, "幻影狩猎者（1）");
  assert.equal(runtime.claim("player", "title").error, "already_claimed");
});

test("server-issued battle reward ticket can only be consumed once by its owner", () => {
  const runtime = createRewardTicketRuntime({ db: new DatabaseSync(":memory:") });
  const ticket = runtime.issue({ battleId: "battle-1", account: "player", monsterId: "amumu", monsterCount: 1 });
  assert.ok(ticket);
  assert.deepEqual(runtime.consume("player", ticket), { ok: true, monsterId: "amumu", monsterCount: 1 });
  assert.equal(runtime.consume("player", ticket).error, "invalid_reward_ticket");
});

test("recent PVE reward ticket applies a server-side battle cooldown", () => {
  let currentTime = Date.parse("2026-01-01T00:00:00.000Z");
  const runtime = createRewardTicketRuntime({ db: new DatabaseSync(":memory:"), now: () => currentTime });
  runtime.issue({ battleId: "battle-1", account: "player", monsterId: "amumu", monsterCount: 1 });
  assert.deepEqual(runtime.canStart("player"), { ok: false, error: "battle_cooldown" });
  currentTime += 5001;
  assert.deepEqual(runtime.canStart("player"), { ok: true });
});

test("ticket settlement rolls back failures and replays an already committed result", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE balances (account TEXT PRIMARY KEY, amount INTEGER NOT NULL DEFAULT 0)");
  db.prepare("INSERT INTO balances (account) VALUES (?)").run("player");
  const runtime = createRewardTicketRuntime({ db });
  const ticket = runtime.issue({ battleId: "battle-atomic", account: "player", monsterId: "amumu", monsterCount: 1 });

  const failed = runtime.claim("player", ticket, () => {
    db.prepare("UPDATE balances SET amount = amount + 10 WHERE account = ?").run("player");
    return { ok: false, error: "bad_monster_reward", status: 400 };
  });
  assert.deepEqual(failed, { ok: false, error: "bad_monster_reward", status: 400 });
  assert.equal(db.prepare("SELECT amount FROM balances WHERE account = ?").get("player").amount, 0);
  assert.equal(runtime.listPending("player").length, 1);

  const settled = runtime.claim("player", ticket, () => {
    db.prepare("UPDATE balances SET amount = amount + 10 WHERE account = ?").run("player");
    return { ok: true, reward: { exp: 10 } };
  });
  assert.deepEqual(settled, { ok: true, result: { ok: true, reward: { exp: 10 } }, replayed: false });
  assert.equal(db.prepare("SELECT amount FROM balances WHERE account = ?").get("player").amount, 10);

  const replayed = runtime.claim("player", ticket, () => {
    assert.fail("a claimed ticket must replay its persisted result instead of settling again");
  });
  assert.deepEqual(replayed, { ok: true, result: { ok: true, reward: { exp: 10 } }, replayed: true });
  assert.equal(db.prepare("SELECT amount FROM balances WHERE account = ?").get("player").amount, 10);
});

test("pending reward tickets replay to a reconnected socket on a server throttle", () => {
  let currentTime = 0;
  const sent = [];
  const runtime = createRewardDeliveryRuntime({
    listPendingTickets: () => [{ id: "ticket-1", battleId: "battle-1", monsterId: "amumu", monsterCount: 1 }],
    sendSocketJson: (socket, payload) => sent.push({ socket, payload }),
    now: () => currentTime
  });
  const meta = { account: "player", peerId: "new-peer", serverId: "realm", channelId: 2 };

  assert.equal(runtime.replay(meta, "socket"), 1);
  assert.equal(runtime.replay(meta, "socket"), 0);
  assert.deepEqual(sent, [{
    socket: "socket",
    payload: {
      type: "teamBattleReward",
      battleId: "battle-1",
      to: "new-peer",
      roster: [],
      wildMonsterId: "amumu",
      monsterCount: 1,
      rewardTicket: "ticket-1",
      rewardId: "ticket-1",
      recovered: true
    }
  }]);
  currentTime = 5001;
  assert.equal(runtime.replay(meta, "socket"), 1);
  runtime.handleDisconnect(meta);
  assert.equal(runtime.replay(meta, "socket"), 1);
});
