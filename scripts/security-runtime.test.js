const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createAuthRuntime, legacyPasswordHash } = require("../src/server/auth/runtime.js");
const { createRedeemCodeRuntime, codeHash } = require("../src/server/economy/redeem-code-runtime.js");
const { createRewardTicketRuntime } = require("../战斗/reward-ticket-runtime.js");

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

test("registrations are rate limited per source IP", () => {
  const runtime = createAuthRuntime({ db: authDb() });
  for (let index = 0; index < 5; index += 1) assert.equal(runtime.consumeRegistration("127.0.0.1"), true);
  assert.equal(runtime.consumeRegistration("127.0.0.1"), false);
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

test("server-issued battle reward ticket can only be consumed once by its owner", () => {
  const runtime = createRewardTicketRuntime({ db: new DatabaseSync(":memory:") });
  const ticket = runtime.issue({ battleId: "battle-1", account: "player", monsterId: "amumu", monsterCount: 1 });
  assert.ok(ticket);
  assert.deepEqual(runtime.consume("player", ticket), { ok: true, monsterId: "amumu", monsterCount: 1 });
  assert.equal(runtime.consume("player", ticket).error, "invalid_reward_ticket");
});
