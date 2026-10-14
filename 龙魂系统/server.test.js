const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createDragonSoulRuntime } = require("./server.js");
const rules = require("./shared.js");

function setup(random) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT, updated_at TEXT); CREATE TABLE players (account TEXT PRIMARY KEY, dragon_soul INTEGER, dragon_soul_exp INTEGER, dragon_soul_daily_key TEXT, dragon_soul_daily_used INTEGER, soul_powder INTEGER, updated_at TEXT)");
  db.prepare("INSERT INTO players VALUES (?, 0, 0, '', 0, 1000, '')").run("a");
  return { db, runtime: createDragonSoulRuntime({ db, random, now: () => new Date("2026-08-08T12:00:00+08:00") }) };
}

test("普通进化扣粉末、加经验并消耗次数", () => {
  const { runtime } = setup(() => 0.9);
  const result = runtime.evolve("a");
  assert.equal(result.state.exp, 200);
  assert.equal(result.state.soulPowder, 950);
  assert.equal(result.state.dailyUsed, 1);
});

test("暴击增加1000经验且不消耗次数", () => {
  const { runtime } = setup(() => 0.1);
  const result = runtime.evolve("a");
  assert.equal(result.critical, true);
  assert.equal(result.state.level, 1);
  assert.equal(result.state.exp, 0);
  assert.equal(result.state.dailyUsed, 0);
});

test("每日普通进化达到10次后拒绝且不扣粉末", () => {
  const { db, runtime } = setup(() => 0.9);
  db.prepare("UPDATE players SET dragon_soul_daily_key = '2026-08-08', dragon_soul_daily_used = 10").run();
  const result = runtime.evolve("a");
  assert.equal(result.error, "daily_limit");
  assert.equal(db.prepare("SELECT soul_powder FROM players WHERE account = 'a'").get().soul_powder, 1000);
});

test("阶段详情严格使用表格对应行，斜杠字段按0处理", () => {
  const bronze = rules.stageStatsAt(0);
  const diamond = rules.stageStatsAt(6);
  assert.equal(bronze.attack, 1000);
  assert.equal(bronze.dodge, 0);
  assert.equal(bronze.crit, 0);
  assert.equal(diamond.attack, 10000);
  assert.equal(diamond.hp, 100000);
  assert.equal(diamond.crit, 20);
});

test("角色累计属性保留龙魂抗性供个人面板和战斗调用", () => {
  const stats = rules.statsAt(40);
  assert.equal(stats.confuseResist, 30);
  assert.equal(stats.sealResist, 30);
  assert.equal(stats.paralyzeResist, 30);
  assert.equal(stats.curseResist, 30);
  assert.equal(stats.sleepResist, 30);
  assert.equal(stats.antiCritDamage, 100);
});
