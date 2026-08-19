const FORGE_MATERIALS = Object.freeze({
  forge_gem: { name: "锻造宝石", bonus: 0 },
  forge_refine_gem: { name: "精炼宝石", bonus: 0.1 },
  light_forge_gem: { name: "轻段宝石", bonus: 0, safeFailure: true },
  elf_forge_gem: { name: "精灵锻造宝石", bonus: 0.3 },
  miracle_three_star_stone: { name: "神迹三星石", guaranteed: true }
});

const MAIN_VALUE_PER_LEVEL = Object.freeze({
  hat: 10000 / 15,
  armor: 100000 / 15,
  pants: 50000 / 15,
  belt: 500000 / 15,
  shoes: 10000 / 15,
  firearm: 10000 / 15,
  sword: 50000 / 15,
  staff: 10000 / 15
});

function forgeOutcome(item, material, baseRate, random) {
  const currentLevel = Math.max(0, Number(item.forgeLevel) || 0);
  const targetLevel = currentLevel + 1;
  const successRate = material.guaranteed ? 1 : Math.min(1, baseRate(targetLevel) + material.bonus);
  const success = random() < successRate;
  const forgeLevel = success ? targetLevel : material.safeFailure ? Math.max(0, currentLevel - 1) : currentLevel;
  return { success, successRate, targetLevel, forgeLevel, damaged: !success && !material.safeFailure };
}

function createForgeRuntime({ db, normalizeEquipmentList, safeJsonObject, forgeSuccessRate, equipmentIconForType, random = Math.random, now = () => new Date() }) {
  function forge(account, equipmentId, materialId = "forge_gem") {
    const material = FORGE_MATERIALS[materialId];
    if (!material) return { ok: false, error: "invalid_forge_material", status: 400 };
    try {
      db.exec("BEGIN IMMEDIATE");
      const row = db.prepare("SELECT forge_gem, lucky_box_items_json, equipment_json, equipped_json FROM players WHERE account = ?").get(account);
      if (!row) throw new Error("player_not_found");
      const equipment = normalizeEquipmentList(row.equipment_json, account).equipment;
      const item = equipment.find((entry) => entry.id === equipmentId);
      if (!item) throw new Error("equipment_not_found");
      if (item.damaged) throw new Error("damaged_equipment");
      const maxForgeLevel = Math.max(0, Number(item.maxForgeLevel) || 15);
      if ((item.forgeLevel || 0) >= maxForgeLevel) throw new Error("max_forge");

      const boxItems = safeJsonObject(row.lucky_box_items_json);
      const quantity = materialId === "forge_gem" ? Number(row.forge_gem) || 0 : Number(boxItems[materialId]) || 0;
      if (quantity < 1) throw new Error("not_enough_gem");

      const outcome = forgeOutcome(item, material, forgeSuccessRate, random);
      item.forgeLevel = outcome.forgeLevel;
      item.mainValue = Math.round((MAIN_VALUE_PER_LEVEL[item.type] || 0) * item.forgeLevel);
      item.name = item.name.replace(/\+\d+$/, `+${item.forgeLevel}`);
      item.icon ||= equipmentIconForType(item.type);
      item.damaged = outcome.damaged;

      const equipped = safeJsonObject(row.equipped_json);
      if (item.damaged) {
        for (const [slot, id] of Object.entries(equipped)) if (id === item.id) delete equipped[slot];
      }
      if (materialId === "forge_gem") row.forge_gem -= 1;
      else boxItems[materialId] = quantity - 1;
      const updatedAt = now().toISOString();
      db.prepare("UPDATE players SET forge_gem = ?, lucky_box_items_json = ?, equipment_json = ?, equipped_json = ?, updated_at = ? WHERE account = ?")
        .run(row.forge_gem, JSON.stringify(boxItems), JSON.stringify(equipment), JSON.stringify(equipped), updatedAt, account);
      db.exec("COMMIT");
      return { ok: true, ...outcome, equipment: item, materialId, materialRemaining: quantity - 1, forgeGem: row.forge_gem, equipped };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      const known = ["player_not_found", "equipment_not_found", "damaged_equipment", "max_forge", "not_enough_gem"];
      const code = known.includes(error.message) ? error.message : "forge_failed";
      const status = code.endsWith("not_found") ? 404 : code === "forge_failed" ? 500 : 409;
      return { ok: false, error: code, status };
    }
  }

  function repair(account, equipmentId) {
    try {
      db.exec("BEGIN IMMEDIATE");
      const row = db.prepare("SELECT lucky_box_items_json, equipment_json FROM players WHERE account = ?").get(account);
      if (!row) throw new Error("player_not_found");
      const boxItems = safeJsonObject(row.lucky_box_items_json);
      if ((Number(boxItems.repair_gem) || 0) < 1) throw new Error("not_enough_repair_gem");
      const equipment = normalizeEquipmentList(row.equipment_json, account).equipment;
      const item = equipment.find((entry) => entry.id === equipmentId);
      if (!item) throw new Error("equipment_not_found");
      if (!item.damaged) throw new Error("equipment_not_damaged");
      item.damaged = false;
      boxItems.repair_gem -= 1;
      db.prepare("UPDATE players SET lucky_box_items_json = ?, equipment_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(boxItems), JSON.stringify(equipment), now().toISOString(), account);
      db.exec("COMMIT");
      return { ok: true, equipment: item, repairGem: boxItems.repair_gem };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      const known = ["player_not_found", "equipment_not_found", "not_enough_repair_gem", "equipment_not_damaged"];
      const code = known.includes(error.message) ? error.message : "repair_failed";
      const status = code.endsWith("not_found") ? 404 : code === "repair_failed" ? 500 : 409;
      return { ok: false, error: code, status };
    }
  }

  return { forge, repair };
}

module.exports = { FORGE_MATERIALS, createForgeRuntime, forgeOutcome };
