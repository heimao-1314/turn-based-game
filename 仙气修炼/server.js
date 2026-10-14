const PARTS = [
  { id: "foot", name: "脚之修炼" },
  { id: "hand", name: "手之修炼" },
  { id: "body", name: "身之修炼" },
  { id: "brain", name: "脑之修炼" },
  { id: "heart", name: "心之修炼" }
];

const STAT_POOL = [
  { stat: "speed", label: "速度", min: 1, max: 150 },
  { stat: "mana", label: "法力", min: 1, max: 200 },
  { stat: "hp", label: "生命", min: 1, max: 15000 },
  { stat: "attack", label: "攻击", min: 1, max: 1500 },
  { stat: "defense", label: "防御", min: 1, max: 1500 },
  { stat: "crit", label: "致命", min: 1, max: 10 }
];

const BOSS_PILL_REWARDS = {
  immortal_foot: 2,
  immortal_hand: 4,
  immortal_body: 8,
  immortal_brain: 10,
  immortal_heart: 15
};

function createImmortalCultivationRuntime(deps) {
  function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function emptyData() {
    const parts = {};
    PARTS.forEach((part) => {
      parts[part.id] = Array.from({ length: 3 }, () => null);
    });
    return { parts };
  }

  function normalizeSlot(slot) {
    const config = STAT_POOL.find((item) => item.stat === slot?.stat);
    if (!config) return null;
    return {
      stat: config.stat,
      value: Math.max(config.min, Math.min(config.max, Math.round(Number(slot.value) || 0)))
    };
  }

  function normalizeData(raw) {
    const source = deps.safeJsonObject(raw);
    const data = emptyData();
    PARTS.forEach((part) => {
      const slots = Array.isArray(source.parts?.[part.id]) ? source.parts[part.id] : [];
      data.parts[part.id] = Array.from({ length: 3 }, (_, index) => normalizeSlot(slots[index]));
    });
    return data;
  }

  function rollSlot(lockedStat = "") {
    const config = STAT_POOL.find((item) => item.stat === lockedStat) || STAT_POOL[randomInt(0, STAT_POOL.length - 1)];
    return { stat: config.stat, value: randomInt(config.min, config.max) };
  }

  function slotFullness(slot) {
    const config = STAT_POOL.find((item) => item.stat === slot?.stat);
    if (!config) return 0;
    return Math.max(0, Math.min(1, (Number(slot.value) || 0) / config.max));
  }

  function amplificationFor(data) {
    const slots = PARTS.flatMap((part) => data.parts[part.id] || []);
    const fullness = slots.reduce((sum, slot) => sum + slotFullness(slot), 0) / 15;
    const rate = fullness >= 0.8 ? 0.5 : fullness >= 0.5 ? 0.3 : fullness >= 0.3 ? 0.2 : 0;
    return { fullness, rate };
  }

  function statsFromData(raw) {
    const data = normalizeData(raw);
    const { rate } = amplificationFor(data);
    const stats = {};
    PARTS.forEach((part) => {
      (data.parts[part.id] || []).forEach((slot) => {
        if (!slot) return;
        stats[slot.stat] = (stats[slot.stat] || 0) + Math.round(slot.value * (1 + rate));
      });
    });
    return stats;
  }

  function viewForRow(row) {
    const data = normalizeData(row?.immortal_cultivation_json);
    const amp = amplificationFor(data);
    return {
      parts: PARTS,
      statPool: STAT_POOL,
      data,
      fullness: amp.fullness,
      amplification: amp.rate,
      pills: Number(row?.immortal_pill) || 0,
      soulPowder: Number(row?.soul_powder) || 0,
      stats: statsFromData(data)
    };
  }

  function reroll(account, partId, slotIndex, locked = false) {
    const part = PARTS.find((item) => item.id === partId);
    const index = Math.max(0, Math.min(2, Number(slotIndex) || 0));
    if (!part) return { ok: false, status: 400, error: "bad_part" };
    const row = deps.fetchPlayerRow(account);
    if (!row) return { ok: false, status: 404, error: "player_not_found" };
    const pillCost = locked ? 2 : 1;
    const powderCost = locked ? 400 : 200;
    if ((row.immortal_pill || 0) < pillCost) return { ok: false, status: 409, error: "not_enough_pill" };
    if ((row.soul_powder || 0) < powderCost) return { ok: false, status: 409, error: "not_enough_powder" };
    const data = normalizeData(row.immortal_cultivation_json);
    const current = data.parts[part.id][index];
    data.parts[part.id][index] = rollSlot(locked ? current?.stat : "");
    deps.updateCultivation(account, data, pillCost, powderCost);
    return { ok: true, ...viewForRow(deps.fetchPlayerRow(account)), partId: part.id, slotIndex: index };
  }

  return {
    PARTS,
    STAT_POOL,
    BOSS_PILL_REWARDS,
    normalizeData,
    statsFromData,
    viewForRow,
    reroll
  };
}

module.exports = createImmortalCultivationRuntime;
