const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const createDailyNewsRuntime = require("../每日新闻/server.js");

async function run() {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /staticAssetRoots[\s\S]*?"每日新闻"/);

  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE players (
      account TEXT PRIMARY KEY,
      reading_points INTEGER NOT NULL DEFAULT 0,
      lucky_box INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  db.prepare("INSERT INTO players (account) VALUES (?)").run("tester");

  const runtime = createDailyNewsRuntime({
    db,
    now: () => new Date("2026-08-01T04:00:00.000Z"),
    fetchNews: async () => new Response("news line 1\nnews line 2", { status: 200 })
  });

  assert.equal(runtime.status("tester").hasReadToday, false);
  assert.equal((await runtime.read("tester")).gainedPoints, 1);
  assert.equal((await runtime.read("tester")).gainedPoints, 0);
  assert.equal(runtime.redeem("tester", "lucky_box").ok, true);
  assert.equal(db.prepare("SELECT lucky_box FROM players WHERE account = ?").get("tester").lucky_box, 1);
  assert.equal(runtime.redeem("tester", "lucky_box").error, "not_enough_reading_points");

  console.log("daily-news runtime assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
