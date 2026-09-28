const test = require("node:test");
const assert = require("node:assert/strict");
const careerTree = require("./职业树.js");
const { DatabaseSync } = require("node:sqlite");
const { REQUIRED_AMUMU_KILLS, questStatus, creditedKills, creditBattle } = require("./transfer-quest.js");

const firstSelection = careerTree.firstTransferSelections({ gender: "男" })[0];
const secondSelection = careerTree.secondTransferSelections(firstSelection)[0];

test("二转任务只在一转职业十级后累计服务端阿木木击杀", () => {
  assert.equal(creditedKills({ stage: 1, careerLevel: 9, monsterId: "amumu", monsterCount: 5 }), 0);
  assert.equal(creditedKills({ stage: 1, careerLevel: 10, monsterId: "phantom", monsterCount: 5 }), 0);
  assert.equal(creditedKills({ stage: 2, careerLevel: 10, monsterId: "amumu", monsterCount: 5 }), 0);
  assert.equal(creditedKills({ stage: 1, careerLevel: 10, monsterId: "amumu", monsterCount: 14 }), 14);
});

test("999次任务完成后才开放二转，进度有上限", () => {
  const row = { selection_json: JSON.stringify(firstSelection), career_level: 10, transfer_amumu_kills: 998 };
  assert.deepEqual(questStatus(row, careerTree), { eligible: true, kills: 998, required: REQUIRED_AMUMU_KILLS, complete: false });
  row.transfer_amumu_kills = 1003;
  assert.equal(questStatus(row, careerTree).kills, 999);
  assert.equal(questStatus(row, careerTree).complete, true);
  row.selection_json = JSON.stringify(secondSelection);
  assert.equal(questStatus(row, careerTree).complete, false);
});

test("服务端累计持久化且不超过999次", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE players (account TEXT PRIMARY KEY, transfer_amumu_kills INTEGER NOT NULL DEFAULT 0)");
  db.prepare("INSERT INTO players (account, transfer_amumu_kills) VALUES (?, ?)").run("hero", 998);
  creditBattle(db, "hero", { stage: 1, careerLevel: 10, monsterId: "amumu", monsterCount: 4 });
  assert.equal(db.prepare("SELECT transfer_amumu_kills FROM players WHERE account = ?").get("hero").transfer_amumu_kills, 999);
  assert.equal(creditBattle(db, "hero", { stage: 1, careerLevel: 10, monsterId: "phantom", monsterCount: 4 }), 0);
  db.close();
});
