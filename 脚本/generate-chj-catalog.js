/**
 * @file generate-chj-catalog.js
 * @description 精灵图编号清单生成器 - 扫描代码生成精灵图 CHJ 文件的完整清单
 *
 * 本脚本从 app.js 和 server.js 中提取所有精灵图引用，
 * 与 精灵图 目录下的 .chj 文件交叉比对，生成 Markdown 格式的清单文档。
 *
 * 提取内容:
 * - roleCatalog: 角色职业与精灵图 ID 的映射
 * - petCatalog: 宠物名称与精灵图 ID 的映射
 * - fashionCatalog: 时装名称与精灵图 ID 的映射
 * - immortalBosses: 仙人 Boss 名称与精灵图 ID 的映射
 * - mercenaryTypes: 佣兵类型与精灵图 ID 的映射
 * - wildMonsterTable: 野生怪物与精灵图 ID 的映射
 *
 * 输出: 精灵图编号清单.md
 *
 * 使用方法: node 脚本/generate-chj-catalog.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const careerTree = require("../职业模块/职业树.js");
const petModule = require("../宠物模块/宠物目录.js");

const root = path.resolve(__dirname, "..");
const spriteDir = path.join(root, "资源", "精灵图");
const appPath = path.join(root, "app.js");
const serverPath = path.join(root, "server.js");
const outputPath = path.join(root, "精灵图编号清单.md");

const appSource = fs.readFileSync(appPath, "utf8");
const serverSource = fs.readFileSync(serverPath, "utf8");

const namesById = new Map();
const referencesById = new Map();

function addName(id, name, source) {
  const key = String(id || "").trim();
  const label = String(name || "").trim();
  if (!/^(?:a)?\d+$/.test(key) || !label) return;
  if (!namesById.has(key)) namesById.set(key, new Set());
  namesById.get(key).add(label);
  addReference(key, source);
}

function addReference(id, source) {
  const key = String(id || "").trim();
  if (!/^(?:a)?\d+$/.test(key)) return;
  if (!referencesById.has(key)) referencesById.set(key, new Set());
  referencesById.get(key).add(source);
}

function runConstExpression(source, constName) {
  const match = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*([\\s\\S]*?);\\r?\\n`));
  if (!match) return null;
  return vm.runInNewContext(`(${match[1].trim().replace(/;$/, "")})`, {});
}

function extractAppCatalogs() {
  const roleCatalog = careerTree.roleCatalog;
  for (const [className, roles] of Object.entries(roleCatalog)) {
    for (const role of roles || []) {
      addName(role.id, `角色：${className}-${role.sub}-${role.gender}`, "app.js roleCatalog");
      addName(role.attackId, `角色攻击：${className}-${role.sub}-${role.gender}`, "职业模块/职业树.js roleCatalog");
    }
  }

  const petCatalog = petModule.petCatalog || [];
  for (const pet of petCatalog) addName(pet.id, pet.name, "app.js petCatalog");

  const fashionCatalog = runConstExpression(appSource, "fashionCatalog") || [];
  for (const fashion of fashionCatalog) addName(fashion.spriteId, fashion.name, "app.js fashionCatalog");

  const immortalBosses = runConstExpression(appSource, "immortalBosses") || [];
  for (const boss of immortalBosses) addName(boss.spriteId, boss.name, "app.js immortalBosses");

  const mercenaryTypes = runConstExpression(appSource, "mercenaryTypes") || {};
  for (const mercenary of Object.values(mercenaryTypes)) {
    addName(mercenary.spriteId, mercenary.name, "app.js mercenaryTypes");
  }

  const wildMonsterTable = runConstExpression(appSource, "wildMonsterTable") || {};
  for (const monster of Object.values(wildMonsterTable)) {
    addName(monster.spriteId, monster.name, "app.js wildMonsterTable");
    if (monster.minion?.spriteId) addName(monster.minion.spriteId, `${monster.name}随从`, "app.js wildMonsterTable");
  }
}

function extractCreateActorPairs(source, sourceName) {
  const pattern = /createActor\(\{([\s\S]*?)\}\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const body = match[1];
    const name = body.match(/name:\s*"([^"]+)"/)?.[1];
    const id = body.match(/spriteId:\s*(\d+)/)?.[1];
    addName(id, name, `${sourceName} createActor`);
  }
}

function extractLoadSpriteReferences(source, sourceName) {
  const patterns = [
    /loadSprite(?:Optional)?\((\d+)\)/g,
    /state\.sprites\.has\((\d+)\)/g,
    /BATTLE_STATUS_ICONS\s*=\s*\{([\s\S]*?)\};/g
  ];

  for (const pattern of patterns.slice(0, 2)) {
    let match;
    while ((match = pattern.exec(source))) addReference(match[1], `${sourceName} direct reference`);
  }

  const statusMatch = patterns[2].exec(source);
  if (statusMatch) {
    const statusPattern = /(\w+):\s*(\d+)/g;
    let match;
    while ((match = statusPattern.exec(statusMatch[1]))) {
      addName(match[2], `战斗状态特效：${match[1]}`, `${sourceName} BATTLE_STATUS_ICONS`);
    }
  }
}

function numericSort(a, b) {
  const an = Number.parseInt(a, 10);
  const bn = Number.parseInt(b, 10);
  if (Number.isNaN(an) && Number.isNaN(bn)) return a.localeCompare(b, "zh-CN");
  if (Number.isNaN(an)) return 1;
  if (Number.isNaN(bn)) return -1;
  return an - bn || a.localeCompare(b, "zh-CN");
}

function chjIdFromName(name) {
  return name.replace(/\.chj$/i, "");
}

extractAppCatalogs();
extractCreateActorPairs(appSource, "app.js");
extractLoadSpriteReferences(appSource, "app.js");

const existing = fs
  .readdirSync(spriteDir)
  .filter((name) => name.toLowerCase().endsWith(".chj"))
  .map((file) => {
    const stat = fs.statSync(path.join(spriteDir, file));
    return { id: chjIdFromName(file), file, size: stat.size };
  })
  .sort((a, b) => numericSort(a.id, b.id));

const existingIds = new Set(existing.map((item) => item.id));
const missing = [...referencesById.keys()]
  .filter((id) => !existingIds.has(id))
  .sort(numericSort)
  .map((id) => ({ id, file: "", size: "" }));

function namesFor(id) {
  return [...(namesById.get(id) || [])].sort((a, b) => a.localeCompare(b, "zh-CN")).join(" / ");
}

function refsFor(id) {
  return [...(referencesById.get(id) || [])].sort().join(" / ");
}

function row(item, status) {
  return `| ${item.id} | ${namesFor(item.id)} | ${item.file} | ${item.size} | ${status} | ${refsFor(item.id)} |`;
}

const namedExistingCount = existing.filter((item) => namesById.has(item.id)).length;
const lines = [
  "# 精灵图 CHJ 编号清单",
  "",
  `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
  "",
  "说明：已有 `.chj` 文件排在前面；代码里引用但文件不存在的编号排在后面。无法从代码识别名称的条目，名称列留空。",
  "",
  `- 已有 CHJ 文件：${existing.length}`,
  `- 已识别名称的已有文件：${namedExistingCount}`,
  `- 代码引用但缺少文件：${missing.length}`,
  "",
  "## 已有文件",
  "",
  "| 编号 | 名称 | 文件 | 大小 bytes | 状态 | 来源 |",
  "| --- | --- | --- | ---: | --- | --- |",
  ...existing.map((item) => row(item, "存在")),
  "",
  "## 代码引用但缺文件",
  "",
  "| 编号 | 名称 | 文件 | 大小 bytes | 状态 | 来源 |",
  "| --- | --- | --- | ---: | --- | --- |",
  ...(missing.length ? missing.map((item) => row(item, "缺文件")) : ["|  |  |  |  | 无 |  |"]),
  ""
];

fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`Existing: ${existing.length}, named existing: ${namedExistingCount}, missing referenced: ${missing.length}`);
