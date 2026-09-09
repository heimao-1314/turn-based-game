/**
 * @file server.js
 * @description 游戏主服务器 - Node.js HTTP/WebSocket 服务器
 *
 * 本模块是游戏的主服务器，提供：
 * - HTTP 静态文件服务（HTML/CSS/JS/图片/地图资源）
 * - WebSocket 实时通信（玩家状态同步、服务器权威联网战斗、组队系统）
 * - RESTful API（账户管理、玩家数据、排行榜、管理后台）
 * - SQLite 数据库操作（玩家数据持久化）
 * - 兑换码系统与奖励发放
 * - 管理员后台接口
 *
 * 技术栈:
 * - 运行时: Node.js
 * - HTTP: 内置 http 模块
 * - WebSocket: 自定义升级处理
 * - 数据库: node:sqlite (players.sqlite)
 *
 * 配置项 (环境变量):
 * - PORT: 服务器端口 (默认 6588)
 * - ADMIN_PASSWORD: 本机管理口令（生产环境必须显式配置）
 * - REMOTE_ADMIN_ACCOUNT: 远程管理员账号（生产环境必须显式配置）
 * - REMOTE_ADMIN_PASSWORD: 远程管理员密码（生产环境必须显式配置）
 * - WS_BANDWIDTH_STATS: 是否启用 WebSocket 带宽统计 (设为 "1" 启用)
 *
 * 启动命令: node server.js 或 npm start
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
try { process.loadEnvFile?.(); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const { DatabaseSync } = require("node:sqlite");
const createOnlineBattleRuntime = require("./联网战斗/server.js");
const createArenaRuntime = require("./全服竞技场/server.js");
const createImmortalCultivationRuntime = require("./仙气修炼/server.js");
const createMadBragRuntime = require("./疯狂吹牛/server.js");
const createDailyNewsRuntime = require("./每日新闻/server.js");
const { createMapRegistry } = require("./地图系统/map-registry.js");
const { createAdminMapApi } = require("./地图系统/admin-map-api.js");
const { createAuthRuntime } = require("./src/server/auth/runtime.js");
const { createRedeemCodeRuntime } = require("./src/server/economy/redeem-code-runtime.js");
const { createForgeRuntime } = require("./src/server/equipment/forge-runtime.js");
const { createRewardTicketRuntime } = require("./战斗/reward-ticket-runtime.js");
const { createEncounterRuntime } = require("./联网战斗/encounter-runtime.js");
const { createTeamRuntime } = require("./队伍/server.js");
const { createSocketWriteRuntime } = require("./src/server/realtime/socket-write-runtime.js");
const { createWebSocketFrameRuntime, encodeControlFrame } = require("./src/server/realtime/websocket-frame-runtime.js");
const { createChatRuntime } = require("./聊天模块/server.js");
const petModule = require("./宠物模块/宠物目录.js");
const careerTree = require("./职业模块/职业树.js");
const careerProgress = require("./职业模块/career-progress.js");
const stickerModule = require("./生活技能/贴纸生产.js");
const elfKingVault = require("./副本模块/精灵王宝库.js");
const luckyBoxModule = require("./好运宝箱/shared.js");
const { createOnlineStatsRuntime } = require("./src/server/admin/online-stats-runtime.js");
const { createGrowthConfigRuntime } = require("./src/server/admin/growth-config-runtime.js");
const { createDragonSoulRuntime } = require("./龙魂系统/server.js");
const { createTaoziRuntime } = require("./桃子/server.js");

// === 带宽优化模块（实验功能，设 ENABLE_BW_OPT=1 才启用）===
let bandwidthOptimizer = null;
const bandwidthOptimizerEnabled = /^(1|true|yes)$/i.test(String(process.env.ENABLE_BW_OPT || "")) && !process.env.DISABLE_BW_OPT;
try { if (bandwidthOptimizerEnabled) { const { createBandwidthOptimizer } = require("./bandwidth-optimizer/server"); bandwidthOptimizer = { createBandwidthOptimizer }; } } catch (e) { console.log("[BW-Opt] 优化模块未加载，使用原有逻辑:", e.message); }


const root = process.pkg ? path.dirname(process.execPath) : __dirname;
const port = Number(process.env.PORT || 6588);
const WS_IDLE_CLOSE_MS = Number(process.env.WS_IDLE_CLOSE_MS || 120000);
const WS_MAX_QUEUED_BYTES = Math.max(64 * 1024, Number(process.env.WS_MAX_QUEUED_BYTES || 2 * 1024 * 1024));
const isProduction = process.env.NODE_ENV === "production";
const sockets = new Set();
const socketMeta = new Map();
const accountSockets = new Map();
const onlineStatsRuntime = createOnlineStatsRuntime({ sockets, socketMeta });
const authSessions = new Map();
const AUTH_SESSION_MS = 12 * 60 * 60 * 1000;
const AUTH_SESSION_CLEANUP_MS = 60 * 1000;
const DEFAULT_SERVER_ID = "penguin_village";
const DEFAULT_SERVER_NAME = "企鹅村";
const SERVER_CHANNEL_COUNT = 6;
const wsBandwidthStatsEnabled = process.env.WS_BANDWIDTH_STATS === "1";
const wsStats = {
  since: Date.now(),
  inboundBytes: 0,
  outboundBytes: 0,
  inboundMessages: 0,
  outboundMessages: 0,
  byType: new Map()
};
const dbPath = process.env.PLAYER_DB_PATH
  ? path.resolve(process.env.PLAYER_DB_PATH)
  : path.join(root, "players.sqlite");
const legacyDbPath = path.join(root, "players-db.json");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
const socketWriteRuntime = createSocketWriteRuntime({
  maxQueuedBytes: WS_MAX_QUEUED_BYTES,
  onWrite: (type, bytes) => recordRoomTraffic(type, "out", bytes),
  onOverflow: (socket, detail) => {
    const meta = socketMeta.get(socket) || {};
    recordAnomalyOnce(meta.loginAccount || meta.account, "ws_backpressure_overflow", detail, 2, "disconnect", 60 * 1000);
  }
});
const socketFrameRuntime = createWebSocketFrameRuntime({
  onProtocolError: (socket, reason) => {
    const meta = socketMeta.get(socket) || {};
    recordAnomalyOnce(meta.loginAccount || meta.account, "ws_protocol_error", { reason }, 2, "disconnect", 60 * 1000);
  }
});
function sendSocketJson(socket, payload) {
  if (!socket || socket.destroyed) return false;
  const message = JSON.stringify(payload);
  return socketWriteRuntime.write(socket, encodeFrame(message), payload.type || roomMessageType(message));
}

const chatRuntime = createChatRuntime({
  sockets,
  socketMeta,
  sendSocketJson,
  recordAnomalyOnce
});
let immortalCultivationRuntime = null;
let madBragRuntime = null;
function configSecret(name, fallback, weakValues = []) {
  const value = process.env[name] || fallback;
  if (isProduction && (!process.env[name] || weakValues.includes(value))) {
    throw new Error(`${name} must be set to a non-default value when NODE_ENV=production`);
  }
  return value;
}

const adminPassword = configSecret("ADMIN_PASSWORD", "admin123", ["admin123"]);
const remoteAdminAccount = configSecret("REMOTE_ADMIN_ACCOUNT", "admin", ["admin"]);
const remoteAdminPassword = configSecret("REMOTE_ADMIN_PASSWORD", "zhl8", ["zhl8"]);
const gameAdminAccount = configSecret("GAME_ADMIN_ACCOUNT", "mapadmin", ["mapadmin"]);
const gameAdminPassword = configSecret("GAME_ADMIN_PASSWORD", "mapadmin2026", ["mapadmin2026"]);

const adminRoleCatalog = careerTree.adminRoleCatalog;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".chj": "application/octet-stream",
  ".md": "text/markdown; charset=utf-8"
};

const staticAssetRoots = ["assets", "资源", "maps", "战斗", "队伍", "联网战斗", "全服竞技场", "仙气修炼", "疯狂吹牛", "每日新闻", "桃子", "宠物模块", "职业模块", "副本模块", "生活技能", "菜单UI", "聊天模块", "飞图小地图", "后台管理ui", "bandwidth-optimizer", "龙魂系统"];
const staticAssetExtensions = new Set([".chj", ".css", ".html", ".js", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webmanifest"]);
const staticEntryFiles = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "map-admin-editor.js",
  "app-config.js",
  "font-theme.css",
  "manifest.webmanifest",
  "sw.js",
  "admin.html",
  "admin.js",
  "admin.css",
  "admin-mobile.html",
  "admin-mobile.js",
  "admin-mobile.css"
]);

const equipmentSlots = {
  hat: ["hat"],
  armor: ["armor"],
  pants: ["pants"],
  belt: ["belt"],
  shoes: ["shoes"],
  weapon: ["firearm", "sword", "staff"],
  demonWeapon: ["demon_firearm", "demon_staff", "demon_sword"],
  fashion: ["fashion"]
};

const STAT_LIMITS = {
  hp: 1500000,
  defense: 250000,
  speed: 30000,
  attack: 250000,
  mana: 50000,
  energy: 999,
  hit: 1000,
  dodge: 100,
  crit: 100,
  critDamage: 2000,
  antiCritDamage: 2000,
  confuseResist: 100,
  sealResist: 100,
  paralyzeResist: 100,
  curseResist: 100,
  sleepResist: 100
};

const STAT_MINIMUMS = {
  hp: 1,
  defense: 0,
  speed: 1,
  attack: 1,
  mana: 0,
  energy: 0,
  hit: 0,
  dodge: 0,
  crit: 0,
  critDamage: 100,
  antiCritDamage: 0,
  confuseResist: 0,
  sealResist: 0,
  paralyzeResist: 0,
  curseResist: 0,
  sleepResist: 0
};

const sharedClassGrowth = careerTree.baseGrowth;

const classGrowth = {
  "初始角色": sharedClassGrowth,
  "枪手": sharedClassGrowth,
  "法师": sharedClassGrowth,
  "剑士": sharedClassGrowth
};

// 子职业只区分可用技能，不再修改角色数值。
const subStatBonus = {
  "未转职": { skillId: "shining_strike" },
  "初级枪手": { skillId: "gun_demon_sting" },
  "初级法师": { skillId: "mage_wildfire" },
  "初级剑士": { skillId: "sword_blade_dance" },
  "破魔": { skillId: "gun_breaker" },
  "重装": { skillId: "gun_bastion" },
  "狙击": { skillId: "gun_sniper" },
  "裁决": { skillId: "mage_judgement" },
  "暗影": { skillId: "mage_shadow" },
  "神圣": { skillId: "mage_light" },
  "刺杀": { skillId: "sword_assassin" },
  "狂暴": { skillId: "sword_fury" },
  "防御": { skillId: "sword_guard" }
};

const roleSkillIds = {
  "法师": ["mage_wildfire"],
  "剑士": ["sword_blade_dance"],
  "枪手": ["gun_demon_sting"]
};

const petGrowth = { ...careerTree.baseGrowth, skillId: "pet_default" };

const petSkillIds = petModule.petSkillIds;
const petInnateSkillIds = petModule.petInnateSkillIds || {};

const equipmentForgeStats = {
  hat: { name: "精致帽子", stat: "mana", perLevel: 10000 / 15, icon: "1.27" },
  armor: { name: "精致上衣", stat: "defense", perLevel: 100000 / 15, icon: "1.4" },
  pants: { name: "精致裤子", stat: "attack", perLevel: 50000 / 15, icon: "1.30" },
  belt: { name: "精致腰带", stat: "hp", perLevel: 500000 / 15, icon: "1.7" },
  shoes: { name: "精致鞋子", stat: "speed", perLevel: 10000 / 15, icon: "1.33" },
  firearm: { name: "精致火枪", stat: "speed", perLevel: 10000 / 15, icon: "1.39" },
  sword: { name: "精致长剑", stat: "attack", perLevel: 50000 / 15, icon: "1.3" },
  staff: { name: "精致法杖", stat: "mana", perLevel: 10000 / 15, icon: "1.36" }
};

const equipmentAffixPool = [
  { stat: "speed", label: "速度", value: 1500 },
  { stat: "mana", label: "法力", value: 200 },
  { stat: "hp", label: "生命", value: 15000 },
  { stat: "attack", label: "攻击", value: 1500 },
  { stat: "defense", label: "防御", value: 1500 },
  { stat: "crit", label: "致命", value: 5 }
];

const fragmentItems = [
  { id: "peerless_skill_fragment", name: "绝世技能兑换卷碎片", icon: "1.49", column: "peerless_skill_fragment" },
  { id: "holy_skill_fragment", name: "圣品技能兑换券碎片", icon: "1.49", column: "holy_skill_fragment" },
  { id: "peerless_pet_scroll_fragment", name: "绝世宠物召唤卷碎片", icon: "2.12", column: "peerless_pet_scroll_fragment" },
  { id: "peerless_role_skill_fragment", name: "绝世人物技能兑换券碎片", icon: "1.49", column: "peerless_role_skill_fragment" },
  { id: "peerless_holy_weapon_fragment", name: "绝世圣武兑换券碎片", icon: "1.3", column: "peerless_holy_weapon_fragment" },
  { id: "fashion_ticket_fragment", name: "时装兑换券碎片", icon: "2.10", column: "fashion_ticket_fragment" },
  { id: "phantom_fragment", name: "幻影碎片", icon: "1.49", column: "phantom_fragment" }
];

const wildMonsterRewards = {
  amumu: {
    level: 18,
    exp: 2600,
    forgeGemChance: 0.65,
    forgeGem: [1, 2],
    equipmentChance: 0.28,
    fragments: []
  },
  afei: {
    level: 80,
    exp: 25000,
    forgeGemChance: 1,
    forgeGem: [3, 8],
    equipmentChance: 0.85,
    fragments: [
      { id: "peerless_skill_fragment", chance: 0.75, amount: [1, 2] },
      { id: "holy_skill_fragment", chance: 0.9, amount: [1, 3] },
      { id: "peerless_pet_scroll_fragment", chance: 0.55, amount: [1, 2] },
      { id: "peerless_role_skill_fragment", chance: 0.55, amount: [1, 2] },
      { id: "peerless_holy_weapon_fragment", chance: 0.35, amount: [1, 1] },
      { id: "fashion_ticket_fragment", chance: 0.65, amount: [1, 2] }
    ]
  },
  phantom: {
    level: 80,
    exp: 25000,
    forgeGemChance: 1,
    forgeGem: [3, 8],
    equipmentChance: 0.85,
    fragments: [
      { id: "peerless_skill_fragment", chance: 0.75, amount: [1, 2] },
      { id: "holy_skill_fragment", chance: 0.9, amount: [1, 3] },
      { id: "peerless_pet_scroll_fragment", chance: 0.55, amount: [1, 2] },
      { id: "peerless_role_skill_fragment", chance: 0.55, amount: [1, 2] },
      { id: "peerless_holy_weapon_fragment", chance: 0.35, amount: [1, 1] },
      { id: "fashion_ticket_fragment", chance: 0.65, amount: [1, 2] },
      { id: "phantom_fragment", chance: 1, amount: [2, 5] }
    ]
  }
};

const skillCardItems = [
  { id: "peerless_skill_ticket", name: "绝世技能兑换券", icon: "1.49", column: "peerless_skill_ticket" },
  { id: "peerless_role_skill_ticket", name: "绝世人物技能兑换券", icon: "1.49", column: "peerless_role_skill_ticket" },
  { id: "peerless_pet_scroll_ticket", name: "绝世宠物召唤券", icon: "2.12", column: "peerless_pet_scroll_ticket" },
  { id: "peerless_holy_weapon_ticket", name: "绝世圣武兑换券", icon: "1.3", column: "peerless_holy_weapon_ticket" },
  { id: "lucky_box", name: "好运宝箱", icon: "1.11", column: "lucky_box" },
  { id: "skill_card_double_dragon", name: "绝世技能卡：双龙击", icon: "1.49", column: "skill_card_double_dragon", skillId: "pet_double_dragon" },
  { id: "skill_card_magic_field", name: "绝世技能卡：禁魔立场", icon: "1.49", column: "skill_card_magic_field", skillId: "pet_magic_field" },
  { id: "skill_card_eternal_sleep", name: "绝世技能卡：永恒之眠", icon: "1.49", column: "skill_card_eternal_sleep", skillId: "pet_eternal_sleep" },
  { id: "skill_card_role_sword_dragon_slash", name: "绝世人物技能卡：封龙斩", icon: "1.3", column: "skill_card_role_sword_dragon_slash", skillId: "role_sword_dragon_slash" },
  { id: "skill_card_role_sword_blood_burst", name: "绝世人物技能卡：气血爆发", icon: "1.3", column: "skill_card_role_sword_blood_burst", skillId: "role_sword_blood_burst" },
  { id: "skill_card_role_mage_frost_domain", name: "绝世人物技能卡：冰封万域", icon: "1.36", column: "skill_card_role_mage_frost_domain", skillId: "role_mage_frost_domain" },
  { id: "skill_card_role_mage_soul_burn", name: "绝世人物技能卡：焚灵祭命", icon: "1.36", column: "skill_card_role_mage_soul_burn", skillId: "role_mage_soul_burn" },
  { id: "skill_card_role_gun_shadow_barrage", name: "绝世人物技能卡：迅影万弹", icon: "1.39", column: "skill_card_role_gun_shadow_barrage", skillId: "role_gun_shadow_barrage" },
  { id: "skill_card_role_gun_soul_snipe", name: "绝世人物技能卡：冥封魂狙", icon: "1.39", column: "skill_card_role_gun_soul_snipe", skillId: "role_gun_soul_snipe" },
  { id: "fashion_ticket", name: "时装兑换券", icon: "2.10", column: "fashion_ticket" },
  { id: "holy_skill_ticket", name: "圣品技能兑换券", icon: "1.49", column: "holy_skill_ticket" },
  { id: "skill_card_holy_combo", name: "圣品技能卡：连击", icon: "1.49", column: "skill_card_holy_combo", skillId: "holy_combo" },
  { id: "skill_card_holy_counter", name: "圣品技能卡：反噬", icon: "1.49", column: "skill_card_holy_counter", skillId: "holy_counter" },
  { id: "skill_card_holy_rebirth", name: "圣品技能卡：涅磐", icon: "1.49", column: "skill_card_holy_rebirth", skillId: "holy_rebirth" },
  { id: "skill_card_holy_break_armor", name: "圣品技能卡：破甲", icon: "1.49", column: "skill_card_holy_break_armor", skillId: "holy_break_armor" },
  { id: "skill_card_holy_lifesteal", name: "圣品技能卡：嗜血", icon: "1.49", column: "skill_card_holy_lifesteal", skillId: "holy_lifesteal" },
  { id: "skill_card_holy_elf_spring", name: "圣品技能卡：精灵温泉", icon: "1.49", column: "skill_card_holy_elf_spring", skillId: "holy_elf_spring" },
  { id: "skill_card_holy_zeus_field", name: "圣品技能卡：宙斯力场", icon: "1.49", column: "skill_card_holy_zeus_field", skillId: "holy_zeus_field" },
  { id: "skill_card_holy_king_guard", name: "圣品技能卡：国王守护", icon: "1.49", column: "skill_card_holy_king_guard", skillId: "holy_king_guard" },
  { id: "skill_card_holy_elf_guard", name: "圣品技能卡：精灵守护", icon: "1.49", column: "skill_card_holy_elf_guard", skillId: "holy_elf_guard" },
  { id: "skill_card_holy_guild_guard", name: "圣品技能卡：公会守护", icon: "1.49", column: "skill_card_holy_guild_guard", skillId: "holy_guild_guard" }
];

const demonWeaponCatalog = [
  { id: "demon_firearm", name: "绝世.魔界尊者之枪", icon: "1.39", stats: { speed: 30000, attack: 125000, defense: 125000, mana: 25000 } },
  { id: "demon_staff", name: "绝世.魔界尊者之杖", icon: "1.36", stats: { mana: 50000, speed: 15000, attack: 125000, defense: 125000 } },
  { id: "demon_sword", name: "绝世.魔界尊者之剑", icon: "1.3", stats: { attack: 250000, mana: 25000, speed: 15000, defense: 125000 } }
];
const equipmentPercentAffixPool = [
  { stat: "speed", label: "速度", percent: 0.05 },
  { stat: "defense", label: "防御", percent: 0.05 },
  { stat: "hp", label: "生命", percent: 0.05 },
  { stat: "mana", label: "法力", percent: 0.05 },
  { stat: "attack", label: "攻击", percent: 0.05 }
];

const mercenaryTypes = {
  mage: { id: "mage", name: "法佣", spriteId: 873, skillId: "merc_mage_starfall" },
  gun: { id: "gun", name: "枪佣", spriteId: 871, skillId: "merc_gun_multishot" },
  sword: { id: "sword", name: "剑佣", spriteId: 869, skillId: "merc_sword_deathblow" }
};

const mercenaryBaseStats = {
  hp: 500000,
  defense: 90000,
  speed: 10000,
  attack: 90000,
  mana: 15000,
  crit: 50,
  critDamage: 600
};

const mercenaryPassiveSkillIds = new Set(["holy_combo", "holy_counter", "holy_rebirth", "holy_break_armor", "holy_lifesteal", "holy_king_guard", "holy_elf_guard", "holy_guild_guard"]);
const mercenaryHolySkillIds = new Set(skillCardItems.filter((item) => item.id.startsWith("skill_card_holy_") && item.skillId).map((item) => item.skillId));
const peerlessPetIds = new Set(petModule.peerlessPetIds);

const fashionCatalog = [
  { id: "fashion_792_peerless_dusk_female", name: "绝世黄昏（女）", spriteId: 792, gender: "女", icon: "2.10" },
  { id: "fashion_789_peerless_dusk_male", name: "绝世黄昏（男）", spriteId: 789, gender: "男", icon: "2.10" },
  { id: "fashion_786_peerless_arbitration_female", name: "绝世仲裁（女）", spriteId: 786, gender: "女", icon: "2.10" },
  { id: "fashion_783_peerless_arbitration_male", name: "绝世仲裁（男）", spriteId: 783, gender: "男", icon: "2.10" },
  { id: "fashion_361_peerless_sky_male", name: "绝世天空（男）", spriteId: 361, gender: "男", icon: "2.10" },
  { id: "fashion_363_peerless_sky_female", name: "绝世天空（女）", spriteId: 363, gender: "女", icon: "2.10" },
  { id: "fashion_2018_peach", name: "桃子（通用）", spriteId: 2018, gender: "通用", icon: "2.10" },
  { id: "fashion_875_holy_elf_male", name: "圣品精灵套（男）", spriteId: 875, gender: "男", icon: "2.10" },
  { id: "fashion_879_holy_elf_female", name: "圣品精灵套（女）", spriteId: 878, gender: "女", icon: "2.10" },
  { id: "fashion_881_perfect_elf_male", name: "完美精灵套（男）", spriteId: 881, gender: "男", icon: "2.10" },
  { id: "fashion_884_perfect_elf_female", name: "完美精灵套（女）", spriteId: 884, gender: "女", icon: "2.10" },
  { id: "fashion_825_wedding_dress_female", name: "婚纱套（女）", spriteId: 825, gender: "女", icon: "2.10" },
  { id: "fashion_823_suit_male", name: "西装套（男）", spriteId: 823, gender: "男", icon: "2.10" },
  { id: "fashion_818_christmas_female", name: "圣诞套（女）", spriteId: 818, gender: "女", icon: "2.10" },
  { id: "fashion_815_christmas_male", name: "圣诞套（男）", spriteId: 815, gender: "男", icon: "2.10" },
  { id: "fashion_780_free_wind_male", name: "自由之风（男）", spriteId: 780, gender: "男", icon: "2.10" },
  { id: "fashion_777_free_wind_female", name: "自由自风（女）", spriteId: 777, gender: "女", icon: "2.10" },
  { id: "fashion_771_candy_wizard_female", name: "糖果巫师（女）", spriteId: 771, gender: "女", icon: "2.10" },
  { id: "fashion_768_candy_wizard_male", name: "糖果巫师（男）", spriteId: 768, gender: "男", icon: "2.10" },
  { id: "fashion_765_evil_imp_female", name: "邪恶小鬼（女）", spriteId: 765, gender: "女", icon: "2.10" },
  { id: "fashion_762_evil_imp_male", name: "邪恶小鬼（男）", spriteId: 762, gender: "男", icon: "2.10" },
  { id: "fashion_584_crescent_male", name: "新月（男）", spriteId: 584, gender: "男", icon: "2.10" },
  { id: "fashion_586_crescent_female", name: "新月（女）", spriteId: 586, gender: "女", icon: "2.10" },
  { id: "fashion_590_crescent2_female", name: "新月2（女）", spriteId: 590, gender: "女", icon: "2.10" },
  { id: "fashion_588_crescent2_male", name: "新月2（男）", spriteId: 588, gender: "男", icon: "2.10" },
  { id: "fashion_582_crescent3_female", name: "新月3（女）", spriteId: 582, gender: "女", icon: "2.10" },
  { id: "fashion_590_crescent3_male", name: "新月3（男）", spriteId: 590, gender: "男", icon: "2.10" },
  { id: "fashion_552_moon_power_female", name: "月神之力（女）", spriteId: 552, gender: "女", icon: "2.10" },
  { id: "fashion_550_moon_power_male", name: "月神之力（男）", spriteId: 550, gender: "男", icon: "2.10" },
  { id: "fashion_519_moe_war_female", name: "萌战（女）", spriteId: 519, gender: "女", icon: "2.10" },
  { id: "fashion_517_moe_war_male", name: "萌战（男）", spriteId: 517, gender: "男", icon: "2.10" }
];

function normalizePetId(petId) {
  return petModule.normalizePetId(petId);
}
const mercenaryNecklaceTypes = {
  advanced: { type: "advanced", name: "高级佣兵项链", cost: 1000, slots: 3, icon: "1.27" },
  peerless: { type: "peerless", name: "绝世佣兵项链", cost: 10000, slots: 4, icon: "1.49" }
};
const mercenaryOrbStatCaps = {
  speed: 10000,
  mana: 15000,
  attack: 90000,
  hp: 500000,
  defense: 90000,
  crit: 50,
  critDamage: 600
};
const mercenaryOrbStatLabels = {
  speed: "速度",
  mana: "法力",
  attack: "攻击",
  hp: "生命",
  defense: "防御",
  crit: "致命",
  critDamage: "爆伤"
};

function equipmentSlotForType(type) {
  return Object.entries(equipmentSlots).find(([, types]) => types.includes(type))?.[0] || type;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS game_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    channel_count INTEGER NOT NULL DEFAULT 6,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    account TEXT PRIMARY KEY,
    owner_account TEXT NOT NULL DEFAULT '',
    server_id TEXT NOT NULL DEFAULT 'penguin_village',
    character_slot INTEGER NOT NULL DEFAULT 1,
    gender TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL UNIQUE,
    x INTEGER NOT NULL DEFAULT 0,
    y INTEGER NOT NULL DEFAULT 0,
    map_name TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 1,
    exp INTEGER NOT NULL DEFAULT 0,
    career_level INTEGER NOT NULL DEFAULT 1,
    career_exp INTEGER NOT NULL DEFAULT 0,
    dragon_soul INTEGER NOT NULL DEFAULT 0,
    dragon_soul_exp INTEGER NOT NULL DEFAULT 0,
    dragon_soul_daily_key TEXT NOT NULL DEFAULT '',
    dragon_soul_daily_used INTEGER NOT NULL DEFAULT 0,
    pet_level INTEGER NOT NULL DEFAULT 1,
    pet_exp INTEGER NOT NULL DEFAULT 0,
    pet_progress_json TEXT NOT NULL DEFAULT '{}',
    owned_pets_json TEXT NOT NULL DEFAULT '[]',
    pet_extra_skills_json TEXT NOT NULL DEFAULT '{}',
    role_extra_skills_json TEXT NOT NULL DEFAULT '[]',
    silver INTEGER NOT NULL DEFAULT 0,
    yuanbao INTEGER NOT NULL DEFAULT 0,
    lucky_box_items_json TEXT NOT NULL DEFAULT '{}',
    soul_powder INTEGER NOT NULL DEFAULT 0,
    forge_gem INTEGER NOT NULL DEFAULT 0,
    peerless_skill_fragment INTEGER NOT NULL DEFAULT 0,
    peerless_skill_ticket INTEGER NOT NULL DEFAULT 0,
    peerless_role_skill_ticket INTEGER NOT NULL DEFAULT 0,
    skill_card_double_dragon INTEGER NOT NULL DEFAULT 0,
    skill_card_magic_field INTEGER NOT NULL DEFAULT 0,
    skill_card_eternal_sleep INTEGER NOT NULL DEFAULT 0,
    skill_card_role_sword_dragon_slash INTEGER NOT NULL DEFAULT 0,
    skill_card_role_sword_blood_burst INTEGER NOT NULL DEFAULT 0,
    skill_card_role_mage_frost_domain INTEGER NOT NULL DEFAULT 0,
    skill_card_role_mage_soul_burn INTEGER NOT NULL DEFAULT 0,
    skill_card_role_gun_shadow_barrage INTEGER NOT NULL DEFAULT 0,
    skill_card_role_gun_soul_snipe INTEGER NOT NULL DEFAULT 0,
    lucky_box INTEGER NOT NULL DEFAULT 0,
    fashion_ticket INTEGER NOT NULL DEFAULT 0,
    peerless_pet_scroll_ticket INTEGER NOT NULL DEFAULT 0,
    peerless_holy_weapon_ticket INTEGER NOT NULL DEFAULT 0,
    holy_skill_ticket INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_combo INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_counter INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_rebirth INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_break_armor INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_lifesteal INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_elf_spring INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_zeus_field INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_king_guard INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_elf_guard INTEGER NOT NULL DEFAULT 0,
    skill_card_holy_guild_guard INTEGER NOT NULL DEFAULT 0,
    holy_skill_fragment INTEGER NOT NULL DEFAULT 0,
    peerless_pet_scroll_fragment INTEGER NOT NULL DEFAULT 0,
    peerless_role_skill_fragment INTEGER NOT NULL DEFAULT 0,
    peerless_holy_weapon_fragment INTEGER NOT NULL DEFAULT 0,
    fashion_ticket_fragment INTEGER NOT NULL DEFAULT 0,
    phantom_fragment INTEGER NOT NULL DEFAULT 0,
    phantom_points INTEGER NOT NULL DEFAULT 0,
    elf_waist_bag INTEGER NOT NULL DEFAULT 0,
    bag_capacity_bonus INTEGER NOT NULL DEFAULT 0,
    mysterious_paint INTEGER NOT NULL DEFAULT 0,
    immortal_pill INTEGER NOT NULL DEFAULT 0,
    immortal_cultivation_json TEXT NOT NULL DEFAULT '{}',
    arena_reward_claimed_key TEXT NOT NULL DEFAULT '',
    equipped_title TEXT NOT NULL DEFAULT '',
    claimed_titles_json TEXT NOT NULL DEFAULT '[]',
    equipment_json TEXT NOT NULL DEFAULT '[]',
    equipped_json TEXT NOT NULL DEFAULT '{}',
    storage_json TEXT NOT NULL DEFAULT '{"materials":{},"equipment":[]}',
    auto_strategy_json TEXT NOT NULL DEFAULT '{}',
    selection_json TEXT NOT NULL DEFAULT '{}',
    friends_json TEXT NOT NULL DEFAULT '[]',
    soul_powder_300_at TEXT,
    soul_powder_400_at TEXT,
    redeem_code_claimed_at TEXT,
    peerless_pet_scroll_redeemed_at TEXT,
    fashion_ticket_redeemed_at TEXT,
    peerless_holy_weapon_redeemed_at TEXT,
    peerless_role_skill_redeemed_at TEXT,
    phantom_title_first_redeemed_at TEXT,
    immortal_boss_rewards_json TEXT NOT NULL DEFAULT '{}',
    elf_king_vault_rewards_json TEXT NOT NULL DEFAULT '{}',
    mercenaries_json TEXT NOT NULL DEFAULT '[]',
    active_mercenary_id TEXT NOT NULL DEFAULT '',
    mercenary_necklaces_json TEXT NOT NULL DEFAULT '[]',
    mercenary_orbs_json TEXT NOT NULL DEFAULT '[]',
    mercenary_craft_json TEXT NOT NULL DEFAULT '{}',
    sticker_inventory_json TEXT NOT NULL DEFAULT '{}',
    pet_stickers_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    account TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS arena_rankings (
    server_id TEXT NOT NULL DEFAULT 'penguin_village',
    rank INTEGER NOT NULL,
    account TEXT NOT NULL,
    name TEXT NOT NULL,
    mirror_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (server_id, rank),
    UNIQUE (server_id, account)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS phantom_rankings (
    server_id TEXT NOT NULL DEFAULT 'penguin_village',
    account TEXT NOT NULL,
    name TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (server_id, account)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS account_anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    type TEXT NOT NULL,
    severity INTEGER NOT NULL DEFAULT 1,
    detail_json TEXT NOT NULL DEFAULT '{}',
    action TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS account_ip_stats (
    account TEXT NOT NULL,
    ip TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (account, ip)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_anomalies_lookup ON account_anomalies (account, type, action, created_at)");

ensureDefaultGameServer();
ensurePlayerColumns();
ensureServerScopedColumns();
migrateLegacyDb();
restoreFashionFromAnomalyLog();
const mapRegistry = createMapRegistry({ root });
const adminMapApi = createAdminMapApi({ registry: mapRegistry, checkAdmin: checkMapAdmin, sendJson });
mapRegistry.scanMaps();

async function handleHttpRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    writeCorsHeaders(res, 204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/asset-manifest") {
    sendJson(res, 200, collectStaticAssets());
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      console.error("[api-error]", error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server_error" });
    }
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (isAdminStaticPath(pathname) && !isLocalRequest(req) && !hasBasicAdminAuth(req)) {
    requestAdminPageAuth(res);
    return;
  }
  const filePath = path.normalize(path.join(root, pathname));
  if (!isAllowedStaticFile(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, staticHeaders(filePath));
    res.end(data);
  });
}

const server = http.createServer(handleHttpRequest);

const immortalBossRewards = {
  immortal_hand: 200,
  immortal_foot: 400,
  immortal_body: 800,
  immortal_brain: 1200,
  immortal_heart: 2400
};
const immortalBossPillRewards = {
  immortal_foot: 2,
  immortal_hand: 4,
  immortal_body: 8,
  immortal_brain: 10,
  immortal_heart: 15
};

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readJsonBody(req, callback) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 65536) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      callback(null);
      return;
    }
    try {
      Promise.resolve(callback(data)).catch((error) => callback(null, error));
    } catch (error) {
      callback(null, error);
    }
  });
}

function sendJson(res, status, data) {
  writeCorsHeaders(res, status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function writeCorsHeaders(res, status, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
    ...headers
  });
}

function staticHeaders(filePath) {
  const extension = path.extname(filePath);
  const headers = {
    "Content-Type": types[extension] || "application/octet-stream"
  };
  if ([".chj", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4"].includes(extension)) {
    headers["Cache-Control"] = "public, max-age=31536000";
  } else if ([".html", ".css", ".js", ".json", ".webmanifest"].includes(extension)) {
    headers["Cache-Control"] = "no-cache";
  }
  return headers;
}

function isAllowedStaticFile(filePath) {
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const normalized = relative.split(path.sep).join("/");
  const extension = path.extname(normalized);
  if (!staticAssetExtensions.has(extension)) return false;
  if (staticEntryFiles.has(normalized)) return true;
  return staticAssetRoots.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function collectStaticAssets() {
  const coreAssets = new Set([
    "/",
    "/index.html",
    "/font-theme.css",
    "/styles.css",
    "/app.js",
    "/app-config.js",
    "/map-admin-editor.js",
    "/manifest.webmanifest",
    "/sw.js",
    "/菜单UI/菜单界面.css",
    "/菜单UI/菜单界面.js",
    "/飞图小地图/区域飞图.css",
    "/飞图小地图/区域飞图.js",
    "/资源/图片/mm1.png",
    "/资源/图片/mm2.png",
    "/资源/图片/登录封面.png",
    "/资源/图片/表情.png",
    "/资源/图片/魔法阵.png",
    "/资源/图片/自动战斗.png",
    "/资源/图片/点击.png",
    "/资源/图片/地图ui1.png",
    "/资源/图片/地图ui2.png",
    "/资源/图片/地图背景.png",
    "/资源/图片/地图边框.png",
    "/资源/图片/战斗数字.png",
    "/资源/图片/战斗箭头.png"
  ]);
  const assets = new Set(coreAssets);
  let versionInput = "";

  function addFile(filePath) {
    const extension = path.extname(filePath);
    if (!staticAssetExtensions.has(extension)) return;
    const stat = fs.statSync(filePath);
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    assets.add(`/${relative}`);
    versionInput += `${relative}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`;
  }

  for (const dir of staticAssetRoots) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;
    const stack = [dirPath];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(next);
        } else if (entry.isFile()) {
          addFile(next);
        }
      }
    }
  }

  for (const urlPath of assets) {
    const filePath = urlPath === "/" ? path.join(root, "index.html") : path.join(root, decodeURIComponent(urlPath.slice(1)));
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    versionInput += `${urlPath}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`;
  }

  return {
    ok: true,
    version: crypto.createHash("sha1").update(versionInput).digest("hex").slice(0, 12),
    assets: [...coreAssets].sort()
  };
}

function appSetting(key, fallback = {}) {
  const row = db.prepare("SELECT value_json, updated_at FROM app_settings WHERE key = ?").get(key);
  const value = safeJsonObject(row?.value_json);
  return { ...fallback, ...value, updatedAt: row?.updated_at || value.updatedAt || "" };
}

function saveAppSetting(key, value) {
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify({ ...value, updatedAt }), updatedAt);
  return { ...value, updatedAt };
}

function gameServerById(serverId, enabledOnly = false) {
  const id = String(serverId || "").trim();
  if (!id) return null;
  return enabledOnly
    ? db.prepare("SELECT * FROM game_servers WHERE id = ? AND enabled = 1").get(id)
    : db.prepare("SELECT * FROM game_servers WHERE id = ?").get(id);
}

function socketRealm(meta = {}) {
  return {
    serverId: String(meta.serverId || ""),
    channelId: Math.floor(Number(meta.channelId) || 0)
  };
}

function sameSocketRealm(left = {}, right = {}) {
  const a = socketRealm(left);
  const b = socketRealm(right);
  return Boolean(a.serverId && b.serverId && a.serverId === b.serverId && a.channelId === b.channelId);
}

function gameServerToApi(row) {
  if (!row) return null;
  const characterCount = db.prepare("SELECT COUNT(*) AS count FROM players WHERE server_id = ?").get(row.id)?.count || 0;
  const channelCount = Math.max(1, Math.floor(Number(row.channel_count) || SERVER_CHANNEL_COUNT));
  const onlineStats = onlineStatsRuntime.countsForServer(row.id, channelCount);
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    channelCount,
    characterCount,
    onlineCount: onlineStats.onlineCount,
    channels: onlineStats.channels,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function characterRowToSummary(row) {
  if (!row) return null;
  const selection = safeJsonObject(row.selection_json).className
    ? careerTree.normalizeSelection(safeJsonObject(row.selection_json))
    : safeJsonObject(row.selection_json);
  const gender = row.gender || selection.gender || "";
  return {
    id: row.account,
    characterId: row.account,
    account: row.account,
    ownerAccount: row.owner_account || row.account,
    serverId: row.server_id || DEFAULT_SERVER_ID,
    characterSlot: Math.max(1, Math.min(3, Number(row.character_slot) || 1)),
    slot: Math.max(1, Math.min(3, Number(row.character_slot) || 1)),
    name: row.name,
    gender,
    level: Number(row.level) || 1,
    careerLevel: Number(row.career_level) || 1,
    selection,
    updatedAt: row.updated_at || ""
  };
}

function updateLogSetting() {
  return appSetting("update_log", { title: "更新日志", content: "", enabled: true, version: "" });
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function gameVisualSetting() {
  const setting = appSetting("game_visual", { playerScale: 1, petScale: 1, otherScale: 1 });
  return {
    playerScale: clampNumber(setting.playerScale, 1, 0.5, 2.5),
    petScale: clampNumber(setting.petScale, 1, 0.5, 2.5),
    otherScale: clampNumber(setting.otherScale, 1, 0.5, 2.5),
    updatedAt: setting.updatedAt || ""
  };
}

function loginVisualSetting() {
  const defaultPositions = [64.0436, 70.3282, 76.3365, 82.5519, 88.9055];
  const defaultVideo = "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4";
  const defaultImage = "\u8d44\u6e90/\u56fe\u7247/\u767b\u5f55\u5c01\u9762.png";
  const setting = appSetting("login_visual", {
    mode: "cover",
    mediaType: "video",
    mediaSrc: defaultVideo,
    hotspotLeft: 65,
    hotspotWidth: 28,
    hotspotHeight: 5.2,
    arrowLeft: 67.035,
    positions: defaultPositions,
    videoSkipStart: true,
    videoSkipStartTime: 0.1
  });
  const positions = Array.isArray(setting.positions) ? setting.positions : defaultPositions;
  return {
    mode: setting.mode === "classic" ? "classic" : "cover",
    mediaType: setting.mediaType === "image" ? "image" : "video",
    mediaSrc: sanitizeStaticMediaPath(setting.mediaSrc, setting.mediaType === "image" ? defaultImage : defaultVideo),
    hotspotLeft: clampNumber(setting.hotspotLeft, 65, 0, 100),
    hotspotWidth: clampNumber(setting.hotspotWidth, 28, 5, 100),
    hotspotHeight: clampNumber(setting.hotspotHeight, 5.2, 2, 30),
    arrowLeft: clampNumber(setting.arrowLeft, 67.035, 0, 100),
    positions: defaultPositions.map((fallback, index) => clampNumber(positions[index], fallback, 0, 100)),
    videoSkipStart: setting.videoSkipStart !== false,
    videoSkipStartTime: clampNumber(setting.videoSkipStartTime, 0.1, 0, 30),
    updatedAt: setting.updatedAt || ""
  };
}

function sanitizeStaticMediaPath(value, fallback) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 512);
  const clean = raw.replace(/^\/+/, "").slice(0, 512);
  if (clean.includes("..")) return fallback;
  if (!/\.(png|jpg|jpeg|webp|gif|mp4)$/i.test(clean)) return fallback;
  return clean;
}

function roomMessageType(message) {
  if (!wsBandwidthStatsEnabled) return "disabled";
  try {
    const data = JSON.parse(message);
    return typeof data?.type === "string" && data.type ? data.type : "unknown";
  } catch {
    return "invalid_json";
  }
}

function parseRoomMessage(message) {
  try {
    const data = JSON.parse(message);
    return expandRoomMessage(data);
  } catch {
    return null;
  }
}

function expandRoomMessage(data) {
  if (!data || typeof data !== "object") return null;
  if (data.type !== "s") return data;
  const full = Boolean(data.f);
  return {
    type: "state",
    full,
    peerId: data.p,
    account: full ? data.a || "" : "",
    name: data.n || "",
    spriteId: Number(data.s) || 0,
    x: Number(data.x) || 0,
    y: Number(data.y) || 0,
    mapName: data.m,
    previousMapName: data.pm || "",
    direction: data.d || "d",
    moving: Boolean(data.v),
    clientVersion: data.cv || "",
    battleStats: full ? data.bs || null : null,
    team: full ? data.tm || { leaderId: "", members: [] } : null,
    leaderId: full ? data.l || "" : "",
    pet: Array.isArray(data.pt) ? data.pt : null,
    mercenary: Array.isArray(data.mc) ? data.mc : null,
    hiddenPlayers: Boolean(data.h),
    to: data.to || ""
  };
}

function recordRoomTraffic(type, direction, bytes, messages = 1) {
  if (!wsBandwidthStatsEnabled) return;
  const entry = wsStats.byType.get(type) || {
    inboundBytes: 0,
    outboundBytes: 0,
    inboundMessages: 0,
    outboundMessages: 0
  };
  if (direction === "in") {
    wsStats.inboundBytes += bytes;
    wsStats.inboundMessages += messages;
    entry.inboundBytes += bytes;
    entry.inboundMessages += messages;
  } else {
    wsStats.outboundBytes += bytes;
    wsStats.outboundMessages += messages;
    entry.outboundBytes += bytes;
    entry.outboundMessages += messages;
  }
  wsStats.byType.set(type, entry);
}

function formatBytesPerSecond(bytes, seconds) {
  if (!seconds) return "0 B/s";
  const rate = bytes / seconds;
  if (rate >= 1024 * 1024) return `${(rate / 1024 / 1024).toFixed(2)} MB/s`;
  if (rate >= 1024) return `${(rate / 1024).toFixed(1)} KB/s`;
  return `${rate.toFixed(0)} B/s`;
}

if (wsBandwidthStatsEnabled) {
  setInterval(() => {
    const now = Date.now();
    const seconds = Math.max(1, (now - wsStats.since) / 1000);
    const rows = [...wsStats.byType.entries()]
      .map(([type, value]) => ({ type, ...value }))
      .sort((a, b) => b.outboundBytes - a.outboundBytes)
      .slice(0, 8)
      .map((row) => (
        `${row.type}: in ${row.inboundMessages}/${formatBytesPerSecond(row.inboundBytes, seconds)}, ` +
        `out ${row.outboundMessages}/${formatBytesPerSecond(row.outboundBytes, seconds)}`
      ));
    console.log(
      `[ws-bandwidth] clients=${sockets.size} ` +
      `in=${wsStats.inboundMessages}/${formatBytesPerSecond(wsStats.inboundBytes, seconds)} ` +
      `out=${wsStats.outboundMessages}/${formatBytesPerSecond(wsStats.outboundBytes, seconds)} ` +
      `top=${rows.join(" | ") || "none"}`
    );
    wsStats.since = now;
    wsStats.inboundBytes = 0;
    wsStats.outboundBytes = 0;
    wsStats.inboundMessages = 0;
    wsStats.outboundMessages = 0;
    wsStats.byType.clear();
  }, 10000).unref();
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function basicAdminCredentials(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split < 0) return null;
    return {
      account: decoded.slice(0, split),
      password: decoded.slice(split + 1)
    };
  } catch {
    return null;
  }
}

function hasBasicAdminAuth(req) {
  const credentials = basicAdminCredentials(req);
  return credentials?.account === remoteAdminAccount && credentials?.password === remoteAdminPassword;
}

function requestAdminPageAuth(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Admin"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("Admin password required");
}

function isAdminStaticPath(pathname) {
  return [
    "/admin.html",
    "/admin.js",
    "/admin.css",
    "/admin-mobile.html",
    "/admin-mobile.js",
    "/admin-mobile.css"
  ].includes(pathname);
}

function issueAuthToken(loginAccount, context = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  authSessions.set(token, {
    loginAccount: String(loginAccount || "").trim(),
    characterAccount: String(context.characterAccount || "").trim(),
    serverId: String(context.serverId || "").trim(),
    channelId: Math.floor(Number(context.channelId) || 0),
    expiresAt: Date.now() + AUTH_SESSION_MS
  });
  return token;
}

function cleanExpiredAuthSessions(now = Date.now()) {
  for (const [token, session] of authSessions) {
    if (!session || session.expiresAt <= now) authSessions.delete(token);
  }
}

function authTokenFromRequest(req, url = null, data = null) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const queryToken = url?.searchParams?.get("token");
  if (queryToken) return String(queryToken).trim();
  return String(req.headers["x-auth-token"] || data?.authToken || data?.token || "").trim();
}

function authSessionFromToken(token) {
  const session = authSessions.get(String(token || ""));
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + AUTH_SESSION_MS;
  return session;
}

function accountFromAuthToken(token) {
  return authSessionFromToken(token)?.characterAccount || "";
}

function loginAccountFromAuthToken(token) {
  return authSessionFromToken(token)?.loginAccount || "";
}

function serverIdFromRequest(req, url = null, data = null) {
  const requested = String(data?.serverId || url?.searchParams?.get("serverId") || "").trim();
  if (requested) return requested;
  return authSessionFromToken(authTokenFromRequest(req, url, data))?.serverId || DEFAULT_SERVER_ID;
}

function requireLoginAccount(req, res, url = null, data = null) {
  const loginAccount = loginAccountFromAuthToken(authTokenFromRequest(req, url, data));
  if (!loginAccount) {
    sendJson(res, 401, { ok: false, error: "auth_required" });
    return "";
  }
  if (!requireNotBanned(loginAccount, res)) return "";
  return loginAccount;
}

function requireAuthAccount(req, res, url = null, data = null) {
  const session = authSessionFromToken(authTokenFromRequest(req, url, data));
  if (!session?.loginAccount) {
    sendJson(res, 401, { ok: false, error: "auth_required" });
    return "";
  }
  if (!requireNotBanned(session.loginAccount, res)) return "";
  if (!session.characterAccount) {
    sendJson(res, 409, { ok: false, error: "character_required" });
    return "";
  }
  const gameServer = gameServerById(session.serverId, true);
  const channelCount = Math.max(1, Math.floor(Number(gameServer?.channel_count) || 0));
  if (!gameServer || session.channelId < 1 || session.channelId > channelCount) {
    sendJson(res, 409, { ok: false, error: "server_session_invalid" });
    return "";
  }
  const player = db.prepare(`
    SELECT account
    FROM players
    WHERE account = ? AND owner_account = ? AND server_id = ?
  `).get(session.characterAccount, session.loginAccount, session.serverId);
  if (!player) {
    sendJson(res, 409, { ok: false, error: "character_session_invalid" });
    return "";
  }
  return session.characterAccount;
}

function requireOnlineTargetInSessionRealm(req, res, targetAccount, url = null, data = null) {
  const session = authSessionFromToken(authTokenFromRequest(req, url, data));
  const realm = {
    serverId: String(session?.serverId || ""),
    channelId: Math.floor(Number(session?.channelId) || 0)
  };
  if (!realm.serverId || realm.channelId < 1 || !findSocketByAccount(targetAccount, realm)) {
    sendJson(res, 409, { ok: false, error: "target_not_in_channel" });
    return null;
  }
  return realm;
}

function checkAdmin(req, res, data = null) {
  const remoteAccount = String(req.headers["x-admin-account"] || data?.adminAccount || "").trim();
  if (remoteAccount) {
    const remotePassword = String(req.headers["x-admin-password"] || data?.adminPassword || "");
    if (remoteAccount !== remoteAdminAccount || remotePassword !== remoteAdminPassword) {
      sendJson(res, 401, { ok: false, error: "bad_admin_login" });
      return false;
    }
    return true;
  }
  if (!isLocalRequest(req) && hasBasicAdminAuth(req)) return true;
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { ok: false, error: "local_only" });
    return false;
  }
  const token = req.headers["x-admin-password"] || data?.adminPassword || "";
  if (token !== adminPassword) {
    sendJson(res, 401, { ok: false, error: "bad_admin_password" });
    return false;
  }
  return true;
}

function checkMapAdmin(req, res, data = null) {
  if (checkAdminTokenOnly(req, data)) return true;
  const account = String(req.headers["x-game-admin-account"] || data?.account || "").trim();
  const password = String(req.headers["x-game-admin-password"] || data?.password || "");
  if (account === gameAdminAccount && password === gameAdminPassword) return true;
  sendJson(res, 401, { ok: false, error: "bad_map_admin_login" });
  return false;
}

function checkAdminTokenOnly(req, data = null) {
  const remoteAccount = String(req.headers["x-admin-account"] || data?.adminAccount || "").trim();
  const remotePassword = String(req.headers["x-admin-password"] || data?.adminPassword || "");
  if (remoteAccount) return remoteAccount === remoteAdminAccount && remotePassword === remoteAdminPassword;
  if (isLocalRequest(req)) return (req.headers["x-admin-password"] || data?.adminPassword || "") === adminPassword;
  return hasBasicAdminAuth(req);
}

function normalizeClientIp(ip = "") {
  let value = String(ip || "").trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1") return "127.0.0.1";
  return value || "unknown";
}

function requestClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(req.headers["x-real-ip"] || req.headers["cf-connecting-ip"] || "").trim();
  return normalizeClientIp(forwarded || realIp || req.socket.remoteAddress || "");
}

function isPrivateIp(ip = "") {
  const value = normalizeClientIp(ip);
  return value === "127.0.0.1"
    || value.startsWith("10.")
    || value.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
    || value.startsWith("fc")
    || value.startsWith("fd");
}

function requestIpRegion(req, ip = "") {
  const parts = [
    req.headers["cf-ipcountry"],
    req.headers["x-vercel-ip-country"],
    req.headers["x-vercel-ip-country-region"],
    req.headers["x-vercel-ip-city"]
  ].map((value) => decodeURIComponent(String(value || "").trim())).filter(Boolean);
  if (parts.length) return [...new Set(parts)].join(" ");
  return isPrivateIp(ip) ? "内网/本机" : "未知地区";
}

function recordAccountIp(req, account) {
  const target = String(account || "").trim();
  if (!target) return;
  const ip = requestClientIp(req);
  const region = requestIpRegion(req, ip);
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO account_ip_stats (account, ip, region, count, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(account, ip) DO UPDATE SET
        region = excluded.region,
        count = count + 1,
        last_seen_at = excluded.last_seen_at
    `).run(target, ip, region, now, now);
  } catch (error) {
    if (error?.code === "ERR_SQLITE_ERROR" && Number(error?.errcode) === 5) {
      console.warn("[db-lock] skip account_ip_stats update", { account: target, ip });
      return;
    }
    throw error;
  }
}

function commonIpForAccount(account) {
  const row = db.prepare(`
    SELECT ip, region, count, first_seen_at, last_seen_at
    FROM account_ip_stats
    WHERE account = ?
    ORDER BY count DESC, last_seen_at DESC
    LIMIT 1
  `).get(account);
  return row ? {
    ip: row.ip || "",
    region: row.region || "",
    count: row.count || 0,
    firstSeenAt: row.first_seen_at || "",
    lastSeenAt: row.last_seen_at || ""
  } : { ip: "", region: "", count: 0, firstSeenAt: "", lastSeenAt: "" };
}

function requirePlayerAccount(account, res) {
  const row = db.prepare("SELECT account FROM players WHERE account = ?").get(account);
  if (!row) {
    sendJson(res, 404, { ok: false, error: "player_not_found" });
    return false;
  }
  return true;
}

function resolveOwnerAccount(value) {
  const target = String(value || "").trim();
  if (!target) return "";
  if (db.prepare("SELECT account FROM accounts WHERE account = ?").get(target)) return target;
  return db.prepare("SELECT owner_account FROM players WHERE account = ?").get(target)?.owner_account || "";
}

function upsertAccountPassword(account, password) {
  authRuntime.savePassword(account, password);
}

function safeJsonArray(raw) {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Index 0 is unused: each entry is the experience required for level N -> N + 1.
const LEVEL_UP_EXP = [0,
  60, 100, 160, 280, 450, 670, 940, 1260, 1630, 2050, 2520, 3040, 3610, 4230, 4900, 5620, 6390, 7210, 8080, 9000, 9970, 11000, 12090, 13240, 14450, 15720, 17050, 56623, 67890, 79876, 92654, 106231, 120608, 135785, 10234, 11321, 12487, 13734, 15062, 16473, 17968, 19547, 21211, 22960, 24795, 26716, 28724, 296618, 387654, 520000, 567890, 617654, 669321, 722890, 778361, 835734, 895009, 956186, 962190, 1034567, 1109876, 1188123, 1269312, 1353445, 1440522, 1530543, 1623508, 1719417, 172345, 187654, 203987, 221345, 239723, 259121, 279539, 300977, 323435, 346913, 2748920, 2876543, 3007891, 3143207, 3310693, 3481234, 3654829, 3831478, 4011181, 4193938, 4379749, 4568614, 4760533, 4955506, 5153533, 5354614, 5558749, 5765938, 5976181, 6189478, 6405829
];

// 成长/经验配置运行时：人物/宠物/佣兵成长属性、基础属性与升级经验曲线（服务端权威）。
// 默认值 = 代码内置数值；管理员可经 /api/admin/growth-config 覆盖并持久化到 app_settings。
const growthConfigRuntime = createGrowthConfigRuntime({
  db,
  defaults: {
    expTable: LEVEL_UP_EXP,
    character: {
      growth: classGrowth[careerTree.INITIAL_CLASS],
      dragonSoul: {}
    },
    pet: { growth: petGrowth },
    mercenary: { base: mercenaryBaseStats, minFactor: 0.1, maxFactor: 1 }
  }
});

function expToNextLevel(level) {
  return growthConfigRuntime.expToNextLevel(level);
}

function careerExpToNextLevel(level) {
  return careerProgressConfigRuntime.getConfig().expPerLevel;
}

function applyCareerExp(level, exp, gained, maxLevel) {
  return careerProgress.applyExp(level, exp, gained, careerExpToNextLevel(level), maxLevel);
}

function applyExp(level, exp, gained) {
  let nextLevel = Math.max(1, Math.min(100, Number(level) || 1));
  let nextExp = Math.max(0, Number(exp) || 0) + Math.max(0, Number(gained) || 0);
  while (nextLevel < 100 && nextExp >= expToNextLevel(nextLevel)) {
    nextExp -= expToNextLevel(nextLevel);
    nextLevel += 1;
  }
  if (nextLevel >= 100) nextExp = 0;
  return { level: nextLevel, exp: nextExp };
}

function normalizeProgress(progress = {}) {
  return {
    level: Math.max(1, Math.min(100, Math.floor(Number(progress.level) || 1))),
    exp: Math.max(0, Math.floor(Number(progress.exp) || 0))
  };
}

function petProgressMapForRow(row) {
  const progressByPetId = safeJsonObject(row?.pet_progress_json);
  const normalized = {};
  Object.entries(progressByPetId).forEach(([petId, progress]) => {
    const normalizedPetId = normalizePetId(petId);
    if (normalizedPetId) normalized[String(normalizedPetId)] = normalizeProgress(progress);
  });
  const legacyPetId = activePetIdForRow(row);
  if (legacyPetId && !normalized[String(legacyPetId)]) {
    normalized[String(legacyPetId)] = normalizeProgress({ level: row?.pet_level, exp: row?.pet_exp });
  }
  return normalized;
}

function petProgressForRow(row, petId) {
  const normalizedPetId = normalizePetId(petId);
  return petProgressMapForRow(row)[String(normalizedPetId)] || normalizeProgress();
}

function clampStat(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function growthValue(pair, level) {
  return (pair?.[0] || 0) + (pair?.[1] || 0) * (Math.max(1, level) - 1);
}

function isProgressInvalid(level, exp) {
  const normalizedLevel = Number(level);
  const normalizedExp = Number(exp);
  if (!Number.isFinite(normalizedLevel) || !Number.isFinite(normalizedExp)) return true;
  if (normalizedLevel < 1 || normalizedLevel > 100 || normalizedExp < 0) return true;
  return normalizedLevel < 100 && normalizedExp >= expToNextLevel(normalizedLevel);
}

function progressAnomalies(row) {
  const checks = [
    { label: "角色", level: row.level, exp: row.exp },
    ...Object.entries(petProgressMapForRow(row)).map(([petId, progress]) => ({ label: `宠物 ${petId}`, level: progress.level, exp: progress.exp }))
  ];
  const anomalies = [];
  checks.forEach((check) => {
    const level = Number(check.level);
    const exp = Number(check.exp);
    if (!Number.isFinite(level)) {
      anomalies.push({ target: check.label, field: "level", reason: "level_not_number", value: check.level });
      return;
    }
    if (!Number.isFinite(exp)) {
      anomalies.push({ target: check.label, field: "exp", reason: "exp_not_number", value: check.exp });
      return;
    }
    if (level < 1 || level > 100) anomalies.push({ target: check.label, field: "level", reason: "level_out_of_range", value: level });
    if (exp < 0) anomalies.push({ target: check.label, field: "exp", reason: "exp_negative", value: exp });
    if (level >= 1 && level < 100 && exp >= expToNextLevel(level)) {
      anomalies.push({ target: check.label, field: "exp", reason: "exp_exceeds_level_cap", value: exp, limit: expToNextLevel(level), level });
    }
  });
  return anomalies;
}

function resetAbnormalLevels() {
  const rows = db.prepare("SELECT account, level, exp, pet_level, pet_exp, pet_progress_json, selection_json, owned_pets_json FROM players").all();
  const targets = rows.filter((row) => (
    isProgressInvalid(row.level, row.exp) || Object.values(petProgressMapForRow(row)).some((progress) => isProgressInvalid(progress.level, progress.exp))
  ));
  const updatedAt = new Date().toISOString();
  const update = db.prepare("UPDATE players SET level = 1, exp = 0, pet_level = 1, pet_exp = 0, pet_progress_json = '{}', updated_at = ? WHERE account = ?");
  db.exec("BEGIN");
  try {
    targets.forEach((row) => update.run(updatedAt, row.account));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return targets;
}

function recordAnomaly(account, type, detail = {}, severity = 1, action = "") {
  if (!account) return;
  db.prepare(`
    INSERT INTO account_anomalies (account, type, severity, detail_json, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(account, type, severity, JSON.stringify(detail), action, new Date().toISOString());
}

function recordAnomalyOnce(account, type, detail = {}, severity = 1, action = "", windowMs = 10 * 60 * 1000) {
  if (!account) return;
  const since = new Date(Date.now() - windowMs).toISOString();
  const existing = db.prepare(`
    SELECT id
    FROM account_anomalies
    WHERE account = ? AND type = ? AND action = ? AND created_at >= ?
    ORDER BY id DESC
    LIMIT 1
  `).get(account, type, action, since);
  if (existing) return;
  recordAnomaly(account, type, detail, severity, action);
}

const authRuntime = createAuthRuntime({ db, recordAnomaly });
upsertAccountPassword(gameAdminAccount, gameAdminPassword);

const CLIENT_STAT_KEYS = ["hp", "defense", "speed", "attack", "mana", "crit", "critDamage"];
const clientStatCheckAt = new Map();

function statDiffs(clientStats, serverStats) {
  if (!clientStats || typeof clientStats !== "object" || !serverStats || typeof serverStats !== "object") return [];
  return CLIENT_STAT_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(clientStats, key))
    .map((key) => ({
      key,
      client: Math.round(Number(clientStats[key]) || 0),
      server: Math.round(Number(serverStats[key]) || 0)
    }))
    .filter((entry) => entry.client !== entry.server);
}

function detectClientStatsAnomaly(account, source, clientStats, serverStats = null) {
  if (!account || !clientStats || typeof clientStats !== "object") return false;
  const expected = serverStats || statsForPlayerRow(db.prepare("SELECT * FROM players WHERE account = ?").get(account) || {});
  const diffs = statDiffs(clientStats, expected);
  if (!diffs.length) return false;
  recordAnomalyOnce(account, "client_stats_tamper", { source, diffs, clientStats, serverStats: expected }, 3, source);
  return true;
}

function detectUploadedPlayerStats(account, source, data, serverStats = null) {
  if (!data || typeof data !== "object") return;
  const payloads = [
    data.stats,
    data.battleStats,
    data.playerStats,
    data.serverStats,
    data.actor?.stats,
    data.mirror?.actor?.stats
  ];
  payloads.forEach((stats) => detectClientStatsAnomaly(account, source, stats, serverStats));
}

function isAccountBanned(account) {
  if (!account) return false;
  const row = db.prepare("SELECT banned_at FROM accounts WHERE account = ?").get(account);
  return Boolean(row?.banned_at);
}

function accountBanInfo(account) {
  if (!account) return null;
  const row = db.prepare("SELECT banned_at, ban_reason FROM accounts WHERE account = ?").get(account);
  if (!row?.banned_at) return null;
  return {
    bannedAt: row.banned_at || "",
    banReason: row.ban_reason || "账号已被封禁"
  };
}

function requireNotBanned(account, res) {
  const ban = accountBanInfo(account);
  if (!ban) return true;
  sendJson(res, 403, { ok: false, error: "account_banned", ...ban });
  return false;
}

function statHashForId(id) {
  return crypto.createHash("sha1").update(String(id || ""), "utf8").digest()[0] || 0;
}

function sanitizeAffix(affix, itemId = "") {
  const stat = String(affix?.stat || "");
  const kind = affix?.kind === "percent" ? "percent" : "flat";
  const pool = kind === "percent" ? equipmentPercentAffixPool : equipmentAffixPool;
  const template = pool.find((entry) => entry.stat === stat) || pool[statHashForId(`${itemId}:${stat}:${kind}`) % pool.length];
  return { ...template, kind };
}

function tripleCritEquipmentConfig(type) {
  const names = {
    hat: "极品致命帽子",
    armor: "极品致命上衣",
    pants: "极品致命裤子",
    belt: "极品致命腰带",
    shoes: "极品致命鞋子",
    firearm: "极品致命火枪",
    sword: "极品致命长剑",
    staff: "极品致命法杖"
  };
  const mainStats = { hat: "mana", armor: "defense", pants: "attack", belt: "hp", shoes: "speed", firearm: "speed", sword: "attack", staff: "mana" };
  const mainValues = { mana: 10000, defense: 100000, attack: 100000, hp: 600000, speed: 6000 };
  const mainStat = mainStats[type] || "attack";
  return {
    name: names[type] || "极品致命装备",
    mainStat,
    mainValue: mainValues[mainStat] || 100000
  };
}

function isTripleCritEquipment(item) {
  return String(item?.id || "").startsWith("triple_crit_") || String(item?.name || "").includes("极品致命");
}

function normalizeEquipmentItem(item, account = "", anomalies = []) {
  if (!item || typeof item !== "object") {
    anomalies.push({ reason: "bad_equipment_object" });
    return null;
  }
  if (item.kind === "fashion" || item.type === "fashion") return normalizeFashionItem(item, anomalies);
  const type = String(item.type || "");
  const base = equipmentForgeStats[type];
  const demon = demonWeaponCatalog.find((entry) => entry.id === type);
  if (!base && !demon) {
    anomalies.push({ id: item.id || "", reason: "unknown_equipment_type", type });
    return null;
  }
  const id = String(item.id || `${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`).slice(0, 96);
  if (demon) {
    const expected = {
      id,
      type,
      kind: "equipment",
      name: item.name && String(item.name).includes(demon.name) ? String(item.name).slice(0, 64) : `${demon.name} +15`,
      baseName: demon.name,
      icon: demon.icon,
      forgeLevel: 15,
      maxForgeLevel: 15,
      mainStat: "",
      mainValue: 0,
      affixes: [],
      fixedStats: { ...demon.stats },
      breakStatLimit: true,
      createdAt: item.createdAt || new Date().toISOString()
    };
    if (JSON.stringify({ ...item, equipped: undefined }) !== JSON.stringify({ ...expected, equipped: undefined })) {
      anomalies.push({ id, reason: "demon_weapon_rewritten", type });
    }
    return expected;
  }
  const forgeLevel = clampStat(item.forgeLevel, 0, Number(item.maxForgeLevel) || 15);
  const maxForgeLevel = clampStat(item.maxForgeLevel || 15, 0, 15);
  if (isTripleCritEquipment(item)) {
    const config = tripleCritEquipmentConfig(type);
    const percentAffix = (Array.isArray(item.affixes) ? item.affixes : []).find((affix) => affix?.kind === "percent");
    return {
      id,
      type,
      kind: "equipment",
      name: config.name,
      icon: equipmentIconForType(type),
      forgeLevel: 15,
      maxForgeLevel: 15,
      mainStat: config.mainStat,
      mainValue: config.mainValue,
      affixes: [
        { stat: "crit", label: "致命", value: 15, kind: "flat" },
        { stat: "crit", label: "致命", value: 15, kind: "flat" },
        { stat: "crit", label: "致命", value: 15, kind: "flat" },
        sanitizeAffix(percentAffix || sample(equipmentPercentAffixPool), id)
      ],
      createdAt: item.createdAt || new Date().toISOString()
    };
  }
  const rawAffixes = Array.isArray(item.affixes) ? item.affixes.slice(0, 4) : [];
  const affixes = rawAffixes.map((affix) => sanitizeAffix(affix, id));
  if (rawAffixes.length !== (item.affixes || []).length) anomalies.push({ id, reason: "too_many_affixes", type });
  const expectedMainValue = Math.round(base.perLevel * forgeLevel);
  if (
    item.mainStat !== base.stat
    || Math.round(Number(item.mainValue) || 0) !== expectedMainValue
    || item.breakStatLimit
    || item.fixedStats
  ) {
    anomalies.push({ id, reason: "equipment_stats_rewritten", type });
  }
  return {
    id,
    type,
    kind: "equipment",
    name: String(item.name || `${base.name}+${forgeLevel}`).slice(0, 64).replace(/\+\d+$/, `+${forgeLevel}`),
    icon: base.icon,
    forgeLevel,
    maxForgeLevel,
    mainStat: base.stat,
    mainValue: expectedMainValue,
    affixes,
    damaged: Boolean(item.damaged),
    createdAt: item.createdAt || new Date().toISOString()
  };
}

function normalizeFashionItem(item, anomalies = []) {
  const id = String(item?.id || "");
  const baseId = String(item?.baseId || id);
  const catalog = fashionCatalog.find((entry) => entry.id === baseId);
  if (!catalog) {
    anomalies.push({ id, baseId, reason: "unknown_fashion_preserved" });
    return {
      id: id || `fashion_unknown_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      baseId,
      type: "fashion",
      kind: "fashion",
      name: String(item?.name || "未知时装").slice(0, 64),
      spriteId: Number(item?.spriteId) || 0,
      gender: String(item?.gender || "通用").slice(0, 8),
      icon: item?.icon || "2.10",
      createdAt: item?.createdAt || new Date().toISOString()
    };
  }
  return {
    id: id || `${catalog.id}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    baseId: catalog.id,
    type: "fashion",
    kind: "fashion",
    name: catalog.name,
    spriteId: catalog.spriteId,
    gender: catalog.gender,
    icon: catalog.icon,
    createdAt: item.createdAt || new Date().toISOString()
  };
}

function normalizeEquipmentList(raw, account = "") {
  const anomalies = [];
  const seen = new Set();
  const seenFashionBase = new Set();
  const equipment = [];
  safeJsonArray(raw).forEach((item) => {
    const normalized = normalizeEquipmentItem(item, account, anomalies);
    if (!normalized) return;
    if (seen.has(normalized.id)) {
      anomalies.push({ id: normalized.id, reason: "duplicate_equipment_id" });
      return;
    }
    if (normalized.kind === "fashion" || normalized.type === "fashion") {
      const baseId = String(normalized.baseId || normalized.id || "");
      if (baseId && seenFashionBase.has(baseId)) {
        anomalies.push({ id: normalized.id, baseId, reason: "duplicate_fashion_base" });
        return;
      }
      if (baseId) seenFashionBase.add(baseId);
    }
    seen.add(normalized.id);
    equipment.push(normalized);
  });
  return { equipment, anomalies };
}

function scanAnomalies(repair = false) {
  const rows = db.prepare(`
    SELECT players.*, accounts.banned_at, accounts.ban_reason
    FROM players
    LEFT JOIN accounts ON accounts.account = players.owner_account
  `).all();
  const issues = [];
  rows.forEach((row) => {
    const progressIssues = progressAnomalies(row);
    if (progressIssues.length) {
      issues.push({ account: row.account, type: "progress_invalid", severity: 2, details: progressIssues });
      recordAnomaly(row.account, "progress_invalid", { anomalies: progressIssues }, 2, repair ? "repair" : "scan");
    }
    const normalized = normalizeEquipmentList(row.equipment_json, row.account);
    const equippedAnomalies = [];
    normalizeEquippedMap(row.equipped_json, normalized.equipment, equippedAnomalies);
    const equipmentIssues = [...normalized.anomalies, ...equippedAnomalies];
    if (equipmentIssues.length) {
      issues.push({ account: row.account, type: "equipment_invalid", severity: 2, details: equipmentIssues });
      recordAnomaly(row.account, "equipment_invalid", { anomalies: equipmentIssues }, 2, repair ? "repair" : "scan");
      if (repair) sanitizeStoredEquipment(row.account, row);
    }
  });
  return { issueCount: issues.length, issues };
}

function restoreFashionFromAnomalyLog() {
  const rows = db.prepare(`
    SELECT account, detail_json
    FROM account_anomalies
    WHERE type IN ('equipment_invalid', 'equipment_sanitized')
    ORDER BY id ASC
  `).all();
  const restoredByAccount = new Map();
  rows.forEach((row) => {
    const details = safeJsonObject(row.detail_json);
    const anomalies = Array.isArray(details.anomalies) ? details.anomalies : [];
    anomalies.forEach((entry) => {
      if (entry?.reason !== "unknown_fashion" || !entry.id) return;
      const baseId = String(entry.id).replace(/_\d+_[0-9a-f]+$/i, "");
      const catalog = fashionCatalog.find((item) => item.id === baseId);
      if (!catalog) return;
      const list = restoredByAccount.get(row.account) || [];
      list.push({
        id: String(entry.id),
        baseId: catalog.id,
        type: "fashion",
        kind: "fashion",
        name: catalog.name,
        spriteId: catalog.spriteId,
        gender: catalog.gender,
        icon: catalog.icon,
        createdAt: new Date().toISOString()
      });
      restoredByAccount.set(row.account, list);
    });
  });
  restoredByAccount.forEach((items, account) => {
    const row = db.prepare("SELECT equipment_json FROM players WHERE account = ?").get(account);
    if (!row) return;
    const equipment = safeJsonArray(row.equipment_json);
    const existing = new Set(equipment.map((item) => item.id));
    const missing = items.filter((item) => !existing.has(item.id));
    if (!missing.length) return;
    db.prepare("UPDATE players SET equipment_json = ?, updated_at = ? WHERE account = ?")
      .run(JSON.stringify([...equipment, ...missing]), new Date().toISOString(), account);
    recordAnomaly(account, "fashion_restored", { count: missing.length, ids: missing.map((item) => item.id) }, 1, "restore");
  });
}

function normalizeEquippedMap(rawEquipped, equipment, anomalies = []) {
  const ownedById = new Map(equipment.map((item) => [item.id, item]));
  const equipped = {};
  Object.entries(safeJsonObject(rawEquipped)).forEach(([slot, id]) => {
    const item = ownedById.get(String(id || ""));
    if (!item || !equipmentSlots[slot]?.includes(item.type)) {
      anomalies.push({ slot, id, reason: "invalid_equipped_slot" });
      return;
    }
    equipped[slot] = item.id;
  });
  return equipped;
}

function sanitizeStoredEquipment(account, row) {
  if (!row) return { row, anomalies: [] };
  const normalized = normalizeEquipmentList(row.equipment_json, account);
  const equippedAnomalies = [];
  const equipped = normalizeEquippedMap(row.equipped_json, normalized.equipment, equippedAnomalies);
  const equipmentJson = JSON.stringify(normalized.equipment);
  const equippedJson = JSON.stringify(equipped);
  const anomalies = [...normalized.anomalies, ...equippedAnomalies];
  if (equipmentJson !== (row.equipment_json || "[]") || equippedJson !== (row.equipped_json || "{}")) {
    db.prepare("UPDATE players SET equipment_json = ?, equipped_json = ?, updated_at = ? WHERE account = ?")
      .run(equipmentJson, equippedJson, new Date().toISOString(), account);
  }
  if (anomalies.length) recordAnomaly(account, "equipment_sanitized", { anomalies }, 2, "repair");
  return { row: { ...row, equipment_json: equipmentJson, equipped_json: equippedJson }, anomalies };
}

function classBaseStats(className, level = 1, dragonSoul = 0) {
  const growth = growthConfigRuntime.characterGrowth();
  const dragonSoulStats = dragonSoulRuntime.statsAt(dragonSoul);
  const stats = {};
  Object.keys(STAT_LIMITS).forEach((stat) => {
    stats[stat] = growthValue(growth[stat], level) + (dragonSoulStats[stat] || 0);
  });
  return stats;
}

function mergeStats(base, bonus = {}, clamp = true) {
  const statValue = (stat) => {
    const value = (base[stat] || 0) + (bonus[stat] || 0);
    return clamp ? clampStat(value, STAT_MINIMUMS[stat] || 0, STAT_LIMITS[stat]) : Math.round(value);
  };
  const skillId = bonus.skillId || base.skillId || "shining_strike";
  return {
    hp: statValue("hp"),
    defense: statValue("defense"),
    speed: statValue("speed"),
    attack: statValue("attack"),
    mana: statValue("mana"),
    energy: statValue("energy"),
    hit: statValue("hit"),
    dodge: statValue("dodge"),
    crit: statValue("crit"),
    critDamage: statValue("critDamage"),
    antiCritDamage: statValue("antiCritDamage"),
    confuseResist: statValue("confuseResist"),
    sealResist: statValue("sealResist"),
    paralyzeResist: statValue("paralyzeResist"),
    curseResist: statValue("curseResist"),
    sleepResist: statValue("sleepResist"),
    skillId,
    skillIds: [...new Set(["shining_strike", ...(base.skillIds || []), ...(bonus.skillIds || []), skillId].filter(Boolean))],
    forceBasicAttack: bonus.forceBasicAttack || base.forceBasicAttack || false,
    power: bonus.power || base.power || 1.2,
    manaScale: bonus.manaScale || base.manaScale || 0.3
  };
}

function statsForPlayerRow(row, options = {}) {
  const selection = safeJsonObject(row.selection_json);
  const normalizedSelection = careerTree.normalizeSelection(selection);
  const className = adminRoleCatalog[normalizedSelection.className] ? normalizedSelection.className : careerTree.INITIAL_CLASS;
  const sub = subStatBonus[normalizedSelection.sub] ? normalizedSelection.sub : careerTree.INITIAL_SUB;
  let stats = mergeStats(classBaseStats(className, row.level || 1, row.dragon_soul || 1), {
    ...subStatBonus[sub],
    skillIds: [...(roleSkillIds[className] || []), ...safeJsonArray(row.role_extra_skills_json)]
  });
  if (immortalCultivationRuntime) {
    stats = mergeStats(stats, immortalCultivationRuntime.statsFromData(row.immortal_cultivation_json), false);
  }
  return applyEquipmentStatsToStats(stats, row, options);
}

function statsForPetRow(row, petId) {
  const petProgress = petProgressForRow(row, petId);
  const petGrowthConfig = growthConfigRuntime.petGrowth();
  const stats = {};
  Object.keys(STAT_LIMITS).forEach((stat) => {
    stats[stat] = growthValue(petGrowthConfig[stat], petProgress.level);
  });
  const normalizedPetId = normalizePetId(petId);
  const skillId = petSkillIds[normalizedPetId] || petGrowth.skillId;
  const extraSkills = safeJsonObject(row?.pet_extra_skills_json);
  const extra = extraSkills[String(normalizedPetId)] || extraSkills[normalizedPetId] || [];
  const innate = petInnateSkillIds[normalizedPetId] || petInnateSkillIds[String(normalizedPetId)] || [];
  const petStickers = stickerModule.normalizePetStickers(safeJsonObject(row?.pet_stickers_json))[String(normalizedPetId)] || [];
  const stickerPercent = stickerModule.petStickerStats(petStickers);
  Object.entries(stickerPercent).forEach(([stat, percent]) => {
    stats[stat] = Math.round((stats[stat] || 0) * (1 + (Number(percent) || 0) / 100));
  });
  if (activeMercenaryRowHasHolySkill(row, "holy_zeus_field")) applyZeusFieldPanelStats(stats);
  return mergeStats(stats, { skillId, skillIds: [...innate, ...(Array.isArray(extra) ? extra : [])] }, false);
}

function activeMercenaryForRow(row) {
  const activeId = String(row?.active_mercenary_id || "");
  if (!activeId) return null;
  return safeJsonArray(row?.mercenaries_json).find((mercenary) => mercenary?.id === activeId) || null;
}

function mercenaryHolySkillsForRow(mercenary) {
  return [
    ...(Array.isArray(mercenary?.passiveSkills) ? mercenary.passiveSkills : []),
    ...(Array.isArray(mercenary?.extraSkills) ? mercenary.extraSkills : [])
  ].filter((id) => mercenaryHolySkillIds.has(id));
}

function activeMercenaryRowHasHolySkill(row, skillId) {
  return mercenaryHolySkillsForRow(activeMercenaryForRow(row)).includes(skillId);
}

function applyZeusFieldPanelStats(stats) {
  ["hp", "attack", "defense", "mana", "speed"].forEach((stat) => {
    stats[stat] = Math.round((stats[stat] || 0) * 1.3);
  });
  return stats;
}

function mercenaryNecklaceForRow(row, mercenary) {
  if (!mercenary?.necklaceId) return null;
  return safeJsonArray(row?.mercenary_necklaces_json).find((item) => item.id === mercenary.necklaceId) || null;
}

function statsForMercenaryRow(row, mercenary) {
  const config = mercenaryTypes[mercenary?.type] || mercenaryTypes.sword;
  const level = Math.max(1, Math.min(100, Number(mercenary?.level) || 100));
  const factor = growthConfigRuntime.mercenaryFactor(level);
  const stats = {};
  Object.entries(growthConfigRuntime.mercenaryBaseStats()).forEach(([stat, value]) => {
    stats[stat] = Math.round(value * factor);
  });
  const necklace = mercenaryNecklaceForRow(row, mercenary);
  const orbIds = new Set(necklace?.orbIds || []);
  safeJsonArray(row?.mercenary_orbs_json).filter((orb) => orbIds.has(orb.id)).forEach((orb) => {
    (orb.stats || []).forEach((entry) => {
      stats[entry.stat] = (stats[entry.stat] || 0) + (Number(entry.value) || 0);
    });
  });
  const learnedSkillIds = mercenaryHolySkillsForRow(mercenary);
  if (learnedSkillIds.includes("holy_zeus_field")) applyZeusFieldPanelStats(stats);
  const skillIds = [config.skillId, ...new Set(learnedSkillIds)];
  return {
    ...stats,
    skillId: config.skillId,
    skillIds,
    forceBasicAttack: false,
    power: 1,
    manaScale: 0
  };
}

function activePetIdForRow(row, clientMirror = null) {
  const selection = safeJsonObject(row?.selection_json);
  const selectedPetId = normalizePetId(selection.petId || 0);
  const owned = new Set([selectedPetId, ...safeJsonArray(row?.owned_pets_json).map(normalizePetId)].filter(Boolean));
  const clientPetId = normalizePetId(clientMirror?.pet?.spriteId || 0);
  if (clientPetId && owned.has(clientPetId)) return clientPetId;
  return selectedPetId || [...owned][0] || 0;
}

function arenaMirrorForPlayerRow(row, clientMirror = null) {
  const selection = safeJsonObject(row?.selection_json);
  const petId = activePetIdForRow(row, clientMirror);
  const mercenary = activeMercenaryForRow(row);
  const mercenaryConfig = mercenaryTypes[mercenary?.type] || mercenaryTypes.sword;
  return {
    actor: {
      name: String(row?.name || row?.account || "玩家").slice(0, 24),
      spriteId: Number(clientMirror?.actor?.spriteId) || 895,
      stats: statsForPlayerRow(row, { repairEquipment: false })
    },
    pet: petId ? {
      name: String(clientMirror?.pet?.name || "宠物").slice(0, 24),
      spriteId: petId,
      stats: statsForPetRow(row, petId)
    } : null,
    mercenary: mercenary ? {
      id: String(mercenary.id || ""),
      type: String(mercenary.type || ""),
      name: String(mercenary.name || mercenaryConfig.name || "佣兵").slice(0, 24),
      spriteId: Number(mercenary.spriteId) || mercenaryConfig.spriteId || 869,
      passiveSkills: Array.isArray(mercenary.passiveSkills) ? mercenary.passiveSkills : [],
      extraSkills: Array.isArray(mercenary.extraSkills) ? mercenary.extraSkills : [],
      stats: statsForMercenaryRow(row, mercenary)
    } : null,
    selection
  };
}

function combatPowerForStats(stats) {
  return Math.round(
    (stats.hp || 0) / 10
    + (stats.defense || 0) * 2
    + (stats.attack || 0) * 3
    + (stats.speed || 0) * 8
    + (stats.mana || 0) * 2
    + (stats.crit || 0) * 2500
    + (stats.critDamage || 0) * 250
  );
}

function normalizedEquipmentRow(row, repair = true) {
  if (repair) return sanitizeStoredEquipment(row.account, row).row;
  const normalized = normalizeEquipmentList(row.equipment_json, row.account);
  const equipped = normalizeEquippedMap(row.equipped_json, normalized.equipment, []);
  return {
    ...row,
    equipment_json: JSON.stringify(normalized.equipment),
    equipped_json: JSON.stringify(equipped)
  };
}

function applyEquipmentStatsToStats(stats, row, options = {}) {
  const cleanRow = normalizedEquipmentRow(row, options.repairEquipment !== false);
  const equipment = safeJsonArray(cleanRow.equipment_json);
  const equippedIds = new Set(Object.values(safeJsonObject(cleanRow.equipped_json)));
  const equippedItems = equipment.filter((item) => equippedIds.has(item.id));
  const flat = {};
  const percent = {};
  let hasFashion = false;
  let breakStatLimit = false;
  equippedItems.forEach((item) => {
    if (item.kind === "fashion" || item.type === "fashion") {
      hasFashion = true;
      return;
    }
    if (item.breakStatLimit) breakStatLimit = true;
    if (item.mainStat) flat[item.mainStat] = (flat[item.mainStat] || 0) + (Number(item.mainValue) || 0);
    Object.entries(item.fixedStats || {}).forEach(([stat, value]) => {
      flat[stat] = (flat[stat] || 0) + (Number(value) || 0);
    });
    (item.affixes || []).forEach((affix) => {
      if (affix.kind === "percent") percent[affix.stat] = (percent[affix.stat] || 0) + (Number(affix.percent) || 0);
      else flat[affix.stat] = (flat[affix.stat] || 0) + (Number(affix.value) || 0);
    });
  });
  const next = { ...stats };
  Object.keys(STAT_LIMITS).forEach((stat) => {
    const limit = breakStatLimit ? Number.POSITIVE_INFINITY : STAT_LIMITS[stat];
    next[stat] = clampStat(((next[stat] || 0) + (flat[stat] || 0)) * (1 + (percent[stat] || 0)), 0, limit);
  });
  if (hasFashion) {
    Object.keys(STAT_LIMITS).forEach((stat) => {
      const limit = breakStatLimit ? Number.POSITIVE_INFINITY : STAT_LIMITS[stat];
      next[stat] = clampStat((next[stat] || 0) * 1.3, STAT_MINIMUMS[stat] || 0, limit);
    });
  }
  const titleBoost = phantomTitleBoost(row.equipped_title || "");
  if (titleBoost) {
    Object.keys(STAT_LIMITS).forEach((stat) => {
      const limit = breakStatLimit ? Number.POSITIVE_INFINITY : STAT_LIMITS[stat];
      next[stat] = clampStat((next[stat] || 0) * (1 + titleBoost), STAT_MINIMUMS[stat] || 0, limit);
    });
  }
  return next;
}

function equipmentIconForType(type) {
  return {
    hat: "1.27",
    armor: "1.4",
    pants: "1.30",
    belt: "1.7",
    shoes: "1.33",
    firearm: "1.39",
    sword: "1.3",
    staff: "1.36",
    demon_firearm: "1.39",
    demon_staff: "1.36",
    demon_sword: "1.3"
  }[type] || "2.18";
}

function forgeSuccessRate(targetLevel) {
  return [0, 1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4, 0.32, 0.25, 0.18, 0.12, 0.08, 0.05][targetLevel] || 0.05;
}

function itemColumnForId(id) {
  if (id === "silver" || id === "yuanbao") return id;
  if (id === "forge_gem") return "forge_gem";
  if (id === "soul_powder") return "soul_powder";
  if (id === "immortal_pill") return "immortal_pill";
  if (id === "mysterious_paint") return "mysterious_paint";
  if (id === "elf_waist_bag") return "elf_waist_bag";
  const card = skillCardItems.find((item) => item.id === id);
  if (card) return card.column;
  return fragmentItems.find((item) => item.id === id)?.column || "";
}

const redeemCodeRuntime = createRedeemCodeRuntime({
  db,
  itemColumnForId,
  titleReward: { id: "phantom_title_first_7d", title: phantomTitleForRank(1), durationMs: PHANTOM_TITLE_DURATION_MS }
});
const forgeRuntime = createForgeRuntime({ db, normalizeEquipmentList, safeJsonObject, forgeSuccessRate, equipmentIconForType });
const rewardTicketRuntime = createRewardTicketRuntime({ db });
const encounterRuntime = createEncounterRuntime({
  sendSocketJson,
  recordAnomaly
});

function isUntradeableItemId(id) {
  return id === "phantom_fragment" || Boolean(luckyBoxItemMeta(id));
}

function fragmentById(id) {
  return fragmentItems.find((item) => item.id === id) || null;
}

function fragmentByColumn(column) {
  return fragmentItems.find((item) => item.column === column) || null;
}

function fragmentName(id) {
  return fragmentById(id)?.name || id;
}

function equipmentSellPrice(item) {
  const forgeLevel = Math.max(0, Number(item.forgeLevel) || 0);
  const affixCount = Array.isArray(item.affixes) ? item.affixes.length : 0;
  return Math.max(100, Math.round(400 + forgeLevel * 180 + affixCount * 80));
}

function materialSellPrice(id) {
  if (id === "forge_gem") return 120;
  if (id === "soul_powder") return 20;
  if (id === "immortal_pill") return 200;
  if (id === "mysterious_paint") return 1000;
  if (fragmentById(id)) return 1;
  if (id === "fashion_ticket") return 1000;
  if (id === "peerless_holy_weapon_ticket") return 1000;
  return 10;
}

function materialItemMeta(id) {
  if (id === "soul_powder") return { id, name: "灵魂粉末", icon: "1.11" };
  if (id === "forge_gem") return { id, name: "锻造宝石", icon: "1.13" };
  if (id === "immortal_pill") return { id, name: "仙丹", icon: "1.49" };
  if (id === "mysterious_paint") return { id, name: "神秘颜料", icon: "2.8" };
  const fragment = fragmentById(id);
  if (fragment) return { id, name: fragmentName(id), icon: fragment.icon };
  const card = skillCardItems.find((item) => item.id === id);
  if (card) return { id, name: card.name, icon: card.icon, skillId: card.skillId || "" };
  return { id, name: id, icon: "2.8" };
}

function luckyBoxItemMeta(id) {
  const item = luckyBoxModule.rewards.find((entry) => entry.id === id);
  return item ? { id: item.id, name: item.name, icon: item.icon, value: item.value, probability: item.probability, source: "lucky_box" } : null;
}

function phantomTitleForRank(rank) {
  const value = Math.max(1, Math.min(50, Number(rank) || 0));
  return value ? `幻影狩猎者（${value}）` : "";
}

function phantomTitleBoost(title = "") {
  const rank = Number(String(title).match(/幻影狩猎者（(\d+)）/)?.[1] || 0);
  return rank >= 1 && rank <= 50 ? (51 - rank) / 100 : 0;
}

const PHANTOM_TITLE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeClaimedTitles(raw, now = Date.now()) {
  return safeJsonArray(raw)
    .map((entry) => {
      if (typeof entry === "string") {
        return { title: entry, claimedAt: new Date(now).toISOString(), expiresAt: new Date(now + PHANTOM_TITLE_DURATION_MS).toISOString() };
      }
      const title = String(entry?.title || "").trim();
      if (!title) return null;
      const claimedAt = entry.claimedAt || new Date(now).toISOString();
      const expiresAt = entry.expiresAt || new Date(Date.parse(claimedAt) + PHANTOM_TITLE_DURATION_MS).toISOString();
      return { title, claimedAt, expiresAt };
    })
    .filter((entry) => entry && Date.parse(entry.expiresAt) > now);
}

function claimedTitleNames(entries) {
  return entries.map((entry) => entry.title);
}

function phantomRankingRows(limit = 50, serverId = DEFAULT_SERVER_ID) {
  const rows = db.prepare("SELECT account, name, points, updated_at FROM phantom_rankings WHERE server_id = ? ORDER BY points DESC, updated_at ASC LIMIT ?").all(serverId, limit);
  return rows.map((row, index) => ({
    rank: index + 1,
    account: row.account,
    name: row.name,
    points: row.points || 0,
    title: phantomTitleForRank(index + 1),
    boost: phantomTitleBoost(phantomTitleForRank(index + 1))
  }));
}

function makeDemonWeapon(type) {
  const config = demonWeaponCatalog.find((item) => item.id === type);
  if (!config) return null;
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type,
    kind: "equipment",
    name: `${config.name} +15`,
    baseName: config.name,
    icon: config.icon,
    forgeLevel: 15,
    maxForgeLevel: 15,
    mainStat: "",
    mainValue: 0,
    affixes: [],
    fixedStats: { ...config.stats },
    breakStatLimit: true,
    createdAt: new Date().toISOString()
  };
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sample(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function makeTripleCritEquipment() {
  const types = ["hat", "armor", "pants", "belt", "shoes", "firearm", "sword", "staff"];
  const type = sample(types);
  const config = tripleCritEquipmentConfig(type);
  return {
    id: `triple_crit_${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type,
    kind: "equipment",
    name: config.name,
    icon: equipmentIconForType(type),
    forgeLevel: 15,
    maxForgeLevel: 15,
    mainStat: config.mainStat,
    mainValue: config.mainValue,
    affixes: [
      { stat: "crit", label: "致命", value: 15, kind: "flat" },
      { stat: "crit", label: "致命", value: 15, kind: "flat" },
      { stat: "crit", label: "致命", value: 15, kind: "flat" },
      { ...sample(equipmentPercentAffixPool), kind: "percent" }
    ],
    createdAt: new Date().toISOString()
  };
}

function generateDroppedEquipment(monsterLevel = 1) {
  const keys = Object.keys(equipmentForgeStats);
  const type = sample(keys);
  const base = equipmentForgeStats[type];
  const forgeLevel = clampStat(Math.floor(monsterLevel / 12) + randomInt(0, 2), 0, 15);
  const affixes = Array.from({ length: 3 }, () => ({ ...sample(equipmentAffixPool), kind: "flat" }));
  affixes.push({ ...sample(equipmentPercentAffixPool), kind: "percent" });
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    kind: "equipment",
    name: `${base.name}+${forgeLevel}`,
    icon: base.icon,
    forgeLevel,
    maxForgeLevel: 15,
    mainStat: base.stat,
    mainValue: Math.round(base.perLevel * forgeLevel),
    affixes,
    createdAt: new Date().toISOString()
  };
}

function rollWildBattleReward(monsterId, monsterCount = 1) {
  const monster = wildMonsterRewards[String(monsterId || "")];
  if (!monster) return null;
  const count = Math.max(1, Math.min(9, Math.floor(Number(monsterCount) || 1)));
  let forgeGem = 0;
  let equipmentCount = 0;
  const fragments = [];
  for (let i = 0; i < count; i += 1) {
    if (Math.random() < monster.forgeGemChance) forgeGem += randomInt(monster.forgeGem[0], monster.forgeGem[1]);
    if (Math.random() < monster.equipmentChance) equipmentCount += 1;
    for (const fragment of monster.fragments || []) {
      const item = fragmentById(fragment.id);
      if (!item || Math.random() >= fragment.chance) continue;
      const quantity = randomInt(fragment.amount[0], fragment.amount[1]);
      const existing = fragments.find((entry) => entry.id === item.id);
      if (existing) {
        existing.quantity += quantity;
      } else {
        fragments.push({ id: item.id, name: item.name, icon: item.icon, quantity });
      }
    }
  }
  return {
    monsterId: String(monsterId || ""),
    monsterLevel: monster.level,
    count,
    exp: monster.exp * count,
    petExp: monster.exp * count,
    mercenaryExp: monster.exp * count,
    forgeGem,
    equipmentCount,
    fragments
  };
}

function luckyBoxRoll() {
  return luckyBoxModule.roll();
}

function aggregateRewardItems(items) {
  const byId = new Map();
  items.forEach((item) => {
    const id = String(item.id || "");
    if (!id) return;
    const existing = byId.get(id) || { id, quantity: 0 };
    existing.quantity += Math.max(1, Number(item.quantity) || 1);
    byId.set(id, existing);
  });
  return [...byId.values()].map((item) => ({ ...materialItemMeta(item.id), quantity: item.quantity }));
}

function rollElfKingVaultRewards(stage) {
  const profile = elfKingVault.rewardProfiles[stage.stage] || elfKingVault.rewardProfiles[1];
  const rawItems = [];
  const rollCount = Math.max(1, Number(profile.rolls) || 1);
  for (let index = 0; index < rollCount; index += 1) {
    const pool = Math.random() < 0.5 ? elfKingVault.rewardPools.tickets : elfKingVault.rewardPools.skillCards;
    rawItems.push({ id: sample(pool), quantity: 1 });
  }
  if (Math.random() < (Number(profile.bonusChance) || 0)) {
    rawItems.push({ id: sample(elfKingVault.rewardPools.skillCards), quantity: 1 });
  }
  const paintRange = profile.paint || [1, 1];
  rawItems.push({ id: "mysterious_paint", quantity: randomInt(paintRange[0], paintRange[1]) });
  return aggregateRewardItems(rawItems);
}

function grantElfKingVaultTitle(row, stage, updatedAt) {
  const profile = elfKingVault.rewardProfiles[stage.stage] || {};
  if (!profile.phantomTitleChance || Math.random() >= profile.phantomTitleChance) return null;
  const now = Date.now();
  const title = phantomTitleForRank(1);
  const claimedEntries = normalizeClaimedTitles(row.claimed_titles_json, now);
  const existing = claimedEntries.find((entry) => entry.title === title);
  const extensionStart = Math.max(now, existing ? Date.parse(existing.expiresAt) || now : now);
  const titleEntry = {
    title,
    claimedAt: existing?.claimedAt || updatedAt,
    expiresAt: new Date(extensionStart + 24 * 60 * 60 * 1000).toISOString()
  };
  if (existing) {
    existing.expiresAt = titleEntry.expiresAt;
  } else {
    claimedEntries.push(titleEntry);
  }
  return {
    entry: titleEntry,
    claimedEntries
  };
}

function playerBagItems(row) {
  if (row?.account) row = sanitizeStoredEquipment(row.account, row).row;
  const equipped = safeJsonObject(row?.equipped_json);
  const items = [];
  const soulPowder = row?.soul_powder || 0;
  const forgeGem = row?.forge_gem || 0;
  const immortalPill = row?.immortal_pill || 0;
  const mysteriousPaint = row?.mysterious_paint || 0;
  const luckyBox = row?.lucky_box || 0;
  const elfWaistBag = row?.elf_waist_bag || 0;
  const luckyBoxItems = safeJsonObject(row?.lucky_box_items_json);
  if (soulPowder > 0) items.push({ id: "soul_powder", name: "灵魂粉末", icon: "1.11", quantity: soulPowder });
  if (forgeGem > 0) items.push({ id: "forge_gem", name: "锻造宝石", icon: "1.13", quantity: forgeGem });
  if (immortalPill > 0) items.push({ id: "immortal_pill", name: "仙丹", icon: "1.49", quantity: immortalPill });
  if (mysteriousPaint > 0) items.push({ id: "mysterious_paint", name: "神秘颜料", icon: "2.8", quantity: mysteriousPaint });
  if (luckyBox > 0) items.push({ id: "lucky_box", name: "好运宝箱", icon: "1.11", quantity: luckyBox });
  if (elfWaistBag > 0) items.push({ id: "elf_waist_bag", name: "精灵腰包", icon: "2.8", quantity: elfWaistBag, kind: "consumable" });
  fragmentItems.forEach((fragment) => {
    const amount = row?.[fragment.column] || 0;
    if (amount > 0) items.push({ id: fragment.id, name: fragmentName(fragment.id), icon: fragment.icon, quantity: amount });
  });
  skillCardItems.filter((item) => item.id !== luckyBoxModule.boxId).forEach((item) => {
    const amount = row?.[item.column] || 0;
    if (amount > 0) items.push({ id: item.id, name: item.name, icon: item.icon, quantity: amount, skillId: item.skillId || "" });
  });
  Object.entries(luckyBoxItems).forEach(([id, quantity]) => {
    const meta = luckyBoxItemMeta(id);
    const amount = Math.max(0, Math.floor(Number(quantity) || 0));
    if (meta && amount > 0) items.push({ ...meta, quantity: amount, kind: "item", untradeable: true });
  });
  items.push(...safeJsonArray(row?.equipment_json).map((item) => normalizeBagItem(item, equipped)));
  return items;
}

function bagCapacityForRow(row) {
  return Math.min(300, careerTree.BAG_CAPACITY + Math.max(0, Number(row?.bag_capacity_bonus) || 0));
}

function normalizeBagItem(item, equipped = {}) {
  if (item?.kind === "fashion" || item?.type === "fashion") {
    return {
      ...item,
      kind: "fashion",
      type: "fashion",
      icon: item.icon || "2.10",
      equipped: Object.values(equipped).includes(item.id)
    };
  }
  return {
    ...item,
    kind: "equipment",
    icon: item.icon || equipmentIconForType(item.type),
    equipped: Object.values(equipped).includes(item.id)
  };
}

function normalizeStorage(raw) {
  const source = safeJsonObject(raw);
  return {
    materials: source.materials && typeof source.materials === "object" ? source.materials : {},
    equipment: Array.isArray(source.equipment) ? source.equipment : []
  };
}

function storageItems(storage) {
  return [
    ...Object.entries(storage.materials || {})
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([id, quantity]) => ({ ...materialItemMeta(id), quantity: Number(quantity) || 0 })),
    ...(storage.equipment || []).map((item) => normalizeBagItem(item))
  ];
}

function storageUsedSlots(storage) {
  return Object.values(storage.materials || {}).filter((quantity) => Number(quantity) > 0).length + (storage.equipment || []).length;
}

function mercenaryState(row) {
  return {
    mercenaries: safeJsonArray(row?.mercenaries_json).map((mercenary) => ({
      ...mercenary,
      level: Number.isFinite(Number(mercenary?.level)) ? Math.max(1, Math.min(100, Math.floor(Number(mercenary.level)))) : 100,
      exp: Math.max(0, Math.floor(Number(mercenary?.exp) || 0))
    })),
    activeMercenaryId: row?.active_mercenary_id || "",
    necklaces: safeJsonArray(row?.mercenary_necklaces_json),
    orbs: safeJsonArray(row?.mercenary_orbs_json),
    craft: safeJsonObject(row?.mercenary_craft_json)
  };
}

function mercenaryPayload(row) {
  const state = mercenaryState(row);
  return {
    mercenaries: state.mercenaries,
    activeMercenaryId: state.activeMercenaryId,
    mercenaryNecklaces: state.necklaces,
    mercenaryOrbs: state.orbs,
    mercenaryCraft: state.craft,
    soulPowder: row?.soul_powder || 0
  };
}

function resetPlayerItems(account) {
  const row = db.prepare("SELECT mercenaries_json FROM players WHERE account = ?").get(account);
  if (!row) return null;
  const mercenaries = safeJsonArray(row.mercenaries_json).map((mercenary) => ({ ...mercenary, necklaceId: "" }));
  const zeroColumns = [
    "soul_powder",
    "forge_gem",
    ...fragmentItems.map((item) => item.column),
    ...skillCardItems.map((item) => item.column)
  ];
  const sets = [
    ...zeroColumns.map((column) => `${column} = 0`),
    "equipment_json = ?",
    "equipped_json = ?",
    "storage_json = ?",
    "mercenaries_json = ?",
    "mercenary_necklaces_json = ?",
    "mercenary_orbs_json = ?",
    "mercenary_craft_json = ?",
    "updated_at = ?"
  ];
  const updatedAt = new Date().toISOString();
  db.prepare(`UPDATE players SET ${sets.join(", ")} WHERE account = ?`).run(
    "[]",
    "{}",
    JSON.stringify({ materials: {}, equipment: [] }),
    JSON.stringify(mercenaries),
    "[]",
    "[]",
    "{}",
    updatedAt,
    account
  );
  return db.prepare("SELECT * FROM players WHERE account = ?").get(account);
}

function makeMercenary(type) {
  const config = mercenaryTypes[type];
  return {
    id: `merc_${type}`,
    type,
    name: config.name,
    spriteId: config.spriteId,
    level: 1,
    exp: 0,
    passiveSkills: [],
    necklaceId: "",
    createdAt: new Date().toISOString()
  };
}

function makeMercenaryNecklace(type) {
  const config = mercenaryNecklaceTypes[type];
  return {
    id: `merc_necklace_${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type,
    name: config.name,
    icon: config.icon,
    slots: config.slots,
    orbIds: [],
    equippedBy: ""
  };
}

function sampleMercenaryOrbStats(count, multiplier = 1) {
  const keys = Object.keys(mercenaryOrbStatCaps).sort(() => Math.random() - 0.5).slice(0, count);
  return keys.map((stat) => ({
    stat,
    label: mercenaryOrbStatLabels[stat],
    value: Math.round(mercenaryOrbStatCaps[stat] * multiplier)
  }));
}

function mercenaryOrbGrade(completion) {
  if (completion >= 6480) return 9;
  if (completion >= 5760) return 8;
  if (completion >= 5040) return 7;
  if (completion >= 4320) return 6;
  return 5;
}

function makeMercenaryOrb(completion, peerless = false) {
  const grade = peerless ? 9 : mercenaryOrbGrade(completion);
  const stats = peerless
    ? Object.entries(mercenaryOrbStatCaps).map(([stat, value]) => ({
      stat,
      label: mercenaryOrbStatLabels[stat],
      value
    }))
    : null;
  const gradeConfig = {
    5: { count: 1, multiplier: 0.2 },
    6: { count: 1, multiplier: 0.35 },
    7: { count: 2, multiplier: 0.5 },
    8: { count: 2, multiplier: 0.7 },
    9: { count: 3, multiplier: 1 }
  }[grade];
  return {
    id: `${peerless ? "peerless" : "normal"}_merc_orb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: peerless ? "peerless" : "normal",
    name: `${peerless ? "绝世" : ""}${grade}品佣兵宝珠`,
    icon: peerless ? "1.49" : "1.13",
    grade,
    completion,
    stats: stats || sampleMercenaryOrbStats(gradeConfig.count, gradeConfig.multiplier),
    socketedIn: "",
    createdAt: new Date().toISOString()
  };
}

function arenaFallbackMirror(rank) {
  return {
    rank,
    account: `arena_amumu_${rank}`,
    name: `阿木木${rank}`,
    mirror: {
      actor: {
        name: `阿木木${rank}`,
        spriteId: 895,
        stats: { hp: 118000, defense: 14500, speed: 1350, attack: 18500, mana: 2600, crit: 6, critDamage: 240, skillId: "wild_amumu" }
      },
      pet: null
    },
    isNpc: true,
    updatedAt: ""
  };
}

function arenaRankRowToApi(row) {
  if (!row) return null;
  const player = db.prepare("SELECT * FROM players WHERE account = ?").get(row.account);
  const savedMirror = safeJsonObject(row.mirror_json);
  return {
    rank: row.rank,
    account: row.account,
    name: player?.name || row.name,
    mirror: player ? arenaMirrorForPlayerRow(player, savedMirror) : savedMirror,
    isNpc: false,
    updatedAt: row.updated_at
  };
}

function recordArenaMirrorAnomalies(account, source, clientMirror, serverMirror) {
  if (clientMirror?.actor?.stats) {
    detectClientStatsAnomaly(account, source, clientMirror.actor.stats, serverMirror.actor.stats);
    recordAnomalyOnce(account, "client_arena_stats_ignored", { stats: clientMirror.actor.stats }, 2, "ignore");
  }
  const petDiffs = statDiffs(clientMirror?.pet?.stats, serverMirror.pet?.stats);
  if (petDiffs.length) {
    recordAnomalyOnce(account, "client_pet_stats_tamper", { source, diffs: petDiffs, clientStats: clientMirror.pet.stats, serverStats: serverMirror.pet.stats }, 2, "ignore");
  }
  const mercenaryDiffs = statDiffs(clientMirror?.mercenary?.stats, serverMirror.mercenary?.stats);
  if (mercenaryDiffs.length) {
    recordAnomalyOnce(account, "client_mercenary_stats_tamper", { source, diffs: mercenaryDiffs, clientStats: clientMirror.mercenary.stats, serverStats: serverMirror.mercenary.stats }, 2, "ignore");
  }
}

function playerRowToApi(row) {
  if (!row) return null;
  row = sanitizeStoredEquipment(row.account, row).row;
  const claimedTitleEntries = normalizeClaimedTitles(row.claimed_titles_json);
  const equippedTitle = claimedTitleNames(claimedTitleEntries).includes(row.equipped_title || "") ? row.equipped_title || "" : "";
  return {
    characterId: row.account,
    ownerAccount: row.owner_account || row.account,
    serverId: row.server_id || DEFAULT_SERVER_ID,
    characterSlot: Math.max(1, Math.min(3, Number(row.character_slot) || 1)),
    gender: row.gender || safeJsonObject(row.selection_json).gender || "",
    name: row.name,
    x: row.x,
    y: row.y,
    mapName: row.map_name,
    level: row.level || 1,
    exp: row.exp || 0,
    careerLevel: row.career_level || 1,
    careerExp: row.career_exp || 0,
    careerStage: careerTree.careerStage(safeJsonObject(row.selection_json)),
    careerName: careerTree.careerName(safeJsonObject(row.selection_json)),
    dragonSoul: Number(row.dragon_soul) || 0,
    dragonSoulState: dragonSoulRuntime.stateFromRow(row),
    petLevel: row.pet_level || 1,
    petExp: row.pet_exp || 0,
    petProgressById: petProgressMapForRow(row),
    ownedPets: safeJsonArray(row.owned_pets_json),
    petExtraSkills: safeJsonObject(row.pet_extra_skills_json),
    roleExtraSkills: safeJsonArray(row.role_extra_skills_json),
    selection: safeJsonObject(row.selection_json).className
      ? careerTree.normalizeSelection(safeJsonObject(row.selection_json))
      : {},
    friends: safeJsonArray(row.friends_json),
    silver: row.silver || 0,
    yuanbao: row.yuanbao || 0,
    luckyBoxItems: safeJsonObject(row.lucky_box_items_json),
    soulPowder: row.soul_powder || 0,
    immortalPill: row.immortal_pill || 0,
    mysteriousPaint: row.mysterious_paint || 0,
    immortalCultivation: immortalCultivationRuntime?.viewForRow(row) || null,
    forgeGem: row.forge_gem || 0,
    fragments: fragmentItems.map((item) => ({ id: item.id, name: fragmentName(item.id), icon: item.icon, quantity: row[item.column] || 0 })),
    skillCards: skillCardItems.map((item) => ({ id: item.id, name: item.name, icon: item.icon, quantity: row[item.column] || 0, skillId: item.skillId || "" })),
    equipment: safeJsonArray(row.equipment_json),
    equipped: safeJsonObject(row.equipped_json),
    storage: storageItems(normalizeStorage(row.storage_json)),
    autoStrategy: safeJsonObject(row.auto_strategy_json),
    soulPowder300At: row.soul_powder_300_at || "",
    soulPowder400At: row.soul_powder_400_at || "",
    redeemCodeClaimedAt: row.redeem_code_claimed_at || "",
    peerlessPetScrollRedeemedAt: row.peerless_pet_scroll_redeemed_at || "",
    fashionTicketRedeemedAt: row.fashion_ticket_redeemed_at || "",
    peerlessHolyWeaponRedeemedAt: row.peerless_holy_weapon_redeemed_at || "",
    peerlessRoleSkillRedeemedAt: row.peerless_role_skill_redeemed_at || "",
    phantomTitleFirstRedeemedAt: row.phantom_title_first_redeemed_at || "",
    phantomPoints: row.phantom_points || 0,
    equippedTitle,
    claimedTitles: claimedTitleNames(claimedTitleEntries),
    claimedTitleEntries,
    immortalBossRewards: safeJsonObject(row.immortal_boss_rewards_json),
    elfKingVaultProgress: safeJsonObject(row.elf_king_vault_rewards_json),
    mercenaries: mercenaryState(row).mercenaries,
    activeMercenaryId: row.active_mercenary_id || "",
    mercenaryNecklaces: safeJsonArray(row.mercenary_necklaces_json),
    mercenaryOrbs: safeJsonArray(row.mercenary_orbs_json),
    mercenaryCraft: safeJsonObject(row.mercenary_craft_json),
    stickerInventory: stickerModule.normalizeInventory(safeJsonObject(row.sticker_inventory_json)),
    petStickers: stickerModule.normalizePetStickers(safeJsonObject(row.pet_stickers_json)),
    serverStats: statsForPlayerRow(row),
    commonIp: commonIpForAccount(row.owner_account || row.account),
    bannedAt: row.banned_at || "",
    banReason: row.ban_reason || "",
    updatedAt: row.updated_at
  };
}

function publicSpriteForPlayer(selection = {}, equipped = {}, equipment = []) {
  const fashionId = equipped?.fashion || "";
  const fashion = equipment.find((item) => item.id === fashionId && (item.kind === "fashion" || item.type === "fashion"));
  if (fashion?.spriteId) return Number(fashion.spriteId) || 895;
  return careerTree.roleForSelection(selection)?.id || 54;
}

function ensureDefaultGameServer() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO game_servers (id, name, enabled, channel_count, sort_order, created_at, updated_at)
    VALUES (?, ?, 1, ?, 0, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(DEFAULT_SERVER_ID, DEFAULT_SERVER_NAME, SERVER_CHANNEL_COUNT, now, now);
}

function ensureServerScopedColumns() {
  db.prepare(`
    UPDATE players
    SET owner_account = account
    WHERE owner_account IS NULL OR owner_account = ''
  `).run();
  db.prepare(`
    UPDATE players
    SET server_id = ?
    WHERE server_id IS NULL OR server_id = ''
  `).run(DEFAULT_SERVER_ID);
  db.prepare(`
    UPDATE players
    SET character_slot = 1
    WHERE character_slot IS NULL OR character_slot < 1 OR character_slot > 3
  `).run();
  db.prepare(`
    UPDATE players
    SET gender = json_extract(selection_json, '$.gender')
    WHERE (gender IS NULL OR gender = '')
      AND json_valid(selection_json)
      AND json_extract(selection_json, '$.gender') IN ('男', '女')
  `).run();
  db.exec("CREATE INDEX IF NOT EXISTS idx_players_owner_server ON players (owner_account, server_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_players_server ON players (server_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_players_owner_server_slot ON players (owner_account, server_id, character_slot)");

  let arenaInfo = db.prepare("PRAGMA table_info(arena_rankings)").all();
  if (!arenaInfo.some((column) => column.name === "server_id")) {
    db.exec(`ALTER TABLE arena_rankings ADD COLUMN server_id TEXT NOT NULL DEFAULT '${DEFAULT_SERVER_ID}'`);
    arenaInfo = db.prepare("PRAGMA table_info(arena_rankings)").all();
  }
  const arenaServerPk = arenaInfo.find((column) => column.name === "server_id")?.pk || 0;
  const arenaRankPk = arenaInfo.find((column) => column.name === "rank")?.pk || 0;
  if (arenaServerPk !== 1 || arenaRankPk !== 2) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("ALTER TABLE arena_rankings RENAME TO arena_rankings_legacy_scope");
      db.exec(`
        CREATE TABLE arena_rankings (
          server_id TEXT NOT NULL DEFAULT '${DEFAULT_SERVER_ID}',
          rank INTEGER NOT NULL,
          account TEXT NOT NULL,
          name TEXT NOT NULL,
          mirror_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (server_id, rank),
          UNIQUE (server_id, account)
        )
      `);
      db.exec(`
        INSERT OR REPLACE INTO arena_rankings (server_id, rank, account, name, mirror_json, updated_at)
        SELECT COALESCE(NULLIF(server_id, ''), '${DEFAULT_SERVER_ID}'), rank, account, name, mirror_json, updated_at
        FROM arena_rankings_legacy_scope
      `);
      db.exec("DROP TABLE arena_rankings_legacy_scope");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  let phantomInfo = db.prepare("PRAGMA table_info(phantom_rankings)").all();
  if (!phantomInfo.some((column) => column.name === "server_id")) {
    db.exec(`ALTER TABLE phantom_rankings ADD COLUMN server_id TEXT NOT NULL DEFAULT '${DEFAULT_SERVER_ID}'`);
    phantomInfo = db.prepare("PRAGMA table_info(phantom_rankings)").all();
  }
  const phantomServerPk = phantomInfo.find((column) => column.name === "server_id")?.pk || 0;
  const phantomAccountPk = phantomInfo.find((column) => column.name === "account")?.pk || 0;
  if (phantomServerPk !== 1 || phantomAccountPk !== 2) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("ALTER TABLE phantom_rankings RENAME TO phantom_rankings_legacy_scope");
      db.exec(`
        CREATE TABLE phantom_rankings (
          server_id TEXT NOT NULL DEFAULT '${DEFAULT_SERVER_ID}',
          account TEXT NOT NULL,
          name TEXT NOT NULL,
          points INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (server_id, account)
        )
      `);
      db.exec(`
        INSERT OR REPLACE INTO phantom_rankings (server_id, account, name, points, updated_at)
        SELECT COALESCE(NULLIF(server_id, ''), '${DEFAULT_SERVER_ID}'), account, name, points, updated_at
        FROM phantom_rankings_legacy_scope
      `);
      db.exec("DROP TABLE phantom_rankings_legacy_scope");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_arena_rankings_server ON arena_rankings (server_id, rank)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_phantom_rankings_server ON phantom_rankings (server_id, points)");
}

function ensurePlayerColumns() {
  const columns = db.prepare("PRAGMA table_info(players)").all().map((column) => column.name);
  const needsCareerMigration = !columns.includes("career_level") || !columns.includes("career_exp");
  const addColumn = (name, sql) => {
    if (!columns.includes(name)) db.exec(`ALTER TABLE players ADD COLUMN ${sql}`);
  };
  addColumn("owner_account", "owner_account TEXT NOT NULL DEFAULT ''");
  addColumn("server_id", `server_id TEXT NOT NULL DEFAULT '${DEFAULT_SERVER_ID}'`);
  addColumn("character_slot", "character_slot INTEGER NOT NULL DEFAULT 1");
  addColumn("gender", "gender TEXT NOT NULL DEFAULT ''");
  addColumn("soul_powder", "soul_powder INTEGER NOT NULL DEFAULT 0");
  addColumn("level", "level INTEGER NOT NULL DEFAULT 1");
  addColumn("exp", "exp INTEGER NOT NULL DEFAULT 0");
  addColumn("career_level", "career_level INTEGER NOT NULL DEFAULT 1");
  addColumn("career_exp", "career_exp INTEGER NOT NULL DEFAULT 0");
  addColumn("dragon_soul", "dragon_soul INTEGER NOT NULL DEFAULT 1");
  addColumn("dragon_soul_exp", "dragon_soul_exp INTEGER NOT NULL DEFAULT 0");
  addColumn("dragon_soul_daily_key", "dragon_soul_daily_key TEXT NOT NULL DEFAULT ''");
  addColumn("dragon_soul_daily_used", "dragon_soul_daily_used INTEGER NOT NULL DEFAULT 0");
  addColumn("pet_level", "pet_level INTEGER NOT NULL DEFAULT 1");
  addColumn("pet_exp", "pet_exp INTEGER NOT NULL DEFAULT 0");
  addColumn("pet_progress_json", "pet_progress_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("owned_pets_json", "owned_pets_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("pet_extra_skills_json", "pet_extra_skills_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("role_extra_skills_json", "role_extra_skills_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("silver", "silver INTEGER NOT NULL DEFAULT 0");
  addColumn("yuanbao", "yuanbao INTEGER NOT NULL DEFAULT 0");
  addColumn("lucky_box_items_json", "lucky_box_items_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("reading_points", "reading_points INTEGER NOT NULL DEFAULT 0");
  addColumn("forge_gem", "forge_gem INTEGER NOT NULL DEFAULT 0");
  fragmentItems.forEach((item) => addColumn(item.column, `${item.column} INTEGER NOT NULL DEFAULT 0`));
  skillCardItems.forEach((item) => addColumn(item.column, `${item.column} INTEGER NOT NULL DEFAULT 0`));
  addColumn("equipment_json", "equipment_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("equipped_json", "equipped_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("storage_json", "storage_json TEXT NOT NULL DEFAULT '{\"materials\":{},\"equipment\":[]}'");
  addColumn("auto_strategy_json", "auto_strategy_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("selection_json", "selection_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("friends_json", "friends_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("phantom_points", "phantom_points INTEGER NOT NULL DEFAULT 0");
  addColumn("elf_waist_bag", "elf_waist_bag INTEGER NOT NULL DEFAULT 0");
  addColumn("bag_capacity_bonus", "bag_capacity_bonus INTEGER NOT NULL DEFAULT 0");
  addColumn("mysterious_paint", "mysterious_paint INTEGER NOT NULL DEFAULT 0");
  addColumn("immortal_pill", "immortal_pill INTEGER NOT NULL DEFAULT 0");
  addColumn("immortal_cultivation_json", "immortal_cultivation_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("arena_reward_claimed_key", "arena_reward_claimed_key TEXT NOT NULL DEFAULT ''");
  addColumn("equipped_title", "equipped_title TEXT NOT NULL DEFAULT ''");
  addColumn("claimed_titles_json", "claimed_titles_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("soul_powder_300_at", "soul_powder_300_at TEXT");
  addColumn("soul_powder_400_at", "soul_powder_400_at TEXT");
  addColumn("redeem_code_claimed_at", "redeem_code_claimed_at TEXT");
  addColumn("peerless_pet_scroll_redeemed_at", "peerless_pet_scroll_redeemed_at TEXT");
  addColumn("fashion_ticket_redeemed_at", "fashion_ticket_redeemed_at TEXT");
  addColumn("peerless_holy_weapon_redeemed_at", "peerless_holy_weapon_redeemed_at TEXT");
  addColumn("peerless_role_skill_redeemed_at", "peerless_role_skill_redeemed_at TEXT");
  addColumn("phantom_title_first_redeemed_at", "phantom_title_first_redeemed_at TEXT");
  addColumn("immortal_boss_rewards_json", "immortal_boss_rewards_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("elf_king_vault_rewards_json", "elf_king_vault_rewards_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("mercenaries_json", "mercenaries_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("active_mercenary_id", "active_mercenary_id TEXT NOT NULL DEFAULT ''");
  addColumn("mercenary_necklaces_json", "mercenary_necklaces_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("mercenary_orbs_json", "mercenary_orbs_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("mercenary_craft_json", "mercenary_craft_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("sticker_inventory_json", "sticker_inventory_json TEXT NOT NULL DEFAULT '{}'");
  addColumn("pet_stickers_json", "pet_stickers_json TEXT NOT NULL DEFAULT '{}'");
  if (needsCareerMigration) {
    const rows = db.prepare("SELECT account, selection_json FROM players").all();
    const updateCareer = db.prepare("UPDATE players SET selection_json = ?, career_level = ?, career_exp = 0 WHERE account = ?");
    db.exec("BEGIN");
    try {
      rows.forEach((row) => {
        const storedSelection = safeJsonObject(row.selection_json);
        if (!storedSelection.className) return;
        const selection = careerTree.normalizeSelection(storedSelection);
        const careerLevel = careerTree.careerStage(selection) >= 2 ? careerTree.SECOND_TRANSFER_CAREER_LEVEL : 1;
        updateCareer.run(JSON.stringify(selection), careerLevel, row.account);
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const accountColumns = db.prepare("PRAGMA table_info(accounts)").all().map((column) => column.name);
  const addAccountColumn = (name, sql) => {
    if (!accountColumns.includes(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${sql}`);
  };
  addAccountColumn("banned_at", "banned_at TEXT");
  addAccountColumn("ban_reason", "ban_reason TEXT NOT NULL DEFAULT ''");
}

function makeUniquePlayerName(account, requestedName, currentName = "") {
  const baseName = String(requestedName || currentName || account).trim().slice(0, 12) || account;
  const taken = db.prepare("SELECT account FROM players WHERE name = ? AND account <> ?").get(baseName, account);
  if (!taken) return baseName;
  if (currentName) return currentName;

  const accountBase = String(account).trim().slice(0, 12) || "player";
  const accountTaken = db.prepare("SELECT account FROM players WHERE name = ? AND account <> ?").get(accountBase, account);
  if (!accountTaken) return accountBase;

  for (let i = 1; i < 1000; i += 1) {
    const suffix = String(i);
    const candidate = `${accountBase.slice(0, Math.max(1, 12 - suffix.length))}${suffix}`;
    const row = db.prepare("SELECT account FROM players WHERE name = ? AND account <> ?").get(candidate, account);
    if (!row) return candidate;
  }

  return crypto.randomUUID().slice(0, 12);
}

function upsertPlayer({ account, ownerAccount, serverId, characterSlot, gender, name, x, y, mapName, level, exp, dragonSoul, petLevel, petExp, petProgressById, autoStrategy, selection, friends, activeMercenaryId }) {
  const updatedAt = new Date().toISOString();
  const current = db.prepare("SELECT owner_account, server_id, character_slot, gender, name, level, exp, dragon_soul, pet_level, pet_exp, pet_progress_json, owned_pets_json, auto_strategy_json, selection_json, friends_json, active_mercenary_id, mercenaries_json FROM players WHERE account = ?").get(account);
  const uniqueName = makeUniquePlayerName(account, name, current?.name);
  const autoStrategyJson = autoStrategy ? JSON.stringify(autoStrategy) : (current?.auto_strategy_json || "{}");
  const storedSelection = safeJsonObject(current?.selection_json);
  const hasStoredSelection = Boolean(storedSelection.className);
  const currentSelection = hasStoredSelection ? careerTree.normalizeSelection(storedSelection) : storedSelection;
  const initialSelection = selection && typeof selection === "object" && !hasStoredSelection
    ? normalizeAdminSelection(selection, currentSelection)
    : null;
  const savedSelection = initialSelection || currentSelection;
  if (selection && typeof selection === "object" && savedSelection.className) {
    const petId = normalizePetId(selection.petId);
    if (petId) savedSelection.petId = petId;
  }
  const nextPetId = normalizePetId(savedSelection.petId);
  const progressById = petProgressById && typeof petProgressById === "object"
    ? Object.fromEntries(Object.entries(petProgressById).map(([petId, progress]) => [String(normalizePetId(petId)), normalizeProgress(progress)]).filter(([petId]) => petId !== "0"))
    : petProgressMapForRow(current);
  const selectedPetProgress = progressById[String(nextPetId)] || normalizeProgress({
    level: petLevel ?? current?.pet_level,
    exp: petExp ?? current?.pet_exp
  });
  if (nextPetId) progressById[String(nextPetId)] = selectedPetProgress;
  const selectionJson = JSON.stringify(savedSelection);
  const nextOwnerAccount = String(ownerAccount || current?.owner_account || account).trim();
  const nextServerId = String(serverId || current?.server_id || DEFAULT_SERVER_ID).trim() || DEFAULT_SERVER_ID;
  const nextCharacterSlot = Math.max(1, Math.min(3, Math.floor(Number(characterSlot ?? current?.character_slot) || 1)));
  const nextGender = ["男", "女"].includes(gender) ? gender : (["男", "女"].includes(savedSelection.gender) ? savedSelection.gender : current?.gender || "");
  const friendsJson = Array.isArray(friends) ? JSON.stringify(friends) : (current?.friends_json || "[]");
  const mercenaries = safeJsonArray(current?.mercenaries_json);
  const requestedMercenaryId = activeMercenaryId == null ? current?.active_mercenary_id || "" : String(activeMercenaryId || "");
  const nextActiveMercenaryId = requestedMercenaryId && mercenaries.some((merc) => merc.id === requestedMercenaryId)
    ? requestedMercenaryId
    : "";
  db.prepare(`
    INSERT INTO players (account, owner_account, server_id, character_slot, gender, name, x, y, map_name, level, exp, dragon_soul, pet_level, pet_exp, pet_progress_json, auto_strategy_json, selection_json, friends_json, active_mercenary_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account) DO UPDATE SET
      name = excluded.name,
      x = excluded.x,
      y = excluded.y,
      map_name = excluded.map_name,
      level = excluded.level,
      exp = excluded.exp,
      dragon_soul = excluded.dragon_soul,
      pet_level = excluded.pet_level,
      pet_exp = excluded.pet_exp,
      pet_progress_json = excluded.pet_progress_json,
      auto_strategy_json = excluded.auto_strategy_json,
      selection_json = excluded.selection_json,
      friends_json = excluded.friends_json,
      active_mercenary_id = excluded.active_mercenary_id,
      gender = CASE WHEN players.gender = '' THEN excluded.gender ELSE players.gender END,
      updated_at = excluded.updated_at
  `).run(
    account,
    nextOwnerAccount,
    nextServerId,
    nextCharacterSlot,
    nextGender,
    uniqueName,
    x,
    y,
    mapName,
    Math.max(1, Math.min(100, Number(level ?? current?.level) || 1)),
    Math.max(0, Number(exp ?? current?.exp) || 0),
    Math.max(0, Math.min(70, Number(dragonSoul ?? current?.dragon_soul) || 0)),
    selectedPetProgress.level,
    selectedPetProgress.exp,
    JSON.stringify(progressById),
    autoStrategyJson,
    selectionJson,
    friendsJson,
    nextActiveMercenaryId,
    updatedAt
  );
  return db.prepare("SELECT * FROM players WHERE account = ?").get(account);
}

function migrateLegacyDb() {
  if (!fs.existsSync(legacyDbPath)) return;
  const hasRows = db.prepare("SELECT COUNT(*) AS count FROM players").get().count > 0;
  if (hasRows) return;
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyDbPath, "utf8"));
    for (const [account, player] of Object.entries(legacy.players || {})) {
      const name = String(player.name || account).trim();
      if (!account || !name) continue;
      upsertPlayer({
        account,
        ownerAccount: account,
        serverId: DEFAULT_SERVER_ID,
        characterSlot: 1,
        name,
        x: Number(player.x) || 0,
        y: Number(player.y) || 0,
        mapName: String(player.mapName || ""),
        level: Number(player.level) || 1,
        exp: Number(player.exp) || 0,
        dragonSoul: Number(player.dragonSoul) || 1,
        petLevel: Number(player.petLevel) || 1,
        petExp: Number(player.petExp) || 0
      });
    }
  } catch (error) {
    console.warn("legacy player db migration skipped:", error.message);
  }
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && (url.pathname === "/api/taozi/chat" || url.pathname === "/api/taozi/welcome")) {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    readJsonBody(req, async (data, error) => {
      if (error) return sendJson(res, 400, { ok: false, error: "invalid_json" });
      try {
        const playerName = db.prepare("SELECT name FROM players WHERE account = ?").get(account)?.name || account;
        const result = url.pathname.endsWith("/welcome")
          ? await taoziRuntime.welcome(account, playerName)
          : await taoziRuntime.chat(account, data, playerName);
        sendJson(res, result.ok ? 200 : result.status || 500, result);
      } catch {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server_error" });
      }
    });
    return;
  }
  if (req.method === "GET" && adminMapApi.handleGet(req, res, url)) return;
  if (req.method === "GET" && url.pathname === "/api/changelog") {
    const log = updateLogSetting();
    sendJson(res, 200, {
      ok: true,
      changelog: {
        title: String(log.title || "更新日志").slice(0, 40),
        content: String(log.content || "").slice(0, 20000),
        enabled: log.enabled !== false,
        version: String(log.version || "").slice(0, 64),
        updatedAt: log.updatedAt || ""
      }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/game-visual") {
    sendJson(res, 200, { ok: true, visual: gameVisualSetting() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/login-visual") {
    sendJson(res, 200, { ok: true, visual: loginVisualSetting() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/growth-config") {
    sendJson(res, 200, { ok: true, config: { ...growthConfigRuntime.getConfig(), dragonSoul: dragonSoulRuntime.getConfig() } });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/dragon-soul-config") {
    sendJson(res, 200, { ok: true, config: dragonSoulRuntime.getConfig() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/servers") {
    const rows = db.prepare(`
      SELECT * FROM game_servers
      WHERE enabled = 1
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `).all();
    sendJson(res, 200, { ok: true, channelCount: SERVER_CHANNEL_COUNT, servers: rows.map(gameServerToApi) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/characters") {
    const loginAccount = requireLoginAccount(req, res, url);
    if (!loginAccount) return;
    const serverId = String(url.searchParams.get("serverId") || DEFAULT_SERVER_ID).trim();
    const gameServer = gameServerById(serverId, true);
    if (!gameServer) {
      sendJson(res, 404, { ok: false, error: "server_not_found" });
      return;
    }
    const rows = db.prepare(`
      SELECT * FROM players
      WHERE owner_account = ? AND server_id = ?
      ORDER BY character_slot ASC, updated_at DESC
    `).all(loginAccount, serverId);
    sendJson(res, 200, {
      ok: true,
      server: gameServerToApi(gameServer),
      characters: rows.map(characterRowToSummary),
      limit: 3,
      maxCharacters: 3
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/exists") {
    const account = String(url.searchParams.get("account") || "").trim();
    if (!account) {
      sendJson(res, 400, { ok: false, error: "missing_account" });
      return;
    }
    const row = db.prepare("SELECT account FROM accounts WHERE account = ?").get(account);
    sendJson(res, 200, { ok: true, exists: Boolean(row) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/players") {
    if (!checkAdmin(req, res)) return;
    const q = String(url.searchParams.get("q") || "").trim();
    const rows = q
      ? db.prepare(`
          SELECT players.*, accounts.banned_at, accounts.ban_reason, game_servers.name AS server_name
          FROM players
          LEFT JOIN accounts ON accounts.account = players.owner_account
          LEFT JOIN game_servers ON game_servers.id = players.server_id
          WHERE players.account LIKE ? OR players.owner_account LIKE ? OR players.name LIKE ? OR game_servers.name LIKE ?
          ORDER BY players.updated_at DESC
        `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
      : db.prepare(`
          SELECT players.*, accounts.banned_at, accounts.ban_reason, game_servers.name AS server_name
          FROM players
          LEFT JOIN accounts ON accounts.account = players.owner_account
          LEFT JOIN game_servers ON game_servers.id = players.server_id
          ORDER BY players.updated_at DESC
        `).all();
    const onlineAccounts = new Set();
    for (const socket of sockets) {
      if (!socket || socket.destroyed) continue;
      const meta = socketMeta.get(socket) || {};
      const account = String(meta.account || "").trim();
      if (account) onlineAccounts.add(account);
    }
    const players = rows.map((row) => ({
      account: row.account,
      characterId: row.account,
      ownerAccount: row.owner_account || row.account,
      serverId: row.server_id || DEFAULT_SERVER_ID,
      serverName: row.server_name || "",
      characterSlot: Number(row.character_slot) || 1,
      ...playerRowToApi(row),
      online: onlineAccounts.has(row.account)
    }));
    players.sort((a, b) => Number(b.online) - Number(a.online) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    sendJson(res, 200, { ok: true, players });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/servers") {
    if (!checkAdmin(req, res)) return;
    const rows = db.prepare(`
      SELECT * FROM game_servers
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `).all();
    sendJson(res, 200, { ok: true, servers: rows.map(gameServerToApi) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/catalog") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, {
      ok: true,
      items: [
        { id: "yuanbao", name: "元宝" },
        { id: luckyBoxModule.boxId, name: luckyBoxModule.boxName },
        { id: "soul_powder", name: "灵魂粉末" },
        { id: "forge_gem", name: "锻造宝石" },
        { id: "immortal_pill", name: "仙丹" },
        { id: "mysterious_paint", name: "神秘颜料" },
        ...fragmentItems.map((item) => ({ id: item.id, name: item.name })),
        ...skillCardItems.filter((item) => item.id !== luckyBoxModule.boxId).map((item) => ({ id: item.id, name: item.name })),
        ...luckyBoxModule.rewards.map((item) => ({ id: item.id, name: item.name }))
      ]
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/changelog") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, changelog: updateLogSetting() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/game-visual") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, visual: gameVisualSetting() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/login-visual") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, visual: loginVisualSetting() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/growth-config") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, config: growthConfigRuntime.getConfig(), updatedAt: growthConfigRuntime.updatedAt() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/dragon-soul-config") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, config: dragonSoulRuntime.getConfig(), updatedAt: dragonSoulRuntime.updatedAt() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/career-progress-config") {
    if (!checkAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, config: careerProgressConfigRuntime.getConfig() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/stat-rankings") {
    if (!checkAdmin(req, res)) return;
    const allowedStats = new Set(["power", "hp", "defense", "speed", "attack", "mana", "crit", "critDamage"]);
    const stat = allowedStats.has(url.searchParams.get("stat")) ? url.searchParams.get("stat") : "power";
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
    const serverId = String(url.searchParams.get("serverId") || "").trim();
    const rows = db.prepare(`
      SELECT players.*, accounts.banned_at, accounts.ban_reason
      FROM players
      LEFT JOIN accounts ON accounts.account = players.owner_account
      WHERE (? = '' OR players.server_id = ?)
    `).all(serverId, serverId);
    const rankings = rows.map((row) => {
      const clean = sanitizeStoredEquipment(row.account, row).row;
      const equipped = safeJsonObject(clean.equipped_json);
      const equipment = safeJsonArray(clean.equipment_json).map((item) => normalizeBagItem(item, equipped));
      const selection = safeJsonObject(clean.selection_json);
      const stats = statsForPlayerRow(clean);
      const power = combatPowerForStats(stats);
      return {
        account: row.account,
        name: row.name,
        spriteId: publicSpriteForPlayer(selection, equipped, equipment),
        level: row.level || 1,
        dragonSoul: row.dragon_soul || 1,
        bannedAt: row.banned_at || "",
        banReason: row.ban_reason || "",
        stats,
        power,
        value: stat === "power" ? power : stats[stat] || 0,
        updatedAt: row.updated_at
      };
    }).sort((a, b) => b.value - a.value || b.power - a.power || String(a.account).localeCompare(String(b.account))).slice(0, limit);
    sendJson(res, 200, { ok: true, stat, rankings });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/stat-rankings") {
    const allowedStats = new Set(["power", "hp", "defense", "speed", "attack", "mana", "crit", "critDamage"]);
    const stat = allowedStats.has(url.searchParams.get("stat")) ? url.searchParams.get("stat") : "power";
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
    const serverId = serverIdFromRequest(req, url);
    const rows = db.prepare(`
      SELECT players.*, accounts.banned_at
      FROM players
      LEFT JOIN accounts ON accounts.account = players.owner_account
      WHERE players.server_id = ?
        AND (accounts.banned_at IS NULL OR accounts.banned_at = '')
    `).all(serverId);
    const rankings = rows.map((row) => {
      const stats = statsForPlayerRow(row);
      const power = combatPowerForStats(stats);
      return {
        account: row.account,
        name: row.name,
        level: row.level || 1,
        dragonSoul: row.dragon_soul || 1,
        stats,
        power,
        value: stat === "power" ? power : stats[stat] || 0,
        updatedAt: row.updated_at
      };
    }).sort((a, b) => b.value - a.value || b.power - a.power || String(a.account).localeCompare(String(b.account))).slice(0, limit);
    sendJson(res, 200, { ok: true, stat, rankings });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/anomalies") {
    if (!checkAdmin(req, res)) return;
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
    const type = String(url.searchParams.get("type") || "").trim();
    const q = String(url.searchParams.get("q") || url.searchParams.get("account") || "").trim();
    const rows = db.prepare(`
      SELECT account_anomalies.*, players.name, accounts.banned_at, accounts.ban_reason
      FROM account_anomalies
      LEFT JOIN players ON players.account = account_anomalies.account
      LEFT JOIN accounts ON accounts.account = COALESCE(NULLIF(players.owner_account, ''), account_anomalies.account)
      WHERE (? = '' OR account_anomalies.type = ?)
        AND (? = '' OR account_anomalies.account LIKE ? OR players.name LIKE ?)
      ORDER BY account_anomalies.id DESC
      LIMIT ?
    `).all(type, type, q, `%${q}%`, `%${q}%`, limit);
    const anomalies = rows.map((row) => ({
      id: row.id,
      account: row.account,
      name: row.name || "",
      type: row.type,
      severity: row.severity,
      detail: safeJsonObject(row.detail_json),
      action: row.action || "",
      createdAt: row.created_at,
      bannedAt: row.banned_at || "",
      banReason: row.ban_reason || ""
    }));
    sendJson(res, 200, { ok: true, anomalies });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/player-public") {
    const account = String(url.searchParams.get("account") || "").trim();
    const name = String(url.searchParams.get("name") || "").trim();
    const serverId = serverIdFromRequest(req, url);
    if (!account && !name) {
      sendJson(res, 400, { ok: false, error: "missing_player" });
      return;
    }
    const row = account
      ? db.prepare("SELECT * FROM players WHERE account = ? AND server_id = ?").get(account, serverId)
      : db.prepare("SELECT * FROM players WHERE name = ? AND server_id = ?").get(name, serverId);
    if (!row) {
      sendJson(res, 404, { ok: false, error: "player_not_found" });
      return;
    }
    const clean = sanitizeStoredEquipment(row.account, row).row;
    const equipped = safeJsonObject(clean.equipped_json);
    const equipment = safeJsonArray(clean.equipment_json).map((item) => normalizeBagItem(item, equipped));
    const selection = safeJsonObject(clean.selection_json);
    sendJson(res, 200, {
      ok: true,
      player: {
        account: row.account,
        name: row.name,
        spriteId: publicSpriteForPlayer(selection, equipped, equipment),
        level: row.level || 1,
        dragonSoul: row.dragon_soul || 1,
        stats: statsForPlayerRow(clean),
        equipment,
        equipped,
        updatedAt: row.updated_at
      }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/player") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
    sendJson(res, 200, { ok: true, player: playerRowToApi(row) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/bag") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    const fragmentColumns = fragmentItems.map((item) => item.column).join(", ");
    const skillCardColumns = skillCardItems.map((item) => item.column).join(", ");
    const row = db.prepare(`SELECT silver, yuanbao, soul_powder, immortal_pill, forge_gem, lucky_box, elf_waist_bag, bag_capacity_bonus, lucky_box_items_json, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json, storage_json FROM players WHERE account = ?`).get(account);
    const items = playerBagItems(row);
    sendJson(res, 200, {
      ok: true,
      silver: row?.silver || 0,
      yuanbao: row?.yuanbao || 0,
      capacity: bagCapacityForRow(row),
      storageCapacity: 300,
      storageItems: storageItems(normalizeStorage(row?.storage_json)),
      items
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/yuanbao-shop/catalog") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    sendJson(res, 200, {
      ok: true,
      currency: luckyBoxModule.currency,
      balance: Number(db.prepare("SELECT yuanbao FROM players WHERE account = ?").get(account)?.yuanbao) || 0,
      items: [
        { id: luckyBoxModule.boxId, name: luckyBoxModule.boxName, icon: luckyBoxModule.boxIcon, price: luckyBoxModule.boxPrice, purchasable: true },
        ...luckyBoxModule.rewards.map((item) => ({ id: item.id, name: item.name, icon: item.icon, price: item.value, purchasable: true }))
      ]
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/soul-powder/status") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    const row = db.prepare("SELECT soul_powder, soul_powder_300_at, soul_powder_400_at FROM players WHERE account = ?").get(account);
    sendJson(res, 200, {
      ok: true,
      soulPowder: row?.soul_powder || 0,
      soulPowder300At: row?.soul_powder_300_at || "",
      soulPowder400At: row?.soul_powder_400_at || ""
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/immortal-cultivation/status") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
    if (!row) {
      sendJson(res, 404, { ok: false, error: "player_not_found" });
      return;
    }
    sendJson(res, 200, { ok: true, cultivation: immortalCultivationRuntime.viewForRow(row) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/arena/rankings") {
    const session = authSessionFromToken(authTokenFromRequest(req, url));
    const account = session?.characterAccount || "";
    const requestedServerId = session?.serverId || String(url.searchParams.get("serverId") || DEFAULT_SERVER_ID).trim();
    const serverId = gameServerById(requestedServerId) ? requestedServerId : DEFAULT_SERVER_ID;
    sendJson(res, 200, arenaRuntime.rankings(account, serverId));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mad-brag/list") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    sendJson(res, 200, madBragRuntime.list(account));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mad-brag/mine") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    sendJson(res, 200, madBragRuntime.mine(account));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mad-brag/responses") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    sendJson(res, 200, madBragRuntime.responses(account));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mad-brag/rankings") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    sendJson(res, 200, madBragRuntime.rankings(account));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/daily-news/status") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    const result = dailyNewsRuntime.status(account);
    sendJson(res, result.ok ? 200 : result.status || 500, result);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/reading-exchange/catalog") {
    const account = requireAuthAccount(req, res, url);
    if (!account) return;
    const result = dailyNewsRuntime.catalog(account);
    sendJson(res, result.ok ? 200 : result.status || 500, result);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/phantom/status") {
    const account = accountFromAuthToken(authTokenFromRequest(req, url)) || "";
    const row = account ? db.prepare("SELECT name, server_id, phantom_points, equipped_title, claimed_titles_json, phantom_fragment FROM players WHERE account = ?").get(account) : null;
    const serverId = row?.server_id || serverIdFromRequest(req, url);
    const claimedTitleEntries = normalizeClaimedTitles(row?.claimed_titles_json);
    const claimedTitles = claimedTitleNames(claimedTitleEntries);
    const equippedTitle = claimedTitles.includes(row?.equipped_title || "") ? row?.equipped_title || "" : "";
    if (row && (claimedTitles.length !== safeJsonArray(row.claimed_titles_json).length || equippedTitle !== (row.equipped_title || ""))) {
      db.prepare("UPDATE players SET claimed_titles_json = ?, equipped_title = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(claimedTitleEntries), equippedTitle, new Date().toISOString(), account);
    }
    const rankings = phantomRankingRows(50, serverId);
    const myRank = account ? rankings.find((entry) => entry.account === account)?.rank || 0 : 0;
    sendJson(res, 200, {
      ok: true,
      points: row?.phantom_points || 0,
      fragment: row?.phantom_fragment || 0,
      equippedTitle,
      claimedTitles,
      claimedTitleEntries,
      myRank,
      rankings
    });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  readJsonBody(req, async (data, error) => {
    if (error) {
      console.error("[api-error]", error);
      sendJson(res, 500, { ok: false, error: "server_error" });
      return;
    }
    if (!data) {
      sendJson(res, 400, { ok: false, error: "bad_json" });
      return;
    }
    if (url.pathname === "/api/auth/register") {
      const account = String(data.account || "").trim();
      const password = String(data.password || "");
      if (!account || password.length < 4 || password.length > 24) {
        sendJson(res, 400, { ok: false, error: "bad_auth" });
        return;
      }
      if (!authRuntime.consumeRegistration(requestClientIp(req), { skipRateLimit: isLocalRequest(req) })) {
        sendJson(res, 429, { ok: false, error: "registration_rate_limited" });
        return;
      }
      const existing = db.prepare("SELECT account FROM accounts WHERE account = ?").get(account);
      if (existing) {
        sendJson(res, 409, { ok: false, error: "account_exists" });
        return;
      }
      upsertAccountPassword(account, password);
      recordAccountIp(req, account);
      sendJson(res, 200, { ok: true, token: issueAuthToken(account), account, needsCharacterSelection: true });
      return;
    }
    if (url.pathname === "/api/auth/login") {
      const account = String(data.account || "").trim();
      const password = String(data.password || "");
      const auth = authRuntime.verifyAccountPassword(account, password, requestClientIp(req), { skipRateLimit: isLocalRequest(req) });
      if (!auth.ok) {
        sendJson(res, auth.status || 401, { ok: false, error: auth.error || "bad_credentials" });
        return;
      }
      const row = db.prepare("SELECT banned_at, ban_reason FROM accounts WHERE account = ?").get(account);
      if (row.banned_at) {
        sendJson(res, 403, {
          ok: false,
          error: "account_banned",
          bannedAt: row.banned_at || "",
          banReason: row.ban_reason || "账号已被封禁"
        });
        return;
      }
      recordAccountIp(req, account);
      sendJson(res, 200, { ok: true, token: issueAuthToken(account), account, admin: account === gameAdminAccount, needsCharacterSelection: true });
      return;
    }
    if (url.pathname === "/api/characters") {
      const loginAccount = requireLoginAccount(req, res, url, data);
      if (!loginAccount) return;
      const serverId = String(data.serverId || DEFAULT_SERVER_ID).trim();
      const gameServer = gameServerById(serverId, true);
      if (!gameServer) {
        sendJson(res, 404, { ok: false, error: "server_not_found" });
        return;
      }
      const name = String(data.name || "").trim().slice(0, 12);
      const gender = String(data.gender || data.selection?.gender || "").trim();
      if (!name) {
        sendJson(res, 400, { ok: false, error: "bad_name" });
        return;
      }
      if (!["男", "女"].includes(gender)) {
        sendJson(res, 400, { ok: false, error: "bad_gender" });
        return;
      }
      if (db.prepare("SELECT account FROM players WHERE name = ?").get(name)) {
        sendJson(res, 409, { ok: false, error: "name_exists" });
        return;
      }
      const channelId = Math.floor(Number(data.channelId) || 0);
      const channelCount = Math.max(1, Math.floor(Number(gameServer.channel_count) || SERVER_CHANNEL_COUNT));
      if (channelId < 1 || channelId > channelCount) {
        sendJson(res, 400, { ok: false, error: "bad_channel", channelCount });
        return;
      }
      const initialPetId = 486;
      const selection = normalizeAdminSelection({
        gender,
        className: careerTree.INITIAL_CLASS,
        sub: careerTree.INITIAL_SUB,
        petId: initialPetId
      });
      if (!selection || selection.gender !== gender) {
        sendJson(res, 400, { ok: false, error: "bad_selection" });
        return;
      }
      const characterAccount = crypto.randomUUID();
      let row = null;
      db.exec("BEGIN IMMEDIATE");
      try {
        const rows = db.prepare(`
          SELECT account, character_slot
          FROM players
          WHERE owner_account = ? AND server_id = ?
          ORDER BY character_slot ASC
        `).all(loginAccount, serverId);
        if (rows.length >= 3) {
          db.exec("ROLLBACK");
          sendJson(res, 409, { ok: false, error: "character_limit", limit: 3, maxCharacters: 3 });
          return;
        }
        if (db.prepare("SELECT account FROM players WHERE name = ?").get(name)) {
          db.exec("ROLLBACK");
          sendJson(res, 409, { ok: false, error: "name_exists" });
          return;
        }
        const usedSlots = new Set(rows.map((entry) => Number(entry.character_slot) || 1));
        const characterSlot = [1, 2, 3].find((slot) => !usedSlots.has(slot)) || 0;
        row = upsertPlayer({
          account: characterAccount,
          ownerAccount: loginAccount,
          serverId,
          characterSlot,
          gender,
          name,
          x: 0,
          y: 0,
          mapName: "",
          selection
        });
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        console.error("[character-create-error]", error);
        sendJson(res, 500, { ok: false, error: "character_create_failed" });
        return;
      }
      const token = issueAuthToken(loginAccount, { characterAccount, serverId, channelId });
      sendJson(res, 201, {
        ok: true,
        token,
        account: loginAccount,
        characterAccount,
        characterId: characterAccount,
        serverId,
        channelId,
        server: gameServerToApi(gameServer),
        character: characterRowToSummary(row),
        player: playerRowToApi(row),
        limit: 3,
        maxCharacters: 3
      });
      return;
    }
    if (url.pathname === "/api/characters/select") {
      const loginAccount = requireLoginAccount(req, res, url, data);
      if (!loginAccount) return;
      const serverId = String(data.serverId || DEFAULT_SERVER_ID).trim();
      const gameServer = gameServerById(serverId, true);
      if (!gameServer) {
        sendJson(res, 404, { ok: false, error: "server_not_found" });
        return;
      }
      const channelId = Math.floor(Number(data.channelId) || 0);
      const channelCount = Math.max(1, Math.floor(Number(gameServer.channel_count) || SERVER_CHANNEL_COUNT));
      if (channelId < 1 || channelId > channelCount) {
        sendJson(res, 400, { ok: false, error: "bad_channel", channelCount });
        return;
      }
      const characterAccount = String(data.characterId || data.characterAccount || data.account || "").trim();
      const row = db.prepare(`
        SELECT * FROM players
        WHERE account = ? AND owner_account = ? AND server_id = ?
      `).get(characterAccount, loginAccount, serverId);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "character_not_found" });
        return;
      }
      const token = issueAuthToken(loginAccount, { characterAccount, serverId, channelId });
      sendJson(res, 200, {
        ok: true,
        token,
        account: loginAccount,
        characterAccount,
        characterId: characterAccount,
        serverId,
        channelId,
        server: gameServerToApi(gameServer),
        character: characterRowToSummary(row),
        player: playerRowToApi(row)
      });
      return;
    }
    if (url.pathname === "/api/admin/servers") {
      if (!checkAdmin(req, res, data)) return;
      const name = String(data.name || "").trim().slice(0, 32);
      const requestedId = String(data.id || "").trim();
      const id = /^[A-Za-z0-9_-]{2,48}$/.test(requestedId)
        ? requestedId
        : `server_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      if (!name) {
        sendJson(res, 400, { ok: false, error: "bad_server" });
        return;
      }
      if (gameServerById(id) || db.prepare("SELECT id FROM game_servers WHERE name = ?").get(name)) {
        sendJson(res, 409, { ok: false, error: "server_exists" });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO game_servers (id, name, enabled, channel_count, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, data.enabled === false ? 0 : 1, SERVER_CHANNEL_COUNT, Math.floor(Number(data.sortOrder) || 0), now, now);
      sendJson(res, 201, { ok: true, server: gameServerToApi(gameServerById(id)) });
      return;
    }
    if (url.pathname === "/api/admin/servers/update") {
      if (!checkAdmin(req, res, data)) return;
      const id = String(data.id || "").trim();
      const current = gameServerById(id);
      if (!current) {
        sendJson(res, 404, { ok: false, error: "server_not_found" });
        return;
      }
      const name = data.name == null ? current.name : String(data.name || "").trim().slice(0, 32);
      if (id === DEFAULT_SERVER_ID && (name !== DEFAULT_SERVER_NAME || data.enabled === false)) {
        sendJson(res, 409, { ok: false, error: "default_server_required" });
        return;
      }
      if (!name) {
        sendJson(res, 400, { ok: false, error: "bad_server" });
        return;
      }
      const duplicate = db.prepare("SELECT id FROM game_servers WHERE name = ? AND id <> ?").get(name, id);
      if (duplicate) {
        sendJson(res, 409, { ok: false, error: "server_exists" });
        return;
      }
      const enabled = data.enabled == null ? current.enabled : (data.enabled === true ? 1 : 0);
      const sortOrder = data.sortOrder == null ? current.sort_order : Math.floor(Number(data.sortOrder) || 0);
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE game_servers SET name = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?")
        .run(name, enabled, sortOrder, updatedAt, id);
      if (!enabled) {
        const notice = JSON.stringify({ type: "forceLogout", reason: "server_disabled" });
        for (const socket of sockets) {
          if (socket.destroyed || socketMeta.get(socket)?.serverId !== id) continue;
          socketWriteRuntime.write(socket, encodeFrame(notice), "forceLogout");
          socket.end();
        }
      }
      sendJson(res, 200, { ok: true, server: gameServerToApi(gameServerById(id)) });
      return;
    }
    if (adminMapApi.handlePost(req, res, url, data)) return;
    if (url.pathname === "/api/auth/change-password") {
      const account = requireLoginAccount(req, res, url, data);
      if (!account) return;
      const oldPassword = String(data.oldPassword || "");
      const newPassword = String(data.newPassword || "");
      const verified = authRuntime.verifyAccountPassword(account, oldPassword, requestClientIp(req), { skipRateLimit: isLocalRequest(req) });
      if (!verified.ok) {
        sendJson(res, verified.status || 401, { ok: false, error: verified.error || "bad_credentials" });
        return;
      }
      if (!account || newPassword.length < 4 || newPassword.length > 24) {
        sendJson(res, 400, { ok: false, error: "bad_auth" });
        return;
      }
      upsertAccountPassword(account, newPassword);
      sendJson(res, 200, { ok: true, token: issueAuthToken(account), account });
      return;
    }
    if (url.pathname === "/api/admin/grant-item") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      const itemId = String(data.itemId || "").trim();
      const amount = Math.max(1, Math.min(999999999, Math.floor(Number(data.amount) || 0)));
      const column = itemColumnForId(itemId);
      const isLuckyBoxItem = Boolean(luckyBoxItemMeta(itemId));
      if (!targetAccount || (itemId !== "yuanbao" && !column && !isLuckyBoxItem && itemId !== luckyBoxModule.boxId)) {
        sendJson(res, 400, { ok: false, error: "bad_grant" });
        return;
      }
      const row = db.prepare("SELECT account FROM players WHERE account = ?").get(targetAccount);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const updatedAt = new Date().toISOString();
      if (itemId === "yuanbao") {
        db.prepare("UPDATE players SET yuanbao = yuanbao + ?, updated_at = ? WHERE account = ?").run(amount, updatedAt, targetAccount);
      } else if (itemId === luckyBoxModule.boxId) {
        db.prepare("UPDATE players SET lucky_box = lucky_box + ?, updated_at = ? WHERE account = ?").run(amount, updatedAt, targetAccount);
      } else if (isLuckyBoxItem) {
        const current = db.prepare("SELECT lucky_box_items_json FROM players WHERE account = ?").get(targetAccount);
        const items = safeJsonObject(current?.lucky_box_items_json);
        items[itemId] = Math.max(0, Math.floor(Number(items[itemId]) || 0)) + amount;
        db.prepare("UPDATE players SET lucky_box_items_json = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(items), updatedAt, targetAccount);
      } else {
        db.prepare(`UPDATE players SET ${column} = ${column} + ?, updated_at = ? WHERE account = ?`).run(amount, updatedAt, targetAccount);
      }
      sendJson(res, 200, { ok: true, account: targetAccount, itemId, amount });
      return;
    }
    if (url.pathname === "/api/admin/grant-yuanbao") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      const amount = Math.max(1, Math.min(999999999, Math.floor(Number(data.amount) || 0)));
      if (!targetAccount || amount < 1) {
        sendJson(res, 400, { ok: false, error: "bad_grant" });
        return;
      }
      const result = db.prepare("UPDATE players SET yuanbao = yuanbao + ?, updated_at = ? WHERE account = ?")
        .run(amount, new Date().toISOString(), targetAccount);
      if (!result.changes) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const next = db.prepare("SELECT yuanbao FROM players WHERE account = ?").get(targetAccount);
      sendJson(res, 200, { ok: true, account: targetAccount, amount, yuanbao: next.yuanbao || 0 });
      return;
    }
    if (url.pathname === "/api/admin/clear-item") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      const itemId = String(data.itemId || "").trim();
      const column = itemColumnForId(itemId);
      const isLuckyBoxItem = Boolean(luckyBoxItemMeta(itemId));
      if (!targetAccount || (itemId !== "yuanbao" && itemId !== luckyBoxModule.boxId && !column && !isLuckyBoxItem)) {
        sendJson(res, 400, { ok: false, error: "bad_item" });
        return;
      }
      const row = db.prepare("SELECT account FROM players WHERE account = ?").get(targetAccount);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const updatedAt = new Date().toISOString();
      if (itemId === "yuanbao") {
        db.prepare("UPDATE players SET yuanbao = 0, updated_at = ? WHERE account = ?").run(updatedAt, targetAccount);
      } else if (itemId === luckyBoxModule.boxId) {
        db.prepare("UPDATE players SET lucky_box = 0, updated_at = ? WHERE account = ?").run(updatedAt, targetAccount);
      } else if (isLuckyBoxItem) {
        const items = safeJsonObject(db.prepare("SELECT lucky_box_items_json FROM players WHERE account = ?").get(targetAccount)?.lucky_box_items_json);
        delete items[itemId];
        db.prepare("UPDATE players SET lucky_box_items_json = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(items), updatedAt, targetAccount);
      } else {
        db.prepare(`UPDATE players SET ${column} = 0, updated_at = ? WHERE account = ?`).run(updatedAt, targetAccount);
      }
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(targetAccount);
      sendJson(res, 200, { ok: true, account: targetAccount, itemId, player: { account: next.account, ...playerRowToApi(next) } });
      return;
    }
    if (url.pathname === "/api/admin/update-player") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      const current = targetAccount ? db.prepare("SELECT * FROM players WHERE account = ?").get(targetAccount) : null;
      const allowed = {
        level: ["level", 1, 100],
        exp: ["exp", 0, 999999999],
        careerLevel: ["career_level", 1, 100],
        careerExp: ["career_exp", 0, 999999999],
        dragonSoul: ["dragon_soul", 0, 70],
        dragonSoulExp: ["dragon_soul_exp", 0, 999999999],
        petLevel: ["pet_level", 1, 100],
        petExp: ["pet_exp", 0, 999999999],
        silver: ["silver", 0, 999999999],
        yuanbao: ["yuanbao", 0, 999999999]
      };
      const sets = [];
      const params = [];
      Object.entries(allowed).forEach(([key, [column, min, max]]) => {
        if (data[key] === "" || data[key] == null) return;
        sets.push(`${column} = ?`);
        params.push(Math.max(min, Math.min(max, Math.floor(Number(data[key]) || 0))));
      });
      let selectedPetId = activePetIdForRow(current);
      if (data.selection != null) {
        const selection = normalizeAdminSelection(data.selection, safeJsonObject(current?.selection_json));
        if (!selection) {
          sendJson(res, 400, { ok: false, error: "bad_selection" });
          return;
        }
        sets.push("selection_json = ?");
        params.push(JSON.stringify(selection));
        sets.push("gender = ?");
        params.push(selection.gender || current?.gender || "");
        selectedPetId = normalizePetId(selection.petId);
      }
      if (data.petLevel !== "" && data.petLevel != null || data.petExp !== "" && data.petExp != null || data.selection != null) {
        const progressById = petProgressMapForRow(current);
        const progress = progressById[String(selectedPetId)] || normalizeProgress();
        progress.level = data.petLevel === "" || data.petLevel == null ? progress.level : Math.max(1, Math.min(100, Math.floor(Number(data.petLevel) || 1)));
        progress.exp = data.petExp === "" || data.petExp == null ? progress.exp : Math.max(0, Math.min(999999999, Math.floor(Number(data.petExp) || 0)));
        if (selectedPetId) progressById[String(selectedPetId)] = progress;
        sets.push("pet_progress_json = ?");
        params.push(JSON.stringify(progressById));
      }
      if (!targetAccount || !sets.length) {
        sendJson(res, 400, { ok: false, error: "bad_update" });
        return;
      }
      sets.push("updated_at = ?");
      params.push(new Date().toISOString(), targetAccount);
      db.prepare(`UPDATE players SET ${sets.join(", ")} WHERE account = ?`).run(...params);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(targetAccount);
      sendJson(res, 200, { ok: true, player: next ? { account: next.account, ...playerRowToApi(next) } : null });
      return;
    }
    if (url.pathname === "/api/admin/reset-arena") {
      if (!checkAdmin(req, res, data)) return;
      db.prepare("DELETE FROM arena_rankings").run();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/admin/reset-all-phantom") {
      if (!checkAdmin(req, res, data)) return;
      const summary = db.prepare(`
        SELECT
          COUNT(*) AS playerCount,
          COALESCE(SUM(phantom_points), 0) AS previousPoints,
          COALESCE(SUM(phantom_fragment), 0) AS previousFragments
        FROM players
      `).get();
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET phantom_points = 0, phantom_fragment = 0, updated_at = ?").run(updatedAt);
      db.prepare("DELETE FROM phantom_rankings").run();
      sendJson(res, 200, {
        ok: true,
        playerCount: summary.playerCount || 0,
        previousPoints: summary.previousPoints || 0,
        previousFragments: summary.previousFragments || 0
      });
      return;
    }
    if (url.pathname === "/api/admin/reset-phantom-points") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      if (!targetAccount) {
        sendJson(res, 400, { ok: false, error: "bad_target" });
        return;
      }
      const row = db.prepare("SELECT account, phantom_points FROM players WHERE account = ?").get(targetAccount);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET phantom_points = 0, updated_at = ? WHERE account = ?").run(updatedAt, targetAccount);
      db.prepare("DELETE FROM phantom_rankings WHERE account = ?").run(targetAccount);
      sendJson(res, 200, { ok: true, account: targetAccount, previousPoints: row.phantom_points || 0 });
      return;
    }
    if (url.pathname === "/api/admin/grant-phantom-title") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      const rank = Math.max(1, Math.min(50, Math.floor(Number(data.rank) || 0)));
      const durationDays = Math.max(1, Math.min(365, Math.floor(Number(data.durationDays) || 7)));
      const title = phantomTitleForRank(rank);
      if (!targetAccount || !title) {
        sendJson(res, 400, { ok: false, error: "bad_title" });
        return;
      }
      const row = db.prepare("SELECT account, claimed_titles_json FROM players WHERE account = ?").get(targetAccount);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const now = Date.now();
      const updatedAt = new Date(now).toISOString();
      const expiresAt = new Date(now + durationDays * 24 * 60 * 60 * 1000).toISOString();
      const claimedEntries = normalizeClaimedTitles(row.claimed_titles_json, now).filter((item) => item.title !== title);
      const claimed = [...claimedEntries, { title, claimedAt: updatedAt, expiresAt }];
      const equipTitle = data.equip === false ? "" : title;
      db.prepare("UPDATE players SET claimed_titles_json = ?, equipped_title = CASE WHEN ? THEN ? ELSE equipped_title END, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(claimed), data.equip === false ? 0 : 1, equipTitle, updatedAt, targetAccount);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(targetAccount);
      sendJson(res, 200, {
        ok: true,
        account: targetAccount,
        title,
        rank,
        boost: phantomTitleBoost(title),
        expiresAt,
        player: { account: next.account, ...playerRowToApi(next) }
      });
      return;
    }
    if (url.pathname === "/api/admin/reset-items") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = String(data.targetCharacterId || data.targetAccount || "").trim();
      if (!targetAccount) {
        sendJson(res, 400, { ok: false, error: "bad_target" });
        return;
      }
      const next = resetPlayerItems(targetAccount);
      if (!next) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      sendJson(res, 200, { ok: true, account: targetAccount, player: { account: next.account, ...playerRowToApi(next) } });
      return;
    }
    if (url.pathname === "/api/admin/reset-abnormal-levels") {
      if (!checkAdmin(req, res, data)) return;
      const targets = resetAbnormalLevels();
      sendJson(res, 200, { ok: true, resetCount: targets.length, accounts: targets.map((row) => row.account) });
      return;
    }
    if (url.pathname === "/api/admin/scan-anomalies") {
      if (!checkAdmin(req, res, data)) return;
      const result = scanAnomalies(Boolean(data.repair));
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (url.pathname === "/api/admin/ban-account" || url.pathname === "/api/admin/unban-account") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = resolveOwnerAccount(data.ownerAccount || data.targetAccount || data.targetCharacterId);
      if (!targetAccount) {
        sendJson(res, 400, { ok: false, error: "bad_target" });
        return;
      }
      const row = db.prepare("SELECT account FROM accounts WHERE account = ?").get(targetAccount);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "account_not_found" });
        return;
      }
      if (url.pathname.endsWith("/ban-account")) {
        const reason = String(data.reason || "后台封禁").slice(0, 200);
        const bannedAt = new Date().toISOString();
        db.prepare("UPDATE accounts SET banned_at = ?, ban_reason = ?, updated_at = ? WHERE account = ?")
          .run(bannedAt, reason, bannedAt, targetAccount);
        recordAnomaly(targetAccount, "manual_ban", { reason }, 3, "ban");
        sendJson(res, 200, { ok: true, account: targetAccount, bannedAt, reason });
      } else {
        db.prepare("UPDATE accounts SET banned_at = NULL, ban_reason = '', updated_at = ? WHERE account = ?")
          .run(new Date().toISOString(), targetAccount);
        recordAnomaly(targetAccount, "manual_unban", {}, 1, "unban");
        sendJson(res, 200, { ok: true, account: targetAccount });
      }
      return;
    }
    if (url.pathname === "/api/admin/reset-password") {
      if (!checkAdmin(req, res, data)) return;
      const targetAccount = resolveOwnerAccount(data.ownerAccount || data.targetAccount || data.targetCharacterId);
      const password = String(data.password || "");
      if (!targetAccount || password.length < 4 || password.length > 24) {
        sendJson(res, 400, { ok: false, error: "bad_auth" });
        return;
      }
      if (!db.prepare("SELECT account FROM accounts WHERE account = ?").get(targetAccount)) {
        sendJson(res, 404, { ok: false, error: "account_not_found" });
        return;
      }
      upsertAccountPassword(targetAccount, password);
      sendJson(res, 200, { ok: true, account: targetAccount });
      return;
    }
    if (url.pathname === "/api/admin/changelog") {
      if (!checkAdmin(req, res, data)) return;
      const title = String(data.title || "更新日志").trim().slice(0, 40) || "更新日志";
      const content = String(data.content || "").slice(0, 20000);
      const version = String(data.version || "").trim().slice(0, 64);
      const enabled = data.enabled !== false;
      const changelog = saveAppSetting("update_log", { title, content, version, enabled });
      sendJson(res, 200, { ok: true, changelog });
      return;
    }
    if (url.pathname === "/api/admin/game-visual") {
      if (!checkAdmin(req, res, data)) return;
      const visual = saveAppSetting("game_visual", {
        playerScale: clampNumber(data.playerScale, 1, 0.5, 2.5),
        petScale: clampNumber(data.petScale, 1, 0.5, 2.5),
        otherScale: clampNumber(data.otherScale, 1, 0.5, 2.5)
      });
      sendJson(res, 200, { ok: true, visual: gameVisualSetting(), saved: visual });
      return;
    }
    if (url.pathname === "/api/admin/login-visual") {
      if (!checkAdmin(req, res, data)) return;
      const current = loginVisualSetting();
      const mediaType = data.mediaType === "image" ? "image" : "video";
      const visual = saveAppSetting("login_visual", {
        mode: data.mode === "classic" ? "classic" : "cover",
        mediaType,
        mediaSrc: sanitizeStaticMediaPath(data.mediaSrc, mediaType === "image" ? "\u8d44\u6e90/\u56fe\u7247/\u767b\u5f55\u5c01\u9762.png" : "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4"),
        hotspotLeft: clampNumber(data.hotspotLeft, current.hotspotLeft, 0, 100),
        hotspotWidth: clampNumber(data.hotspotWidth, current.hotspotWidth, 5, 100),
        hotspotHeight: clampNumber(data.hotspotHeight, current.hotspotHeight, 2, 30),
        arrowLeft: clampNumber(data.arrowLeft, current.arrowLeft, 0, 100),
        positions: Array.from({ length: 5 }, (_, index) => clampNumber(data.positions?.[index], current.positions[index], 0, 100)),
        videoSkipStart: data.videoSkipStart === true || data.videoSkipStart === "true",
        videoSkipStartTime: clampNumber(data.videoSkipStartTime, current.videoSkipStartTime, 0, 30)
      });
      sendJson(res, 200, { ok: true, visual: loginVisualSetting(), saved: visual });
      return;
    }
    if (url.pathname === "/api/admin/growth-config") {
      if (!checkAdmin(req, res, data)) return;
      const growthResult = growthConfigRuntime.updateConfig(data);
      if (!growthResult.ok) {
        sendJson(res, 400, { ok: false, error: "invalid_growth_config", errors: growthResult.errors });
        return;
      }
      sendJson(res, 200, { ok: true, config: growthResult.config, updatedAt: growthResult.updatedAt });
      return;
    }
    if (url.pathname === "/api/admin/growth-config/reset") {
      if (!checkAdmin(req, res, data)) return;
      const growthReset = growthConfigRuntime.resetConfig();
      sendJson(res, 200, { ok: true, config: growthReset.config, updatedAt: growthReset.updatedAt });
      return;
    }
    if (url.pathname === "/api/admin/dragon-soul-config") {
      if (!checkAdmin(req, res, data)) return;
      const result = dragonSoulRuntime.updateConfig(data);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (url.pathname === "/api/admin/dragon-soul-config/reset") {
      if (!checkAdmin(req, res, data)) return;
      const result = dragonSoulRuntime.resetConfig();
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (url.pathname === "/api/admin/career-progress-config") {
      if (!checkAdmin(req, res, data)) return;
      sendJson(res, 200, { ok: true, config: careerProgressConfigRuntime.updateConfig(data) });
      return;
    }
    if (url.pathname === "/api/admin/career-progress-config/reset") {
      if (!checkAdmin(req, res, data)) return;
      sendJson(res, 200, { ok: true, config: careerProgressConfigRuntime.resetConfig() });
      return;
    }
    const account = requireAuthAccount(req, res, url, data);
    if (!account) return;
    if (data.account && String(data.account).trim() !== account) {
      recordAnomaly(account, "account_spoof_attempt", { source: url.pathname, claimedAccount: String(data.account).trim() }, 3, "reject");
    }
    data.account = account;
    recordAccountIp(req, resolveOwnerAccount(account) || account);
    detectUploadedPlayerStats(account, url.pathname, data);
    if (url.pathname === "/api/player") {
      const current = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (current) detectUploadedPlayerStats(account, "/api/player", data, statsForPlayerRow(current));
      const row = upsertPlayer({
        account,
        name: String(data.name || current?.name || account).trim(),
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        mapName: String(data.mapName || current?.map_name || ""),
        level: current?.level,
        exp: current?.exp,
        dragonSoul: current?.dragon_soul,
        petLevel: current?.pet_level,
        petExp: current?.pet_exp,
        autoStrategy: data.autoStrategy,
        selection: data.selection,
        activeMercenaryId: data.activeMercenaryId,
        friends: data.friends
      });
      sendJson(res, 200, { ok: true, player: playerRowToApi(row) });
      return;
    }
    if (url.pathname === "/api/immortal-cultivation/reroll") {
      const result = immortalCultivationRuntime.reroll(account, data.partId, data.slotIndex, data.locked === true);
      if (!result.ok) {
        sendJson(res, result.status || 500, result);
        return;
      }
      const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ...result, player: playerRowToApi(row) });
      return;
    }
    if (url.pathname === "/api/mad-brag/create") {
      const result = madBragRuntime.create(account, data);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/mad-brag/answer") {
      const result = madBragRuntime.answer(account, data.challengeId, data.choice);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/daily-news/read") {
      const result = await dailyNewsRuntime.read(account);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/reading-exchange/redeem") {
      const result = dailyNewsRuntime.redeem(account, data.itemId);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/life-skills/stickers/craft") {
      const grade = String(data.grade || "");
      const stickerId = String(data.stickerId || "");
      const quantity = Math.max(1, Math.min(999999, Math.floor(Number(data.quantity) || 1)));
      const sticker = stickerModule.stickerById[stickerId];
      if (!sticker || sticker.grade !== grade || !stickerModule.gradeOrder.includes(grade)) {
        sendJson(res, 400, { ok: false, error: "bad_sticker" });
        return;
      }
      const cost = stickerModule.gradeCosts[grade];
      const totalCost = {
        paint: cost.paint * quantity,
        silver: cost.silver * quantity,
        soulPowder: cost.soulPowder * quantity
      };
      const row = db.prepare("SELECT silver, soul_powder, mysterious_paint, sticker_inventory_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.mysterious_paint || 0) < totalCost.paint) {
        sendJson(res, 409, { ok: false, error: "not_enough_paint", need: totalCost.paint, owned: row.mysterious_paint || 0 });
        return;
      }
      if ((row.silver || 0) < totalCost.silver) {
        sendJson(res, 409, { ok: false, error: "not_enough_silver", need: totalCost.silver, owned: row.silver || 0 });
        return;
      }
      if ((row.soul_powder || 0) < totalCost.soulPowder) {
        sendJson(res, 409, { ok: false, error: "not_enough_powder", need: totalCost.soulPowder, owned: row.soul_powder || 0 });
        return;
      }
      const inventory = stickerModule.normalizeInventory(safeJsonObject(row.sticker_inventory_json));
      inventory[sticker.id] = (inventory[sticker.id] || 0) + quantity;
      const updatedAt = new Date().toISOString();
      db.prepare(`
        UPDATE players
        SET mysterious_paint = mysterious_paint - ?,
          silver = silver - ?,
          soul_powder = soul_powder - ?,
          sticker_inventory_json = ?,
          updated_at = ?
        WHERE account = ?
      `).run(totalCost.paint, totalCost.silver, totalCost.soulPowder, JSON.stringify(inventory), updatedAt, account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, sticker, inventory, quantity, cost: totalCost, player: playerRowToApi(next) });
      return;
    }
    if (url.pathname === "/api/life-skills/stickers/apply") {
      const stickerId = String(data.stickerId || "");
      const petId = normalizePetId(data.petId);
      const quantity = Math.floor(Number(data.quantity) || 0);
      const sticker = stickerModule.stickerById[stickerId];
      const option = stickerModule.applyOptions.find((item) => item.quantity === quantity);
      if (!sticker || !option || !petId) {
        sendJson(res, 400, { ok: false, error: "bad_sticker_apply" });
        return;
      }
      const row = db.prepare("SELECT owned_pets_json, selection_json, soul_powder, sticker_inventory_json, pet_stickers_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const selectedPetId = normalizePetId(safeJsonObject(row.selection_json).petId || 0);
      const ownedPets = new Set([selectedPetId, ...safeJsonArray(row.owned_pets_json).map(normalizePetId)].filter(Boolean));
      if (!ownedPets.has(petId)) {
        sendJson(res, 409, { ok: false, error: "pet_not_owned" });
        return;
      }
      const inventory = stickerModule.normalizeInventory(safeJsonObject(row.sticker_inventory_json));
      if ((inventory[stickerId] || 0) < option.quantity) {
        sendJson(res, 409, { ok: false, error: "not_enough_sticker", need: option.quantity, owned: inventory[stickerId] || 0 });
        return;
      }
      if ((row.soul_powder || 0) < option.soulPowder) {
        sendJson(res, 409, { ok: false, error: "not_enough_powder", need: option.soulPowder, owned: row.soul_powder || 0 });
        return;
      }
      const petStickers = stickerModule.normalizePetStickers(safeJsonObject(row.pet_stickers_json));
      const key = String(petId);
      const current = petStickers[key] || [];
      const existing = current.find((entry) => entry.stickerId === stickerId);
      if (!existing && current.length >= 5) {
        sendJson(res, 409, { ok: false, error: "pet_sticker_limit", limit: 5 });
        return;
      }
      if (existing) {
        existing.expiresAt = stickerModule.addDays(existing.expiresAt, option.days);
      } else {
        current.push({ stickerId, expiresAt: stickerModule.addDays("", option.days) });
      }
      petStickers[key] = current;
      inventory[stickerId] -= option.quantity;
      if (inventory[stickerId] <= 0) delete inventory[stickerId];
      const updatedAt = new Date().toISOString();
      db.prepare(`
        UPDATE players
        SET soul_powder = soul_powder - ?,
          sticker_inventory_json = ?,
          pet_stickers_json = ?,
          updated_at = ?
        WHERE account = ?
      `).run(option.soulPowder, JSON.stringify(inventory), JSON.stringify(petStickers), updatedAt, account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, sticker, petId, inventory, petStickers, player: playerRowToApi(next) });
      return;
    }
    if (url.pathname === "/api/change-role") {
      const current = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!current) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const selection = normalizeAdminSelection(data.selection, safeJsonObject(current.selection_json));
      if (!selection) {
        sendJson(res, 400, { ok: false, error: "bad_selection" });
        return;
      }
      const transition = careerTree.transitionCheck(safeJsonObject(current.selection_json), selection, {
        playerLevel: current.level,
        careerLevel: current.career_level
      });
      if (!transition.ok) {
        sendJson(res, 409, { ok: false, error: transition.error });
        return;
      }
      const progressById = petProgressMapForRow(current);
      const petProgress = progressById[String(normalizePetId(selection.petId))] || normalizeProgress();
      if (selection.petId) progressById[String(normalizePetId(selection.petId))] = petProgress;
      const careerLevel = transition.resetCareerProgress ? 1 : Math.max(1, Number(current.career_level) || 1);
      const careerExp = transition.resetCareerProgress ? 0 : Math.max(0, Number(current.career_exp) || 0);
      db.prepare("UPDATE players SET selection_json = ?, gender = ?, career_level = ?, career_exp = ?, pet_level = ?, pet_exp = ?, pet_progress_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(selection), selection.gender || current.gender || "", careerLevel, careerExp, petProgress.level, petProgress.exp, JSON.stringify(progressById), new Date().toISOString(), account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, careerStage: careerTree.careerStage(selection), careerName: careerTree.careerName(selection), player: playerRowToApi(next) });
      return;
    }
    if (url.pathname === "/api/rename") {
      const name = String(data.name || "").trim().slice(0, 12);
      if (!name) {
        sendJson(res, 400, { ok: false, error: "empty_name" });
        return;
      }
      const taken = db.prepare("SELECT account FROM players WHERE name = ? AND account <> ?").get(name, account);
      if (taken) {
        sendJson(res, 409, { ok: false, error: "name_taken" });
        return;
      }
      const current = db.prepare("SELECT x, y, map_name, level, exp, dragon_soul, pet_level, pet_exp FROM players WHERE account = ?").get(account);
      const row = upsertPlayer({
        account,
        name,
        x: Number(data.x) || current?.x || 0,
        y: Number(data.y) || current?.y || 0,
        mapName: String(data.mapName || current?.map_name || ""),
        level: current?.level || data.level,
        exp: current?.exp || data.exp,
        dragonSoul: current?.dragon_soul || data.dragonSoul,
        petLevel: current?.pet_level || data.petLevel,
        petExp: current?.pet_exp || data.petExp
      });
      sendJson(res, 200, { ok: true, player: playerRowToApi(row) });
      return;
    }
    if (url.pathname === "/api/soul-powder/claim") {
      const type = String(data.type || "");
      const config = type === "300"
        ? { amount: 300, hours: 8, column: "soul_powder_300_at" }
        : type === "400"
          ? { amount: 400, hours: 4, column: "soul_powder_400_at" }
          : null;
      if (!config) {
        sendJson(res, 400, { ok: false, error: "bad_claim_type" });
        return;
      }
      const existing = db.prepare("SELECT name FROM players WHERE account = ?").get(account);
      if (!existing) {
        upsertPlayer({ account, name: account, x: 0, y: 0, mapName: "" });
      }
      const row = db.prepare(`SELECT soul_powder, ${config.column} AS last_at FROM players WHERE account = ?`).get(account);
      const lastTime = row?.last_at ? Date.parse(row.last_at) : 0;
      const cooldownMs = config.hours * 60 * 60 * 1000;
      const now = Date.now();
      if (lastTime && now - lastTime < cooldownMs) {
        sendJson(res, 409, {
          ok: false,
          error: "cooldown",
          remainingMs: cooldownMs - (now - lastTime),
          soulPowder: row?.soul_powder || 0
        });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare(`UPDATE players SET soul_powder = soul_powder + ?, ${config.column} = ?, updated_at = ? WHERE account = ?`)
        .run(config.amount, updatedAt, updatedAt, account);
      const next = db.prepare("SELECT soul_powder, soul_powder_300_at, soul_powder_400_at FROM players WHERE account = ?").get(account);
      sendJson(res, 200, {
        ok: true,
        amount: config.amount,
        soulPowder: next.soul_powder,
        soulPowder300At: next.soul_powder_300_at || "",
        soulPowder400At: next.soul_powder_400_at || ""
      });
      return;
    }
    if (url.pathname === "/api/redeem-code/claim") {
      const result = redeemCodeRuntime.claim(account, data.code);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
      // Legacy source-coded redemption below is unreachable until its removal in the extraction commit.
      const code = String(data.code || "").trim().toUpperCase();
      if (
        code !== dailyRedeemCode
        && code !== peerlessPetScrollRedeemCode
        && code !== fashionTicketRedeemCode
        && code !== peerlessHolyWeaponRedeemCode
        && code !== peerlessRoleSkillRedeemCode
        && code !== phantomTitleFirstRedeemCode
      ) {
        sendJson(res, 400, { ok: false, error: "bad_code" });
        return;
      }
      const existing = db.prepare("SELECT name FROM players WHERE account = ?").get(account);
      if (!existing) {
        upsertPlayer({ account, name: account, x: 0, y: 0, mapName: "" });
      }
      if (code === peerlessPetScrollRedeemCode) {
        const row = db.prepare("SELECT peerless_pet_scroll_ticket, peerless_pet_scroll_redeemed_at FROM players WHERE account = ?").get(account);
        if (row?.peerless_pet_scroll_redeemed_at) {
          sendJson(res, 409, { ok: false, error: "already_claimed_once", ticket: row?.peerless_pet_scroll_ticket || 0 });
          return;
        }
        const updatedAt = new Date().toISOString();
        db.prepare("UPDATE players SET peerless_pet_scroll_ticket = peerless_pet_scroll_ticket + ?, peerless_pet_scroll_redeemed_at = ?, updated_at = ? WHERE account = ?")
          .run(peerlessPetScrollRedeemAmount, updatedAt, updatedAt, account);
        const next = db.prepare("SELECT peerless_pet_scroll_ticket, peerless_pet_scroll_redeemed_at FROM players WHERE account = ?").get(account);
        sendJson(res, 200, {
          ok: true,
          reward: "peerless_pet_scroll_ticket",
          amount: peerlessPetScrollRedeemAmount,
          ticket: next.peerless_pet_scroll_ticket || 0,
          peerlessPetScrollRedeemedAt: next.peerless_pet_scroll_redeemed_at || ""
        });
        return;
      }
      if (code === fashionTicketRedeemCode) {
        const row = db.prepare("SELECT fashion_ticket, fashion_ticket_redeemed_at FROM players WHERE account = ?").get(account);
        if (row?.fashion_ticket_redeemed_at) {
          sendJson(res, 409, { ok: false, error: "already_claimed_once", ticket: row?.fashion_ticket || 0 });
          return;
        }
        const updatedAt = new Date().toISOString();
        db.prepare("UPDATE players SET fashion_ticket = fashion_ticket + ?, fashion_ticket_redeemed_at = ?, updated_at = ? WHERE account = ?")
          .run(fashionTicketRedeemAmount, updatedAt, updatedAt, account);
        const next = db.prepare("SELECT fashion_ticket, fashion_ticket_redeemed_at FROM players WHERE account = ?").get(account);
        sendJson(res, 200, {
          ok: true,
          reward: "fashion_ticket",
          amount: fashionTicketRedeemAmount,
          ticket: next.fashion_ticket || 0,
          fashionTicketRedeemedAt: next.fashion_ticket_redeemed_at || ""
        });
        return;
      }
      if (code === peerlessHolyWeaponRedeemCode) {
        const row = db.prepare("SELECT peerless_holy_weapon_ticket, peerless_holy_weapon_redeemed_at FROM players WHERE account = ?").get(account);
        if (row?.peerless_holy_weapon_redeemed_at) {
          sendJson(res, 409, { ok: false, error: "already_claimed_once", ticket: row?.peerless_holy_weapon_ticket || 0 });
          return;
        }
        const updatedAt = new Date().toISOString();
        db.prepare("UPDATE players SET peerless_holy_weapon_ticket = peerless_holy_weapon_ticket + ?, peerless_holy_weapon_redeemed_at = ?, updated_at = ? WHERE account = ?")
          .run(peerlessHolyWeaponRedeemAmount, updatedAt, updatedAt, account);
        const next = db.prepare("SELECT peerless_holy_weapon_ticket, peerless_holy_weapon_redeemed_at FROM players WHERE account = ?").get(account);
        sendJson(res, 200, {
          ok: true,
          reward: "peerless_holy_weapon_ticket",
          amount: peerlessHolyWeaponRedeemAmount,
          ticket: next.peerless_holy_weapon_ticket || 0,
          peerlessHolyWeaponRedeemedAt: next.peerless_holy_weapon_redeemed_at || ""
        });
        return;
      }
      if (code === peerlessRoleSkillRedeemCode) {
        const row = db.prepare("SELECT peerless_role_skill_ticket, peerless_role_skill_redeemed_at FROM players WHERE account = ?").get(account);
        if (row?.peerless_role_skill_redeemed_at) {
          sendJson(res, 409, { ok: false, error: "already_claimed_once", ticket: row?.peerless_role_skill_ticket || 0 });
          return;
        }
        const updatedAt = new Date().toISOString();
        db.prepare("UPDATE players SET peerless_role_skill_ticket = peerless_role_skill_ticket + ?, peerless_role_skill_redeemed_at = ?, updated_at = ? WHERE account = ?")
          .run(peerlessRoleSkillRedeemAmount, updatedAt, updatedAt, account);
        const next = db.prepare("SELECT peerless_role_skill_ticket, peerless_role_skill_redeemed_at FROM players WHERE account = ?").get(account);
        sendJson(res, 200, {
          ok: true,
          reward: "peerless_role_skill_ticket",
          amount: peerlessRoleSkillRedeemAmount,
          ticket: next.peerless_role_skill_ticket || 0,
          peerlessRoleSkillRedeemedAt: next.peerless_role_skill_redeemed_at || ""
        });
        return;
      }
      if (code === phantomTitleFirstRedeemCode) {
        const row = db.prepare("SELECT claimed_titles_json, equipped_title, phantom_title_first_redeemed_at FROM players WHERE account = ?").get(account);
        if (row?.phantom_title_first_redeemed_at) {
          sendJson(res, 409, { ok: false, error: "already_claimed_once", title: phantomTitleForRank(1) });
          return;
        }
        const now = Date.now();
        const updatedAt = new Date(now).toISOString();
        const title = phantomTitleForRank(1);
        const claimedEntries = normalizeClaimedTitles(row?.claimed_titles_json, now).filter((item) => item.title !== title);
        const titleEntry = {
          title,
          claimedAt: updatedAt,
          expiresAt: new Date(now + PHANTOM_TITLE_DURATION_MS).toISOString()
        };
        const claimed = [...claimedEntries, titleEntry];
        db.prepare("UPDATE players SET claimed_titles_json = ?, equipped_title = ?, phantom_title_first_redeemed_at = ?, updated_at = ? WHERE account = ?")
          .run(JSON.stringify(claimed), title, updatedAt, updatedAt, account);
        sendJson(res, 200, {
          ok: true,
          reward: "phantom_title_first",
          title,
          rank: 1,
          boost: phantomTitleBoost(title),
          expiresAt: titleEntry.expiresAt,
          claimedTitles: claimedTitleNames(claimed),
          claimedTitleEntries: claimed,
          equippedTitle: title,
          phantomTitleFirstRedeemedAt: updatedAt
        });
        return;
      }
      const row = db.prepare("SELECT soul_powder, redeem_code_claimed_at FROM players WHERE account = ?").get(account);
      const today = todayKey();
      if (row?.redeem_code_claimed_at === today) {
        sendJson(res, 409, { ok: false, error: "already_claimed_today", soulPowder: row?.soul_powder || 0 });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET soul_powder = soul_powder + ?, redeem_code_claimed_at = ?, updated_at = ? WHERE account = ?")
        .run(dailyRedeemSoulPowder, today, updatedAt, account);
      const next = db.prepare("SELECT soul_powder, redeem_code_claimed_at FROM players WHERE account = ?").get(account);
      sendJson(res, 200, {
        ok: true,
        amount: dailyRedeemSoulPowder,
        soulPowder: next.soul_powder || 0,
        redeemCodeClaimedAt: next.redeem_code_claimed_at || ""
      });
      return;
    }
    if (url.pathname === "/api/battle-reward") {
      const ticket = rewardTicketRuntime.consume(account, data.rewardTicket);
      if (!ticket.ok) {
        sendJson(res, ticket.status || 409, ticket);
        return;
      }
      data.monsterId = ticket.monsterId;
      data.monsterCount = ticket.monsterCount;
      const reward = rollWildBattleReward(data.monsterId, data.monsterCount);
      if (!reward) {
        sendJson(res, 400, { ok: false, error: "bad_monster_reward" });
        return;
      }
      if (data.exp != null || data.petExp != null || data.forgeGem != null || data.equipmentCount != null || data.fragments != null || data.equipment != null) {
        recordAnomaly(account, "client_reward_payload_ignored", {
          monsterId: data.monsterId,
          monsterCount: data.monsterCount,
          exp: data.exp,
          petExp: data.petExp,
          forgeGem: data.forgeGem,
          equipmentCount: data.equipmentCount,
          fragments: data.fragments,
          equipment: data.equipment
        }, 2, "ignore");
      }
      const existing = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!existing) {
        upsertPlayer({ account, name: account, x: 0, y: 0, mapName: "", level: 1, exp: 0, dragonSoul: 1 });
      }
      const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      detectUploadedPlayerStats(account, "/api/battle-reward", data, statsForPlayerRow(row));
      const leveled = applyExp(row.level, row.exp, reward.exp);
      const careerStage = careerTree.careerStage(safeJsonObject(row.selection_json));
      const previousCareerProgress = normalizeProgress({ level: row.career_level, exp: row.career_exp });
      const careerTransferReady = careerStage === 1 && previousCareerProgress.level >= careerTree.SECOND_TRANSFER_CAREER_LEVEL;
      const careerLeveled = careerStage > 0
        ? careerTransferReady
          ? { ...previousCareerProgress, atCap: true }
          : applyCareerExp(previousCareerProgress.level, previousCareerProgress.exp, reward.monsterCount, careerStage === 1 ? careerTree.SECOND_TRANSFER_CAREER_LEVEL : careerProgress.MAX_LEVEL)
        : previousCareerProgress;
      const activePetId = activePetIdForRow(row);
      const petProgressById = petProgressMapForRow(row);
      const previousPetProgress = petProgressById[String(activePetId)] || normalizeProgress();
      const petLeveled = applyExp(previousPetProgress.level, previousPetProgress.exp, reward.petExp);
      if (activePetId) petProgressById[String(activePetId)] = petLeveled;
      const mercenaryStateForReward = mercenaryState(row);
      const activeMercenary = mercenaryStateForReward.mercenaries.find((mercenary) => mercenary?.id === mercenaryStateForReward.activeMercenaryId) || null;
      const previousMercenaryProgress = activeMercenary ? normalizeProgress(activeMercenary) : null;
      const mercenaryLeveled = activeMercenary
        ? applyExp(previousMercenaryProgress.level, previousMercenaryProgress.exp, reward.mercenaryExp)
        : null;
      if (activeMercenary && mercenaryLeveled) Object.assign(activeMercenary, mercenaryLeveled);
      const equipment = safeJsonArray(row.equipment_json);
      let rewardEquipment = null;
      const rewardCount = Math.max(0, Math.min(5, reward.equipmentCount));
      for (let i = 0; i < rewardCount && equipment.length < bagCapacityForRow(row); i += 1) {
        const created = generateDroppedEquipment(reward.monsterLevel);
        equipment.push(created);
        if (!rewardEquipment) rewardEquipment = created;
      }
      const fragmentAdds = new Map();
      reward.fragments.forEach((drop) => {
        const item = fragmentById(String(drop.id || ""));
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
      `).run(leveled.level, leveled.exp, careerLeveled.level, careerLeveled.exp, petLeveled.level, petLeveled.exp, JSON.stringify(petProgressById), JSON.stringify(mercenaryStateForReward.mercenaries), reward.forgeGem, ...fragmentParams, JSON.stringify(equipment), updatedAt, account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, {
        ok: true,
        player: playerRowToApi(next),
        reward,
        previousLevel: row.level,
        previousPetLevel: previousPetProgress.level,
        level: next.level,
        exp: next.exp,
        previousCareerLevel: previousCareerProgress.level,
        careerLevel: careerLeveled.level,
        careerExp: careerLeveled.exp,
        careerTransferRequired: careerStage === 1 && careerLeveled.atCap,
        gainedCareerExp: careerStage > 0 ? reward.monsterCount : 0,
        dragonSoul: next.dragon_soul,
        petLevel: petLeveled.level,
        petExp: petLeveled.exp,
        petProgressById: petProgressMapForRow(next),
        previousMercenaryLevel: previousMercenaryProgress?.level ?? null,
        mercenaryId: activeMercenary?.id || "",
        mercenaryLevel: mercenaryLeveled?.level ?? null,
        mercenaryExp: mercenaryLeveled?.exp ?? null,
        mercenaries: safeJsonArray(next.mercenaries_json),
        forgeGem: next.forge_gem,
        gainedExp: reward.exp,
        gainedPetExp: reward.petExp,
        gainedMercenaryExp: activeMercenary ? reward.mercenaryExp : 0,
        gainedForgeGem: reward.forgeGem,
        fragments: reward.fragments,
        equipment: rewardEquipment
      });
      return;
    }
    if (url.pathname === "/api/phantom/submit") {
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 0));
      const row = db.prepare("SELECT name, server_id, phantom_fragment, phantom_points FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const owned = Math.max(0, Number(row.phantom_fragment) || 0);
      if (owned < quantity) {
        sendJson(res, 409, { ok: false, error: "not_enough_fragment", owned });
        return;
      }
      const updatedAt = new Date().toISOString();
      const points = (row.phantom_points || 0) + quantity;
      db.prepare("UPDATE players SET phantom_fragment = phantom_fragment - ?, phantom_points = ?, updated_at = ? WHERE account = ?")
        .run(quantity, points, updatedAt, account);
      db.prepare(`
        INSERT INTO phantom_rankings (server_id, account, name, points, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(server_id, account) DO UPDATE SET
          name = excluded.name,
          points = excluded.points,
          updated_at = excluded.updated_at
      `).run(row.server_id || DEFAULT_SERVER_ID, account, row.name || account, points, updatedAt);
      sendJson(res, 200, { ok: true, points, fragment: owned - quantity, rankings: phantomRankingRows(50, row.server_id || DEFAULT_SERVER_ID) });
      return;
    }
    if (url.pathname === "/api/phantom/claim-title") {
      const playerScope = db.prepare("SELECT server_id FROM players WHERE account = ?").get(account);
      const rankings = phantomRankingRows(50, playerScope?.server_id || DEFAULT_SERVER_ID);
      const entry = rankings.find((item) => item.account === account);
      if (!entry) {
        sendJson(res, 409, { ok: false, error: "not_ranked" });
        return;
      }
      const row = db.prepare("SELECT claimed_titles_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const title = phantomTitleForRank(entry.rank);
      const updatedAt = new Date().toISOString();
      const now = Date.now();
      const claimedEntries = normalizeClaimedTitles(row.claimed_titles_json, now).filter((item) => item.title !== title);
      const titleEntry = { title, claimedAt: updatedAt, expiresAt: new Date(now + PHANTOM_TITLE_DURATION_MS).toISOString() };
      const claimed = [...claimedEntries, titleEntry];
      db.prepare("UPDATE players SET claimed_titles_json = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(claimed), updatedAt, account);
      sendJson(res, 200, { ok: true, title, rank: entry.rank, boost: entry.boost, expiresAt: titleEntry.expiresAt, claimedTitles: claimedTitleNames(claimed), claimedTitleEntries: claimed });
      return;
    }
    if (url.pathname === "/api/title/equip") {
      const title = String(data.title || "").trim();
      const row = db.prepare("SELECT claimed_titles_json, equipped_title FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const claimedEntries = normalizeClaimedTitles(row.claimed_titles_json);
      const claimed = claimedTitleNames(claimedEntries);
      if (title && !claimed.includes(title)) {
        sendJson(res, 409, { ok: false, error: "title_not_owned" });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET claimed_titles_json = ?, equipped_title = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(claimedEntries), title, updatedAt, account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, {
        ok: true,
        equippedTitle: title,
        boost: phantomTitleBoost(title),
        claimedTitles: claimed,
        claimedTitleEntries: claimedEntries,
        player: playerRowToApi(next)
      });
      return;
    }
    if (url.pathname === "/api/immortal-boss/reward") {
      const bossId = String(data.bossId || "");
      const amount = immortalBossRewards[bossId] || 0;
      const pillAmount = immortalBossPillRewards[bossId] || 0;
      if (!amount) {
        sendJson(res, 400, { ok: false, error: "bad_boss" });
        return;
      }
      const existing = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!existing) {
        upsertPlayer({ account, name: account, x: 0, y: 0, mapName: "", level: 1, exp: 0, dragonSoul: 1 });
      }
      const row = db.prepare("SELECT soul_powder, immortal_boss_rewards_json FROM players WHERE account = ?").get(account);
      const rewards = safeJsonObject(row?.immortal_boss_rewards_json);
      const today = todayKey();
      if (rewards[bossId] === today) {
        sendJson(res, 409, { ok: false, error: "already_claimed_today", soulPowder: row?.soul_powder || 0 });
        return;
      }
      rewards[bossId] = today;
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET soul_powder = soul_powder + ?, immortal_pill = immortal_pill + ?, immortal_boss_rewards_json = ?, updated_at = ? WHERE account = ?")
        .run(amount, pillAmount, JSON.stringify(rewards), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, immortal_pill, immortal_boss_rewards_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, {
        ok: true,
        bossId,
        amount,
        pillAmount,
        soulPowder: next.soul_powder || 0,
        immortalPill: next.immortal_pill || 0,
        immortalBossRewards: safeJsonObject(next.immortal_boss_rewards_json)
      });
      return;
    }
    if (url.pathname === "/api/elf-king-vault/reward") {
      const bossId = String(data.bossId || "");
      const stage = elfKingVault.stageById(bossId);
      if (!stage) {
        sendJson(res, 400, { ok: false, error: "bad_boss" });
        return;
      }
      const existing = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!existing) {
        upsertPlayer({ account, name: account, x: 0, y: 0, mapName: "", level: 1, exp: 0, dragonSoul: 1 });
      }
      const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const today = todayKey();
      const progress = elfKingVault.normalizeProgress(safeJsonObject(row.elf_king_vault_rewards_json), today);
      const challenge = elfKingVault.canChallenge(progress, stage, today);
      if (!challenge.ok) {
        sendJson(res, 409, { ok: false, error: challenge.error, elfKingVaultProgress: progress });
        return;
      }
      const items = rollElfKingVaultRewards(stage);
      const updatedAt = new Date().toISOString();
      const titleGrant = grantElfKingVaultTitle(row, stage, updatedAt);
      const nextProgress = {
        date: today,
        claimed: { ...(progress.claimed || {}), [stage.id]: true }
      };
      const rewardColumns = [];
      const rewardParams = [];
      for (const item of items) {
        const column = itemColumnForId(item.id);
        if (!column) {
          sendJson(res, 500, { ok: false, error: "bad_reward_item", itemId: item.id });
          return;
        }
        rewardColumns.push(`${column} = ${column} + ?`);
        rewardParams.push(Math.max(1, Number(item.quantity) || 1));
      }
      const titleSql = titleGrant ? ", claimed_titles_json = ?" : "";
      const titleParams = titleGrant ? [JSON.stringify(titleGrant.claimedEntries)] : [];
      db.prepare(`UPDATE players SET ${rewardColumns.join(", ")}, elf_king_vault_rewards_json = ?${titleSql}, updated_at = ? WHERE account = ?`)
        .run(...rewardParams, JSON.stringify(nextProgress), ...titleParams, updatedAt, account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, {
        ok: true,
        bossId,
        stage: stage.stage,
        stageName: stage.name,
        items,
        titleReward: titleGrant ? titleGrant.entry : null,
        elfKingVaultProgress: nextProgress,
        player: playerRowToApi(next)
      });
      return;
    }
    if (url.pathname === "/api/dragon-soul/evolve") {
      const result = dragonSoulRuntime.evolve(account);
      sendJson(res, result.status || 200, result);
      return;
    }
    if (url.pathname === "/api/bag/use") {
      if (String(data.id || "") !== "elf_waist_bag") {
        sendJson(res, 400, { ok: false, error: "item_not_usable" });
        return;
      }
      const row = db.prepare("SELECT elf_waist_bag, bag_capacity_bonus FROM players WHERE account = ?").get(account);
      if (!row || Number(row.elf_waist_bag) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_item" });
        return;
      }
      const currentCapacity = bagCapacityForRow(row);
      if (currentCapacity >= 300) {
        sendJson(res, 409, { ok: false, error: "bag_capacity_max" });
        return;
      }
      const bonus = Math.min(300 - careerTree.BAG_CAPACITY, Math.max(0, Number(row.bag_capacity_bonus) || 0) + 10);
      db.prepare("UPDATE players SET elf_waist_bag = elf_waist_bag - 1, bag_capacity_bonus = ?, updated_at = ? WHERE account = ?")
        .run(bonus, new Date().toISOString(), account);
      const next = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, capacity: bagCapacityForRow(next), items: playerBagItems(next), player: playerRowToApi(next) });
      return;
    }
    if (url.pathname === "/api/equipment/equip") {
      const id = String(data.id || "");
      const requestedSlot = String(data.slot || "");
      const row = db.prepare("SELECT equipment_json, equipped_json FROM players WHERE account = ?").get(account);
      const equipment = safeJsonArray(row?.equipment_json);
      const item = equipment.find((entry) => entry.id === id);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "equipment_not_found" });
        return;
      }
      if (item.damaged) {
        sendJson(res, 409, { ok: false, error: "damaged_equipment" });
        return;
      }
      const slot = requestedSlot || equipmentSlotForType(item.type);
      if (!equipmentSlots[slot]?.includes(item.type)) {
        sendJson(res, 400, { ok: false, error: "invalid_equipment_slot" });
        return;
      }
      const equipped = safeJsonObject(row?.equipped_json);
      equipped[slot] = item.id;
      if (slot !== item.type && equipped[item.type] === item.id) delete equipped[item.type];
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET equipped_json = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(equipped), updatedAt, account);
      sendJson(res, 200, { ok: true, equipped });
      return;
    }
    if (url.pathname === "/api/equipment/unequip") {
      const id = String(data.id || "");
      const slot = String(data.slot || "");
      const row = db.prepare("SELECT equipped_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const equipped = safeJsonObject(row.equipped_json);
      if (slot) {
        delete equipped[slot];
      } else if (id) {
        Object.keys(equipped).forEach((key) => {
          if (equipped[key] === id) delete equipped[key];
        });
      } else {
        sendJson(res, 400, { ok: false, error: "missing_target" });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET equipped_json = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(equipped), updatedAt, account);
      sendJson(res, 200, { ok: true, equipped });
      return;
    }
    if (url.pathname === "/api/bag/discard") {
      const id = String(data.id || "");
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      const fragmentColumns = fragmentItems.map((item) => item.column).join(", ");
      const skillCardColumns = skillCardItems.map((item) => item.column).join(", ");
      const row = db.prepare(`SELECT forge_gem, soul_powder, mysterious_paint, lucky_box_items_json, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const column = itemColumnForId(id);
      if (column) {
        const owned = Math.max(0, Number(row[column]) || 0);
        if (owned < quantity) {
          sendJson(res, 409, { ok: false, error: "not_enough_item" });
          return;
        }
        const updatedAt = new Date().toISOString();
        db.prepare(`UPDATE players SET ${column} = ${column} - ?, updated_at = ? WHERE account = ?`).run(quantity, updatedAt, account);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (luckyBoxItemMeta(id)) {
        const items = safeJsonObject(row.lucky_box_items_json);
        const owned = Math.max(0, Math.floor(Number(items[id]) || 0));
        if (owned < quantity) {
          sendJson(res, 409, { ok: false, error: "not_enough_item" });
          return;
        }
        if (owned === quantity) delete items[id];
        else items[id] = owned - quantity;
        db.prepare("UPDATE players SET lucky_box_items_json = ?, updated_at = ? WHERE account = ?")
          .run(JSON.stringify(items), new Date().toISOString(), account);
        sendJson(res, 200, { ok: true });
        return;
      }
      const equipment = safeJsonArray(row.equipment_json);
      const equipped = safeJsonObject(row.equipped_json);
      if (Object.values(equipped).includes(id)) {
        sendJson(res, 409, { ok: false, error: "equipped_item" });
        return;
      }
      const nextEquipment = equipment.filter((item) => item.id !== id);
      if (nextEquipment.length === equipment.length) {
        sendJson(res, 404, { ok: false, error: "item_not_found" });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET equipment_json = ?, updated_at = ? WHERE account = ?").run(JSON.stringify(nextEquipment), updatedAt, account);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/bag/give") {
      const id = String(data.id || "");
      const toName = String(data.toName || "").trim();
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      if (isUntradeableItemId(id)) {
        sendJson(res, 409, { ok: false, error: "untradeable_item" });
        return;
      }
      const fragmentColumns = fragmentItems.map((item) => item.column).join(", ");
      const skillCardColumns = skillCardItems.map((item) => item.column).join(", ");
      const row = db.prepare(`SELECT server_id, forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const target = db.prepare(`
        SELECT account, equipment_json
        FROM players
        WHERE server_id = ? AND (name = ? OR account = ?)
      `).get(row.server_id, toName, toName);
      if (!target || target.account === account) {
        sendJson(res, 404, { ok: false, error: "target_not_found" });
        return;
      }
      if (!requireOnlineTargetInSessionRealm(req, res, target.account, url, data)) return;
      const updatedAt = new Date().toISOString();
      const column = itemColumnForId(id);
      if (column) {
        const owned = Math.max(0, Number(row[column]) || 0);
        if (owned < quantity) {
          sendJson(res, 409, { ok: false, error: "not_enough_item" });
          return;
        }
        db.prepare(`UPDATE players SET ${column} = ${column} - ?, updated_at = ? WHERE account = ?`).run(quantity, updatedAt, account);
        db.prepare(`UPDATE players SET ${column} = ${column} + ?, updated_at = ? WHERE account = ?`).run(quantity, updatedAt, target.account);
        sendJson(res, 200, { ok: true, to: target.account });
        return;
      }
      const equipment = safeJsonArray(row.equipment_json);
      const equipped = safeJsonObject(row.equipped_json);
      if (Object.values(equipped).includes(id)) {
        sendJson(res, 409, { ok: false, error: "equipped_item" });
        return;
      }
      const item = equipment.find((entry) => entry.id === id);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "item_not_found" });
        return;
      }
      const targetEquipment = safeJsonArray(target.equipment_json);
      if (targetEquipment.length >= bagCapacityForRow(target)) {
        sendJson(res, 409, { ok: false, error: "target_bag_full" });
        return;
      }
      db.prepare("UPDATE players SET equipment_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(equipment.filter((entry) => entry.id !== id)), updatedAt, account);
      db.prepare("UPDATE players SET equipment_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify([...targetEquipment, { ...item, equipped: false }]), updatedAt, target.account);
      sendJson(res, 200, { ok: true, to: target.account });
      return;
    }
    if (url.pathname === "/api/stall/buy") {
      const sellerAccount = String(data.sellerAccount || "").trim();
      const id = String(data.id || "");
      const price = Math.max(1, Math.floor(Number(data.price) || 0));
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      if (!sellerAccount || sellerAccount === account || !id || price <= 0) {
        sendJson(res, 400, { ok: false, error: "bad_stall_buy" });
        return;
      }
      const fragmentColumns = fragmentItems.map((item) => item.column).join(", ");
      const skillCardColumns = skillCardItems.map((item) => item.column).join(", ");
      const seller = db.prepare(`SELECT account, server_id, silver, forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json FROM players WHERE account = ?`).get(sellerAccount);
      const buyer = db.prepare(`SELECT account, server_id, silver, forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json FROM players WHERE account = ?`).get(account);
      if (!seller || !buyer) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if (seller.server_id !== buyer.server_id) {
        sendJson(res, 409, { ok: false, error: "cross_server_forbidden" });
        return;
      }
      if (!requireOnlineTargetInSessionRealm(req, res, seller.account, url, data)) return;
      if ((buyer.silver || 0) < price) {
        sendJson(res, 409, { ok: false, error: "not_enough_silver", silver: buyer.silver || 0 });
        return;
      }
      const updatedAt = new Date().toISOString();
      const column = itemColumnForId(id);
      if (column && isUntradeableItemId(id)) {
        sendJson(res, 409, { ok: false, error: "untradeable_item" });
        return;
      }
      try {
        db.exec("BEGIN");
        if (column) {
          const owned = Math.max(0, Number(seller[column]) || 0);
          if (owned < quantity) throw new Error("not_enough_item");
          db.prepare(`UPDATE players SET ${column} = ${column} - ?, silver = silver + ?, updated_at = ? WHERE account = ?`).run(quantity, price, updatedAt, sellerAccount);
          db.prepare(`UPDATE players SET ${column} = ${column} + ?, silver = silver - ?, updated_at = ? WHERE account = ?`).run(quantity, price, updatedAt, account);
        } else {
          const sellerEquipment = safeJsonArray(seller.equipment_json);
          const sellerEquipped = safeJsonObject(seller.equipped_json);
          if (Object.values(sellerEquipped).includes(id)) throw new Error("equipped_item");
          const item = sellerEquipment.find((entry) => entry.id === id);
          if (!item) throw new Error("item_not_found");
          const buyerEquipment = safeJsonArray(buyer.equipment_json);
          if (buyerEquipment.length >= bagCapacityForRow(buyer)) throw new Error("bag_full");
          db.prepare("UPDATE players SET equipment_json = ?, silver = silver + ?, updated_at = ? WHERE account = ?")
            .run(JSON.stringify(sellerEquipment.filter((entry) => entry.id !== id)), price, updatedAt, sellerAccount);
          db.prepare("UPDATE players SET equipment_json = ?, silver = silver - ?, updated_at = ? WHERE account = ?")
            .run(JSON.stringify([...buyerEquipment, { ...item, equipped: false }]), price, updatedAt, account);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        const message = error.message || "stall_buy_failed";
        const status = ["not_enough_item", "equipped_item", "item_not_found", "bag_full", "untradeable_item"].includes(message) ? 409 : 500;
        sendJson(res, status, { ok: false, error: message });
        return;
      }
      const nextSeller = db.prepare(`SELECT silver, forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json, storage_json FROM players WHERE account = ?`).get(sellerAccount);
      const nextBuyer = db.prepare(`SELECT silver, forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json, storage_json FROM players WHERE account = ?`).get(account);
      sendJson(res, 200, {
        ok: true,
        sellerAccount,
        buyerAccount: account,
        id,
        quantity,
        price,
        sellerSilver: nextSeller.silver || 0,
        buyerSilver: nextBuyer.silver || 0,
        sellerItems: playerBagItems(nextSeller),
        buyerItems: playerBagItems(nextBuyer)
      });
      return;
    }
    if (url.pathname === "/api/storage/deposit") {
      const id = String(data.id || "");
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      const fragmentColumns = fragmentItems.map((item) => item.column).join(", ");
      const skillCardColumns = skillCardItems.map((item) => item.column).join(", ");
      const row = db.prepare(`SELECT forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json, storage_json FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const storage = normalizeStorage(row.storage_json);
      const updatedAt = new Date().toISOString();
      const column = itemColumnForId(id);
      if (column) {
        const owned = Math.max(0, Number(row[column]) || 0);
        if (owned < quantity) {
          sendJson(res, 409, { ok: false, error: "not_enough_item" });
          return;
        }
        const createsSlot = !storage.materials[id] || Number(storage.materials[id]) <= 0;
        if (createsSlot && storageUsedSlots(storage) >= 300) {
          sendJson(res, 409, { ok: false, error: "storage_full" });
          return;
        }
        storage.materials[id] = (Number(storage.materials[id]) || 0) + quantity;
        db.prepare(`UPDATE players SET ${column} = ${column} - ?, storage_json = ?, updated_at = ? WHERE account = ?`)
          .run(quantity, JSON.stringify(storage), updatedAt, account);
        sendJson(res, 200, { ok: true, storageItems: storageItems(storage), used: storageUsedSlots(storage), capacity: 300 });
        return;
      }
      const equipment = safeJsonArray(row.equipment_json);
      const equipped = safeJsonObject(row.equipped_json);
      if (Object.values(equipped).includes(id)) {
        sendJson(res, 409, { ok: false, error: "equipped_item" });
        return;
      }
      const item = equipment.find((entry) => entry.id === id);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "item_not_found" });
        return;
      }
      if (storageUsedSlots(storage) >= 300) {
        sendJson(res, 409, { ok: false, error: "storage_full" });
        return;
      }
      storage.equipment.push({ ...item, equipped: false });
      db.prepare("UPDATE players SET equipment_json = ?, storage_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(equipment.filter((entry) => entry.id !== id)), JSON.stringify(storage), updatedAt, account);
      sendJson(res, 200, { ok: true, storageItems: storageItems(storage), used: storageUsedSlots(storage), capacity: 300 });
      return;
    }
    if (url.pathname === "/api/storage/withdraw") {
      const id = String(data.id || "");
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      const column = itemColumnForId(id);
      const row = db.prepare("SELECT storage_json, equipment_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const storage = normalizeStorage(row.storage_json);
      const updatedAt = new Date().toISOString();
      if (column) {
        const stored = Math.max(0, Number(storage.materials[id]) || 0);
        if (stored < quantity) {
          sendJson(res, 409, { ok: false, error: "not_enough_item" });
          return;
        }
        storage.materials[id] = stored - quantity;
        if (storage.materials[id] <= 0) delete storage.materials[id];
        db.prepare(`UPDATE players SET ${column} = ${column} + ?, storage_json = ?, updated_at = ? WHERE account = ?`)
          .run(quantity, JSON.stringify(storage), updatedAt, account);
        sendJson(res, 200, { ok: true, storageItems: storageItems(storage), used: storageUsedSlots(storage), capacity: 300 });
        return;
      }
      const equipment = safeJsonArray(row.equipment_json);
      if (equipment.length >= bagCapacityForRow(row)) {
        sendJson(res, 409, { ok: false, error: "bag_full" });
        return;
      }
      const item = storage.equipment.find((entry) => entry.id === id);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "item_not_found" });
        return;
      }
      storage.equipment = storage.equipment.filter((entry) => entry.id !== id);
      db.prepare("UPDATE players SET equipment_json = ?, storage_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify([...equipment, { ...item, equipped: false }]), JSON.stringify(storage), updatedAt, account);
      sendJson(res, 200, { ok: true, storageItems: storageItems(storage), used: storageUsedSlots(storage), capacity: 300 });
      return;
    }
    if (url.pathname === "/api/shop/sell") {
      const id = String(data.id || "");
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      const fragmentColumns = fragmentItems.map((item) => item.column).join(", ");
      const skillCardColumns = skillCardItems.map((item) => item.column).join(", ");
      const row = db.prepare(`SELECT silver, forge_gem, soul_powder, mysterious_paint, ${fragmentColumns}, ${skillCardColumns}, equipment_json, equipped_json FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const column = itemColumnForId(id);
      const updatedAt = new Date().toISOString();
      if (column) {
        const owned = Math.max(0, Number(row[column]) || 0);
        if (owned < quantity) {
          sendJson(res, 409, { ok: false, error: "not_enough_item" });
          return;
        }
        const silverGain = materialSellPrice(id) * quantity;
        db.prepare(`UPDATE players SET ${column} = ${column} - ?, silver = silver + ?, updated_at = ? WHERE account = ?`).run(quantity, silverGain, updatedAt, account);
        const next = db.prepare("SELECT silver FROM players WHERE account = ?").get(account);
        sendJson(res, 200, { ok: true, silverGain, silver: next.silver });
        return;
      }
      const equipment = safeJsonArray(row.equipment_json);
      const equipped = safeJsonObject(row.equipped_json);
      if (Object.values(equipped).includes(id)) {
        sendJson(res, 409, { ok: false, error: "equipped_item" });
        return;
      }
      const item = equipment.find((entry) => entry.id === id);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "item_not_found" });
        return;
      }
      if (item.kind === "fashion" || item.type === "fashion") {
        sendJson(res, 409, { ok: false, error: "fashion_not_sellable" });
        return;
      }
      const silverGain = equipmentSellPrice(item);
      db.prepare("UPDATE players SET equipment_json = ?, silver = silver + ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(equipment.filter((entry) => entry.id !== id)), silverGain, updatedAt, account);
      const next = db.prepare("SELECT silver FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, silverGain, silver: next.silver });
      return;
    }
    if (url.pathname === "/api/shop/buy") {
      sendJson(res, 410, { ok: false, error: "legacy_shop_removed" });
      return;
    }
    if (url.pathname === "/api/yuanbao-shop/buy") {
      const itemId = String(data.itemId || "");
      const quantity = Math.max(1, Math.min(999, Math.floor(Number(data.quantity) || 1)));
      const shopItem = itemId === luckyBoxModule.boxId
        ? { id: luckyBoxModule.boxId, price: luckyBoxModule.boxPrice, kind: "box" }
        : luckyBoxItemMeta(itemId) ? { id: itemId, price: luckyBoxItemMeta(itemId).value, kind: "item" } : null;
      if (!shopItem) {
        sendJson(res, 409, { ok: false, error: "invalid_shop_item" });
        return;
      }
      const price = shopItem.price * quantity;
      let next;
      try {
        db.exec("BEGIN IMMEDIATE");
        const row = db.prepare("SELECT yuanbao, lucky_box, lucky_box_items_json FROM players WHERE account = ?").get(account);
        if (!row) throw new Error("player_not_found");
        if ((row.yuanbao || 0) < price) throw new Error("not_enough_yuanbao");
        const updatedAt = new Date().toISOString();
        if (shopItem.kind === "box") {
          db.prepare("UPDATE players SET yuanbao = yuanbao - ?, lucky_box = lucky_box + ?, updated_at = ? WHERE account = ?")
            .run(price, quantity, updatedAt, account);
        } else {
          const items = safeJsonObject(row.lucky_box_items_json);
          items[itemId] = Math.max(0, Math.floor(Number(items[itemId]) || 0)) + quantity;
          db.prepare("UPDATE players SET yuanbao = yuanbao - ?, lucky_box_items_json = ?, updated_at = ? WHERE account = ?")
            .run(price, JSON.stringify(items), updatedAt, account);
        }
        next = db.prepare("SELECT yuanbao, lucky_box FROM players WHERE account = ?").get(account);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        const status = error.message === "player_not_found" ? 404 : error.message === "not_enough_yuanbao" ? 409 : 500;
        const code = ["player_not_found", "not_enough_yuanbao"].includes(error.message) ? error.message : "yuanbao_shop_buy_failed";
        sendJson(res, status, { ok: false, error: code });
        return;
      }
      sendJson(res, 200, { ok: true, yuanbao: next.yuanbao || 0, luckyBox: next.lucky_box || 0, quantity, price });
      return;
    }
    if (url.pathname === "/api/lucky-box/open") {
      let row;
      let reward;
      let next;
      try {
        db.exec("BEGIN IMMEDIATE");
        row = db.prepare("SELECT name, lucky_box, lucky_box_items_json FROM players WHERE account = ?").get(account);
        if (!row) throw new Error("player_not_found");
        if ((row.lucky_box || 0) < 1) throw new Error("not_enough_box");
        reward = luckyBoxRoll();
        const meta = luckyBoxItemMeta(reward.id);
        if (!meta) throw new Error("bad_reward");
        const items = safeJsonObject(row.lucky_box_items_json);
        const current = Math.max(0, Math.floor(Number(items[reward.id]) || 0));
        items[reward.id] = current + 1;
        const updatedAt = new Date().toISOString();
        db.prepare("UPDATE players SET lucky_box = lucky_box - 1, lucky_box_items_json = ?, updated_at = ? WHERE account = ?")
          .run(JSON.stringify(items), updatedAt, account);
        next = db.prepare("SELECT lucky_box, lucky_box_items_json FROM players WHERE account = ?").get(account);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        const status = error.message === "player_not_found" ? 404 : error.message === "not_enough_box" ? 409 : 500;
        const code = ["player_not_found", "not_enough_box", "bad_reward"].includes(error.message) ? error.message : "lucky_box_open_failed";
        sendJson(res, status, { ok: false, error: code });
        return;
      }
      const meta = { id: reward.id, name: reward.name, icon: reward.icon };
      const session = authSessionFromToken(authTokenFromRequest(req, url, data));
      const lineNumber = Math.max(1, Math.floor(Number(session?.channelId) || 1));
      const lineLabel = ["", "一", "二", "三", "四", "五", "六"][lineNumber] || String(lineNumber);
      const displayRewardName = `${meta.name}${reward.quantity > 1 ? ` x${reward.quantity}` : ""}`;
      const rewardToken = `[item:${encodeURIComponent(meta.icon)}:item:${encodeURIComponent(displayRewardName)}]`;
      chatRuntime.broadcastSystemAnnouncement({
        serverId: session?.serverId,
        text: `特报！${row.name || account}获得好运宝箱的大奖${rewardToken}(${lineLabel}线)`
      });
      sendJson(res, 200, {
        ok: true,
        reward: { ...reward, name: meta.name, icon: meta.icon, pendingGrant: false },
        luckyBox: next.lucky_box || 0,
        items: playerBagItems(next)
      });
      return;
    }
    if (url.pathname === "/api/shop/sell-all-equipment") {
      const row = db.prepare("SELECT silver, equipment_json, equipped_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const equippedIds = new Set(Object.values(safeJsonObject(row.equipped_json)));
      const equipment = safeJsonArray(row.equipment_json);
      const kept = [];
      let silverGain = 0;
      let soldCount = 0;
      equipment.forEach((item) => {
        if (equippedIds.has(item.id) || item.kind === "fashion" || item.type === "fashion" || equipmentSlots.demonWeapon.includes(item.type)) {
          kept.push(item);
        } else {
          soldCount += 1;
          silverGain += equipmentSellPrice(item);
        }
      });
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET equipment_json = ?, silver = silver + ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(kept), silverGain, updatedAt, account);
      const next = db.prepare("SELECT silver FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, soldCount, silverGain, silver: next.silver });
      return;
    }
    if (url.pathname === "/api/skill/fragment-exchange") {
      const kind = String(data.kind || "peerless");
      const config = kind === "holy"
        ? { fragment: "holy_skill_fragment", ticket: "holy_skill_ticket" }
        : kind === "role"
          ? { fragment: "peerless_role_skill_fragment", ticket: "peerless_role_skill_ticket" }
          : { fragment: "peerless_skill_fragment", ticket: "peerless_skill_ticket" };
      const row = db.prepare(`SELECT ${config.fragment} AS fragment, ${config.ticket} AS ticket FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.fragment || 0) < 9999) {
        sendJson(res, 409, { ok: false, error: "not_enough_fragment", need: 9999, owned: row.fragment || 0 });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare(`UPDATE players SET ${config.fragment} = ${config.fragment} - 9999, ${config.ticket} = ${config.ticket} + 1, updated_at = ? WHERE account = ?`)
        .run(updatedAt, account);
      const next = db.prepare(`SELECT ${config.fragment} AS fragment, ${config.ticket} AS ticket FROM players WHERE account = ?`).get(account);
      sendJson(res, 200, { ok: true, kind, fragment: next.fragment, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/fashion/fragment-exchange") {
      const row = db.prepare("SELECT fashion_ticket_fragment, fashion_ticket FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.fashion_ticket_fragment || 0) < 9999) {
        sendJson(res, 409, { ok: false, error: "not_enough_fragment", need: 9999, owned: row.fashion_ticket_fragment || 0 });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET fashion_ticket_fragment = fashion_ticket_fragment - 9999, fashion_ticket = fashion_ticket + 1, updated_at = ? WHERE account = ?")
        .run(updatedAt, account);
      const next = db.prepare("SELECT fashion_ticket_fragment AS fragment, fashion_ticket AS ticket FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, fragment: next.fragment, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/holy-weapon/fragment-exchange") {
      const row = db.prepare("SELECT peerless_holy_weapon_fragment, peerless_holy_weapon_ticket FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.peerless_holy_weapon_fragment || 0) < 9999) {
        sendJson(res, 409, { ok: false, error: "not_enough_fragment", need: 9999, owned: row.peerless_holy_weapon_fragment || 0 });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET peerless_holy_weapon_fragment = peerless_holy_weapon_fragment - 9999, peerless_holy_weapon_ticket = peerless_holy_weapon_ticket + 1, updated_at = ? WHERE account = ?")
        .run(updatedAt, account);
      const next = db.prepare("SELECT peerless_holy_weapon_fragment AS fragment, peerless_holy_weapon_ticket AS ticket FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, fragment: next.fragment, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/holy-weapon/ticket-exchange") {
      const weaponType = String(data.weaponType || "");
      const weapon = makeDemonWeapon(weaponType);
      if (!weapon) {
        sendJson(res, 400, { ok: false, error: "invalid_weapon" });
        return;
      }
      const row = db.prepare("SELECT peerless_holy_weapon_ticket, equipment_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.peerless_holy_weapon_ticket || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_ticket" });
        return;
      }
      const equipment = safeJsonArray(row.equipment_json);
      if (equipment.length >= bagCapacityForRow(row)) {
        sendJson(res, 409, { ok: false, error: "bag_full" });
        return;
      }
      equipment.push(weapon);
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET peerless_holy_weapon_ticket = peerless_holy_weapon_ticket - 1, equipment_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(equipment), updatedAt, account);
      const next = db.prepare("SELECT peerless_holy_weapon_ticket AS ticket FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, weapon, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/fashion/ticket-exchange") {
      const fashionId = String(data.fashionId || "");
      const gender = String(data.gender || "");
      const fashion = fashionCatalog.find((item) => item.id === fashionId);
      if (!fashion) {
        sendJson(res, 400, { ok: false, error: "invalid_fashion" });
        return;
      }
      if (fashion.gender !== "通用" && fashion.gender !== gender) {
        sendJson(res, 400, { ok: false, error: "gender_mismatch" });
        return;
      }
      const row = db.prepare("SELECT fashion_ticket, equipment_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const equipment = normalizeEquipmentList(row.equipment_json, account).equipment;
      const ownedFashion = equipment.find((item) => (item.kind === "fashion" || item.type === "fashion") && (item.baseId || item.id) === fashion.id);
      if (ownedFashion) {
        sendJson(res, 200, { ok: true, fashion: ownedFashion, ticket: row.fashion_ticket || 0, alreadyOwned: true });
        return;
      }
      if ((row.fashion_ticket || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_ticket" });
        return;
      }
      if (equipment.length >= bagCapacityForRow(row)) {
        sendJson(res, 409, { ok: false, error: "bag_full" });
        return;
      }
      const item = {
        id: `${fashion.id}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        baseId: fashion.id,
        kind: "fashion",
        type: "fashion",
        name: fashion.name,
        spriteId: fashion.spriteId,
        gender: fashion.gender,
        icon: fashion.icon,
        statBoost: 0.3,
        createdAt: new Date().toISOString()
      };
      equipment.push(item);
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET fashion_ticket = fashion_ticket - 1, equipment_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(equipment), updatedAt, account);
      const next = db.prepare("SELECT fashion_ticket AS ticket FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, fashion: item, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/skill/ticket-exchange") {
      const cardId = String(data.cardId || "");
      const ticketColumn = cardId.startsWith("skill_card_holy_")
        ? "holy_skill_ticket"
        : cardId.startsWith("skill_card_role_")
          ? "peerless_role_skill_ticket"
          : "peerless_skill_ticket";
      const card = skillCardItems.find((item) => item.id === cardId && item.skillId);
      if (!card) {
        sendJson(res, 400, { ok: false, error: "invalid_card" });
        return;
      }
      const row = db.prepare(`SELECT ${ticketColumn} AS ticket FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.ticket || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_ticket" });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare(`UPDATE players SET ${ticketColumn} = ${ticketColumn} - 1, ${card.column} = ${card.column} + 1, updated_at = ? WHERE account = ?`)
        .run(updatedAt, account);
      const next = db.prepare(`SELECT ${ticketColumn} AS ticket, ${card.column} AS card_count FROM players WHERE account = ?`).get(account);
      sendJson(res, 200, { ok: true, ticket: next.ticket, card: cardId, cardCount: next.card_count });
      return;
    }
    if (url.pathname === "/api/pet-scroll/fragment-exchange") {
      const row = db.prepare("SELECT peerless_pet_scroll_fragment, peerless_pet_scroll_ticket FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.peerless_pet_scroll_fragment || 0) < 9999) {
        sendJson(res, 409, { ok: false, error: "not_enough_fragment", need: 9999, owned: row.peerless_pet_scroll_fragment || 0 });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET peerless_pet_scroll_fragment = peerless_pet_scroll_fragment - 9999, peerless_pet_scroll_ticket = peerless_pet_scroll_ticket + 1, updated_at = ? WHERE account = ?")
        .run(updatedAt, account);
      const next = db.prepare("SELECT peerless_pet_scroll_fragment AS fragment, peerless_pet_scroll_ticket AS ticket FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, fragment: next.fragment, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/pet-scroll/summon") {
      const petId = normalizePetId(data.petId);
      if (!peerlessPetIds.has(petId)) {
        sendJson(res, 400, { ok: false, error: "invalid_pet" });
        return;
      }
      const row = db.prepare("SELECT owned_pets_json, peerless_pet_scroll_ticket FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.peerless_pet_scroll_ticket || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_ticket" });
        return;
      }
      const initialPetId = Number(data.initialPetId) || 0;
      const ownedPets = [...new Set([...safeJsonArray(row.owned_pets_json).map(Number).filter(Boolean), initialPetId].filter(Boolean))];
      if (ownedPets.includes(petId)) {
        sendJson(res, 409, { ok: false, error: "already_owned", ownedPets });
        return;
      }
      ownedPets.push(petId);
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET peerless_pet_scroll_ticket = peerless_pet_scroll_ticket - 1, owned_pets_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(ownedPets), updatedAt, account);
      const next = db.prepare("SELECT peerless_pet_scroll_ticket AS ticket FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, petId, ownedPets, ticket: next.ticket });
      return;
    }
    if (url.pathname === "/api/pet/learn-skill") {
      const petId = String(data.petId || "");
      const cardId = String(data.cardId || "");
      const card = skillCardItems.find((item) => item.id === cardId && item.skillId);
      if (!card) {
        sendJson(res, 400, { ok: false, error: "invalid_card" });
        return;
      }
      const row = db.prepare(`SELECT owned_pets_json, pet_extra_skills_json, ${card.column} AS card_count FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const ownedPets = safeJsonArray(row.owned_pets_json).map(String);
      if (!ownedPets.includes(petId) && !ownedPets.includes(String(Number(petId)))) {
        sendJson(res, 409, { ok: false, error: "pet_not_owned" });
        return;
      }
      if ((row.card_count || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_card" });
        return;
      }
      const extra = safeJsonObject(row.pet_extra_skills_json);
      const skills = Array.isArray(extra[petId]) ? extra[petId] : [];
      if (skills.includes(card.skillId)) {
        sendJson(res, 409, { ok: false, error: "already_learned" });
        return;
      }
      extra[petId] = [...new Set([...skills, card.skillId])];
      const updatedAt = new Date().toISOString();
      db.prepare(`UPDATE players SET ${card.column} = ${card.column} - 1, pet_extra_skills_json = ?, updated_at = ? WHERE account = ?`)
        .run(JSON.stringify(extra), updatedAt, account);
      sendJson(res, 200, { ok: true, petId, skillId: card.skillId, petExtraSkills: extra });
      return;
    }
    if (url.pathname === "/api/role/learn-skill") {
      const cardId = String(data.cardId || "");
      const card = skillCardItems.find((item) => item.id === cardId && item.skillId && item.id.startsWith("skill_card_role_"));
      if (!card) {
        sendJson(res, 400, { ok: false, error: "invalid_card" });
        return;
      }
      const row = db.prepare(`SELECT role_extra_skills_json, ${card.column} AS card_count FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.card_count || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_card" });
        return;
      }
      const skills = safeJsonArray(row.role_extra_skills_json);
      if (skills.includes(card.skillId)) {
        sendJson(res, 409, { ok: false, error: "already_learned" });
        return;
      }
      const nextSkills = [...new Set([...skills, card.skillId])];
      const updatedAt = new Date().toISOString();
      db.prepare(`UPDATE players SET ${card.column} = ${card.column} - 1, role_extra_skills_json = ?, updated_at = ? WHERE account = ?`)
        .run(JSON.stringify(nextSkills), updatedAt, account);
      sendJson(res, 200, { ok: true, skillId: card.skillId, roleExtraSkills: nextSkills });
      return;
    }
    if (url.pathname === "/api/mercenary/recruit") {
      const type = String(data.type || "");
      if (!mercenaryTypes[type]) {
        sendJson(res, 400, { ok: false, error: "invalid_mercenary" });
        return;
      }
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.soul_powder || 0) < 200) {
        sendJson(res, 409, { ok: false, error: "not_enough_powder", soulPowder: row.soul_powder || 0 });
        return;
      }
      const state = mercenaryState(row);
      if (state.mercenaries.some((merc) => merc.type === type)) {
        sendJson(res, 409, { ok: false, error: "already_owned", ...mercenaryPayload(row) });
        return;
      }
      const mercenary = makeMercenary(type);
      state.mercenaries.push(mercenary);
      const activeId = state.activeMercenaryId || mercenary.id;
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET soul_powder = soul_powder - 200, mercenaries_json = ?, active_mercenary_id = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(state.mercenaries), activeId, updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, recruited: mercenary, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/active") {
      const mercenaryId = String(data.mercenaryId || "");
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const state = mercenaryState(row);
      if (mercenaryId && !state.mercenaries.some((merc) => merc.id === mercenaryId)) {
        sendJson(res, 404, { ok: false, error: "mercenary_not_found" });
        return;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET active_mercenary_id = ?, updated_at = ? WHERE account = ?")
        .run(mercenaryId, updatedAt, account);
      const next = { ...row, active_mercenary_id: mercenaryId };
      sendJson(res, 200, { ok: true, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/learn-skill") {
      const mercenaryId = String(data.mercenaryId || "");
      const cardId = String(data.cardId || "");
      const card = skillCardItems.find((item) => item.id === cardId && item.skillId);
      if (!card || !mercenaryHolySkillIds.has(card.skillId)) {
        sendJson(res, 400, { ok: false, error: "invalid_mercenary_skill_card" });
        return;
      }
      const row = db.prepare(`SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json, ${card.column} AS card_count FROM players WHERE account = ?`).get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.card_count || 0) < 1) {
        sendJson(res, 409, { ok: false, error: "not_enough_card" });
        return;
      }
      const state = mercenaryState(row);
      const mercenary = state.mercenaries.find((merc) => merc.id === mercenaryId);
      if (!mercenary) {
        sendJson(res, 404, { ok: false, error: "mercenary_not_found" });
        return;
      }
      mercenary.passiveSkills = Array.isArray(mercenary.passiveSkills) ? mercenary.passiveSkills : [];
      mercenary.extraSkills = Array.isArray(mercenary.extraSkills) ? mercenary.extraSkills : [];
      const learnedSkills = new Set([...mercenary.passiveSkills, ...mercenary.extraSkills]);
      if (learnedSkills.has(card.skillId)) {
        sendJson(res, 409, { ok: false, error: "already_learned" });
        return;
      }
      if (mercenaryPassiveSkillIds.has(card.skillId)) mercenary.passiveSkills.push(card.skillId);
      else mercenary.extraSkills.push(card.skillId);
      const updatedAt = new Date().toISOString();
      db.prepare(`UPDATE players SET ${card.column} = ${card.column} - 1, mercenaries_json = ?, updated_at = ? WHERE account = ?`)
        .run(JSON.stringify(state.mercenaries), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, mercenaryId, skillId: card.skillId, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/buy-necklace") {
      const type = String(data.type || "");
      const config = mercenaryNecklaceTypes[type];
      if (!config) {
        sendJson(res, 400, { ok: false, error: "invalid_necklace" });
        return;
      }
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.soul_powder || 0) < config.cost) {
        sendJson(res, 409, { ok: false, error: "not_enough_powder", soulPowder: row.soul_powder || 0 });
        return;
      }
      const state = mercenaryState(row);
      const necklace = makeMercenaryNecklace(type);
      state.necklaces.push(necklace);
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET soul_powder = soul_powder - ?, mercenary_necklaces_json = ?, updated_at = ? WHERE account = ?")
        .run(config.cost, JSON.stringify(state.necklaces), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, necklace, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/equip-necklace") {
      const mercenaryId = String(data.mercenaryId || "");
      const necklaceId = String(data.necklaceId || "");
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const state = mercenaryState(row);
      const mercenary = state.mercenaries.find((merc) => merc.id === mercenaryId);
      if (!mercenary) {
        sendJson(res, 404, { ok: false, error: "mercenary_not_found" });
        return;
      }
      const necklace = state.necklaces.find((item) => item.id === necklaceId);
      if (!necklace) {
        sendJson(res, 404, { ok: false, error: "necklace_not_found" });
        return;
      }
      state.mercenaries.forEach((merc) => {
        if (merc.necklaceId === necklaceId) merc.necklaceId = "";
      });
      state.necklaces.forEach((item) => {
        if (item.equippedBy === mercenaryId || item.id === necklaceId) item.equippedBy = "";
      });
      mercenary.necklaceId = necklaceId;
      necklace.equippedBy = mercenaryId;
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET mercenaries_json = ?, mercenary_necklaces_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(state.mercenaries), JSON.stringify(state.necklaces), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/craft-orb") {
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      if ((row.soul_powder || 0) < 200) {
        sendJson(res, 409, { ok: false, error: "not_enough_powder", soulPowder: row.soul_powder || 0 });
        return;
      }
      const state = mercenaryState(row);
      state.craft.count = Math.max(0, Number(state.craft.count) || 0) + 1;
      const gain = Math.random() < 0.25 ? 360 : 720;
      state.craft.completion = Math.max(0, Number(state.craft.completion) || 0) + gain;
      const produced = [];
      if (state.craft.count >= 10) {
        produced.push(makeMercenaryOrb(state.craft.completion, false));
        if (state.craft.completion >= 7200) produced.push(makeMercenaryOrb(7200, true));
        state.orbs.push(...produced);
        state.craft = { count: 0, completion: 0, lastGain: gain };
      } else {
        state.craft.lastGain = gain;
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET soul_powder = soul_powder - 200, mercenary_orbs_json = ?, mercenary_craft_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(state.orbs), JSON.stringify(state.craft), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, gain, produced, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/socket-orb") {
      const necklaceId = String(data.necklaceId || "");
      const orbId = String(data.orbId || "");
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const state = mercenaryState(row);
      const necklace = state.necklaces.find((item) => item.id === necklaceId);
      const orb = state.orbs.find((item) => item.id === orbId);
      if (!necklace || !orb) {
        sendJson(res, 404, { ok: false, error: "item_not_found" });
        return;
      }
      necklace.orbIds = Array.isArray(necklace.orbIds) ? necklace.orbIds : [];
      if (necklace.orbIds.length >= necklace.slots) {
        sendJson(res, 409, { ok: false, error: "necklace_full" });
        return;
      }
      if (necklace.type === "advanced" && orb.type === "peerless") {
        sendJson(res, 409, { ok: false, error: "orb_type_not_allowed" });
        return;
      }
      state.necklaces.forEach((item) => {
        item.orbIds = (item.orbIds || []).filter((id) => id !== orbId);
      });
      necklace.orbIds.push(orbId);
      orb.socketedIn = necklaceId;
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET mercenary_necklaces_json = ?, mercenary_orbs_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(state.necklaces), JSON.stringify(state.orbs), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/unsocket-orb") {
      const orbId = String(data.orbId || "");
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const state = mercenaryState(row);
      const orb = state.orbs.find((item) => item.id === orbId);
      if (!orb) {
        sendJson(res, 404, { ok: false, error: "orb_not_found" });
        return;
      }
      state.necklaces.forEach((necklace) => {
        necklace.orbIds = (necklace.orbIds || []).filter((id) => id !== orbId);
      });
      orb.socketedIn = "";
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET mercenary_necklaces_json = ?, mercenary_orbs_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(state.necklaces), JSON.stringify(state.orbs), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/mercenary/destroy-orb") {
      const orbId = String(data.orbId || "");
      const row = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const state = mercenaryState(row);
      const orb = state.orbs.find((item) => item.id === orbId);
      if (!orb) {
        sendJson(res, 404, { ok: false, error: "orb_not_found" });
        return;
      }
      if (orb.socketedIn) {
        sendJson(res, 409, { ok: false, error: "orb_socketed" });
        return;
      }
      state.orbs = state.orbs.filter((item) => item.id !== orbId);
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE players SET soul_powder = soul_powder + 1000, mercenary_orbs_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(state.orbs), updatedAt, account);
      const next = db.prepare("SELECT soul_powder, mercenaries_json, active_mercenary_id, mercenary_necklaces_json, mercenary_orbs_json, mercenary_craft_json FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ok: true, refund: 1000, destroyedOrbId: orbId, ...mercenaryPayload(next) });
      return;
    }
    if (url.pathname === "/api/pet/free-claim") {
      const petId = Number(data.petId) || 0;
      const validPetIds = new Set(petModule.freeClaimPetIds);
      if (!validPetIds.has(petId)) {
        sendJson(res, 400, { ok: false, error: "invalid_pet" });
        return;
      }
      const row = db.prepare("SELECT owned_pets_json FROM players WHERE account = ?").get(account);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const initialPetId = Number(data.initialPetId) || 0;
      const ownedPets = [...new Set([...safeJsonArray(row.owned_pets_json).map(Number).filter(Boolean), initialPetId].filter(Boolean))];
      if (ownedPets.includes(petId)) {
        sendJson(res, 409, { ok: false, error: "already_owned", ownedPets });
        return;
      }
      ownedPets.push(petId);
      db.prepare("UPDATE players SET owned_pets_json = ?, updated_at = ? WHERE account = ?")
        .run(JSON.stringify(ownedPets), new Date().toISOString(), account);
      sendJson(res, 200, { ok: true, petId, ownedPets });
      return;
    }
    if (url.pathname === "/api/online-pvp/start") {
      const session = authSessionFromToken(authTokenFromRequest(req, url, data));
      const result = onlineBattle.startPvp(account, {
        battleId: data.battleId,
        defenderId: data.defenderId,
        defenderAccount: data.defenderAccount,
        defenderName: data.defenderName,
        attacker: data.attacker,
        attackerPet: data.attackerPet,
        attackerMercenary: data.attackerMercenary,
        marker: data.marker,
        pvpMode: data.pvpMode || "solo",
        clientVersion: data.clientVersion || "",
        serverId: session?.serverId || "",
        channelId: session?.channelId || 0
      });
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/online-pve/start") {
      const session = authSessionFromToken(authTokenFromRequest(req, url, data));
      const result = onlineBattle.startPve(account, {
        battleId: data.battleId,
        encounterId: data.encounterId,
        leaderId: data.leaderId,
        attackerId: data.attackerId,
        roster: data.roster,
        wildMonsterId: data.wildMonsterId,
        monsterCount: data.monsterCount,
        enemies: data.enemies,
        marker: data.marker,
        serverId: session?.serverId || "",
        channelId: session?.channelId || 0
      });
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/arena/upload") {
      const clientMirror = data.mirror && typeof data.mirror === "object" ? data.mirror : null;
      const result = arenaRuntime.upload(account, clientMirror);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/arena/start") {
      const clientMirror = data.mirror && typeof data.mirror === "object" ? data.mirror : null;
      const result = arenaRuntime.start(account, data.rank, clientMirror);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/arena/turn") {
      const result = arenaRuntime.turn(account, data.battleId, data.choice);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/arena/cancel") {
      const result = arenaRuntime.cancel(account, data.battleId);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/arena/claim-reward") {
      const result = arenaRuntime.claimReward(account);
      if (!result.ok) {
        sendJson(res, result.status || 500, result);
        return;
      }
      const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      sendJson(res, 200, { ...result, player: playerRowToApi(row) });
      return;
    }
    if (url.pathname === "/api/arena/challenge") {
      const clientMirror = data.mirror && typeof data.mirror === "object" ? data.mirror : null;
      const result = arenaRuntime.challenge(account, data.rank, clientMirror);
      sendJson(res, result.ok ? 200 : result.status || 500, result);
      return;
    }
    if (url.pathname === "/api/arena/occupy") {
      const rank = Math.max(1, Math.min(100, Number(data.rank) || 0));
      const clientMirror = data.mirror && typeof data.mirror === "object" ? data.mirror : null;
      if (!rank) {
        sendJson(res, 400, { ok: false, error: "invalid_mirror" });
        return;
      }
      const player = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
      if (!player) {
        sendJson(res, 404, { ok: false, error: "player_not_found" });
        return;
      }
      const mirror = arenaMirrorForPlayerRow(player, clientMirror);
      const name = String(player.name || account).slice(0, 24);
      const serverId = player.server_id || DEFAULT_SERVER_ID;
      recordArenaMirrorAnomalies(account, "/api/arena/occupy", clientMirror, mirror);
      const current = db.prepare("SELECT * FROM arena_rankings WHERE server_id = ? AND account = ?").get(serverId, account);
      const defender = db.prepare("SELECT * FROM arena_rankings WHERE server_id = ? AND rank = ?").get(serverId, rank);
      const currentRank = current?.rank || 0;
      const canChallenge = currentRank
        ? rank >= Math.max(1, currentRank - 10) && rank < currentRank
        : rank >= 91 && rank <= 100;
      if (!canChallenge) {
        sendJson(res, 409, { ok: false, error: "rank_not_allowed", currentRank });
        return;
      }
      const updatedAt = new Date().toISOString();
      if (currentRank && currentRank !== rank) {
        if (defender) {
          db.prepare(`
            INSERT OR REPLACE INTO arena_rankings (server_id, rank, account, name, mirror_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(serverId, currentRank, defender.account, defender.name, defender.mirror_json, updatedAt);
        } else {
          db.prepare("DELETE FROM arena_rankings WHERE server_id = ? AND rank = ?").run(serverId, currentRank);
        }
      }
      db.prepare(`
        INSERT OR REPLACE INTO arena_rankings (server_id, rank, account, name, mirror_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(serverId, rank, account, name, JSON.stringify(mirror), updatedAt);
      sendJson(res, 200, { ok: true, rank, oldRank: currentRank, swapped: Boolean(currentRank && defender), name });
      return;
    }
    if (url.pathname === "/api/equipment/forge") {
      const result = forgeRuntime.forge(account, String(data.id || ""), String(data.gemId || "forge_gem"));
      sendJson(res, result.status || 200, result);
      return;
    }
    if (url.pathname === "/api/equipment/repair") {
      const result = forgeRuntime.repair(account, String(data.id || ""));
      sendJson(res, result.status || 200, result);
      return;
    }
    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

server.on("upgrade", (req, socket, head) => {
  const upgradeUrl = new URL(req.url || "", "http://localhost");
  if (upgradeUrl.pathname !== "/room" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const authenticatedSession = authSessionFromToken(authTokenFromRequest(req, upgradeUrl));
  const authenticatedAccount = authenticatedSession?.characterAccount || "";
  const authenticatedLoginAccount = authenticatedSession?.loginAccount || "";
  const authenticatedServerId = authenticatedSession?.serverId || "";
  const authenticatedChannelId = Math.floor(Number(authenticatedSession?.channelId) || 0);
  const authenticatedServer = gameServerById(authenticatedServerId, true);
  const authenticatedPlayer = authenticatedAccount && authenticatedLoginAccount
    ? db.prepare(`
        SELECT * FROM players
        WHERE account = ? AND owner_account = ? AND server_id = ?
      `).get(authenticatedAccount, authenticatedLoginAccount, authenticatedServerId)
    : null;
  const validChannel = authenticatedServer
    && authenticatedChannelId >= 1
    && authenticatedChannelId <= Math.max(1, Number(authenticatedServer.channel_count) || SERVER_CHANNEL_COUNT);
  if (!authenticatedPlayer || !validChannel || isAccountBanned(authenticatedLoginAccount)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setKeepAlive(true, 30000);
  socket.setNoDelay(true);
  socket.lastSeenAt = Date.now();
  const previous = accountSockets.get(authenticatedAccount);
  if (previous && !previous.destroyed) {
    const notice = JSON.stringify({ type: "forceLogout", reason: "duplicate_login" });
    socketWriteRuntime.write(previous, encodeFrame(notice), "forceLogout");
    previous.end();
  }
  sockets.add(socket);
  accountSockets.set(authenticatedAccount, socket);
  socketMeta.set(socket, {
    peerId: "",
    mapName: "",
    account: authenticatedAccount,
    loginAccount: authenticatedLoginAccount,
    name: authenticatedPlayer.name || "",
    serverId: authenticatedServerId,
    channelId: authenticatedChannelId,
    hiddenPlayers: false,
    clientVersion: "",
    clientMirror: null,
    team: { leaderId: "", members: [] },
    leaderId: ""
  });
  let socketClosed = false;
  const closeSocket = (reason = "closed") => {
    if (socketClosed) return;
    socketClosed = true;
    const meta = socketMeta.get(socket) || {};
    socketWriteRuntime.forget(socket);
    socketFrameRuntime.forget(socket);
    encounterRuntime.handleDisconnect({ ...meta, socket });
    teamRuntime.handleDisconnect(meta.peerId || "", meta);
    onlineBattle.handleDisconnect(meta.peerId || "", socketRealm(meta));
    if (meta.account && accountSockets.get(meta.account) === socket) accountSockets.delete(meta.account);
    if (meta.account) clientStatCheckAt.delete(`${meta.account}:ws_state`);
    sockets.delete(socket);
    socketMeta.delete(socket);
  };
  const handleSocketData = (buffer) => {
    socket.lastSeenAt = Date.now();
    const decoded = socketFrameRuntime.push(socket, buffer);
    if (decoded.protocolError) {
      socket.destroy();
      return;
    }
    for (const pingPayload of decoded.pingPayloads) {
      socketWriteRuntime.write(socket, encodeControlFrame(0xA, pingPayload), "pong_control");
    }
    for (const message of decoded.messages) {
      const data = parseRoomMessage(message);
      const type = typeof data?.type === "string" && data.type ? data.type : roomMessageType(message);
      if (data?.type === "ping") {
        const pong = JSON.stringify({ type: "pong", ts: data.ts || Date.now() });
        socketWriteRuntime.write(socket, encodeFrame(pong), "pong");
        continue;
      }
      if (data?.peerId) {
        const meta = socketMeta.get(socket) || {};
        const peerChanged = meta.peerId !== String(data.peerId);
        meta.peerId = String(data.peerId);
        if (data.clientVersion) meta.clientVersion = String(data.clientVersion);
        if (data.type === "state" && data.mapName) {
          const account = meta.account || authenticatedAccount;
          data.account = account;
          data.serverId = meta.serverId;
          data.channelId = meta.channelId;
          if (account && meta.account !== account) {
            const previous = accountSockets.get(account);
            if (previous && previous !== socket && !previous.destroyed) {
              const notice = JSON.stringify({ type: "forceLogout", reason: "duplicate_login" });
              socketWriteRuntime.write(previous, encodeFrame(notice), "forceLogout");
              previous.end();
            }
            if (meta.account && accountSockets.get(meta.account) === socket) accountSockets.delete(meta.account);
            meta.account = account;
            accountSockets.set(account, socket);
          }
          if (data.account && data.battleStats) {
            const row = db.prepare("SELECT * FROM players WHERE account = ?").get(account);
            const key = `${account}:ws_state`;
            const now = Date.now();
            if (row && now - (clientStatCheckAt.get(key) || 0) > 30000) {
              clientStatCheckAt.set(key, now);
              detectClientStatsAnomaly(account, "ws_state", data.battleStats, statsForPlayerRow(row));
            }
            if (row?.name) {
              meta.name = row.name;
              data.name = row.name;
            }
          }
          data.team = meta.team || { leaderId: "", members: [] };
          data.leaderId = data.team.leaderId || meta.leaderId || "";
          const nextMapName = String(data.mapName);
          if (meta.mapName && meta.mapName !== nextMapName) data.previousMapName = meta.mapName;
          meta.mapName = nextMapName;
          if ("hiddenPlayers" in data) meta.hiddenPlayers = Boolean(data.hiddenPlayers);
        }
        socketMeta.set(socket, meta);
        if (data.type === "state" && data.mapName) encounterRuntime.observeState({ ...meta, socket }, data);
        if (peerChanged) teamRuntime.handlePeerConnected(meta.peerId, meta);
      }

      // === 带宽优化：处理存档增量消息（替代 HTTP POST /api/player）===
      if (data && (data.t === "vd" || data.t === "vf") && data.a) {
        try {
          const meta = socketMeta.get(socket) || {};
          const saveAccount = meta.account || authenticatedAccount;
          if (String(data.a || "") !== saveAccount) {
            recordAnomaly(meta.loginAccount || saveAccount, "ws_account_spoof_attempt", { characterAccount: saveAccount, claimedAccount: String(data.a || ""), type: data.t }, 3, "reject");
          }
          const saveFields = data.f || {};
          const updatedAt = new Date().toISOString();
          const updates = [];
          const values = [];
          const fieldMap = { name: ["name", String], x: ["x", Number], y: ["y", Number], mapName: ["map_name", String], autoStrategy: ["auto_strategy_json", JSON.stringify], selection: ["selection_json", JSON.stringify], activeMercenaryId: ["active_mercenary_id", String], friends: ["friends_json", JSON.stringify] };
          for (const [key, [col, convert]] of Object.entries(fieldMap)) {
            if (key in saveFields) { updates.push(col + " = ?"); values.push(convert(saveFields[key])); }
          }
          if (updates.length > 0) {
            updates.push("updated_at = ?"); values.push(updatedAt); values.push(saveAccount);
            db.prepare("UPDATE players SET " + updates.join(", ") + " WHERE account = ?").run(...values);
          }
          const ack = JSON.stringify({ t: "va", ok: true, v: data.v || 0 });
          socketWriteRuntime.write(socket, encodeFrame(ack), "saveAck");
        } catch (err) {
          console.error("[BW-Opt] WS save error:", err.message);
          const ack = JSON.stringify({ t: "va", ok: false, error: "save_failed" });
          socketWriteRuntime.write(socket, encodeFrame(ack), "saveAck");
        }
        continue;
      }
      // === 带宽优化：处理全量状态请求 ===
      if (data && data.t === "sr") {
        const meta = socketMeta.get(socket) || {};
        if (meta.account) {
          const row = db.prepare("SELECT * FROM players WHERE account = ?").get(meta.account);
          if (row) {
            const fullState = JSON.stringify({ t: "sf", v: Date.now(), st: { level: row.level, exp: row.exp, dragonSoul: row.dragon_soul, petLevel: row.pet_level, petExp: row.pet_exp, x: row.x, y: row.y, mapName: row.map_name, name: row.name }, cs: "" });
            socketWriteRuntime.write(socket, encodeFrame(fullState), "stateFull");
          }
        }
        continue;
      }

      recordRoomTraffic(type, "in", Buffer.byteLength(message));
      if (chatRuntime.handleRoomMessage(data, socket)) continue;
      if (teamRuntime.handleRoomMessage(data, socket)) continue;
      if (onlineBattle.handleRoomMessage(data, socket)) continue;
      broadcast(message, socket, data);
    }
    if (decoded.closeRequested && !socket.destroyed) socket.end();
  };
  socket.on("data", handleSocketData);
  if (head?.length) handleSocketData(head);
  socket.on("close", () => closeSocket("closed"));
  socket.on("error", () => closeSocket("error"));
});

function broadcast(message, sender, data = null) {
  const type = typeof data?.type === "string" && data.type ? data.type : roomMessageType(message);
  const frame = encodeFrame(message);
  for (const client of sockets) {
    if (client !== sender && !client.destroyed && shouldForwardRoomMessage(data, sender, client)) {
      const senderPeerId = socketMeta.get(sender)?.peerId || data?.peerId || "";
      const coalesceKey = data?.type === "state" && senderPeerId ? `state:${senderPeerId}` : "";
      socketWriteRuntime.write(client, frame, type, { coalesceKey });
    }
  }
}

function normalizeAdminSelection(selection, current = {}) {
  if (!selection || typeof selection !== "object") return null;
  const className = String(selection.className || "").trim();
  const gender = String(selection.gender || "").trim();
  const sub = careerTree.canonicalSub(String(selection.sub || "").trim());
  if (!adminRoleCatalog[className]?.[gender]?.includes(sub)) return null;
  return {
    ...current,
    gender,
    className,
    sub,
    petId: Number(current.petId || selection.petId) || 486
  };
}

function shouldForwardRoomMessage(data, sender, client) {
  const senderMeta = socketMeta.get(sender) || {};
  const clientMeta = socketMeta.get(client) || {};
  if (!sameSocketRealm(senderMeta, clientMeta)) return false;
  if (!data) return true;
  const clientPeerId = clientMeta.peerId || "";
  if (data.to) return clientPeerId === data.to;
  if (clientMeta.hiddenPlayers && (data.type === "battleMarker" || data.type === "battleMarkerEnd")) return false;
  if (data.type === "state" && data.mapName) {
    if (clientMeta.hiddenPlayers) return false;
    const clientMap = socketMeta.get(client)?.mapName;
    const previousMap = data.previousMapName || "";
    const teamMembers = Array.isArray(data.team?.members) ? data.team.members : [];
    const isTeamMember = Boolean(clientPeerId) && (
      data.leaderId === clientPeerId
      || teamMembers.some((member) => member?.peerId === clientPeerId)
    );
    return !clientMap || clientMap === data.mapName || clientMap === previousMap || isTeamMember;
  }
  return true;
}

function socketMatchesRealm(meta = {}, realm = null) {
  if (!realm?.serverId) return true;
  return meta.serverId === realm.serverId && Number(meta.channelId) === Number(realm.channelId);
}

function findSocketByPeerId(peerId = "", realm = null) {
  for (const socket of sockets) {
    const meta = socketMeta.get(socket);
    if (meta?.peerId === peerId && socketMatchesRealm(meta, realm) && !socket.destroyed) return socket;
  }
  return null;
}

function findSocketByAccount(account = "", realm = null) {
  const socket = accountSockets.get(String(account || ""));
  if (!socket || socket.destroyed) return null;
  return socketMatchesRealm(socketMeta.get(socket) || {}, realm) ? socket : null;
}

function findSocketByName(name = "", realm = null) {
  const target = String(name || "");
  if (!target) return null;
  for (const socket of sockets) {
    const meta = socketMeta.get(socket) || {};
    if (meta.name === target && socketMatchesRealm(meta, realm) && !socket.destroyed) return socket;
  }
  return null;
}

const onlineBattle = createOnlineBattleRuntime({
  statLimits: STAT_LIMITS,
  safeJsonArray,
  safeJsonObject,
  sample,
  arenaMirrorForPlayerRow,
  activeMercenaryForRow,
  fetchPlayerRow: (account) => db.prepare("SELECT * FROM players WHERE account = ?").get(account),
  findSocketByPeerId,
  findSocketByAccount,
  findSocketByName,
  sendSocketJson,
  getSocketMeta: (socket) => socketMeta.get(socket) || {},
  setSocketMeta: (socket, meta) => socketMeta.set(socket, meta),
  canStartPve: (account) => rewardTicketRuntime.canStart(account),
  consumePveEncounter: (payload) => encounterRuntime.consume(payload),
  requestPveIdleEncounter: (meta) => encounterRuntime.requestIdleEncounter(meta),
  issuePveRewardTickets: (ticket) => rewardTicketRuntime.issue(ticket),
  choiceMs: 15000
});

const teamRuntime = createTeamRuntime({
  findSocketByPeerId,
  findSocketByAccount,
  getSocketMeta: (socket) => socketMeta.get(socket) || {},
  setSocketMeta: (socket, meta) => socketMeta.set(socket, meta),
  sendSocketJson,
  onTeamDisband: ({ leaderAccount, realm }) => onlineBattle?.endTeamBattlesForLeader(leaderAccount, realm)
});

const arenaRuntime = createArenaRuntime({
  statLimits: STAT_LIMITS,
  safeJsonArray,
  safeJsonObject,
  sample,
  arenaMirrorForPlayerRow,
  activeMercenaryForRow,
  fetchPlayerRow: (account) => db.prepare("SELECT * FROM players WHERE account = ?").get(account),
  selectArenaRows: (serverId) => db.prepare("SELECT * FROM arena_rankings WHERE server_id = ? AND rank BETWEEN 1 AND 100 ORDER BY rank ASC").all(serverId),
  selectArenaByAccount: (account, serverId) => db.prepare("SELECT * FROM arena_rankings WHERE server_id = ? AND account = ?").get(serverId, account),
  selectArenaByRank: (rank, serverId) => db.prepare("SELECT * FROM arena_rankings WHERE server_id = ? AND rank = ?").get(serverId, rank),
  upsertArenaRank: (rank, account, name, mirrorJson, updatedAt, serverId) => db.prepare(`
    INSERT OR REPLACE INTO arena_rankings (server_id, rank, account, name, mirror_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(serverId, rank, account, name, mirrorJson, updatedAt),
  deleteArenaRank: (rank, serverId) => db.prepare("DELETE FROM arena_rankings WHERE server_id = ? AND rank = ?").run(serverId, rank),
  grantArenaReward: (account, soulPowder, immortalPill, key) => db.prepare(`
    UPDATE players
    SET soul_powder = soul_powder + ?,
      immortal_pill = immortal_pill + ?,
      arena_reward_claimed_key = ?,
      updated_at = ?
    WHERE account = ?
  `).run(soulPowder, immortalPill, key, new Date().toISOString(), account),
  recordMirrorAnomalies: recordArenaMirrorAnomalies
});

immortalCultivationRuntime = createImmortalCultivationRuntime({
  safeJsonObject,
  fetchPlayerRow: (account) => db.prepare("SELECT * FROM players WHERE account = ?").get(account),
  updateCultivation: (account, data, pillCost, powderCost) => db.prepare(`
    UPDATE players
    SET immortal_pill = immortal_pill - ?,
      soul_powder = soul_powder - ?,
      immortal_cultivation_json = ?,
      updated_at = ?
    WHERE account = ?
  `).run(pillCost, powderCost, JSON.stringify(data), new Date().toISOString(), account)
});

madBragRuntime = createMadBragRuntime({
  db,
  defaultServerId: DEFAULT_SERVER_ID,
  fetchPlayer: (account) => db.prepare("SELECT * FROM players WHERE account = ?").get(account),
  playerToApi: playerRowToApi,
  itemColumn: itemColumnForId,
  itemMeta: materialItemMeta,
  itemValue: (id) => {
    if (id === "immortal_pill") return 200;
    if (id === "lucky_box") return 500;
    if (String(id || "").includes("ticket")) return 1000;
    return materialSellPrice(id);
  }
});

const dailyNewsRuntime = createDailyNewsRuntime({ db });
const taoziRuntime = createTaoziRuntime({
  apiKey: process.env.TAOZI_AI_API_KEY,
  baseUrl: process.env.TAOZI_AI_BASE_URL || "https://ai.txwj.asia/v1",
  model: process.env.TAOZI_AI_MODEL || "gpt-5.6-terra",
  recordAnomaly
});
const dragonSoulRuntime = createDragonSoulRuntime({ db });
const careerProgressConfigRuntime = {
  getConfig() {
    const row = db.prepare("SELECT value_json FROM app_settings WHERE key = ?").get("career_progress_config_v1");
    try { return { expPerLevel: Math.max(1, Math.min(1000000, Math.floor(Number(JSON.parse(row?.value_json || "{}").expPerLevel) || 100))) }; } catch { return { expPerLevel: 100 }; }
  },
  updateConfig(data) {
    const expPerLevel = Math.max(1, Math.min(1000000, Math.floor(Number(data.expPerLevel) || 100)));
    db.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run("career_progress_config_v1", JSON.stringify({ expPerLevel }), new Date().toISOString());
    return { expPerLevel };
  },
  resetConfig() { db.prepare("DELETE FROM app_settings WHERE key = ?").run("career_progress_config_v1"); return { expPerLevel: 100 }; }
};

function encodeFrame(message) {
  const payload = Buffer.from(message);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}


// === 初始化带宽优化器 ===
let bwOpt = null;
if (bandwidthOptimizer?.createBandwidthOptimizer) {
  try {
    bwOpt = bandwidthOptimizer.createBandwidthOptimizer(server, {
      db, encodeFrame, sockets, socketMeta, accountSockets,
    }, {
      encoding: process.env.NODE_ENV === "production" ? 2 : 0,
      heartbeatInterval: 30000,
      maxConnectionsPerIp: 10,
      maxTotalConnections: 5000,
    });
    bwOpt.wsManager.start();
    console.log("[BW-Opt] 带宽优化器已启动");
  } catch (e) {
    console.log("[BW-Opt] 优化器初始化失败，使用原有逻辑:", e.message);
    bwOpt = null;
  }
}

setInterval(() => {
  const now = Date.now();
  cleanExpiredAuthSessions(now);
  for (const socket of sockets) {
    if (socket.destroyed) continue;
    if (now - (socket.lastSeenAt || now) > WS_IDLE_CLOSE_MS) {
      socket.destroy();
    }
  }
}, Math.min(30000, AUTH_SESSION_CLEANUP_MS)).unref?.();

function cleanStaleAccountAnomalies() {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const staleCount = db.prepare("SELECT count(*) AS c FROM account_anomalies WHERE created_at < ?").get(cutoff)?.c || 0;
    if (!staleCount) return;
    let deleted = 0;
    while (deleted < 50000) {
      db.prepare('DELETE FROM account_anomalies WHERE rowid IN (SELECT rowid FROM account_anomalies WHERE created_at < ? LIMIT 5000)').run(cutoff);
      deleted += 5000;
    }
    console.log(`[db-cleanup] 已清理旧异常记录 cutoff=${cutoff} stale=${staleCount}`);
  } catch (error) {
    console.error("[db-cleanup] 清理旧异常记录失败", error);
  }
}

server.listen(port, "::", () => {
  const listeningPort = server.address()?.port || port;
  console.log(`Pocket Spirit demo listening on http://[::]:${listeningPort}/`);
  cleanStaleAccountAnomalies();
  setInterval(cleanStaleAccountAnomalies, 24 * 60 * 60 * 1000);
});
