const REQUIRED_AMUMU_KILLS = 999;

function questStatus(row, careerTree) {
  let selection = {};
  try { selection = JSON.parse(row.selection_json || "{}"); } catch {}
  const stage = careerTree.careerStage(selection);
  const eligible = stage === 1 && Number(row.career_level) >= careerTree.SECOND_TRANSFER_CAREER_LEVEL;
  const kills = Math.max(0, Math.min(REQUIRED_AMUMU_KILLS, Number(row.transfer_amumu_kills) || 0));
  return { eligible, kills, required: REQUIRED_AMUMU_KILLS, complete: eligible && kills >= REQUIRED_AMUMU_KILLS };
}

function creditedKills({ stage, careerLevel, monsterId, monsterCount }) {
  if (stage !== 1 || Number(careerLevel) < 10 || monsterId !== "amumu") return 0;
  return Math.max(0, Math.min(14, Math.floor(Number(monsterCount) || 0)));
}

function creditBattle(db, account, battle) {
  const quantity = creditedKills(battle);
  if (!quantity) return 0;
  db.prepare("UPDATE players SET transfer_amumu_kills = MIN(?, transfer_amumu_kills + ?) WHERE account = ?")
    .run(REQUIRED_AMUMU_KILLS, quantity, account);
  return quantity;
}

module.exports = { REQUIRED_AMUMU_KILLS, questStatus, creditedKills, creditBattle };
