"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MAPS = [
  { name: "仓库", file: "仓库2.json", entry: { x: 7, y: 12 }, desc: "罗克萨斯、小企鹅、仓库入口" },
  { name: "仙人", file: "仙人.json", entry: { x: 2, y: 10 }, desc: "仙人Boss" },
  { name: "原野怪区", file: "原野怪区.json", entry: { x: 7, y: 2 }, desc: "阿木木暗怪、阿飞", encounter: true },
  { name: "幻影狩猎场", file: "幻影.json", entry: { x: 7, y: 12 }, desc: "幻影暗怪、幻影管理员", encounter: true }
];

const DEFAULT_PORTALS = [
  { id: "warehouse-to-field", from: "仓库", x: "*", y: "max", direction: "down", to: "原野怪区", toX: "$x", toY: 1 },
  { id: "warehouse-to-immortal", from: "仓库", x: 0, y: "*", direction: "left", to: "仙人", toX: "max-1", toY: "$y" },
  { id: "warehouse-to-phantom", from: "仓库", x: "*", y: 0, direction: "up", to: "幻影狩猎场", toX: "$x", toY: "max-1" },
  { id: "phantom-to-warehouse", from: "幻影狩猎场", x: "*", y: "max", direction: "down", to: "仓库", toX: "$x", toY: 1 },
  { id: "immortal-to-warehouse", from: "仙人", x: "max", y: "*", direction: "right", to: "仓库", toX: 1, toY: "$y" },
  { id: "field-to-warehouse", from: "原野怪区", x: "*", y: 0, direction: "up", to: "仓库", toX: "$x", toY: "max-1" }
];

function createMapRegistry(options) {
  const root = options.root;
  const mapsDir = options.mapsDir || path.join(root, "资源", "地图");
  const configPath = options.configPath || path.join(root, "地图系统", "地图清单.json");

  function defaults() {
    return {
      version: 1,
      maps: DEFAULT_MAPS,
      portals: DEFAULT_PORTALS
    };
  }

  function ensureConfig() {
    if (fs.existsSync(configPath)) return;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaults(), null, 2), "utf8");
  }

  function readConfig() {
    ensureConfig();
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return normalizeConfig(parsed);
    } catch (error) {
      console.warn("[map-registry] 配置读取失败，使用默认值:", error.message);
      return defaults();
    }
  }

  function writeConfig(config) {
    const next = normalizeConfig(config);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  function listMapFiles() {
    if (!fs.existsSync(mapsDir)) return [];
    return fs.readdirSync(mapsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function scanMaps() {
    const config = readConfig();
    const byFile = new Set(config.maps.map((map) => map.file));
    let changed = false;
    for (const file of listMapFiles()) {
      if (byFile.has(file)) continue;
      const name = path.basename(file, ".json");
      config.maps.push({ name, file, entry: { x: 1, y: 1 }, desc: "资源/地图 自动登记" });
      changed = true;
    }
    return changed ? writeConfig(config) : config;
  }

  function saveMaps(maps) {
    const config = readConfig();
    config.maps = Array.isArray(maps) ? maps.map(normalizeMapRecord).filter(Boolean) : config.maps;
    return writeConfig(config);
  }

  function savePortals(portals) {
    const config = readConfig();
    config.portals = Array.isArray(portals) ? portals.map(normalizePortalRecord).filter(Boolean) : config.portals;
    return writeConfig(config);
  }

  function manifest() {
    return publicConfig(scanMaps());
  }

  return {
    configPath,
    mapsDir,
    readConfig,
    writeConfig,
    scanMaps,
    saveMaps,
    savePortals,
    manifest
  };
}

function normalizeConfig(config) {
  return {
    version: Number(config?.version) || 1,
    maps: (Array.isArray(config?.maps) ? config.maps : DEFAULT_MAPS).map(normalizeMapRecord).filter(Boolean),
    portals: (Array.isArray(config?.portals) ? config.portals : DEFAULT_PORTALS).map(normalizePortalRecord).filter(Boolean),
    updatedAt: config?.updatedAt || ""
  };
}

function normalizeMapRecord(map) {
  const name = String(map?.name || "").trim();
  const file = String(map?.file || "").trim();
  if (!name || !file || file.includes("/") || file.includes("\\") || !file.toLowerCase().endsWith(".json")) return null;
  return {
    name,
    file,
    entry: normalizePoint(map.entry, { x: 1, y: 1 }),
    desc: String(map.desc || ""),
    encounter: Boolean(map.encounter)
  };
}

function normalizePortalRecord(portal) {
  const from = String(portal?.from || "").trim();
  const to = String(portal?.to || "").trim();
  if (!from || !to) return null;
  return {
    id: String(portal.id || `${from}-${to}-${Date.now()}`).trim(),
    from,
    x: normalizeMatchValue(portal.x, "*"),
    y: normalizeMatchValue(portal.y, "*"),
    direction: ["up", "down", "left", "right", "*"].includes(portal.direction) ? portal.direction : "*",
    to,
    toX: normalizeTargetValue(portal.toX, 1),
    toY: normalizeTargetValue(portal.toY, 1),
    note: String(portal.note || "")
  };
}

function normalizePoint(point, fallback) {
  return {
    x: Math.max(0, Number.isFinite(Number(point?.x)) ? Math.floor(Number(point.x)) : fallback.x),
    y: Math.max(0, Number.isFinite(Number(point?.y)) ? Math.floor(Number(point.y)) : fallback.y)
  };
}

function normalizeMatchValue(value, fallback) {
  if (value === "*" || value === "max") return value;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function normalizeTargetValue(value, fallback) {
  if (["$x", "$y", "max", "max-1"].includes(value)) return value;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function publicConfig(config) {
  return {
    ok: true,
    version: config.version,
    maps: config.maps,
    portals: config.portals,
    mapFiles: Object.fromEntries(config.maps.map((map) => [map.name, map.file])),
    updatedAt: config.updatedAt || ""
  };
}

module.exports = {
  createMapRegistry,
  DEFAULT_MAPS,
  DEFAULT_PORTALS
};
