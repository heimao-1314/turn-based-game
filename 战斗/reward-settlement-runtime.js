function createRewardSettlementRuntime(deps) {
  const { db } = deps;

  function recordIgnoredPayload(account, data, ticket) {
    if (data.exp == null && data.petExp == null && data.forgeGem == null && data.equipmentCount == null && data.fragments == null && data.equipment == null) return;
    deps.recordAnomaly(account, "client_reward_payload_ignored", {
      monsterId: ticket.monsterId,
      monsterCount: ticket.monsterCount,
      exp: data.exp,
      petExp: data.petExp,
      forgeGem: data.forgeGem,
      equipmentCount: data.equipmentCount,
      fragments: data.fragments,
      equipment: data.equipment
    }, 2, "ignore");
  }

  function settle(account, ticketId, data = {}) {
    return deps.claimTicket(account, ticketId, (ticket) => {
      const reward = deps.rollWildBattleReward(ticket.monsterId, ticket.monsterCount);
      if (!reward) return { ok: false, error: "bad_monster_reward", status: 400 };
      let row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!row) {
        deps.upsertPlayer({ account, name: account, x: 0, y: 0, mapName: "", level: 1, exp: 0, dragonSoul: 1 });
        row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      }
      if (!row) return { ok: false, error: "player_not_found", status: 404 };

      const trustedData = { ...data, monsterId: ticket.monsterId, monsterCount: ticket.monsterCount };
      recordIgnoredPayload(account, trustedData, ticket);
      deps.detectUploadedPlayerStats(account, "/api/battle-reward", trustedData, deps.statsForPlayerRow(row));

      const leveled = deps.applyExp(row.level, row.exp, reward.exp);
      const careerStage = deps.careerTree.careerStage(deps.safeJsonObject(row.selection_json));
      const previousCareerProgress = deps.normalizeProgress({ level: row.career_level, exp: row.career_exp });
      const careerLeveled = careerStage > 0
        ? deps.applyCareerExp(previousCareerProgress.level, previousCareerProgress.exp, reward.exp)
        : previousCareerProgress;
      const activePetId = deps.activePetIdForRow(row);
      const petProgressById = deps.petProgressMapForRow(row);
      const previousPetProgress = petProgressById[String(activePetId)] || deps.normalizeProgress();
      const petLeveled = deps.applyExp(previousPetProgress.level, previousPetProgress.exp, reward.petExp);
      if (activePetId) petProgressById[String(activePetId)] = petLeveled;
      const mercenaryState = deps.mercenaryState(row);
      const activeMercenary = mercenaryState.mercenaries.find((mercenary) => mercenary?.id === mercenaryState.activeMercenaryId) || null;
      const previousMercenaryProgress = activeMercenary ? deps.normalizeProgress(activeMercenary) : null;
      const mercenaryLeveled = activeMercenary
        ? deps.applyExp(previousMercenaryProgress.level, previousMercenaryProgress.exp, reward.mercenaryExp)
        : null;
      if (activeMercenary && mercenaryLeveled) Object.assign(activeMercenary, mercenaryLeveled);

      const equipment = deps.safeJsonArray(row.equipment_json);
      let rewardEquipment = null;
      const rewardCount = Math.max(0, Math.min(5, reward.equipmentCount));
      for (let index = 0; index < rewardCount && equipment.length < deps.careerTree.BAG_CAPACITY; index += 1) {
        const created = deps.generateDroppedEquipment(reward.monsterLevel);
        equipment.push(created);
        if (!rewardEquipment) rewardEquipment = created;
      }
      const fragmentAdds = new Map();
      reward.fragments.forEach((drop) => {
        const item = deps.fragmentById(String(drop.id || ""));
        const quantity = Math.max(0, Math.min(999, Math.floor(Number(drop.quantity) || 0)));
        if (item && quantity > 0) fragmentAdds.set(item.column, (fragmentAdds.get(item.column) || 0) + quantity);
      });
      const fragmentSql = [...fragmentAdds.keys()].map((column) => `${column} = ${column} + ?`).join(", ");
      const fragmentParams = [...fragmentAdds.values()];
      const updatedAt = new Date().toISOString();
      db.prepare(`
        UPDATE players
        SET level = ?, exp = ?, career_level = ?, career_exp = ?, pet_level = ?, pet_exp = ?, pet_progress_json = ?, mercenaries_json = ?, forge_gem = forge_gem + ?, ${fragmentSql ? `${fragmentSql}, ` : ""}equipment_json = ?, updated_at = ?
        WHERE account = ?
      `).run(leveled.level, leveled.exp, careerLeveled.level, careerLeveled.exp, petLeveled.level, petLeveled.exp, JSON.stringify(petProgressById), JSON.stringify(mercenaryState.mercenaries), reward.forgeGem, ...fragmentParams, JSON.stringify(equipment), updatedAt, account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      return {
        ok: true,
        player: deps.playerRowToApi(next),
        reward,
        previousLevel: row.level,
        previousPetLevel: previousPetProgress.level,
        level: next.level,
        exp: next.exp,
        previousCareerLevel: previousCareerProgress.level,
        careerLevel: careerLeveled.level,
        careerExp: careerLeveled.exp,
        gainedCareerExp: careerStage > 0 ? reward.exp : 0,
        dragonSoul: next.dragon_soul,
        petLevel: petLeveled.level,
        petExp: petLeveled.exp,
        petProgressById: deps.petProgressMapForRow(next),
        previousMercenaryLevel: previousMercenaryProgress?.level ?? null,
        mercenaryId: activeMercenary?.id || "",
        mercenaryLevel: mercenaryLeveled?.level ?? null,
        mercenaryExp: mercenaryLeveled?.exp ?? null,
        mercenaries: deps.safeJsonArray(next.mercenaries_json),
        forgeGem: next.forge_gem,
        gainedExp: reward.exp,
        gainedPetExp: reward.petExp,
        gainedMercenaryExp: activeMercenary ? reward.mercenaryExp : 0,
        gainedForgeGem: reward.forgeGem,
        fragments: reward.fragments,
        equipment: rewardEquipment
      };
    });
  }

  return { settle };
}

module.exports = { createRewardSettlementRuntime };
