(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DragonSoul = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STAGE_NAMES = ["黄铜", "青铜", "黑铁", "白银", "黄金", "白金", "钻石"];
  const STAT_KEYS = ["attack", "speed", "defense", "mana", "hp", "critDamage", "antiCritDamage", "hit", "dodge", "confuseResist", "sealResist", "paralyzeResist", "curseResist", "sleepResist", "crit"];
  const DEFAULT_CONFIG = {
    cost: 50,
    normalExp: 200,
    criticalExp: 1000,
    expPerLevel: 1000,
    criticalChance: 0.3,
    dailyLimit: 10,
    stages: [
      { attack: 1000, speed: 50, defense: 500, mana: 100, hp: 10000, critDamage: 10, antiCritDamage: 10, hit: 10 },
      { attack: 2000, speed: 100, defense: 1000, mana: 200, hp: 20000, critDamage: 20, antiCritDamage: 20, hit: 10 },
      { attack: 3000, speed: 150, defense: 1500, mana: 300, hp: 30000, critDamage: 30, antiCritDamage: 30, hit: 10, confuseResist: 10, sealResist: 10, paralyzeResist: 10, curseResist: 10, sleepResist: 10 },
      { attack: 4000, speed: 200, defense: 2000, mana: 400, hp: 40000, critDamage: 40, antiCritDamage: 40, hit: 20, dodge: 10, confuseResist: 20, sealResist: 20, paralyzeResist: 20, curseResist: 20, sleepResist: 20, crit: 10 },
      { attack: 5000, speed: 250, defense: 2500, mana: 500, hp: 50000, critDamage: 50, antiCritDamage: 50, hit: 20, dodge: 20, confuseResist: 30, sealResist: 30, paralyzeResist: 30, curseResist: 30, sleepResist: 30, crit: 20 },
      { attack: 7500, speed: 400, defense: 4000, mana: 750, hp: 75000, critDamage: 50, antiCritDamage: 50, hit: 20, dodge: 20, confuseResist: 30, sealResist: 30, paralyzeResist: 30, curseResist: 30, sleepResist: 30, crit: 20 },
      { attack: 10000, speed: 500, defense: 5000, mana: 1000, hp: 100000, critDamage: 50, antiCritDamage: 50, hit: 20, dodge: 20, confuseResist: 30, sealResist: 30, paralyzeResist: 30, curseResist: 30, sleepResist: 30, crit: 20 }
    ]
  };

  function normalizeLevel(value) { return Math.max(0, Math.min(70, Math.floor(Number(value) || 0))); }
  function progress(level, exp = 0) {
    const normalized = normalizeLevel(level);
    return {
      level: normalized,
      exp: normalized >= 70 ? 0 : Math.max(0, Math.floor(Number(exp) || 0)),
      stage: normalized >= 70 ? 7 : Math.floor(normalized / 10) + 1,
      stageLevel: normalized >= 70 ? 10 : normalized % 10,
      stageName: STAGE_NAMES[normalized >= 70 ? 6 : Math.floor(normalized / 10)]
    };
  }
  function statsAt(level, stages = DEFAULT_CONFIG.stages) {
    const normalized = normalizeLevel(level);
    const result = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
    for (let index = 0; index < stages.length && index < 7; index += 1) {
      const completedLevels = Math.max(0, Math.min(10, normalized - index * 10));
      STAT_KEYS.forEach((key) => { result[key] += (Number(stages[index]?.[key]) || 0) * completedLevels / 10; });
    }
    STAT_KEYS.forEach((key) => { result[key] = Math.round(result[key] * 100) / 100; });
    return result;
  }
  function stageStatsAt(stageIndex, stageLevel = 10, stages = DEFAULT_CONFIG.stages) {
    const result = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
    const index = Math.max(0, Math.min(6, Math.floor(Number(stageIndex) || 0)));
    const ratio = Math.max(0, Math.min(10, Number(stageLevel) || 0)) / 10;
    STAT_KEYS.forEach((key) => { result[key] = Math.round((Number(stages[index]?.[key]) || 0) * ratio * 100) / 100; });
    return result;
  }
  return { STAGE_NAMES, STAT_KEYS, DEFAULT_CONFIG, normalizeLevel, progress, statsAt, stageStatsAt };
});
