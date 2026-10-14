/**
 * @file growth-config-runtime.js
 * @description 成长/经验数值配置运行时（服务端权威）
 *
 * 职责：
 * - 统一管理 人物/宠物/佣兵 的等级成长属性、基础属性与升级经验曲线。
 * - 配置持久化到 app_settings（key=growth_config_v1）；服务端所有属性结算与
 *   升级判断都读取本运行时的有效配置，客户端只做展示同步。
 * - 所有写入值在服务端校验并兜底：拒绝越界、负数、非数字与会导致升级死循环
 *   的 0 经验阈值。
 *
 * 依赖注入：
 * - db: node:sqlite DatabaseSync 实例（需已存在 app_settings 表）
 * - defaults: 默认配置（与代码内置数值一致，仅作首次启动 / 恢复默认的基线）
 *
 * 导出：
 * - createGrowthConfigRuntime({ db, defaults }) -> runtime
 *
 * 安全说明：
 * - 只有管理员接口可以写配置；写入值经过类型/范围校验。
 * - 升级经验阈值必须 >= 1，否则 applyExp 的 while 循环会死循环。
 */

const CONFIG_KEY = "growth_config_v1";
const MAX_VALUE = 1000000000;

const STAT_KEYS = ["attack", "hp", "speed", "mana", "defense", "energy", "hit", "dodge", "crit", "critDamage"];
const DRAGON_SOUL_STAT_KEYS = ["hp", "defense", "speed", "attack", "mana", "crit", "critDamage"];
const MERCENARY_STAT_KEYS = ["hp", "defense", "speed", "attack", "mana", "crit", "critDamage"];

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNonNegative(value, fallback = 0) {
  const number = finiteNumber(value);
  if (number === null) return fallback;
  return Math.max(0, Math.min(MAX_VALUE, number));
}
function normalizePair(value, fallback = [0, 0]) {
  const source = Array.isArray(value) ? value : null;
  const fb = Array.isArray(fallback) && fallback.length >= 2 ? fallback : [0, 0];
  return [
    clampNonNegative(source?.[0], fb[0]),
    clampNonNegative(source?.[1], fb[1])
  ];
}

function normalizeGrowthMap(raw, fallback, keys) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  keys.forEach((key) => {
    result[key] = normalizePair(source[key], fallback[key]);
  });
  return result;
}

function normalizeStatMap(raw, fallback, keys) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  keys.forEach((key) => {
    result[key] = clampNonNegative(source[key], fallback[key]);
  });
  return result;
}

function normalizeExpTable(raw, fallback) {
  const source = Array.isArray(raw) ? raw : null;
  if (!source) return { ok: false, errors: ["expTable 必须是数组"] };
  if (source.length !== 100) return { ok: false, errors: ["expTable 必须包含 100 项（索引0占位 + 99级升级阈值）"] };
  const table = [0];
  for (let level = 1; level <= 99; level += 1) {
    const number = finiteNumber(source[level]);
    if (number === null) return { ok: false, errors: [`expTable[${level}] 不是有效数字`] };
    const value = Math.max(1, Math.min(MAX_VALUE, Math.floor(number)));
    table.push(value);
  }
  return { ok: true, table };
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function normalizeRawConfig(raw, base) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const errors = [];
  const config = {
    expTable: base.expTable,
    character: {
      growth: base.character.growth,
      dragonSoul: base.character.dragonSoul
    },
    pet: {
      growth: base.pet.growth
    },
    mercenary: {
      base: base.mercenary.base,
      minFactor: base.mercenary.minFactor,
      maxFactor: base.mercenary.maxFactor
    }
  };

  const expResult = normalizeExpTable(source.expTable === undefined ? base.expTable : source.expTable, base.expTable);
  if (!expResult.ok) {
    errors.push(...expResult.errors);
  } else {
    config.expTable = expResult.table;
  }

  if (source.character !== undefined) {
    const characterSource = source.character && typeof source.character === "object" ? source.character : {};
    if (characterSource.growth !== undefined) {
      config.character.growth = normalizeGrowthMap(characterSource.growth, base.character.growth, STAT_KEYS);
    }
    if (characterSource.dragonSoul !== undefined) {
      config.character.dragonSoul = normalizeStatMap(characterSource.dragonSoul, base.character.dragonSoul, DRAGON_SOUL_STAT_KEYS);
    }
  }

  if (source.pet !== undefined) {
    const petSource = source.pet && typeof source.pet === "object" ? source.pet : {};
    if (petSource.growth !== undefined) {
      config.pet.growth = normalizeGrowthMap(petSource.growth, base.pet.growth, STAT_KEYS);
    }
  }

  if (source.mercenary !== undefined) {
    const mercenarySource = source.mercenary && typeof source.mercenary === "object" ? source.mercenary : {};
    if (mercenarySource.base !== undefined) {
      config.mercenary.base = normalizeStatMap(mercenarySource.base, base.mercenary.base, MERCENARY_STAT_KEYS);
    }
    if (mercenarySource.minFactor !== undefined || mercenarySource.maxFactor !== undefined) {
      const minRaw = mercenarySource.minFactor === undefined ? base.mercenary.minFactor : mercenarySource.minFactor;
      const maxRaw = mercenarySource.maxFactor === undefined ? base.mercenary.maxFactor : mercenarySource.maxFactor;
      const min = clampNonNegative(minRaw, base.mercenary.minFactor);
      const max = clampNonNegative(maxRaw, base.mercenary.maxFactor);
      if (min > max) {
        errors.push("mercenary.minFactor 不能大于 mercenary.maxFactor");
      } else {
        config.mercenary.minFactor = Math.min(100, min);
        config.mercenary.maxFactor = Math.min(100, max);
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}

function createGrowthConfigRuntime({ db, defaults }) {
  if (!db) throw new TypeError("growth_config_db_required");

  const fallback = normalizeRawConfig(defaults || {}, {
    expTable: [0],
    character: { growth: {}, dragonSoul: {} },
    pet: { growth: {} },
    mercenary: { base: {}, minFactor: 0, maxFactor: 1 }
  });
  if (!fallback.ok) throw new Error(`growth_config_defaults_invalid: ${fallback.errors.join("; ")}`);
  const defaultConfig = fallback.config;

  function storedRow() {
    try {
      return db.prepare("SELECT value_json, updated_at FROM app_settings WHERE key = ?").get(CONFIG_KEY);
    } catch {
      return null;
    }
  }

  function currentConfig() {
    const row = storedRow();
    if (!row) return cloneConfig(defaultConfig);
    try {
      const parsed = normalizeRawConfig(JSON.parse(row.value_json || "{}"), defaultConfig);
      return parsed.ok ? parsed.config : cloneConfig(defaultConfig);
    } catch {
      return cloneConfig(defaultConfig);
    }
  }

  function getConfig() {
    return currentConfig();
  }

  function updatedAt() {
    const row = storedRow();
    return row?.updated_at || "";
  }

  function expToNextLevel(level) {
    const table = currentConfig().expTable;
    return table[Math.max(1, Math.min(99, Math.floor(Number(level) || 1)))] || 0;
  }

  function characterGrowth() {
    return currentConfig().character.growth;
  }

  function dragonSoulGrowth() {
    return currentConfig().character.dragonSoul;
  }

  function petGrowth() {
    return currentConfig().pet.growth;
  }

  function mercenaryBaseStats() {
    return currentConfig().mercenary.base;
  }

  function mercenaryFactor(level) {
    const normalized = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
    const config = currentConfig().mercenary;
    return config.minFactor + ((normalized - 1) / 99) * (config.maxFactor - config.minFactor);
  }

  function updateConfig(patch) {
    const base = currentConfig();
    const validated = normalizeRawConfig(patch, base);
    if (!validated.ok) return { ok: false, errors: validated.errors };
    const updatedAtValue = new Date().toISOString();
    db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(CONFIG_KEY, JSON.stringify(validated.config), updatedAtValue);
    return { ok: true, config: validated.config, updatedAt: updatedAtValue };
  }

  function resetConfig() {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(CONFIG_KEY);
    return { ok: true, config: cloneConfig(defaultConfig), updatedAt: "" };
  }

  return {
    getConfig,
    updatedAt,
    expToNextLevel,
    characterGrowth,
    dragonSoulGrowth,
    petGrowth,
    mercenaryBaseStats,
    mercenaryFactor,
    updateConfig,
    resetConfig
  };
}

module.exports = { createGrowthConfigRuntime };
