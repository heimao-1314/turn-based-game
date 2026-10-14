(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CareerProgress = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_LEVEL = 100;
  const DEFAULT_EXP_PER_LEVEL = 100;
  function normalizeLevel(value, maxLevel = MAX_LEVEL) { return Math.max(1, Math.min(maxLevel, Math.floor(Number(value) || 1))); }
  function progress(level, exp = 0, expPerLevel = DEFAULT_EXP_PER_LEVEL, maxLevel = MAX_LEVEL) {
    const cap = normalizeLevel(maxLevel);
    const normalized = normalizeLevel(level, cap);
    const atCap = normalized >= cap;
    return {
      level: normalized,
      stage: Math.ceil(normalized / 10),
      stageLevel: ((normalized - 1) % 10) + 1,
      exp: atCap ? (cap < MAX_LEVEL ? expPerLevel : 0) : Math.max(0, Math.floor(Number(exp) || 0)),
      expPerLevel,
      atCap
    };
  }
  function applyExp(level, exp, gained, expPerLevel = DEFAULT_EXP_PER_LEVEL, maxLevel = MAX_LEVEL) {
    const cap = normalizeLevel(maxLevel);
    let nextLevel = normalizeLevel(level, cap);
    let nextExp = Math.max(0, Number(exp) || 0) + Math.max(0, Math.floor(Number(gained) || 0));
    while (nextLevel < cap && nextExp >= expPerLevel) { nextExp -= expPerLevel; nextLevel += 1; }
    return progress(nextLevel, nextExp, expPerLevel, cap);
  }
  return { MAX_LEVEL, DEFAULT_EXP_PER_LEVEL, normalizeLevel, progress, applyExp };
});
