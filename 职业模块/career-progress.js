(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CareerProgress = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_LEVEL = 100;
  const DEFAULT_EXP_PER_LEVEL = 100;
  function normalizeLevel(value) { return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(value) || 1))); }
  function progress(level, exp = 0, expPerLevel = DEFAULT_EXP_PER_LEVEL) {
    const normalized = normalizeLevel(level);
    return { level: normalized, stage: Math.ceil(normalized / 10), stageLevel: ((normalized - 1) % 10) + 1, exp: normalized >= MAX_LEVEL ? 0 : Math.max(0, Math.floor(Number(exp) || 0)), expPerLevel };
  }
  function applyExp(level, exp, gained, expPerLevel = DEFAULT_EXP_PER_LEVEL) {
    let nextLevel = normalizeLevel(level);
    let nextExp = Math.max(0, Number(exp) || 0) + Math.max(0, Math.floor(Number(gained) || 0));
    while (nextLevel < MAX_LEVEL && nextExp >= expPerLevel) { nextExp -= expPerLevel; nextLevel += 1; }
    if (nextLevel >= MAX_LEVEL) nextExp = 0;
    return progress(nextLevel, nextExp, expPerLevel);
  }
  return { MAX_LEVEL, DEFAULT_EXP_PER_LEVEL, normalizeLevel, progress, applyExp };
});
