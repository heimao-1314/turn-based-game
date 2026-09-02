const rules = require("./shared.js");

const CONFIG_KEY = "dragon_soul_config_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

function createDragonSoulRuntime({ db, random = Math.random, now = () => new Date(), ensurePlayer = () => {} }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  function normalizeConfig(raw = {}) {
    const base = rules.DEFAULT_CONFIG;
    return {
      cost: Math.floor(number(raw.cost, base.cost, 1, 1000000)),
      normalExp: Math.floor(number(raw.normalExp, base.normalExp, 1, 1000000)),
      criticalExp: Math.floor(number(raw.criticalExp, base.criticalExp, 1, 1000000)),
      expPerLevel: Math.floor(number(raw.expPerLevel, base.expPerLevel, 1, 1000000)),
      criticalChance: number(raw.criticalChance, base.criticalChance, 0, 1),
      dailyLimit: Math.floor(number(raw.dailyLimit, base.dailyLimit, 1, 1000)),
      stages: Array.from({ length: 7 }, (_, index) => Object.fromEntries(rules.STAT_KEYS.map((key) => [key, number(raw.stages?.[index]?.[key], base.stages[index][key] || 0, 0, 1000000000)])))
    };
  }
  function row() { return db.prepare("SELECT value_json, updated_at FROM app_settings WHERE key = ?").get(CONFIG_KEY); }
  function getConfig() {
    try { return normalizeConfig(JSON.parse(row()?.value_json || "{}")); } catch { return clone(rules.DEFAULT_CONFIG); }
  }
  function updateConfig(raw) {
    const config = normalizeConfig(raw);
    const updatedAt = now().toISOString();
    db.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(CONFIG_KEY, JSON.stringify(config), updatedAt);
    return { config, updatedAt };
  }
  function resetConfig() { db.prepare("DELETE FROM app_settings WHERE key = ?").run(CONFIG_KEY); return { config: clone(rules.DEFAULT_CONFIG), updatedAt: "" }; }
  function updatedAt() { return row()?.updated_at || ""; }
  function dayKey(date = now()) { return new Date(date.getTime() - new Date(date).getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function soulPowderStatus(account) {
    const player = db.prepare("SELECT soul_powder, soul_powder_300_at, soul_powder_400_at FROM players WHERE account = ?").get(account);
    return {
      ok: true,
      soulPowder: player?.soul_powder || 0,
      soulPowder300At: player?.soul_powder_300_at || "",
      soulPowder400At: player?.soul_powder_400_at || ""
    };
  }
  function claimSoulPowder(account, type) {
    const claim = type === "300"
      ? { amount: 300, hours: 8, column: "soul_powder_300_at" }
      : type === "400"
        ? { amount: 400, hours: 4, column: "soul_powder_400_at" }
        : null;
    if (!claim) return { ok: false, status: 400, error: "bad_claim_type" };
    ensurePlayer(account);
    db.exec("BEGIN IMMEDIATE");
    try {
      const player = db.prepare(`SELECT soul_powder, ${claim.column} AS last_at FROM players WHERE account = ?`).get(account);
      if (!player) return rollback({ ok: false, status: 404, error: "player_not_found" });
      const claimedAt = player.last_at ? Date.parse(player.last_at) : 0;
      const cooldownMs = claim.hours * 60 * 60 * 1000;
      const currentTime = now().getTime();
      if (claimedAt && currentTime - claimedAt < cooldownMs) {
        return rollback({ ok: false, status: 409, error: "cooldown", remainingMs: cooldownMs - (currentTime - claimedAt), soulPowder: player.soul_powder || 0 });
      }
      const updatedAt = now().toISOString();
      db.prepare(`UPDATE players SET soul_powder = soul_powder + ?, ${claim.column} = ?, updated_at = ? WHERE account = ?`)
        .run(claim.amount, updatedAt, updatedAt, account);
      db.exec("COMMIT");
      return { ok: true, amount: claim.amount, ...soulPowderStatus(account) };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function stateFromRow(player) {
    const config = getConfig();
    const level = rules.normalizeLevel(player?.dragon_soul);
    const used = player?.dragon_soul_daily_key === dayKey() ? Math.max(0, Number(player.dragon_soul_daily_used) || 0) : 0;
    return { ...rules.progress(level, player?.dragon_soul_exp), dailyUsed: used, dailyRemaining: Math.max(0, config.dailyLimit - used), cost: config.cost, expPerLevel: config.expPerLevel, soulPowder: Math.max(0, Number(player?.soul_powder) || 0), stats: rules.statsAt(level, config.stages) };
  }
  function evolve(account) {
    const config = getConfig();
    db.exec("BEGIN IMMEDIATE");
    try {
      const player = db.prepare("SELECT dragon_soul, dragon_soul_exp, dragon_soul_daily_key, dragon_soul_daily_used, soul_powder FROM players WHERE account = ?").get(account);
      if (!player) return rollback({ ok: false, status: 404, error: "player_not_found" });
      const current = stateFromRow(player);
      if (current.level >= 70) return rollback({ ok: false, status: 409, error: "max_level", state: current });
      if (current.soulPowder < config.cost) return rollback({ ok: false, status: 409, error: "not_enough_powder", state: current });
      const critical = random() < config.criticalChance;
      if (!critical && current.dailyRemaining <= 0) return rollback({ ok: false, status: 429, error: "daily_limit", state: current });
      let level = current.level;
      let exp = current.exp + (critical ? config.criticalExp : config.normalExp);
      while (level < 70 && exp >= config.expPerLevel) { exp -= config.expPerLevel; level += 1; }
      if (level >= 70) exp = 0;
      const used = current.dailyUsed + (critical ? 0 : 1);
      db.prepare("UPDATE players SET dragon_soul = ?, dragon_soul_exp = ?, dragon_soul_daily_key = ?, dragon_soul_daily_used = ?, soul_powder = soul_powder - ?, updated_at = ? WHERE account = ?")
        .run(level, exp, dayKey(), used, config.cost, now().toISOString(), account);
      db.exec("COMMIT");
      const next = db.prepare("SELECT dragon_soul, dragon_soul_exp, dragon_soul_daily_key, dragon_soul_daily_used, soul_powder FROM players WHERE account = ?").get(account);
      return { ok: true, critical, gainedExp: critical ? config.criticalExp : config.normalExp, state: stateFromRow(next) };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function rollback(result) { db.exec("ROLLBACK"); return result; }
  return { getConfig, updateConfig, resetConfig, updatedAt, stateFromRow, soulPowderStatus, claimSoulPowder, evolve, statsAt: (level) => rules.statsAt(level, getConfig().stages) };
}

module.exports = { createDragonSoulRuntime };
