const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { FORGE_MATERIALS, createForgeRuntime, forgeOutcome } = require("../src/server/equipment/forge-runtime.js");

const baseRate = () => 0.5;

test("forge materials apply their exact success rules", () => {
  assert.equal(forgeOutcome({ forgeLevel: 5 }, FORGE_MATERIALS.forge_refine_gem, baseRate, () => 0.59).successRate, 0.6);
  assert.equal(forgeOutcome({ forgeLevel: 5 }, FORGE_MATERIALS.elf_forge_gem, baseRate, () => 0.79).success, true);
  assert.equal(forgeOutcome({ forgeLevel: 5 }, FORGE_MATERIALS.miracle_three_star_stone, baseRate, () => 0.999).success, true);
});

test("light gem failure drops one level without damage", () => {
  assert.deepEqual(forgeOutcome({ forgeLevel: 5 }, FORGE_MATERIALS.light_forge_gem, baseRate, () => 0.9), {
    success: false, successRate: 0.5, targetLevel: 6, forgeLevel: 4, damaged: false
  });
});

test("ordinary failure damages equipment", () => {
  assert.equal(forgeOutcome({ forgeLevel: 5 }, FORGE_MATERIALS.forge_gem, baseRate, () => 0.9).damaged, true);
});

test("failed forge atomically consumes material, unequips, then repair consumes repair gem", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE players (account TEXT PRIMARY KEY, forge_gem INTEGER, lucky_box_items_json TEXT, equipment_json TEXT, equipped_json TEXT, updated_at TEXT)");
  db.prepare("INSERT INTO players VALUES (?, ?, ?, ?, ?, '')").run("a", 1, JSON.stringify({ repair_gem: 1 }), JSON.stringify([{ id: "s", name: "铁剑+5", type: "sword", forgeLevel: 5 }]), JSON.stringify({ weapon: "s" }));
  const safeJsonObject = (raw) => { try { const value = JSON.parse(raw || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } };
  const normalizeEquipmentList = (raw) => ({ equipment: JSON.parse(raw).map((item) => ({ ...item, damaged: Boolean(item.damaged), maxForgeLevel: 15 })) });
  const runtime = createForgeRuntime({ db, safeJsonObject, normalizeEquipmentList, forgeSuccessRate: baseRate, equipmentIconForType: () => "1.3", random: () => 0.9 });

  assert.equal(runtime.forge("a", "s").damaged, true);
  let row = db.prepare("SELECT * FROM players WHERE account = 'a'").get();
  assert.equal(row.forge_gem, 0);
  assert.deepEqual(JSON.parse(row.equipped_json), {});
  assert.equal(runtime.repair("a", "s").ok, true);
  row = db.prepare("SELECT * FROM players WHERE account = 'a'").get();
  assert.equal(JSON.parse(row.lucky_box_items_json).repair_gem, 0);
  assert.equal(JSON.parse(row.equipment_json)[0].damaged, false);
});
