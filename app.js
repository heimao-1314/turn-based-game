/**
 * @file app.js
 * @description 游戏客户端主程序 - 口袋精灵 (dw-pocket-spirit) 前端核心
 *
 * 本模块是游戏的前端主程序，包含完整的客户端游戏逻辑：
 *
 * 核心系统:
 * - 游戏初始化与资源加载
 * - 角色创建与职业系统（枪手/法师/剑士，各含 3 个子职业）
 * - 地图渲染与场景管理
 * - 玩家移动与碰撞检测
 * - 实时多人同步（WebSocket 服务器中转）
 *
 * 战斗系统:
 * - 回合制 PvP/PvE 战斗
 * - 技能施放与目标选择
 * - 宠物/佣兵/灵兽协同战斗
 * - 战斗动画与特效渲染
 *
 * 社交系统:
 * - 组队与跟随
 * - 好友与聊天
 * - 摆摊交易
 * - 公会系统
 *
 * 养成系统:
 * - 装备强化与附魔
 * - 宠物培养与进化
 * - 时装系统
 * - 成就与称号
 *
 * UI 系统:
 * - 响应式界面布局
 * - 触屏/键鼠双模式支持
 * - 菜单导航与背包管理
 *
 * @requires Canvas API, WebSocket API, Service Worker API
 */
const $ = (selector) => document.querySelector(selector);
const storageKey = "pocket-spirit-demo";
const authCacheKey = "pocket-spirit-auth-cache";

const backgroundKeepAlive = {
  enabled: true,
  started: false,
  audio: null,
  audioContext: null,
  oscillator: null,
  gain: null,
  retryTimer: null
};

const silentWavDataUri =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

function createSilentLoopAudio() {
  const audio = document.createElement("audio");
  audio.src = silentWavDataUri;
  audio.loop = true;
  audio.muted = false;
  audio.volume = 0.01;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body?.appendChild(audio);
  return audio;
}

async function startBackgroundKeepAlive() {
  if (!backgroundKeepAlive.enabled) return false;
  try {
    if (!backgroundKeepAlive.audio) {
      backgroundKeepAlive.audio = createSilentLoopAudio();
    }
    await backgroundKeepAlive.audio.play();
  } catch (error) {
    console.debug("静音音频保活等待用户手势", error);
  }

  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioContextCtor && !backgroundKeepAlive.audioContext) {
      const audioContext = new AudioContextCtor();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 20;
      gain.gain.value = 0.00001;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      backgroundKeepAlive.audioContext = audioContext;
      backgroundKeepAlive.oscillator = oscillator;
      backgroundKeepAlive.gain = gain;
    }
    if (backgroundKeepAlive.audioContext?.state === "suspended") {
      await backgroundKeepAlive.audioContext.resume();
    }
  } catch (error) {
    console.debug("WebAudio 静音保活启动失败", error);
  }

  backgroundKeepAlive.started = true;
  return true;
}

function setupBackgroundKeepAlive() {
  if (!backgroundKeepAlive.enabled || typeof window === "undefined") return;
  if (shouldUseStaticLoginImage()) return;
  const unlock = () => {
    startBackgroundKeepAlive();
  };
  ["pointerdown", "touchstart", "mousedown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, unlock, { passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) startBackgroundKeepAlive();
  });
  window.addEventListener("focus", () => startBackgroundKeepAlive());
  backgroundKeepAlive.retryTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (!backgroundKeepAlive.started || backgroundKeepAlive.audio?.paused || backgroundKeepAlive.audioContext?.state === "suspended") {
      startBackgroundKeepAlive();
    }
  }, 15000);
}

const careerTree = window.CareerTree;
const roleCatalog = careerTree.roleCatalog;

const petModule = window.PetModule;
const petCatalog = petModule.petCatalog;
const freeClaimPetIds = new Set(petModule.freeClaimPetIds);
const elfKingVault = window.ElfKingVault;

function freeClaimPets() {
  return petCatalog.filter((pet) => freeClaimPetIds.has(pet.id));
}

const mapFiles = {
  "仓库": "仓库2.json",
  "仙人": "仙人.json",
  "原野怪区": "原野怪区.json",
  "幻影狩猎场": "幻影.json",
  [elfKingVault.dungeon.mapName]: elfKingVault.dungeon.mapFile
};

const defaultMapManifest = {
  maps: Object.entries(mapFiles).map(([name, file]) => ({ name, file, entry: { x: 1, y: 1 }, desc: "" })),
  mapFiles: { ...mapFiles },
  portals: []
};

const NEW_ROXAS_HOME_MAP = "\u7f57\u514b\u8428\u65af\u5bb6";
const NEW_FIELD_MAP = "\u539f\u91ce\u602a\u533a";
const NEW_MARKET_MAP = "\u5149\u8292\u5e02\u573a";
const ROXAS_HOME_RETURN = { x: 5, y: 11 };
const LEGACY_NEW_MAP_ALIASES = {
  "\u4ed3\u5e93": NEW_ROXAS_HOME_MAP,
  "\u5149\u8292\u5e02\u573a": NEW_MARKET_MAP,
  "\u539f\u91ce\u602a\u533a": NEW_FIELD_MAP
};

function resolveLegacyNewMapName(name) {
  return LEGACY_NEW_MAP_ALIASES[name] || name;
}



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
  critDamage: 2000
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
  critDamage: 100
};

const STAT_ICONS = {
  hp: "1.21",
  attack: "1.3",
  defense: "1.5",
  speed: "1.39",
  mana: "1.36",
  exp: "1.14",
  crit: "1.14",
  critDamage: "1.39"
};

const rankingStats = [
  { stat: "power", label: "战斗力", icon: "1.49" },
  { stat: "hp", label: "生命", icon: STAT_ICONS.hp },
  { stat: "attack", label: "攻击", icon: STAT_ICONS.attack },
  { stat: "defense", label: "防御", icon: STAT_ICONS.defense },
  { stat: "speed", label: "速度", icon: STAT_ICONS.speed },
  { stat: "mana", label: "法力", icon: STAT_ICONS.mana },
  { stat: "crit", label: "致命", icon: STAT_ICONS.crit },
  { stat: "critDamage", label: "爆伤", icon: STAT_ICONS.critDamage }
];

const BATTLE_STATUS_ICONS = {
  confuse: 380,
  seal: 374,
  bleed: 384,
  curse: 384,
  sleep: 367,
  stun: 370,
  paralyze: 370,
  bind: 370,
  armorBreak: 368,
  vulnerable: 371,
  critBuff: 377
};

const sharedClassGrowth = careerTree.baseGrowth;

const classGrowth = {
  "初始角色": sharedClassGrowth,
  "枪手": sharedClassGrowth,
  "法师": sharedClassGrowth,
  "剑士": sharedClassGrowth
};

const dragonSoulGrowth = {
  hp: 2000,
  defense: 180,
  speed: 1,
  attack: 200,
  mana: 60,
  crit: 0.03,
  critDamage: 3
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

const skillCatalog = window.BattleSkills.skillCatalog;
// 战斗站位模块：纯坐标计算，app.js 只做薄委托
const battlePlacement = window.BattlePlacement;
const placeAllyGridFighter = battlePlacement.placeAllyGridFighter;
const placeSingleBattleFighter = battlePlacement.placeSingleBattleFighter;
const placeEnemyGridFighter = battlePlacement.placeEnemyGridFighter;
const placeElfKingVaultHiddenEnemyFighter = battlePlacement.placeElfKingVaultHiddenEnemyFighter;
// 战斗血条/精力条绘制模块：基于 blood.png 素材，app.js 只做薄委托
const battleBars = window.BattleBars;
let battleSkills = null;
let battleEngine = null;
let battleProtocol = null;
let teamRuntime = null;

function skillsForStats(stats) {
  return battleSkills.skillsForStats(stats);
}

function activeSkillsForStats(stats) {
  return battleSkills.activeSkillsForStats(stats);
}

function equippedItemInSlot(slotKey) {
  const id = state.bag.equipped?.[slotKey];
  return (state.bag.items || []).find((item) => item.id === id) || null;
}

function battleTeamForActor(actor = null) {
  const battle = state.battle;
  if (!battle || !actor) return [];
  return [battle.playerTeam || [], battle.enemyTeam || []].find((team) => team.some((fighter) => fighter.actor === actor)) || [];
}

function sacrificeAlliesReady(skill, actor = null) {
  return battleSkills.sacrificeAlliesReady(skill, actor);
}

function roleSkillUsable(skillId, selection = state.selected, actor = null) {
  return battleSkills.roleSkillUsable(skillId, selection, actor);
}

function activeBattleSkillsForStats(stats, actor = null) {
  return battleSkills.activeBattleSkillsForStats(stats, actor);
}

function defaultSkillIdForStats(stats) {
  return battleSkills.defaultSkillIdForStats(stats);
}

function defaultBattleSkillIdForStats(stats, actor = null) {
  return battleSkills.defaultBattleSkillIdForStats(stats, actor);
}

function skillById(skillId) {
  return battleSkills.skillById(skillId);
}

function fighterOwnedByLocalPlayer(fighter) {
  const actor = fighter?.actor || null;
  return actor === state.player || actor?.arenaSelf === true || (actor?.ownerPeerId && actor.ownerPeerId === state.peerId);
}

function equippedItemInSlotForFighter(fighter, slotKey) {
  if (fighterOwnedByLocalPlayer(fighter)) return equippedItemInSlot(slotKey);
  const actor = fighter?.actor || {};
  const equipped = actor.equipped || actor.bag?.equipped || {};
  const items = actor.equipment || actor.bag?.items || [];
  const id = equipped?.[slotKey];
  return Array.isArray(items) ? items.find((item) => item?.id === id) || null : null;
}

function battleTeamForFighter(fighter) {
  const battle = state.battle;
  if (!battle || !fighter) return [];
  return [battle.playerTeam || [], battle.enemyTeam || []].find((team) => team.includes(fighter)) || [];
}

function sacrificeAlliesReadyForFighter(skill, fighter) {
  if (!Array.isArray(skill?.sacrificeAllies) || !skill.sacrificeAllies.length) return true;
  const team = battleTeamForFighter(fighter);
  if (!team.length) return false;
  return skill.sacrificeAllies.every((kind) => team.some((unit) => unit !== fighter && fighterKind(unit) === kind && !unit.defeated));
}

function roleSkillUsableForFighter(skillId, fighter) {
  const skill = skillById(skillId);
  if (!skill.requiredClass) return true;
  const selection = fighterOwnedByLocalPlayer(fighter) ? state.selected : (fighter?.actor?.selection || {});
  if (selection.className !== skill.requiredClass) return false;
  if (!sacrificeAlliesReadyForFighter(skill, fighter)) return false;
  return equippedItemInSlotForFighter(fighter, "weapon")?.type === skill.requiredWeapon
    && equippedItemInSlotForFighter(fighter, "demonWeapon")?.type === skill.requiredDemonWeapon;
}

function activeBattleSkillsForFighter(fighter) {
  return activeSkillsForStats(fighter?.stats || {}).filter((id) => roleSkillUsableForFighter(id, fighter));
}

function defaultBattleSkillIdForFighter(fighter) {
  const active = activeBattleSkillsForFighter(fighter);
  if (!active.length) return "";
  return active.includes(fighter?.stats?.skillId) ? fighter.stats.skillId : active[0];
}

function sanitizeBattleActionForFighter(fighter, action) {
  if (!action || typeof action !== "object") return null;
  if (action.type !== "skill") return { ...action, type: "attack", skillId: "" };
  const skillId = action.skillId || defaultBattleSkillIdForFighter(fighter);
  if (!skillId || !roleSkillUsableForFighter(skillId, fighter)) {
    return { ...action, type: "attack", skillId: "" };
  }
  return { ...action, type: "skill", skillId };
}

const equipmentForgeStats = {
  hat: { name: "精致帽子", stat: "mana", perLevel: 10000 / 15, icon: "1.27" },
  armor: { name: "精致上衣", stat: "defense", perLevel: 100000 / 15, icon: "1.4" },
  pants: { name: "精致裤子", stat: "attack", perLevel: 50000 / 15, icon: "1.30" },
  belt: { name: "精致腰带", stat: "hp", perLevel: 500000 / 15, icon: "1.7" },
  shoes: { name: "精致鞋子", stat: "speed", perLevel: 10000 / 15, icon: "1.33" },
  firearm: { name: "精致火枪", stat: "speed", perLevel: 10000 / 15, icon: "1.39" },
  sword: { name: "精致长剑", stat: "attack", perLevel: 50000 / 15, icon: "1.3" },
  staff: { name: "精致法杖", stat: "mana", perLevel: 10000 / 15, icon: "1.36" },
  demon_firearm: { name: "绝世.魔界尊者之枪", stat: "", perLevel: 0, icon: "1.39" },
  demon_staff: { name: "绝世.魔界尊者之杖", stat: "", perLevel: 0, icon: "1.36" },
  demon_sword: { name: "绝世.魔界尊者之剑", stat: "", perLevel: 0, icon: "1.3" }
};

const demonWeaponCatalog = [
  { id: "demon_firearm", name: "绝世.魔界尊者之枪", icon: "1.39", stats: { speed: 30000, attack: 125000, defense: 125000, mana: 25000 } },
  { id: "demon_staff", name: "绝世.魔界尊者之杖", icon: "1.36", stats: { mana: 50000, speed: 15000, attack: 125000, defense: 125000 } },
  { id: "demon_sword", name: "绝世.魔界尊者之剑", icon: "1.3", stats: { attack: 250000, mana: 25000, speed: 15000, defense: 125000 } }
];

const peerlessRoleSkillCards = [
  { id: "skill_card_role_sword_dragon_slash", name: "绝世人物技能卡：封龙斩", skillId: "role_sword_dragon_slash", icon: "1.3" },
  { id: "skill_card_role_sword_blood_burst", name: "绝世人物技能卡：气血爆发", skillId: "role_sword_blood_burst", icon: "1.3" },
  { id: "skill_card_role_mage_frost_domain", name: "绝世人物技能卡：冰封万域", skillId: "role_mage_frost_domain", icon: "1.36" },
  { id: "skill_card_role_mage_soul_burn", name: "绝世人物技能卡：焚灵祭命", skillId: "role_mage_soul_burn", icon: "1.36" },
  { id: "skill_card_role_gun_shadow_barrage", name: "绝世人物技能卡：迅影万弹", skillId: "role_gun_shadow_barrage", icon: "1.39" },
  { id: "skill_card_role_gun_soul_snipe", name: "绝世人物技能卡：冥封魂狙", skillId: "role_gun_soul_snipe", icon: "1.39" }
];

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

const equipmentSlots = [
  { key: "hat", label: "帽子", types: ["hat"], icon: "1.27" },
  { key: "armor", label: "上衣", types: ["armor"], icon: "1.4" },
  { key: "pants", label: "裤子", types: ["pants"], icon: "1.30" },
  { key: "belt", label: "腰带", types: ["belt"], icon: "1.7" },
  { key: "shoes", label: "鞋子", types: ["shoes"], icon: "1.33" },
  { key: "weapon", label: "武器", types: ["firearm", "sword", "staff"], icon: "1.3" },
  { key: "demonWeapon", label: "魔尊武器", types: ["demon_firearm", "demon_staff", "demon_sword"], icon: "1.49" },
  { key: "fashion", label: "时装", types: ["fashion"], icon: "2.10" }
];

function equipmentSlotForType(type) {
  return equipmentSlots.find((slot) => slot.types.includes(type))?.key || type;
}

const equipmentAffixPool = [
  { stat: "speed", label: "速度", value: 1500 },
  { stat: "mana", label: "法力", value: 200 },
  { stat: "hp", label: "生命", value: 15000 },
  { stat: "attack", label: "攻击", value: 1500 },
  { stat: "defense", label: "防御", value: 1500 },
  { stat: "crit", label: "致命", value: 5 }
];

const equipmentPercentAffixPool = [
  { stat: "speed", label: "速度", percent: 0.05 },
  { stat: "defense", label: "防御", percent: 0.05 },
  { stat: "hp", label: "生命", percent: 0.05 },
  { stat: "mana", label: "法力", percent: 0.05 },
  { stat: "attack", label: "攻击", percent: 0.05 }
];

const wildMonsterTable = {
  amumu: {
    name: "阿木木",
    spriteId: 895,
    level: 18,
    exp: 2600,
    forgeGemChance: 0.65,
    forgeGem: [1, 2],
    equipmentChance: 0.28,
    stats: { hp: 118000, defense: 14500, speed: 1350, attack: 18500, mana: 2600, crit: 6, critDamage: 240, skillId: "wild_amumu" }
  },
  afei: {
    name: "阿飞",
    spriteId: 234,
    level: 80,
    exp: 25000,
    forgeGemChance: 1,
    forgeGem: [3, 8],
    equipmentChance: 0.85,
    bossChance: 0.2,
    stats: { hp: 1500000, defense: 85000, speed: 1810, attack: 72000, mana: 18000, crit: 12, critDamage: 320, skillId: "wild_afei_heal" },
    minion: {
      spriteId: 235,
      names: ["丽丽", "琉璃", "萝莉", "莉莉", "兰兰", "玲玲", "琪琪", "七七", "微微"],
      stats: { hp: 360000, defense: 42000, speed: 1800, attack: 52000, mana: 5000, crit: 5, critDamage: 180, skillId: "shining_strike", forceBasicAttack: true }
    },
    fragments: [
      { id: "peerless_skill_fragment", name: "绝世技能兑换券碎片", icon: "1.49", chance: 0.75, amount: [1, 2] },
      { id: "holy_skill_fragment", name: "圣品技能兑换券碎片", icon: "1.49", chance: 0.9, amount: [1, 3] },
      { id: "peerless_pet_scroll_fragment", name: "绝世宠物召唤卷碎片", icon: "2.12", chance: 0.55, amount: [1, 2] },
      { id: "peerless_role_skill_fragment", name: "绝世人物技能兑换券碎片", icon: "1.49", chance: 0.55, amount: [1, 2] },
      { id: "peerless_holy_weapon_fragment", name: "绝世圣武兑换券碎片", icon: "1.3", chance: 0.35, amount: [1, 1] },
      { id: "fashion_ticket_fragment", name: "时装兑换券碎片", icon: "2.10", chance: 0.65, amount: [1, 2] }
    ]
  },
  phantom: {
    name: "幻影暗怪",
    spriteId: 459,
    level: 80,
    exp: 25000,
    forgeGemChance: 1,
    forgeGem: [3, 8],
    equipmentChance: 0.85,
    stats: { hp: 1500000, defense: 85000, speed: 1810, attack: 72000, mana: 18000, crit: 12, critDamage: 320, skillId: "wild_afei_heal" },
    fragments: [
      { id: "peerless_skill_fragment", name: "绝世技能兑换券碎片", icon: "1.49", chance: 0.75, amount: [1, 2] },
      { id: "holy_skill_fragment", name: "圣品技能兑换券碎片", icon: "1.49", chance: 0.9, amount: [1, 3] },
      { id: "peerless_pet_scroll_fragment", name: "绝世宠物召唤卷碎片", icon: "2.12", chance: 0.55, amount: [1, 2] },
      { id: "peerless_role_skill_fragment", name: "绝世人物技能兑换券碎片", icon: "1.49", chance: 0.55, amount: [1, 2] },
      { id: "peerless_holy_weapon_fragment", name: "绝世圣武兑换券碎片", icon: "1.3", chance: 0.35, amount: [1, 1] },
      { id: "fashion_ticket_fragment", name: "时装兑换券碎片", icon: "2.10", chance: 0.65, amount: [1, 2] },
      { id: "phantom_fragment", name: "幻影碎片", icon: "1.49", chance: 1, amount: [2, 5] }
    ]
  }
};

const immortalBosses = [
  {
    id: "immortal_hand",
    name: "仙人之手",
    spriteId: 215,
    hp: 50000000,
    rewardSoulPowder: 200,
    skillIds: ["immortal_hand_curse", "immortal_hand_double"]
  },
  {
    id: "immortal_foot",
    name: "仙人之脚",
    spriteId: 216,
    hp: 60000000,
    rewardSoulPowder: 400,
    skillIds: ["immortal_foot_paralyze", "immortal_foot_double"]
  },
  {
    id: "immortal_body",
    name: "仙人之身",
    spriteId: 217,
    hp: 70000000,
    rewardSoulPowder: 800,
    skillIds: ["immortal_body_seal", "immortal_body_double"]
  },
  {
    id: "immortal_brain",
    name: "仙人之脑",
    spriteId: 218,
    hp: 80000000,
    rewardSoulPowder: 1200,
    skillIds: ["immortal_brain_stun_sleep", "immortal_brain_double"]
  },
  {
    id: "immortal_heart",
    name: "仙人之心",
    spriteId: 2085,
    hp: 90000000,
    rewardSoulPowder: 2400,
    skillIds: ["immortal_heart_confuse", "immortal_heart_double"]
  }
];

const immortalBossById = Object.fromEntries(immortalBosses.map((boss) => [boss.id, boss]));

const mercenaryTypes = {
  mage: { id: "mage", type: "mage", name: "法佣", spriteId: 873, skillId: "merc_mage_starfall" },
  gun: { id: "gun", type: "gun", name: "枪佣", spriteId: 871, skillId: "merc_gun_multishot" },
  sword: { id: "sword", type: "sword", name: "剑佣", spriteId: 869, skillId: "merc_sword_deathblow" }
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
let mercenaryHolySkillIds = new Set();
const mercenaryNecklaceTypes = {
  advanced: { type: "advanced", name: "高级佣兵项链", cost: 1000, slots: 3, icon: "1.27" },
  peerless: { type: "peerless", name: "绝世佣兵项链", cost: 10000, slots: 4, icon: "1.49" }
};

const BATTLE_CRIT_LINES = [
  "呵！致命一击！[e0]",
  "这一击，够狠！[e0]",
  "看清楚，这才叫爆发！",
  "要害命中！",
  "别眨眼，已经结束了！",
  "吃我一记狠的！[e0]",
  "破绽太大了！",
  "这一刀，记住了！",
  "命中弱点！",
  "怒火一击！[e0]"
];

const AMUMU_BATTLE_LINES = [
  "就这点本事也敢来原野怪区？",
  "你打我像挠痒痒。",
  "别急，马上送你回城。",
  "装备挺多，伤害不高。",
  "你宠物比你还着急。",
  "这回合我都替你尴尬。",
  "再练十级吧。",
  "你是不是点错技能了？",
  "我站着不动你都难赢。",
  "别挂机了，认真点也一样。"
];

const petGrowth = { ...careerTree.baseGrowth, skillId: "pet_default" };

const petSkillIds = petModule.petSkillIds;
const petInnateSkillIds = petModule.petInnateSkillIds || {};
const peerlessPetIds = new Set(petModule.peerlessPetIds);

function normalizePetId(petId) {
  return petModule.normalizePetId(petId);
}

const state = {
  account: "",
  loginAccount: "",
  authPassword: "",
  authToken: "",
  authMode: "login",
  serverId: "",
  serverName: "",
  channelId: "",
  servers: [],
  characters: [],
  charactersLoaded: false,
  maxCharacters: 3,
  gatewayServerIndex: 0,
  gatewayChannelIndex: 0,
  gatewayCharacterIndex: 0,
  creatingCharacter: false,
  loginVisual: { mode: "cover" },
  coverLoginIndex: 0,
  coverNetworkIndex: 0,
  selected: { gender: "女", className: careerTree.INITIAL_CLASS, sub: careerTree.INITIAL_SUB, petId: 486 },
  playerProgress: { level: 1, exp: 0, careerLevel: 1, careerExp: 0, dragonSoul: 1 },
  petProgress: { level: 1, exp: 0 },
  petProgressById: { "486": { level: 1, exp: 0 } },
  ownedPetIds: [],
  petExtraSkills: {},
  roleExtraSkills: [],
  bag: { items: [], forgeGem: 0, equipped: {} },
  autoBattlePersistent: false,
  autoStrategy: { actor: { mode: "skill", skillId: "" }, petById: {} },
  users: loadUsers(),
  sprites: new Map(),
  loadingSprites: new Map(),
  images: new Map(),
  maps: new Map(),
  newMapRuntime: { loaded: false, failed: false, maps: [], byName: new Map(), byKey: new Map(), byId: new Map(), nameByKey: new Map(), mapPoints: null, worldPoints: null, externalTiles: {}, baseSheets: [] },
  mapManifest: defaultMapManifest,
  map: null,
  mapName: "仓库",
  isAdmin: false,
  mapScale: 1,
  actorScales: { player: 1, pet: 1, other: 1 },
  modelScaleAdjustment: null,
  showPetNames: true,
  mapViewportX: 0,
  mapViewportY: 0,
  mapViewportW: 0,
  mapViewportH: 0,
  cameraX: 0,
  cameraY: 0,
  inputDir: null,
  touchTarget: null,
  clickEffects: [],
  lastTime: 0,
  player: null,
  pet: null,
  remotes: [],
  peers: new Map(),
  nearbyPlayersHidden: false,
  idleHideActive: false,
  idleHideTimer: null,
  lastActivityAt: 0,
  friends: [],
  silver: 0,
  yuanbao: 0,
  privateChatTarget: null,
  chatChannel: "nearby",
  team: { leaderId: "", members: [] },
  followLeaderId: "",
  phantom: { points: 0, fragment: 0, equippedTitle: "", claimedTitles: [] },
  elfKingVaultProgress: { date: "", claimed: {} },
  followPath: [],
  followMoveTimer: 0,
  socket: null,
  socketHeartbeatTimer: null,
  socketReconnectTimer: null,
  socketReconnectAttempts: 0,
  lastSocketPongAt: 0,
  peerId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  lastBroadcast: 0,
  lastStateBroadcast: 0,
  lastStateSignature: "",
  lastFullStateSignature: "",
  lastFullStateBroadcast: 0,
  chatLines: [],
  battle: null,
  pveEncounter: null,
  pendingTeamPveBattleId: "",
  pendingBattleInvite: null,
  canceledBattleIds: new Set(),
  clientVersion: localStorage.getItem("dw-client-version") || "",
  claimedTeamRewardIds: new Set(),
  battleMarker: null,
  hiddenOnMap: new Set(),
  remoteBattleMarkers: new Map(),
  endedRemoteBattleMarkerIds: new Set(),
  menuOpen: false,
  menuTab: 0,
  menuItem: 0,
  menuContextTitle: "",
  infoDialogOnClose: null,
  suppressSyntheticClickUntil: 0,
  staticNpcMenuSuppressUntil: 0,
  staticNpcMenuSuppressKey: "",
  roleStatsOpen: false,
  roleStatsPage: "stats",
  roleStatsSubject: null,
  menuHintTimer: null,
  fieldSteps: 0,
  encounterCooldown: 0,
  mapLoading: { active: false, token: 0, tip: "", spriteId: 101, startedAt: 0, progress: 0, timer: 0 },
  idleHuntActive: false,
  idleHuntTarget: "wild",
  idleHuntBossId: "",
  idleHuntTimer: null,
  lastPlayerSave: 0,
  pendingBattleReward: null,
  luckyBoxRoll: { rolling: false, done: false, remaining: 0, confirmOpen: false },
  penguinRenameOpen: false,
  storageItems: [],
  menuQuantityContext: null,
  mercenaries: [],
  activeMercenaryId: "",
  mercenaryNecklaces: [],
  mercenaryOrbs: [],
  mercenaryCraft: {},
  stickerInventory: {},
  petStickers: {},
  stall: { active: false, items: [], item: null, price: 0, originalSpriteId: 0 },
  stallDraftItems: []
};
const realtimeHeartbeat = window.OnlineBattleClient?.createHeartbeatRuntime?.({
  getSocket: () => state.socket,
  getPeerId: () => state.peerId,
  intervalMs: 10000,
  timeoutMs: 90000,
  onTimeout: (socket) => {
    socket.close();
    if (state.player) showMenuHint("实时连接已重连，请重试操作");
  },
  onSendError: (socket) => socket.close()
});

const BATTLE_CHOICE_SECONDS = 19;
const BATTLE_CHOICE_MS = BATTLE_CHOICE_SECONDS * 1000;
const BATTLE_UI_SCALE = 1.5;
const STALL_SPRITE_ID = 2027;
const STATE_BROADCAST_MOVING_MS = 250;
const STATE_BROADCAST_IDLE_MS = 2500;
const STATE_FULL_BROADCAST_MS = 10000;
const PVP_BATTLE_INVITE_TIMEOUT_MS = 8000;
const MAX_CANVAS_DPR = 2;
const WALK_FRAME_TICK_RATE = 0.04;
const PET_FOLLOW_DELAY_POINTS = 2;
const PET_FOLLOW_WAIT_MS = 150;
const PET_FOLLOW_MAX_PATH = 24;
const PET_FOLLOW_CATCHUP_KEEP = 8;
const PET_FOLLOW_CATCHUP_LIMIT = 12;
const BATTLE_HEAL_EFFECT_ID = 1040;
const BATTLE_EFFECT_FRAME_MS = 50;
const BATTLE_LARGE_EFFECT_FRAME_MS = 60;
const TILE_DRAW_SIZE = 16.08;
const TILE_DRAW_OFFSET = -0.04;
const MAP_NAME_FONT_SIZE = 8.5;
const MAP_NAME_FONT_FAMILY = cssFontVar("--font-map-label", "sans-serif");
const DIALOG_FONT_FAMILY = cssFontVar("--font-dialog", "sans-serif");
const UI_FONT_FAMILY = cssFontVar("--font-ui", "sans-serif");
const MAP_TILE_SIZE = 16;
const CAMERA_RESOLUTIONS = [
  { id: "240x320", label: "240×320", width: 240, height: 320 },
  { id: "360x475", label: "360×475", width: 360, height: 475 }
];
const DEFAULT_CAMERA_RESOLUTION_ID = "240x320";
const MODEL_SCALE_STORAGE_KEY = "dw-model-scale-preferences";
const SHOW_PET_NAME_STORAGE_KEY = "dw-show-pet-name";
const MODEL_SCALE_MIN = 0.5;
const MODEL_SCALE_MAX = 2.5;
const MODEL_SCALE_STEP = 0.05;
const QUICK_MENU_HOTKEYS_STORAGE_KEY = "dw-quick-menu-hotkeys";
let cameraResolutionId = localStorage.getItem("dw-camera-resolution") || DEFAULT_CAMERA_RESOLUTION_ID;
if (!CAMERA_RESOLUTIONS.some((resolution) => resolution.id === cameraResolutionId)) {
  cameraResolutionId = DEFAULT_CAMERA_RESOLUTION_ID;
}

function currentCameraResolution() {
  return CAMERA_RESOLUTIONS.find((resolution) => resolution.id === cameraResolutionId) || CAMERA_RESOLUTIONS[0];
}

let MAP_VIEW_WORLD_W = currentCameraResolution().width;
let MAP_VIEW_WORLD_H = currentCameraResolution().height;

function setCameraResolution(id) {
  const resolution = CAMERA_RESOLUTIONS.find((entry) => entry.id === id);
  if (!resolution) return false;
  cameraResolutionId = resolution.id;
  MAP_VIEW_WORLD_W = resolution.width;
  MAP_VIEW_WORLD_H = resolution.height;
  localStorage.setItem("dw-camera-resolution", resolution.id);
  return true;
}

function loadModelScalePreferences(defaults = {}) {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_SCALE_STORAGE_KEY) || "{}");
    return {
      player: clampClientNumber(saved.player, defaults.player ?? 1, MODEL_SCALE_MIN, MODEL_SCALE_MAX),
      pet: clampClientNumber(saved.pet, defaults.pet ?? 1, MODEL_SCALE_MIN, MODEL_SCALE_MAX)
    };
  } catch {
    return { player: defaults.player ?? 1, pet: defaults.pet ?? 1 };
  }
}

function saveModelScalePreference(kind, scale) {
  if (kind !== "player" && kind !== "pet") return false;
  const value = clampClientNumber(scale, 1, MODEL_SCALE_MIN, MODEL_SCALE_MAX);
  state.actorScales[kind] = value;
  const saved = loadModelScalePreferences(state.actorScales);
  saved[kind] = value;
  localStorage.setItem(MODEL_SCALE_STORAGE_KEY, JSON.stringify(saved));
  return true;
}

function loadPetNamePreference() {
  return localStorage.getItem(SHOW_PET_NAME_STORAGE_KEY) !== "false";
}

function setPetNamePreference(enabled) {
  state.showPetNames = Boolean(enabled);
  localStorage.setItem(SHOW_PET_NAME_STORAGE_KEY, String(state.showPetNames));
}

function quickMenuHotkeysEnabled() {
  return localStorage.getItem(QUICK_MENU_HOTKEYS_STORAGE_KEY) !== "false";
}

function setQuickMenuHotkeysEnabled(enabled) {
  const isEnabled = Boolean(enabled);
  localStorage.setItem(QUICK_MENU_HOTKEYS_STORAGE_KEY, String(isEnabled));
  if (!isEnabled) quickMenuHotkeys?.clear();
  return isEnabled;
}
const MAP_LOADING_MIN_MS = 850;
const MAP_LOADING_MAX_MS = 5000;
let rewardDialogAnimationFrame = 0;
let rewardDialogAnimationToken = 0;
const MAP_LOADING_SPRITE_POOL = [
  1011, 1021, 1033, 1053, 1051, 1061, 1071, 1080, 1100, 1112,
  1123, 1142, 1152, 1162, 1171, 1172, 1192, 1212, 1222, 1232,
  1243, 1251, 1290, 1300, 1400, 1410, 1562, 1580, 1590, 1600,
  1610, 1620, 1630, 1652, 1672, 1680, 1700, 1720, 1732, 1772,
  1780, 1790, 1810, 2370, 2380, 2391, 2400, 2410, 2420, 2430,
  2440, 2450, 2460, 2470, 2480, 2490, 2500, 2510, 2520, 2530,
  2540, 2550, 2560, 3010, 3020, 3030, 3050, 3070, 3100, 20530
];
const MAP_LOADING_TIPS = [
  "301a 设置省流量省模式。",
  "流量不够请按 301a 设置减少流量。",
  "按2 33 a花少量银币3快速补血a。",
  "装备3生命球a后战斗结束自动回血。",
  "可按2 94 a快速参与3每日活动a。",
  "可3长按 * 键a隐藏同屏其他玩家。",
  "可按2 # a键查看各类3聊天记录a。",
  "按2 15 a键可在5神秘商店a买增值道具。",
  "与朋友一起游戏可以使您更愉快。",
  "和他人交易钱财时请注意防骗。",
  "3神秘商店道具a能使游戏更轻松。"
];
const isNativeBridge = Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor);
const isCapacitorLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname) && !location.port;
const isPackagedClient = ["file:", "capacitor:"].includes(location.protocol) || isNativeBridge || isCapacitorLocalhost;
const isEdgeBrowser = /\bEdg\//.test(navigator.userAgent || "");

function shouldUseStaticLoginImage() {
  return window.LoginMediaPolicy?.shouldUseStaticImage(navigator.userAgent) ?? isEdgeBrowser;
}
function configuredServerOrigin() {
  const saved = localStorage.getItem("serverOrigin") || "";
  const configured = isPackagedClient ? (window.APP_CONFIG?.serverOrigin || saved) : "";
  if (configured) return String(configured).trim().replace(/\/$/, "");
  if (!isPackagedClient) return "";
  const input = prompt("请输入游戏服务器地址，例如 http://192.168.1.8:6588", "");
  const normalized = String(input || "").trim().replace(/\/$/, "");
  if (normalized) localStorage.setItem("serverOrigin", normalized);
  return normalized;
}
const configuredOrigin = configuredServerOrigin();
const SERVER_ORIGIN = configuredOrigin || (location.protocol === "file:" ? "http://127.0.0.1:6588" : "");
const SYNTHETIC_CLICK_SUPPRESS_MS = 450;
const battleCommands = [
  { key: "attack", label: "攻击", slotX: 0, iconX: 0, labelX: 0, labelW: 30 },
  { key: "skill", label: "技能", slotX: 34, iconX: 20, labelX: 30, labelW: 30 },
  { key: "item", label: "道具", slotX: 68, iconX: 40, labelX: 60, labelW: 30 },
  { key: "auto", label: "自动战斗", slotX: 102, iconX: 60, labelX: 120, labelW: 58 },
  { key: "escape", label: "逃跑", slotX: 136, iconX: 80, labelX: 90, labelW: 30 }
];
const battleSkillMenu = [];
const battleItemMenu = [{ id: "empty", label: "暂无道具", disabled: true }];
const BATTLE_ATTACK_LUNGE_EFFECT_ID = 1005;
const BATTLE_ARBITRATION_EFFECT_SRC = "资源/图片/战斗特效/绝世仲裁群攻.png";
const BATTLE_ATTACK_LUNGE_EFFECT_FRAME_WIDTH = 64;
const BATTLE_ATTACK_LUNGE_EFFECT_FRAME_HEIGHT = 32;
const BATTLE_HIT_REACTION_MS = 260;
const controlPadKeys = [
  [{ key: "confirm", label: "确定", digit: "1" }, { key: "up", label: "向上", digit: "2" }, { key: "back", label: "返回", digit: "3" }, { key: "name", label: "名称" }],
  [{ key: "left", label: "向左", digit: "4" }, { key: "nearby", label: "按键5", digit: "5" }, { key: "right", label: "向右", digit: "6" }, { key: "system", label: "系统" }],
  [{ key: "chat", label: "聊天", digit: "7" }, { key: "down", label: "向下", digit: "8" }, { key: "task", label: "任务", digit: "9" }, { key: "channel", label: "频道" }]
];
const quickMenuTimeoutMs = 850;
let quickMenuHotkeys = null;

function cssFontVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const gameMenuTabs = [
  { title: "常用", hotkey: "1", items: [
    ["物品行囊", "2.8"], ["个人状态", "2.10"], ["宠物指令", "1.9"], ["队伍指令", "1.13"],
    ["神秘商店", "2.4"], ["佣兵指令", "1.9"], ["宠物之魂", "2.12"], ["龙魂系统", "1.49"],
    ["全服竞技场", "1.49"], ["仙气修炼", "1.49"]
  ] },
  { title: "辅助", hotkey: "3", items: [
    ["快速购物", "1.16"], ["生产装备", "2.18"], ["快速补血", "1.14"], ["查看成就", "2.6"],
    ["原地挂机", "1.47"], ["生活技能", "1.41"], ["灵魂粉末", "1.11"]
  ] },
  { title: "聊天", hotkey: "7", items: [
    ["同屏聊天", "2.7"], ["本服广播", "2.28"], ["本线广播", "2.28"], ["队伍聊天", "2.7"],
    ["发悄悄话", "2.7"], ["口袋好友", "1.42"], ["家族指令", "1.42"]
  ] },
  { title: "任务", hotkey: "9", items: [
    ["查看任务", "2.21"], ["区域地图", "2.11"], ["世界地图", "2.11"], ["每日活动", "2.20"], ["口袋攻略", "1.12"]
  ] },
  { title: "系统", hotkey: "0", items: [
    ["流量设置", "1.13"], ["游戏帮助", "1.13"], ["细节设置", "1.13"], ["退出游戏", "1.13"],
    ["免费领取", "1.13"], ["账号功能", "1.13"]
  ] },
  { title: "商城", hotkey: "", items: [
    ["游戏充值", "2.4"], ["元宝道具", "2.4"], ["金币道具", "2.4"], ["当前等级特惠商品", "2.4"], ["团包", "2.4"]
  ] }
].map((tab) => ({ ...tab, items: tab.items.map(([label, icon]) => ({ label, icon })) }));

function menuActionForLabel(label) {
  if (label === "物品行囊") return "bag";
  if (label === "快速购物") return "quick_shop";
  if (label === "个人状态") return "stats";
  if (label === "宠物指令") return "pet_command";
  if (label === "佣兵指令") return "mercenary_command";
  if (label === "龙魂系统") return "dragon_soul";
  if (label === "全服竞技场") return "arena";
  if (label === "仙气修炼") return "immortal_cultivation";
  if (label === "灵魂粉末") return "soul_powder_menu";
  if (label === "元宝道具") return "yuanbao_shop";
  if (label === "生活技能") return "life_skills";
  if (label === "原地挂机") return "idle_hunt";
  if (label === "同屏聊天") return "chat_nearby";
  if (label === "本服广播") return "chat_server";
  if (label === "本线广播") return "chat_channel";
  if (label === "队伍聊天") return "chat_team";
  if (label === "发悄悄话") return "chat_whisper";
  if (label === "退出游戏") return "logout";
  if (label === "账号功能") return "account_menu";
  if (label === "免费领取") return "free_claim";
  if (label === "查看任务") return "task_menu";
  if (label === "区域地图") return "region_map";
  if (label === "世界地图") return "world_map";
  if (label === "细节设置") return "detail_settings";
  return "";
}

gameMenuTabs.forEach((tab) => {
  tab.items.forEach((item) => {
    item.action = menuActionForLabel(item.label);
    if (item.label.includes("濂藉弸")) item.action = "friends";
    if (item.label.includes("闃熶紞")) item.action = "team";
  });
});
if (gameMenuTabs[0]?.items?.[3]) gameMenuTabs[0].items[3].action = "team";
if (gameMenuTabs[2]?.items?.[5]) gameMenuTabs[2].items[5].action = "friends";

const screens = {
  auth: $("#authScreen"),
  server: $("#serverScreen"),
  line: $("#lineScreen"),
  characters: $("#characterScreen"),
  create: $("#createScreen"),
  game: $("#gameScreen")
};

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function loadAuthCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(authCacheKey) || "{}");
    return { account: cached?.account || "" };
  } catch {
    return {};
  }
}

function saveAuthCache(account) {
  localStorage.setItem(authCacheKey, JSON.stringify({ account }));
}

function saveUserHints() {
  const hints = {};
  Object.entries(state.users || {}).forEach(([account, user]) => {
    hints[account] = {};
    if (user?.selected) hints[account].selected = user.selected;
    if (user?.elfKingVaultAdventureKey) hints[account].elfKingVaultAdventureKey = user.elfKingVaultAdventureKey;
  });
  localStorage.setItem(storageKey, JSON.stringify(hints));
  state.users = hints;
}

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[name].classList.add("active");
  $("#gatewayControlPad")?.classList.toggle("active", ["server", "line", "characters"].includes(name));
  syncCoverLoginMedia(name === "auth");
}

function setLoading(active, text = "资源加载中...") {
  const loading = $("#loading");
  loading.textContent = text;
  loading.classList.toggle("active", active);
}

async function fetchResource(src) {
  return fetch(src);
}

async function apiGet(path) {
  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    headers: state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}
  });
  const result = await response.json().catch(() => ({ ok: false, error: "bad_response" }));
  if (!response.ok || !result.ok) throw new Error(result.error || "request_failed");
  return result;
}

async function loadMapManifest() {
  try {
    const manifest = await apiGet("/api/maps/manifest");
    state.mapManifest = normalizeMapManifest(manifest);
  } catch (error) {
    console.warn("map manifest fallback", error);
    state.mapManifest = normalizeMapManifest(defaultMapManifest);
  }
  await loadNewMapRuntime();
  state.mapManifest = mergeNewMapManifest(state.mapManifest);
  if (window.MapAdminEditor) window.MapAdminEditor.setManifest(state.mapManifest);
  return state.mapManifest;
}

async function loadGameVisualSettings() {
  try {
    const result = await apiGet("/api/game-visual");
    const visual = result.visual || {};
    const defaults = {
      player: clampClientNumber(visual.playerScale, 1, 0.5, 2.5),
      pet: clampClientNumber(visual.petScale, 1, 0.5, 2.5),
      other: clampClientNumber(visual.otherScale, 1, 0.5, 2.5)
    };
    state.actorScales = { ...defaults, ...loadModelScalePreferences(defaults) };
  } catch (error) {
    console.warn("game visual settings fallback", error);
    const defaults = { player: 1, pet: 1, other: 1 };
    state.actorScales = { ...defaults, ...loadModelScalePreferences(defaults) };
  }
}
async function loadGrowthConfig() {
  try {
    const result = await apiGet("/api/growth-config");
    if (result?.ok && result.config) growthConfig = result.config;
  } catch (error) {
    console.warn("growth config fallback", error);
  }
}

async function loadLoginVisualSettings() {
  const defaults = defaultLoginVisualSettings();
  try {
    const result = await apiGet("/api/login-visual");
    state.loginVisual = normalizeLoginVisualSettings(result.visual || {}, defaults);
  } catch (error) {
    console.warn("login visual settings fallback", error);
    state.loginVisual = defaults;
  }
}

function defaultLoginVisualSettings() {
  const useStaticImage = shouldUseStaticLoginImage();
  return {
    mode: "cover",
    mediaType: useStaticImage ? "image" : "video",
    mediaSrc: useStaticImage ? "\u8d44\u6e90/\u56fe\u7247/\u767b\u5f55\u5c01\u9762.png" : "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4",
    hotspotLeft: 65,
    hotspotWidth: 28,
    hotspotHeight: 5.2,
    arrowLeft: 67.035,
    positions: [64.0436, 70.3282, 76.3365, 82.5519, 88.9055],
    videoSkipStart: true,
    videoSkipStartTime: 0.1
  };
}

function normalizeLoginVisualSettings(visual = {}, fallback = defaultLoginVisualSettings()) {
  const positions = Array.isArray(visual.positions) ? visual.positions : fallback.positions;
  const mediaType = visual.mediaType === "image" ? "image" : "video";
  const rawMediaSrc = String(visual.mediaSrc || "").trim() || String(fallback.mediaSrc || "").trim();
  const mediaSrc = rawMediaSrc || (mediaType === "image" ? "\u8d44\u6e90/\u56fe\u7247/\u767b\u5f55\u5c01\u9762.png" : "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4");
  return {
    mode: visual.mode === "classic" ? "classic" : "cover",
    mediaType,
    mediaSrc,
    hotspotLeft: clampClientNumber(visual.hotspotLeft, fallback.hotspotLeft, 0, 100),
    hotspotWidth: clampClientNumber(visual.hotspotWidth, fallback.hotspotWidth, 5, 100),
    hotspotHeight: clampClientNumber(visual.hotspotHeight, fallback.hotspotHeight, 2, 30),
    arrowLeft: clampClientNumber(visual.arrowLeft, fallback.arrowLeft, 0, 100),
    positions: fallback.positions.map((value, index) => clampClientNumber(positions[index], value, 0, 100)),
    videoSkipStart: visual.videoSkipStart !== false,
    videoSkipStartTime: clampClientNumber(visual.videoSkipStartTime, fallback.videoSkipStartTime, 0, 30)
  };
}

function clampClientNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeMapManifest(manifest = {}) {
  const maps = Array.isArray(manifest.maps) && manifest.maps.length ? manifest.maps : defaultMapManifest.maps;
  const mergedMaps = maps.some((map) => map.name === elfKingVault.dungeon.mapName)
    ? maps
    : [...maps, { name: elfKingVault.dungeon.mapName, file: elfKingVault.dungeon.mapFile, entry: elfKingVault.dungeon.entry, desc: "四关宝库Boss" }];
  const files = manifest.mapFiles || Object.fromEntries(maps.map((map) => [map.name, map.file || `${map.name}.json`]));
  return {
    ...manifest,
    maps: mergedMaps,
    mapFiles: { ...defaultMapManifest.mapFiles, ...files, [elfKingVault.dungeon.mapName]: elfKingVault.dungeon.mapFile },
    portals: Array.isArray(manifest.portals) ? manifest.portals : []
  };
}

function knownMapNames() {
  return state.mapManifest.maps.map((map) => map.name);
}

function parseChj(buffer) {
  const bytes = new Uint8Array(buffer);
  const frameWidth = bytes[2];
  const frameHeight = bytes[3];
  const animationCount = bytes[6];
  const offsets = Array.from(bytes.slice(7, 7 + animationCount));
  const listLength = bytes[7 + animationCount];
  const listStart = 8 + animationCount;
  const list = Array.from(bytes.slice(listStart, listStart + listLength));
  const animations = offsets.map((start, index) => {
    const end = index + 1 < offsets.length ? offsets[index + 1] : list.length;
    return list.slice(start, end);
  });
  const imageOffset = 8 + animationCount + listLength;
  const png = bytes.slice(imageOffset);
  const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  const image = new Image();
  image.src = url;
  return new Promise((resolve, reject) => {
    image.onload = () => {
      try { URL.revokeObjectURL(url); } catch {}
      resolve({ frameWidth, frameHeight, animations, image, url: "" });
    };
    image.onerror = (error) => {
      try { URL.revokeObjectURL(url); } catch {}
      reject(error);
    };
  });
}

async function loadSprite(id) {
  if (state.sprites.has(id)) return state.sprites.get(id);
  if (state.loadingSprites.has(id)) return state.loadingSprites.get(id);
  const promise = (async () => {
    const response = await fetchResource(`资源/精灵图/${id}.chj`);
    if (!response.ok) throw new Error(`CHJ ${id} 加载失败`);
    const sprite = await parseChj(await response.arrayBuffer());
    state.sprites.set(id, sprite);
    return sprite;
  })();
  state.loadingSprites.set(id, promise);
  try {
    return await promise;
  } finally {
    state.loadingSprites.delete(id);
  }
}

async function loadSpriteOptional(id) {
  if (!id) return null;
  try {
    return await loadSprite(id);
  } catch {
    return null;
  }
}

function loadImage(src) {
  if (state.images.has(src)) return state.images.get(src);
  const promise = (async () => new Promise(async (resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed: " + src));
    image.src = src;
  }))();
  promise.then((image) => {
    promise.value = image;
    return image;
  });
  state.images.set(src, promise);
  return promise;
}

async function loadImageOptional(src) {
  try {
    return await loadImage(src);
  } catch {
    state.images.delete(src);
    return null;
  }
}


const NEW_MAP_BASE_PATH = "assets/kdjl-map";
const NEW_MAP_TITLE_OVERRIDES = { "jlmg/401.sj": "绿色圣地" };
const MAX_CACHED_MAPS = 12;
const MAX_BATTLE_DEDUP_IDS = 256;
const MAX_REMOTE_BATTLE_MARKERS = 64;

function newMapTitle(map) {
  return NEW_MAP_TITLE_OVERRIDES[map?.key] || map?.title || map?.describe || map?.key || "未知地图";
}

function newMapDisplayName(map, counts = null) {
  const title = newMapTitle(map);
  const duplicate = counts && (counts.get(title) || 0) > 1;
  return duplicate ? `${title} ${map.id ?? map.key}` : title;
}

async function fetchJsonOptional(src) {
  const response = await fetchResource(src);
  if (!response.ok) return null;
  return response.json();
}

async function loadNewMapRuntime() {
  const runtime = state.newMapRuntime;
  if (runtime.loaded || runtime.failed) return runtime;
  try {
    const [mapData, externalTiles, mapPoints, worldPoints] = await Promise.all([
      fetchJsonOptional(`${NEW_MAP_BASE_PATH}/data/maps.json`),
      fetchJsonOptional(`${NEW_MAP_BASE_PATH}/data/external-tiles.json`),
      fetchJsonOptional(`${NEW_MAP_BASE_PATH}/data/map-points.json`),
      fetchJsonOptional(`${NEW_MAP_BASE_PATH}/data/world-points.json`)
    ]);
    if (!mapData?.maps?.length) throw new Error("新版地图数据不存在");
    for (const map of mapData.maps) if (NEW_MAP_TITLE_OVERRIDES[map.key]) map.title = NEW_MAP_TITLE_OVERRIDES[map.key];
    const titleCounts = new Map();
    for (const map of mapData.maps) titleCounts.set(newMapTitle(map), (titleCounts.get(newMapTitle(map)) || 0) + 1);
    runtime.maps = mapData.maps.slice().sort((a, b) => String(a.world).localeCompare(String(b.world), "zh-CN") || Number(a.id || 0) - Number(b.id || 0));
    runtime.areas = mapData.areas || {};
    runtime.worldMap = mapData.worldMap || {};
    runtime.worldNames = mapData.worldNames || {};
    runtime.externalTiles = externalTiles || {};
    runtime.mapPoints = mapPoints || { areas: {} };
    runtime.worldPoints = worldPoints || { nodes: {} };
    runtime.byName = new Map();
    runtime.byKey = new Map();
    runtime.byId = new Map();
    runtime.nameByKey = new Map();
    for (const map of runtime.maps) {
      const name = newMapDisplayName(map, titleCounts);
      map.__gameName = name;
      runtime.byName.set(name, map);
      runtime.byKey.set(map.key, map);
      if (map.id != null) runtime.byId.set(Number(map.id), map);
      runtime.nameByKey.set(map.key, name);
    }
    runtime.baseSheets = await Promise.all(["00", "01", "02"].map((id) => loadImage(`${NEW_MAP_BASE_PATH}/assets/d/${id}.png`)));
    runtime.loaded = true;
  } catch (error) {
    console.warn("new map runtime fallback", error);
    runtime.failed = true;
  }
  return runtime;
}

function mergeNewMapManifest(manifest) {
  const runtime = state.newMapRuntime;
  if (!runtime.loaded) return manifest;
  const existing = new Set((manifest.maps || []).map((map) => map.name));
  const maps = [...(manifest.maps || [])];
  const mapFiles = { ...(manifest.mapFiles || {}) };
  for (const map of runtime.maps) {
    const name = map.__gameName;
    if (existing.has(name)) continue;
    const entry = map.move || { x: Math.floor((map.width || 15) / 2), y: Math.floor((map.height || 20) / 2) };
    maps.push({ name, file: `new:${map.key}`, entry, desc: `${runtime.worldNames?.[map.world] || map.world || "新版区域"} / ${map.key}`, newMap: true, key: map.key, world: map.world });
    mapFiles[name] = `new:${map.key}`;
  }
  return { ...manifest, maps, mapFiles };
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function newMapBlobUrl(bytes, type = "image/png") {
  return URL.createObjectURL(new Blob([bytes], { type }));
}

function releaseImageBlobUrl(image) {
  const src = image?.src || "";
  if (src.startsWith("blob:")) {
    try { URL.revokeObjectURL(src); } catch {}
  }
}

async function loadBlobImage(bytes, type = "image/png") {
  const url = newMapBlobUrl(bytes, type);
  try {
    const image = await loadImage(url);
    releaseImageBlobUrl(image);
    return image;
  } catch (error) {
    try { URL.revokeObjectURL(url); } catch {}
    throw error;
  } finally {
    state.images.delete(url);
  }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function parseNewTileObject(bytes, offset, length, externalId = -1) {
  const frames = (bytes[offset] & 0x0f) + 1;
  const animated = (bytes[offset] & 0x10) >= 16;
  const mapping = bytes.slice(offset + 2, offset + 2 + 20 * frames);
  const image = await loadBlobImage(bytes.slice(offset + 2 + 20 * frames, offset + length));
  return { frames, animated, mapping, image, externalId };
}

async function loadNewGameMap(name) {
  const runtime = await loadNewMapRuntime();
  const source = runtime.byName.get(name) || runtime.byKey.get(name);
  if (!source) return null;
  if (source.__parsedGameMap) return source.__parsedGameMap;
  const parsed = await parseNewGameMapSource(source, runtime);
  source.__parsedGameMap = parsed;
  return parsed;
}

async function parseNewGameMapSource(source, runtime) {
  const bytes = hexToBytes(source.hex);
  const tilesetCount = bytes[2] & 0x0f;
  const tilesetTable = readU16(bytes, 4);
  const tileAliasCount = bytes[6] & 0xff;
  const tileAliasTable = readU16(bytes, 8);
  const overlayCount = bytes[10] & 0xff;
  const overlayTable = readU16(bytes, 12);
  const pointsCount = bytes[14] & 0xff;
  const pointsTable = readU16(bytes, 16);
  const width = bytes[18] & 0xff;
  const height = bytes[19] & 0xff;
  const rawCells = bytes.slice(20, 20 + width * height * 4);
  const tilesets = [];
  for (let i = 0; i < tilesetCount; i += 1) {
    const offset = readU16(bytes, tilesetTable + i * 4);
    const lenOrId = readU16(bytes, tilesetTable + i * 4 + 2);
    if (offset === 0) {
      const ext = runtime.externalTiles[String(lenOrId)];
      tilesets.push(ext ? {
        frames: ext.frames,
        animated: ext.animated,
        mapping: Uint8Array.from(ext.mapping),
        image: await loadBlobImage(b64ToBytes(ext.pngBase64)),
        externalId: lenOrId
      } : null);
    } else {
      tilesets.push(await parseNewTileObject(bytes, offset, lenOrId));
    }
  }
  const aliases = [];
  let maxAliasBase = 0;
  for (let i = 0; i < tileAliasCount; i += 1) {
    const frames = bytes[tileAliasTable + i * 3] & 0xff;
    const base = readU16(bytes, tileAliasTable + i * 3 + 1);
    aliases.push({ frames, base });
    maxAliasBase = Math.max(maxAliasBase, base);
  }
  const extraSheets = [];
  if (maxAliasBase >= 192) {
    const count = Math.ceil((maxAliasBase - 192 + 1) / 16);
    const p = tileAliasTable + tileAliasCount * 3;
    for (let i = 0; i < count; i += 1) {
      const offset = readU16(bytes, p + i * 4);
      const length = readU16(bytes, p + i * 4 + 2);
      extraSheets.push(await loadBlobImage(bytes.slice(offset, offset + length)));
    }
  }
  const overlays = [];
  if (overlayCount > 0) {
    const imgCache = new Map();
    for (let i = 0; i < overlayCount; i += 1) {
      const p = overlayTable + i * 12;
      const offset = readU16(bytes, p);
      const length = readU16(bytes, p + 2);
      let image = imgCache.get(offset);
      if (!image) {
        image = await loadBlobImage(bytes.slice(offset, offset + length));
        imgCache.set(offset, image);
      }
      overlays.push({ image, x: readU16(bytes, p + 4), y: readU16(bytes, p + 6), w: bytes[p + 8], h: bytes[p + 9], show: bytes[p + 10] !== 0 });
    }
  }
  const points = [];
  for (let i = 0; i < pointsCount; i += 1) {
    const p = pointsTable + i * 4;
    const s = bytes[p + 2] | (bytes[p + 3] << 8);
    points.push({ x: bytes[p], y: bytes[p + 1], s, dir: Math.floor(s / 100) });
  }
  const hasAnimatedLayers = tilesets.some((tile) => Number(tile?.frames || 0) > 1)
    || aliases.some((alias) => Number(alias?.frames || 0) > 0);
  const parsed = { source, bytes, rawCells, tilesets, aliases, extraSheets, overlays, points, baseSheets: runtime.baseSheets, hasAnimatedLayers };
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const c0 = rawCells[p], c1 = rawCells[p + 1], c2 = rawCells[p + 2], c3 = rawCells[p + 3];
      const ts = c0 & 0x0f;
      cells.push({
        base: ts < 15 ? { kind: "new-autotile", parsed, tilesetIndex: ts, variant: c1 } : { kind: "new-alias", parsed, aliasIndex: c1 },
        upper: { kind: "new-alias", parsed, aliasIndex: c2 },
        over: Boolean(c3 & 0x80),
        block: (c3 & 0x0f) === 0,
        flags: c3 & 0xff
      });
    }
  }
  return {
    id: `new-${source.id || source.key}`,
    title: newMapTitle(source),
    name: source.__gameName,
    key: source.key,
    world: source.world,
    width,
    height,
    tileSize: 16,
    layers: ["base", "upper", "over"],
    tilesets: [],
    specialTiles: [],
    cells,
    move: source.move,
    teleports: source.teleports || [],
    points,
    __newMap: true,
    __newParsed: parsed
  };
}

function newMapTeleportDirMatchesMove(dir, moveDir) {
  if (moveDir === "up") return dir >= 50 && dir < 60;
  if (moveDir === "down") return dir >= 60 && dir < 80;
  if (moveDir === "left") return dir >= 80 && dir < 120;
  if (moveDir === "right") return dir >= 120;
  return false;
}

function findNewMapPortal(map, tileX, tileY, direction) {
  if (!map?.__newMap) return null;
  const point = (map.points || []).find((p) => p.x === tileX && p.y === tileY && newMapTeleportDirMatchesMove(p.dir, direction) && (map.teleports || []).some((t) => Number(t.dir) === Number(p.dir)));
  if (!point) return null;
  const teleport = (map.teleports || []).find((t) => Number(t.dir) === Number(point.dir));
  const targetSource = state.newMapRuntime.byId.get(Number(teleport?.to_id));
  if (!targetSource) return null;
  return { to: targetSource.__gameName, toX: Number(teleport.to_x ?? 0), toY: Number(teleport.to_y ?? 0), native: true };
}

function canEnterNewMapTile(map, tileX, tileY, direction) {
  if (!map?.__newMap) return true;
  if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return false;
  const flags = map.cells[tileY * map.width + tileX]?.flags || 0;
  if (direction === "up") return Boolean(flags & 8);
  if (direction === "down") return Boolean(flags & 1);
  if (direction === "left") return Boolean(flags & 4);
  if (direction === "right") return Boolean(flags & 2);
  return (flags & 0x0f) !== 0;
}

async function loadMap(name = "仓库") {
  if (state.maps.has(name)) {
    const cached = state.maps.get(name);
    // Refresh insertion order so the oldest inactive map can be reclaimed.
    state.maps.delete(name);
    state.maps.set(name, cached);
    return cached;
  }
  const newMap = await loadNewGameMap(name);
  if (newMap) {
    cacheMap(name, newMap);
    return newMap;
  }
  const files = state.mapManifest?.mapFiles || mapFiles;
  const response = await fetchResource(`资源/地图/${files[name] || `${name}.json`}`);
  const map = await response.json();
  const images = [];
  for (const tileset of map.tilesets) images.push(loadImage(tileset.image));
  for (const item of map.specialTiles) {
    for (const variant of item.variants) images.push(loadImage(variant.image));
  }
  await Promise.all(images);
  cacheMap(name, map);
  return map;
}

function releaseCachedMap(map) {
  if (!map?.__newMap) return;
  const parsed = map.__newParsed;
  if (!parsed) return;
  // New maps retain decoded image elements through their parse tree.
  parsed.tilesets.length = 0;
  parsed.extraSheets.length = 0;
  parsed.overlays.length = 0;
  if (parsed.source) parsed.source.__parsedGameMap = null;
  map.__newParsed = null;
}

function cacheMap(name, map) {
  state.maps.set(name, map);
  while (state.maps.size > MAX_CACHED_MAPS) {
    const candidate = [...state.maps.entries()].find(([cachedName, cachedMap]) => (
      cachedName !== state.mapName && cachedMap !== state.map
    ));
    if (!candidate) break;
    const [cachedName, cachedMap] = candidate;
    state.maps.delete(cachedName);
    releaseCachedMap(cachedMap);
  }
}

function addBoundedId(set, id, limit = MAX_BATTLE_DEDUP_IDS) {
  if (!id) return;
  set.delete(id);
  set.add(id);
  while (set.size > limit) set.delete(set.values().next().value);
}

function idleMapPrefetch() {
  const queue = knownMapNames().filter((name) => !state.maps.has(name));
  if (!queue.length) return;
  const schedule = () => {
    if (!queue.length) return;
    const run = () => {
      const name = queue.shift();
      if (!name || state.maps.has(name)) return;
      loadMap(name).finally(schedule);
    };
    if (typeof requestIdleCallback === 'function') { requestIdleCallback(run, { timeout: 2000 }); }
    else { setTimeout(run, 300); }
  };
  schedule();
}

function scheduleLightweightMapPrefetch(currentMapName = "") {
  if (!/^(1|true|yes)$/i.test(String(localStorage.getItem("dw-prefetch-all-maps") || ""))) return;
  const queue = knownMapNames().filter((name) => name !== currentMapName && !state.maps.has(name));
  if (!queue.length) return;
  const schedule = () => {
    if (!queue.length || !screens.game.classList.contains("active")) return;
    const run = () => {
      const name = queue.shift();
      if (!name || state.maps.has(name)) { schedule(); return; }
      loadMap(name).catch(() => null).finally(() => setTimeout(schedule, 800));
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1200);
  };
  setTimeout(schedule, 3000);
}

async function changeMap(name, tileX, tileY, options = {}) {
  name = resolveLegacyNewMapName(name);
  const shouldShowMapLoading = state.player && state.map && name !== state.mapName;
  const loadingToken = shouldShowMapLoading ? beginMapLoadingTransition() : 0;
  try {
    if (state.idleHuntActive && name !== state.mapName) stopIdleHunt("切换地图，挂机已取消");
    state.map = await loadMap(name);
    state.tilesetsById = new Map((state.map.tilesets || []).map((t) => [t.id, t]));
    state.mapName = name;
    await ensureCurrentMapActorSprites();
    state.fieldSteps = 0;
    state.encounterCooldown = ["原野怪区", "幻影狩猎场"].includes(name) ? 4 : 0;
    const sourceTileX = options.sourceTileX ?? tileX;
    const sourceTileY = options.sourceTileY ?? tileY;
    const finalTileX = typeof tileX === "string" ? resolvePortalCoord(tileX, sourceTileX, sourceTileY, state.map.width) : tileX;
    const finalTileY = typeof tileY === "string" ? resolvePortalCoord(tileY, sourceTileX, sourceTileY, state.map.height) : tileY;
    placeActorAt(finalTileX, finalTileY);
    broadcastState(true);
  } catch (error) {
    if (shouldShowMapLoading) forceFinishMapLoadingTransition(loadingToken);
    showMenuHint?.(`???????${error.message || error}`);
    throw error;
  } finally {
    if (shouldShowMapLoading) scheduleFinishMapLoadingTransition(loadingToken);
  }
}

function placeActorAt(tileX, tileY) {
  const tileSize = state.map.tileSize || 16;
  const tile = findNearestStandableTile(state.map, tileX, tileY, localActorsOnCurrentMap());
  const safeX = tile.x;
  const safeY = tile.y;
  const x = safeX * tileSize;
  const y = safeY * tileSize;
  Object.assign(state.player, { x, y, fromX: x, fromY: y, targetX: x, targetY: y, stepProgress: 1, moving: false });
  if (state.pet) {
    const petX = Math.max(0, safeX - 1) * tileSize;
    Object.assign(state.pet, { x: petX, y, fromX: petX, fromY: y, targetX: petX, targetY: y, stepProgress: 1, moving: false, path: [], followWait: 0 });
  }
}

function findRole() {
  state.selected = normalizeSelection(state.selected);
  return careerTree.roleForSelection(state.selected);
}

function normalizeSelection(selection = {}) {
  const next = careerTree.normalizeSelection(selection, 486);
  if (!petCatalog.some((pet) => pet.id === Number(next.petId))) next.petId = 486;
  return next;
}

function renderGenderChoices() {
  const container = $("#genderGroup");
  container.classList.add("gender-choices");
  container.innerHTML = "";
  ["女", "男"].forEach((gender) => {
    const selected = gender === state.selected.gender;
    const selection = normalizeSelection({
      ...state.selected,
      gender,
      className: careerTree.INITIAL_CLASS,
      sub: careerTree.INITIAL_SUB
    });
    const role = careerTree.roleForSelection(selection);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `gender-choice selection-option${selected ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    const figure = document.createElement("span");
    figure.className = "gender-choice-figure selection-figure";
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 112;
    canvas.dataset.spriteId = String(role.id);
    canvas.dataset.selected = selected ? "true" : "false";
    const label = document.createElement("span");
    label.className = "selection-label";
    label.textContent = gender === "女" ? "【女性】" : "【男性】";
    figure.appendChild(canvas);
    button.append(figure, label);
    button.addEventListener("click", () => {
      state.selected.gender = gender;
      renderCreator();
    });
    container.appendChild(button);
    drawPreview(canvas, role.id, selected);
  });
  decorateMenuFrame(container);
}

function renderCreator() {
  state.selected = normalizeSelection({
    ...state.selected,
    className: careerTree.INITIAL_CLASS,
    sub: careerTree.INITIAL_SUB,
    petId: 486
  });
  renderGenderChoices();
}

async function drawPreview(canvas, spriteId, selected = false) {
  if (!canvas?.isConnected) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sprite = await loadSprite(spriteId);
  if (!canvas.isConnected || Number(canvas.dataset.spriteId || spriteId) !== Number(spriteId)) return;
  ctx.imageSmoothingEnabled = false;
  const now = performance.now();
  const frame = getFrame(sprite, {
    direction: "down",
    moving: selected,
    idleTick: now * 0.006,
    frameTick: now * 0.03
  });
  const targetSize = Math.min(80, canvas.width * 0.75, canvas.height * 0.72);
  const scale = Math.min(1.6, targetSize / Math.max(sprite.frameWidth, sprite.frameHeight));
  const w = sprite.frameWidth * scale;
  const h = sprite.frameHeight * scale;
  drawSpriteFrame(ctx, sprite, frame, (canvas.width - w) / 2, canvas.height - h - 9, w, h);
}

let lastSelectionPreviewFrame = 0;

function animateSelectionPreviews(now) {
  if (now - lastSelectionPreviewFrame < 350) return;
  lastSelectionPreviewFrame = now;
  const root = screens.characters.classList.contains("active")
    ? screens.characters
    : screens.create.classList.contains("active") ? screens.create : null;
  root?.querySelectorAll('canvas[data-sprite-id][data-selected="true"]').forEach((canvas) => {
    drawPreview(canvas, Number(canvas.dataset.spriteId), true);
  });
}

function createActor({ name, spriteId, x, y, petId = null }) {
  return {
    name,
    spriteId,
    petId,
    x,
    y,
    fromX: x,
    fromY: y,
    targetX: x,
    targetY: y,
    stepProgress: 1,
    direction: "down",
    moving: false,
    frameTick: 0,
    idleTick: Math.random() * 100,
    bubble: "",
    bubbleUntil: 0,
    followWait: 0,
    nextAi: 800 + Math.random() * 1000
  };
}

function clampStat(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function growthValue(pair, level) {
  return (pair?.[0] || 0) + (pair?.[1] || 0) * (Math.max(1, level) - 1);
}

function fashionForGender(gender = state.selected.gender) {
  return fashionCatalog.filter((item) => item.gender === "通用" || item.gender === gender);
}

function equippedFashion() {
  const id = state.bag.equipped?.fashion;
  return (state.bag.items || []).find((item) => item.id === id && item.kind === "fashion") || null;
}

function phantomTitleBoost(title = "") {
  const rank = Number(String(title).match(/幻影狩猎者（(\d+)）/)?.[1] || 0);
  return rank >= 1 && rank <= 50 ? (51 - rank) / 100 : 0;
}

function phantomTitleExpiryText(entry) {
  const expiresAt = Date.parse(entry?.expiresAt || "");
  if (!expiresAt) return "7天";
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${days}天`;
}

function activePlayerSpriteId() {
  return equippedFashion()?.spriteId || findRole().id;
}

function applyActiveFashionSprite() {
  if (!state.player) return;
  state.player.spriteId = activePlayerSpriteId();
}

let growthConfig = null;
const LEVEL_UP_EXP = [0,
  60, 100, 160, 280, 450, 670, 940, 1260, 1630, 2050, 2520, 3040, 3610, 4230, 4900, 5620, 6390, 7210, 8080, 9000, 9970, 11000, 12090, 13240, 14450, 15720, 17050, 56623, 67890, 79876, 92654, 106231, 120608, 135785, 10234, 11321, 12487, 13734, 15062, 16473, 17968, 19547, 21211, 22960, 24795, 26716, 28724, 296618, 387654, 520000, 567890, 617654, 669321, 722890, 778361, 835734, 895009, 956186, 962190, 1034567, 1109876, 1188123, 1269312, 1353445, 1440522, 1530543, 1623508, 1719417, 172345, 187654, 203987, 221345, 239723, 259121, 279539, 300977, 323435, 346913, 2748920, 2876543, 3007891, 3143207, 3310693, 3481234, 3654829, 3831478, 4011181, 4193938, 4379749, 4568614, 4760533, 4955506, 5153533, 5354614, 5558749, 5765938, 5976181, 6189478, 6405829
];

function expToNextLevel(level) {
  const table = growthConfig?.expTable || LEVEL_UP_EXP;
  return table[Math.max(1, Math.min(99, Math.floor(Number(level) || 1)))] || 0;
}

// Career thresholds are intentionally isolated so the pending career curve can be replaced independently.
function careerExpToNextLevel(level) {
  return expToNextLevel(level);
}

function normalizePetProgress(progress = {}) {
  return {
    level: clampStat(progress.level || 1, 1, 100),
    exp: Math.max(0, Math.floor(Number(progress.exp) || 0))
  };
}

function activePetProgress() {
  const petId = String(normalizePetId(state.selected.petId));
  if (!state.petProgressById[petId]) state.petProgressById[petId] = normalizePetProgress();
  return state.petProgressById[petId];
}

function syncActivePetProgress() {
  state.petProgress = activePetProgress();
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function soulPowderCost(level) {
  return Math.floor(20 + Math.pow(level, 1.55) * 8);
}

function classBaseStats(className, level = state.playerProgress?.level || 100, dragonSoul = state.playerProgress?.dragonSoul || 1) {
  const growthConfigData = growthConfig?.character?.growth || classGrowth[className] || classGrowth[careerTree.INITIAL_CLASS];
  const dragonSoulConfig = growthConfig?.character?.dragonSoul || dragonSoulGrowth;
  const stats = {};
  Object.keys(STAT_LIMITS).forEach((stat) => {
    stats[stat] = growthValue(growthConfigData[stat], level) + (dragonSoulConfig[stat] || 0) * (Math.max(1, dragonSoul) - 1);
  });
  return stats;
}

function mergeStats(base, bonus = {}, clamp = true) {
  const skillId = bonus.skillId || base.skillId || "pet_default";
  const skill = skillCatalog[skillId] || skillCatalog.pet_default;
  const skillIds = [...new Set(["shining_strike", ...(base.skillIds || []), ...(bonus.skillIds || []), skillId].filter(Boolean))];
  const statValue = (stat) => {
    const value = (base[stat] || 0) + (bonus[stat] || 0);
    return clamp ? clampStat(value, STAT_MINIMUMS[stat] || 0, STAT_LIMITS[stat]) : Math.round(value);
  };
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
    skill: bonus.skill || base.skill || skill.name,
    skillId,
    skillIds,
    forceBasicAttack: bonus.forceBasicAttack || base.forceBasicAttack || false,
    power: bonus.power || base.power || skill.attackScale || 1.2,
    manaScale: bonus.manaScale || base.manaScale || skill.manaScale || 0.3
  };
}

function statsForRole(selection = state.selected) {
  const classSkillIds = {
    "法师": ["mage_wildfire"],
    "剑士": ["sword_blade_dance"],
    "枪手": ["gun_demon_sting"]
  }[selection.className] || [];
  const roleExtraSkills = selection === state.selected ? state.roleExtraSkills || [] : [];
  const mergedSkillIds = [...new Set([...classSkillIds, ...roleExtraSkills])];
  if (state.serverStats && selection === state.selected) {
    return {
      ...state.serverStats,
      skillIds: [...new Set([...(state.serverStats.skillIds || []), ...mergedSkillIds])]
    };
  }
  return applyEquipmentStats(mergeStats(classBaseStats(selection.className), {
    ...subStatBonus[selection.sub],
    skillIds: mergedSkillIds
  }));
}

function statsForPet(petId) {
  const progress = state.petProgressById[String(normalizePetId(petId))] || normalizePetProgress();
  const petGrowthConfig = growthConfig?.pet?.growth || petGrowth;
  const stats = {};
  Object.keys(STAT_LIMITS).forEach((stat) => {
    stats[stat] = growthValue(petGrowthConfig[stat], progress.level);
  });
  const normalizedPetId = normalizePetId(petId);
  const stickerPercent = stickerModuleApi().petStickerStats?.(state.petStickers?.[String(normalizedPetId)] || []) || {};
  Object.entries(stickerPercent).forEach(([stat, percent]) => {
    stats[stat] = Math.round((stats[stat] || 0) * (1 + (Number(percent) || 0) / 100));
  });
  const skillId = petSkillIds[normalizedPetId] || petGrowthConfig.skillId || petGrowth.skillId;
  const extra = state.petExtraSkills?.[String(normalizedPetId)] || state.petExtraSkills?.[normalizedPetId] || [];
  const innate = petInnateSkillIds[normalizedPetId] || petInnateSkillIds[String(normalizedPetId)] || [];
  if (activeMercenaryHasHolySkill("holy_zeus_field")) applyZeusFieldPanelStats(stats);
  return mergeStats(stats, { skill: skillCatalog[skillId]?.name || "灵兽猛击", skillId, skillIds: [...innate, ...extra] }, false);
}

function mercenaryHolySkills(mercenary) {
  return [
    ...(Array.isArray(mercenary?.passiveSkills) ? mercenary.passiveSkills : []),
    ...(Array.isArray(mercenary?.extraSkills) ? mercenary.extraSkills : [])
  ].filter((id) => mercenaryHolySkillIds.has(id));
}

function activeMercenaryHasHolySkill(skillId) {
  return mercenaryHolySkills(activeMercenary()).includes(skillId);
}

function applyZeusFieldPanelStats(stats) {
  ["hp", "attack", "defense", "mana", "speed"].forEach((stat) => {
    stats[stat] = Math.round((stats[stat] || 0) * 1.3);
  });
  return stats;
}

function activeMercenary() {
  return (state.mercenaries || []).find((merc) => merc.id === state.activeMercenaryId) || null;
}

function mercenaryNecklaceFor(mercenary) {
  if (!mercenary?.necklaceId) return null;
  return (state.mercenaryNecklaces || []).find((item) => item.id === mercenary.necklaceId) || null;
}

function statsForMercenary(mercenary) {
  const config = mercenaryTypes[mercenary?.type] || mercenaryTypes.sword;
  const level = Math.max(1, Math.min(100, Number(mercenary?.level) || 100));
  const mercConfig = growthConfig?.mercenary || {};
  const mercBase = mercConfig.base || mercenaryBaseStats;
  const mercMin = mercConfig.minFactor ?? 0.1;
  const mercMax = mercConfig.maxFactor ?? 1;
  const factor = mercMin + ((level - 1) / 99) * (mercMax - mercMin);
  const stats = {};
  Object.entries(mercBase).forEach(([stat, value]) => {
    stats[stat] = Math.round(value * factor);
  });
  const necklace = mercenaryNecklaceFor(mercenary);
  const orbIds = new Set(necklace?.orbIds || []);
  (state.mercenaryOrbs || []).filter((orb) => orbIds.has(orb.id)).forEach((orb) => {
    (orb.stats || []).forEach((entry) => {
      stats[entry.stat] = (stats[entry.stat] || 0) + (Number(entry.value) || 0);
    });
  });
  const learnedSkillIds = mercenaryHolySkills(mercenary);
  if (learnedSkillIds.includes("holy_zeus_field")) applyZeusFieldPanelStats(stats);
  const skillIds = [config.skillId, ...new Set(learnedSkillIds)];
  return {
    ...stats,
    skill: skillById(config.skillId).name,
    skillId: config.skillId,
    skillIds,
    forceBasicAttack: false,
    power: skillById(config.skillId).attackScale || 1,
    manaScale: skillById(config.skillId).manaScale || 0
  };
}

function applyEquipmentStats(stats) {
  const equipment = getEquippedItems();
  const fashion = equippedFashion();
  if (!equipment.length && !fashion) return stats;
  const flat = {};
  const percent = {};
  let breakStatLimit = false;
  equipment.forEach((item) => {
    if (item.kind === "fashion") return;
    if (item.breakStatLimit) breakStatLimit = true;
    if (item.mainStat) flat[item.mainStat] = (flat[item.mainStat] || 0) + (item.mainValue || 0);
    Object.entries(item.fixedStats || {}).forEach(([stat, value]) => {
      flat[stat] = (flat[stat] || 0) + (Number(value) || 0);
    });
    (item.affixes || []).forEach((affix) => {
      if (affix.kind === "percent") {
        percent[affix.stat] = (percent[affix.stat] || 0) + (affix.percent || 0);
      } else {
        flat[affix.stat] = (flat[affix.stat] || 0) + (affix.value || 0);
      }
    });
  });
  const next = { ...stats };
  Object.keys(STAT_LIMITS).forEach((stat) => {
    const limit = breakStatLimit ? Number.POSITIVE_INFINITY : STAT_LIMITS[stat];
    next[stat] = clampStat(((next[stat] || 0) + (flat[stat] || 0)) * (1 + (percent[stat] || 0)), 0, limit);
  });
  if (fashion) {
    ["hp", "defense", "speed", "attack", "mana", "crit", "critDamage"].forEach((stat) => {
      const limit = breakStatLimit ? Number.POSITIVE_INFINITY : STAT_LIMITS[stat];
      next[stat] = clampStat((next[stat] || 0) * 1.3, STAT_MINIMUMS[stat] || 0, limit);
    });
  }
  const titleBoost = phantomTitleBoost(state.phantom?.equippedTitle || "");
  if (titleBoost) {
    ["hp", "defense", "speed", "attack", "mana", "crit", "critDamage"].forEach((stat) => {
      const limit = breakStatLimit ? Number.POSITIVE_INFINITY : STAT_LIMITS[stat];
      next[stat] = clampStat((next[stat] || 0) * (1 + titleBoost), STAT_MINIMUMS[stat] || 0, limit);
    });
  }
  return next;
}

function getEquippedItems() {
  const equippedIds = Object.values(state.bag.equipped || {});
  return (state.bag.items || []).filter((item) => ["equipment", "fashion"].includes(item.kind) && equippedIds.includes(item.id));
}

function statsForActor(actor) {
  if (actor?.battleStats) return actor.battleStats;
  if (actor?.isPet) return statsForPet(actor.spriteId);
  if (actor?.isMercenary) return statsForMercenary(actor.mercenaryData);
  if (actor === state.player) return statsForRole();
  if (actor?.arenaStats) return actor.arenaStats;
  return mergeStats(classBaseStats("剑士", 60, 1), { hp: -180000, attack: -30000, defense: -18000, speed: -2500, skill: "引导斩", skillId: "sword_guard" });
}

function combatPowerForStats(stats = {}) {
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

function effectIdForActor(actor, useSkill) {
  const pool = [1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051, 1052];
  if (actor?.isPet) {
    const petIds = { 486: 1047, 495: 1048, 832: 1049, 836: 1050, 840: 1052 };
    return useSkill ? (petIds[actor.spriteId] || 1044) : pool[actor.spriteId % pool.length];
  }
  if (actor?.isMercenary) return useSkill ? 1046 : 1044;
  if (actor === state.player) {
    const mapped = { "枪手": 1045, "法师": 1051, "剑士": 1044 };
    return useSkill ? (mapped[state.selected.className] || 1044) : pool[actor.spriteId % pool.length];
  }
  return useSkill ? 1046 : 1044;
}

function battleAttackSpriteId(actor) {
  if (actor?.immortalBossId || actor?.elfKingVaultBossId || actor?.elfKingVaultStageId) return actor.spriteId;
  return careerTree.attackSpriteByWalkSprite[String(actor?.spriteId)] || petModule.battleSpriteIdForPet(actor?.spriteId);
}

function battleSpriteLoadPromisesFor(...actors) {
  return actors.filter(Boolean).flatMap((actor) => [
    loadSpriteOptional(actor.spriteId),
    loadSpriteOptional(battleAttackSpriteId(actor))
  ]);
}

function battleEffectIdsFor(...actors) {
  const ids = new Set();
  ids.add(BATTLE_ATTACK_LUNGE_EFFECT_ID);
  ids.add(BATTLE_HEAL_EFFECT_ID);
  actors.filter(Boolean).forEach((actor) => {
    ids.add(effectIdForActor(actor, false));
    ids.add(effectIdForActor(actor, true));
    if (actor.pet) {
      ids.add(effectIdForActor(actor.pet, false));
      ids.add(effectIdForActor(actor.pet, true));
    }
  });
  Object.values(BATTLE_STATUS_ICONS).forEach((id) => ids.add(id));
  return [...ids].filter((id) => Number.isFinite(id));
}

function canMoveToPixel(x, y) {
  const map = state.map;
  const tileSize = map.tileSize || 16;
  const tx = Math.floor(x / tileSize);
  const ty = Math.floor(y / tileSize);
  return canStandOnTile(map, tx, ty, localActorsOnCurrentMap());
}

function canStandOnTile(map, tileX, tileY, actors = []) {
  if (!map || tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return false;
  const tileSize = map.tileSize || 16;
  if (actorAtPixel(tileX * tileSize, tileY * tileSize, actors)?.staticNpc) return false;
  return !map.cells[tileY * map.width + tileX]?.block;
}

function clampMapTile(map, tileX, tileY) {
  return {
    x: Math.max(0, Math.min((map?.width || 1) - 1, Math.floor(Number(tileX) || 0))),
    y: Math.max(0, Math.min((map?.height || 1) - 1, Math.floor(Number(tileY) || 0)))
  };
}

function findNearestStandableTile(map, tileX, tileY, actors = []) {
  const start = clampMapTile(map, tileX, tileY);
  if (!map) return start;
  if (canStandOnTile(map, start.x, start.y, actors)) return start;

  const queue = [start];
  const seen = new Set([`${start.x},${start.y}`]);
  const directions = [
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: -1, y: 0 }
  ];

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || next.x < 0 || next.y < 0 || next.x >= map.width || next.y >= map.height) continue;
      if (canStandOnTile(map, next.x, next.y, actors)) return next;
      seen.add(key);
      queue.push(next);
    }
  }

  return start;
}

function actorAtPixel(x, y, actors = []) {
  return actors.find((actor) => actor && Math.abs(actor.x - x) < 1 && Math.abs(actor.y - y) < 1);
}

function localActorsOnCurrentMap() {
  return state.remotes.filter((actor) => (actor.mapName || "仓库") === state.mapName);
}

async function ensureCurrentMapActorSprites() {
  const ids = [...new Set(localActorsOnCurrentMap().map((actor) => actor.spriteId).filter(Boolean))];
  await Promise.all(ids.map((id) => loadSpriteOptional(id)));
}

function openStaticNpcMenu(npc) {
  if (!npc?.staticNpc) return false;
  const key = staticNpcMenuKey(npc);
  const now = performance.now();
  if (key && state.staticNpcMenuSuppressKey === key && now < state.staticNpcMenuSuppressUntil) return true;
  state.inputDir = null;
  state.staticNpcMenuSuppressKey = key;
  state.staticNpcMenuSuppressUntil = now + 900;
  if (npc.roleChangeNpc) {
    openRoleChangeMenu();
    return true;
  }
  if (npc.statRankingNpc) {
    openStatRankingRootMenu();
    return true;
  }
  if (npc.phantomNpc) {
    openPhantomNpcMenu();
    return true;
  }
  if (npc.renameNpc) {
    openPenguinRename();
    return true;
  }
  if (npc.storageNpc) {
    openStorageMenu();
    return true;
  }
  if (isDiziNpc(npc)) {
    if (typeof window.openDiziNpcMenu === "function") window.openDiziNpcMenu();
    else openDiziNpcMenuFallback();
    return true;
  }
  if (npc.wildMonsterId === "afei" || npc.immortalBossId || npc.elfKingVaultBossId) {
    openBossChallengeMenu(npc);
    return true;
  }
  return false;
}

function staticNpcMenuKey(npc) {
  if (!npc) return "";
  return [
    npc.mapName || state.mapName,
    npc.name || "",
    npc.wildMonsterId || "",
    npc.immortalBossId || "",
    npc.elfKingVaultBossId || "",
    isDiziNpc(npc) ? "dizi" : "",
    Math.round(npc.x || 0),
    Math.round(npc.y || 0)
  ].join("|");
}

function isDiziNpc(npc) {
  return npc?.npcId === "dizi" || npc?.diziNpc === true || npc?.name === "笛子" || npc?.name === "疯狂吹牛";
}

function suppressStaticNpcMenu(ms = 900) {
  state.staticNpcMenuSuppressUntil = Math.max(state.staticNpcMenuSuppressUntil || 0, performance.now() + ms);
}

async function openDiziNpcMenuFallback() {
  state.menuMode = "dizi_npc_fallback";
  state.menuItem = 0;
  let status = null;
  try { status = await apiGet("/api/daily-news/status"); } catch {}
  setMenuAsSingleList("笛子", [
    { label: "疯狂吹牛", icon: "1.39" },
    { label: status?.hasReadToday ? "每日新闻（今日已阅读）" : "每日新闻（可得1阅读点）", icon: "1.49" },
    { label: `阅读兑换（${status?.readingPoints || 0}点）`, icon: "1.11" }
  ]);
  bindCurrentMenuClicks(confirmDiziNpcFallback);
}

async function confirmDiziNpcFallback() {
  if (state.menuMode === "dizi_npc_fallback") {
    if (state.menuItem === 0) {
      if (typeof window.openMadBragMenu === "function") return window.openMadBragMenu();
      showMenuHint("疯狂吹牛模块加载失败");
      return;
    }
    if (state.menuItem === 1) {
      try {
        const result = await postApi("/api/daily-news/read", {});
        state.menuMode = "dizi_news_fallback";
        setMenuAsSingleList("每日新闻", [
          { label: result.gainedPoints ? "阅读完成，获得 1 点阅读点数" : "今日已阅读，明天再来", icon: "1.49", disabled: true },
          ...String(result.text || "").split(/\r?\n/).filter(Boolean).map((line) => ({ label: line.slice(0, 96), icon: "1.49", disabled: true }))
        ]);
      } catch (error) {
        showMenuHint(error.message === "daily_news_unavailable" ? "新闻暂时不可用" : "新闻读取失败");
      }
      return;
    }
    if (state.menuItem === 2) {
      const result = await apiGet("/api/reading-exchange/catalog").catch(() => null);
      if (!result) return showMenuHint("兑换列表读取失败");
      state.readingExchangeItems = result.items || [];
      state.menuMode = "dizi_exchange_fallback";
      setMenuAsSingleList(`阅读兑换（${result.readingPoints || 0}点）`, state.readingExchangeItems.length
        ? state.readingExchangeItems.map((item) => ({ label: `${item.name}（${item.cost}点）`, icon: item.icon || "1.49" }))
        : [{ label: "暂无可兑换物品", icon: "1.49", disabled: true }]);
      bindCurrentMenuClicks(confirmDiziNpcFallback);
      return;
    }
  }
  if (state.menuMode === "dizi_exchange_fallback") {
    const item = state.readingExchangeItems?.[state.menuItem];
    if (!item) return;
    try {
      const result = await postApi("/api/reading-exchange/redeem", { itemId: item.id });
      await refreshBag().catch(() => null);
      showMenuHint(`兑换成功：${result.item.name} x${result.item.quantity}`);
      openDiziNpcMenuFallback();
    } catch (error) {
      showMenuHint(error.message === "not_enough_reading_points" ? "阅读点数不足" : "兑换失败");
    }
  }
}

function startStep(actor, direction, recordPath = false) {
  if (!direction || actor.stepProgress < 1) return false;
  if (actor === state.player && state.stall.active) return false;
  const tileSize = state.map.tileSize || 16;
  let tx = actor.x;
  let ty = actor.y;
  if (direction === "up") ty -= tileSize;
  if (direction === "down") ty += tileSize;
  if (direction === "left") tx -= tileSize;
  if (direction === "right") tx += tileSize;
  actor.direction = direction;
  if (actor === state.player) {
    const npc = actorAtPixel(tx, ty, localActorsOnCurrentMap());
    if (openStaticNpcMenu(npc)) return false;
  }
  if (state.map?.__newMap && !canEnterNewMapTile(state.map, Math.floor(tx / tileSize), Math.floor(ty / tileSize), direction)) return false;
  if (!canMoveToPixel(tx, ty)) return false;
  if (recordPath && state.pet) {
    if (!state.pet.path) state.pet.path = [];
    state.pet.path.push({ x: actor.x, y: actor.y, direction: actor.direction });
    if (state.pet.path.length > PET_FOLLOW_MAX_PATH) state.pet.path.shift();
  }
  actor.fromX = actor.x;
  actor.fromY = actor.y;
  actor.targetX = tx;
  actor.targetY = ty;
  actor.stepProgress = 0;
  actor.moving = true;
  if (recordPath) handlePlayerStepStarted(direction, tx, ty);
  return true;
}

function handlePlayerStepStarted(direction, targetX, targetY) {
  if (state.followLeaderId) return;
  const tileSize = state.map.tileSize || 16;
  const targetTileX = Math.floor(targetX / tileSize);
  const targetTileY = Math.floor(targetY / tileSize);
  const portal = findNewMapPortal(state.map, targetTileX, targetTileY, direction) || findMapPortal(state.mapName, targetTileX, targetTileY, direction);
  if (portal) {
    setTimeout(() => {
      changeMap(portal.to, portal.toX, portal.toY, { sourceTileX: targetTileX, sourceTileY: targetTileY });
    }, 260);
    return;
  }
  if (state.mapName === "原野怪区") {
    state.fieldSteps += 1;
    state.encounterCooldown = Math.max(0, state.encounterCooldown - 1);
    if (!state.battle && state.encounterCooldown <= 0 && state.fieldSteps >= 6 && Math.random() < 0.28) {
      state.encounterCooldown = 8;
      state.fieldSteps = 0;
      setTimeout(startWildBattle, 360);
    }
  }
  if (state.mapName === "幻影狩猎场") {
    state.fieldSteps += 1;
    state.encounterCooldown = Math.max(0, state.encounterCooldown - 1);
    if (!state.battle && state.encounterCooldown <= 0 && state.fieldSteps >= 6 && Math.random() < 0.32) {
      state.encounterCooldown = 8;
      state.fieldSteps = 0;
      setTimeout(startWildBattle, 360);
    }
  }
}

function findMapPortal(mapName, tileX, tileY, direction) {
  const portal = (state.mapManifest?.portals || []).find((portal) => {
    if (portal.from !== mapName) return false;
    if (portal.direction && portal.direction !== "*" && portal.direction !== direction) return false;
    return portalMatch(portal.x, tileX, state.map.width) && portalMatch(portal.y, tileY, state.map.height);
  });
  if (!portal) return null;
  if (portal.to === "\u4ed3\u5e93" && state.mapManifest?.mapFiles?.[NEW_ROXAS_HOME_MAP]) {
    return { ...portal, to: NEW_ROXAS_HOME_MAP, toX: ROXAS_HOME_RETURN.x, toY: ROXAS_HOME_RETURN.y };
  }
  return { ...portal, to: resolveLegacyNewMapName(portal.to) };
}

function portalMatch(rule, value, size) {
  if (rule === "*") return true;
  if (rule === "max") return value >= size - 1;
  return Number(rule) === value;
}

function resolvePortalCoord(rule, sourceX, sourceY, targetSize) {
  if (rule === "$x") return sourceX;
  if (rule === "$y") return sourceY;
  if (rule === "center") return Math.floor((targetSize || 1) / 2);
  if (rule === "max") return targetSize - 1;
  if (rule === "max-1") return Math.max(0, targetSize - 2);
  return Number(rule) || 0;
}

function updateActor(actor, dt, direction) {
  if (actor.stepProgress >= 1 && direction) startStep(actor, direction, actor === state.player);
  actor.moving = actor.stepProgress < 1;
  if (actor.moving) {
    const progress = Math.min(1, actor.stepProgress + dt * 0.0046);
    actor.stepProgress = progress;
    actor.x = actor.fromX + (actor.targetX - actor.fromX) * progress;
    actor.y = actor.fromY + (actor.targetY - actor.fromY) * progress;
    actor.frameTick += dt * WALK_FRAME_TICK_RATE;
    actor.idleTick = 0;
  } else {
    actor.frameTick = 0;
    actor.idleTick += dt * 0.06;
  }
}

function updatePet(dt) {
  const pet = state.pet;
  if (!pet) return;
  if (!pet.path) pet.path = [];
  if (!state.player || state.stall.active || state.battle) {
    pet.moving = false;
    pet.frameTick = 0;
    pet.idleTick += dt * 0.06;
    return;
  }

  if (!pet.moving && pet.path.length > PET_FOLLOW_CATCHUP_LIMIT) {
    const skipped = pet.path.splice(0, pet.path.length - PET_FOLLOW_CATCHUP_KEEP);
    const anchor = skipped[skipped.length - 1];
    if (anchor) {
      pet.x = anchor.x;
      pet.y = anchor.y;
      pet.fromX = pet.targetX = pet.x;
      pet.fromY = pet.targetY = pet.y;
      pet.stepProgress = 1;
      pet.direction = anchor.direction || pet.direction || "down";
    }
  }

  if (!pet.moving) {
    if (pet.path.length >= PET_FOLLOW_DELAY_POINTS) {
      pet.followWait = Math.min(PET_FOLLOW_WAIT_MS, (pet.followWait || 0) + dt);
      if (pet.followWait >= PET_FOLLOW_WAIT_MS) beginPetFollowStep(pet);
    } else {
      pet.followWait = 0;
    }
  }

  pet.moving = pet.stepProgress < 1;
  if (pet.moving) {
    const progress = Math.min(1, pet.stepProgress + dt * 0.0046);
    pet.stepProgress = progress;
    pet.x = pet.fromX + (pet.targetX - pet.fromX) * progress;
    pet.y = pet.fromY + (pet.targetY - pet.fromY) * progress;
    pet.frameTick += dt * WALK_FRAME_TICK_RATE;
    pet.idleTick = 0;
    if (pet.stepProgress >= 1 && pet.path.length >= PET_FOLLOW_DELAY_POINTS) {
      beginPetFollowStep(pet);
      pet.moving = pet.stepProgress < 1;
    }
  } else {
    pet.moving = false;
    pet.frameTick = 0;
    pet.idleTick += dt * 0.06;
  }
}

function beginPetFollowStep(pet) {
  if (!pet || pet.stepProgress < 1 || !pet.path || pet.path.length < PET_FOLLOW_DELAY_POINTS) return false;
  const next = pet.path.shift();
  if (!next) return false;
  if (Math.abs(next.x - pet.x) < 1 && Math.abs(next.y - pet.y) < 1) return false;
  const direction = directionBetweenPoints(pet.x, pet.y, next.x, next.y);
  if (!direction) return false;
  pet.fromX = pet.x;
  pet.fromY = pet.y;
  pet.targetX = next.x;
  pet.targetY = next.y;
  pet.direction = direction;
  pet.stepProgress = 0;
  pet.moving = true;
  pet.followWait = PET_FOLLOW_WAIT_MS;
  return true;
}

function directionBetweenPoints(fromX, fromY, toX, toY) {
  if (toX > fromX) return "right";
  if (toX < fromX) return "left";
  if (toY > fromY) return "down";
  if (toY < fromY) return "up";
  return null;
}

function updateTeamFollow(dt) {
  if (!state.followLeaderId || !state.player || state.battle) return;
  const leader = state.peers.get(state.followLeaderId);
  if (!leader || (leader.mapName || state.mapName) !== state.mapName) return;
  state.followMoveTimer += dt;
  if (state.followMoveTimer < 220 || state.player.moving) return;
  state.followMoveTimer = 0;
  const tileSize = state.map?.tileSize || 16;
  const distance = Math.hypot(leader.x - state.player.x, leader.y - state.player.y);
  if (distance <= tileSize * 1.5) return;
  const dx = leader.x - state.player.x;
  const dy = leader.y - state.player.y;
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  startStep(state.player, dir, true);
}

function findPeerIdByName(name) {
  return [...state.peers.entries()].find(([, peer]) => peer.name === name)?.[0] || "";
}

function resolvePeerId(idOrName) {
  return state.peers.has(idOrName) ? idOrName : findPeerIdByName(idOrName);
}

function isDirectedToMe(msg) {
  const myName = state.player?.name || state.account;
  return msg.to === state.peerId || msg.toName === myName;
}

async function syncFollowerMapToLeader(peerId, leader) {
  if (!state.followLeaderId || peerId !== state.followLeaderId || !leader?.mapName || !state.player || state.battle) return;
  if (leader.mapName === state.mapName) return;
  const tileSize = state.map?.tileSize || 16;
  const lx = Number.isFinite(leader.networkX) ? leader.networkX : leader.x;
  const ly = Number.isFinite(leader.networkY) ? leader.networkY : leader.y;
  const tileX = Math.max(0, Math.floor(lx / tileSize) - 1);
  const tileY = Math.max(0, Math.floor(ly / tileSize));
  await changeMap(leader.mapName, tileX, tileY);
  showMenuHint(`跟随队长进入 ${leader.mapName}`);
}

function updateRemotes(dt) {
  const dirs = ["up", "down", "left", "right", null];
  for (const remote of state.remotes) {
    if (remote.staticNpc) continue;
    remote.nextAi -= dt;
    if (remote.nextAi <= 0) {
      remote.aiDir = dirs[Math.floor(Math.random() * dirs.length)];
      remote.nextAi = 550 + Math.random() * 1400;
    }
    updateActor(remote, dt, remote.aiDir);
  }
}

function updateNetworkActor(actor, dt) {
  // 平滑插值：基于时间进度而非追踪式追赶
  if (actor._netInit && actor._netDuration > 0) {
    const elapsed = performance.now() - actor._netStartTime;
    let progress = Math.min(1, elapsed / actor._netDuration);
    // ease-out 缓动：开始快、结束慢，视觉更自然
    progress = 1 - (1 - progress) * (1 - progress);
    actor.x = actor._netFromX + (actor._netToX - actor._netFromX) * progress;
    actor.y = actor._netFromY + (actor._netToY - actor._netFromY) * progress;
  } else if (actor._netInit) {
    // duration=0，瞬移
    actor.x = actor._netToX ?? actor.networkX ?? actor.x;
    actor.y = actor._netToY ?? actor.networkY ?? actor.y;
  }
  const distance = Math.hypot((actor._netToX ?? actor.x) - actor.x, (actor._netToY ?? actor.y) - actor.y);
  actor.moving = actor.remoteMoving || distance > 0.5;
  if (actor.moving) {
    actor.frameTick += dt * WALK_FRAME_TICK_RATE;
    actor.idleTick = 0;
  } else {
    actor.frameTick = 0;
    actor.idleTick += dt * 0.06;
  }
}

function updateNetworkActors(dt) {
  const now = performance.now();
  for (const [peerId, peer] of state.peers) {
    if (now - (peer.lastSeen || now) > 12000) {
      state.peers.delete(peerId);
      if (state.pendingBattleInvite?.targetPeerId === peerId) {
        const battleId = state.pendingBattleInvite.battleId;
        clearPendingBattleInvite(battleId);
        sendRoomMessage({ type: "battleMarkerEnd", battleId });
        sendRoomMessage({ type: "battleEnd", battleId, to: peerId });
        showMenuHint("对方连接超时，强杀取消");
      }
      cleanupPeerBattleMarkers(peerId);
      continue;
    }
    updateNetworkActor(peer, dt);
    if (peer.pet) updateNetworkActor(peer.pet, dt);
  }
}

function applyNetworkTarget(actor, data) {
  const nextMapName = data.mapName || actor.mapName || "仓库";
  const mapChanged = actor.mapName && nextMapName !== actor.mapName;
  actor.name = data.name ?? actor.name;
  actor.account = data.account || actor.account || "";
  actor.spriteId = data.spriteId ?? actor.spriteId;
  actor.baseSpriteId = data.stall ? (actor.baseSpriteId || actor.spriteId) : 0;
  actor.spriteId = data.stall ? STALL_SPRITE_ID : data.spriteId ?? actor.spriteId;
  if ("stall" in data) actor.stall = data.stall || null;
  actor.direction = data.direction ?? actor.direction;
  actor.remoteMoving = data.moving;
  actor.mapName = nextMapName;

  // 平滑插值：记录起始位置和目标位置
  const nx = data.x;
  const ny = data.y;
  if (mapChanged || !actor._netInit) {
    // 地图切换或首次出现：瞬移到目标
    actor.x = nx;
    actor.y = ny;
    actor.networkX = nx;
    actor.networkY = ny;
    actor._netFromX = nx;
    actor._netFromY = ny;
    actor._netToX = nx;
    actor._netToY = ny;
    actor._netStartTime = performance.now();
    actor._netDuration = 0;
    actor._netInit = true;
  } else {
    // 正常移动：从当前位置平滑过渡到新目标
    const moved = Math.hypot(nx - (actor._netToX ?? nx), ny - (actor._netToY ?? ny));
    actor._netFromX = actor.x;
    actor._netFromY = actor.y;
    actor._netToX = nx;
    actor._netToY = ny;
    actor._netStartTime = performance.now();
    // 根据是否移动决定插值时长：移动中用短时长（快速跟上），静止用长时长
    actor._netDuration = data.moving ? 280 : 100;
    actor.networkX = nx;
    actor.networkY = ny;
  }

  actor.lastSeen = performance.now();
}

async function ensureNetworkSprites(msg) {
  await Promise.all([
    loadSpriteOptional(msg.spriteId),
    msg.pet ? loadSpriteOptional(msg.pet.spriteId) : Promise.resolve(),
    msg.mercenary ? loadSpriteOptional(msg.mercenary.spriteId) : Promise.resolve()
  ]);
}

async function upsertPeerFromMessage(msg) {
  await ensureNetworkSprites(msg);
  let peer = state.peers.get(msg.peerId);
  if (!peer) {
    peer = createActor({ name: msg.name, spriteId: msg.spriteId, x: msg.x, y: msg.y });
    peer.account = msg.account || "";
    peer.networkX = msg.x;
    peer.networkY = msg.y;
    state.peers.set(msg.peerId, peer);
  }
  applyNetworkTarget(peer, msg);
  peer.ownerPeerId = msg.peerId;
  peer.ownerName = msg.name || peer.name || "";
  if ("battleStats" in msg) peer.battleStats = msg.battleStats || null;
  if (msg.pet) {
    if (!peer.pet) {
      peer.pet = createActor({ name: msg.pet.name, spriteId: msg.pet.spriteId, x: msg.pet.x, y: msg.pet.y });
      peer.pet.isPet = true;
      peer.pet.networkX = msg.pet.x;
      peer.pet.networkY = msg.pet.y;
    }
    applyNetworkTarget(peer.pet, msg.pet);
    peer.pet.ownerPeerId = msg.peerId;
    peer.pet.ownerName = msg.name || peer.name || "";
    if ("battleStats" in msg.pet) peer.pet.battleStats = msg.pet.battleStats || null;
  } else {
    peer.pet = null;
  }
  if (msg.mercenary) {
    if (!peer.mercenary) {
      peer.mercenary = createActor({ name: msg.mercenary.name, spriteId: msg.mercenary.spriteId, x: msg.mercenary.x, y: msg.mercenary.y });
      peer.mercenary.isMercenary = true;
      peer.mercenary.networkX = msg.mercenary.x;
      peer.mercenary.networkY = msg.mercenary.y;
    }
    applyNetworkTarget(peer.mercenary, msg.mercenary);
    peer.mercenary.isMercenary = true;
    peer.mercenary.ownerPeerId = msg.peerId;
    peer.mercenary.ownerName = msg.name || peer.name || "";
    if ("mercenaryData" in msg.mercenary) peer.mercenary.mercenaryData = msg.mercenary.mercenaryData || null;
    if ("battleStats" in msg.mercenary) peer.mercenary.battleStats = msg.mercenary.battleStats || null;
  } else {
    peer.mercenary = null;
  }
  peer.battleId = msg.battleId || "";
  peer.clientVersion = msg.clientVersion || peer.clientVersion || "";
  return peer;
}

function cleanupPeerBattleMarkers(peerId, battleId = "") {
  for (const [markerBattleId, marker] of state.remoteBattleMarkers) {
    const hasPeer = (marker.participants || []).some((participant) => participant.peerId === peerId);
    if (hasPeer && battleId && markerBattleId !== battleId) {
      state.remoteBattleMarkers.delete(markerBattleId);
    }
  }
}

const IDLE_HIDE_MS = 180000;

function shouldSuppressNetworkPlayers() {
  if (state.nearbyPlayersHidden) return true;
  if (!state.followLeaderId && !(state.team?.members || []).length) return state.idleHideActive;
  return false;
}

function scheduleIdleHide() {
  cancelIdleHide();
  if (!state.player) return;
  if (state.nearbyPlayersHidden) return;
  state.idleHideTimer = setTimeout(enableIdleHide, IDLE_HIDE_MS);
}

function cancelIdleHide() {
  if (state.idleHideTimer) {
    clearTimeout(state.idleHideTimer);
    state.idleHideTimer = null;
  }
}

function enableIdleHide() {
  if (!state.player) return;
  if (state.nearbyPlayersHidden) return;
  if (state.idleHideActive) return;
  if (state.followLeaderId || (state.team?.members || []).length) return;
  state.idleHideActive = true;
  state.peers.clear();
  state.remoteBattleMarkers.clear();
  broadcastState(true);
  showMenuHint("长时间未操作，已自动隐藏附近玩家");
}

function onUserActivity() {
  if (!state.player) return;
  state.lastActivityAt = performance.now();
  if (state.idleHideActive) {
    state.idleHideActive = false;
  }
  scheduleIdleHide();
}

function setupRealtime() {
  state.forceLoggedOut = false;
  clearSocketHeartbeat();
  clearSocketReconnect();
  if (state.socket) state.socket.close();
  if (!state.realtimeConnected) state.peers.clear();
  const wsUrl = window.OnlineBattleClient?.roomWebSocketUrl
    ? window.OnlineBattleClient.roomWebSocketUrl({ serverOrigin: SERVER_ORIGIN, token: state.authToken })
    : (() => {
      const serverUrl = SERVER_ORIGIN ? new URL(SERVER_ORIGIN) : null;
      const baseUrl = serverUrl
        ? `${serverUrl.protocol === "https:" ? "wss:" : "ws:"}//${serverUrl.host}/room`
        : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/room`;
      const tokenParam = state.authToken ? `${baseUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(state.authToken)}` : "";
      return `${baseUrl}${tokenParam}`;
    })();
  state.socket = new WebSocket(wsUrl);
  const socket = state.socket;
  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;
    state.realtimeConnected = true;
    state.socketReconnectAttempts = 0;
    state.lastSocketPongAt = Date.now();
    startSocketHeartbeat();
    broadcastState(true);
  });
  socket.addEventListener("message", async (event) => {
    if (state.socket !== socket) return;
    let msg = null;
    try {
      msg = expandRoomMessage(JSON.parse(event.data));
    } catch {
      return;
    }
    if (!msg || isOwnEchoRoomMessage(msg)) return;
    if (msg.type === "pong") {
      state.lastSocketPongAt = Date.now();
      realtimeHeartbeat?.markPong();
      return;
    }
    if (msg.type === "pveEncounter" && msg.to === state.peerId) {
      state.pveEncounter = {
        id: String(msg.encounterId || ""),
        monsterId: String(msg.wildMonsterId || ""),
        expiresAt: Date.parse(msg.expiresAt || "") || 0
      };
      if (state.idleHuntActive && state.idleHuntTarget === "wild" && !state.battle) startWildBattle();
      return;
    }
    if (msg.type === "forceLogout") {
      state.forceLoggedOut = true;
      showMenuHint("账号已在其他地方登录");
      logoutGame();
      $("#authMessage").textContent = "账号已在其他地方登录，本设备已下线。";
      return;
    }
    if (msg.type === "leave") {
      state.peers.delete(msg.peerId);
      if (state.pendingBattleInvite?.targetPeerId === msg.peerId) {
        const battleId = state.pendingBattleInvite.battleId;
        clearPendingBattleInvite(battleId);
        sendRoomMessage({ type: "battleMarkerEnd", battleId });
        sendRoomMessage({ type: "battleEnd", battleId, to: msg.peerId });
        showMenuHint("对方已离线，强杀取消");
      }
      cleanupPeerBattleMarkers(msg.peerId);
      if (msg.peerId === state.followLeaderId) {
        leaveTeam(false);
        showMenuHint("队长已离线，已离开队伍");
      } else if (!state.followLeaderId && (state.team.members || []).some((member) => member.peerId === msg.peerId)) {
        state.team.members = (state.team.members || []).filter((member) => member.peerId !== msg.peerId);
        broadcastTeamUpdate();
      }
      return;
    }
    if (msg.type === "state") {
      const peer = await upsertPeerFromMessage(msg);
      cleanupPeerBattleMarkers(msg.peerId, msg.battleId || "");
      syncFollowerMapToLeader(msg.peerId, peer);
    }
    if (msg.type === "chat") {
      const peer = await upsertPeerFromMessage(msg);
      addChat(peer, msg.text, false, msg.channel || "nearby");
    }
    if (msg.type === "systemAnnouncement") {
      addChat({ name: msg.name || "系统公告" }, msg.text, false, "server");
    }
    if (msg.type === "privateChat" && msg.to === state.peerId) {
      addPrivateChatLine(msg.name || "私聊", msg.text, false, msg.peerId);
      openPrivateChatDialog({ peerId: msg.peerId, name: msg.name || "私聊", text: msg.text });
    }
    if (msg.type === "chatError") {
      const hints = { rate_limited: "发言太快，请稍后再试", target_offline: "对方不在线", not_in_team: "当前不在队伍中", bad_target: "私聊目标无效", empty_message: "请输入聊天内容" };
      showMenuHint(hints[msg.error] || "消息发送失败");
    }
    if (msg.type === "friendAdd" && msg.to === state.peerId) {
      addFriend({ peerId: msg.peerId, name: msg.name });
      sendRoomMessage({ type: "friendAdded", to: msg.peerId, name: state.player?.name || state.account });
      showMenuHint(`${msg.name} 已加为好友`);
    }
    if (msg.type === "friendAdded" && msg.to === state.peerId) {
      showMenuHint(`${msg.name} 已加为好友`);
    }
    if (msg.type === "stallSold" && msg.to === state.peerId) {
      handleStallSold(msg);
    }
    if (msg.type === "teamJoinRequest" && isDirectedToMe(msg)) {
      acceptTeamMember(msg.peerId, msg.name);
    }
    if (msg.type === "teamAccepted" && isDirectedToMe(msg)) {
      state.followLeaderId = msg.leaderId;
      state.team = { leaderId: msg.leaderId, leaderName: msg.leaderName || "", members: msg.members || [] };
      stopIdleHunt();
      closeMainMenu();
      broadcastState(true);
      showMenuHint(`已加入 ${msg.leaderName} 的队伍`);
    }
    if (msg.type === "teamUpdate" && (isDirectedToMe(msg) || msg.leaderId === state.followLeaderId || msg.leaderId === state.peerId)) {
      if (state.followLeaderId && msg.leaderId === state.followLeaderId && !rosterHasMe(msg.members || [])) {
        leaveTeam(false);
        showMenuHint("已离开队伍");
        return;
      }
      state.team = { leaderId: msg.leaderId, leaderName: msg.leaderName || state.team.leaderName || "", members: msg.members || [] };
      if (msg.leaderId !== state.peerId) state.followLeaderId = msg.leaderId;
      broadcastState(true);
    }
    if (msg.type === "teamLeave" && isDirectedToMe(msg)) {
      state.team.members = (state.team.members || []).filter((member) => {
        if (msg.memberPeerId) return member.peerId !== msg.memberPeerId;
        return member.name !== msg.name;
      });
      broadcastTeamUpdate();
      broadcastState(true);
      showMenuHint(`${msg.name} 离开队伍`);
    }
    if (msg.type === "teamDisband" && (isDirectedToMe(msg) || msg.leaderId === state.followLeaderId)) {
      leaveTeam(false);
      showMenuHint("队伍已解散");
    }
    if (msg.type === "battleMarker") {
      await showRemoteBattleMarker(msg);
    }
    if (msg.type === "battleMarkerEnd") {
      removeRemoteBattleMarker(msg.battleId);
    }
    if (msg.type === "battleStart" && msg.defenderId === state.peerId) {
      // Deprecated P2P invite path. The server now consumes battleStart and replies with teamBattleStart.
      return;
    }
    if (msg.type === "battleEnd" && (!msg.to || msg.to === state.peerId)) {
      addBoundedId(state.canceledBattleIds, msg.battleId);
    }
    if (msg.type === "battleAccepted" && msg.attackerId === state.peerId) {
      return;
    }
    if (msg.type === "battleRejected" && msg.attackerId === state.peerId) {
      handleBattleRejected(msg);
    }
  if (msg.type === "teamBattleStart" && isTeamMessageForMe(msg)) {
      await acceptTeamBattle(msg);
    }
    if (msg.type === "teamBattleReward" && isTeamMessageForMe(msg)) {
      await acceptTeamBattleReward(msg);
    }
    if (msg.type === "battleChoice" && (!msg.to || msg.to === state.peerId) && state.battle?.id === msg.battleId) {
      return;
    }
    if (msg.type === "battleTurn" && (!msg.to || msg.to === state.peerId) && state.battle?.id === msg.battleId) {
      return;
    }
    if (msg.type === "teamBattleTurn" && isActiveTeamBattleMessage(msg)) {
      if (msg.turnSeq && state.battle.lastTeamTurnSeq >= msg.turnSeq) return;
      if (msg.turnSeq) state.battle.lastTeamTurnSeq = msg.turnSeq;
      await applyBattleTurn(msg);
    }
    if (msg.type === "battleEnd" && (!msg.to || msg.to === state.peerId)) {
      removeRemoteBattleMarker(msg.battleId);
      if (state.battle?.id === msg.battleId) endBattleToMap();
    }
    if (msg.type === "teamBattleEnd" && isActiveTeamBattleMessage(msg)) {
      removeRemoteBattleMarker(msg.battleId);
      if (state.battle?.teamBattleServer && state.battle?.id === msg.battleId) {
        if (msg.reason === "escape" && msg.escapedPeerId !== state.peerId) {
          handleBattleEscape("opponent");
        } else if (msg.reason === "disconnect" && msg.escapedPeerId !== state.peerId) {
          showMenuHint("队伍战斗成员断线，战斗已结束");
          endBattleToMap();
        }
        return;
      }
      if (state.battle?.ending) return;
      endBattleToMap();
    }
    if (msg.type === "battleEscape" && (!msg.to || msg.to === state.peerId) && state.battle?.id === msg.battleId) {
      removeRemoteBattleMarker(msg.battleId);
      handleBattleEscape("opponent");
    }
  });
  socket.addEventListener("error", () => {
    if (state.socket !== socket) return;
    state.realtimeConnected = false;
    if (state.player) showMenuHint(`实时连接失败：${SERVER_ORIGIN || location.origin}`);
  });
  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.realtimeConnected = false;
    clearSocketHeartbeat();
    if (!state.forceLoggedOut && state.player && screens.game.classList.contains("active")) {
      scheduleRealtimeReconnect();
    }
  });
}

function clearSocketHeartbeat() {
  realtimeHeartbeat?.stop();
  state.socketHeartbeatTimer = null;
}

function clearSocketReconnect() {
  if (state.socketReconnectTimer) {
    clearTimeout(state.socketReconnectTimer);
    state.socketReconnectTimer = null;
  }
}

function scheduleRealtimeReconnect(delay = 0) {
  clearSocketReconnect();
  const attempt = Math.min(8, state.socketReconnectAttempts || 0);
  const computedDelay = delay || Math.min(15000, 800 * Math.pow(1.7, attempt));
  state.socketReconnectAttempts = attempt + 1;
  state.socketReconnectTimer = setTimeout(() => {
    state.socketReconnectTimer = null;
    if (!state.forceLoggedOut && state.player && screens.game.classList.contains("active")) setupRealtime();
  }, computedDelay);
}

function startSocketHeartbeat() {
  realtimeHeartbeat?.start();
}

function isOwnEchoRoomMessage(msg) {
  if (!msg || msg.peerId !== state.peerId) return false;
  if (msg.to === state.peerId) return false;
  const serverDirectedTypes = new Set([
    "teamBattleStart",
    "teamBattleTurn",
    "teamBattleEnd",
    "battleRejected",
    "battleEnd",
    "battleEscape",
    "forceLogout"
  ]);
  return !serverDirectedTypes.has(msg.type);
}

function sendRoomMessage(message) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    try {
      state.socket.send(JSON.stringify({ ...message, peerId: state.peerId, clientVersion: state.clientVersion || "" }));
      return true;
    } catch {
      state.socket.close();
    }
  }
  if (state.player && !state.forceLoggedOut) scheduleRealtimeReconnect(200);
  return false;
}

function realtimeReady(showHint = false) {
  const ready = state.socket?.readyState === WebSocket.OPEN;
  if (!ready && showHint) showMenuHint(`实时连接未建立：${SERVER_ORIGIN || location.origin}`);
  return ready;
}

function compactDirection(direction) {
  return ({ up: "u", down: "d", left: "l", right: "r" })[direction] || "d";
}

function expandDirection(direction) {
  return ({ u: "up", d: "down", l: "left", r: "right" })[direction] || direction || "down";
}

function expandRoomMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.type !== "s") return msg;
  const full = Boolean(msg.f);
  const pet = Array.isArray(msg.pt)
    ? {
      name: msg.pt[0],
      spriteId: msg.pt[1],
      x: msg.pt[2],
      y: msg.pt[3],
      mapName: msg.m,
      direction: expandDirection(msg.pt[4]),
      moving: Boolean(msg.pt[5]),
      ...(full && msg.pt.length > 6 ? { battleStats: msg.pt[6] } : {})
    }
    : null;
  const mercenary = Array.isArray(msg.mc)
    ? {
      name: msg.mc[0],
      spriteId: msg.mc[1],
      x: msg.mc[2],
      y: msg.mc[3],
      mapName: msg.m,
      direction: expandDirection(msg.mc[4]),
      moving: Boolean(msg.mc[5]),
      ...(full && msg.mc.length > 6 ? { mercenaryData: msg.mc[6] || null, battleStats: msg.mc[7] || null } : {})
    }
    : null;
  return {
    type: "state",
    peerId: msg.p,
    name: msg.n,
    spriteId: msg.s,
    x: msg.x,
    y: msg.y,
    mapName: msg.m,
    battleId: msg.b || "",
    clientVersion: msg.cv || "",
    direction: expandDirection(msg.d),
    moving: Boolean(msg.v),
    pet,
    mercenary,
    ...(full ? {
      full: true,
      account: msg.a || "",
      battleStats: msg.bs || null,
      stall: msg.st || null,
      team: msg.tm || { leaderId: "", members: [] },
      leaderId: msg.l || ""
    } : {})
  };
}

function broadcastState(force = false) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.player) return;
  const now = performance.now();
  const mercenary = battleMercenaryActor();
  const moving = state.player.moving || state.pet?.moving || mercenary?.moving || false;
  const petState = state.pet && !state.stall.active ? {
    name: state.pet.name,
    spriteId: state.pet.spriteId,
    x: state.pet.x,
    y: state.pet.y,
    mapName: state.mapName,
    direction: state.pet.direction,
    moving: state.pet.moving
  } : null;
  const mercenaryState = mercenary ? {
    name: mercenary.name,
    spriteId: mercenary.spriteId,
    x: mercenary.x,
    y: mercenary.y,
    mapName: state.mapName,
    direction: mercenary.direction,
    moving: mercenary.moving
  } : null;
  const stateSignature = [
    Math.round(state.player.x),
    Math.round(state.player.y),
    state.mapName,
    state.battle?.id || "",
    state.player.direction,
    moving ? 1 : 0,
    state.player.spriteId,
    state.stall.active ? JSON.stringify(state.stall.items || []) : "",
    state.pet && !state.stall.active ? `${state.pet.spriteId},${Math.round(state.pet.x)},${Math.round(state.pet.y)},${state.pet.direction},${state.pet.moving ? 1 : 0}` : "",
    mercenary ? `${mercenary.spriteId},${Math.round(mercenary.x)},${Math.round(mercenary.y)},${mercenary.direction},${mercenary.moving ? 1 : 0}` : ""
  ].join("|");
  const fullStateSignature = [
    state.player.name,
    state.player.spriteId,
    state.mapName,
    state.battle?.id || "",
    state.stall.active ? JSON.stringify(state.stall.items || []) : "",
    JSON.stringify(state.team || {}),
    state.followLeaderId || state.team.leaderId || "",
    petState ? `${petState.name},${petState.spriteId}` : "",
    mercenary ? `${mercenary.name},${mercenary.spriteId},${JSON.stringify(mercenary.mercenaryData || {})}` : ""
  ].join("|");
  const minInterval = moving ? STATE_BROADCAST_MOVING_MS : STATE_BROADCAST_IDLE_MS;
  if (!force && stateSignature === state.lastStateSignature && now - state.lastStateBroadcast < minInterval) return;
  if (!force && stateSignature !== state.lastStateSignature && now - state.lastStateBroadcast < STATE_BROADCAST_MOVING_MS) return;
  const shouldSendFull = force || fullStateSignature !== state.lastFullStateSignature || now - state.lastFullStateBroadcast >= STATE_FULL_BROADCAST_MS;
  state.lastBroadcast = now;
  state.lastStateBroadcast = now;
  state.lastStateSignature = stateSignature;
  if (shouldSendFull) {
    state.lastFullStateSignature = fullStateSignature;
    state.lastFullStateBroadcast = now;
  }
  const payload = {
    type: "s",
    p: state.peerId,
    n: state.player.name,
    s: state.player.spriteId,
    x: Math.round(state.player.x),
    y: Math.round(state.player.y),
    m: state.mapName,
    b: state.battle?.id || "",
    cv: state.clientVersion || "",
    d: compactDirection(state.player.direction),
    v: state.player.moving ? 1 : 0,
    h: shouldSuppressNetworkPlayers() ? 1 : 0
  };
  if (petState) payload.pt = [petState.name, petState.spriteId, Math.round(petState.x), Math.round(petState.y), compactDirection(petState.direction), petState.moving ? 1 : 0];
  if (mercenaryState) payload.mc = [mercenaryState.name, mercenaryState.spriteId, Math.round(mercenaryState.x), Math.round(mercenaryState.y), compactDirection(mercenaryState.direction), mercenaryState.moving ? 1 : 0];
  if (shouldSendFull) {
    payload.f = 1;
    payload.a = state.account;
    payload.bs = statsForRole();
    payload.st = state.stall.active ? { sellerAccount: state.account, items: state.stall.items || [], item: state.stall.items?.[0] || state.stall.item, price: state.stall.items?.[0]?.price || state.stall.price } : null;
    payload.tm = state.team;
    payload.l = state.followLeaderId || state.team.leaderId || "";
    if (payload.pt) payload.pt.push(statsForPet(state.pet.spriteId));
    if (payload.mc) payload.mc.push(mercenary.mercenaryData || null, statsForActor(mercenary));
  }
  state.socket.send(JSON.stringify(payload));
}

function getFrame(sprite, actor) {
  if (Number.isInteger(actor?.frameIndex) && actor.frameIndex >= 0) {
    return { index: actor.frameIndex, flip: actor.frameFlip === true };
  }
  const map = {
    down: { idle: 0, walk: 1 },
    up: { idle: 2, walk: 3 },
    left: { idle: 4, walk: 5 },
    right: { idle: 4, walk: 5, forceFlip: true }
  }[actor.direction || "down"];
  const action = actor.moving ? map.walk : map.idle;
  const frames = sprite.animations[action]?.length ? sprite.animations[action] : sprite.animations[0] || [0];
  const tick = actor.moving ? actor.frameTick : actor.idleTick;
  let raw = frames[Math.floor(tick / 8) % frames.length];
  if (raw === 255 || raw == null) {
    raw = (sprite.animations[0] || []).find((frame) => frame !== 255 && frame != null) ?? 0;
  }
  return { index: raw >= 128 ? raw - 128 : raw, flip: raw >= 128 || map.forceFlip === true };
}

function drawSpriteFrame(ctx, sprite, frame, x, y, w, h) {
  const sx = frame.index * sprite.frameWidth;
  if (frame.flip) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.image, sx, 0, sprite.frameWidth, sprite.frameHeight, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(sprite.image, sx, 0, sprite.frameWidth, sprite.frameHeight, x, y, w, h);
  }
}


function drawNew8(ctx, image, sx8, dx, dy, half) {
  ctx.drawImage(image, sx8 * 8, 0, 8, 8, dx + (half % 2) * 8, dy + Math.floor(half / 2) * 8, 8, 8);
}

function drawNewAutotile(ctx, parsed, tilesetIndex, variant, dx, dy) {
  const tile = parsed.tilesets[tilesetIndex];
  if (!tile?.image) return;
  const tick = Math.floor(performance.now() / 120);
  const frame = tile.frames > 0 ? Math.floor(tick / (tile.animated ? 1 : 2)) % tile.frames : 0;
  const flags = variant & 0xff;
  const b0 = !!(flags & 1), b1 = !!(flags & 2), b2 = !!(flags & 4), b3 = !!(flags & 8);
  const b4 = !!(flags & 0x10), b5 = !!(flags & 0x20), b6 = !!(flags & 0x40), b7 = !!(flags & 0x80);
  const idx = [
    b1 && b0 ? 12 : (b1 && !b0 ? 4 : (!b1 && b0 ? 8 : (!b1 && !b0 && b4 ? 16 : 0))),
    b2 && b0 ? 13 : (b2 && !b0 ? 5 : (!b2 && b0 ? 9 : (!b2 && !b0 && b5 ? 17 : 1))),
    b1 && b3 ? 14 : (b1 && !b3 ? 6 : (!b1 && b3 ? 10 : (!b1 && !b3 && b6 ? 18 : 2))),
    b2 && b3 ? 15 : (b2 && !b3 ? 7 : (!b2 && b3 ? 11 : (!b2 && !b3 && b7 ? 19 : 3)))
  ];
  for (let h = 0; h < 4; h += 1) drawNew8(ctx, tile.image, tile.mapping[frame * 20 + idx[h]], dx, dy, h);
}

function drawNewAlias(ctx, parsed, aliasIndex, dx, dy) {
  if (aliasIndex >= 255 || !parsed.aliases[aliasIndex]) return;
  const alias = parsed.aliases[aliasIndex];
  let tile = alias.base;
  if (alias.frames > 0) tile += Math.floor(performance.now() / 180) % (alias.frames + 1);
  if (tile >= 192) {
    const n = tile - 192;
    const sheet = parsed.extraSheets[Math.floor(n / 16)];
    if (sheet) ctx.drawImage(sheet, (n % 16) * 16, 0, 16, 16, dx, dy, 16, 16);
  } else {
    const sheet = parsed.baseSheets[tile >> 6];
    if (sheet) ctx.drawImage(sheet, ((tile & 0x3f) & 7) * 16, ((tile & 0x3f) >> 3) * 16, 16, 16, dx, dy, 16, 16);
  }
}

function isAnimatedNewTileRef(ref) {
  if (!ref) return false;
  if (ref.kind === "new-autotile") {
    return Number(ref.parsed?.tilesets?.[ref.tilesetIndex]?.frames || 0) > 1;
  }
  if (ref.kind === "new-alias") {
    return Number(ref.parsed?.aliases?.[ref.aliasIndex]?.frames || 0) > 0;
  }
  return false;
}

function newMapOverlayRect(overlay) {
  const w = overlay.w || overlay.image?.width || 0;
  const h = overlay.h || overlay.image?.height || 0;
  return { x: overlay.x || 0, y: overlay.y || 0, w, h };
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawNewMapOverlay(ctx, overlay) {
  if (!overlay?.show || !overlay.image) return;
  const rect = newMapOverlayRect(overlay);
  if (rect.w <= 0 || rect.h <= 0) return;
  ctx.drawImage(overlay.image, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
}

function resizeCanvasBackingStore(canvas, cssWidth, cssHeight) {
  const dpr = Math.max(1, Math.min(MAX_CANVAS_DPR, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return dpr;
}

function ensureNewMapLayerCache(map) {
  if (!map?.__newMap) return null;
  const parsed = map.__newParsed;
  const cacheKey = parsed.hasAnimatedLayers ? Math.floor(performance.now() / 180) : 0;
  if (parsed.layerCache && parsed.layerCacheKey === cacheKey) return parsed.layerCache;
  const width = map.width * 16;
  const height = map.height * 16;
  const makeCanvas = (existing) => {
    if (existing?.canvas && existing?.ctx) {
      if (existing.canvas.width !== width || existing.canvas.height !== height) {
        existing.canvas.width = width;
        existing.canvas.height = height;
      }
      existing.ctx.setTransform(1, 0, 0, 1, 0, 0);
      existing.ctx.clearRect(0, 0, width, height);
      existing.ctx.imageSmoothingEnabled = false;
      return existing;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  };
  const buildStaticCache = () => {
    const previous = parsed.layerCache || {};
    const base = makeCanvas(previous.baseEntry);
    const upper = makeCanvas(previous.upperEntry);
    const over = makeCanvas(previous.overEntry);
    const staticBase = makeCanvas(previous.staticBaseEntry);
    const staticUpper = makeCanvas(previous.staticUpperEntry);
    const staticOver = makeCanvas(previous.staticOverEntry);
    const dynamicCells = [];
    base.ctx.fillStyle = "#000";
    base.ctx.fillRect(0, 0, width, height);
    staticBase.ctx.fillStyle = "#000";
    staticBase.ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const cell = map.cells[y * map.width + x];
        if (!cell) continue;
        const px = x * 16;
        const py = y * 16;
        const baseAnimated = isAnimatedNewTileRef(cell.base);
        const upperAnimated = isAnimatedNewTileRef(cell.upper);
        if (baseAnimated || upperAnimated) dynamicCells.push({ cell, px, py, baseAnimated, upperAnimated });
        if (!baseAnimated) drawTileRef(base.ctx, cell.base, px, py);
        if (!upperAnimated) drawTileRef(cell.over ? over.ctx : upper.ctx, cell.upper, px, py);
      }
    }
    for (const overlay of parsed.overlays || []) drawNewMapOverlay(over.ctx, overlay);
    staticBase.ctx.drawImage(base.canvas, 0, 0);
    staticUpper.ctx.drawImage(upper.canvas, 0, 0);
    staticOver.ctx.drawImage(over.canvas, 0, 0);
    return {
      base: base.canvas,
      upper: upper.canvas,
      over: over.canvas,
      baseEntry: base,
      upperEntry: upper,
      overEntry: over,
      staticBaseEntry: staticBase,
      staticUpperEntry: staticUpper,
      staticOverEntry: staticOver,
      dynamicCells
    };
  };
  if (!parsed.layerCache || parsed.layerCacheWidth !== width || parsed.layerCacheHeight !== height) {
    parsed.layerCache = buildStaticCache();
    parsed.layerCacheWidth = width;
    parsed.layerCacheHeight = height;
  }
  const cache = parsed.layerCache;
  if (parsed.hasAnimatedLayers && cache.dynamicCells?.length) {
    for (const item of cache.dynamicCells) {
      const { cell, px, py, baseAnimated, upperAnimated } = item;
      const tileRect = { x: px, y: py, w: 16, h: 16 };
      if (baseAnimated) {
        cache.baseEntry.ctx.drawImage(cache.staticBaseEntry.canvas, px, py, 16, 16, px, py, 16, 16);
        drawTileRef(cache.baseEntry.ctx, cell.base, px, py);
      }
      if (upperAnimated) {
        const target = cell.over ? cache.overEntry : cache.upperEntry;
        const source = cell.over ? cache.staticOverEntry : cache.staticUpperEntry;
        target.ctx.drawImage(source.canvas, px, py, 16, 16, px, py, 16, 16);
        drawTileRef(target.ctx, cell.upper, px, py);
        if (cell.over) {
          for (const overlay of parsed.overlays || []) {
            if (overlay.show && rectsIntersect(tileRect, newMapOverlayRect(overlay))) drawNewMapOverlay(cache.overEntry.ctx, overlay);
          }
        }
      }
    }
  }
  parsed.layerCacheKey = cacheKey;
  return parsed.layerCache;
}

function drawTileRef(ctx, ref, x, y) {
  if (!ref) return;
  if (ref.kind === "new-autotile") { drawNewAutotile(ctx, ref.parsed, ref.tilesetIndex, ref.variant, x, y); return; }
  if (ref.kind === "new-alias") { drawNewAlias(ctx, ref.parsed, ref.aliasIndex, x, y); return; }
  if (ref.kind === "tile") {
    const tileset = (state.tilesetsById || state.map.tilesetsIndex)?.get(ref.tileset) || state.map.tilesets.find((item) => item.id === ref.tileset);
    const imagePromise = state.images.get(tileset.image);
    if (!imagePromise?.value) return;
    const image = imagePromise.value;
    const sx = (ref.index % tileset.columns) * 16;
    const sy = Math.floor(ref.index / tileset.columns) * 16;
    ctx.drawImage(image, sx, sy, 16, 16, x + TILE_DRAW_OFFSET, y + TILE_DRAW_OFFSET, TILE_DRAW_SIZE, TILE_DRAW_SIZE);
    return;
  }
  if (ref.kind === "tij") {
    const src = `assets/map_tiles/special_variants/${ref.id.replace(".", "_")}_v${String(ref.variant || 0).padStart(3, "0")}.png`;
    const imagePromise = state.images.get(src);
    if (imagePromise?.value) ctx.drawImage(imagePromise.value, x + TILE_DRAW_OFFSET, y + TILE_DRAW_OFFSET, TILE_DRAW_SIZE, TILE_DRAW_SIZE);
  }
}

function drawMapLayer(ctx, layer) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(state.mapViewportX, state.mapViewportY, state.mapViewportW, state.mapViewportH);
  ctx.clip();
  ctx.translate(state.mapViewportX, state.mapViewportY);
  ctx.scale(state.mapScale, state.mapScale);
  ctx.translate(-state.cameraX, -state.cameraY);
  if (state.map?.__newMap) {
    const cache = ensureNewMapLayerCache(state.map);
    const image = cache?.[layer];
    if (image) ctx.drawImage(image, 0, 0);
    ctx.restore();
    return;
  }
  if (layer === "over") {
    ctx.restore();
    return;
  }
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const cell = state.map.cells[y * state.map.width + x];
      const ref = cell?.[layer];
      if (ref) drawTileRef(ctx, ref, x * 16, y * 16);
    }
  }
  ctx.restore();
}
async function hydrateImageCache() {
  for (const [src, promise] of state.images) {
    promise.value = await promise;
  }
}

function worldToScreen(x, y) {
  return {
    x: state.mapViewportX + (x - state.cameraX) * state.mapScale,
    y: state.mapViewportY + (y - state.cameraY) * state.mapScale
  };
}

function drawMapBackdrop(ctx, width, height) {
  ctx.fillStyle = "#050807";
  ctx.fillRect(0, 0, width, height);

  const image = state.images.get("资源/图片/地图背景.png")?.value;
  const bgX = Math.floor(state.mapViewportX);
  const bgY = Math.floor(state.mapViewportY);
  const bgW = Math.ceil(state.mapViewportW);
  const bgH = Math.ceil(state.mapViewportH);
  if (!image) {
    const gradient = ctx.createLinearGradient(0, bgY, 0, bgY + bgH);
    gradient.addColorStop(0, "#63b8ff");
    gradient.addColorStop(0.45, "#2f83d6");
    gradient.addColorStop(1, "#0f3f8f");
    ctx.fillStyle = gradient;
    ctx.fillRect(bgX, bgY, bgW, bgH);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(bgX, bgY, bgW, bgH);
  ctx.clip();
  ctx.fillStyle = "#1e75c6";
  ctx.fillRect(bgX, bgY, bgW, bgH);
  const tileW = image.width * state.mapScale;
  const tileH = bgH;
  const drawW = Math.ceil(tileW) + 1;
  const startX = bgX - (bgX % tileW) - tileW;
  for (let x = startX; x < bgX + bgW + tileW; x += tileW) {
    ctx.drawImage(image, 0, 0, image.width, image.height, Math.floor(x), bgY, drawW, tileH);
  }
  ctx.restore();
}

function activeChannelName() {
  const server = state.servers.find((entry) => String(entry.id) === String(state.serverId));
  const channel = (server?.channels || []).find((entry) => String(entry.id) === String(state.channelId));
  return channel?.name || (state.channelId ? `${state.channelId}线` : "");
}

function drawMapHud(ctx) {
  const level = Math.max(1, Number(state.playerProgress.level) || 1);
  const exp = Math.max(0, Number(state.playerProgress.exp) || 0);
  const expNeed = level < 100 ? Math.max(1, expToNextLevel(level)) : 0;
  const expRatio = level >= 100 ? 1 : Math.max(0, Math.min(1, exp / expNeed));

  ctx.save();
  ctx.translate(state.mapViewportX, state.mapViewportY);
  ctx.scale(state.mapScale, state.mapScale);
  ctx.imageSmoothingEnabled = false;

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 13, 22, 0.95)";
  ctx.fillStyle = "#d9fbff";
  const serverLine = [state.serverName, activeChannelName()].filter(Boolean).join(" ");
  ctx.font = `${serverLine ? 10 : 12}px ${DIALOG_FONT_FAMILY}`;
  const primaryLabel = serverLine || state.mapName || "";
  ctx.strokeText(primaryLabel, 1, 2);
  ctx.fillText(primaryLabel, 1, 2);
  if (serverLine && state.mapName) {
    ctx.font = `10px ${DIALOG_FONT_FAMILY}`;
    ctx.strokeText(state.mapName, 1, 16);
    ctx.fillText(state.mapName, 1, 16);
  }

  const barX = MAP_VIEW_WORLD_W - 26;
  const barY = 2;
  const barW = 7;
  const barH = 24;
  const innerX = barX + 2;
  const innerY = barY + 2;
  const innerW = barW - 4;
  const innerH = barH - 4;
  const fillH = Math.round(innerH * expRatio);

  ctx.fillStyle = "rgba(0, 7, 14, 0.9)";
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  ctx.strokeStyle = "#e8ffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
  ctx.fillStyle = "#001925";
  ctx.fillRect(innerX, innerY, innerW, innerH);
  if (fillH > 0) {
    ctx.fillStyle = "#00eaff";
    ctx.fillRect(innerX, innerY + innerH - fillH, innerW, fillH);
    ctx.fillStyle = "#eaffff";
    ctx.fillRect(innerX, innerY + innerH - fillH, 1, fillH);
  }

  ctx.textAlign = "center";
  ctx.font = `10px ${DIALOG_FONT_FAMILY}`;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 7, 14, 0.95)";
  ctx.fillStyle = "#d9fbff";
  ctx.strokeText("Exp", barX + barW / 2, barY + barH + 3);
  ctx.fillText("Exp", barX + barW / 2, barY + barH + 3);
  ctx.restore();
}

function drawMapUiDecoration(ctx) {
  const primary = state.images.get("资源/图片/地图ui1.png")?.value;
  const secondary = state.images.get("资源/图片/地图ui2.png")?.value;
  const rect = mapScreenRect();
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  if (primary) {
    drawSpriteTile(ctx, primary, 0, 38, x - 7, y - 7, 38, 38);
    drawSpriteTile(ctx, primary, 1, 38, x + w - 31, y - 7, 38, 38);
    drawSpriteTile(ctx, primary, 2, 38, x - 7, y + h - 31, 38, 38);
    drawSpriteTile(ctx, primary, 3, 38, x + w - 31, y + h - 31, 38, 38);
    drawSpriteTile(ctx, primary, 4, 38, x + w / 2 - 19, y - 8, 38, 38);
  }
  if (secondary) {
    drawSpriteTile(ctx, secondary, 0, 24, x + 7, y + h / 2 - 12, 24, 24);
    drawSpriteTile(ctx, secondary, 1, 24, x + w - 31, y + h / 2 - 12, 24, 24);
  }
}

function drawMapBorder(ctx) {
  const image = state.images.get("资源/图片/地图边框.png")?.value;
  if (!image) return;
  const rect = mapScreenRect();
  const source = { left: 3, top: 3, right: 3, bottom: 3 };
  const dest = {
    left: 3,
    top: 3,
    right: 3,
    bottom: 3
  };
  drawNineSlice(ctx, image, source, rect.x, rect.y, rect.w, rect.h, dest);
}

function drawSpriteTile(ctx, image, index, size, dx, dy, dw, dh) {
  const columns = Math.max(1, Math.floor(image.width / size));
  const sx = (index % columns) * size;
  const sy = Math.floor(index / columns) * size;
  if (sx + size > image.width || sy + size > image.height) return;
  ctx.drawImage(image, sx, sy, size, size, dx, dy, dw, dh);
}

function drawNineSlice(ctx, image, source, dx, dy, dw, dh, dest) {
  const sw = image.width;
  const sh = image.height;
  const sx = [0, source.left, sw - source.right];
  const sy = [0, source.top, sh - source.bottom];
  const sWidths = [source.left, sw - source.left - source.right, source.right];
  const sHeights = [source.top, sh - source.top - source.bottom, source.bottom];
  const tx = [dx, dx + dest.left, dx + dw - dest.right];
  const ty = [dy, dy + dest.top, dy + dh - dest.bottom];
  const tWidths = [dest.left, Math.max(0, dw - dest.left - dest.right), dest.right];
  const tHeights = [dest.top, Math.max(0, dh - dest.top - dest.bottom), dest.bottom];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      if (col === 1 && row === 1) continue;
      if (sWidths[col] <= 0 || sHeights[row] <= 0 || tWidths[col] <= 0 || tHeights[row] <= 0) continue;
      ctx.drawImage(image, sx[col], sy[row], sWidths[col], sHeights[row], tx[col], ty[row], tWidths[col], tHeights[row]);
    }
  }
}

function mapScreenRect() {
  return {
    x: state.mapViewportX - state.cameraX * state.mapScale,
    y: state.mapViewportY - state.cameraY * state.mapScale,
    w: (state.map?.width || 0) * MAP_TILE_SIZE * state.mapScale,
    h: (state.map?.height || 0) * MAP_TILE_SIZE * state.mapScale
  };
}

function drawBubble(ctx, text, x, y) {
  if (!text) return;
  ctx.save();
  const bubbleScale = state.battle ? 1 : state.mapScale;
  const fontSize = Math.max(10, 12 * bubbleScale);
  const emojiSize = Math.max(14, 18 * bubbleScale);
  const padding = 7 * bubbleScale;
  const maxLineWidth = Math.min(state.battle ? 220 : 190, 126 * bubbleScale);
  ctx.font = `${fontSize}px ${DIALOG_FONT_FAMILY}`;
  ctx.textAlign = "left";
  const lines = layoutBubbleTokens(ctx, parseMessageTokens(text), maxLineWidth, emojiSize);
  const contentWidth = Math.max(...lines.map((line) => line.width), 22 * state.mapScale);
  const lineHeight = Math.max(fontSize + 4, emojiSize + 2);
  const width = contentWidth + padding * 2;
  const height = lines.length * lineHeight + padding * 2;
  const bx = x - width / 2;
  const by = y - height - 8 * bubbleScale;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "rgba(22, 30, 28, 0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, width, height, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1a241f";
  lines.forEach((line, lineIndex) => {
    let cx = bx + padding;
    const cy = by + padding + lineIndex * lineHeight;
    for (const token of line.tokens) {
      if (token.type === "emoji") {
        drawEmoji(ctx, token.index, cx, cy + (lineHeight - emojiSize) / 2, emojiSize);
        cx += emojiSize + 2;
      } else {
        ctx.fillText(token.text, cx, cy + fontSize);
        cx += token.width;
      }
    }
  });
  ctx.restore();
}

function parseMessageTokens(text) {
  const tokens = [];
  const pattern = /\[e(\d+)\]/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      for (const char of text.slice(last, match.index)) tokens.push({ type: "text", text: char });
    }
    tokens.push({ type: "emoji", index: Math.max(0, Math.min(38, Number(match[1]))) });
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    for (const char of text.slice(last)) tokens.push({ type: "text", text: char });
  }
  return tokens;
}

function layoutBubbleTokens(ctx, tokens, maxWidth, emojiSize) {
  const lines = [{ tokens: [], width: 0 }];
  for (const token of tokens) {
    const item = token.type === "emoji" ? { ...token, width: emojiSize + 2 } : { ...token, width: ctx.measureText(token.text).width };
    let line = lines[lines.length - 1];
    if (line.tokens.length && line.width + item.width > maxWidth) {
      line = { tokens: [], width: 0 };
      lines.push(line);
    }
    line.tokens.push(item);
    line.width += item.width;
  }
  return lines;
}

function drawEmoji(ctx, index, x, y, size) {
  const imagePromise = state.images.get("资源/图片/表情.png");
  const image = imagePromise?.value;
  if (!image) return;
  ctx.drawImage(image, index * 18, 0, 18, 18, x, y, size, size);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawActor(ctx, actor, now, scale = 1.2, nameColor = "#ffffff") {
  const sprite = state.sprites.get(actor.spriteId);
  if (!sprite) {
    loadSpriteOptional(actor.spriteId);
    return;
  }
  const frame = actor.isBattleMarker
    ? { index: Math.floor(now / 360) % 2, flip: false }
    : getFrame(sprite, actor);
  const w = sprite.frameWidth * state.mapScale * scale;
  const h = sprite.frameHeight * state.mapScale * scale;
  const p = worldToScreen(actor.x + 8, actor.y + 15);
  drawSpriteFrame(ctx, sprite, frame, p.x - w / 2, p.y - h, w, h);
  ctx.save();
  ctx.font = `${MAP_NAME_FONT_SIZE * state.mapScale}px ${MAP_NAME_FONT_FAMILY}`;
  ctx.textAlign = "center";
  const nameY = p.y - h - 5 * state.mapScale;
  if (!actor.isPet || state.showPetNames) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(actor.name, p.x + 1, nameY + 1);
    ctx.fillStyle = nameColor;
    ctx.fillText(actor.name, p.x, nameY);
  }
  ctx.restore();
  if (actor.bubble && now < actor.bubbleUntil) drawBubble(ctx, actor.bubble, p.x, nameY - 2 * state.mapScale);
}

function actorMapScale(actor) {
  if (actor?.isPet) return state.actorScales.pet || 1;
  if (actor === state.player) return state.actorScales.player || 1;
  return state.actorScales.other || 1;
}

function randomMapLoadingSpriteId() {
  const raw = MAP_LOADING_SPRITE_POOL[Math.floor(Math.random() * MAP_LOADING_SPRITE_POOL.length)] || 1010;
  return Math.floor(raw / 10);
}

function beginMapLoadingTransition() {
  const token = state.mapLoading.token + 1;
  const spriteId = randomMapLoadingSpriteId();
  if (state.mapLoading.timer) clearTimeout(state.mapLoading.timer);
  const timer = setTimeout(() => {
    if (state.mapLoading.token === token) {
      state.mapLoading.active = false;
      state.mapLoading.timer = 0;
    }
  }, MAP_LOADING_MAX_MS);
  state.mapLoading = {
    active: true,
    token,
    tip: MAP_LOADING_TIPS[Math.floor(Math.random() * MAP_LOADING_TIPS.length)] || "??????",
    spriteId,
    startedAt: performance.now(),
    progress: 0,
    timer
  };
  loadSpriteOptional(spriteId);
  return token;
}

function forceFinishMapLoadingTransition(token) {
  if (state.mapLoading.token !== token) return;
  if (state.mapLoading.timer) clearTimeout(state.mapLoading.timer);
  state.mapLoading.active = false;
  state.mapLoading.timer = 0;
}

function scheduleFinishMapLoadingTransition(token) {
  const startedAt = state.mapLoading.startedAt || performance.now();
  const elapsed = performance.now() - startedAt;
  const delay = Math.max(0, MAP_LOADING_MIN_MS - elapsed);
  setTimeout(() => forceFinishMapLoadingTransition(token), delay);
}

function parseMapLoadingTip(text) {
  const runs = [];
  let color = "#ffffff";
  let buffer = "";
  let inMark = false;
  const flush = () => {
    if (buffer) runs.push({ text: buffer, color });
    buffer = "";
  };
  for (const ch of String(text || "")) {
    if (!inMark && /[23456789]/.test(ch)) {
      flush();
      color = "#31ff5a";
      inMark = true;
      continue;
    }
    if (inMark && ch === "a") {
      flush();
      color = "#ffffff";
      inMark = false;
      continue;
    }
    buffer += ch;
  }
  flush();
  return runs;
}

function wrapMapLoadingRuns(ctx, runs, maxWidth) {
  const lines = [[]];
  let width = 0;
  for (const run of runs) {
    for (const ch of run.text) {
      const w = ctx.measureText(ch).width;
      if (width + w > maxWidth && lines[lines.length - 1].length) {
        lines.push([]);
        width = 0;
      }
      lines[lines.length - 1].push({ text: ch, color: run.color, w });
      width += w;
    }
  }
  return lines;
}

function drawMapLoadingRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawMapLoadingTipBox(ctx, tip) {
  ctx.font = "13px SimSun, NSimSun, monospace";
  const boxW = Math.round(MAP_VIEW_WORLD_W * 0.5);
  const lines = wrapMapLoadingRuns(ctx, parseMapLoadingTip(tip), boxW - 18);
  const lineH = 18;
  const boxH = lines.length * lineH + 18;
  const x = (MAP_VIEW_WORLD_W - boxW) / 2;
  const y = Math.round(MAP_VIEW_WORLD_H * 0.41);
  drawMapLoadingRoundRect(ctx, x, y, boxW, boxH, 3);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.stroke();
  let cy = y + 14;
  for (const line of lines) {
    const lineW = line.reduce((sum, part) => sum + part.w, 0);
    let cx = MAP_VIEW_WORLD_W / 2 - lineW / 2;
    for (const part of line) {
      ctx.fillStyle = part.color;
      ctx.fillText(part.text, cx, cy);
      cx += part.w;
    }
    cy += lineH;
  }
}

function getMapLoadingFrame(sprite, tick) {
  const preferred = sprite.animations[5]?.length ? sprite.animations[5] : sprite.animations[0] || [0];
  let raw = preferred[Math.floor(tick / 18) % preferred.length];
  if (raw === 255 || raw == null) raw = (sprite.animations[0] || []).find((frame) => frame !== 255 && frame != null) ?? 0;
  return { index: raw >= 128 ? raw - 128 : raw, flip: raw >= 128 };
}

function drawMapLoadingSprite(ctx, tick, rightEdge, baselineY) {
  const sprite = state.sprites.get(state.mapLoading.spriteId) || state.sprites.get(state.player?.spriteId);
  if (!sprite) return;
  const frame = getMapLoadingFrame(sprite, tick);
  const x = rightEdge - sprite.frameWidth;
  const y = baselineY - sprite.frameHeight;
  drawSpriteFrame(ctx, sprite, frame, x, y, sprite.frameWidth, sprite.frameHeight);
}

function drawMapLoadingScreen(ctx, width, height, now = performance.now()) {
  const scale = Math.min(width / MAP_VIEW_WORLD_W, height / MAP_VIEW_WORLD_H);
  const cameraW = MAP_VIEW_WORLD_W * scale;
  const cameraH = MAP_VIEW_WORLD_H * scale;
  const offsetX = (width - cameraW) / 2;
  const offsetY = 0;
  const elapsed = Math.max(0, now - (state.mapLoading.startedAt || now));
  const tick = Math.floor(elapsed / (1000 / 60));
  state.mapLoading.progress = Math.min(1, Math.max(state.mapLoading.progress || 0, elapsed / MAP_LOADING_MIN_MS));

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(offsetX, offsetY, cameraW, cameraH);
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = false;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, MAP_VIEW_WORLD_W - 1, MAP_VIEW_WORLD_H - 1);

  drawMapLoadingTipBox(ctx, state.mapLoading.tip);

  ctx.font = "13px SimSun, NSimSun, monospace";
  ctx.fillStyle = "#fff";
  const status = "装载地图中" + ".".repeat(Math.floor(tick / 18) % 6);
  const baseStatusWidth = ctx.measureText("装载地图中").width;
  const spriteRightEdge = (MAP_VIEW_WORLD_W - baseStatusWidth) / 2 - 4;
  const statusX = spriteRightEdge + 4;
  const statusY = MAP_VIEW_WORLD_H - 27;
  drawMapLoadingSprite(ctx, tick, spriteRightEdge, statusY + 2);
  ctx.fillText(status, statusX, statusY);

  const bw = Math.round(MAP_VIEW_WORLD_W * 0.75);
  const bx = (MAP_VIEW_WORLD_W - bw) / 2;
  const by = MAP_VIEW_WORLD_H - 18;
  drawMapLoadingRoundRect(ctx, bx, by, bw, 5, 3);
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  drawMapLoadingRoundRect(ctx, bx + 1, by + 1, Math.floor((bw - 3) * state.mapLoading.progress), 3, 2);
  ctx.fillStyle = "#ff1a1a";
  ctx.fill();
  ctx.restore();
}

function render(now = performance.now()) {
  const canvas = $("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = resizeCanvasBackingStore(canvas, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  if (state.mapLoading.active) {
    try {
      drawMapLoadingScreen(ctx, width, height, now);
    } catch (error) {
      console.error("[map-loading-render-error]", error);
      forceFinishMapLoadingTransition(state.mapLoading.token);
    }
    return;
  }
  if (!state.map || !state.player) return;

  const worldW = state.map.width * MAP_TILE_SIZE;
  const worldH = state.map.height * MAP_TILE_SIZE;
  state.mapScale = Math.min(width / MAP_VIEW_WORLD_W, height / MAP_VIEW_WORLD_H);
  state.mapViewportW = MAP_VIEW_WORLD_W * state.mapScale;
  state.mapViewportH = MAP_VIEW_WORLD_H * state.mapScale;
  state.mapViewportX = (width - state.mapViewportW) / 2;
  state.mapViewportY = 0;
  const targetCameraX = (state.player.x + MAP_TILE_SIZE / 2) - MAP_VIEW_WORLD_W / 2;
  const targetCameraY = (state.player.y + MAP_TILE_SIZE / 2) - MAP_VIEW_WORLD_H / 2;
  state.cameraX = worldW <= MAP_VIEW_WORLD_W ? -(MAP_VIEW_WORLD_W - worldW) / 2 : Math.max(0, Math.min(worldW - MAP_VIEW_WORLD_W, targetCameraX));
  state.cameraY = worldH <= MAP_VIEW_WORLD_H ? -(MAP_VIEW_WORLD_H - worldH) / 2 : Math.max(0, Math.min(worldH - MAP_VIEW_WORLD_H, targetCameraY));

  drawMapBackdrop(ctx, width, height);
  drawMapUiDecoration(ctx);
  drawMapLayer(ctx, "base");
  drawMapLayer(ctx, "upper");
  drawMapBorder(ctx);

  const suppressPeers = shouldSuppressNetworkPlayers();
  const peerActors = suppressPeers
    ? []
    : [...state.peers.values()]
      .filter((peer) => (peer.mapName || "仓库") === state.mapName)
      .flatMap((peer) => peer.pet ? [peer.pet, peer] : [peer])
      .filter((actor) => !isRemoteBattleParticipant(actor));
  const markerActors = [...state.remoteBattleMarkers.values()]
    .filter((marker) => (marker.mapName || "仓库") === state.mapName);
  const localActors = localActorsOnCurrentMap();
  const visibleMarkerActors = suppressPeers ? [] : markerActors;
  const visibleBattleMarker = suppressPeers ? null : state.battleMarker;
  const visiblePet = state.stall.active ? null : state.pet;
  const actors = [...localActors, ...peerActors, ...visibleMarkerActors, visiblePet, state.player, visibleBattleMarker]
    .filter((actor) => actor && !state.hiddenOnMap.has(actor))
    .sort((a, b) => a.y - b.y);
  for (const actor of actors) drawActor(ctx, actor, now, actorMapScale(actor), actor === state.player ? "#fff4a8" : "#e8f4ff");
  drawMapLayer(ctx, "over");
  drawCanvasClickEffects(ctx, now, state.clickEffects, (next) => { state.clickEffects = next; });
  drawMapHud(ctx);
}

function loop(time) {
  const dt = Math.min(40, time - (state.lastTime || time));
  state.lastTime = time;
  animateSelectionPreviews(time);
  if (state.player) {
    updateActor(state.player, dt, state.inputDir);
    updatePet(dt);
    updateTeamFollow(dt);
    updateRemotes(dt);
    updateNetworkActors(dt);
    broadcastState();
    savePlayerPositionThrottled();
  }
  if (state.battle) updateBattleChoiceTimer(time);
  render(time);
  if (state.battle) drawBattleScene();
  requestAnimationFrame(loop);
}

async function enterGame(initialSaved = null) {
  let saved = initialSaved;
  try {
    setLoading(true, "进入地图中...");
    if (!saved) saved = await loadPlayerSave();
    if (saved?.selection?.className) state.selected = normalizeSelection({ ...state.selected, ...saved.selection });
    const role = findRole();
    const pet = petCatalog.find((p) => p.id === state.selected.petId);
    if (!role || !pet) {
      setLoading(false);
      renderCreator();
      showScreen("create");
      return;
    }
  state.bag.equipped = saved?.equipped || {};
  state.bag.items = (saved?.equipment || []).map((item) => {
    const kind = item.kind === "fashion" || item.type === "fashion" ? "fashion" : "equipment";
    return { ...item, kind, type: item.type || kind, icon: item.icon || (kind === "fashion" ? "2.10" : equipmentForgeStats[item.type]?.icon || "2.18"), equipped: Object.values(state.bag.equipped).includes(item.id) };
  });
  setLoading(true, "进入地图中...");
  await loadMapManifest();
  const requestedSavedMapName = resolveLegacyNewMapName(saved?.mapName || "");
  const savedMapName = state.mapManifest.mapFiles[requestedSavedMapName] ? requestedSavedMapName : (state.mapManifest.mapFiles[NEW_ROXAS_HOME_MAP] ? NEW_ROXAS_HOME_MAP : "\u4ed3\u5e93");
  await Promise.all([
    loadMap(savedMapName),
    loadSprite(activePlayerSpriteId()),
    loadSprite(pet.id),
    loadSpriteOptional(STALL_SPRITE_ID),
    loadSpriteOptional(896),
    loadImage("\u8d44\u6e90/\u56fe\u7247/\u8868\u60c5.png"),
    loadImage("\u8d44\u6e90/\u56fe\u7247/\u9b54\u6cd5\u9635.png"),
    loadImage("\u8d44\u6e90/\u56fe\u7247/\u81ea\u52a8\u6218\u6597.png"),
    loadImage("\u8d44\u6e90/\u56fe\u7247/\u70b9\u51fb.png"),
    loadImageOptional("\u8d44\u6e90/\u56fe\u7247/\u5730\u56feui1.png"),
    loadImageOptional("\u8d44\u6e90/\u56fe\u7247/\u5730\u56feui2.png"),
    loadImageOptional("\u8d44\u6e90/\u56fe\u7247/\u5730\u56fe\u80cc\u666f.png"),
    loadImageOptional("\u8d44\u6e90/\u56fe\u7247/\u5730\u56fe\u8fb9\u6846.png")
  ]);
  await hydrateImageCache();
  scheduleLightweightMapPrefetch(savedMapName);
  state.stall = { active: false, items: [], item: null, price: 0, originalSpriteId: 0 };
  state.stallDraftItems = [];
  state.playerProgress = {
    level: clampStat(saved?.level || 1, 1, 100),
    exp: Math.max(0, Number(saved?.exp) || 0),
    careerLevel: clampStat(saved?.careerLevel || 1, 1, 100),
    careerExp: Math.max(0, Number(saved?.careerExp) || 0),
    dragonSoul: clampStat(saved?.dragonSoul || 1, 1, 100)
  };
  state.selected.petId = normalizePetId(state.selected.petId);
  state.petProgressById = Object.fromEntries(Object.entries(saved?.petProgressById || {}).map(([petId, progress]) => [String(normalizePetId(petId)), normalizePetProgress(progress)]).filter(([petId]) => petId !== "0"));
  if (!state.petProgressById[String(state.selected.petId)]) {
    state.petProgressById[String(state.selected.petId)] = normalizePetProgress({ level: saved?.petLevel, exp: saved?.petExp });
  }
  syncActivePetProgress();
  state.ownedPetIds = [...new Set([state.selected.petId, ...(saved?.ownedPets || []).map(normalizePetId)])];
  state.petExtraSkills = saved?.petExtraSkills || {};
  state.roleExtraSkills = Array.isArray(saved?.roleExtraSkills) ? saved.roleExtraSkills : [];
  state.mercenaries = Array.isArray(saved?.mercenaries) ? saved.mercenaries : [];
  state.activeMercenaryId = saved?.activeMercenaryId || "";
  state.mercenaryNecklaces = Array.isArray(saved?.mercenaryNecklaces) ? saved.mercenaryNecklaces : [];
  state.mercenaryOrbs = Array.isArray(saved?.mercenaryOrbs) ? saved.mercenaryOrbs : [];
  state.mercenaryCraft = saved?.mercenaryCraft || {};
  state.stickerInventory = saved?.stickerInventory || {};
  state.petStickers = saved?.petStickers || {};
  state.autoStrategy = normalizeAutoStrategy(saved?.autoStrategy);
  state.friends = Array.isArray(saved?.friends) ? saved.friends : [];
  state.phantom = {
    points: saved?.phantomPoints || 0,
    fragment: 0,
    equippedTitle: saved?.equippedTitle || "",
    claimedTitles: Array.isArray(saved?.claimedTitles) ? saved.claimedTitles : [],
    claimedTitleEntries: Array.isArray(saved?.claimedTitleEntries) ? saved.claimedTitleEntries : []
  };
  state.elfKingVaultProgress = saved?.elfKingVaultProgress || { date: "", claimed: {} };
  state.silver = saved?.silver || 0;
  state.soulPowder = saved?.soulPowder || 0;
  state.immortalPill = saved?.immortalPill || 0;
  state.immortalCultivation = saved?.immortalCultivation || null;
  state.serverStats = saved?.serverStats || null;
  state.team = { leaderId: "", members: [] };
  state.followLeaderId = "";
  state.bag.forgeGem = saved?.forgeGem || 0;
  state.map = state.maps.get(savedMapName);
  state.tilesetsById = new Map((state.map.tilesets || []).map((t) => [t.id, t]));
  state.mapName = savedMapName;

  const startX = Number.isFinite(saved?.x) ? saved.x : 7 * 16;
  const startY = Number.isFinite(saved?.y) ? saved.y : 12 * 16;
  state.player = createActor({ name: saved?.name || state.account, spriteId: activePlayerSpriteId(), x: startX, y: startY, petId: pet.id });
  state.pet = state.ownedPetIds.includes(state.selected.petId)
    ? createActor({ name: pet.name, spriteId: pet.id, x: Math.max(0, startX - 16), y: startY })
    : null;
  if (state.pet) {
    state.pet.isPet = true;
    state.pet.path = [];
  }
  state.remotes = [
    createActor({ name: "引导员", spriteId: 651, x: 5 * 16, y: 9 * 16 }),
    createActor({ name: "小企鹅", spriteId: 161, x: 11 * 16, y: 17 * 16 }),
    createActor({ name: "罗克萨斯", spriteId: 2000, x: 4 * 16, y: 9 * 16 }),
    createRoleChangeNpc(),
    createStatRankingNpc(),
    createDiziNpc(),
    createPhantomNpc(),
    createAfeiBossNpc(),
    ...createImmortalBossNpcs(),
    ...createElfKingVaultBossNpcs()
  ];
  state.remotes[0].mapName = NEW_ROXAS_HOME_MAP;
  state.remotes[1].mapName = NEW_ROXAS_HOME_MAP;
  state.remotes[1].staticNpc = true;
  state.remotes[1].renameNpc = true;
  state.remotes[2].mapName = NEW_ROXAS_HOME_MAP;
  state.remotes[2].staticNpc = true;
  state.remotes[2].storageNpc = true;
  state.remotes[3].mapName = NEW_ROXAS_HOME_MAP;
  state.remotes[3].staticNpc = true;
  state.remotes[3].roleChangeNpc = true;
  state.remotes[4].mapName = NEW_ROXAS_HOME_MAP;
  state.remotes[4].staticNpc = true;
  state.remotes[4].statRankingNpc = true;
  state.remotes[5].mapName = NEW_MARKET_MAP;
  state.remotes[5].staticNpc = true;
  state.remotes[5].npcId = "dizi";
  state.remotes[5].diziNpc = true;
  state.remotes[6].mapName = "\u5e7b\u5f71\u72e9\u730e\u573a";
  state.remotes[6].staticNpc = true;
  state.remotes[6].phantomNpc = true;
  await ensureCurrentMapActorSprites();
  await savePlayerPosition(true);

  function patchBwOptLegacyCompat() {
    if (!window._bwOpt) return;
    const bwOpt = window._bwOpt;
    const originalBroadcast = window.broadcastState;
    window.broadcastState = function (force = false) {
      originalBroadcast(force);
    };
    const originalSave = window.savePlayerPosition;
    window.savePlayerPosition = async function (force = false) {
      await originalSave(force);
    };
  }

  // The legacy optimizer opens a second unscoped /room socket, so scoped server/channel sessions use the authenticated socket below.
  const canUseLegacyBandwidthOptimizer = !state.serverId && !state.channelId;
  if (canUseLegacyBandwidthOptimizer && !window._bwOpt && typeof window.createBandwidthOptimizer === 'function') {
    try {
      window._bwOpt = window.createBandwidthOptimizer(state, { serverOrigin: SERVER_ORIGIN });
      if (window._bwOpt) {
        window._bwOpt.patchBroadcastState({
          battleMercenaryActor: typeof battleMercenaryActor === 'function' ? battleMercenaryActor : () => null,
          statsForRole: typeof statsForRole === 'function' ? statsForRole : () => ({}),
          statsForPet: typeof statsForPet === 'function' ? statsForPet : () => ({}),
          statsForActor: typeof statsForActor === 'function' ? statsForActor : () => ({}),
        });
        window._bwOpt.patchSavePlayerPosition({});
        window._bwOpt.init();
        console.log('[BW-Opt] 客户端带宽优化器已启动');
      }
    } catch (e) {
      console.warn('[BW-Opt] 优化器初始化失败，使用原有逻辑:', e);
    }
  }

  patchBwOptLegacyCompat();
  scheduleIdleHide();
  setupRealtime();

  showScreen("game");
  setLoading(false);
  setTimeout(showLoginChangelogMenu, 150);
  } catch (error) {
    console.error(error);
    const msg = error?.message || error?.type || (typeof error === "string" ? error : "资源加载失败");
    setLoading(true, `进入地图失败：${msg}`);
  }
}

function chatChannelLabel(channel) {
  return ({ server: "服", channel: "线", nearby: "屏", whisper: "私聊", team: "队" })[channel] || "屏";
}

function renderChatLine(line, includeTime = false) {
  const channel = ["server", "channel", "nearby", "whisper", "team"].includes(line.channel) ? line.channel : "nearby";
  const time = includeTime ? `${escapeHtml(line.time)} ` : "";
  return `<div class="chat-line chat-line-${channel}">${time}<span class="chat-channel-tag">【${chatChannelLabel(channel)}】</span>${escapeHtml(line.name)}：${renderMessage(line.text)}</div>`;
}

window.ChatHistoryUI?.configure({
  getLines: () => state.chatLines,
  renderLine: renderChatLine,
  canPrivateChat: (line) => Boolean(line.peerId) && line.peerId !== state.peerId,
  openPrivateChat: (line) => {
    window.ChatHistoryUI.close();
    openChatComposer("whisper", { peerId: line.peerId, name: line.targetName || line.name });
  }
});

function renderChatFeed() {
  $("#chatFeed").innerHTML = state.chatLines.slice(-4).map((line) => renderChatLine(line)).join("");
}

function addChat(actor, text, broadcast = true, channel = state.chatChannel || "nearby") {
  const now = performance.now();
  actor.bubble = text;
  actor.bubbleUntil = now + 2600;
  state.chatLines.push({ name: actor.name, text, channel, peerId: actor.peerId || (actor === state.player ? state.peerId : ""), time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
  renderChatFeed();
  showChatFeedTemporarily();
  if ($("#chatHistoryPanel").classList.contains("active")) renderChatHistory();
  if (broadcast && actor === state.player && state.socket?.readyState === WebSocket.OPEN) {
    sendRoomMessage({ type: "chat.send", channel: state.chatChannel || "nearby", text });
  }
}

function showChatFeedTemporarily() {
  const feed = $("#chatFeed");
  feed.classList.add("active");
  clearTimeout(feed.hideTimer);
  feed.hideTimer = setTimeout(() => {
    feed.classList.remove("active");
  }, 4200);
}

async function postApi(path, data) {
  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {})
    },
    body: JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({ ok: false, error: "bad_response" }));
  if (!response.ok || !result.ok) throw new Error(result.error || "request_failed");
  return result;
}

async function authApi(path, data) {
  try {
    const response = await fetch(`${SERVER_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {})
      },
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({ ok: false, error: "bad_response" }));
    return { response, result };
  } catch (error) {
    return {
      response: { ok: false, status: 0 },
      result: { ok: false, error: "network_error", message: error?.message || "" }
    };
  }
}

async function loadPlayerSave() {
  if (!state.account) return null;
  try {
    const result = await apiGet(`/api/player?account=${encodeURIComponent(state.account)}`);
    return result.player || null;
  } catch (error) {
    console.warn("load player save failed", error);
    return null;
  }
}

async function refreshServerStats() {
  const saved = await loadPlayerSave();
  if (saved?.serverStats) state.serverStats = saved.serverStats;
  return saved;
}

function applyPlayerStateResult(player) {
  if (!player) return;
  state.playerProgress.careerLevel = clampStat(player.careerLevel ?? state.playerProgress.careerLevel, 1, 100);
  state.playerProgress.careerExp = Math.max(0, Number(player.careerExp ?? state.playerProgress.careerExp) || 0);
  if (player.petProgressById) {
    state.petProgressById = Object.fromEntries(Object.entries(player.petProgressById).map(([petId, progress]) => [String(normalizePetId(petId)), normalizePetProgress(progress)]));
    syncActivePetProgress();
  }
  state.silver = player.silver ?? state.silver;
  state.yuanbao = player.yuanbao ?? state.yuanbao;
  state.soulPowder = player.soulPowder ?? state.soulPowder;
  state.immortalPill = player.immortalPill ?? state.immortalPill;
  state.phantom = {
    ...state.phantom,
    equippedTitle: player.equippedTitle ?? state.phantom?.equippedTitle ?? "",
    claimedTitles: Array.isArray(player.claimedTitles) ? player.claimedTitles : state.phantom?.claimedTitles || [],
    claimedTitleEntries: Array.isArray(player.claimedTitleEntries) ? player.claimedTitleEntries : state.phantom?.claimedTitleEntries || []
  };
  state.stickerInventory = player.stickerInventory || state.stickerInventory || {};
  state.petStickers = player.petStickers || state.petStickers || {};
  if (player.serverStats) state.serverStats = player.serverStats;
}

function playerSavePayload(extra = {}) {
  return {
    account: state.account,
    name: state.player?.name || state.account,
    x: state.player?.x || 0,
    y: state.player?.y || 0,
    mapName: state.mapName,
    level: state.playerProgress.level,
    exp: state.playerProgress.exp,
    dragonSoul: state.playerProgress.dragonSoul,
    petLevel: state.petProgress.level,
    petExp: state.petProgress.exp,
    petProgressById: state.petProgressById,
    autoStrategy: state.autoStrategy,
    selection: state.selected,
    activeMercenaryId: state.activeMercenaryId,
    friends: state.friends,
    ...extra
  };
}

async function savePlayerPosition(force = false) {
  if (!state.player || !state.account) return;
  const now = performance.now();
  if (!force && now - state.lastPlayerSave < 1800) return;
  state.lastPlayerSave = now;
  try {
    await postApi("/api/player", playerSavePayload());
  } catch (error) {
    console.warn("save player failed", error);
  }
}

function savePlayerPositionThrottled() {
  savePlayerPosition(false);
}

function openPenguinRename() {
  if (state.penguinRenameOpen || !state.player) return;
  state.penguinRenameOpen = true;
  state.inputDir = null;
  closeHudPanels();
  const panel = $("#renamePanel");
  $("#renameInput").value = state.player.name || state.account;
  $("#renameMessage").textContent = "";
  panel.classList.add("active");
  decorateMenuFrame(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => $("#renameInput").focus(), 0);
}

function closePenguinRename() {
  state.penguinRenameOpen = false;
  $("#renamePanel").classList.remove("active");
  $("#renameMessage").textContent = "";
  suppressStaticNpcMenu();
}

async function submitPenguinRename() {
  if (!state.player) return;
  const name = $("#renameInput").value.trim();
  if (!name || name === state.player.name) return;
  try {
    await postApi("/api/rename", playerSavePayload({ name }));
    state.player.name = name;
    broadcastState(true);
    closePenguinRename();
    addChat(state.player, "名字修改成功", false);
  } catch (error) {
    $("#renameMessage").textContent = error.message === "name_taken" ? "这个名字已经被使用了" : "改名失败，请稍后再试";
  }
}

function renderChatHistory() {
  window.ChatHistoryUI?.render();
}

function openChatHistoryPanel() {
  closeMainMenu();
  $("#chatForm").classList.remove("active");
  $("#emojiPanel").classList.remove("active");
  state.privateChatTarget = null;
  $("#chatInput").placeholder = "";
  window.ChatHistoryUI?.open();
}

function openChatComposer(channel = "nearby", target = null) {
  const labels = { nearby: "同屏聊天", server: "本服广播", channel: "本线广播", team: "队伍聊天", whisper: "悄悄话" };
  closeMainMenu();
  state.chatChannel = channel;
  state.privateChatTarget = target;
  $("#chatTitle").textContent = labels[channel] || "聊天";
  $("#chatChannelHint").textContent = channel === "whisper" ? `对 ${target?.name || ""}` : "";
  $("#chatInput").value = "";
  $("#chatInput").placeholder = channel === "whisper" ? `悄悄对 ${target?.name || ""} 说` : "输入聊天内容";
  $("#chatForm").classList.add("active");
  decorateMenuFrame($("#chatForm"));
  $("#chatForm").querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => $("#chatInput").focus(), 0);
}

function renderMessage(text) {
  return escapeHtml(text).replace(/\[item:([^:\]]+):([^:\]]+):([^\]]+)\]/g, (_, rawIcon, rawKind, rawName) => {
    const icon = decodeURIComponent(rawIcon);
    const kind = decodeURIComponent(rawKind);
    const name = decodeURIComponent(rawName);
    const className = kind === "equipment" ? "chat-item-token equipment" : "chat-item-token";
    const baseName = name.replace(/\s+x\d+$/, "");
    const reward = window.LuckyBoxModule?.rewards?.find((item) => item.name === baseName || item.name === name);
    const label = reward ? luckyItemLabelHtml(reward) : escapeHtml(name);
    return `<span class="${className}">${menuIconHtml(icon)}<strong>${label}</strong></span>`;
  }).replace(/\[e(\d+)\]/g, (_, id) => {
    const index = Math.max(0, Math.min(38, Number(id)));
    return `<i class="emoji-token" style="background-position:-${index * 18}px 0"></i>`;
  }).replace(/\[ico(\d+)\]/g, (_, id) => {
    const index = Math.max(0, Math.min(44, Number(id)));
    return `<i class="ico-emoji-token" style="background-position:-${(index % 9) * 16}px -${Math.floor(index / 9) * 16}px"></i>`;
  });
}

function getNearbyTargets() {
  if (!state.player) return [];
  const peerTargets = [...state.peers.values()].map((peer) => ({ actor: peer, type: "玩家" }));
  const npcTargets = localActorsOnCurrentMap().map((actor) => ({ actor, type: "NPC" }));
  return [...npcTargets, ...peerTargets]
    .map((item) => ({ ...item, distance: Math.hypot(item.actor.x - state.player.x, item.actor.y - state.player.y) }))
    .filter((item) => item.distance <= 96)
    .sort((a, b) => a.distance - b.distance);
}

function battleParticipantSnapshot(actor) {
  if (!actor) return null;
  const isLocalBattleActor = actor === state.player || actor === state.pet || actor?.ownerPeerId === state.peerId;
  return {
    name: actor.name || "",
    spriteId: actor.spriteId || 0,
    x: actor.x || 0,
    y: actor.y || 0,
    mapName: actor.mapName || state.mapName,
    wildMonsterId: actor.wildMonsterId || "",
    immortalBossId: actor.immortalBossId || "",
    peerId: isLocalBattleActor ? state.peerId : (findPeerIdByActor(actor) || "")
  };
}

function battleMarkerSnapshotFor(target) {
  const marker = battleMarkerSnapshot() || {
    x: Math.round(((state.player.x + target.x) / 2) / 16) * 16,
    y: Math.round(((state.player.y + target.y) / 2) / 16) * 16,
    mapName: state.mapName
  };
  if (!marker) return null;
  const participants = [state.player, state.pet, target, target?.pet, target?.mercenary, ...(target?.wildEnemies || [])]
    .map(battleParticipantSnapshot)
    .filter(Boolean);
  return { ...marker, participants };
}

function sameBattleParticipant(actor, participant) {
  if (!actor || !participant) return false;
  const peerId = findPeerIdByActor(actor);
  if (!peerId || !participant.peerId) return false;
  return peerId === participant.peerId;
}

function actorNearRemoteBattleMarker(actor, marker) {
  if (!actor || !marker) return false;
  if (!findPeerIdByActor(actor)) return false;
  if ((marker.mapName || state.mapName) !== state.mapName) return false;
  if ((marker.participants || []).some((participant) => sameBattleParticipant(actor, participant))) return true;
  return Math.hypot((actor.x || 0) - (marker.x || 0), (actor.y || 0) - (marker.y || 0)) <= 80;
}

function battleTargetBlocked(actor) {
  if (!actor) return "目标不存在";
  if (state.battle) return "战斗中不能继续击杀";
  if (state.hiddenOnMap.has(actor)) return "目标已经在战斗中";
  if (allBattleFighters().some((fighter) => fighter.actor === actor)) return "目标已经在战斗中";
  if ([...state.remoteBattleMarkers.values()].some((marker) => actorNearRemoteBattleMarker(actor, marker))) return "目标已经在战斗中";
  if (actor.isBattleMarker) return "目标已经在战斗中";
  return "";
}

function renderNearbyPanel() {
  clearMenuHint();
  const list = $("#nearbyList");
  const targets = getNearbyTargets();
  if (!targets.length) {
    list.innerHTML = `<div class="target-row"><span>附近没有角色<small>靠近其它玩家或引导员</small></span></div>`;
    decorateMenuFrame($("#nearbyPanel"));
    return;
  }
  list.innerHTML = "";
  targets.forEach((target) => {
    const row = document.createElement("div");
    row.className = "target-row";
    row.innerHTML = `<span>${escapeHtml(target.actor.name)}<small>${target.type} / ${Math.round(target.distance)}px</small></span>`;
    const button = document.createElement("button");
    const blocked = battleTargetBlocked(target.actor);
    button.type = "button";
    button.textContent = blocked ? "战斗中" : "击杀";
    button.className = "menu-framed-button compact";
    button.disabled = Boolean(blocked);
    button.addEventListener("click", () => startBattle(target.actor));
    row.appendChild(button);
    list.appendChild(row);
  });
  decorateMenuFrame($("#nearbyPanel"));
  list.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
}

function toggleNearbyPlayersHidden() {
  state.nearbyPlayersHidden = !state.nearbyPlayersHidden;
  if (state.nearbyPlayersHidden) {
    cancelIdleHide();
    state.peers.clear();
    state.remoteBattleMarkers.clear();
  } else {
    state.idleHideActive = false;
    scheduleIdleHide();
  }
  broadcastState(true);
  showMenuHint(state.nearbyPlayersHidden ? "已屏蔽附近玩家" : "已恢复附近玩家显示");
}

function findPeerIdByActor(actor) {
  if (!actor) return "";
  if (actor.ownerPeerId) return actor.ownerPeerId;
  for (const [peerId, peer] of state.peers) {
    if (peer === actor) return peerId;
    if (peer.pet === actor || peer.mercenary === actor) return peerId;
  }
  return "";
}

function isBossNpc(actor) {
  return actor?.wildMonsterId === "afei" || actor?.immortalBossId || actor?.elfKingVaultBossId;
}

function openNearbyActionMenu() {
  const targets = getNearbyTargets().filter((item) => item.type !== "NPC" || isBossNpc(item.actor));
  state.menuMode = "nearby_targets";
  state.menuItem = 0;
  state.menuNearbyTargets = targets;
  const items = targets.length
    ? targets.map((target) => ({ label: `${target.actor.name} / ${Math.round(target.distance)}px`, icon: "2.10" }))
    : [{ label: "附近没有可交互目标", icon: "2.10", disabled: true }];
  setMenuAsSingleList("附近目标", items);
  bindCurrentMenuClicks(confirmNearbyTargetMenu);
}

function confirmNearbyTargetMenu() {
  const target = state.menuNearbyTargets?.[state.menuItem];
  if (!target) return;
  if (isBossNpc(target.actor)) {
    openBossChallengeMenu(target.actor);
    return;
  }
  state.menuTargetActor = target.actor;
  state.menuTargetPeerId = findPeerIdByActor(target.actor);
  state.menuMode = "nearby_actions";
  state.menuItem = 0;
  const stallItems = target.actor?.stall ? (target.actor.stall.items?.length ? target.actor.stall.items : [target.actor.stall.item].filter(Boolean)) : [];
  const blocked = battleTargetBlocked(target.actor);
  setMenuAsSingleList(target.actor.name, [
    ...stallItems.map((item) => ({ label: `购买 ${item.label || item.name || "摊位物品"} x${item.quantity || 1} / ${item.price}银币`, icon: item.icon || "2.8" })),
    { label: "查看属性", icon: "2.10" },
    { label: "查看装备", icon: "2.18" },
    { label: target.actor?.stall ? "强杀（摆摊保护）" : (blocked || "强杀"), icon: "1.3", disabled: target.actor?.stall || Boolean(blocked) },
    { label: "加好友", icon: "1.42" },
    { label: "加入队伍", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmNearbyActionMenu);
}

async function loadPublicPlayer(actor) {
  const account = actor?.account || "";
  const query = account
    ? `account=${encodeURIComponent(account)}`
    : `name=${encodeURIComponent(actor?.name || "")}`;
  const response = await fetch(`${SERVER_ORIGIN}/api/player-public?${query}`);
  const result = await response.json().catch(() => ({ ok: false, error: "bad_response" }));
  if (!response.ok || !result.ok) throw new Error(result.error || "request_failed");
  return result.player;
}

async function openPeerStatsMenu(actor) {
  try {
    const player = await loadPublicPlayer(actor);
    if (actor?.spriteId) player.spriteId = actor.spriteId;
    if (actor?.battleStats) player.stats = actor.battleStats;
    state.menuPeerPublic = player;
    openStatsCard(statsCardSubjectForPeer(player));
  } catch (error) {
    showMenuHint(error.message === "player_not_found" ? "玩家资料不存在" : "属性读取失败");
  }
}

function equippedEquipmentForPublicPlayer(player) {
  const equippedIds = new Set(Object.values(player?.equipped || {}));
  return (player?.equipment || []).filter((item) => ["equipment", "fashion"].includes(item.kind) && equippedIds.has(item.id));
}

async function openPeerEquipmentMenu(playerOrActor) {
  try {
    const player = playerOrActor?.stats ? playerOrActor : await loadPublicPlayer(playerOrActor);
    state.menuMode = "peer_equipment";
    state.menuPeerPublic = player;
    const equipment = equippedEquipmentForPublicPlayer(player);
    const rows = equipment.length
      ? equipment.map((item) => ({
        label: item.kind === "fashion" ? `${item.name}（时装 属性+30%）` : formatEquipment(item),
        icon: item.icon || (item.kind === "fashion" ? "2.10" : "2.18"),
        className: isPeerlessItem(item) ? "rare-fragment" : "",
        longText: true,
        disabled: true
      }))
      : [{ label: "未装备任何装备", icon: "2.18", disabled: true }];
    setMenuAsSingleList(`${player.name}装备`, rows);
  } catch (error) {
    showMenuHint(error.message === "player_not_found" ? "玩家资料不存在" : "装备读取失败");
  }
}

function roleOptionLabel(selection) {
  return careerTree.careerName(selection);
}

function availableRoleSelections() {
  const stage = careerTree.careerStage(state.selected);
  if (stage === 0 && state.playerProgress.level >= careerTree.FIRST_TRANSFER_LEVEL) return careerTree.firstTransferSelections(state.selected);
  if (stage === 1 && state.playerProgress.careerLevel >= careerTree.SECOND_TRANSFER_CAREER_LEVEL) return careerTree.secondTransferSelections(state.selected);
  return [];
}

function openRoleChangeMenu() {
  state.menuMode = "role_change";
  state.menuItem = 0;
  const stage = careerTree.careerStage(state.selected);
  state.menuRoleSelections = availableRoleSelections();
  let rows = state.menuRoleSelections.map((selection) => ({ label: roleOptionLabel(selection), icon: selection.gender === "女" ? "2.10" : "1.49" }));
  if (!rows.length && stage === 0) rows = [{ label: `人物达到${careerTree.FIRST_TRANSFER_LEVEL}级后可领取一次转职任务（当前${state.playerProgress.level}级）`, icon: "1.49", disabled: true }];
  if (!rows.length && stage === 1) rows = [{ label: `职业达到${careerTree.SECOND_TRANSFER_CAREER_LEVEL}级后可领取二次转职任务（当前${state.playerProgress.careerLevel}级）`, icon: "1.49", disabled: true }];
  if (!rows.length && stage === 2) rows = [{ label: `${roleOptionLabel(state.selected)}已完成二次转职`, icon: "1.49", disabled: true }];
  const title = stage === 0 ? "一次转职任务（任务待定）" : stage === 1 ? "二次转职任务（任务待定）" : "转职导师";
  setMenuAsSingleList(title, rows);
  bindCurrentMenuClicks(confirmRoleChangeMenu);
}

async function confirmRoleChangeMenu() {
  const selection = state.menuRoleSelections?.[state.menuItem];
  if (!selection) return;
  try {
    const result = await postApi("/api/change-role", { account: state.account, selection });
    if (result.player?.selection) state.selected = normalizeSelection(result.player.selection);
    applyPlayerStateResult(result.player);
    if (result.player?.serverStats) state.serverStats = result.player.serverStats;
    await Promise.all([loadSprite(activePlayerSpriteId()), loadSpriteOptional(findRole().attackId)]);
    applyActiveFashionSprite();
    showMenuHint(`已转职为${roleOptionLabel(state.selected)}`);
    openRoleChangeMenu();
    state.users[state.account] = { ...(state.users[state.account] || {}), selected: { ...state.selected } };
    saveUserHints();
  } catch (error) {
    const messages = {
      bad_selection: "转职选择无效",
      first_transfer_level_required: "人物等级达到40级后才能领取一次转职任务",
      second_transfer_level_required: "职业等级达到40级后才能领取二次转职任务",
      invalid_career_transition: "该职业不在当前转职分支中",
      career_max_stage: "当前职业已完成二次转职",
      gender_locked: "转职不能改变角色性别"
    };
    showMenuHint(messages[error.message] || "转职失败");
  }
}

function rankingValueText(entry, stat) {
  const value = stat === "power" ? entry.power : entry.value;
  return `${statLabel(stat)} ${Math.round(Number(value) || 0)}`;
}

function openStatRankingRootMenu() {
  state.menuMode = "stat_ranking_root";
  state.menuItem = 0;
  setMenuAsSingleList("属性排行榜", rankingStats.map((item) => ({ label: `${item.label}排行榜`, icon: item.icon })));
  bindCurrentMenuClicks(confirmStatRankingRootMenu);
}

async function confirmStatRankingRootMenu() {
  const config = rankingStats[state.menuItem] || rankingStats[0];
  await openStatRankingListMenu(config.stat);
}

async function openStatRankingListMenu(stat = "power") {
  state.menuMode = "stat_ranking_list";
  state.menuRankingStat = stat;
  state.menuItem = 0;
  try {
    const response = await fetch(`${SERVER_ORIGIN}/api/stat-rankings?stat=${encodeURIComponent(stat)}&limit=50`);
    const result = await response.json().catch(() => ({ ok: false, error: "bad_response" }));
    if (!response.ok || !result.ok) throw new Error(result.error || "request_failed");
    state.menuRankingEntries = result.rankings || [];
    const rows = state.menuRankingEntries.length
      ? state.menuRankingEntries.map((entry, index) => ({
        label: `第${index + 1}名 ${entry.name || entry.account} Lv.${entry.level} ${rankingValueText(entry, stat)}`,
        icon: "1.49"
      }))
      : [{ label: "暂无排行数据", icon: "1.49", disabled: true }];
    setMenuAsSingleList(`${statLabel(stat)}排行榜`, rows);
    bindCurrentMenuClicks(confirmStatRankingListMenu);
  } catch (error) {
    setMenuAsSingleList(`${statLabel(stat)}排行榜`, [{ label: "排行榜读取失败", icon: "1.49", disabled: true }]);
    bindCurrentMenuClicks(openStatRankingRootMenu);
  }
}

function confirmStatRankingListMenu() {
  const entry = state.menuRankingEntries?.[state.menuItem];
  if (!entry) return;
  openStatRankingPlayerMenu(entry);
}

function openStatRankingPlayerMenu(entry) {
  state.menuMode = "stat_ranking_player";
  state.menuRankingPlayer = entry;
  state.menuItem = 0;
  setMenuAsSingleList(entry.name || entry.account, [
    { label: "查看属性", icon: "2.10" },
    { label: "查看装备", icon: "2.18" },
    { label: "返回排行榜", icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmStatRankingPlayerMenu);
}

function confirmStatRankingPlayerMenu() {
  const entry = state.menuRankingPlayer;
  if (!entry) return openStatRankingRootMenu();
  if (state.menuItem === 0) return openPeerStatsMenu(entry);
  if (state.menuItem === 1) return openPeerEquipmentMenu(entry);
  return openStatRankingListMenu(state.menuRankingStat || "power");
}

function openBossChallengeMenu(actor) {
  state.menuMode = "boss_challenge";
  state.menuItem = 0;
  state.menuTargetActor = actor;
  state.menuOpen = true;
  const boss = immortalBossById[actor?.immortalBossId];
  const vaultStage = elfKingVault.stageById(actor?.elfKingVaultBossId);
  const title = vaultStage?.name || boss?.name || actor?.name || "Boss";
  const rewardText = vaultStage ? "（每日宝库奖励）" : boss ? `（每日灵魂粉末 +${boss.rewardSoulPowder}）` : "";
  const blocked = battleTargetBlocked(actor) || elfKingVaultBlockedText(vaultStage);
  const challengeText = vaultStage?.challengeLabel || `挑战${title}${rewardText}`;
  const rows = [
    { label: blocked || challengeText, icon: "1.49", disabled: Boolean(blocked) }
  ];
  if (actor?.elfKingVaultHiddenNpc) {
    const enabled = elfKingVaultAdventureDifficultyEnabled();
    rows.push({
      label: enabled ? "冒险难度今日已开启" : "我是懦夫，是否要开启冒险难度",
      icon: "2.10",
      disabled: enabled
    });
  }
  rows.push({ label: "返回", icon: "1.13" });
  setMenuAsSingleList(title, rows);
  bindCurrentMenuClicks(confirmBossChallengeMenu);
}

function confirmBossChallengeMenu() {
  const actor = state.menuTargetActor;
  if (!actor) return;
  if (actor.elfKingVaultHiddenNpc && state.menuItem === 1) {
    enableElfKingVaultAdventureDifficulty();
    openBossChallengeMenu(actor);
    return;
  }
  if (state.menuItem === 0) {
    const blocked = battleTargetBlocked(actor) || elfKingVaultBlockedText(elfKingVault.stageById(actor?.elfKingVaultBossId));
    if (blocked) {
      showMenuHint(blocked);
      return;
    }
    closeMainMenu();
    startBattle(actor);
    return;
  }
  closeMainMenu();
}

function elfKingVaultAdventureDifficultyEnabled() {
  if (!state.account) return false;
  return state.users?.[state.account]?.elfKingVaultAdventureKey === todayKey();
}

function enableElfKingVaultAdventureDifficulty() {
  if (!state.account) return;
  state.users[state.account] = state.users[state.account] || {};
  state.users[state.account].elfKingVaultAdventureKey = todayKey();
  saveUserHints();
  showMenuHint("今日宝库冒险难度已开启");
}

function elfKingVaultProgressToday() {
  return elfKingVault.normalizeProgress(state.elfKingVaultProgress || {}, todayKey());
}

function elfKingVaultBlockedText(stage) {
  if (!stage) return "";
  const check = elfKingVault.canChallenge(state.elfKingVaultProgress || {}, stage, todayKey());
  if (check.ok) return "";
  if (check.error === "already_claimed_today") return `${stage.name}今日奖励已领取`;
  if (check.error === "previous_required") {
    const previous = elfKingVault.stageByNumber(stage.stage - 1);
    return `需要先击败${previous?.name || "上一关"}`;
  }
  return "宝库挑战不可用";
}

function canForceBattleTarget(actor) {
  return !actor?.stall;
}

function openStallBuyQuantityPanel(actor, peerId, itemIndex = 0) {
  const stall = actor?.stall;
  const stallItems = stall ? (stall.items?.length ? stall.items : [stall.item].filter(Boolean)) : [];
  const item = stallItems[itemIndex];
  if (!stall || !item) return;
  const maxQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (maxQuantity <= 1 || item.kind === "equipment" || item.kind === "fashion") {
    buyFromStall(actor, peerId, itemIndex, 1);
    return;
  }
  closeMainMenu();
  state.menuStallBuy = { actor, peerId, itemIndex, item };
  $("#stallBuyQuantityLabel").textContent = `${item.label || item.name || "摊位物品"}，单价 ${item.price} 银币，最多 ${maxQuantity}`;
  $("#stallBuyQuantityInput").value = "1";
  $("#stallBuyQuantityInput").max = String(maxQuantity);
  $("#stallBuyQuantityMessage").textContent = "";
  const panel = $("#stallBuyQuantityPanel");
  panel.classList.add("active");
  decorateMenuFrame(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => {
    const input = $("#stallBuyQuantityInput");
    input.focus();
    input.select();
  }, 0);
}

function closeStallBuyQuantityPanel(reopen = true) {
  $("#stallBuyQuantityPanel").classList.remove("active");
  $("#stallBuyQuantityMessage").textContent = "";
  state.menuStallBuy = null;
  if (reopen) openNearbyActionMenu();
}

function submitStallBuyQuantity() {
  const context = state.menuStallBuy;
  if (!context) return;
  const maxQuantity = Math.max(1, Math.floor(Number(context.item.quantity) || 1));
  const quantity = Math.floor(Number($("#stallBuyQuantityInput").value) || 0);
  if (quantity < 1 || quantity > maxQuantity) {
    $("#stallBuyQuantityMessage").textContent = `请输入1-${maxQuantity}之间的数量`;
    return;
  }
  buyFromStall(context.actor, context.peerId, context.itemIndex, quantity);
}

async function buyFromStall(actor, peerId, itemIndex = 0, quantity = 1) {
  const stall = actor?.stall;
  const stallItems = stall ? (stall.items?.length ? stall.items : [stall.item].filter(Boolean)) : [];
  const item = stallItems[itemIndex];
  if (!stall || !item) return;
  const buyQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const totalPrice = Math.max(1, Math.floor(Number(item.price) || 0)) * buyQuantity;
  try {
    const result = await postApi("/api/stall/buy", {
      account: state.account,
      sellerAccount: stall.sellerAccount,
      id: item.id,
      price: totalPrice,
      quantity: buyQuantity
    });
    state.bag.items = result.buyerItems || state.bag.items;
    state.silver = result.buyerSilver ?? state.silver;
    sendRoomMessage({
      type: "stallSold",
      to: peerId,
      buyerName: state.player?.name || state.account,
      itemName: item.label || item.name || "物品",
      itemId: item.id,
      quantity: buyQuantity,
      price: totalPrice
    });
    closeStallBuyQuantityPanel(false);
    closeMainMenu();
    showMenuHint(`购买成功，银币 -${totalPrice}`);
  } catch (error) {
    const text = error.message === "not_enough_silver"
      ? "银币不足"
      : error.message === "bag_full"
        ? "背包已满"
        : error.message === "not_enough_item" || error.message === "item_not_found"
          ? "该物品已经售出"
          : error.message === "Failed to fetch" || error.message === "NetworkError when attempting to fetch resource."
            ? "购买失败：请先用一键启动打开服务"
            : `购买失败：${error.message}`;
    showMenuHint(text);
  }
}

async function handleStallSold(msg) {
  if (!state.stall.active) return;
  const price = Math.max(0, Number(msg.price) || 0);
  const soldQuantity = Math.max(1, Math.floor(Number(msg.quantity) || 1));
  state.stall.items = (state.stall.items || []).map((item) => {
    if (item.id !== msg.itemId) return item;
    return { ...item, quantity: Math.max(0, (Number(item.quantity) || 1) - soldQuantity) };
  }).filter((item) => (Number(item.quantity) || 0) > 0);
  state.stall.item = state.stall.items[0] || null;
  state.stall.price = state.stall.item?.price || 0;
  showMenuHint(`${msg.buyerName || "玩家"}购买了${msg.itemName || "摊位物品"} x${soldQuantity}，银币 +${price}`);
  if (!state.stall.items.length) stopStall(false, false);
  else broadcastState(true);
  await refreshBag().catch(() => null);
}

function confirmNearbyActionMenu() {
  const actor = state.menuTargetActor;
  const peerId = state.menuTargetPeerId;
  if (!actor || !peerId) return;
  const stallItems = actor.stall ? (actor.stall.items?.length ? actor.stall.items : [actor.stall.item].filter(Boolean)) : [];
  const offset = stallItems.length;
  if (actor.stall && state.menuItem < offset) {
    openStallBuyQuantityPanel(actor, peerId, state.menuItem);
    return;
  }
  if (state.menuItem === offset) {
    openPeerStatsMenu(actor);
    return;
  }
  if (state.menuItem === offset + 1) {
    openPeerEquipmentMenu(actor);
    return;
  }
  if (state.menuItem === offset + 2) {
    if (!canForceBattleTarget(actor)) {
      showMenuHint("摆摊中不能强杀");
      return;
    }
    const blocked = battleTargetBlocked(actor);
    if (blocked) {
      showMenuHint(blocked);
      return;
    }
    closeMainMenu();
    startBattle(actor);
  }
  if (state.menuItem === offset + 3) {
    closeMainMenu();
    addFriend({ peerId, name: actor.name });
    sendRoomMessage({ type: "friendAdd", to: peerId, name: state.player?.name || state.account });
    showMenuHint(`${actor.name} 已加为好友`);
  }
  if (state.menuItem === offset + 4) {
    closeMainMenu();
    sendRoomMessage({ type: "teamJoinRequest", to: peerId, toName: actor.name, name: state.player?.name || state.account });
    showMenuHint(`已申请加入 ${actor.name} 的队伍`);
  }
}

function addFriend(friend) {
  if (!friend?.name) return;
  const exists = state.friends.some((item) => item.name === friend.name);
  if (!exists) state.friends.push({ name: friend.name, peerId: friend.peerId || "" });
  if (state.player) savePlayerPosition(true);
}

function openFriendsMenu() {
  state.menuMode = "friends";
  state.menuItem = 0;
  state.menuFriendList = state.friends || [];
  const items = state.menuFriendList.length
    ? state.menuFriendList.map((friend) => {
      const online = [...state.peers.entries()].find(([, peer]) => peer.name === friend.name);
      return { label: `${friend.name} ${online ? "在线" : "离线"}`, icon: "1.42" };
    })
    : [{ label: "好友列表为空", icon: "1.42", disabled: true }];
  setMenuAsSingleList("口袋好友", items);
  bindCurrentMenuClicks(confirmFriendsMenu);
}

function openWhisperTargetMenu() {
  const targets = [...state.peers.entries()].map(([peerId, peer]) => ({ peerId, name: peer.name })).filter((target) => target.name);
  state.menuMode = "chat_whisper_targets";
  state.menuItem = 0;
  state.menuWhisperTargets = targets;
  setMenuAsSingleList("选择悄悄话对象", targets.length
    ? targets.map((target) => ({ label: target.name, icon: "2.7" }))
    : [{ label: "当前没有在线玩家", icon: "2.7", disabled: true }]);
  bindCurrentMenuClicks(confirmWhisperTargetMenu);
}

function confirmWhisperTargetMenu() {
  const target = state.menuWhisperTargets?.[state.menuItem];
  if (!target) return;
  openChatComposer("whisper", target);
}

function confirmFriendsMenu() {
  const friend = state.menuFriendList?.[state.menuItem];
  if (!friend) return;
  const online = [...state.peers.entries()].find(([, peer]) => peer.name === friend.name);
  if (!online) {
    showMenuHint("好友不在线");
    return;
  }
  state.privateChatTarget = { peerId: online[0], name: friend.name };
  openChatComposer("whisper", state.privateChatTarget);
}

function addPrivateChatLine(name, text, broadcast = true, peerId = "") {
  const lineName = broadcast ? `你悄悄对${name}` : `${name}悄悄对你`;
  state.chatLines.push({ name: lineName, targetName: name, text, channel: "whisper", peerId, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
  renderChatFeed();
  showChatFeedTemporarily();
  if (window.ChatHistoryUI?.isOpen()) renderChatHistory();
}

function openPrivateChatDialog({ peerId, name, text }) {
  const panel = $("#privateChatDialog");
  panel.dataset.peerId = String(peerId || "");
  panel.dataset.name = String(name || "私聊");
  $("#privateChatMessage").textContent = `${name}：${text}`;
  panel.hidden = false;
  panel.classList.add("active");
  panel.setAttribute("aria-hidden", "false");
  prepareRewardDialog(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
}

function closePrivateChatDialog() {
  const panel = $("#privateChatDialog");
  panel.classList.remove("active");
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
}

function openTeamMenu() {
  state.menuMode = "team";
  state.menuItem = 0;
  const isLeader = !state.followLeaderId;
  const members = normalizedTeamMembers();
  const leaderName = isLeader ? (state.player?.name || state.account) : (state.team.leaderName || leaderNameFromPeers() || "队长");
  setMenuAsSingleList("队伍指令", [
    { label: isLeader ? `队长：${leaderName} 队员 ${members.length}/3` : `队长：${leaderName}（跟随中）`, icon: "1.13", disabled: true },
    ...members.map((member) => ({ label: `队员：${member.name}${member.peerId ? "" : "（同步中）"}`, icon: "2.10", disabled: true })),
    { label: isLeader ? "解散队伍" : "离开队伍", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmTeamMenu);
}

function normalizedTeamMembers() {
  return teamRuntime.normalizedTeamMembers();
}

function activeTeamRoster() {
  return teamRuntime.activeTeamRoster();
}

function currentPvpMode() {
  return state.followLeaderId || (state.team.members || []).length ? "team" : "solo";
}

function rosterHasMe(roster = []) {
  return teamRuntime.rosterHasMe(roster);
}

function rosterMatchesBattle(msg) {
  const roster = state.battle?.teamRoster || [];
  if (!roster.length) return true;
  const incoming = msg.roster || [];
  if (!incoming.length) return true;
  const ids = new Set(roster.map((member) => member.peerId || member.name).filter(Boolean));
  return incoming.some((member) => ids.has(member?.peerId || member?.name));
}

function leaderNameFromPeers() {
  return teamRuntime.leaderNameFromPeers();
}

function confirmTeamMenu() {
  if (state.menuItem === 0) return;
  const members = normalizedTeamMembers();
  if (state.menuItem <= members.length) return;
  if (state.followLeaderId) {
    leaveTeam(true);
  } else {
    disbandTeam();
  }
  openTeamMenu();
}

function acceptTeamMember(peerId, name) {
  peerId = resolvePeerId(peerId) || peerId;
  if (state.followLeaderId) {
    sendRoomMessage({ type: "teamDisband", to: peerId, toName: name, leaderId: state.followLeaderId });
    return;
  }
  state.team.leaderId = state.peerId;
  state.team.members = state.team.members || [];
  if (state.team.members.length >= 3) {
    sendRoomMessage({ type: "teamDisband", to: peerId, toName: name, leaderId: state.peerId });
    showMenuHint("队伍已满");
    return;
  }
  state.team.members = state.team.members.filter((member) => member.peerId !== peerId && member.name !== name);
  state.team.members.push({ peerId, account: state.peers.get(peerId)?.account || "", name });
  sendRoomMessage({ type: "teamAccepted", to: peerId, toName: name, leaderId: state.peerId, leaderName: state.player?.name || state.account, members: state.team.members });
  broadcastTeamUpdate();
  broadcastState(true);
  showMenuHint(`${name} 加入队伍`);
}

function broadcastTeamUpdate() {
  state.team.members = normalizedTeamMembers();
  for (const member of state.team.members || []) {
    sendRoomMessage({ type: "teamUpdate", to: resolvePeerId(member.peerId) || member.peerId, toName: member.name, leaderId: state.peerId, leaderName: state.player?.name || state.account, members: state.team.members });
  }
}

function leaveTeam(notify = true) {
  if (notify && state.followLeaderId) sendRoomMessage({ type: "teamLeave", to: state.followLeaderId, toName: state.team.leaderName || "", memberPeerId: state.peerId, name: state.player?.name || state.account });
  if (state.battle?.role === "team_member") {
    removeRemoteBattleMarker(state.battle.id);
    closeBattle();
  }
  state.followLeaderId = "";
  state.team = { leaderId: "", members: [] };
  state.followPath = [];
  broadcastState(true);
}

function disbandTeam() {
  for (const member of state.team.members || []) {
    sendRoomMessage({ type: "teamDisband", to: resolvePeerId(member.peerId) || member.peerId, toName: member.name, leaderId: state.peerId });
  }
  if (state.battle?.teamBattleServer) {
    sendRoomMessage({ type: "teamBattleEnd", battleId: state.battle.id });
  }
  state.team = { leaderId: "", members: [] };
  state.followLeaderId = "";
  broadcastState(true);
  showMenuHint("队伍已解散");
}

function renderStatsPanel() {
  clearMenuHint();
  const role = findRole();
  const roleStats = statsForRole();
  const pet = petCatalog.find((item) => item.id === state.selected.petId);
  const petStatsValue = statsForPet(state.selected.petId);
  const level = state.playerProgress.level;
  const petExpNeed = state.petProgress.level < 100 ? expToNextLevel(state.petProgress.level) : 0;
  const title = state.phantom?.equippedTitle || "未装备称号";
  $("#statsContent").innerHTML = [
    `<div class="stat-card stat-card-profile">
      <strong>${escapeHtml(state.player?.name || state.account)}</strong>
      <span>${escapeHtml(title)}</span>
      <span>等级 ${level}/100</span>
      <span>${escapeHtml(careerTree.careerName(state.selected))} / ${careerTree.careerStage(state.selected) > 0 ? `职业等级 ${state.playerProgress.careerLevel}/100` : "职业等级未开启"}</span>
    </div>`,
    statCard(`${role.gender}${role.sub}`, `${state.selected.className} / ${roleStats.skill}`, roleStats, true),
    `<div class="stat-card">
      <strong>宠物成长</strong>
      <span>等级 ${state.petProgress.level}/100</span>
      <span>经验 ${state.petProgress.exp}/${petExpNeed || "满级"}</span>
    </div>`,
    statCard(pet.name, `宠物 / ${petStatsValue.skill}`, petStatsValue, true)
  ].join("");
  $("#statsPanel").classList.add("active");
}

function openStatusMenu(keepIndex = 0) {
  state.menuMode = "status_root";
  state.menuItem = keepIndex;
  setMenuAsSingleList("个人状态", [
    { label: "装备", icon: "1.3", action: "equipment_menu" },
    { label: `称号 ${state.phantom?.equippedTitle || "未装备"}`, icon: "1.49", action: "title_equip" },
    { label: "属性", icon: "2.10", action: "stats_panel" },
    { label: "技能详情", icon: "1.49", action: "role_skill" },
    { label: "设置挂机技能", icon: "1.41", action: "auto_strategy" },
    { label: state.stall.active ? "收摊" : "摆摊", icon: "2.8", action: "stall" }
  ]);
  bindCurrentMenuClicks(confirmStatusMenu);
}

async function showLoginChangelogMenu() {
  if (!state.account || state.battle || state.menuOpen || activeRewardDialog()) return;
  try {
    const response = await fetch(`${SERVER_ORIGIN}/api/changelog`);
    const result = await response.json().catch(() => ({ ok: false }));
    const log = result.changelog || {};
    if (!response.ok || !result.ok || log.enabled === false || !String(log.content || "").trim()) return;
    setLoginChangelogNotice(log);
  } catch {
    // Changelog is non-blocking.
  }
}

function confirmLoginChangelogMenu() {
  closeInfoDialog();
}

function setLoginChangelogNotice(log) {
  const title = String(log.title || "更新日志").trim() || "更新日志";
  const version = String(log.version || "").trim();
  const content = String(log.content || "").trim();
  showInfoDialog({
    title,
    html: `${version ? `<div class="info-dialog-version">版本 ${escapeHtml(version)}</div>` : ""}<div class="info-dialog-copy">${escapeHtml(content)}</div>`
  });
}

function showInfoDialog({ title = "信息", html = "", onClose = null } = {}) {
  closeMainMenu();
  const panel = $("#infoDialogPanel");
  if (!panel) return;
  $("#infoDialogTitle").textContent = String(title || "信息");
  $("#infoDialogContent").innerHTML = html;
  state.infoDialogOnClose = typeof onClose === "function" ? onClose : null;
  panel.classList.add("active");
  prepareRewardDialog(panel);
}

function closeInfoDialog() {
  const panel = $("#infoDialogPanel");
  if (!panel?.classList.contains("active")) return;
  panel.classList.remove("active");
  stopRewardDialogAnimation();
  const onClose = state.infoDialogOnClose;
  state.infoDialogOnClose = null;
  if (onClose) onClose();
}

function openMainMenu(tabIndex = state.menuTab) {
  closeHudPanels();
  clearMenuHint();
  state.menuOpen = true;
  state.menuMode = "main";
  state.menuContextTitle = "";
  state.menuTab = Math.max(0, Math.min(gameMenuTabs.length - 1, tabIndex));
  state.menuItem = 0;
  renderMainMenu();
}

function openMainMenuAt(tabIndex, label = "") {
  closeHudPanels();
  clearMenuHint();
  state.menuOpen = true;
  state.menuMode = "main";
  state.menuContextTitle = "";
  state.menuTab = Math.max(0, Math.min(gameMenuTabs.length - 1, tabIndex));
  const index = label ? gameMenuTabs[state.menuTab].items.findIndex((item) => item.label === label) : -1;
  state.menuItem = index >= 0 ? index : 0;
  renderMainMenu();
}

async function saveMapPortals(portals) {
  const result = await postApi("/api/admin/maps/portals", {
    account: state.loginAccount || state.account,
    password: state.authPassword,
    portals
  });
  state.mapManifest = normalizeMapManifest(result);
  return state.mapManifest;
}

async function scanMapDirectory() {
  const result = await postApi("/api/admin/maps/scan", {
    account: state.loginAccount || state.account,
    password: state.authPassword
  });
  state.mapManifest = normalizeMapManifest(result);
  return state.mapManifest;
}

function quickMenuTabIndexByHotkey(hotkey) {
  return gameMenuTabs.findIndex((tab) => tab.hotkey === hotkey);
}

function initQuickMenuHotkeys() {
  quickMenuHotkeys = window.QuickMenuHotkeys?.createQuickMenuHotkeys({
    timeoutMs: quickMenuTimeoutMs,
    isRootDigit: (digit) => quickMenuTabIndexByHotkey(digit) >= 0,
    openRoot: (digit) => openMainMenu(quickMenuTabIndexByHotkey(digit)),
    selectCurrentItem: (digit) => {
      const index = Number(digit) - 1;
      const buttons = $("#mainMenuList")?.querySelectorAll(".main-menu-item") || [];
      if (!Number.isInteger(index) || index < 0 || index >= buttons.length) return false;
      state.menuItem = index;
      confirmMainMenuItem();
      return true;
    },
    isMenuOpen: () => state.menuOpen
  });
}

function handleQuickMenuDigit(digit) {
  if (!quickMenuHotkeysEnabled() || state.battle || state.roleStatsOpen || isInputUiActive()) return false;
  return quickMenuHotkeys?.acceptDigit(digit) || false;
}

function closeMainMenu() {
  if (state.menuMode === "fashion_ticket_exchange") applyActiveFashionSprite();
  quickMenuHotkeys?.clear();
  state.menuOpen = false;
  state.menuMode = "";
  state.menuContextTitle = "";
  state.inputDir = null;
  suppressStaticNpcMenu();
  state.menuEquipmentList = [];
  state.menuPetList = [];
  state.luckyBoxRoll = { rolling: false, done: false, remaining: 0, confirmOpen: false };
  $("#mainMenu").classList.remove("active", "lucky-box-roll");
  $("#luckyBoxOverlay")?.classList.remove("is-visible");
  $("#luckyBoxOverlay")?.setAttribute("aria-hidden", "true");
}

function renderMainMenu() {
  const menu = $("#mainMenu");
  const tabs = $("#mainMenuTabs");
  const list = $("#mainMenuList");
  const activeTab = gameMenuTabs[state.menuTab];
  state.menuOpen = true;
  menu.classList.add("active");
  state.touchSelectedMenuItem = null;
  tabs.classList.remove("single-title");
  window.MenuUI?.setSingleTitle?.(tabs, false);
  tabs.innerHTML = gameMenuTabs.map((tab, index) => `
    <button type="button" class="${index === state.menuTab ? "active" : ""}" data-index="${index}">
      ${tab.hotkey ? `<small>${tab.hotkey}</small>` : ""}${escapeHtml(tab.title)}
    </button>
  `).join("");
  list.innerHTML = `<div class="main-menu-list-scroll">${activeTab.items.map((item, index) => `
    <button type="button" class="main-menu-item ${index === state.menuItem ? "active" : ""}" data-index="${index}">
      ${menuIconHtml(item.icon)}<span><em class="menu-marquee">${escapeHtml(item.label)}</em></span>${menuIconHtml(item.icon)}
    </button>
  `).join("")}</div>`;
  tabs.querySelectorAll("button").forEach((button) => {
    bindTouchButton(button, () => {
      state.menuTab = Number(button.dataset.index);
      state.menuItem = 0;
      renderMainMenu();
    });
  });
  list.querySelectorAll("button").forEach((button) => {
    bindTouchButton(button, () => {
      if (selectMenuItemFromPointer(Number(button.dataset.index))) return;
      confirmMainMenuItem();
    });
  });
  decorateMainMenuTabs(tabs);
  decorateMenuFrame(list);
  document.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  list.querySelector(".main-menu-item.active")?.scrollIntoView({ block: "nearest" });
  refreshActiveMenuMarquee();
}

function decorateMainMenuTabs(tabs) {
  if (window.MenuUI?.decorateTabDeck) {
    window.MenuUI.decorateTabDeck(tabs);
    return;
  }
  tabs?.classList.add("tab-deck");
  tabs?.querySelectorAll(":scope > button").forEach((button, index) => {
    button.style.setProperty("--tab-stack-index", String(index + 1));
    decorateMenuFrame(button);
  });
}

function decorateMenuFrame(element) {
  if (window.MenuUI?.decorateFrame) {
    window.MenuUI.decorateFrame(element);
    return;
  }
  if (!element || element.querySelector(".menu-frame-corner")) return;
  ["tl", "tr", "bl", "br"].forEach((pos) => {
    const corner = document.createElement("i");
    corner.className = `menu-frame-corner ${pos}`;
    element.appendChild(corner);
  });
  ["top", "right", "bottom", "left"].forEach((pos) => {
    const edge = document.createElement("i");
    edge.className = `menu-frame-edge ${pos}`;
    element.appendChild(edge);
  });
}

function stripMenuFrame(element) {
  if (window.MenuUI?.stripFrame) {
    window.MenuUI.stripFrame(element);
    return;
  }
  element?.querySelectorAll(".menu-frame-corner, .menu-frame-edge, .role-frame-corner, .role-frame-edge").forEach((node) => node.remove());
}

function decorateRoleStatsFrame(element) {
  if (!element || element.querySelector(".role-frame-corner")) return;
  stripMenuFrame(element);
  ["tl", "tr", "bl", "br"].forEach((pos) => {
    const corner = document.createElement("i");
    corner.className = `role-frame-corner ${pos}`;
    element.appendChild(corner);
  });
  ["top", "right", "bottom", "left"].forEach((pos) => {
    const edge = document.createElement("i");
    edge.className = `role-frame-edge ${pos}`;
    element.appendChild(edge);
  });
}

function menuIconHtml(ref) {
  if (String(ref || "").startsWith("lucky:")) {
    const parts = String(ref).split(":");
    const sheet = parts[1];
    const index = parts[2] || "";
    if (sheet === "skill") return `<i class="main-menu-icon lucky-item-skill-icon"></i>`;
    const positionMap = { "1:13": "-216px", "1:19": "-324px", "1:last": "-900px", "2:6": "-90px", "2:13": "-216px", "2:14": "-234px", "2:17": "-288px" };
    const widthMap = { "1": "918px", "2": "504px" };
    const key = `${sheet}:${index}`;
    const image = sheet === "1" ? "item.png" : "item2.png";
    return `<i class="main-menu-icon lucky-item-icon" style="background-image:url('assets/item-icons/${image}');background-size:${widthMap[sheet] || "918px"} 18px;background-position:${positionMap[key] || "0"} 0"></i>`;
  }
  if (ref === "skill") ref = "1.49";
  const [sheet, rawIndex] = ref.split(".").map(Number);
  const maxIndex = sheet === 1 ? 51 : 999;
  const index = Math.max(1, Math.min(maxIndex, rawIndex || 1)) - 1;
  return `<i class="main-menu-icon icon-sheet-${sheet}" style="background-position:-${index * 18}px 0"></i>`;
}

function moveMainMenuTab(direction) {
  if (!state.menuOpen) return false;
  if (state.menuMode && state.menuMode !== "main") return true;
  state.menuTab = (state.menuTab + direction + gameMenuTabs.length) % gameMenuTabs.length;
  state.menuItem = 0;
  renderMainMenu();
  return true;
}

function moveMainMenuItem(direction) {
  if (!state.menuOpen) return false;
  const listRoot = state.menuMode === "lucky_box_roll" && state.luckyBoxRoll.confirmOpen ? $("#luckyBoxActions") : $("#mainMenuList");
  const listSelector = state.menuMode === "lucky_box_roll" && state.luckyBoxRoll.confirmOpen ? ".lucky-box-action" : ".main-menu-item";
  const listButtons = [...(listRoot?.querySelectorAll(listSelector) || [])];
  if (state.menuMode && state.menuMode !== "main") {
    if (!listButtons.length) return true;
    state.menuItem = (state.menuItem + direction + listButtons.length) % listButtons.length;
    state.touchSelectedMenuItem = null;
    listButtons.forEach((button, index) => button.classList.toggle("active", index === state.menuItem));
    listButtons[state.menuItem]?.scrollIntoView({ block: "nearest" });
    refreshActiveMenuMarquee();
    if (state.menuMode === "fashion_ticket_exchange") previewSelectedFashion();
    if (state.menuMode === "skill_ticket_exchange" && state.menuSkillTicketKind === "role") previewSkillTicketExchange();
    return true;
  }
  const items = gameMenuTabs[state.menuTab].items;
  state.menuItem = (state.menuItem + direction + items.length) % items.length;
  state.touchSelectedMenuItem = null;
  renderMainMenu();
  return true;
}

function confirmMainMenuItem() {
  if (!state.menuOpen) return false;
  if (currentMenuItemDisabled()) return true;
  if (state.menuMode === "status_root") {
    confirmStatusMenu();
    return true;
  }
  if (state.menuMode === "stall_items") {
    confirmStallItemMenu();
    return true;
  }
  if (state.menuMode === "equipment_equip") {
    confirmEquipmentEquipMenu();
    return true;
  }
  if (state.menuMode === "equipment_slot_items") {
    confirmEquipmentSlotMenu();
    return true;
  }
  if (state.menuMode === "bag") {
    confirmBagMenu();
    return true;
  }
  if (state.menuMode === "bag_item_actions") {
    confirmBagItemActionMenu();
    return true;
  }
  if (state.menuMode === "lucky_box_roll") {
    confirmLuckyBoxRollMenu();
    return true;
  }
  if (state.menuMode === "bag_give_targets") {
    confirmBagGiveTargetMenu();
    return true;
  }
  if (state.menuMode === "storage_root") {
    confirmStorageMenu();
    return true;
  }
  if (state.menuMode === "storage_deposit") {
    confirmStorageDepositMenu();
    return true;
  }
  if (state.menuMode === "storage_withdraw") {
    confirmStorageWithdrawMenu();
    return true;
  }
  if (state.menuMode === "login_changelog") {
    confirmLoginChangelogMenu();
    return true;
  }
  if (state.menuMode === "role_change") {
    confirmRoleChangeMenu();
    return true;
  }
  if (state.menuMode === "stat_ranking_root") {
    confirmStatRankingRootMenu();
    return true;
  }
  if (state.menuMode === "stat_ranking_list") {
    confirmStatRankingListMenu();
    return true;
  }
  if (state.menuMode === "stat_ranking_player") {
    confirmStatRankingPlayerMenu();
    return true;
  }
  if (state.menuMode === "skill_ticket_exchange") {
    confirmSkillTicketExchangeMenu();
    return true;
  }
  if (state.menuMode === "fashion_ticket_exchange") {
    confirmFashionTicketExchangeMenu();
    return true;
  }
  if (state.menuMode === "holy_weapon_exchange") {
    confirmHolyWeaponExchangeMenu();
    return true;
  }
  if (state.menuMode === "peerless_pet_summon") {
    confirmPeerlessPetSummonMenu();
    return true;
  }
  if (state.menuMode === "skill_card_pet_targets") {
    confirmSkillCardPetMenu();
    return true;
  }
  if (state.menuMode === "forge_equipment") {
    confirmForgeEquipmentMenu();
    return true;
  }
  if (state.menuMode === "dragon_soul") {
    confirmDragonSoulMenu();
    return true;
  }
  if (state.menuMode === "dragon_soul_detail") {
    openDragonSoulMenu(state.menuItem);
    return true;
  }
  if (state.menuMode === "immortal_cultivation") {
    confirmImmortalCultivationMenu();
    return true;
  }
  if (state.menuMode === "immortal_cultivation_part") {
    confirmImmortalCultivationPartMenu();
    return true;
  }
  if (state.menuMode === "immortal_cultivation_slot") {
    confirmImmortalCultivationSlotMenu();
    return true;
  }
  if (state.menuMode === "auto_strategy") {
    confirmAutoStrategyMenu();
    return true;
  }
  if (state.menuMode === "auto_strategy_actor_skill" || state.menuMode === "auto_strategy_pet_skill" || state.menuMode === "auto_strategy_mercenary_skill") {
    confirmAutoStrategySkillMenu();
    return true;
  }
  if (state.menuMode === "role_stats_detail") {
    openStatusMenu();
    return true;
  }
  if (state.menuMode === "role_skill_detail") {
    openRoleSkillListMenu();
    return true;
  }
  if (state.menuMode === "role_skill_list") {
    confirmRoleSkillListMenu();
    return true;
  }
  if (state.menuMode === "pet_root") {
    confirmPetRootMenu();
    return true;
  }
  if (state.menuMode === "pet_select") {
    confirmPetSelectMenu();
    return true;
  }
  if (state.menuMode === "pet_bring_out") {
    confirmPetBringOutMenu();
    return true;
  }
  if (state.menuMode === "pet_detail") {
    confirmPetDetailMenu();
    return true;
  }
  if (state.menuMode === "pet_stats_detail") {
    openPetDetailMenu(state.menuPetId || state.selected.petId, 0);
    return true;
  }
  if (state.menuMode === "pet_skill_detail") {
    openPetSkillListMenu(state.menuPetId || state.selected.petId);
    return true;
  }
  if (state.menuMode === "pet_skill_list") {
    confirmPetSkillListMenu();
    return true;
  }
  if (state.menuMode === "mercenary_root") {
    confirmMercenaryRootMenu();
    return true;
  }
  if (state.menuMode === "mercenary_recruit") {
    confirmMercenaryRecruitMenu();
    return true;
  }
  if (state.menuMode === "mercenary_active") {
    confirmMercenaryActiveMenu();
    return true;
  }
  if (state.menuMode === "mercenary_stats_targets") {
    confirmMercenaryStatsTargetMenu();
    return true;
  }
  if (state.menuMode === "mercenary_stats_detail") {
    openMercenaryRootMenu();
    return true;
  }
  if (state.menuMode === "mercenary_skill_targets") {
    confirmMercenarySkillTargetMenu();
    return true;
  }
  if (state.menuMode === "mercenary_skill_cards") {
    confirmMercenarySkillCardMenu();
    return true;
  }
  if (state.menuMode === "mercenary_card_targets") {
    confirmMercenaryCardTargetMenu();
    return true;
  }
  if (state.menuMode === "mercenary_necklace_shop") {
    confirmMercenaryNecklaceShopMenu();
    return true;
  }
  if (state.menuMode === "mercenary_equip_target") {
    confirmMercenaryEquipTargetMenu();
    return true;
  }
  if (state.menuMode === "mercenary_equip_necklace") {
    confirmMercenaryEquipNecklaceMenu();
    return true;
  }
  if (state.menuMode === "mercenary_socket_necklace") {
    confirmMercenarySocketNecklaceMenu();
    return true;
  }
  if (state.menuMode === "mercenary_socket_orb") {
    confirmMercenarySocketOrbMenu();
    return true;
  }
  if (state.menuMode === "mercenary_unsocket_orb") {
    confirmMercenaryUnsocketOrbMenu();
    return true;
  }
  if (state.menuMode === "mercenary_destroy_orb") {
    confirmMercenaryDestroyOrbMenu();
    return true;
  }
  if (state.menuMode === "soul_powder") {
    confirmSoulPowderMenu();
    return true;
  }
  if (state.menuMode === "life_skills") {
    confirmLifeSkillsMenu();
    return true;
  }
  if (state.menuMode === "sticker_grade") {
    confirmStickerGradeMenu();
    return true;
  }
  if (state.menuMode === "sticker_preview") {
    confirmStickerPreviewMenu();
    return true;
  }
  if (state.menuMode === "sticker_craft_confirm") {
    confirmStickerCraftMenu();
    return true;
  }
  if (state.menuMode === "sticker_inventory") {
    confirmStickerInventoryMenu();
    return true;
  }
  if (state.menuMode === "sticker_pet") {
    confirmStickerPetMenu();
    return true;
  }
  if (state.menuMode === "sticker_apply_option") {
    confirmStickerApplyOptionMenu();
    return true;
  }
  if (state.menuMode === "nearby_targets") {
    confirmNearbyTargetMenu();
    return true;
  }
  if (state.menuMode === "nearby_actions") {
    confirmNearbyActionMenu();
    return true;
  }
  if (state.menuMode === "boss_challenge") {
    confirmBossChallengeMenu();
    return true;
  }
  if (state.menuMode === "phantom_npc") {
    confirmPhantomNpcMenu();
    return true;
  }
  if (state.menuMode === "phantom_rankings") {
    openPhantomNpcMenu();
    return true;
  }
  if (state.menuMode === "title_equip") {
    confirmTitleEquipMenu();
    return true;
  }
  if (state.menuMode === "friends") {
    confirmFriendsMenu();
    return true;
  }
  if (state.menuMode === "chat_whisper_targets") {
    confirmWhisperTargetMenu();
    return true;
  }
  if (state.menuMode === "team") {
    confirmTeamMenu();
    return true;
  }
  if (state.menuMode === "idle_hunt") {
    confirmIdleHuntMenu();
    return true;
  }
  if (state.menuMode === "idle_hunt_boss_targets") {
    confirmIdleHuntBossMenu();
    return true;
  }
  if (state.menuMode === "quick_shop") {
    confirmQuickShopMenu();
    return true;
  }
  if (state.menuMode === "yuanbao_shop") {
    confirmYuanbaoShopMenu();
    return true;
  }
  if (state.menuMode === "quick_shop_sell_items") {
    confirmQuickShopSellItemMenu();
    return true;
  }
  if (state.menuMode === "world_map") {
    confirmWorldMapMenu();
    return true;
  }
  if (state.menuMode === "task_menu") {
    openMainMenuAt(3, "查看任务");
    return true;
  }
  if (state.menuMode === "account_menu") {
    confirmAccountMenu();
    return true;
  }
  if (state.menuMode === "detail_settings") {
    confirmDetailSettingsMenu();
    return true;
  }
  if (state.menuMode === "camera_resolution") {
    confirmCameraResolutionMenu();
    return true;
  }
  if (state.menuMode === "model_scale") {
    confirmModelScaleMenu();
    return true;
  }
  if (state.menuMode === "model_scale_adjust") {
    confirmModelScaleOptionMenu();
    return true;
  }
  if (state.menuMode === "free_claim") {
    confirmFreeClaimMenu();
    return true;
  }
  if (state.menuMode === "free_claim_pet") {
    confirmFreeClaimPetMenu();
    return true;
  }
  if (state.menuMode === "arena") {
    confirmArenaMenu();
    return true;
  }
  if (state.menuMode === "arena_rankings") {
    openArenaMenu();
    return true;
  }
  if (state.menuMode === "arena_challenge") {
    confirmArenaChallengeMenu();
    return true;
  }
  if (["dizi_npc", "daily_news", "reading_exchange"].includes(state.menuMode)) {
    confirmDiziNpcMenu();
    return true;
  }
  if (["dizi_npc_fallback", "dizi_news_fallback", "dizi_exchange_fallback"].includes(state.menuMode)) {
    confirmDiziNpcFallback();
    return true;
  }
  if (state.menuMode && state.menuMode.startsWith("mad_brag")) {
    confirmMadBragMenu();
    return true;
  }
  const item = gameMenuTabs[state.menuTab].items[state.menuItem];
  if (!item) return true;
  state.menuContextTitle = `${gameMenuTabs[state.menuTab].title}功能`;
  if (item.action === "stats") {
    openStatusMenu();
  }
  if (item.action === "bag") {
    openBagMenu();
  }
  if (item.action === "quick_shop") {
    openQuickShopMenu();
  }
  if (item.action === "dragon_soul") {
    openDragonSoulMenu();
  }
  if (item.action === "immortal_cultivation") {
    openImmortalCultivationMenu();
  }
  if (item.action === "idle_hunt") {
    openIdleHuntMenu();
  }
  if (item.action === "pet_command") {
    openPetRootMenu();
  }
  if (item.action === "mercenary_command") {
    openMercenaryRootMenu();
  }
  if (item.action === "soul_powder_menu") {
    openSoulPowderMenu();
  }
  if (item.action === "yuanbao_shop") {
    openYuanbaoShopMenu();
  }
  if (item.action === "life_skills") {
    openLifeSkillsMenu();
  }
  if (item.action === "friends") {
    openFriendsMenu();
  }
  if (item.action === "team") {
    openTeamMenu();
  }
  if (item.action === "account_menu") {
    openAccountMenu();
  }
  if (item.action === "detail_settings" || item.label === "细节设置") {
    openDetailSettingsMenu();
    return true;
  }
  if (item.action === "free_claim") {
    openFreeClaimMenu();
  }
  if (item.action === "arena") {
    openArenaMenu();
  }
  if (item.action === "task_menu") {
    openTaskMenu();
  }
  if (item.action === "region_map") {
    openRegionMapMenu();
  }
  if (item.action === "world_map") {
    openWorldMapMenu();
  }
  if (item.action === "chat_nearby") openChatComposer("nearby");
  if (item.action === "chat_server") openChatComposer("server");
  if (item.action === "chat_channel") openChatComposer("channel");
  if (item.action === "chat_team") openChatComposer("team");
  if (item.action === "chat_whisper") openWhisperTargetMenu();
  if (item.action === "logout") logoutGame();
  if (!item.action) {
    showMenuHint(`${item.label} 暂未开放`);
  }
  return true;
}

function currentMenuItemDisabled() {
  const button = $("#mainMenuList")?.querySelector(`.main-menu-item[data-index="${state.menuItem}"]`);
  return isMenuButtonDisabled(button);
}

function setMenuAsSingleList(title, items) {
  state.menuOpen = true;
  state.menuItem = Math.max(0, Math.min(items.length - 1, state.menuItem || 0));
  $("#mainMenu").classList.remove("lucky-box-roll");
  $("#mainMenu").classList.add("active");
  state.touchSelectedMenuItem = null;
  $("#mainMenuTabs").classList.add("single-title");
  window.MenuUI?.setSingleTitle?.($("#mainMenuTabs"), true);
  const displayTitle = state.menuContextTitle && !String(title).startsWith(`${state.menuContextTitle}-`)
    ? `${state.menuContextTitle}-${title}`
    : title;
  $("#mainMenuTabs").innerHTML = `<button type="button" class="active single-title-button">${escapeHtml(displayTitle)}</button>`;
  $("#mainMenuList").innerHTML = `<div class="main-menu-list-scroll">${items.map((item, index) => `
    <button type="button" class="main-menu-item submenu-item ${index === state.menuItem ? "active" : ""} ${menuItemClassName(item)} ${item.quantityBadge ? "has-item-quantity-badge" : ""} ${item.disabled ? "is-disabled" : ""} ${item.hideIndex ? "hide-index" : ""}" data-index="${index}" data-disabled="${item.disabled ? "true" : "false"}" aria-disabled="${item.disabled ? "true" : "false"}">
      <small>${item.hideIndex ? "" : index + 1}</small>${item.quantityBadge ? itemQuantityIconHtml(item.icon, item.quantityBadge) : menuIconHtml(item.icon)}<span><em class="menu-marquee">${menuItemLabelHtml(item)}</em></span>
    </button>
  `).join("")}</div>`;
  decorateSecondaryMenuTitle($("#mainMenuTabs"));
  decorateMenuFrame($("#mainMenuList"));
  document.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  refreshActiveMenuMarquee();
}

function decorateSecondaryMenuTitle(tabs) {
  if (window.MenuUI?.decorateSecondaryTitle) {
    window.MenuUI.decorateSecondaryTitle(tabs);
    return;
  }
  tabs?.classList.add("single-title", "secondary-title");
  tabs?.querySelectorAll(":scope > .menu-frame-corner, :scope > .menu-frame-edge").forEach((node) => node.remove());
  const titleButton = tabs?.querySelector(":scope > button");
  if (titleButton) decorateMenuFrame(titleButton);
}

function menuItemClassName(item = {}) {
  return [
    isPeerlessItem(item) ? "peerless-item" : "",
    item.className || "",
    !item.forceSingleLine && (item.longText || item.kind === "equipment" || item.kind === "fashion" || isLongEquipmentLabel(item.label)) ? "long-equipment-text" : ""
  ].filter(Boolean).map(escapeHtml).join(" ");
}

function menuItemLabelHtml(item = {}) {
  if (isPeerlessItem(item)) {
    return peerlessColorText(item.label || item.name || "");
  }
  return item.labelHtml || escapeHtml(item.label);
}

function itemQuantityIconHtml(icon, quantity) {
  const iconHtml = menuIconHtml(icon);
  return window.ItemQuantityDisplay?.iconHtml?.(iconHtml, quantity) || iconHtml;
}

function isLongEquipmentLabel(label = "") {
  const text = String(label);
  return /（.*(生命|防御|速度|攻击|法力|致命|爆伤|战斗力).*）/.test(text) || /属性\+30%/.test(text) || text.length > 18;
}

function refreshActiveMenuMarquee() {
  requestAnimationFrame(() => {
    $("#mainMenuList").querySelectorAll(".main-menu-item span").forEach((span) => {
      const marquee = span.querySelector(".menu-marquee");
      if (!marquee) return;
      span.style.setProperty("--menu-text-window", `${span.clientWidth}px`);
      marquee.classList.toggle("marquee-paused", marquee.scrollWidth <= span.clientWidth + 2);
    });
  });
}

function bindCurrentMenuClicks(handler) {
  $("#mainMenuList").querySelectorAll("button").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      event.preventDefault();
      event.stopPropagation();
    });
    const activate = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const index = Number(button.dataset.index);
      state.menuItem = index;
      state.touchSelectedMenuItem = index;
      updateMenuSelection();
      if (isMenuButtonDisabled(button)) return;
      handler();
    };
    const selectOnly = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const index = Number(button.dataset.index);
      state.menuItem = index;
      state.touchSelectedMenuItem = index;
      updateMenuSelection();
    };
    button.addEventListener("pointerup", (event) => {
      if (event.pointerType === "mouse") return;
      suppressSyntheticClick();
      const index = Number(button.dataset.index);
      if (state.menuItem !== index || state.touchSelectedMenuItem !== index) {
        selectOnly(event);
        return;
      }
      activate(event);
    });
    button.addEventListener("click", (event) => {
      if (shouldSuppressSyntheticClick()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      activate(event);
    });
  });
}

function selectMenuItemFromPointer(index) {
  if (!Number.isFinite(index)) return false;
  if (state.menuItem === index && state.touchSelectedMenuItem === index) return false;
  state.menuItem = index;
  state.touchSelectedMenuItem = index;
  updateMenuSelection();
  if (state.menuMode === "skill_ticket_exchange" && state.menuSkillTicketKind === "role") previewSkillTicketExchange();
  return true;
}

function isMenuButtonDisabled(button) {
  return button?.dataset.disabled === "true" || button?.getAttribute("aria-disabled") === "true";
}

function updateMenuSelection() {
  $("#mainMenuList").querySelectorAll(".main-menu-item").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.index) === state.menuItem);
  });
  $("#mainMenuList").querySelector(".main-menu-item.active")?.scrollIntoView({ block: "nearest" });
  refreshActiveMenuMarquee();
  if (state.menuMode === "fashion_ticket_exchange") previewSelectedFashion();
}

function bindTouchButton(button, handler) {
  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
  });
  const activate = (event) => {
    if (button.disabled) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    handler();
  };
  button.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") return;
    suppressSyntheticClick();
    activate(event);
  });
  button.addEventListener("click", (event) => {
    if (shouldSuppressSyntheticClick()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    activate(event);
  });
}

function suppressSyntheticClick() {
  state.suppressSyntheticClickUntil = performance.now() + SYNTHETIC_CLICK_SUPPRESS_MS;
}

function shouldSuppressSyntheticClick() {
  return performance.now() < (state.suppressSyntheticClickUntil || 0);
}

function confirmStatusMenu() {
  const item = [
    { action: "equipment_menu" },
    { action: "title_equip" },
    { action: "stats_panel" },
    { action: "role_skill" },
    { action: "auto_strategy" },
    { action: "stall" }
  ][state.menuItem];
  if (item?.action === "equipment_menu") {
    openEquipmentEquipMenu();
    return;
  }
  if (item?.action === "title_equip") {
    openTitleEquipMenu();
    return;
  }
  if (item?.action === "auto_strategy") {
    openAutoStrategyMenu();
    return;
  }
  if (item?.action === "role_skill") {
    openRoleSkillListMenu();
    return;
  }
  if (item?.action === "stall") {
    if (state.stall.active) stopStall();
    else openStallItemMenu();
    return;
  }
  openRoleStatsDetailMenu();
}

function openTitleEquipMenu() {
  state.menuMode = "title_equip";
  state.menuItem = 0;
  const titles = state.phantom?.claimedTitles || [];
  state.menuTitleList = ["", ...titles];
  const items = state.menuTitleList.map((title) => ({
    label: title ? `${state.phantom?.equippedTitle === title ? "[已装备] " : ""}${title} 全属性+${Math.round(phantomTitleBoost(title) * 100)}% / 剩余${phantomTitleExpiryText((state.phantom?.claimedTitleEntries || []).find((entry) => entry.title === title))}` : "卸下称号",
    icon: "1.49",
    disabled: !title && !state.phantom?.equippedTitle
  }));
  setMenuAsSingleList("装备称号", items.length ? items : [{ label: "暂无称号", icon: "1.49", disabled: true }]);
  bindCurrentMenuClicks(confirmTitleEquipMenu);
}

async function confirmTitleEquipMenu() {
  const title = state.menuTitleList?.[state.menuItem] || "";
  try {
    const result = await postApi("/api/title/equip", { account: state.account, title });
    applyPlayerStateResult(result.player);
    if (!result.player) {
      state.phantom.equippedTitle = result.equippedTitle || "";
      state.phantom.claimedTitles = result.claimedTitles || state.phantom.claimedTitles || [];
      state.phantom.claimedTitleEntries = result.claimedTitleEntries || state.phantom.claimedTitleEntries || [];
    }
    broadcastState(true);
    savePlayerPosition(true);
    showMenuHint(title ? `已装备${title}` : "已卸下称号");
    openStatusMenu(1);
  } catch {
    showMenuHint("称号装备失败");
  }
}

async function openStallItemMenu() {
  state.menuMode = "stall_items";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    state.menuStallItems = result.items || [];
    const draftCount = state.stallDraftItems.length;
    const draftIds = new Set(state.stallDraftItems.map((entry) => entry.id));
    const items = state.menuStallItems.length
      ? state.menuStallItems.map((item) => ({
        label: `${draftIds.has(item.id) ? "[已加入] " : ""}${bagItemLabel(item)}`,
        icon: item.icon || "2.8",
        disabled: item.equipped || draftIds.has(item.id) || isUntradeableItem(item),
        className: isExchangeFragment(item) || isPeerlessItem(item) ? "rare-fragment" : "",
        longText: item.kind === "equipment" || item.kind === "fashion"
      }))
      : [{ label: "背包没有可摆摊物品", icon: "2.8", disabled: true }];
    items.push({ label: draftCount ? `开始摆摊（${draftCount}件商品）` : "开始摆摊（请先选择商品）", icon: "2.8", disabled: !draftCount });
    if (draftCount) items.push({ label: "清空摆摊商品", icon: "1.13" });
    setMenuAsSingleList("选择摆摊物品", items);
    bindCurrentMenuClicks(confirmStallItemMenu);
  } catch {
    setMenuAsSingleList("选择摆摊物品", [{ label: "背包读取失败", icon: "2.8", disabled: true }]);
  }
}

function openTaskMenu() {
  state.menuMode = "task_menu";
  state.menuItem = 0;
  const level = state.playerProgress?.level || 1;
  const dragonSoul = state.playerProgress?.dragonSoul || 1;
  const phantomFragment = state.phantom?.fragment || 0;
  const phantomPoints = state.phantom?.points || 0;
  const rows = [
    { label: `主线：提升角色等级 当前${level}/100`, icon: STAT_ICONS.exp, disabled: true },
    { label: `养成：龙魂修炼 当前${dragonSoul}/100`, icon: "1.49", disabled: true },
    { label: `狩猎：原野怪区挑战阿木木，获得兑换碎片`, icon: "2.21", disabled: true },
    { label: `幻影：收集幻影碎片 当前${phantomFragment}个`, icon: "1.49", disabled: true },
    { label: `幻影积分：提交碎片累计积分 当前${phantomPoints}分`, icon: "1.49", disabled: true },
    { label: "返回任务菜单", icon: "1.13" }
  ];
  setMenuAsSingleList("查看任务", rows);
  bindCurrentMenuClicks(() => {
    if (state.menuItem === rows.length - 1) openMainMenuAt(3, "查看任务");
  });
}

function mapExitRows(mapName) {
  const exits = (state.mapManifest?.portals || [])
    .filter((portal) => portal.from === mapName)
    .map((portal) => `${portal.direction || "*"} (${portal.x},${portal.y}) -> ${portal.to} (${portal.toX},${portal.toY})`);
  if (!exits.length) exits.push("暂无出口信息");
  return exits.map((label) => ({ label: `出口 ${label}`, icon: "2.11", disabled: true }));
}

const worldMapTeleportTargets = [
  { name: NEW_ROXAS_HOME_MAP, x: ROXAS_HOME_RETURN.x, y: ROXAS_HOME_RETURN.y, desc: "\u7f57\u514b\u8428\u65af\u3001\u5c0f\u4f01\u9e45\u3001\u4ed3\u5e93\u5165\u53e3" },
  { name: NEW_FIELD_MAP, x: 8, y: 2, desc: "\u963f\u6728\u6728\u6697\u602a\u3001\u963f\u98de" },
  { name: "幻影狩猎场", x: 7, y: 12, desc: "幻影暗怪、幻影管理员" },
  { name: "仙人", x: 2, y: 10, desc: "仙人Boss" },
  { name: elfKingVault.dungeon.mapName, x: elfKingVault.dungeon.entry.x, y: elfKingVault.dungeon.entry.y, desc: "四关宝库Boss" }
];

function initRegionFlyMap() {
  window.RegionFlyMap?.init({
    host: $("#gameScreen"),
    getMapName: () => state.mapName,
    getMapManifest: () => state.mapManifest,
    defaultMapManifest,
    mapFiles,
    getNewMapRuntime: () => state.newMapRuntime,
    loadMap,
    changeMap,
    savePlayerPosition,
    showHint: showMenuHint,
    isStallActive: () => Boolean(state.stall?.active),
    stopStall
  });
}

function openRegionMapMenu() {
  closeMainMenu();
  window.RegionFlyMap?.open();
}

function openWorldMapMenu() {
  if (window.RegionFlyMap?.openWorld) {
    closeMainMenu();
    window.RegionFlyMap.openWorld();
    return;
  }
  state.menuMode = "world_map";
  state.menuItem = 0;
  const targets = worldMapTargets();
  const rows = [
    ...targets.map((target) => ({
      label: `${target.name}${state.mapName === target.name ? "（当前）" : ""}：${target.desc}`,
      icon: "2.11"
    })),
    { label: "路线：由地图系统/地图清单.json 管理", icon: "2.20", disabled: true },
    { label: "返回任务菜单", icon: "1.13" }
  ];
  setMenuAsSingleList("世界地图", rows);
  bindCurrentMenuClicks(confirmWorldMapMenu);
}

async function confirmWorldMapMenu() {
  const targets = worldMapTargets();
  const target = targets[state.menuItem];
  if (!target) {
    if (state.menuItem === targets.length + 1) openMainMenuAt(3, "世界地图");
    return;
  }
  if (state.mapName === target.name) {
    showMenuHint("已经在当前地图");
    return;
  }
  if (state.stall.active) stopStall(false);
  closeMainMenu();
  await changeMap(target.name, target.x, target.y);
  await savePlayerPosition(true);
  showMenuHint(`已传送到${target.name}`);
}

function worldMapTargets() {
  return (state.mapManifest?.maps || defaultMapManifest.maps).map((map) => ({
    name: map.name,
    x: Number(map.entry?.x) || 1,
    y: Number(map.entry?.y) || 1,
    desc: map.desc || "可传送地图"
  }));
}

function confirmStallItemMenu() {
  const baseCount = state.menuStallItems?.length || 0;
  if (state.menuItem === baseCount) {
    startStall();
    return;
  }
  if (state.menuItem === baseCount + 1) {
    state.stallDraftItems = [];
    openStallItemMenu();
    return;
  }
  const item = state.menuStallItems?.[state.menuItem];
  if (!item || item.equipped) return;
  if (isUntradeableItem(item)) {
    showMenuHint("该物品不能交易");
    return;
  }
  openStallPricePanel(item);
}

function openStallPricePanel(item) {
  closeMainMenu();
  state.menuStallItem = item;
  $("#stallPriceLabel").textContent = `${bagItemLabel(item)} 定价`;
  $("#stallPriceInput").value = "";
  $("#stallPriceMessage").textContent = "";
  const panel = $("#stallPricePanel");
  panel.classList.add("active");
  decorateMenuFrame(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => $("#stallPriceInput").focus(), 0);
}

function closeStallPricePanel(reopen = true) {
  $("#stallPricePanel").classList.remove("active");
  $("#stallPriceMessage").textContent = "";
  if (reopen && !state.stall.active) openStallItemMenu();
}

async function submitStallPrice() {
  const item = state.menuStallItem;
  const price = Math.floor(Number($("#stallPriceInput").value) || 0);
  if (!item) return;
  if (price <= 0) {
    $("#stallPriceMessage").textContent = "请输入大于0的价格";
    return;
  }
  addStallDraftItem(item, price);
}

function addStallDraftItem(item, price) {
  if (state.stallDraftItems.some((entry) => entry.id === item.id)) {
    $("#stallPriceMessage").textContent = "该物品已经加入摆摊";
    return;
  }
  state.stallDraftItems.push({
    id: item.id,
    name: item.name || "物品",
    label: item.kind === "equipment" || item.kind === "fashion" ? bagItemLabel(item) : (item.name || "物品"),
    icon: item.icon || "2.8",
    kind: item.kind || "item",
    quantity: item.quantity || 1,
    price
  });
  closeStallPricePanel(false);
  showMenuHint("已加入摆摊商品");
  openStallItemMenu();
}

async function startStall() {
  if (!state.player || state.battle) return;
  if (!state.stallDraftItems.length) {
    showMenuHint("请先选择摆摊商品");
    return;
  }
  stopIdleHunt();
  await loadSpriteOptional(STALL_SPRITE_ID);
  state.stall = {
    active: true,
    items: state.stallDraftItems.map((item) => ({ ...item })),
    item: state.stallDraftItems[0] || null,
    price: state.stallDraftItems[0]?.price || 0,
    originalSpriteId: state.stall.originalSpriteId || state.player.spriteId
  };
  state.stallDraftItems = [];
  state.player.spriteId = STALL_SPRITE_ID;
  state.inputDir = null;
  if (state.pet) {
    state.pet.moving = false;
    state.pet.path = [];
  }
  showMenuHint(`摆摊开始，共${state.stall.items.length}件商品`);
  broadcastState(true);
  openStatusMenu(4);
}

function stopStall(reopenMenu = true, showHint = true) {
  if (!state.stall.active) return;
  if (state.player && state.stall.originalSpriteId) state.player.spriteId = state.stall.originalSpriteId;
  state.stall = { active: false, items: [], item: null, price: 0, originalSpriteId: 0 };
  if (showHint) showMenuHint("已收摊");
  broadcastState(true);
  if (reopenMenu) openStatusMenu(4);
}

function openAccountMenu() {
  state.menuMode = "account_menu";
  state.menuItem = 0;
  setMenuAsSingleList("账号功能", [
    { label: "修改密码", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmAccountMenu);
}

function confirmAccountMenu() {
  if (state.menuItem === 0) openPasswordPanel();
}

function openDetailSettingsMenu() {
  state.menuMode = "detail_settings";
  state.menuItem = 0;
  setMenuAsSingleList("细节设置", [
    { label: `摄像机分辨率：${currentCameraResolution().label}`, icon: "2.11" },
    { label: "调整模型大小", icon: "1.13" },
    { label: `显示宠物名字：${state.showPetNames ? "开" : "关"}`, icon: "2.12" },
    { label: `快捷操作：${quickMenuHotkeysEnabled() ? "开" : "关"}`, icon: "1.13" },
    { label: "返回系统菜单", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmDetailSettingsMenu);
}

function confirmDetailSettingsMenu() {
  if (state.menuItem === 0) return openCameraResolutionMenu();
  if (state.menuItem === 1) return openModelScaleMenu();
  if (state.menuItem === 2) {
    setPetNamePreference(!state.showPetNames);
    showMenuHint(`宠物名字显示已${state.showPetNames ? "开启" : "关闭"}`);
    return openDetailSettingsMenu();
  }
  if (state.menuItem === 3) {
    const enabled = setQuickMenuHotkeysEnabled(!quickMenuHotkeysEnabled());
    showMenuHint(`快捷操作已${enabled ? "开启" : "关闭"}`);
    return openDetailSettingsMenu();
  }
  if (state.menuItem === 4) return openMainMenuAt(4, "细节设置");
}

function openCameraResolutionMenu() {
  state.menuMode = "camera_resolution";
  state.menuItem = Math.max(0, CAMERA_RESOLUTIONS.findIndex((resolution) => resolution.id === cameraResolutionId));
  setMenuAsSingleList("摄像机分辨率", [
    ...CAMERA_RESOLUTIONS.map((resolution) => ({
      label: `${resolution.label}${resolution.id === cameraResolutionId ? "（当前）" : ""}`,
      icon: "2.11"
    })),
    { label: "返回细节设置", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmCameraResolutionMenu);
}

function confirmCameraResolutionMenu() {
  const resolution = CAMERA_RESOLUTIONS[state.menuItem];
  if (!resolution) {
    openDetailSettingsMenu();
    return;
  }
  if (setCameraResolution(resolution.id)) {
    showMenuHint(`摄像机分辨率已切换为 ${resolution.label}`);
  }
  openCameraResolutionMenu();
}

function openModelScaleMenu() {
  state.menuMode = "model_scale";
  state.menuItem = 0;
  setMenuAsSingleList("调整模型大小", [
    { label: `宠物模型大小：${formatModelScale(state.actorScales.pet)}`, icon: "1.9" },
    { label: `人物模型大小：${formatModelScale(state.actorScales.player)}`, icon: "2.10" },
    { label: "返回细节设置", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmModelScaleMenu);
}

function confirmModelScaleMenu() {
  if (state.menuItem === 0) return openModelScaleOptionMenu("pet");
  if (state.menuItem === 1) return openModelScaleOptionMenu("player");
  openDetailSettingsMenu();
}

function formatModelScale(scale) {
  return `${Math.round(clampClientNumber(scale, 1, MODEL_SCALE_MIN, MODEL_SCALE_MAX) * 100)}%`;
}

function openModelScaleOptionMenu(kind) {
  const target = kind === "pet" ? "pet" : "player";
  const value = clampClientNumber(state.actorScales[target], 1, MODEL_SCALE_MIN, MODEL_SCALE_MAX);
  state.modelScaleAdjustment = { kind: target, original: value, value };
  state.menuMode = "model_scale_adjust";
  state.menuItem = 0;
  setMenuAsSingleList(target === "pet" ? "宠物模型大小" : "人物模型大小", []);
  renderModelScaleAdjustment();
}

function renderModelScaleAdjustment() {
  const adjustment = state.modelScaleAdjustment;
  if (!adjustment) return openModelScaleMenu();
  const list = $("#mainMenuList");
  const percent = Math.round(adjustment.value * 100);
  list.innerHTML = `
    <div class="menu-scale-adjuster">
      <div class="menu-scale-value"><span>当前大小</span><strong>${percent}%</strong></div>
      <input class="menu-scale-range" type="range" min="50" max="250" step="5" value="${percent}" style="--model-scale-progress:${(percent - 50) / 2}%" aria-label="${adjustment.kind === "pet" ? "宠物" : "人物"}模型大小" />
      <div class="menu-scale-limits"><span>50%</span><span>250%</span></div>
    </div>
  `;
  decorateMenuFrame(list);
  const input = list.querySelector(".menu-scale-range");
  input?.addEventListener("input", () => previewModelScaleAdjustment(Number(input.value) / 100));
}

function previewModelScaleAdjustment(value) {
  const adjustment = state.modelScaleAdjustment;
  if (!adjustment) return;
  const scale = Math.round(clampClientNumber(value, adjustment.value, MODEL_SCALE_MIN, MODEL_SCALE_MAX) / MODEL_SCALE_STEP) * MODEL_SCALE_STEP;
  adjustment.value = Number(scale.toFixed(2));
  state.actorScales[adjustment.kind] = adjustment.value;
  const percent = Math.round(adjustment.value * 100);
  const list = $("#mainMenuList");
  const valueLabel = list.querySelector(".menu-scale-value strong");
  const input = list.querySelector(".menu-scale-range");
  if (valueLabel) valueLabel.textContent = `${percent}%`;
  if (input) {
    input.value = String(percent);
    input.style.setProperty("--model-scale-progress", `${(percent - 50) / 2}%`);
  }
}

function adjustModelScaleBy(delta) {
  const adjustment = state.modelScaleAdjustment;
  if (adjustment) previewModelScaleAdjustment(adjustment.value + delta * MODEL_SCALE_STEP);
}

function confirmModelScaleOptionMenu() {
  const adjustment = state.modelScaleAdjustment;
  if (!adjustment) return openModelScaleMenu();
  saveModelScalePreference(adjustment.kind, adjustment.value);
  showMenuHint(`${adjustment.kind === "pet" ? "宠物" : "人物"}模型大小已调整为 ${formatModelScale(adjustment.value)}`);
  state.modelScaleAdjustment = null;
  openModelScaleMenu();
}

function backModelScaleMenu() {
  if (state.menuMode === "model_scale_adjust") {
    const adjustment = state.modelScaleAdjustment;
    if (adjustment) state.actorScales[adjustment.kind] = adjustment.original;
    state.modelScaleAdjustment = null;
    return openModelScaleMenu();
  }
  if (state.menuMode === "model_scale") return openDetailSettingsMenu();
  if (state.menuMode === "detail_settings") return openMainMenuAt(4, "细节设置");
  return closeMainMenu();
}

function openPasswordPanel() {
  closeMainMenu();
  const panel = $("#passwordPanel");
  $("#oldPasswordInput").value = "";
  $("#newPasswordInput").value = "";
  $("#confirmPasswordInput").value = "";
  $("#passwordMessage").textContent = "";
  panel.classList.add("active");
  decorateMenuFrame(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => $("#oldPasswordInput").focus(), 0);
}

function closePasswordPanel() {
  $("#passwordPanel").classList.remove("active");
  openAccountMenu();
}

async function submitPasswordChange() {
  const oldPassword = $("#oldPasswordInput").value;
  const newPassword = $("#newPasswordInput").value;
  const confirmPassword = $("#confirmPasswordInput").value;
  if (newPassword.length < 4 || newPassword.length > 24) {
    $("#passwordMessage").textContent = "新密码需要4-24位";
    return;
  }
  if (confirmPassword !== newPassword) {
    $("#passwordMessage").textContent = "两次输入不一致";
    return;
  }
  const { response, result } = await authApi("/api/auth/change-password", { account: state.loginAccount || state.account, oldPassword, newPassword });
  if (!response.ok) {
    $("#passwordMessage").textContent = result.error === "bad_password" ? "当前密码不正确" : "密码修改失败";
    return;
  }
  saveAuthCache(state.loginAccount || state.account);
  state.authPassword = newPassword;
  $("#passwordPanel").classList.remove("active");
  showMenuHint("密码修改成功");
  openAccountMenu();
}

function openFreeClaimMenu() {
  state.menuMode = "free_claim";
  state.menuItem = 0;
  setMenuAsSingleList("免费领取", [
    { label: "额外领取一只宠物", icon: "2.12" }
  ]);
  bindCurrentMenuClicks(confirmFreeClaimMenu);
}

function confirmFreeClaimMenu() {
  if (state.menuItem === 0) openFreeClaimPetMenu();
}

function openFreeClaimPetMenu() {
  state.menuMode = "free_claim_pet";
  state.menuItem = 0;
  const owned = new Set([state.selected.petId, ...(state.ownedPetIds || [])].map(Number));
  state.menuPetList = freeClaimPets().filter((pet) => !owned.has(pet.id));
  const items = state.menuPetList.length
    ? state.menuPetList.map((pet) => ({ label: `领取 ${pet.name}`, icon: "2.12" }))
    : [{ label: "所有宠物都已拥有", icon: "2.12", disabled: true }];
  setMenuAsSingleList("选择宠物", items);
  bindCurrentMenuClicks(confirmFreeClaimPetMenu);
}

async function confirmFreeClaimPetMenu() {
  const pet = state.menuPetList?.[state.menuItem];
  if (!pet) return;
  try {
    const result = await postApi("/api/pet/free-claim", { account: state.account, petId: pet.id, initialPetId: state.selected.petId });
    state.ownedPetIds = result.ownedPets || state.ownedPetIds;
    showMenuHint(`领取成功：${pet.name}`);
    openFreeClaimPetMenu();
  } catch (error) {
    showMenuHint(error.message === "already_owned" ? "已经拥有该宠物" : "领取失败");
  }
}

function statRows(stats) {
  return [
    ["生命", stats.hp, STAT_ICONS.hp],
    ["攻击", stats.attack, STAT_ICONS.attack],
    ["防御", stats.defense, STAT_ICONS.defense],
    ["速度", stats.speed, STAT_ICONS.speed],
    ["法力", stats.mana, STAT_ICONS.mana],
    ["致命", `${stats.crit}%`, STAT_ICONS.crit],
    ["爆伤", stats.critDamage, STAT_ICONS.critDamage]
  ];
}

function roleStatsIconHtml(ref, size = 18) {
  const [sheet, rawIndex] = String(ref || "1.49").split(".").map(Number);
  const index = Math.max(1, Math.min(sheet === 1 ? 51 : 999, rawIndex || 1)) - 1;
  return `<span class="role-stat-icon-wrap" style="width:${size}px;height:${size}px"><i class="main-menu-icon icon-sheet-${sheet || 1}" style="background-position:-${index * 18}px 0;transform:scale(${size / 18});transform-origin:left top"></i></span>`;
}

function skillCardIconRef(skill = {}) {
  if (skill.icon) return skill.icon;
  if (skill.type === "passive") return "2.12";
  if (skill.type === "magic") return "1.49";
  if (skill.type === "self_buff") return "1.14";
  return "1.39";
}

function roleStatRow({ label, value = "", icon = "1.49", className = "", full = false }) {
  return roleStatRowHtml({ label, html: escapeHtml(String(value ?? "")), icon, className, full });
}

function roleStatRowHtml({ label, html = "", icon = "1.49", className = "", full = false }) {
  const labelText = String(label || "");
  const labelWithColon = /[:：]$/.test(labelText) ? labelText : `${labelText}：`;
  return `<div class="role-stat-row ${full ? "full" : ""} ${html ? "" : "empty"}">
    ${roleStatsIconHtml(icon)}
    <span class="role-stat-label">${escapeHtml(labelWithColon)}</span>
    <span class="role-stat-value ${escapeHtml(className)}">${html}</span>
  </div>`;
}

function drawRoleStatsAvatar() {
  const canvas = $("#roleStatsAvatar");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sprite = state.sprites.get(state.roleStatsSubject?.spriteId || activePlayerSpriteId());
  if (!sprite) return;
  const frame = getFrame(sprite, { direction: "down", moving: false, idleTick: 0, frameTick: 0 });
  const size = 34;
  drawSpriteFrame(ctx, sprite, frame, (canvas.width - size) / 2, canvas.height - size, size, size);
}

function statsCardSubjectForRole() {
  const role = findRole();
  const level = state.playerProgress.level;
  const stats = statsForRole();
  return {
    kind: "role",
    name: state.player?.name || state.account || "",
    spriteId: activePlayerSpriteId(),
    stats,
    level,
    exp: state.playerProgress.exp,
    expNeed: level < 100 ? expToNextLevel(level) : 0,
    rank: `等级 ${level} 龙魂${state.playerProgress.dragonSoul}`,
    careerName: careerTree.careerName(state.selected),
    careerEnabled: careerTree.careerStage(state.selected) > 0,
    careerLevel: state.playerProgress.careerLevel,
    careerExp: state.playerProgress.careerExp,
    careerExpNeed: state.playerProgress.careerLevel < 100 ? careerExpToNextLevel(state.playerProgress.careerLevel) : 0,
    headerMode: "各项抗性",
    classLine: careerTree.careerName(state.selected),
    skills: skillsForStats(stats)
  };
}

function statsCardSubjectForPet(petId) {
  const pet = petCatalog.find((item) => item.id === petId) || petCatalog[0];
  const progress = state.petProgressById[String(pet.id)] || normalizePetProgress();
  const level = progress.level;
  const stats = statsForPet(pet.id);
  const stickers = petStickerRows(pet.id);
  return {
    kind: "pet",
    name: pet.name,
    spriteId: pet.id,
    stats,
    level,
    exp: progress.exp,
    expNeed: level < 100 ? expToNextLevel(level) : 0,
    rank: `等级 ${level}`,
    headerMode: "抗性与技能",
    classLine: "宠物",
    skills: skillsForStats(stats),
    stickers
  };
}

function statsCardSubjectForMercenary(mercenary) {
  const config = mercenaryTypes[mercenary?.type] || mercenaryTypes.sword;
  const level = Math.max(1, Math.min(100, Number(mercenary?.level) || 100));
  const stats = statsForMercenary(mercenary);
  const necklace = mercenaryNecklaceFor(mercenary);
  const learnedSkills = [
    ...(Array.isArray(mercenary?.passiveSkills) ? mercenary.passiveSkills : []),
    ...(Array.isArray(mercenary?.extraSkills) ? mercenary.extraSkills : [])
  ].filter((id) => mercenaryHolySkillIds.has(id));
  return {
    kind: "mercenary",
    name: mercenary?.name || config.name,
    spriteId: mercenary?.spriteId || config.spriteId,
    stats,
    level,
    exp: Math.max(0, Number(mercenary?.exp) || 0),
    expNeed: level < 100 ? expToNextLevel(level) : 0,
    rank: `等级 ${level}`,
    headerMode: "抗性与技能",
    classLine: `${config.name}${necklace ? ` / ${necklace.name}` : " / 未装备项链"}`,
    skills: [stats.skillId, ...new Set(learnedSkills)]
  };
}

function statsCardSubjectForPeer(player) {
  const stats = player?.stats || {};
  return {
    kind: "peer",
    name: player?.name || player?.account || "玩家",
    spriteId: player?.spriteId || 895,
    stats,
    level: player?.level || 1,
    exp: 0,
    expNeed: 0,
    rank: `等级 ${player?.level || 1} 龙魂${player?.dragonSoul || 1}`,
    headerMode: "各项抗性",
    classLine: `战斗力 ${combatPowerForStats(stats)}`,
    skills: skillsForStats(stats)
  };
}

function roleStatsMainHtml(subject) {
  const stats = subject.stats;
  const expHtml = `${escapeHtml(String(subject.exp))}${subject.level >= 100 ? ` <span class="accent">（满级）</span>` : ` / ${escapeHtml(String(subject.expNeed))}`}`;
  const stickerRows = subject.kind === "pet" ? petStickerStatsHtml(subject.stickers || []) : "";
  return `<div class="role-stat-grid">
    ${roleStatRow({ label: "生命", value: `${stats.hp} / ${stats.hp}`, icon: STAT_ICONS.hp, full: true })}
    ${roleStatRow({ label: "精力", value: stats.energy, icon: "1.14", full: true })}
    ${roleStatRow({ label: subject.kind === "pet" ? "元素属性" : subject.classLine, value: subject.kind === "pet" || subject.kind === "peer" ? "" : `技能 ${stats.skill || skillById(stats.skillId).name}`, icon: "1.49", className: "accent", full: true })}
    ${subject.kind === "mercenary" ? roleStatRowHtml({ label: "经验", html: expHtml, icon: "2.12" }) : subject.kind === "peer" ? roleStatRow({ label: "等级", value: `${subject.level}/100`, icon: STAT_ICONS.exp }) : roleStatRowHtml({ label: "经验", html: expHtml, icon: "2.12" })}
    ${roleStatRow({ label: subject.kind === "role" ? "职业经验" : "守护等级", value: subject.kind === "role" ? (!subject.careerEnabled ? "未开启" : subject.careerLevel >= 100 ? "满级" : `${subject.careerExp}/${subject.careerExpNeed}`) : "", icon: "2.12", className: "accent" })}
    ${roleStatRow({ label: subject.kind === "pet" ? "修炼" : subject.kind === "mercenary" ? "技能数" : subject.kind === "peer" ? "龙魂" : "职业等级", value: subject.kind === "mercenary" ? Math.max(0, subject.skills.length - 1) : subject.kind === "peer" ? `${String(subject.rank).split("龙魂")[1] || 1}` : subject.kind === "role" ? (subject.careerEnabled ? `${subject.careerLevel}/100` : "未开启") : "", icon: "2.12", className: "cyan" })}
    ${roleStatRow({ label: subject.kind === "pet" ? "宠物类型" : subject.kind === "mercenary" ? "佣兵类型" : subject.kind === "peer" ? "玩家" : "职业", value: subject.kind === "pet" ? "灵兽" : subject.kind === "mercenary" ? subject.classLine.split(" / ")[0] : subject.kind === "peer" ? subject.name : subject.careerName, icon: "2.12", className: "cyan" })}
    ${roleStatRow({ label: "攻击", value: stats.attack, icon: STAT_ICONS.attack })}
    ${roleStatRow({ label: "防御", value: stats.defense, icon: STAT_ICONS.defense })}
    ${roleStatRow({ label: "速度", value: stats.speed, icon: STAT_ICONS.speed })}
    ${roleStatRow({ label: "法力", value: stats.mana, icon: STAT_ICONS.mana })}
    ${roleStatRow({ label: "命中", value: stats.hit, icon: "1.14", className: "accent" })}
    ${roleStatRow({ label: "闪避", value: stats.dodge, icon: "1.39" })}
    ${roleStatRow({ label: "致命", value: `${stats.crit}%`, icon: STAT_ICONS.crit, className: "accent" })}
    ${roleStatRow({ label: "暴伤", value: `${stats.critDamage}%`, icon: STAT_ICONS.critDamage })}
    ${stickerRows}
  </div>`;
}

function petStickerRows(petId) {
  const mod = stickerModuleApi();
  const entries = state.petStickers?.[String(normalizePetId(petId))] || [];
  return entries
    .map((entry) => {
      const sticker = mod.stickerById?.[entry.stickerId];
      if (!sticker) return null;
      const expiresAt = Date.parse(entry.expiresAt || "");
      const days = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))) : 0;
      return {
        name: sticker.name,
        statsText: mod.formatStats(sticker.stats),
        days
      };
    })
    .filter(Boolean);
}

function petStickerStatsHtml(stickers) {
  if (!stickers.length) {
    return roleStatRow({ label: "贴纸", value: "未打贴纸", icon: "2.22", full: true });
  }
  return stickers.map((sticker, index) => roleStatRowHtml({
    label: index === 0 ? "贴纸" : `贴纸${index + 1}`,
    html: `${escapeHtml(sticker.name)} ${escapeHtml(sticker.statsText)} / 剩余${escapeHtml(String(sticker.days))}天`,
    icon: "2.22",
    className: "cyan",
    full: true
  })).join("");
}

function roleStatsResistHtml(subject) {
  const skillRows = (subject.skills || []).slice(0, 6).map((id, index) => {
    const skill = skillById(id);
    return roleStatRowHtml({
      label: index === 0 ? "主动技能" : `技能${index + 1}`,
      html: `${roleStatsIconHtml(skillCardIconRef(skill), 18)} ${escapeHtml(skill.name)}`,
      icon: "2.12",
      className: index === 0 ? "accent" : "cyan",
      full: true
    }).replace("role-stat-row", "role-stat-row role-stat-skill");
  }).join("");
  return `<div class="role-stat-grid">
    ${roleStatRow({ label: "物理攻击抗性", value: 0, icon: STAT_ICONS.defense, full: true })}
    ${roleStatRow({ label: "技能攻击抗性", value: 0, icon: "2.10", full: true })}
    ${roleStatRow({ label: "混乱", value: 0, icon: "1.39" })}
    ${roleStatRow({ label: "昏睡", value: 0, icon: "1.49" })}
    ${roleStatRow({ label: "麻痹", value: 0, icon: "1.41" })}
    ${roleStatRow({ label: "封印", value: 0, icon: "2.7" })}
    ${roleStatRow({ label: "诅咒", value: 0, icon: "1.14", full: true })}
    ${roleStatRow({ label: "抗致命", value: 0, icon: STAT_ICONS.crit })}
    ${roleStatRow({ label: "抗暴伤", value: 0, icon: STAT_ICONS.critDamage })}
    ${roleStatRow({ label: "抗人物", value: 0, icon: "2.10" })}
    ${roleStatRow({ label: "抗宠物", value: 0, icon: "2.12" })}
    ${roleStatRowHtml({ label: `${subject.kind === "pet" ? "宠物" : subject.kind === "mercenary" ? "佣兵" : subject.kind === "peer" ? "对方" : "人物"}会 ${subject.skills.length} 项技能`, html: "", icon: "2.12", full: true })}
    ${skillRows}
  </div>`;
}

function renderRoleStatsCard() {
  const subject = state.roleStatsSubject || statsCardSubjectForRole();
  const panel = $("#roleStatsCard");
  if (!panel) return;
  $("#roleStatsName").textContent = subject.name;
  $("#roleStatsMedal").innerHTML = subject.kind === "pet" ? roleStatsIconHtml("1.49") : roleStatsIconHtml("2.6");
  $("#roleStatsFlight").textContent = state.roleStatsPage === "resist" ? subject.headerMode : "";
  $("#roleStatsCrystal").innerHTML = state.roleStatsPage === "resist" ? "" : roleStatsIconHtml("2.12");
  $("#roleStatsRank").textContent = state.roleStatsPage === "resist" ? "" : subject.rank;
  $("#roleStatsBody").innerHTML = state.roleStatsPage === "resist" ? roleStatsResistHtml(subject) : roleStatsMainHtml(subject);
  panel.classList.add("active");
  panel.setAttribute("aria-hidden", "false");
  stripMenuFrame($("#roleStatsHead"));
  stripMenuFrame($("#roleStatsBody"));
  decorateRoleStatsFrame(panel);
  document.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  drawRoleStatsAvatar();
}

function openStatsCard(subject) {
  closeMainMenu();
  clearMenuHint();
  state.roleStatsOpen = true;
  state.roleStatsPage = "stats";
  state.roleStatsSubject = subject;
  renderRoleStatsCard();
}

function toggleRoleStatsCardPage() {
  if (!state.roleStatsOpen) return;
  state.roleStatsPage = state.roleStatsPage === "stats" ? "resist" : "stats";
  renderRoleStatsCard();
}

function closeRoleStatsCard() {
  state.roleStatsOpen = false;
  state.roleStatsSubject = null;
  const panel = $("#roleStatsCard");
  if (!panel) return;
  panel.classList.remove("active");
  panel.setAttribute("aria-hidden", "true");
}

function openRoleStatsDetailMenu() {
  openStatsCard(statsCardSubjectForRole());
}

function skillDetailRows(skill) {
  const rows = [{ label: `技能：${skill.name}`, icon: "1.49", disabled: true }];
  if (skill.requiredClass) rows.push({ label: `释放条件：${skill.requiredClass}，装备对应武器和魔尊武器`, icon: "1.3", disabled: true });
  if (skill.type) rows.push({ label: `类型：${skill.type === "magic" ? "法术" : skill.type === "self_buff" ? "自身增益" : skill.type === "heal" ? "治疗" : "物理"}`, icon: "2.10", disabled: true });
  if (skill.type === "passive") rows.push({ label: "被动技能", icon: "2.12", disabled: true });
  if (skill.attackScale) rows.push({ label: `攻击倍率 ${skill.attackScale}`, icon: STAT_ICONS.attack, disabled: true });
  if (skill.manaScale) rows.push({ label: `法力倍率 ${skill.manaScale}`, icon: STAT_ICONS.mana, disabled: true });
  if (skill.defenseScale) rows.push({ label: `防御倍率 ${skill.defenseScale}`, icon: STAT_ICONS.defense, disabled: true });
  if (skill.speedScale) rows.push({ label: `速度倍率 ${skill.speedScale}`, icon: STAT_ICONS.speed, disabled: true });
  if (skill.skillDamageMultiplier) rows.push({ label: `技能伤害 +${Math.round((skill.skillDamageMultiplier - 1) * 100)}%`, icon: "1.49", disabled: true });
  if (skill.selfSpeedBuffFlat) rows.push({ label: `临时速度 +${skill.selfSpeedBuffFlat}`, icon: STAT_ICONS.speed, disabled: true });
  if (skill.pierce) rows.push({ label: `穿透 ${Math.round(skill.pierce * 100)}%`, icon: "1.39", disabled: true });
  if (skill.critBonus) rows.push({ label: `致命 +${skill.critBonus}%`, icon: "1.14", disabled: true });
  if (skill.critDamageBonus) rows.push({ label: `爆伤 +${skill.critDamageBonus}`, icon: "1.39", disabled: true });
  if (skill.selfShield) rows.push({ label: `自我回复 ${Math.round(skill.selfShield * 100)}%生命`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.hpDamageRate) rows.push({ label: `附加目标当前生命 ${Math.round(skill.hpDamageRate * 100)}%伤害`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.maxHpMultiplier) rows.push({ label: `生命上限变为 ${skill.maxHpMultiplier}倍`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.guardReduction && !skill.passiveGuardRole && !skill.passiveGuardPet && !skill.passiveGuardMercenary) rows.push({ label: `自身伤害减免 ${Math.round(skill.guardReduction * 100)}%`, icon: STAT_ICONS.defense, disabled: true });
  if (skill.allStatMultiplier) rows.push({ label: `全属性变为 ${skill.allStatMultiplier}倍`, icon: "1.49", disabled: true });
  if (skill.controlImmune) rows.push({ label: "免疫控制", icon: "1.49", disabled: true });
  if (skill.sacrificeAllies) rows.push({ label: "牺牲己方宠物和佣兵", icon: "2.12", disabled: true });
  if (skill.buffTurns) rows.push({ label: `持续 ${skill.buffTurns}回合`, icon: "1.49", disabled: true });
  if (skill.speedBuffPerHit) rows.push({ label: `每命中1个目标速度 +${Math.round(skill.speedBuffPerHit * 100)}%`, icon: STAT_ICONS.speed, disabled: true });
  if (skill.speedDownRate) rows.push({ label: `冻伤减速 ${Math.round(skill.speedDownRate * 100)}%`, icon: STAT_ICONS.speed, disabled: true });
  if (skill.ignoreDefense) rows.push({ label: "无视防御", icon: STAT_ICONS.defense, disabled: true });
  if (skill.canCrit === false) rows.push({ label: "不能暴击", icon: STAT_ICONS.crit, disabled: true });
  if (skill.targetRule === "all") rows.push({ label: "攻击全体", icon: "1.49", disabled: true });
  if (skill.targetCount) rows.push({ label: `攻击${skill.targetCount}个目标`, icon: "1.49", disabled: true });
  if (skill.teamCritBonus) rows.push({ label: `全队致命 +${skill.teamCritBonus}`, icon: STAT_ICONS.crit, disabled: true });
  if (skill.teamHealRate) rows.push({ label: `全队恢复 ${Math.round(skill.teamHealRate * 100)}%生命`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.teamHealManaScale) rows.push({ label: `全队恢复 ${skill.teamHealManaScale}倍法力`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.cleanse) rows.push({ label: "移除负面效果", icon: "1.49", disabled: true });
  if (skill.cleanseControls) rows.push({ label: "移除控制效果", icon: "1.49", disabled: true });
  if (skill.controlImmuneTurns) rows.push({ label: `${skill.controlImmuneTurns}回合控制免疫`, icon: "1.49", disabled: true });
  if (skill.sacrificeHpRate) rows.push({ label: `消耗自身 ${Math.round(skill.sacrificeHpRate * 100)}%生命`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.bindChance) rows.push({ label: `禁锢 ${Math.round(skill.bindChance * 100)}% / ${skill.bindTurns}回合`, icon: "1.49", disabled: true });
  if (skill.confuseChance) rows.push({ label: `混乱 ${Math.round(skill.confuseChance * 100)}% / ${skill.confuseTurns}回合`, icon: "1.49", disabled: true });
  if (skill.sealChance) rows.push({ label: `封印 ${Math.round(skill.sealChance * 100)}% / ${skill.sealTurns || 2}回合`, icon: "1.49", disabled: true });
  if (skill.paralyzeChance) rows.push({ label: `麻痹 ${Math.round(skill.paralyzeChance * 100)}% / ${skill.paralyzeTurns}回合，无法行动`, icon: "1.49", disabled: true });
  if (skill.sleepChance) rows.push({ label: `催眠 ${Math.round(skill.sleepChance * 100)}% / ${skill.sleepTurns}回合`, icon: "1.49", disabled: true });
  if (skill.stunChance) rows.push({ label: `眩晕 ${Math.round(skill.stunChance * 100)}% / ${skill.stunTurns}回合`, icon: "1.49", disabled: true });
  if (skill.curseChance) rows.push({ label: `诅咒 ${Math.round(skill.curseChance * 100)}% / ${skill.curseTurns}回合，每回合${skill.curseManaScale || 0.75}倍法力伤害`, icon: "1.49", disabled: true });
  if (skill.noHealChance) rows.push({ label: `禁疗 ${Math.round(skill.noHealChance * 100)}% / ${skill.noHealTurns || 1}回合`, icon: "1.49", disabled: true });
  if (skill.severeBleedChance) rows.push({ label: `重创 ${Math.round(skill.severeBleedChance * 100)}% / 流血${skill.severeBleedAmount}`, icon: STAT_ICONS.mana, disabled: true });
  if (skill.damageReductionDown) rows.push({ label: `伤害减免降低 ${Math.round(skill.damageReductionDown * 100)}%`, icon: STAT_ICONS.defense, disabled: true });
  if (skill.bleed) rows.push({ label: `流血 ${skill.bleed.scale}倍${skill.bleed.stat === "speed" ? "速度" : "法力"} / ${skill.bleed.turns}回合`, icon: STAT_ICONS.mana, disabled: true });
  if (skill.passiveDodge) rows.push({ label: `闪避 ${Math.round(skill.passiveDodge * 100)}%`, icon: STAT_ICONS.speed, disabled: true });
  if (skill.passiveClearDefense) rows.push({ label: "被动清空敌方防御", icon: STAT_ICONS.defense, disabled: true });
  if (skill.passiveCombo) rows.push({ label: "释放技能后跟随一发普攻", icon: STAT_ICONS.attack, disabled: true });
  if (skill.passiveComboBasic) rows.push({ label: "普攻后也会跟随一发普攻", icon: STAT_ICONS.attack, disabled: true });
  if (skill.passiveCounter) rows.push({ label: "被攻击后反击一发普攻", icon: STAT_ICONS.attack, disabled: true });
  if (skill.passiveRebirthChance) rows.push({ label: `倒下时 ${Math.round(skill.passiveRebirthChance * 100)}%复活`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.panelStatMultiplier) rows.push({ label: `面板生命/攻击/防御/法力/速度 +${Math.round((skill.panelStatMultiplier - 1) * 100)}%`, icon: "1.49", disabled: true });
  if (skill.passiveBreakArmor) rows.push({ label: "攻击会清空敌方防御", icon: STAT_ICONS.defense, disabled: true });
  if (skill.passiveLifesteal) rows.push({ label: `回复造成伤害的 ${Math.round(skill.passiveLifesteal * 100)}%生命`, icon: STAT_ICONS.hp, disabled: true });
  if (skill.passiveGuardRole) rows.push({ label: `人物免伤 ${Math.round((skill.guardReduction || 0.75) * 100)}%`, icon: STAT_ICONS.defense, disabled: true });
  if (skill.passiveGuardPet) rows.push({ label: `宠物免伤 ${Math.round((skill.guardReduction || 0.75) * 100)}%`, icon: STAT_ICONS.defense, disabled: true });
  if (skill.passiveGuardMercenary) rows.push({ label: `佣兵免伤 ${Math.round((skill.guardReduction || 0.75) * 100)}%`, icon: STAT_ICONS.defense, disabled: true });
  return rows;
}

function skillSummary(skill) {
  return skillDetailRows(skill).slice(1).map((row) => row.label).join("，");
}

function openRoleSkillDetailMenu() {
  state.menuMode = "role_skill_detail";
  state.menuItem = 0;
  const stats = statsForRole();
  const skill = skillCatalog[stats.skillId] || skillCatalog.pet_default;
  setMenuAsSingleList("角色技能", skillDetailRows(skill));
}

function ownedPets() {
  const ids = state.ownedPetIds?.length ? state.ownedPetIds : [state.selected.petId];
  return petCatalog.filter((pet) => ids.includes(pet.id));
}

function openPetRootMenu() {
  state.menuMode = "pet_root";
  state.menuItem = 0;
  setMenuAsSingleList("宠物指令", [
    { label: "查看宠物", icon: "2.12" }
  ]);
  bindCurrentMenuClicks(confirmPetRootMenu);
}

function confirmPetRootMenu() {
  if (state.menuItem === 0) openPetSelectMenu();
}

function openPetSelectMenu() {
  state.menuMode = "pet_select";
  state.menuItem = 0;
  const pets = ownedPets();
  state.menuPetList = pets;
  const items = pets.length
    ? pets.map((pet) => ({ label: `${pet.name} Lv.${(state.petProgressById[String(pet.id)] || normalizePetProgress()).level}`, icon: "2.12" }))
    : [{ label: "暂无宠物", icon: "2.12", disabled: true }];
  setMenuAsSingleList("查看宠物", items);
  bindCurrentMenuClicks(confirmPetSelectMenu);
}

function confirmPetSelectMenu() {
  const pet = state.menuPetList?.[state.menuItem];
  if (pet) openPetDetailMenu(pet.id);
}

function openPetDetailMenu(petId, keepIndex = 0) {
  state.menuMode = "pet_detail";
  state.menuItem = keepIndex;
  const pet = petCatalog.find((item) => item.id === petId) || petCatalog[0];
  state.selected.petId = pet.id;
  syncActivePetProgress();
  setMenuAsSingleList(pet.name, [
    { label: "属性", icon: "2.10" },
    { label: "技能详情", icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmPetDetailMenu);
}

function confirmPetDetailMenu() {
  if (state.menuItem === 0) {
    openPetStatsDetailMenu(state.selected.petId);
    return;
  }
  if (state.menuItem === 1) openPetSkillDetailMenu(state.selected.petId);
}

function openPetStatsDetailMenu(petId) {
  openStatsCard(statsCardSubjectForPet(petId));
}

function openPetSkillDetailMenu(petId) {
  state.menuMode = "pet_skill_detail";
  state.menuItem = 0;
  const pet = petCatalog.find((item) => item.id === petId) || petCatalog[0];
  const stats = statsForPet(pet.id);
  const skill = skillCatalog[stats.skillId] || skillCatalog.pet_default;
  setMenuAsSingleList(`${pet.name}技能`, skillDetailRows(skill));
}

function openPetRootMenu() {
  state.menuMode = "pet_root";
  state.menuItem = 0;
  setMenuAsSingleList("宠物指令", [
    { label: "查看宠物", icon: "2.12" },
    { label: "带出宠物", icon: "2.12" },
    { label: state.pet ? `收回宠物：${state.pet.name}` : "收回宠物：当前未带出", icon: "2.12", disabled: !state.pet }
  ]);
  bindCurrentMenuClicks(confirmPetRootMenu);
}

function confirmPetRootMenu() {
  if (state.menuItem === 0) openPetSelectMenu();
  if (state.menuItem === 1) openPetBringOutMenu();
  if (state.menuItem === 2) recallPet();
}

function openPetDetailMenu(petId, keepIndex = 0) {
  state.menuMode = "pet_detail";
  state.menuItem = keepIndex;
  const pet = petCatalog.find((item) => item.id === petId) || petCatalog[0];
  state.menuPetId = pet.id;
  setMenuAsSingleList(pet.name, [
    { label: "属性", icon: "2.10" },
    { label: "技能详情", icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmPetDetailMenu);
}

function confirmPetDetailMenu() {
  const petId = state.menuPetId || state.selected.petId;
  if (state.menuItem === 0) {
    openPetStatsDetailMenu(petId);
    return;
  }
  if (state.menuItem === 1) openPetSkillListMenu(petId);
}

function openPetBringOutMenu() {
  state.menuMode = "pet_bring_out";
  state.menuItem = 0;
  const pets = ownedPets();
  state.menuPetList = pets;
  const items = pets.length
    ? pets.map((pet) => ({ label: `${state.pet?.spriteId === pet.id ? "[已带出] " : ""}${pet.name} Lv.${(state.petProgressById[String(pet.id)] || normalizePetProgress()).level}`, icon: "2.12" }))
    : [{ label: "暂无宠物", icon: "2.12", disabled: true }];
  setMenuAsSingleList("带出宠物", items);
  bindCurrentMenuClicks(confirmPetBringOutMenu);
}

function confirmPetBringOutMenu() {
  const pet = state.menuPetList?.[state.menuItem];
  if (pet) bringOutPet(pet.id);
}

async function bringOutPet(petId) {
  const pet = petCatalog.find((item) => item.id === petId);
  if (!pet || !ownedPets().some((owned) => owned.id === pet.id)) return;
  await Promise.all([loadSprite(pet.id), loadSpriteOptional(petModule.battleSpriteIdForPet(pet.id))]);
  const tileSize = state.map?.tileSize || 16;
  const x = state.player ? Math.max(0, state.player.x - tileSize) : 0;
  const y = state.player ? state.player.y : 0;
  state.selected.petId = pet.id;
  syncActivePetProgress();
  state.pet = createActor({ name: pet.name, spriteId: pet.id, x, y });
  state.pet.isPet = true;
  state.pet.path = [];
  await savePlayerPosition(true);
  showMenuHint(`${pet.name} 已带出，挂机技能已切换`);
  openPetBringOutMenu();
}

function recallPet() {
  if (!state.pet) return;
  state.pet = null;
  showMenuHint("宠物已收回");
  openPetRootMenu();
}

function openRoleSkillDetailMenu() {
  state.menuMode = "role_skill_detail";
  state.menuItem = 0;
  const skillId = state.menuSkillId || defaultSkillIdForStats(statsForRole());
  setMenuAsSingleList("角色技能详情", skillDetailRows(skillById(skillId)));
}

function openRoleSkillListMenu() {
  state.menuMode = "role_skill_list";
  state.menuItem = 0;
  state.menuSkillList = skillsForStats(statsForRole());
  setMenuAsSingleList("角色技能", state.menuSkillList.map((id) => {
    const skill = skillById(id);
    const usable = roleSkillUsable(id);
    return { label: `${skill.name}${skill.requiredClass && !usable ? "（条件不足）" : ""}`, icon: "1.49", disabled: Boolean(skill.requiredClass && !usable), className: skill.requiredClass ? "rare-fragment" : "" };
  }));
  bindCurrentMenuClicks(confirmRoleSkillListMenu);
}

function confirmRoleSkillListMenu() {
  const skillId = state.menuSkillList?.[state.menuItem];
  if (!skillId) return;
  state.menuSkillId = skillId;
  openRoleSkillDetailMenu();
}

function openPetSkillDetailMenu(petId) {
  state.menuMode = "pet_skill_detail";
  state.menuItem = 0;
  const pet = petCatalog.find((item) => item.id === petId) || petCatalog[0];
  state.menuPetId = pet.id;
  const skillId = state.menuSkillId || defaultSkillIdForStats(statsForPet(pet.id));
  setMenuAsSingleList(`${pet.name}技能详情`, skillDetailRows(skillById(skillId)));
}

function openPetSkillListMenu(petId) {
  state.menuMode = "pet_skill_list";
  state.menuItem = 0;
  const pet = petCatalog.find((item) => item.id === petId) || petCatalog[0];
  state.menuPetId = pet.id;
  state.menuSkillList = skillsForStats(statsForPet(pet.id));
  setMenuAsSingleList(`${pet.name}技能`, state.menuSkillList.map((id) => ({ label: skillById(id).name, icon: "1.49" })));
  bindCurrentMenuClicks(confirmPetSkillListMenu);
}

function confirmPetSkillListMenu() {
  const skillId = state.menuSkillList?.[state.menuItem];
  if (!skillId) return;
  state.menuSkillId = skillId;
  openPetSkillDetailMenu(state.menuPetId || state.selected.petId);
}

function openSoulPowderMenu() {
  state.menuMode = "soul_powder";
  state.menuItem = 0;
  setMenuAsSingleList("灵魂粉末", [
    { label: "领取300灵魂粉末（8小时）", icon: "1.11", claim: "300" },
    { label: "领取400灵魂粉末（4小时）", icon: "1.11", claim: "400" },
    { label: "元宝购买灵魂粉末（未开放）", icon: "1.11", disabled: true }
  ]);
  bindCurrentMenuClicks(confirmSoulPowderMenu);
}

function openDragonSoulMenu(keepIndex = 0) {
  state.menuMode = "dragon_soul";
  state.menuItem = keepIndex;
  const level = state.playerProgress.dragonSoul;
  const cost = level < 100 ? soulPowderCost(level) : 0;
  setMenuAsSingleList("龙魂系统", [
    { label: `龙魂等级 ${level}/100（查看属性）`, icon: "1.49" },
    { label: cost ? `消耗 ${cost} 灵魂粉末升级` : "龙魂已满级", icon: "1.11", disabled: level >= 100 }
  ]);
  bindCurrentMenuClicks(confirmDragonSoulMenu);
}

async function confirmDragonSoulMenu() {
  if (state.menuItem === 0) {
    openDragonSoulDetailMenu();
    return;
  }
  if (state.menuItem !== 1 || state.playerProgress.dragonSoul >= 100) return;
  try {
    const result = await postApi("/api/dragon-soul/upgrade", { account: state.account });
    state.playerProgress.dragonSoul = result.dragonSoul;
    showMenuHint(`龙魂升级成功：${result.dragonSoul}/100`);
    openDragonSoulMenu(1);
  } catch (error) {
    showMenuHint(error.message === "not_enough_powder" ? "灵魂粉末不足" : "龙魂升级失败");
  }
}

function openDragonSoulDetailMenu() {
  state.menuMode = "dragon_soul_detail";
  state.menuItem = 0;
  const level = state.playerProgress.dragonSoul;
  const soul = {};
  const dragonSoulConfig = growthConfig?.character?.dragonSoul || dragonSoulGrowth;
  Object.keys(STAT_LIMITS).forEach((stat) => {
    soul[stat] = Math.round((dragonSoulConfig[stat] || 0) * (level - 1));
  });
  setMenuAsSingleList(`龙魂属性 ${level}/100`, [
    { label: `生命 +${soul.hp}`, icon: STAT_ICONS.hp, disabled: true },
    { label: `防御 +${soul.defense}`, icon: STAT_ICONS.defense, disabled: true },
    { label: `速度 +${soul.speed}`, icon: STAT_ICONS.speed, disabled: true },
    { label: `攻击 +${soul.attack}`, icon: STAT_ICONS.attack, disabled: true },
    { label: `法力 +${soul.mana}`, icon: STAT_ICONS.mana, disabled: true },
    { label: `致命 +${soul.crit}`, icon: STAT_ICONS.crit, disabled: true },
    { label: `爆伤 +${soul.critDamage}`, icon: STAT_ICONS.critDamage, disabled: true }
  ]);
}

function openAutoStrategyMenu() {
  state.menuMode = "auto_strategy";
  const actorSkill = autoSkillLabel("actor", statsForRole());
  const petSkill = autoSkillLabel("pet", statsForPet(state.pet?.spriteId || state.selected.petId));
  const mercenary = activeMercenary();
  const mercenarySkill = mercenary ? autoSkillLabel("mercenary", statsForMercenary(mercenary)) : "未带出佣兵";
  setMenuAsSingleList("设置挂机技能", [
    { label: `人物自动：${actorSkill}`, icon: "1.41" },
    { label: `宠物自动：${petSkill}`, icon: "2.12" },
    { label: `佣兵自动：${mercenarySkill}`, icon: "1.9", disabled: !mercenary }
  ]);
  bindCurrentMenuClicks(confirmAutoStrategyMenu);
}

function confirmAutoStrategyMenu() {
  if (state.menuItem === 0) openAutoStrategySkillMenu("actor");
  if (state.menuItem === 1) openAutoStrategySkillMenu("pet");
  if (state.menuItem === 2 && activeMercenary()) openAutoStrategySkillMenu("mercenary");
}

function autoStrategyEntry(kind) {
  const petId = String(state.pet?.spriteId || state.selected.petId || "");
  const mercenaryId = String(activeMercenary()?.id || state.activeMercenaryId || "");
  const current = kind === "pet"
    ? state.autoStrategy.petById?.[petId]
    : kind === "mercenary"
      ? state.autoStrategy.mercenaryById?.[mercenaryId]
      : state.autoStrategy[kind];
  if (typeof current === "object" && current) return { mode: current.mode || "skill", skillId: current.skillId || "" };
  return { mode: current === "attack" ? "attack" : "skill", skillId: "" };
}

function normalizeAutoStrategy(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const petById = {};
  if (source.petById && typeof source.petById === "object") {
    Object.entries(source.petById).forEach(([petId, entry]) => {
      petById[String(petId)] = normalizeAutoStrategyEntry(entry);
    });
  }
  const mercenaryById = {};
  if (source.mercenaryById && typeof source.mercenaryById === "object") {
    Object.entries(source.mercenaryById).forEach(([mercenaryId, entry]) => {
      mercenaryById[String(mercenaryId)] = normalizeAutoStrategyEntry(entry);
    });
  }
  if (!Object.keys(petById).length && source.pet) {
    const legacyPetId = String(state.selected?.petId || "");
    if (legacyPetId) petById[legacyPetId] = normalizeAutoStrategyEntry(source.pet);
  }
  if (!Object.keys(mercenaryById).length && source.mercenary) {
    const mercenaryId = String(state.activeMercenaryId || "");
    if (mercenaryId) mercenaryById[mercenaryId] = normalizeAutoStrategyEntry(source.mercenary);
  }
  return {
    actor: normalizeAutoStrategyEntry(source.actor),
    petById,
    mercenaryById
  };
}

function normalizeAutoStrategyEntry(value) {
  if (value && typeof value === "object") return { mode: value.mode === "attack" ? "attack" : "skill", skillId: value.skillId || "" };
  return { mode: value === "attack" ? "attack" : "skill", skillId: "" };
}

function setAutoStrategyEntry(kind, entry) {
  if (kind === "pet") {
    const petId = String(state.pet?.spriteId || state.selected.petId || "");
    state.autoStrategy.petById = state.autoStrategy.petById || {};
    if (petId) state.autoStrategy.petById[petId] = entry;
  } else if (kind === "mercenary") {
    const mercenaryId = String(activeMercenary()?.id || state.activeMercenaryId || "");
    state.autoStrategy.mercenaryById = state.autoStrategy.mercenaryById || {};
    if (mercenaryId) state.autoStrategy.mercenaryById[mercenaryId] = entry;
  } else {
    state.autoStrategy[kind] = entry;
  }
  savePlayerPosition(true);
}

function autoSkillLabel(kind, stats) {
  const entry = autoStrategyEntry(kind);
  if (entry.mode === "attack") return "普通攻击";
  const available = kind === "actor" ? activeBattleSkillsForStats(stats, state.player) : activeSkillsForStats(stats);
  const skillId = available.includes(entry.skillId) ? entry.skillId : defaultSkillIdForStats(stats);
  return `释放技能：${skillById(skillId).name}`;
}

function openAutoStrategySkillMenu(kind) {
  const isPet = kind === "pet";
  const isMercenary = kind === "mercenary";
  state.menuMode = isMercenary ? "auto_strategy_mercenary_skill" : isPet ? "auto_strategy_pet_skill" : "auto_strategy_actor_skill";
  state.menuAutoStrategyKind = kind;
  state.menuItem = 0;
  const stats = isMercenary ? statsForMercenary(activeMercenary()) : isPet ? statsForPet(state.pet?.spriteId || state.selected.petId) : statsForRole();
  const entry = autoStrategyEntry(kind);
  const skills = isPet || isMercenary ? activeSkillsForStats(stats) : activeBattleSkillsForStats(stats, state.player);
  state.menuSkillList = skills;
  const currentSkillId = skills.includes(entry.skillId) ? entry.skillId : defaultSkillIdForStats(stats);
  const items = [
    { label: `${entry.mode === "attack" ? "[当前] " : ""}普通攻击`, icon: "1.3" },
    ...skills.map((id) => ({ label: `${entry.mode === "skill" && currentSkillId === id ? "[当前] " : ""}${skillById(id).name}`, icon: "1.49" }))
  ];
  setMenuAsSingleList(isMercenary ? "佣兵挂机技能" : isPet ? "宠物挂机技能" : "人物挂机技能", items);
  bindCurrentMenuClicks(confirmAutoStrategySkillMenu);
}

function confirmAutoStrategySkillMenu() {
  const kind = state.menuAutoStrategyKind || "actor";
  if (state.menuItem === 0) {
    setAutoStrategyEntry(kind, { mode: "attack", skillId: "" });
  } else {
    const skillId = state.menuSkillList?.[state.menuItem - 1];
    if (!skillId) return;
    setAutoStrategyEntry(kind, { mode: "skill", skillId });
  }
  showMenuHint("挂机技能已设置");
  openAutoStrategySkillMenu(kind);
}

async function confirmSoulPowderMenu() {
  const item = [
    { claim: "300" },
    { claim: "400" },
    { disabled: true }
  ][state.menuItem];
  if (!item || item.disabled) {
    showMenuHint("元宝购买灵魂粉末暂未开放");
    return;
  }
  try {
    const result = await postApi("/api/soul-powder/claim", { account: state.account, type: item.claim });
    showSoulPowderRewardPanel(result, item.claim);
  } catch (error) {
    showMenuHint(error.message === "cooldown" ? "还未到领取时间" : "领取失败");
  }
}

function showSoulPowderRewardPanel(result, claimType) {
  const panel = $("#soulPowderRewardPanel");
  const list = $("#soulPowderRewardList");
  const image = $("#soulPowderRewardImage");
  if (!panel || !list || !image) {
    showMenuHint(`领取成功，灵魂粉末 +${result.amount}，当前 ${result.soulPowder}`);
    return;
  }
  image.src = claimType === "300" ? "资源/图片/mm1.png" : "资源/图片/mm2.png";
  list.innerHTML = `
    <div class="battle-reward-row">
      ${menuIconHtml("1.11")}
      <span>灵魂粉末 +${Number(result.amount) || 0}</span>
      <small>当前 ${Number(result.soulPowder) || 0}</small>
    </div>
  `;
  panel.classList.add("active");
  prepareRewardDialog(panel);
}

function closeSoulPowderRewardPanel() {
  $("#soulPowderRewardPanel")?.classList.remove("active");
  stopRewardDialogAnimation();
}

function stickerModuleApi() {
  return window.LifeSkillStickerModule || {
    gradeOrder: [],
    gradeCosts: {},
    stickers: [],
    stickerById: {},
    applyOptions: [],
    formatStats: () => ""
  };
}

function stickerCostLabel(cost = {}) {
  return `颜料${cost.paint || 0} 银币${cost.silver || 0} 粉末${cost.soulPowder || 0}`;
}

function stickerInventoryItems() {
  const mod = stickerModuleApi();
  const inventory = state.stickerInventory || {};
  return mod.stickers
    .filter((sticker) => (inventory[sticker.id] || 0) > 0)
    .map((sticker) => ({ ...sticker, quantity: inventory[sticker.id] || 0 }));
}

function stickerMenuClass(sticker) {
  const order = stickerModuleApi().gradeOrder || [];
  const index = order.indexOf(sticker?.grade);
  return index >= 4 ? "rare-fragment" : "";
}

function openLifeSkillsMenu() {
  state.menuMode = "life_skills";
  state.menuItem = 0;
  setMenuAsSingleList("生活技能", [
    { label: "贴纸生产", icon: "2.22" }
  ]);
  bindCurrentMenuClicks(confirmLifeSkillsMenu);
}

function confirmLifeSkillsMenu() {
  if (state.menuItem === 0) openStickerGradeMenu();
}

function openStickerGradeMenu() {
  state.menuMode = "sticker_grade";
  state.menuItem = 0;
  const mod = stickerModuleApi();
  const items = mod.gradeOrder.map((grade) => {
    const cost = mod.gradeCosts[grade] || {};
    return { label: `${grade}贴纸生产（${stickerCostLabel(cost)}）`, icon: "2.22", className: ["神品", "魂品"].includes(grade) ? "rare-fragment" : "" };
  });
  items.push({ label: `查看贴纸库存 ${stickerInventoryItems().length}种`, icon: "2.22" });
  setMenuAsSingleList("贴纸生产", items);
  bindCurrentMenuClicks(confirmStickerGradeMenu);
}

function confirmStickerGradeMenu() {
  const mod = stickerModuleApi();
  if (state.menuItem >= mod.gradeOrder.length) {
    openStickerInventoryMenu();
    return;
  }
  const grade = mod.gradeOrder[state.menuItem];
  openStickerPreviewMenu(grade);
}

function openStickerPreviewMenu(grade) {
  state.menuMode = "sticker_preview";
  state.menuItem = 0;
  state.menuStickerGrade = grade;
  const mod = stickerModuleApi();
  const stickers = mod.stickers.filter((sticker) => sticker.grade === grade);
  const items = stickers.map((sticker) => ({
    label: sticker.name,
    icon: "2.22",
    className: stickerMenuClass(sticker),
    longText: true
  }));
  setMenuAsSingleList(`选择${grade}贴纸`, items);
  bindCurrentMenuClicks(confirmStickerPreviewMenu);
}

function confirmStickerPreviewMenu() {
  const mod = stickerModuleApi();
  const grade = state.menuStickerGrade;
  const stickers = mod.stickers.filter((sticker) => sticker.grade === grade);
  const sticker = stickers[state.menuItem];
  if (!sticker) return;
  state.menuCraftSticker = sticker;
  openStickerCraftConfirmMenu();
}

function openStickerCraftConfirmMenu() {
  state.menuMode = "sticker_craft_confirm";
  state.menuItem = 0;
  const mod = stickerModuleApi();
  const sticker = state.menuCraftSticker;
  const cost = mod.gradeCosts[sticker?.grade] || {};
  setMenuAsSingleList(sticker?.name || "生产贴纸", [
    { label: `属性预览：${mod.formatStats(sticker?.stats || {})}`, icon: "2.10", disabled: true, longText: true },
    { label: `消耗：${stickerCostLabel(cost)}`, icon: "1.11", disabled: true, longText: true },
    { label: "输入数量并生产", icon: "2.22", className: stickerMenuClass(sticker) }
  ]);
  bindCurrentMenuClicks(confirmStickerCraftMenu);
}

async function confirmStickerCraftMenu() {
  if (state.menuItem < 2) return;
  const mod = stickerModuleApi();
  const sticker = state.menuCraftSticker;
  if (!sticker) return;
  const cost = mod.gradeCosts[sticker.grade] || {};
  const maxByPaint = cost.paint > 0 ? Math.floor((state.bag?.items?.find((item) => item.id === "mysterious_paint")?.quantity || 0) / cost.paint) : 999999;
  const maxBySilver = cost.silver > 0 ? Math.floor((state.silver || 0) / cost.silver) : 999999;
  const maxByPowder = cost.soulPowder > 0 ? Math.floor((state.bag?.items?.find((item) => item.id === "soul_powder")?.quantity || 0) / cost.soulPowder) : 999999;
  const maxQuantity = Math.max(1, Math.min(999999, maxByPaint, maxBySilver, maxByPowder));
  openQuantityPanel({
    title: "生产数量",
    label: `${sticker.name}，每张消耗 ${stickerCostLabel(cost)}，最多 ${maxQuantity}`,
    maxQuantity,
    initialQuantity: 1,
    confirmText: "生产",
    onCancel: openStickerCraftConfirmMenu,
    onConfirm: async (quantity) => craftStickerQuantity(sticker, quantity)
  });
}

async function craftStickerQuantity(sticker, quantity) {
  const mod = stickerModuleApi();
  try {
    const result = await postApi("/api/life-skills/stickers/craft", { account: state.account, grade: sticker.grade, stickerId: sticker.id, quantity });
    applyStickerPlayerResult(result.player);
    hideQuantityPanel();
    showMenuHint(`生产成功：${result.sticker.name} x${result.quantity || quantity} ${mod.formatStats(result.sticker.stats)}`);
    openStickerCraftConfirmMenu();
  } catch (error) {
    if ($("#giveQuantityPanel")?.classList.contains("active")) {
      $("#giveQuantityMessage").textContent = stickerErrorText(error.message);
    } else {
      showMenuHint(stickerErrorText(error.message));
    }
  }
}

function openStickerInventoryMenu() {
  state.menuMode = "sticker_inventory";
  state.menuItem = 0;
  const mod = stickerModuleApi();
  const stickers = stickerInventoryItems();
  state.menuStickerList = stickers;
  const items = stickers.length
    ? stickers.map((sticker) => ({
      label: `${sticker.name} x${sticker.quantity}（${mod.formatStats(sticker.stats)}）`,
      icon: "2.22",
      className: stickerMenuClass(sticker),
      longText: true
    }))
    : [{ label: "暂无贴纸", icon: "2.22", disabled: true }];
  setMenuAsSingleList("贴纸库存", items);
  bindCurrentMenuClicks(confirmStickerInventoryMenu);
}

function confirmStickerInventoryMenu() {
  const sticker = state.menuStickerList?.[state.menuItem];
  if (!sticker) return;
  state.menuSticker = sticker;
  openStickerPetMenu();
}

function openStickerPetMenu() {
  state.menuMode = "sticker_pet";
  state.menuItem = 0;
  const pets = ownedPets();
  state.menuPetList = pets;
  const petStickers = state.petStickers || {};
  const items = pets.length
    ? pets.map((pet) => {
      const count = (petStickers[String(pet.id)] || []).length;
      return { label: `${pet.name}（贴纸 ${count}/5）`, icon: "2.12" };
    })
    : [{ label: "暂无宠物", icon: "2.12", disabled: true }];
  setMenuAsSingleList("选择宠物", items);
  bindCurrentMenuClicks(confirmStickerPetMenu);
}

function confirmStickerPetMenu() {
  const pet = state.menuPetList?.[state.menuItem];
  if (!pet) return;
  state.menuStickerPet = pet;
  openStickerApplyOptionMenu();
}

function openStickerApplyOptionMenu() {
  state.menuMode = "sticker_apply_option";
  state.menuItem = 0;
  const mod = stickerModuleApi();
  const sticker = state.menuSticker;
  const owned = (state.stickerInventory || {})[sticker?.id] || 0;
  const items = mod.applyOptions.map((option) => ({
    label: `${option.quantity}张 / ${option.days}天 / 消耗${option.soulPowder}灵魂粉末`,
    icon: "1.11",
    disabled: owned < option.quantity
  }));
  setMenuAsSingleList(sticker?.name || "使用贴纸", items);
  bindCurrentMenuClicks(confirmStickerApplyOptionMenu);
}

async function confirmStickerApplyOptionMenu() {
  const mod = stickerModuleApi();
  const sticker = state.menuSticker;
  const pet = state.menuStickerPet;
  const option = mod.applyOptions[state.menuItem];
  if (!sticker || !pet || !option) return;
  try {
    const result = await postApi("/api/life-skills/stickers/apply", {
      account: state.account,
      stickerId: sticker.id,
      petId: pet.id,
      quantity: option.quantity
    });
    applyStickerPlayerResult(result.player);
    state.serverStats = result.player?.serverStats || state.serverStats;
    showMenuHint(`${pet.name} 已使用 ${sticker.name}，持续${option.days}天`);
    openStickerInventoryMenu();
  } catch (error) {
    showMenuHint(stickerErrorText(error.message));
  }
}

function applyStickerPlayerResult(player) {
  applyPlayerStateResult(player);
}

function stickerErrorText(error) {
  if (error === "not_enough_paint") return "神秘颜料不足";
  if (error === "not_enough_silver") return "银币不足";
  if (error === "not_enough_powder") return "灵魂粉末不足";
  if (error === "not_enough_sticker") return "贴纸数量不足";
  if (error === "pet_sticker_limit") return "该宠物最多只能拥有五种贴纸";
  if (error === "pet_not_owned") return "未拥有该宠物";
  return "贴纸操作失败";
}

async function openBagMenu() {
  state.menuMode = "bag";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    const items = result.items?.length
      ? result.items.map((item) => ({
        label: bagItemLabel(item),
        labelHtml: `${luckyItemLabelHtml(item)}${escapeHtml(itemQuantityGroupLabel(item.quantity))}`,
        icon: item.icon,
        quantityBadge: item.kind === "equipment" || item.kind === "fashion" ? 0 : item.quantity,
        forceSingleLine: true,
        className: [
          !isLuckyDisplayId(String(item.id || "")) && (isExchangeFragment(item) || isPeerlessItem(item)) ? "rare-fragment" : "",
          ""
        ].filter(Boolean).join(" ")
      }))
      : [{ label: "背包为空", icon: "2.8", disabled: true }];
    setMenuAsSingleList(`物品行囊 ${items.length}/${careerTree.BAG_CAPACITY}`, items);
    bindCurrentMenuClicks(confirmBagMenu);
  } catch {
    setMenuAsSingleList("物品行囊", [{ label: "背包读取失败", icon: "2.8", disabled: true }]);
  }
}

async function refreshBag() {
  const result = await apiGet(`/api/bag?account=${encodeURIComponent(state.account)}`);
  state.bag.items = result.items || [];
  if (typeof result.silver === "number") state.silver = result.silver;
  if (typeof result.yuanbao === "number") state.yuanbao = result.yuanbao;
  state.bag.forgeGem = result.items?.find((item) => item.id === "forge_gem")?.quantity || 0;
  state.storageItems = result.storageItems || state.storageItems || [];
  return result;
}

function bagItemLabel(item) {
  if (item.kind === "equipment") return `${item.equipped ? "[已装备] " : ""}${formatEquipment(item)}`;
  if (item.kind === "fashion") return `${item.equipped ? "[已装备] " : ""}${item.name} 属性+30%`;
  const groupLabel = itemQuantityGroupLabel(item.quantity);
  if (item.id === "forge_gem") return `${item.name}${groupLabel}（点击强化装备）`;
  if (item.id === "lucky_box") return `${item.name}${groupLabel}（点击抽奖）`;
  return `${item.name}${groupLabel}`;
}

function itemQuantityGroupLabel(quantity) {
  return window.ItemQuantityDisplay?.displayFor?.(quantity)?.groupLabel || "";
}

function openQuantityPanel({ title, label, maxQuantity, initialQuantity = maxQuantity, confirmText = "确定", cancelText = "返回", onConfirm, onCancel }) {
  closeMainMenu();
  state.menuQuantityContext = { onConfirm, onCancel };
  $("#controlPad").style.pointerEvents = "none";
  const panel = $("#giveQuantityPanel");
  const titleNode = $("#giveQuantityTitle") || panel?.querySelector("strong");
  if (titleNode) titleNode.textContent = title || "输入数量";
  $("#giveQuantityLabel").textContent = label || "请输入数量";
  $("#giveQuantityInput").value = String(initialQuantity);
  $("#giveQuantityInput").max = String(maxQuantity);
  $("#giveQuantityConfirm").textContent = confirmText;
  $("#giveQuantityCancel").textContent = cancelText;
  $("#giveQuantityMessage").textContent = "";
  panel.classList.add("active");
  decorateMenuFrame(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => {
    const input = $("#giveQuantityInput");
    input.focus();
    input.select();
  }, 0);
}

function hideQuantityPanel() {
  $("#giveQuantityPanel").classList.remove("active");
  $("#giveQuantityMessage").textContent = "";
  $("#controlPad").style.pointerEvents = "";
  state.menuQuantityContext = null;
}

function closeGiveQuantityPanel() {
  const context = state.menuQuantityContext;
  hideQuantityPanel();
  if (context?.onCancel) context.onCancel();
}

async function submitGiveQuantity() {
  const context = state.menuQuantityContext;
  if (!context?.onConfirm) return;
  const maxQuantity = Math.max(1, Math.floor(Number($("#giveQuantityInput").max) || 1));
  const quantity = Math.floor(Number($("#giveQuantityInput").value) || 0);
  if (quantity < 1 || quantity > maxQuantity) {
    $("#giveQuantityMessage").textContent = `请输入1-${maxQuantity}之间的数量`;
    return;
  }
  try {
    await context.onConfirm(quantity);
  } catch (error) {
    $("#giveQuantityMessage").textContent = error?.message || "操作失败";
  }
}

function storageUsedSlots(items = state.storageItems) {
  return (items || []).length;
}

async function openStorageMenu() {
  state.menuMode = "storage_root";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    setMenuAsSingleList(`\u7f57\u514b\u8428\u65af\u4ed3\u5e93 ${storageUsedSlots(result.storageItems)}/300`, [
      { label: "\u5b58\u5165\u7269\u54c1", icon: "2.8" },
      { label: "\u53d6\u51fa\u7269\u54c1", icon: "1.14" },
      { label: state.ownedPetIds.includes(895) ? "\u5df2\u9886\u53d6\u963f\u6728\u6728" : "\u9886\u53d6\u5ba0\u7269\u963f\u6728\u6728", icon: "2.12", disabled: state.ownedPetIds.includes(895) },
      { label: "\u5151\u6362\u7801", icon: "1.11" },
      { label: "\u524d\u5f80\u4ed9\u4eba", icon: "2.11" },
      { label: "\u524d\u5f80\u5e7b\u5f71\u72e9\u730e\u573a", icon: "2.11" },
      { label: "\u524d\u5f80\u7cbe\u7075\u738b\u5b9d\u5e93", icon: "2.11" },
      { label: "\u79bb\u5f00", icon: "1.13" }
    ]);
    bindCurrentMenuClicks(confirmStorageMenu);
  } catch {
    setMenuAsSingleList("\u7f57\u514b\u8428\u65af\u4ed3\u5e93", [{ label: "\u4ed3\u5e93\u8bfb\u53d6\u5931\u8d25", icon: "2.8", disabled: true }]);
  }
}

function confirmStorageMenu() {
  if (state.menuItem === 0) openStorageDepositMenu();
  if (state.menuItem === 1) openStorageWithdrawMenu();
  if (state.menuItem === 2) claimRoxasAmumu();
  if (state.menuItem === 3) claimRoxasRedeemCode();
  if (state.menuItem === 4) return roxasTeleportTo("\u4ed9\u4eba", 2, 10);
  if (state.menuItem === 5) return roxasTeleportTo("\u5e7b\u5f71\u72e9\u730e\u573a", 7, 12);
  if (state.menuItem === 6) return roxasTeleportTo(elfKingVault.dungeon.mapName, elfKingVault.dungeon.entry.x, elfKingVault.dungeon.entry.y);
  if (state.menuItem === 7) closeMainMenu();
}

async function roxasTeleportTo(mapName, x, y) {
  closeMainMenu();
  if (state.stall.active) stopStall(false);
  await changeMap(mapName, x, y);
  await savePlayerPosition(true);
  showMenuHint(`\u7f57\u514b\u8428\u65af\u5df2\u9001\u4f60\u524d\u5f80${mapName}`);
}

async function claimRoxasAmumu() {
  try {
    const result = await postApi("/api/pet/free-claim", { account: state.account, petId: 895, initialPetId: state.selected.petId });
    state.ownedPetIds = result.ownedPets || state.ownedPetIds;
    showMenuHint("领取成功：阿木木");
    openStorageMenu();
  } catch (error) {
    showMenuHint(error.message === "already_owned" ? "已经拥有阿木木" : "领取失败");
    openStorageMenu();
  }
}

function claimRoxasRedeemCode() {
  closeMainMenu();
  const panel = $("#redeemPanel");
  $("#redeemInput").value = "";
  $("#redeemMessage").textContent = "";
  panel.classList.add("active");
  decorateMenuFrame(panel);
  panel.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  setTimeout(() => $("#redeemInput").focus(), 0);
}

function closeRedeemPanel() {
  $("#redeemPanel").classList.remove("active");
  $("#redeemMessage").textContent = "";
  openStorageMenu();
}

async function submitRoxasRedeemCode() {
  const code = $("#redeemInput").value.trim();
  if (!code) {
    $("#redeemMessage").textContent = "请输入兑换码";
    return;
  }
  try {
    const result = await postApi("/api/redeem-code/claim", { account: state.account, code });
    await refreshBag();
    $("#redeemPanel").classList.remove("active");
    const rewardText = (result.rewards || []).map((reward) => `${reward.id} +${reward.amount}`).join("，") || "奖励已发放";
    showMenuHint(`兑换成功，${rewardText}`);
    openStorageMenu();
  } catch (error) {
    $("#redeemMessage").textContent = error.message === "already_claimed_today"
      ? "今天已经兑换过"
      : error.message === "already_claimed_once"
        ? "这个兑换码已经兑换过"
        : error.message === "bad_code" ? "兑换码错误" : "兑换失败";
  }
}

async function openStorageDepositMenu() {
  state.menuMode = "storage_deposit";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    state.menuStorageDepositItems = result.items || [];
    const items = state.menuStorageDepositItems.length
      ? state.menuStorageDepositItems.map((item) => ({
        label: bagItemLabel(item),
        labelHtml: luckyItemLabelHtml(item),
        icon: item.icon,
        disabled: item.equipped,
        className: [
          !isLuckyDisplayId(String(item.id || "")) && (isExchangeFragment(item) || isPeerlessItem(item)) ? "rare-fragment" : "",
          item.kind === "equipment" || item.kind === "fashion" ? "long-equipment-text" : ""
        ].filter(Boolean).join(" ")
      }))
      : [{ label: "背包为空", icon: "2.8", disabled: true }];
    setMenuAsSingleList(`存入物品 ${storageUsedSlots(result.storageItems)}/300`, items);
    bindCurrentMenuClicks(confirmStorageDepositMenu);
  } catch {
    setMenuAsSingleList("存入物品", [{ label: "背包读取失败", icon: "2.8", disabled: true }]);
  }
}

async function confirmStorageDepositMenu() {
  const item = state.menuStorageDepositItems?.[state.menuItem];
  if (!item || item.equipped) return;
  const maxQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (maxQuantity > 1 && item.kind !== "equipment" && item.kind !== "fashion") {
    openQuantityPanel({
      title: "存入数量",
      label: `${bagItemLabel(item)}，最多 ${maxQuantity}`,
      maxQuantity,
      initialQuantity: maxQuantity,
      onConfirm: async (quantity) => submitStorageDepositItem(item, quantity),
      onCancel: () => openStorageDepositMenu()
    });
    return;
  }
  await submitStorageDepositItem(item, 1);
}

async function submitStorageDepositItem(item, quantity) {
  try {
    const result = await postApi("/api/storage/deposit", { account: state.account, id: item.id, quantity });
    state.storageItems = result.storageItems || state.storageItems;
    hideQuantityPanel();
    showMenuHint("已存入仓库");
    await openStorageDepositMenu();
  } catch (error) {
    if ($("#giveQuantityPanel")?.classList.contains("active")) {
      $("#giveQuantityMessage").textContent = error.message === "storage_full" ? "仓库已满" : error.message === "equipped_item" ? "已装备物品不能存入" : "存入失败";
      return;
    }
    const text = error.message === "storage_full" ? "仓库已满" : error.message === "equipped_item" ? "已装备物品不能存入" : "存入失败";
    showMenuHint(text);
  }
}

async function openStorageWithdrawMenu() {
  state.menuMode = "storage_withdraw";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    state.menuStorageWithdrawItems = result.storageItems || [];
    const items = state.menuStorageWithdrawItems.length
      ? state.menuStorageWithdrawItems.map((item) => ({
        label: bagItemLabel(item),
        labelHtml: luckyItemLabelHtml(item),
        icon: item.icon,
        className: [
          !isLuckyDisplayId(String(item.id || "")) && (isExchangeFragment(item) || isPeerlessItem(item)) ? "rare-fragment" : "",
          item.kind === "equipment" || item.kind === "fashion" ? "long-equipment-text" : ""
        ].filter(Boolean).join(" ")
      }))
      : [{ label: "仓库为空", icon: "2.8", disabled: true }];
    setMenuAsSingleList(`取出物品 ${storageUsedSlots(result.storageItems)}/300`, items);
    bindCurrentMenuClicks(confirmStorageWithdrawMenu);
  } catch {
    setMenuAsSingleList("取出物品", [{ label: "仓库读取失败", icon: "2.8", disabled: true }]);
  }
}

async function confirmStorageWithdrawMenu() {
  const item = state.menuStorageWithdrawItems?.[state.menuItem];
  if (!item) return;
  const maxQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (maxQuantity > 1 && item.kind !== "equipment" && item.kind !== "fashion") {
    openQuantityPanel({
      title: "取出数量",
      label: `${bagItemLabel(item)}，最多 ${maxQuantity}`,
      maxQuantity,
      initialQuantity: maxQuantity,
      onConfirm: async (quantity) => submitStorageWithdrawItem(item, quantity),
      onCancel: () => openStorageWithdrawMenu()
    });
    return;
  }
  await submitStorageWithdrawItem(item, 1);
}

async function submitStorageWithdrawItem(item, quantity) {
  try {
    const result = await postApi("/api/storage/withdraw", { account: state.account, id: item.id, quantity });
    state.storageItems = result.storageItems || state.storageItems;
    hideQuantityPanel();
    showMenuHint("已取出到背包");
    await openStorageWithdrawMenu();
  } catch (error) {
    if ($("#giveQuantityPanel")?.classList.contains("active")) {
      $("#giveQuantityMessage").textContent = error.message === "bag_full" ? "背包已满" : "取出失败";
      return;
    }
    showMenuHint(error.message === "bag_full" ? "背包已满" : "取出失败");
  }
}

function isExchangeFragment(item) {
  return [
    "peerless_skill_fragment",
    "holy_skill_fragment",
    "peerless_pet_scroll_fragment",
    "peerless_role_skill_fragment",
    "peerless_holy_weapon_fragment",
    "fashion_ticket_fragment",
    "phantom_fragment"
  ].includes(item?.id) || item?.id === "peerless_holy_weapon_ticket" || item?.id === "peerless_role_skill_ticket";
}

function isUntradeableItem(item) {
  return item?.id === "phantom_fragment" || Boolean(window.LuckyBoxModule?.rewards?.some((reward) => reward.id === item?.id));
}

function luckyTextSegments(segments) {
  return `<span class="lucky-item-label">${segments.map(([text, color]) => `<span style="color:${color}">${escapeHtml(text)}</span>`).join("")}</span>`;
}

function luckyChars(text, color) {
  return [...String(text)].map((char) => [char, color]);
}

const RARE_PET_TICKET_COLORS = ["#FFFF00", "#00FF66", "#00FFFF", "#FF3333", "#FFAA00", "#FFFF00", "#FF66CC"];
const PEERLESS_LABEL_COLORS = ["#f2e85c", "#42df7c", "#42dce0", "#ef5960", "#efae46", "#f2e85c", "#dd72b8"];

function rarePetTicketColorText(text) {
  return luckyTextSegments([...String(text)].map((char, index) => [char, RARE_PET_TICKET_COLORS[index % RARE_PET_TICKET_COLORS.length]]));
}

function peerlessColorText(text) {
  return luckyTextSegments([...String(text)].map((char, index) => [
    char,
    PEERLESS_LABEL_COLORS[index % PEERLESS_LABEL_COLORS.length]
  ]));
}

function isLuckyDisplayId(id) {
  return Boolean(window.LuckyBoxModule?.rewards?.some((reward) => reward.id === id))
    || /^(forge_refine_gem|repair_gem|light_forge_gem|elf_forge_gem|iron_pet_belt|silver_pet_belt|common_soul_book|super_soul_book|holy_soul_book|perfect_soul_book|divine_pet_ticket|soul_pet_ticket|holy_pet_ticket|s_holy_pet_ticket|ss_holy_pet_ticket|rare_pet_ticket|flawless_)/.test(id)
    || /^(s_skill_|ss_skill_)/.test(id);
}

function luckyItemLabelHtml(item) {
  const id = String(item?.id || "");
  const name = String(item?.name || "物品");
  if (!isLuckyDisplayId(id)) return escapeHtml(name);
  if (id.startsWith("s_skill_") || id.startsWith("ss_skill_")) {
    const grade = id.startsWith("ss_") ? "SS" : "S";
    const skillName = name.replace(/^S{1,2}圣技[·.]?/, "").replace(/[·.]宠物技能卡$/, "");
    return luckyTextSegments([
      ...luckyChars(grade, "#FFFFFF"),
      ...luckyChars(".", "#FFFFFF"),
      ...luckyChars("圣技.", "#00FFFF"),
      ...luckyChars(skillName, "#FFFF00"),
      ...luckyChars(".宠物技能卡", "#00FF66")
    ]);
  }
  if (["holy_soul_book", "perfect_soul_book"].includes(id)) {
    const label = id === "holy_soul_book" ? "圣品启魂书" : "完美启魂书";
    return luckyTextSegments([...label].map((char, index) => [char, ["#FFFF00", "#00FF66", "#00FFFF", "#FF3333", "#FFAA00"][index]]));
  }
  if (["holy_pet_ticket", "s_holy_pet_ticket", "ss_holy_pet_ticket"].includes(id)) {
    const grade = id.startsWith("ss_") ? "SS" : id.startsWith("s_") ? "S" : "";
    return luckyTextSegments([[grade, "#FFFFFF"], [grade ? "." : "", "#FFFFFF"], ["圣", "#FFFF00"], ["宠", "#00FF66"], ["召", "#00FFFF"], ["唤", "#FF3333"], ["券", "#FFAA00"]]);
  }
  if (id === "rare_pet_ticket") return rarePetTicketColorText("珍奇宠物召唤券");
  return `<span class="lucky-item-label" style="color:${id.startsWith("flawless_") ? "#00FFFF" : ["iron_pet_belt", "silver_pet_belt"].includes(id) ? "#FFFFFF" : "#FFAA00"}">${escapeHtml(name)}</span>`;
}

function isPeerlessItem(item) {
  return String(item?.name || "").includes("绝世") || String(item?.label || "").includes("绝世");
}

const peerlessSkillCards = [
  { id: "skill_card_double_dragon", name: "绝世技能卡：双龙击", skillId: "pet_double_dragon", icon: "1.49" },
  { id: "skill_card_magic_field", name: "绝世技能卡：禁魔立场", skillId: "pet_magic_field", icon: "1.49" },
  { id: "skill_card_eternal_sleep", name: "绝世技能卡：永恒之眠", skillId: "pet_eternal_sleep", icon: "1.49" }
];

const holySkillCards = [
  { id: "skill_card_holy_combo", name: "圣品技能卡：连击", skillId: "holy_combo", icon: "1.49" },
  { id: "skill_card_holy_counter", name: "圣品技能卡：反噬", skillId: "holy_counter", icon: "1.49" },
  { id: "skill_card_holy_rebirth", name: "圣品技能卡：涅磐", skillId: "holy_rebirth", icon: "1.49" },
  { id: "skill_card_holy_break_armor", name: "圣品技能卡：破甲", skillId: "holy_break_armor", icon: "1.49" },
  { id: "skill_card_holy_lifesteal", name: "圣品技能卡：嗜血", skillId: "holy_lifesteal", icon: "1.49" },
  { id: "skill_card_holy_elf_spring", name: "圣品技能卡：精灵温泉", skillId: "holy_elf_spring", icon: "1.49" },
  { id: "skill_card_holy_zeus_field", name: "圣品技能卡：宙斯力场", skillId: "holy_zeus_field", icon: "1.49" },
  { id: "skill_card_holy_king_guard", name: "圣品技能卡：国王守护", skillId: "holy_king_guard", icon: "1.49" },
  { id: "skill_card_holy_elf_guard", name: "圣品技能卡：精灵守护", skillId: "holy_elf_guard", icon: "1.49" },
  { id: "skill_card_holy_guild_guard", name: "圣品技能卡：公会守护", skillId: "holy_guild_guard", icon: "1.49" }
];
mercenaryHolySkillIds = new Set(holySkillCards.map((card) => card.skillId));

function isPeerlessSkillCard(item) {
  return [...peerlessSkillCards, ...holySkillCards].some((card) => card.id === item?.id);
}

function isPeerlessRoleSkillCard(item) {
  return peerlessRoleSkillCards.some((card) => card.id === item?.id);
}

function isMercenarySkillCard(item) {
  return holySkillCards.some((card) => card.id === item?.id);
}

function sellPriceForItem(item) {
  if (item.kind === "equipment") {
    const forgeLevel = Math.max(0, Number(item.forgeLevel) || 0);
    const affixCount = Array.isArray(item.affixes) ? item.affixes.length : 0;
    return Math.max(100, Math.round(400 + forgeLevel * 180 + affixCount * 80));
  }
  if (item.id === "forge_gem") return 120;
  if (item.id === "soul_powder") return 20;
  if (item.id === "lucky_box") return 5000;
  if (item.id === "fashion_ticket") return 1000;
  if (item.id === "peerless_holy_weapon_ticket") return 1000;
  if (item.id === "mysterious_paint") return 1000;
  if ([
    "peerless_skill_fragment",
    "holy_skill_fragment",
    "peerless_pet_scroll_fragment",
    "peerless_role_skill_fragment",
    "peerless_holy_weapon_fragment",
    "fashion_ticket_fragment",
    "phantom_fragment"
  ].includes(item?.id)) return 1;
  return 10;
}

function openQuickShopMenu() {
  state.menuMode = "quick_shop";
  state.menuItem = 0;
  setMenuAsSingleList("快速购物", [
    { label: "卖出背包物品", icon: "1.16" },
    { label: "一键卖出所有装备", icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmQuickShopMenu);
}

function yuanbaoRewardColor(item) {
  if (item.value >= 1000) return "#ff66ff";
  if (item.value >= 300) return "#00ffff";
  if (item.value >= 100) return "#66ccff";
  if (item.value >= 40) return "#ffcc66";
  return "#ffaa00";
}

async function openYuanbaoShopMenu() {
  state.menuMode = "yuanbao_shop";
  state.menuItem = 0;
  try {
    const result = await apiGet(`/api/yuanbao-shop/catalog?account=${encodeURIComponent(state.account)}`);
    state.menuYuanbaoItems = result.items || [];
    state.yuanbao = Number(result.balance) || state.yuanbao || 0;
    const items = state.menuYuanbaoItems.map((item) => ({
      label: `${item.name}（${item.price}元宝）`,
      labelHtml: `${luckyItemLabelHtml(item)}<small> 价格${item.price}元宝</small>`,
      icon: item.icon || "1.11",
      disabled: !item.purchasable
    }));
    setMenuAsSingleList(`元宝道具（余额 ${state.yuanbao}）`, items.length ? items : [{ label: "暂无商品", icon: "2.4", disabled: true }]);
    bindCurrentMenuClicks(confirmYuanbaoShopMenu);
  } catch {
    setMenuAsSingleList("元宝道具", [{ label: "商城读取失败", icon: "2.4", disabled: true }]);
  }
}

function confirmYuanbaoShopMenu() {
  const item = state.menuYuanbaoItems?.[state.menuItem];
  if (!item || !item.purchasable) return;
  openQuantityPanel({
    title: "购买数量",
    label: `${item.name}，单价${item.price}元宝，余额 ${state.yuanbao}`,
    maxQuantity: Math.max(1, Math.floor((state.yuanbao || 0) / item.price)),
    initialQuantity: 1,
    confirmText: "购买",
    onCancel: openYuanbaoShopMenu,
    onConfirm: (quantity) => buyYuanbaoShopItem(item, quantity)
  });
}

async function buyYuanbaoShopItem(item, quantity) {
  try {
    const result = await postApi("/api/yuanbao-shop/buy", { account: state.account, itemId: item.id, quantity });
    state.yuanbao = Number(result.yuanbao) || 0;
    hideQuantityPanel();
    await refreshBag();
    showMenuHint(`购买成功：${item.name} x${quantity}，元宝 ${state.yuanbao}`);
    openYuanbaoShopMenu();
  } catch (error) {
    const text = error.message === "not_enough_yuanbao" ? "元宝不足" : "购买失败";
    if ($("#giveQuantityPanel")?.classList.contains("active")) $("#giveQuantityMessage").textContent = text;
    else showMenuHint(text);
  }
}

function confirmQuickShopMenu() {
  if (state.menuItem === 0) {
    openQuickShopSellItemMenu();
    return;
  }
  if (state.menuItem === 1) sellAllUnequippedEquipment();
}

async function openQuickShopSellItemMenu() {
  state.menuMode = "quick_shop_sell_items";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    state.menuSellItems = (result.items || []).filter((item) => item.kind !== "fashion" && item.type !== "fashion");
    const items = state.menuSellItems.length
      ? state.menuSellItems.map((item) => ({
        label: `${bagItemLabel(item)}  售价${sellPriceForItem(item)}银币`,
        icon: item.icon,
        disabled: item.equipped,
        className: isExchangeFragment(item) ? "rare-fragment" : "",
        longText: item.kind === "equipment"
      }))
      : [{ label: "背包为空", icon: "2.8", disabled: true }];
    setMenuAsSingleList("卖出背包物品", items);
    bindCurrentMenuClicks(confirmQuickShopSellItemMenu);
  } catch {
    setMenuAsSingleList("卖出背包物品", [{ label: "背包读取失败", icon: "2.8", disabled: true }]);
  }
}

async function confirmQuickShopSellItemMenu() {
  const item = state.menuSellItems?.[state.menuItem];
  if (!item || item.equipped) return;
  const maxQuantity = item.kind === "equipment" ? 1 : Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (maxQuantity > 1) {
    openQuantityPanel({
      title: "卖出数量",
      label: `${bagItemLabel(item)}，单价${sellPriceForItem(item)}银币，最多 ${maxQuantity}`,
      maxQuantity,
      initialQuantity: maxQuantity,
      confirmText: "卖出",
      onCancel: openQuickShopSellItemMenu,
      onConfirm: async (quantity) => sellQuickShopItem(item, quantity)
    });
    return;
  }
  await sellQuickShopItem(item, 1);
}

async function sellQuickShopItem(item, quantity) {
  try {
    const result = await postApi("/api/shop/sell", { account: state.account, id: item.id, quantity });
    hideQuantityPanel();
    showMenuHint(`卖出成功，银币 +${result.silverGain}，当前 ${result.silver}`);
    await openQuickShopSellItemMenu();
  } catch (error) {
    const text = error.message === "equipped_item" ? "已装备物品不能卖出" : "卖出失败";
    if ($("#giveQuantityPanel")?.classList.contains("active")) $("#giveQuantityMessage").textContent = text;
    else showMenuHint(text);
  }
}

async function sellAllUnequippedEquipment() {
  try {
    const result = await postApi("/api/shop/sell-all-equipment", { account: state.account });
    showMenuHint(`卖出${result.soldCount}件装备，银币 +${result.silverGain}，当前 ${result.silver}`);
    await refreshBag();
    openQuickShopMenu();
  } catch {
    showMenuHint("一键卖出失败");
  }
}

function confirmBagMenu() {
  const item = state.bag.items[state.menuItem];
  if (!item) return;
  openBagItemActionMenu(item);
}

function openBagItemActionMenu(item) {
  state.menuMode = "bag_item_actions";
  state.menuBagItem = item;
  state.menuItem = 0;
  const actions = [{ key: "view_info", label: "查看信息", icon: item.icon || "2.8" }];
  if (item.id === "peerless_skill_fragment") actions.push({ key: "exchange_skill_fragment", label: "9999碎片兑换绝世技能兑换券", icon: "1.49", disabled: (item.quantity || 0) < 9999 });
  if (item.id === "holy_skill_fragment") actions.push({ key: "exchange_holy_skill_fragment", label: "9999碎片兑换圣品技能兑换券", icon: "1.49", disabled: (item.quantity || 0) < 9999 });
  if (item.id === "peerless_role_skill_fragment") actions.push({ key: "exchange_role_skill_fragment", label: "9999碎片兑换绝世人物技能兑换券", icon: "1.49", disabled: (item.quantity || 0) < 9999 });
  if (item.id === "peerless_pet_scroll_fragment") actions.push({ key: "exchange_pet_scroll_fragment", label: "9999碎片兑换绝世宠物召唤券", icon: "2.12", disabled: (item.quantity || 0) < 9999 });
  if (item.id === "peerless_holy_weapon_fragment") actions.push({ key: "exchange_holy_weapon_fragment", label: "9999碎片兑换绝世圣武兑换券", icon: "1.3", disabled: (item.quantity || 0) < 9999 });
  if (item.id === "fashion_ticket_fragment") actions.push({ key: "exchange_fashion_fragment", label: "9999碎片兑换时装兑换券", icon: "2.10", disabled: (item.quantity || 0) < 9999 });
  if (item.id === "fashion_ticket") actions.push({ key: "exchange_fashion_ticket", label: "兑换时装", icon: "2.10" });
  if (item.id === "peerless_holy_weapon_ticket") actions.push({ key: "exchange_holy_weapon_ticket", label: "兑换魔尊武器", icon: "1.49" });
  if (item.id === "peerless_skill_ticket") actions.push({ key: "exchange_skill_ticket", label: "兑换绝世技能卡", icon: "1.49" });
  if (item.id === "peerless_role_skill_ticket") actions.push({ key: "exchange_role_skill_ticket", label: "兑换绝世人物技能卡", icon: "1.49" });
  if (item.id === "holy_skill_ticket") actions.push({ key: "exchange_holy_skill_ticket", label: "兑换圣品技能卡", icon: "1.49" });
  if (item.id === "peerless_pet_scroll_ticket") actions.push({ key: "use_pet_scroll_ticket", label: "召唤绝世宠物", icon: "2.12" });
  if (isPeerlessSkillCard(item)) actions.push({ key: "learn_pet_skill", label: "让宠物学习技能", icon: "2.12" });
  if (isPeerlessRoleSkillCard(item)) actions.push({ key: "learn_role_skill", label: "学习人物技能", icon: "1.49" });
  if (isMercenarySkillCard(item)) actions.push({ key: "learn_mercenary_skill", label: "让佣兵学习技能", icon: "1.9", disabled: !(state.mercenaries || []).length });
  if (item.id === "forge_gem") actions.push({ key: "forge", label: "强化装备", icon: "1.13" });
  if (item.id === "lucky_box") actions.push({ key: "open_lucky_box", label: "开启好运宝箱", icon: "1.11" });
  if (item.kind === "equipment") {
    actions.push(item.equipped
      ? { key: "unequip", label: "卸下装备", icon: item.icon || "2.18" }
      : { key: "equip", label: "装配装备", icon: item.icon || "2.18" });
  }
  if (item.kind === "fashion") {
    actions.push(item.equipped
      ? { key: "unequip", label: "卸下时装", icon: item.icon || "2.10" }
      : { key: "equip", label: "装备时装", icon: item.icon || "2.10" });
  }
  actions.push({ key: "chat_show", label: "聊天秀出", icon: item.icon || "2.7" });
  actions.push({ key: "give", label: "给附近的人", icon: "1.42", disabled: item.equipped || isUntradeableItem(item) });
  actions.push({ key: "discard", label: "丢弃", icon: "1.13", disabled: item.equipped });
  state.menuBagActions = actions;
  setMenuAsSingleList(item.name || "物品", actions);
  bindCurrentMenuClicks(confirmBagItemActionMenu);
}

function confirmBagItemActionMenu() {
  const item = state.menuBagItem;
  const action = state.menuBagActions?.[state.menuItem];
  if (!item || !action || action.disabled) return;
  if (action.key === "view_info") {
    openItemInfoDialog(item);
    return;
  }
  if (action.key === "forge") {
    openForgeEquipmentMenu();
    return;
  }
  if (action.key === "open_lucky_box") {
    openLuckyBox();
    return;
  }
  if (action.key === "equip") {
    equipEquipment(item.id);
    return;
  }
  if (action.key === "unequip") {
    unequipEquipment({ id: item.id });
    return;
  }
  if (action.key === "give") {
    openBagGiveTargetMenu(item);
    return;
  }
  if (action.key === "exchange_skill_fragment") {
    exchangeSkillFragment("peerless");
    return;
  }
  if (action.key === "exchange_holy_skill_fragment") {
    exchangeSkillFragment("holy");
    return;
  }
  if (action.key === "exchange_role_skill_fragment") {
    exchangeSkillFragment("role");
    return;
  }
  if (action.key === "exchange_pet_scroll_fragment") {
    exchangePetScrollFragment();
    return;
  }
  if (action.key === "exchange_holy_weapon_fragment") {
    exchangeHolyWeaponFragment();
    return;
  }
  if (action.key === "exchange_fashion_fragment") {
    exchangeFashionFragment();
    return;
  }
  if (action.key === "exchange_holy_weapon_ticket") {
    openHolyWeaponExchangeMenu();
    return;
  }
  if (action.key === "exchange_fashion_ticket") {
    openFashionTicketExchangeMenu();
    return;
  }
  if (action.key === "exchange_skill_ticket") {
    openSkillTicketExchangeMenu("peerless");
    return;
  }
  if (action.key === "exchange_holy_skill_ticket") {
    openSkillTicketExchangeMenu("holy");
    return;
  }
  if (action.key === "exchange_role_skill_ticket") {
    openSkillTicketExchangeMenu("role");
    return;
  }
  if (action.key === "learn_pet_skill") {
    openSkillCardPetMenu(item);
    return;
  }
  if (action.key === "learn_role_skill") {
    learnRoleSkill(item);
    return;
  }
  if (action.key === "learn_mercenary_skill") {
    openMercenaryCardTargetMenu(item);
    return;
  }
  if (action.key === "use_pet_scroll_ticket") {
    openPeerlessPetSummonMenu();
    return;
  }
  if (action.key === "chat_show") {
    openChatShowItem(item);
    return;
  }
  if (action.key === "discard") discardBagItem(item);
}

function itemInfoKindLabel(item) {
  if (item.kind === "equipment") return "装备";
  if (item.kind === "fashion") return "时装";
  if (String(item.id || "").includes("fragment")) return "兑换碎片";
  if (String(item.id || "").includes("ticket")) return "兑换券";
  if (String(item.id || "").includes("card")) return "技能卡";
  return "道具";
}

function itemInfoDescription(item) {
  const supplied = item.description || item.desc || item.detail || item.info;
  if (supplied) return String(supplied);
  if (item.kind === "equipment") return `${formatEquipment(item)}。可在个人状态的装备菜单中装配或强化。`;
  if (item.kind === "fashion") return `${item.name || "时装"}，装备后提供全属性加成。`;
  if (item.id === "forge_gem") return "装备强化所需材料，可用于提升装备的强化等级。";
  if (item.id === "lucky_box") return "开启后可随机获得游戏道具与稀有奖励。";
  if (String(item.id || "").includes("fragment")) return "收集足够数量后，可在对应兑换功能中合成为完整道具。";
  if (String(item.id || "").includes("ticket")) return "可在对应兑换或召唤功能中使用。";
  return "游戏物品，可通过物品操作菜单使用、展示或处理。";
}

function openItemInfoDialog(item) {
  const menuContextTitle = state.menuContextTitle;
  const icon = item.icon || (item.kind === "equipment" ? equipmentForgeStats[item.type]?.icon : "") || "2.8";
  const quantity = Math.max(1, Number(item.quantity) || 1);
  const status = item.equipped ? "已装备" : isUntradeableItem(item) ? "不可交易" : "可使用";
  const detail = item.kind === "equipment" ? formatEquipment(item) : item.kind === "fashion" ? `${item.name || "时装"} 属性+30%` : item.name || "物品";
  showInfoDialog({
    title: "物品信息",
    html: `
      <div class="battle-reward-row">
        ${menuIconHtml(icon)}<span class="info-dialog-item-name">${escapeHtml(item.name || "物品")}</span><small>x${quantity}</small>
      </div>
      <div class="battle-reward-row">
        ${menuIconHtml("2.10")}<span>类型：${escapeHtml(itemInfoKindLabel(item))}</span><small>${escapeHtml(status)}</small>
      </div>
      <div class="battle-reward-row">
        ${menuIconHtml(icon)}<span>${escapeHtml(detail)}</span><small>${item.forgeLevel != null ? `强化 ${Number(item.forgeLevel) || 0}` : "详情"}</small>
      </div>
      <div class="info-dialog-item-description">${escapeHtml(itemInfoDescription(item))}</div>
    `,
    onClose: () => {
      state.menuContextTitle = menuContextTitle;
      openBagItemActionMenu(item);
    }
  });
}

function chatItemToken(item) {
  const icon = item.icon || (item.kind === "equipment" ? equipmentForgeStats[item.type]?.icon : "") || "2.8";
  const kind = item.kind === "equipment" ? "equipment" : "item";
  const name = item.kind === "equipment" ? formatEquipment(item) : `${item.name || "物品"}${item.quantity ? ` x${item.quantity}` : ""}`;
  return `[item:${encodeURIComponent(icon)}:${kind}:${encodeURIComponent(name)}]`;
}

function openChatShowItem(item) {
  closeMainMenu();
  const input = $("#chatInput");
  input.value = `秀出 ${chatItemToken(item)} `;
  input.placeholder = "可以继续输入文字或添加表情";
  $("#chatForm").classList.add("active");
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
}

function luckyBoxRollItems(finalReward = null) {
  const samples = (window.LuckyBoxModule?.rewards || []).map((item) => ({ ...item }));
  // This is visual-only data. Never use it to calculate or overwrite the server result.
  const fallback = [
    { name: "精炼宝石", id: "forge_refine_gem", icon: "lucky:1:13" },
    { name: "修复宝石", id: "repair_gem", icon: "lucky:1:13" },
    { name: "三属性附魔石", id: "three_attribute_enchant_gem", icon: "lucky:1:13", quantity: 99 },
    { name: "单项重置附魔石", id: "single_recast_enchant_gem", icon: "lucky:1:13", quantity: 10 },
    { name: "铁质宠物腰带", id: "iron_pet_belt", icon: "lucky:1:19" },
    { name: "普通启魂书", id: "common_soul_book", icon: "lucky:1:last" },
    { name: "神宠召唤券", id: "divine_pet_ticket", icon: "lucky:2:6" },
    { name: "圣品启魂书", id: "holy_soul_book", icon: "lucky:1:last" },
    { name: "无瑕的极致蓝宝石·物理", id: "flawless_blue_anti_physical", icon: "lucky:2:14" },
    { name: "SS圣宠召唤券", id: "ss_holy_pet_ticket", icon: "lucky:2:6" }
  ];
  const visualPool = samples.length ? samples : fallback;
  const normalizeRewardText = (value) => String(value || "").replace(/\s+/g, "").trim();
  const finalId = normalizeRewardText(finalReward?.id);
  const finalName = normalizeRewardText(finalReward?.name);
  const finalIcon = normalizeRewardText(finalReward?.icon);
  const isFinalReward = (item) => {
    const itemId = normalizeRewardText(item?.id);
    const itemName = normalizeRewardText(item?.name);
    const itemIcon = normalizeRewardText(item?.icon);
    return (finalId && itemId === finalId)
      || (finalName && itemName === finalName)
      || (finalName && itemName.includes(finalName))
      || (finalIcon && itemIcon === finalIcon && finalName && itemName === finalName);
  };
  const decoyPool = visualPool.filter((item) => !isFinalReward(item));
  const pool = decoyPool.length ? decoyPool : [{ name: "抽奖物品", icon: "1.11", id: "visual_placeholder" }];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const items = Array.from({ length: Math.max(30, pool.length * 2) }, (_, index) => ({
    ...(shuffled[index % shuffled.length])
  }));
  const ranked = [...pool].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const highValuePool = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2)));
  const previewReward = { ...(sample(highValuePool) || visualPool[0]), preview: true };
  const previewIndex = items.length;
  items.push(previewReward);
  if (finalReward) items.push({
    ...finalReward,
    labelHtml: luckyItemLabelHtml(finalReward),
    final: true
  });
  return { items, previewIndex, finalIndex: finalReward ? items.length - 1 : null };
}

function luckyBoxQuantitySuffix(item) {
  const id = String(item?.id || "");
  const name = String(item?.name || "");
  if (id === "three_attribute_enchant_gem" || name === "三属性附魔石") return "*99";
  if (id === "single_recast_enchant_gem" || name === "单项重置附魔石") return "*10";
  const quantity = Number(item?.quantity) || 0;
  return quantity > 1 ? `*${quantity}` : "";
}

function renderLuckyBoxRollWindow(items, centerIndex, reward = null, done = false) {
  const visible = [-1, 0, 1].map((offset) => {
    if (done && offset === 0 && reward) {
      return { name: reward.name, labelHtml: luckyItemLabelHtml(reward), icon: reward.icon || "1.11", quantity: reward.quantity, final: true };
    }
    return items[(centerIndex + offset + items.length) % items.length];
  });
  const overlay = $("#luckyBoxOverlay");
  const dialog = overlay?.querySelector(".lucky-box-dialog");
  const rewardRows = $("#luckyBoxRewardRows");
  const actions = $("#luckyBoxActions");
  if (!overlay || !dialog || !rewardRows || !actions) return;
  if (done && state.luckyBoxRoll.confirmOpen) overlay.appendChild(actions);
  else dialog.appendChild(actions);
  rewardRows.innerHTML = visible.map((item, index) => `
    <div class="lucky-box-reward-row ${index === 1 ? "is-target" : ""}">
      ${menuIconHtml(item.icon || "1.11")}<span>${item.labelHtml || luckyItemLabelHtml(item)}${luckyBoxQuantitySuffix(item)}</span>
    </div>
  `).join("");
  if (!done) {
    actions.classList.remove("is-confirming");
    actions.innerHTML = `<div class="lucky-box-action-hint">滚动中…</div>`;
  } else if (state.luckyBoxRoll.confirmOpen) {
    actions.classList.add("is-confirming");
    actions.innerHTML = `<div class="lucky-box-confirm-actions"><button type="button" class="lucky-box-action ${state.menuItem === 0 ? "is-selected" : ""}" data-choice="continue">继续抽奖</button><button type="button" class="lucky-box-action ${state.menuItem === 1 ? "is-selected" : ""}" data-choice="back">返回</button></div>`;
    actions.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", () => {
      state.menuItem = button.dataset.choice === "back" ? 1 : 0;
      confirmLuckyBoxRollMenu();
    }));
  } else {
    actions.classList.remove("is-confirming");
    actions.innerHTML = `<button type="button" class="lucky-box-continue" ${state.luckyBoxRoll.remaining > 0 ? "" : "disabled"}><span>按 5 键继续</span><canvas class="lucky-box-next-chj" width="20" height="28" aria-hidden="true"></canvas></button>`;
    actions.querySelector(".lucky-box-continue")?.addEventListener("click", () => {
      if (state.luckyBoxRoll.remaining <= 0) return;
      state.luckyBoxRoll.confirmOpen = true;
      state.menuItem = 0;
      renderLuckyBoxRollWindow(items, centerIndex, reward, true);
    });
  }
  [overlay.querySelector(".lucky-box-title"), overlay.querySelector(".lucky-box-rewards")].forEach((frame) => {
    stripMenuFrame(frame);
    decorateMenuFrame(frame);
  });
  stripMenuFrame(actions);
  if (!done) decorateMenuFrame(actions);
  else actions.querySelectorAll(".lucky-box-continue, .lucky-box-action").forEach((button) => {
    stripMenuFrame(button);
    decorateMenuFrame(button);
  });
  actions.querySelectorAll(".lucky-box-action").forEach((button) => {
    stripMenuFrame(button);
    decorateMenuFrame(button);
  });
  overlay.classList.add("is-visible");
  overlay.setAttribute("aria-hidden", "false");
  if (done && !state.luckyBoxRoll.confirmOpen) startLuckyBoxContinueAnimation();
}

let luckyBoxContinueAnimationFrame = 0;
async function startLuckyBoxContinueAnimation() {
  if (luckyBoxContinueAnimationFrame) cancelAnimationFrame(luckyBoxContinueAnimationFrame);
  const canvas = $("#luckyBoxOverlay .lucky-box-next-chj");
  if (!canvas) return;
  try {
    const sprite = await loadSprite(15);
    const ctx = canvas.getContext("2d");
    const frames = (sprite.animations[0] || [0]).filter((frame) => frame !== 255 && frame != null);
    const draw = (now) => {
      if (!canvas.isConnected) return;
      const raw = frames[Math.floor(now / 220) % Math.max(1, frames.length)] ?? 0;
      const frame = { index: raw >= 128 ? raw - 128 : raw, flip: raw >= 128 };
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawSpriteFrame(ctx, sprite, frame, 2, canvas.height - sprite.frameHeight, sprite.frameWidth, sprite.frameHeight);
      luckyBoxContinueAnimationFrame = requestAnimationFrame(draw);
    };
    luckyBoxContinueAnimationFrame = requestAnimationFrame(draw);
  } catch (error) {
    console.warn("好运宝箱继续按钮 CHJ 15 加载失败", error);
  }
}

function showLuckyBoxRoll(reward) {
  state.menuMode = "lucky_box_roll";
  state.menuItem = 0;
  state.menuOpen = true;
  state.luckyBoxRoll.rolling = true;
  state.luckyBoxRoll.done = false;
  state.luckyBoxRoll.confirmOpen = false;
  const menu = $("#mainMenu");
  menu.classList.remove("active", "lucky-box-roll");
  const rollPlan = luckyBoxRollItems(reward);
  const rollItems = rollPlan.items;
  let index = 0;
  let step = 0;
  renderLuckyBoxRollWindow(rollItems, index);

  const advance = () => {
    if (index >= rollPlan.finalIndex) {
      state.luckyBoxRoll.rolling = false;
      state.luckyBoxRoll.done = true;
      renderLuckyBoxRollWindow(rollItems, rollPlan.finalIndex, reward, true);
      showMenuHint(`中了：${reward.name}${reward.quantity ? ` x${reward.quantity}` : ""}`);
      return;
    }
    renderLuckyBoxRollWindow(rollItems, index);
    index += 1;
    step += 1;
    const isPreview = index === rollPlan.previewIndex;
    const remaining = rollPlan.finalIndex - index;
    // Fast at the start, then ease into a visible high-value preview pause.
    const delay = isPreview
      ? 760
      : remaining <= 1
        ? 420
        : remaining <= 3
          ? 280
          : remaining <= 7
            ? 170
            : step < 9
              ? 34
              : Math.min(130, 58 + (step - 9) * 5);
    setTimeout(advance, delay);
  };
  setTimeout(advance, 48);
}

async function openLuckyBox() {
  if (state.luckyBoxRoll.rolling) return;
  try {
    const result = await postApi("/api/lucky-box/open", { account: state.account });
    await refreshBag();
    state.luckyBoxRoll.remaining = state.bag.items.find((item) => item.id === "lucky_box")?.quantity || 0;
    showLuckyBoxRoll(result.reward);
  } catch (error) {
    showMenuHint(error.message === "not_enough_box" ? "好运宝箱不足" : error.message === "bag_full" ? "背包装备已满" : "开启失败");
    if (state.menuMode === "lucky_box_roll") openBagMenu();
  }
}

function confirmLuckyBoxRollMenu() {
  if (state.luckyBoxRoll.rolling) return true;
  if (!state.luckyBoxRoll.done) return true;
  if (state.luckyBoxRoll.confirmOpen) {
    if (state.menuItem === 1) {
      backLuckyBoxRollMenu();
    } else {
      state.luckyBoxRoll.confirmOpen = false;
      openLuckyBox();
    }
    return true;
  }
  if ((state.luckyBoxRoll.remaining || 0) <= 0) {
    openBagMenu();
    return true;
  }
  openLuckyBox();
  return true;
}

function backLuckyBoxRollMenu() {
  if (state.luckyBoxRoll.rolling) return true;
  state.luckyBoxRoll.confirmOpen = false;
  $("#luckyBoxOverlay")?.classList.remove("is-visible");
  $("#luckyBoxOverlay")?.setAttribute("aria-hidden", "true");
  openBagMenu();
  return true;
}

async function refreshPhantomStatus() {
  const result = await apiGet(`/api/phantom/status?account=${encodeURIComponent(state.account)}`);
  if (result.ok) {
    state.phantom = {
      points: result.points || 0,
      fragment: result.fragment || 0,
      equippedTitle: result.equippedTitle || state.phantom?.equippedTitle || "",
      claimedTitles: result.claimedTitles || state.phantom?.claimedTitles || [],
      claimedTitleEntries: result.claimedTitleEntries || state.phantom?.claimedTitleEntries || [],
      myRank: result.myRank || 0,
      rankings: result.rankings || []
    };
  }
  return result;
}

async function openPhantomNpcMenu() {
  state.menuMode = "phantom_npc";
  state.menuItem = 0;
  try {
    const result = await refreshPhantomStatus();
    setMenuAsSingleList("幻影管理员", [
      { label: `我的积分 ${result.points || 0} / 排名 ${result.myRank || "未上榜"}`, icon: "1.49", disabled: true },
      { label: `提交幻影碎片（当前${result.fragment || 0}）`, icon: "1.49", disabled: !(result.fragment > 0) },
      { label: "查看排行榜", icon: "1.49" },
      { label: "领取称号", icon: "1.49", disabled: !(result.myRank >= 1 && result.myRank <= 50) },
      { label: "离开", icon: "1.13" }
    ]);
    bindCurrentMenuClicks(confirmPhantomNpcMenu);
  } catch {
    setMenuAsSingleList("幻影管理员", [{ label: "幻影积分读取失败", icon: "1.49", disabled: true }]);
  }
}

async function confirmPhantomNpcMenu() {
  if (state.menuItem === 1) {
    await submitPhantomFragments();
    return;
  }
  if (state.menuItem === 2) {
    openPhantomRankingMenu();
    return;
  }
  if (state.menuItem === 3) {
    await claimPhantomTitle();
    return;
  }
  if (state.menuItem === 4) closeMainMenu();
}

function openPhantomRankingMenu() {
  state.menuMode = "phantom_rankings";
  const rankings = state.phantom?.rankings || [];
  const items = rankings.length
    ? rankings.map((entry) => ({
      label: `第${entry.rank}名 ${entry.name} ${entry.points}分 / ${entry.title} 全属性+${Math.round((entry.boost || 0) * 100)}%`,
      icon: "1.49"
    }))
    : [{ label: "暂无排行", icon: "1.49", disabled: true }];
  setMenuAsSingleList("幻影积分榜", items);
  bindCurrentMenuClicks(() => openPhantomNpcMenu());
}

async function submitPhantomFragments() {
  try {
    const result = await postApi("/api/phantom/submit", { account: state.account, quantity: state.phantom?.fragment || 0 });
    state.phantom.points = result.points || state.phantom.points;
    state.phantom.fragment = result.fragment || 0;
    state.phantom.rankings = result.rankings || state.phantom.rankings || [];
    await refreshBag();
    showMenuHint(`提交成功，幻影积分 ${state.phantom.points}`);
    openPhantomNpcMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_fragment" ? "幻影碎片不足" : "提交失败");
  }
}

async function claimPhantomTitle() {
  try {
    const result = await postApi("/api/phantom/claim-title", { account: state.account });
    state.phantom.claimedTitles = result.claimedTitles || state.phantom.claimedTitles || [];
    state.phantom.claimedTitleEntries = result.claimedTitleEntries || state.phantom.claimedTitleEntries || [];
    showMenuHint(`领取成功：${result.title}`);
    openPhantomNpcMenu();
  } catch (error) {
    showMenuHint(error.message === "not_ranked" ? "前50名才能领取称号" : "领取失败");
  }
}

async function exchangeSkillFragment(kind = "peerless") {
  try {
    const result = await postApi("/api/skill/fragment-exchange", { account: state.account, kind });
    const ticketName = kind === "holy" ? "圣品技能兑换券" : kind === "role" ? "绝世人物技能兑换券" : "绝世技能兑换券";
    showMenuHint(`兑换成功，${ticketName} ${result.ticket}`);
    await refreshBag();
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_fragment" ? "碎片不足9999" : "兑换失败");
  }
}

async function exchangePetScrollFragment() {
  try {
    const result = await postApi("/api/pet-scroll/fragment-exchange", { account: state.account });
    showMenuHint(`兑换成功，绝世宠物召唤券 ${result.ticket}`);
    await refreshBag();
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_fragment" ? "碎片不足9999" : "兑换失败");
  }
}

async function exchangeHolyWeaponFragment() {
  try {
    const result = await postApi("/api/holy-weapon/fragment-exchange", { account: state.account });
    showMenuHint(`兑换成功，绝世圣武兑换券 ${result.ticket}`);
    await refreshBag();
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_fragment" ? "碎片不足9999" : "兑换失败");
  }
}

async function exchangeFashionFragment() {
  try {
    const result = await postApi("/api/fashion/fragment-exchange", { account: state.account });
    showMenuHint(`兑换成功，时装兑换券 ${result.ticket}`);
    await refreshBag();
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_fragment" ? "碎片不足9999" : "兑换失败");
  }
}

function openHolyWeaponExchangeMenu() {
  state.menuMode = "holy_weapon_exchange";
  state.menuItem = 0;
  state.menuHolyWeaponList = demonWeaponCatalog;
  const items = demonWeaponCatalog.map((weapon) => ({
    label: `${weapon.name} +15（${Object.entries(weapon.stats).map(([stat, value]) => `${statLabel(stat)}+${value}`).join(" / ")}）`,
    icon: weapon.icon,
    className: "rare-fragment"
  }));
  setMenuAsSingleList("兑换魔尊武器", items);
  bindCurrentMenuClicks(confirmHolyWeaponExchangeMenu);
}

async function confirmHolyWeaponExchangeMenu() {
  const weapon = state.menuHolyWeaponList?.[state.menuItem];
  if (!weapon) return;
  try {
    await postApi("/api/holy-weapon/ticket-exchange", { account: state.account, weaponType: weapon.id });
    showMenuHint(`兑换成功，${weapon.name} +15`);
    await refreshBag();
    openBagMenu();
  } catch (error) {
    const text = error.message === "not_enough_ticket"
      ? "绝世圣武兑换券不足"
      : error.message === "bag_full"
        ? "背包已满"
        : "兑换失败";
    showMenuHint(text);
  }
}

function openFashionTicketExchangeMenu() {
  state.menuMode = "fashion_ticket_exchange";
  state.menuItem = 0;
  state.menuFashionList = fashionForGender();
  const items = state.menuFashionList.map((fashion) => ({
    label: fashion.name,
    icon: fashion.icon,
    className: isPeerlessItem(fashion) ? "rare-fragment" : "",
    hideIndex: true
  }));
  setMenuAsSingleList("兑换时装", items);
  bindCurrentMenuClicks(confirmFashionTicketExchangeMenu);
  previewSelectedFashion();
}

async function previewSelectedFashion() {
  const fashion = state.menuFashionList?.[state.menuItem];
  if (!fashion) return;
  await loadSpriteOptional(fashion.spriteId);
  if (state.player) {
    state.player.spriteId = fashion.spriteId;
    broadcastState(true);
  }
  showMenuHint(`预览：${fashion.name}，兑换后属性增幅30%`);
}

async function confirmFashionTicketExchangeMenu() {
  const fashion = state.menuFashionList?.[state.menuItem];
  if (!fashion) return;
  try {
    const result = await postApi("/api/fashion/ticket-exchange", { account: state.account, fashionId: fashion.id, gender: state.selected.gender });
    await refreshBag();
    const item = state.bag.items.find((entry) => entry.id === result.fashion?.id);
    if (item) await equipEquipment(item.id, "fashion");
    showMenuHint(`已兑换${fashion.name}`);
    openBagMenu();
  } catch (error) {
    applyActiveFashionSprite();
    const text = error.message === "not_enough_ticket"
      ? "时装兑换券不足"
      : error.message === "gender_mismatch"
        ? "性别不符"
        : error.message === "bag_full" ? "背包已满" : "兑换失败";
    showMenuHint(text);
  }
}

function peerlessSummonPets() {
  return petCatalog.filter((pet) => peerlessPetIds.has(pet.id));
}

function openPeerlessPetSummonMenu() {
  state.menuMode = "peerless_pet_summon";
  state.menuItem = 0;
  const owned = new Set((state.ownedPetIds || []).map(Number));
  state.menuPetList = peerlessSummonPets();
  const items = state.menuPetList.map((pet) => ({
    label: `${owned.has(pet.id) ? "[已拥有] " : ""}${pet.name}`,
    icon: "2.12",
    disabled: owned.has(pet.id)
  }));
  setMenuAsSingleList("绝世宠物召唤", items);
  bindCurrentMenuClicks(confirmPeerlessPetSummonMenu);
}

async function confirmPeerlessPetSummonMenu() {
  const pet = state.menuPetList?.[state.menuItem];
  if (!pet || (state.ownedPetIds || []).map(Number).includes(pet.id)) return;
  try {
    const result = await postApi("/api/pet-scroll/summon", { account: state.account, petId: pet.id, initialPetId: state.selected.petId });
    state.ownedPetIds = result.ownedPets || state.ownedPetIds;
    await loadSpriteOptional(pet.id);
    await refreshBag();
    showMenuHint(`召唤成功：${pet.name}`);
    openBagMenu();
  } catch (error) {
    const message = error.message === "not_enough_ticket"
      ? "绝世宠物召唤券不足"
      : error.message === "already_owned"
        ? "已经拥有该宠物"
        : "召唤失败";
    showMenuHint(message);
  }
}

function openSkillTicketExchangeMenu(kind = "peerless") {
  state.menuMode = "skill_ticket_exchange";
  state.menuItem = 0;
  state.menuSkillTicketKind = kind;
  const cards = kind === "holy" ? holySkillCards : kind === "role" ? peerlessRoleSkillCards : peerlessSkillCards;
  const title = kind === "holy" ? "兑换圣品技能卡" : kind === "role" ? "兑换绝世人物技能卡" : "兑换绝世技能卡";
  setMenuAsSingleList(title, cards.map((card) => ({ label: `${card.name}：${skillById(card.skillId).name}`, icon: card.icon, className: kind === "role" ? "rare-fragment" : "" })));
  bindCurrentMenuClicks(confirmSkillTicketExchangeMenu);
  if (kind === "role") previewSkillTicketExchange();
}

async function confirmSkillTicketExchangeMenu() {
  const cards = state.menuSkillTicketKind === "holy" ? holySkillCards : state.menuSkillTicketKind === "role" ? peerlessRoleSkillCards : peerlessSkillCards;
  const card = cards[state.menuItem];
  if (!card) return;
  try {
    await postApi("/api/skill/ticket-exchange", { account: state.account, cardId: card.id });
    showMenuHint(`已兑换${card.name}`);
    await refreshBag();
    openBagMenu();
  } catch (error) {
    const ticketName = state.menuSkillTicketKind === "holy" ? "圣品技能兑换券" : state.menuSkillTicketKind === "role" ? "绝世人物技能兑换券" : "绝世技能兑换券";
    showMenuHint(error.message === "not_enough_ticket" ? `${ticketName}不足` : "兑换失败");
  }
}

function previewSkillTicketExchange() {
  const card = peerlessRoleSkillCards[state.menuItem];
  if (card) showMenuHint(`${skillById(card.skillId).name}：${skillSummary(skillById(card.skillId))}`);
}

function openSkillCardPetMenu(item) {
  state.menuMode = "skill_card_pet_targets";
  state.menuItem = 0;
  state.menuSkillCardItem = item;
  const pets = ownedPets();
  state.menuPetList = pets;
  const card = [...peerlessSkillCards, ...holySkillCards].find((entry) => entry.id === item.id);
  const items = pets.length
    ? pets.map((pet) => ({ label: `${pet.name} 学习 ${skillById(card?.skillId).name}`, icon: "2.12" }))
    : [{ label: "暂无宠物", icon: "2.12", disabled: true }];
  setMenuAsSingleList("选择学习宠物", items);
  bindCurrentMenuClicks(confirmSkillCardPetMenu);
}

async function learnRoleSkill(item) {
  const card = peerlessRoleSkillCards.find((entry) => entry.id === item.id);
  if (!card) return;
  try {
    const result = await postApi("/api/role/learn-skill", { account: state.account, cardId: item.id });
    state.roleExtraSkills = result.roleExtraSkills || state.roleExtraSkills || [];
    state.serverStats = null;
    await refreshBag();
    showMenuHint(`人物学会${skillById(result.skillId).name}`);
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "already_learned" ? "人物已经学会" : error.message === "not_enough_card" ? "技能卡不足" : "学习失败");
  }
}

async function confirmSkillCardPetMenu() {
  const pet = state.menuPetList?.[state.menuItem];
  const item = state.menuSkillCardItem;
  if (!pet || !item) return;
  try {
    const result = await postApi("/api/pet/learn-skill", { account: state.account, petId: pet.id, cardId: item.id });
    state.petExtraSkills = result.petExtraSkills || state.petExtraSkills;
    await refreshBag();
    showMenuHint(`${pet.name} 学会 ${skillById(result.skillId).name}`);
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "already_learned" ? "该宠物已经学会" : "学习失败");
  }
}

function openMercenaryCardTargetMenu(item) {
  state.menuMode = "mercenary_card_targets";
  state.menuItem = 0;
  state.menuMercenarySkillCardItem = item;
  state.menuMercenaryList = state.mercenaries || [];
  const skillName = skillById(item.skillId).name;
  const items = state.menuMercenaryList.length
    ? state.menuMercenaryList.map((merc) => ({ label: `${merc.name} 学习 ${skillName}`, icon: "1.9" }))
    : [{ label: "暂无佣兵", icon: "1.9", disabled: true }];
  setMenuAsSingleList("选择学习佣兵", items);
  bindCurrentMenuClicks(confirmMercenaryCardTargetMenu);
}

async function confirmMercenaryCardTargetMenu() {
  const merc = state.menuMercenaryList?.[state.menuItem];
  const item = state.menuMercenarySkillCardItem;
  if (!merc || !item) return;
  try {
    const result = await postApi("/api/mercenary/learn-skill", { account: state.account, mercenaryId: merc.id, cardId: item.id });
    applyMercenaryPayload(result);
    await refreshBag();
    showMenuHint(`${merc.name}学会${skillById(result.skillId).name}`);
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "already_learned" ? "该佣兵已经学会" : error.message === "invalid_mercenary_skill_card" ? "佣兵只能学习圣品技能卡" : error.message === "not_enough_card" ? "技能卡不足" : "学习失败");
  }
}

function applyMercenaryPayload(result) {
  state.mercenaries = result.mercenaries || state.mercenaries || [];
  state.activeMercenaryId = result.activeMercenaryId ?? state.activeMercenaryId;
  state.mercenaryNecklaces = result.mercenaryNecklaces || state.mercenaryNecklaces || [];
  state.mercenaryOrbs = result.mercenaryOrbs || state.mercenaryOrbs || [];
  state.mercenaryCraft = result.mercenaryCraft || state.mercenaryCraft || {};
}

function mercenaryLabel(mercenary) {
  const active = mercenary.id === state.activeMercenaryId ? "[出战] " : "";
  const skillCount = new Set([...(mercenary.passiveSkills || []), ...(mercenary.extraSkills || [])]).size;
  const necklace = mercenaryNecklaceFor(mercenary);
  return `${active}${mercenary.name} Lv.${mercenary.level || 100} / 技能${skillCount} / ${necklace?.name || "无项链"}`;
}

function necklaceLabel(necklace) {
  const count = (necklace.orbIds || []).length;
  const equipped = necklace.equippedBy ? "已装备" : "未装备";
  return `${necklace.name} ${count}/${necklace.slots} ${equipped}`;
}

function orbLabel(orb) {
  const stats = (orb.stats || []).map((entry) => `${entry.label || entry.stat}+${entry.value}`).join("/");
  return `${orb.name} ${stats}${orb.socketedIn ? " [已镶嵌]" : ""}`;
}

function openMercenaryRootMenu() {
  state.menuMode = "mercenary_root";
  state.menuItem = 0;
  const active = activeMercenary();
  const craft = state.mercenaryCraft || {};
  setMenuAsSingleList("佣兵指令", [
    { label: "招募佣兵（200灵魂粉末）", icon: "1.9" },
    { label: active ? `收回佣兵：${active.name}` : "带出/指派佣兵", icon: "1.13", disabled: !(state.mercenaries || []).length },
    { label: "查看佣兵属性", icon: "2.10", disabled: !(state.mercenaries || []).length },
    { label: "佣兵学习被动技能卡", icon: "1.49", disabled: !(state.mercenaries || []).length },
    { label: "购买佣兵项链", icon: "1.27" },
    { label: "装备佣兵项链", icon: "2.18", disabled: !(state.mercenaries || []).length || !(state.mercenaryNecklaces || []).length },
    { label: "镶嵌佣兵宝珠", icon: "1.13", disabled: !(state.mercenaryNecklaces || []).length || !(state.mercenaryOrbs || []).some((orb) => !orb.socketedIn) },
    { label: "取下佣兵宝珠", icon: "1.14", disabled: !(state.mercenaryOrbs || []).some((orb) => orb.socketedIn) },
    { label: "销毁佣兵宝珠（返还1000粉末）", icon: "1.13", disabled: !(state.mercenaryOrbs || []).some((orb) => !orb.socketedIn) },
    { label: `制造佣兵宝珠（200粉末） ${craft.count || 0}/10 完成度${craft.completion || 0}`, icon: "1.13" }
  ]);
  bindCurrentMenuClicks(confirmMercenaryRootMenu);
}

function confirmMercenaryRootMenu() {
  if (state.menuItem === 0) return openMercenaryRecruitMenu();
  if (state.menuItem === 1) {
    if (activeMercenary()) return setActiveMercenary("");
    return openMercenaryActiveMenu();
  }
  if (state.menuItem === 2) return openMercenaryStatsTargetMenu();
  if (state.menuItem === 3) return openMercenarySkillTargetMenu();
  if (state.menuItem === 4) return openMercenaryNecklaceShopMenu();
  if (state.menuItem === 5) return openMercenaryEquipTargetMenu();
  if (state.menuItem === 6) return openMercenarySocketNecklaceMenu();
  if (state.menuItem === 7) return openMercenaryUnsocketOrbMenu();
  if (state.menuItem === 8) return openMercenaryDestroyOrbMenu();
  if (state.menuItem === 9) return craftMercenaryOrb();
}

function openMercenaryRecruitMenu() {
  state.menuMode = "mercenary_recruit";
  state.menuItem = 0;
  state.menuMercenaryTypes = Object.values(mercenaryTypes);
  setMenuAsSingleList("招募佣兵", state.menuMercenaryTypes.map((merc) => ({
    label: `${merc.name}（${skillById(merc.skillId).name}） 200灵魂粉末`,
    icon: "1.9",
    disabled: (state.mercenaries || []).some((owned) => owned.type === merc.type)
  })));
  bindCurrentMenuClicks(confirmMercenaryRecruitMenu);
}

async function confirmMercenaryRecruitMenu() {
  const merc = state.menuMercenaryTypes?.[state.menuItem];
  if (!merc) return;
  try {
    const result = await postApi("/api/mercenary/recruit", { account: state.account, type: merc.type });
    applyMercenaryPayload(result);
    showMenuHint(`招募成功：${result.recruited.name}`);
    openMercenaryRootMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_powder" ? "灵魂粉末不足" : error.message === "already_owned" ? "已拥有该佣兵" : error.message === "invalid_mercenary" ? "佣兵类型错误" : `招募失败：${error.message}`);
  }
}

function openMercenaryActiveMenu() {
  state.menuMode = "mercenary_active";
  state.menuItem = 0;
  state.menuMercenaryList = state.mercenaries || [];
  const items = state.menuMercenaryList.length
    ? state.menuMercenaryList.map((merc) => ({ label: mercenaryLabel(merc), icon: "1.9" }))
    : [{ label: "暂无佣兵", icon: "1.9", disabled: true }];
  setMenuAsSingleList("指派佣兵", items);
  bindCurrentMenuClicks(confirmMercenaryActiveMenu);
}

function confirmMercenaryActiveMenu() {
  const merc = state.menuMercenaryList?.[state.menuItem];
  if (merc) setActiveMercenary(merc.id);
}

function openMercenaryStatsTargetMenu() {
  state.menuMode = "mercenary_stats_targets";
  state.menuItem = 0;
  state.menuMercenaryList = state.mercenaries || [];
  const items = state.menuMercenaryList.length
    ? state.menuMercenaryList.map((merc) => ({ label: mercenaryLabel(merc), icon: "2.10" }))
    : [{ label: "暂无佣兵", icon: "2.10", disabled: true }];
  setMenuAsSingleList("选择查看佣兵", items);
  bindCurrentMenuClicks(confirmMercenaryStatsTargetMenu);
}

function confirmMercenaryStatsTargetMenu() {
  const merc = state.menuMercenaryList?.[state.menuItem];
  if (!merc) return;
  openMercenaryStatsDetailMenu(merc);
}

function openMercenaryStatsDetailMenu(mercenary) {
  openStatsCard(statsCardSubjectForMercenary(mercenary));
}

async function setActiveMercenary(mercenaryId) {
  try {
    const result = await postApi("/api/mercenary/active", { account: state.account, mercenaryId });
    applyMercenaryPayload(result);
    showMenuHint(mercenaryId ? "佣兵已带出" : "佣兵已收回");
    openMercenaryRootMenu();
  } catch {
    showMenuHint("佣兵指派失败");
  }
}

function openMercenarySkillTargetMenu() {
  state.menuMode = "mercenary_skill_targets";
  state.menuItem = 0;
  state.menuMercenaryList = state.mercenaries || [];
  const items = state.menuMercenaryList.length
    ? state.menuMercenaryList.map((merc) => ({ label: mercenaryLabel(merc), icon: "1.9" }))
    : [{ label: "暂无佣兵", icon: "1.9", disabled: true }];
  setMenuAsSingleList("选择佣兵", items);
  bindCurrentMenuClicks(confirmMercenarySkillTargetMenu);
}

function confirmMercenarySkillTargetMenu() {
  const merc = state.menuMercenaryList?.[state.menuItem];
  if (!merc) return;
  state.menuMercenaryTarget = merc;
  openMercenarySkillCardMenu();
}

async function openMercenarySkillCardMenu() {
  state.menuMode = "mercenary_skill_cards";
  state.menuItem = 0;
  try {
    const result = await refreshBag();
    state.menuMercenarySkillCards = (result.items || []).filter(isMercenarySkillCard);
    const items = state.menuMercenarySkillCards.length
      ? state.menuMercenarySkillCards.map((item) => ({ label: `${item.name} x${item.quantity}`, icon: item.icon }))
      : [{ label: "背包没有可学习的圣品技能卡", icon: "1.49", disabled: true }];
    setMenuAsSingleList(`${state.menuMercenaryTarget?.name || "佣兵"}学习技能`, items);
    bindCurrentMenuClicks(confirmMercenarySkillCardMenu);
  } catch {
    state.menuMercenarySkillCards = [];
    setMenuAsSingleList(`${state.menuMercenaryTarget?.name || "佣兵"}学习技能`, [{ label: "背包读取失败", icon: "1.49", disabled: true }]);
  }
}

async function confirmMercenarySkillCardMenu() {
  const merc = state.menuMercenaryTarget;
  const card = state.menuMercenarySkillCards?.[state.menuItem];
  if (!merc || !card) return;
  try {
    const result = await postApi("/api/mercenary/learn-skill", { account: state.account, mercenaryId: merc.id, cardId: card.id });
    applyMercenaryPayload(result);
    await refreshBag();
    showMenuHint(`${merc.name}学会${skillById(result.skillId).name}`);
    openMercenaryRootMenu();
  } catch (error) {
    showMenuHint(error.message === "already_learned" ? "该佣兵已经学会" : error.message === "invalid_mercenary_skill_card" ? "佣兵只能学习圣品技能卡" : "学习失败");
  }
}

function openMercenaryNecklaceShopMenu() {
  state.menuMode = "mercenary_necklace_shop";
  state.menuItem = 0;
  state.menuNecklaceTypes = Object.values(mercenaryNecklaceTypes);
  setMenuAsSingleList("佣兵项链商店", state.menuNecklaceTypes.map((item) => ({
    label: `${item.name} ${item.slots}孔 / ${item.cost}灵魂粉末`,
    icon: item.icon
  })));
  bindCurrentMenuClicks(confirmMercenaryNecklaceShopMenu);
}

async function confirmMercenaryNecklaceShopMenu() {
  const item = state.menuNecklaceTypes?.[state.menuItem];
  if (!item) return;
  try {
    const result = await postApi("/api/mercenary/buy-necklace", { account: state.account, type: item.type });
    applyMercenaryPayload(result);
    showMenuHint(`购买成功：${result.necklace.name}`);
    openMercenaryRootMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_powder" ? "灵魂粉末不足" : "购买失败");
  }
}

function openMercenaryEquipTargetMenu() {
  state.menuMode = "mercenary_equip_target";
  state.menuItem = 0;
  state.menuMercenaryList = state.mercenaries || [];
  setMenuAsSingleList("选择装备佣兵", state.menuMercenaryList.map((merc) => ({ label: mercenaryLabel(merc), icon: "1.9" })));
  bindCurrentMenuClicks(confirmMercenaryEquipTargetMenu);
}

function confirmMercenaryEquipTargetMenu() {
  const merc = state.menuMercenaryList?.[state.menuItem];
  if (!merc) return;
  state.menuMercenaryTarget = merc;
  openMercenaryEquipNecklaceMenu();
}

function openMercenaryEquipNecklaceMenu() {
  state.menuMode = "mercenary_equip_necklace";
  state.menuItem = 0;
  state.menuNecklaces = state.mercenaryNecklaces || [];
  setMenuAsSingleList("选择佣兵项链", state.menuNecklaces.map((necklace) => ({ label: necklaceLabel(necklace), icon: necklace.icon || "1.27" })));
  bindCurrentMenuClicks(confirmMercenaryEquipNecklaceMenu);
}

async function confirmMercenaryEquipNecklaceMenu() {
  const merc = state.menuMercenaryTarget;
  const necklace = state.menuNecklaces?.[state.menuItem];
  if (!merc || !necklace) return;
  try {
    const result = await postApi("/api/mercenary/equip-necklace", { account: state.account, mercenaryId: merc.id, necklaceId: necklace.id });
    applyMercenaryPayload(result);
    showMenuHint("佣兵项链已装备");
    openMercenaryRootMenu();
  } catch {
    showMenuHint("装备失败");
  }
}

function openMercenarySocketNecklaceMenu() {
  state.menuMode = "mercenary_socket_necklace";
  state.menuItem = 0;
  state.menuNecklaces = (state.mercenaryNecklaces || []).filter((necklace) => (necklace.orbIds || []).length < necklace.slots);
  const items = state.menuNecklaces.length
    ? state.menuNecklaces.map((necklace) => ({ label: necklaceLabel(necklace), icon: necklace.icon || "1.27" }))
    : [{ label: "没有可镶嵌的项链", icon: "1.27", disabled: true }];
  setMenuAsSingleList("选择项链", items);
  bindCurrentMenuClicks(confirmMercenarySocketNecklaceMenu);
}

function confirmMercenarySocketNecklaceMenu() {
  const necklace = state.menuNecklaces?.[state.menuItem];
  if (!necklace) return;
  state.menuNecklaceTarget = necklace;
  openMercenarySocketOrbMenu();
}

function openMercenarySocketOrbMenu() {
  state.menuMode = "mercenary_socket_orb";
  state.menuItem = 0;
  const necklace = state.menuNecklaceTarget;
  state.menuOrbs = (state.mercenaryOrbs || []).filter((orb) => !orb.socketedIn && !(necklace.type === "advanced" && orb.type === "peerless"));
  const items = state.menuOrbs.length
    ? state.menuOrbs.map((orb) => ({ label: orbLabel(orb), icon: orb.icon || "1.13", className: orb.type === "peerless" ? "rare-fragment" : "" }))
    : [{ label: "没有可镶嵌的宝珠", icon: "1.13", disabled: true }];
  setMenuAsSingleList("选择宝珠", items);
  bindCurrentMenuClicks(confirmMercenarySocketOrbMenu);
}

async function confirmMercenarySocketOrbMenu() {
  const necklace = state.menuNecklaceTarget;
  const orb = state.menuOrbs?.[state.menuItem];
  if (!necklace || !orb) return;
  try {
    const result = await postApi("/api/mercenary/socket-orb", { account: state.account, necklaceId: necklace.id, orbId: orb.id });
    applyMercenaryPayload(result);
    showMenuHint("宝珠已镶嵌");
    openMercenaryRootMenu();
  } catch (error) {
    showMenuHint(error.message === "necklace_full" ? "项链孔位已满" : "镶嵌失败");
  }
}

function openMercenaryUnsocketOrbMenu() {
  state.menuMode = "mercenary_unsocket_orb";
  state.menuItem = 0;
  state.menuOrbs = (state.mercenaryOrbs || []).filter((orb) => orb.socketedIn);
  const items = state.menuOrbs.length
    ? state.menuOrbs.map((orb) => ({ label: orbLabel(orb), icon: orb.icon || "1.13", className: orb.type === "peerless" ? "rare-fragment" : "" }))
    : [{ label: "没有已镶嵌宝珠", icon: "1.13", disabled: true }];
  setMenuAsSingleList("取下宝珠", items);
  bindCurrentMenuClicks(confirmMercenaryUnsocketOrbMenu);
}

async function confirmMercenaryUnsocketOrbMenu() {
  const orb = state.menuOrbs?.[state.menuItem];
  if (!orb) return;
  try {
    const result = await postApi("/api/mercenary/unsocket-orb", { account: state.account, orbId: orb.id });
    applyMercenaryPayload(result);
    showMenuHint("宝珠已取下");
    openMercenaryRootMenu();
  } catch {
    showMenuHint("取下失败");
  }
}

function openMercenaryDestroyOrbMenu() {
  state.menuMode = "mercenary_destroy_orb";
  state.menuItem = 0;
  state.menuOrbs = (state.mercenaryOrbs || []).filter((orb) => !orb.socketedIn);
  const items = state.menuOrbs.length
    ? state.menuOrbs.map((orb) => ({ label: `${orbLabel(orb)}  销毁返还1000粉末`, icon: orb.icon || "1.13", className: orb.type === "peerless" ? "rare-fragment" : "" }))
    : [{ label: "没有可销毁宝珠", icon: "1.13", disabled: true }];
  setMenuAsSingleList("销毁佣兵宝珠", items);
  bindCurrentMenuClicks(confirmMercenaryDestroyOrbMenu);
}

async function confirmMercenaryDestroyOrbMenu() {
  const orb = state.menuOrbs?.[state.menuItem];
  if (!orb) return;
  try {
    const result = await postApi("/api/mercenary/destroy-orb", { account: state.account, orbId: orb.id });
    applyMercenaryPayload(result);
    showMenuHint(`宝珠已销毁，灵魂粉末 +${result.refund}`);
    openMercenaryRootMenu();
  } catch (error) {
    showMenuHint(error.message === "orb_socketed" ? "已镶嵌宝珠需先取下" : "销毁失败");
  }
}

async function craftMercenaryOrb() {
  try {
    const result = await postApi("/api/mercenary/craft-orb", { account: state.account });
    applyMercenaryPayload(result);
    const produced = (result.produced || []).map((orb) => orb.name).join("、");
    showMenuHint(produced ? `制造完成：${produced}` : `完成度 +${result.gain}`);
    openMercenaryRootMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_powder" ? "灵魂粉末不足" : `制造失败：${error.message}`);
  }
}

function openBagGiveTargetMenu(item) {
  state.menuMode = "bag_give_targets";
  state.menuBagItem = item;
  state.menuGiveTarget = null;
  state.menuItem = 0;
  const targets = getNearbyTargets().filter((target) => target.type !== "NPC");
  state.menuGiveTargets = targets;
  const items = targets.length
    ? targets.map((target) => ({ label: `${target.actor.name} / ${Math.round(target.distance)}px`, icon: "2.10" }))
    : [{ label: "附近没有玩家", icon: "2.10", disabled: true }];
  setMenuAsSingleList("给附近的人", items);
  bindCurrentMenuClicks(confirmBagGiveTargetMenu);
}

async function confirmBagGiveTargetMenu() {
  const item = state.menuBagItem;
  const target = state.menuGiveTargets?.[state.menuItem];
  if (!item || !target) return;
  state.menuGiveTarget = target;
  if (item.kind === "equipment" || (item.quantity || 1) <= 1) {
    await giveBagItemToTarget(1);
    return;
  }
  openGiveQuantityPanel(item, target);
}

function openGiveQuantityPanel(item, target) {
  const maxQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  openQuantityPanel({
    title: "赠送数量",
    label: `${item.name || "物品"} 给 ${target.actor.name}，最多 ${maxQuantity}`,
    maxQuantity,
    initialQuantity: maxQuantity,
    onConfirm: async (quantity) => giveBagItemToTarget(quantity),
    onCancel: () => openBagGiveTargetMenu(item)
  });
}

async function giveBagItemToTarget(quantity) {
  const item = state.menuBagItem;
  const target = state.menuGiveTarget || state.menuGiveTargets?.[state.menuItem];
  if (!item || !target) return;
  if (isUntradeableItem(item)) {
    showMenuHint("该物品不能交易");
    return;
  }
  try {
    await postApi("/api/bag/give", { account: state.account, id: item.id, quantity, toName: target.actor.name });
    await refreshBag();
    hideQuantityPanel();
    showMenuHint(`已给 ${target.actor.name} x${quantity}`);
    openBagMenu();
  } catch (error) {
    const text = error.message === "equipped_item"
      ? "已装备物品不能赠送"
      : error.message === "not_enough_item"
        ? "物品数量不足"
        : error.message === "target_bag_full"
          ? "对方背包已满"
          : error.message === "untradeable_item"
            ? "该物品不能交易"
            : "赠送失败";
    if ($("#giveQuantityPanel")?.classList.contains("active")) $("#giveQuantityMessage").textContent = text;
    else showMenuHint(text);
  }
}

async function discardBagItem(item) {
  try {
    await postApi("/api/bag/discard", { account: state.account, id: item.id, quantity: 1 });
    await refreshBag();
    showMenuHint("已丢弃");
    openBagMenu();
  } catch (error) {
    showMenuHint(error.message === "equipped_item" ? "已装备物品不能丢弃" : "丢弃失败");
  }
}

function openEquipmentEquipMenu() {
  state.menuMode = "equipment_equip";
  const equipment = (state.bag.items || []).filter((item) => item.kind === "equipment");
  const items = equipment.length
    ? equipment.map((item) => ({ label: bagItemLabel(item), icon: item.icon || equipmentForgeStats[item.type]?.icon || "2.18", longText: true }))
    : [{ label: "暂无装备", icon: "1.3", disabled: true }];
  setMenuAsSingleList("装备装配", items);
  state.menuEquipmentList = equipment;
  bindCurrentMenuClicks(confirmEquipmentEquipMenu);
}

function confirmEquipmentEquipMenu() {
  const item = state.menuEquipmentList?.[state.menuItem];
  if (item) equipEquipment(item.id);
}

async function equipEquipment(id) {
  const keepIndex = state.menuItem;
  try {
    const result = await postApi("/api/equipment/equip", { account: state.account, id });
    state.bag.equipped = result.equipped || {};
    await refreshBag();
    showMenuHint("装备已装配");
    if (state.menuMode === "equipment_equip") {
      state.menuItem = keepIndex;
      openEquipmentEquipMenu();
    }
    if (state.menuMode === "bag") {
      state.menuItem = keepIndex;
      openBagMenu();
    }
  } catch {
    showMenuHint("装配失败");
  }
}

function openEquipmentEquipMenu() {
  state.menuMode = "equipment_equip";
  const equipment = (state.bag.items || []).filter((item) => ["equipment", "fashion"].includes(item.kind));
  const items = equipmentSlots.map((slot) => {
    const equippedId = state.bag.equipped?.[slot.key] || (slot.key === "weapon" ? null : state.bag.equipped?.[slot.types[0]]);
    const equipped = equipment.find((item) => item.id === equippedId);
    return { label: `${slot.label}：${equipped ? bagItemLabel(equipped) : "未装配"}`, icon: equipped?.icon || slot.icon, className: isPeerlessItem(equipped) ? "rare-fragment" : "", longText: !!equipped };
  });
  setMenuAsSingleList("装备装配", items);
  state.menuEquipmentSlots = equipmentSlots;
  bindCurrentMenuClicks(confirmEquipmentEquipMenu);
}

function confirmEquipmentEquipMenu() {
  const slot = state.menuEquipmentSlots?.[state.menuItem];
  if (slot) openEquipmentSlotMenu(slot.key);
}

function openEquipmentSlotMenu(slotKey) {
  const slot = equipmentSlots.find((item) => item.key === slotKey);
  if (!slot) return;
  state.menuMode = "equipment_slot_items";
  state.menuEquipmentSlot = slot;
  state.menuItem = 0;
  const equipment = (state.bag.items || []).filter((item) => ["equipment", "fashion"].includes(item.kind) && slot.types.includes(item.type));
  const equippedId = state.bag.equipped?.[slot.key];
  const list = equippedId ? [{ id: equippedId, unequipSlot: slot.key, label: `卸下${slot.label}` }, ...equipment] : equipment;
  state.menuEquipmentList = list;
  const items = list.length
    ? list.map((item) => item.unequipSlot
      ? { label: item.label, icon: slot.icon }
      : { label: bagItemLabel(item), icon: item.icon || equipmentForgeStats[item.type]?.icon || slot.icon, className: isPeerlessItem(item) ? "rare-fragment" : "", longText: true })
    : [{ label: `${slot.label}暂无可装配装备`, icon: slot.icon, disabled: true }];
  setMenuAsSingleList(`${slot.label}装配`, items);
  bindCurrentMenuClicks(confirmEquipmentSlotMenu);
}

function confirmEquipmentSlotMenu() {
  const item = state.menuEquipmentList?.[state.menuItem];
  if (item?.unequipSlot) {
    unequipEquipment({ slot: item.unequipSlot });
    return;
  }
  if (item) equipEquipment(item.id, state.menuEquipmentSlot?.key);
}

async function unequipEquipment({ id = "", slot = "" } = {}) {
  const keepIndex = state.menuItem;
  try {
    const result = await postApi("/api/equipment/unequip", { account: state.account, id, slot });
    state.bag.equipped = result.equipped || {};
    await refreshBag();
    await refreshServerStats();
    applyActiveFashionSprite();
    await loadSpriteOptional(state.player?.spriteId);
    broadcastState(true);
    showMenuHint("已卸下");
    if (state.menuMode === "equipment_slot_items") {
      state.menuItem = keepIndex;
      openEquipmentSlotMenu(state.menuEquipmentSlot?.key);
    } else if (state.menuMode === "equipment_equip") {
      state.menuItem = keepIndex;
      openEquipmentEquipMenu();
    } else {
      openBagMenu();
    }
  } catch {
    showMenuHint("卸下失败");
  }
}

async function equipEquipment(id, slotKey = null) {
  const keepIndex = state.menuItem;
  try {
    const result = await postApi("/api/equipment/equip", { account: state.account, id, slot: slotKey });
    state.bag.equipped = result.equipped || {};
    await refreshBag();
    await refreshServerStats();
    applyActiveFashionSprite();
    await loadSpriteOptional(state.player?.spriteId);
    broadcastState(true);
    showMenuHint("装备已装配");
    if (state.menuMode === "equipment_equip") {
      state.menuItem = keepIndex;
      openEquipmentEquipMenu();
    }
    if (state.menuMode === "equipment_slot_items") {
      state.menuItem = keepIndex;
      openEquipmentSlotMenu(state.menuEquipmentSlot?.key);
    }
    if (state.menuMode === "bag") {
      state.menuItem = keepIndex;
      openBagMenu();
    }
  } catch {
    showMenuHint("装配失败");
  }
}

function openForgeEquipmentMenu() {
  state.menuMode = "forge_equipment";
  const equipment = (state.bag.items || []).filter((item) => item.kind === "equipment");
  const items = equipment.length
    ? equipment.map((item) => ({ label: `${item.name} 强化 ${item.forgeLevel || 0}/${item.maxForgeLevel || 15}`, icon: item.icon || equipmentForgeStats[item.type]?.icon || "2.18" }))
    : [{ label: "暂无可强化装备", icon: "1.3", disabled: true }];
  setMenuAsSingleList(`装备强化 宝石${state.bag.forgeGem}`, items);
  state.menuEquipmentList = equipment;
  bindCurrentMenuClicks(confirmForgeEquipmentMenu);
}

async function confirmForgeEquipmentMenu() {
  const item = state.menuEquipmentList?.[state.menuItem];
  if (!item) return;
  const keepIndex = state.menuItem;
  try {
    const result = await postApi("/api/equipment/forge", { account: state.account, id: item.id });
    const rateText = `${Math.round((result.successRate || 0) * 100)}%`;
    showMenuHint(result.success
      ? `${result.equipment.name} 强化成功（${rateText}），剩余宝石 ${result.forgeGem}`
      : `强化失败（${rateText}），剩余宝石 ${result.forgeGem}`);
    await refreshBag();
    await refreshServerStats();
    state.menuItem = keepIndex;
    openForgeEquipmentMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_gem" ? "锻造宝石不足" : "强化失败");
  }
}

function showMenuHint(text) {
  const feed = $("#chatFeed");
  feed.classList.add("active", "menu-hint");
  feed.innerHTML = `<div class="chat-line">${escapeHtml(text)}</div>`;
  clearTimeout(state.menuHintTimer);
  state.menuHintTimer = setTimeout(clearMenuHint, 1400);
}

function clearMenuHint() {
  clearTimeout(state.menuHintTimer);
  state.menuHintTimer = null;
  const feed = $("#chatFeed");
  if (!feed.classList.contains("menu-hint")) return;
  feed.classList.remove("active", "menu-hint");
  feed.innerHTML = "";
}

function canIdleHuntHere() {
  return state.mapName === NEW_FIELD_MAP || state.mapName === "\u539f\u91ce\u602a\u533a" || state.mapName === "\u5e7b\u5f71\u72e9\u730e\u573a";
}

function openIdleHuntMenu() {
  state.menuMode = "idle_hunt";
  state.menuItem = 0;
  const current = state.idleHuntActive
    ? `当前：${state.idleHuntTarget === "boss" ? `Boss ${idleHuntBossName()}` : "普通野怪"}`
    : "当前：未开启";
  setMenuAsSingleList("原地挂机", [
    { label: current, icon: "1.47", disabled: true },
    { label: "挂机普通野怪", icon: "1.47" },
    { label: "挂机Boss", icon: "1.49" },
    { label: "取消挂机", icon: "1.13", disabled: !state.idleHuntActive }
  ]);
  bindCurrentMenuClicks(confirmIdleHuntMenu);
}

function confirmIdleHuntMenu() {
  if (state.menuItem === 1) {
    startIdleHunt("wild");
    return;
  }
  if (state.menuItem === 2) {
    openIdleHuntBossMenu();
    return;
  }
  if (state.menuItem === 3 && state.idleHuntActive) {
    stopIdleHunt("原地挂机已取消");
    closeMainMenu();
  }
}

function idleHuntBossName() {
  const boss = findIdleHuntBossById(state.idleHuntBossId);
  return boss?.name || "Boss";
}

function nearbyBossTargets() {
  return getNearbyTargets().filter((item) => item.actor?.wildMonsterId && item.type === "NPC");
}

function findIdleHuntBossById(id) {
  return localActorsOnCurrentMap().find((actor) => actor.wildMonsterId === id) || null;
}

function openIdleHuntBossMenu() {
  state.menuMode = "idle_hunt_boss_targets";
  state.menuItem = 0;
  state.menuIdleHuntBossTargets = nearbyBossTargets();
  const items = state.menuIdleHuntBossTargets.length
    ? state.menuIdleHuntBossTargets.map((target) => ({ label: `${target.actor.name} / ${Math.round(target.distance)}px`, icon: "1.49" }))
    : [{ label: "附近没有Boss", icon: "1.49", disabled: true }];
  setMenuAsSingleList("选择挂机Boss", items);
  bindCurrentMenuClicks(confirmIdleHuntBossMenu);
}

function confirmIdleHuntBossMenu() {
  const target = state.menuIdleHuntBossTargets?.[state.menuItem];
  if (!target?.actor?.wildMonsterId) return;
  startIdleHunt("boss", target.actor.wildMonsterId);
}

function startIdleHunt(target = "wild", bossId = "") {
  if (state.idleHuntActive) {
    stopIdleHunt("原地挂机已取消");
  }
  if (!canIdleHuntHere()) {
    showMenuHint("当前地图不能挂机，需要在可遇怪区域");
    return;
  }
  state.idleHuntActive = true;
  state.idleHuntTarget = target;
  state.idleHuntBossId = target === "boss" ? bossId : "";
  state.autoBattlePersistent = true;
  closeMainMenu();
  showMenuHint(target === "boss" ? `挂机Boss${idleHuntBossName()}开始` : "挂机普通野怪开始");
  scheduleIdleHunt();
}

function stopIdleHunt(message = "") {
  state.idleHuntActive = false;
  clearTimeout(state.idleHuntTimer);
  state.idleHuntTimer = null;
  if (message) showMenuHint(message);
}

function scheduleIdleHunt() {
  clearTimeout(state.idleHuntTimer);
  if (!state.idleHuntActive) return;
  const delay = randomInt(5000, 10000);
  state.idleHuntTimer = setTimeout(() => {
    state.idleHuntTimer = null;
    runIdleHuntTick();
  }, delay);
}

function runIdleHuntTick() {
  if (!state.idleHuntActive) return;
  if (state.followLeaderId) {
    stopIdleHunt("队员跟随中，挂机已取消");
    return;
  }
  if (!canIdleHuntHere()) {
    stopIdleHunt("离开遇怪区域，挂机已取消");
    return;
  }
  if (state.battle) {
    scheduleIdleHunt();
    return;
  }
  state.fieldSteps = 0;
  state.encounterCooldown = 0;
  if (state.idleHuntTarget === "boss") startIdleHuntBossBattle();
  else startWildBattle();
}

function statCard(title, subtitle, stats, compact = false) {
  return `<div class="stat-card ${compact ? "stat-card-compact" : ""}">
    <strong>${escapeHtml(title)}</strong>
    <span class="stat-subtitle">${escapeHtml(subtitle)}</span>
    <div class="stat-line stat-line-full"><span>生命</span><b>${stats.hp}</b></div>
    <div class="stat-line"><span>攻击:<b>${stats.attack}</b></span><span>防御:<b>${stats.defense}</b></span></div>
    <div class="stat-line"><span>速度:<b>${stats.speed}</b></span><span>法力:<b>${stats.mana}</b></span></div>
    <div class="stat-line"><span>致命:<b>${stats.crit}%</b></span><span>爆伤:<b>${stats.critDamage}</b></span></div>
  </div>`;
}

function statLabel(stat) {
  return ({ power: "战斗力", hp: "生命", defense: "防御", speed: "速度", attack: "攻击", mana: "法力", crit: "致命", critDamage: "爆伤" })[stat] || stat;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sample(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateDroppedEquipment(monsterLevel = 1) {
  const keys = ["hat", "armor", "pants", "belt", "shoes", "firearm", "sword", "staff"];
  const type = sample(keys);
  const base = equipmentForgeStats[type];
  const forgeLevel = clampStat(Math.floor(monsterLevel / 12) + randomInt(0, 2), 0, 15);
  const affixes = Array.from({ length: 3 }, () => ({ ...sample(equipmentAffixPool), kind: "flat" }));
  affixes.push({ ...sample(equipmentPercentAffixPool), kind: "percent" });
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    name: `${base.name}+${forgeLevel}`,
    icon: base.icon,
    forgeLevel,
    mainStat: base.stat,
    mainValue: Math.round(base.perLevel * forgeLevel),
    affixes
  };
}

function formatEquipment(item) {
  const fixed = Object.entries(item.fixedStats || {}).map(([stat, value]) => `${statLabel(stat)} +${value}`);
  const main = item.mainStat ? [`${statLabel(item.mainStat)} +${item.mainValue}`] : [];
  const affixes = (item.affixes || []).map((affix) => (
    affix.kind === "percent" ? `${affix.label} +${Math.round(affix.percent * 100)}%` : `${affix.label} +${affix.value}`
  ));
  const stats = [...fixed, ...main, ...affixes].join(" / ");
  return stats ? `${item.name}（${stats}）` : item.name;
}

function generateFragmentDrops(monster, count = 1) {
  const drops = [];
  for (const fragment of monster.fragments || []) {
    let quantity = 0;
    for (let i = 0; i < count; i++) {
      if (Math.random() < fragment.chance) quantity += randomInt(fragment.amount[0], fragment.amount[1]);
    }
    if (quantity > 0) drops.push({ id: fragment.id, name: fragment.name, icon: fragment.icon, quantity });
  }
  return drops;
}

async function grantWildBattleReward(monsterId, monsterCount = 1, rewardTicket = "") {
  if (elfKingVault.stageById(monsterId)) {
    await grantElfKingVaultReward(monsterId);
    return;
  }
  if (immortalBossById[monsterId]) {
    await grantImmortalBossReward(monsterId);
    return;
  }
  const monster = wildMonsterTable[monsterId];
  if (!monster || !state.account) return;
  if (!rewardTicket) {
    state.pendingBattleReward = { error: "本地战斗不发放经济奖励，请使用服务器权威战斗。" };
    return;
  }
  try {
    const result = await postApi("/api/battle-reward", {
      account: state.account,
      rewardTicket
    });
    const reward = result.reward || {};
    const previousLevel = result.previousLevel || state.playerProgress.level;
    const previousCareerLevel = result.previousCareerLevel ?? state.playerProgress.careerLevel;
    const previousPetLevel = result.previousPetLevel || state.petProgress.level;
    const previousMercenaryLevel = result.previousMercenaryLevel ?? activeMercenary()?.level ?? null;
    state.playerProgress.level = result.level || state.playerProgress.level;
    state.playerProgress.exp = result.exp ?? state.playerProgress.exp;
    state.playerProgress.careerLevel = result.careerLevel ?? state.playerProgress.careerLevel;
    state.playerProgress.careerExp = result.careerExp ?? state.playerProgress.careerExp;
    state.playerProgress.dragonSoul = result.dragonSoul || state.playerProgress.dragonSoul;
    if (result.petProgressById) {
      state.petProgressById = Object.fromEntries(Object.entries(result.petProgressById).map(([petId, progress]) => [String(normalizePetId(petId)), normalizePetProgress(progress)]));
    } else {
      state.petProgressById[String(state.selected.petId)] = normalizePetProgress({ level: result.petLevel || state.petProgress.level, exp: result.petExp ?? state.petProgress.exp });
    }
    syncActivePetProgress();
    if (Array.isArray(result.mercenaries)) state.mercenaries = result.mercenaries;
    state.serverStats = result.player?.serverStats || state.serverStats;
    const roleLevelUp = state.playerProgress.level > previousLevel;
    const careerLevelUp = state.playerProgress.careerLevel > previousCareerLevel;
    const petLevelUp = state.petProgress.level > previousPetLevel;
    const mercenary = result.mercenaryId ? state.mercenaries.find((item) => item.id === result.mercenaryId) : null;
    const mercenaryLevelUp = Boolean(mercenary && previousMercenaryLevel != null && mercenary.level > previousMercenaryLevel);
    state.pendingBattleReward = {
      exp: result.gainedExp ?? reward.exp ?? 0,
      petExp: result.gainedPetExp ?? reward.petExp ?? 0,
      forgeGem: result.gainedForgeGem ?? reward.forgeGem ?? 0,
      equipment: result.equipment || null,
      fragments: result.fragments || reward.fragments || [],
      previousLevel,
      previousPetLevel,
      roleLevelUp,
      careerLevelUp,
      petLevelUp,
      level: state.playerProgress.level,
      expNow: state.playerProgress.exp,
      expNeed: state.playerProgress.level < 100 ? expToNextLevel(state.playerProgress.level) : 0,
      career: careerTree.careerStage(state.selected) > 0 ? {
        name: careerTree.careerName(state.selected),
        previousLevel: previousCareerLevel,
        level: state.playerProgress.careerLevel,
        exp: state.playerProgress.careerExp,
        expNeed: state.playerProgress.careerLevel < 100 ? careerExpToNextLevel(state.playerProgress.careerLevel) : 0,
        gainedExp: result.gainedCareerExp ?? 0,
        levelUp: careerLevelUp
      } : null,
      petLevel: state.petProgress.level,
      petExpNow: state.petProgress.exp,
      petExpNeed: state.petProgress.level < 100 ? expToNextLevel(state.petProgress.level) : 0
    };
    if (mercenary) {
      state.pendingBattleReward.mercenary = {
        name: mercenary.name,
        previousLevel: previousMercenaryLevel,
        level: mercenary.level,
        exp: mercenary.exp,
        expNeed: mercenary.level < 100 ? expToNextLevel(mercenary.level) : 0,
        gainedExp: result.gainedMercenaryExp ?? 0,
        levelUp: mercenaryLevelUp
      };
    }
    if (roleLevelUp) showMenuHint(`角色升级到 ${state.playerProgress.level} 级`);
    if (careerLevelUp) showMenuHint(`职业等级提升到 ${state.playerProgress.careerLevel} 级`);
    if (petLevelUp) showMenuHint(`宠物升级到 ${state.petProgress.level} 级`);
    if (mercenaryLevelUp) showMenuHint(`${mercenary.name}升级到 ${mercenary.level} 级`);
  } catch (error) {
    state.pendingBattleReward = { error: "战利品发放失败" };
  }
}

async function grantImmortalBossReward(bossId) {
  const boss = immortalBossById[bossId];
  if (!boss || !state.account) return;
  try {
    const result = await postApi("/api/immortal-boss/reward", { account: state.account, bossId });
    state.pendingBattleReward = {
      exp: 0,
      forgeGem: 0,
      equipment: null,
      fragments: [],
      soulPowder: Number(result.amount) || 0,
      immortalPill: Number(result.pillAmount) || 0,
      currentSoulPowder: Number(result.soulPowder) || 0,
      currentImmortalPill: Number(result.immortalPill) || 0,
      immortalBossName: boss.name
    };
    state.soulPowder = Number(result.soulPowder) || state.soulPowder;
    state.immortalPill = Number(result.immortalPill) || state.immortalPill;
    showMenuHint(`${boss.name}奖励：灵魂粉末 +${result.amount}，仙丹 +${result.pillAmount || 0}`);
  } catch (error) {
    state.pendingBattleReward = {
      notice: error.message === "already_claimed_today"
        ? `${boss.name}今日奖励已领取`
        : `${boss.name}奖励发放失败`
    };
  }
}

async function acceptTeamBattleReward(msg) {
  if (!msg?.wildMonsterId || !msg.rewardTicket || msg.rewardClaimedBy === state.peerId) return;
  if (!isActiveTeamBattleMessage(msg)) return;
  const rewardId = msg.rewardId || `${msg.battleId}-reward`;
  if (state.claimedTeamRewardIds.has(rewardId)) return;
  addBoundedId(state.claimedTeamRewardIds, rewardId);
  await grantWildBattleReward(msg.wildMonsterId, msg.monsterCount || 1, msg.rewardTicket);
  showMenuHint("队伍战斗奖励已发放");
}

function rewardIconHtml(icon = "2.8") {
  return menuIconHtml(icon);
}

function showBattleRewardPanel() {
  const reward = state.pendingBattleReward;
  if (!reward) return;
  state.pendingBattleReward = null;
  const panel = $("#battleRewardPanel");
  const list = $("#battleRewardList");
  if (!panel || !list) return;
  if (reward.error || reward.notice) {
    list.innerHTML = `<div class="battle-reward-row">${rewardIconHtml(reward.notice ? "1.49" : "2.8")}<span>${escapeHtml(reward.notice || reward.error)}</span><small>${reward.notice ? "竞技场" : "失败"}</small></div>`;
  } else {
    const rows = [
      { icon: STAT_ICONS.exp, text: `经验 +${reward.exp}`, meta: reward.expNeed ? `Lv.${reward.level} ${reward.expNow}/${reward.expNeed}` : "满级" },
      { icon: "2.12", text: `宠物经验 +${reward.petExp ?? reward.exp}`, meta: reward.petExpNeed ? `Lv.${reward.petLevel} ${reward.petExpNow}/${reward.petExpNeed}` : "满级" },
      { icon: "1.13", text: `锻造宝石 +${reward.forgeGem}`, meta: "材料" }
    ];
    if (reward.mercenary) rows.splice(2, 0, { icon: "1.9", text: `${reward.mercenary.name}经验 +${reward.mercenary.gainedExp}`, meta: reward.mercenary.expNeed ? `Lv.${reward.mercenary.level} ${reward.mercenary.exp}/${reward.mercenary.expNeed}` : "满级" });
    if (reward.career) rows.splice(1, 0, { icon: "1.49", text: `职业经验 +${reward.career.gainedExp}`, meta: reward.career.expNeed ? `Lv.${reward.career.level} ${reward.career.exp}/${reward.career.expNeed}` : "满级" });
    if (reward.roleLevelUp) rows.unshift({ icon: STAT_ICONS.exp, text: `角色升级 ${reward.previousLevel} -> ${reward.level}`, meta: "升级" });
    if (reward.career?.levelUp) rows.unshift({ icon: "1.49", text: `职业升级 ${reward.career.previousLevel} -> ${reward.career.level}`, meta: reward.career.name });
    if (reward.petLevelUp) rows.unshift({ icon: "2.12", text: `宠物升级 ${reward.previousPetLevel} -> ${reward.petLevel}`, meta: "升级" });
    if (reward.mercenary?.levelUp) rows.unshift({ icon: "1.9", text: `${reward.mercenary.name}升级 ${reward.mercenary.previousLevel} -> ${reward.mercenary.level}`, meta: "升级" });
    if (reward.equipment) {
      rows.push({ icon: reward.equipment.icon || "2.18", text: formatEquipment(reward.equipment), meta: "装备" });
    }
    if (reward.soulPowder) {
      rows.push({ icon: "1.11", text: `灵魂粉末 +${reward.soulPowder}`, meta: reward.immortalBossName || `当前 ${reward.currentSoulPowder || 0}` });
    }
    if (reward.immortalPill) {
      rows.push({ icon: "1.49", text: `仙丹 +${reward.immortalPill}`, meta: reward.immortalBossName || `当前 ${reward.currentImmortalPill || 0}` });
    }
    (reward.items || []).forEach((item) => {
      rows.push({ icon: item.icon || "1.49", text: `${item.name} +${item.quantity || 1}`, meta: reward.elfKingVaultName || "宝库", className: "rare-fragment" });
    });
    if (reward.titleReward) {
      rows.push({ icon: "1.49", text: reward.titleReward.title, meta: "1天称号", className: "rare-fragment" });
    }
    (reward.fragments || []).forEach((fragment) => {
      rows.push({ icon: fragment.icon || "1.49", text: `${fragment.name} +${fragment.quantity}`, meta: "碎片", className: "rare-fragment" });
    });
    list.innerHTML = rows.map((row) => `
      <div class="battle-reward-row ${escapeHtml(`${row.className || ""} ${String(row.text || "").includes("绝世") ? "peerless-reward" : ""}`.trim())}">
        ${rewardIconHtml(row.icon)}
        <span>${battleRewardTextHtml(row.text)}</span>
        <small>${escapeHtml(row.meta)}</small>
      </div>
    `).join("");
  }
  panel.classList.add("active");
  prepareRewardDialog(panel);
}

function battleRewardTextHtml(text) {
  return String(text).includes("绝世") ? peerlessColorText(text) : escapeHtml(text);
}

function closeBattleRewardPanel() {
  $("#battleRewardPanel")?.classList.remove("active");
  stopRewardDialogAnimation();
}

function activeRewardDialog() {
  return document.querySelector(".battle-reward-panel.active");
}

function closeActiveRewardDialog() {
  const panel = activeRewardDialog();
  if (!panel) return false;
  if (panel.id === "privateChatDialog") closePrivateChatDialog();
  else if (panel.id === "infoDialogPanel") closeInfoDialog();
  else if (panel.id === "soulPowderRewardPanel") closeSoulPowderRewardPanel();
  else closeBattleRewardPanel();
  return true;
}

function prepareRewardDialog(panel) {
  decorateMenuFrame(panel?.querySelector(".reward-dialog-title"));
  decorateMenuFrame(panel?.querySelector(".reward-dialog-content"));
  startRewardDialogAnimation(panel);
}

function stopRewardDialogAnimation() {
  rewardDialogAnimationToken += 1;
  if (rewardDialogAnimationFrame) cancelAnimationFrame(rewardDialogAnimationFrame);
  rewardDialogAnimationFrame = 0;
}

async function startRewardDialogAnimation(panel) {
  stopRewardDialogAnimation();
  const token = rewardDialogAnimationToken;
  const canvas = panel?.querySelector(".reward-dialog-chj");
  if (!canvas) return;
  try {
    const sprite = await loadSprite(15);
    if (token !== rewardDialogAnimationToken || !panel.classList.contains("active")) return;
    const ctx = canvas.getContext("2d");
    const frames = (sprite.animations[0] || [0]).filter((frame) => frame !== 255 && frame != null);
    const draw = (now) => {
      if (token !== rewardDialogAnimationToken || !panel.classList.contains("active")) return;
      const raw = frames[Math.floor(now / 220) % Math.max(1, frames.length)] ?? 0;
      const frame = { index: raw >= 128 ? raw - 128 : raw, flip: raw >= 128 };
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawSpriteFrame(ctx, sprite, frame, 2, canvas.height - sprite.frameHeight, sprite.frameWidth, sprite.frameHeight);
      rewardDialogAnimationFrame = requestAnimationFrame(draw);
    };
    rewardDialogAnimationFrame = requestAnimationFrame(draw);
  } catch (error) {
    console.warn("奖励弹窗 CHJ 15 加载失败", error);
  }
}

function makeFighter(actor, side, index = 0) {
  return battleEngine.makeFighter(actor, side, index);
}

function cloneBattleActor(actor, overrides = {}) {
  const clone = createActor({
    name: overrides.name || actor.name,
    spriteId: actor.spriteId,
    x: actor.x,
    y: actor.y,
    petId: actor.petId || null
  });
  clone.direction = actor.direction || "down";
  clone.isPet = overrides.isPet ?? actor.isPet === true;
  clone.battleStats = overrides.battleStats || actor.battleStats || null;
  clone.wildMonsterId = overrides.wildMonsterId || actor.wildMonsterId || "";
  return clone;
}

function onlineTeamMembers() {
  return teamRuntime.onlineTeamMembers();
}

function teamSizeForBattle() {
  return teamRuntime.teamSizeForBattle();
}

function wildMonsterCountForTeam(size) {
  return teamRuntime.wildMonsterCountForTeam(size);
}

function createAfeiBossNpc() {
  const npc = createActor({ name: "阿飞", spriteId: 234, x: 11 * 16, y: 9 * 16 });
  npc.mapName = NEW_FIELD_MAP;
  npc.staticNpc = true;
  npc.wildMonsterId = "afei";
  npc.battleStats = mergeStats(wildMonsterTable.afei.stats, { skillId: wildMonsterTable.afei.stats.skillId });
  return npc;
}

function immortalBossStats(boss) {
  return {
    hp: boss.hp,
    defense: STAT_LIMITS.defense,
    speed: 2100,
    attack: 1,
    mana: 1,
    crit: 0,
    critDamage: 100,
    skill: skillById(boss.skillIds[0]).name,
    skillId: boss.skillIds[0],
    skillIds: boss.skillIds,
    forceBasicAttack: false,
    power: 1,
    manaScale: 0
  };
}

function elfVaultStats(entry, stage) {
  const skillIds = entry.skillIds || [entry.skillId || "shining_strike"];
  const skillId = entry.skillId || skillIds[0] || "shining_strike";
  return {
    hp: entry.hp,
    defense: entry.defense || 0,
    speed: entry.speed || 1,
    attack: entry.attack || 1,
    mana: entry.mana || 1,
    crit: entry.crit || 0,
    critDamage: entry.critDamage || 100,
    skill: skillById(skillId).name,
    skillId,
    skillIds,
    forceBasicAttack: entry.forceBasicAttack === true,
    power: 1,
    manaScale: 0,
    passiveRebirthChance: entry.passiveRebirthChance || 0,
    passiveRebirthOnce: entry.passiveRebirthOnce === true,
    passiveCounter: skillIds.includes("holy_counter"),
    passiveLifesteal: skillIds.includes("holy_lifesteal") ? 0.5 : 0,
    passiveBreakArmor: skillIds.includes("holy_break_armor"),
    controlImmune: entry.controlImmune === true,
    periodicSkillId: entry.periodicSkillId || "",
    periodicEvery: entry.periodicEvery || 0,
    stageId: stage?.id || "",
    stageName: stage?.name || ""
  };
}

function applyElfKingVaultAdventureStats(stats) {
  if (!elfKingVaultAdventureDifficultyEnabled()) return stats;
  const base = wildMonsterTable.afei.stats;
  return {
    ...stats,
    hp: base.hp,
    defense: base.defense,
    speed: base.speed,
    attack: base.attack,
    mana: base.mana,
    crit: base.crit,
    critDamage: base.critDamage
  };
}

function createPhantomNpc() {
  const npc = createActor({ name: "幻影管理员", spriteId: 2033, x: 7 * 16, y: 10 * 16 });
  npc.mapName = NEW_ROXAS_HOME_MAP;
  npc.staticNpc = true;
  npc.phantomNpc = true;
  return npc;
}

function createRoleChangeNpc() {
  const npc = createActor({ name: "转职导师", spriteId: 2037, x: 32, y: 272 });
  npc.mapName = NEW_ROXAS_HOME_MAP;
  npc.staticNpc = true;
  npc.roleChangeNpc = true;
  return npc;
}

function createStatRankingNpc() {
  const npc = createActor({ name: "排行官", spriteId: 20, x: 144, y: 208 });
  npc.mapName = NEW_ROXAS_HOME_MAP;
  npc.staticNpc = true;
  npc.statRankingNpc = true;
  return npc;
}

function createDiziNpc() {
  const npc = createActor({ name: "笛子", spriteId: 2015, x: 4 * 16, y: 12 * 16 });
  npc.mapName = NEW_MARKET_MAP;
  npc.staticNpc = true;
  npc.npcId = "dizi";
  npc.diziNpc = true;
  npc.direction = "right";
  npc.frameIndex = 1;
  npc.frameFlip = true;
  return npc;
}

function createImmortalBossNpcs() {
  const positions = [
    [7, 4],
    [11, 8],
    [10, 14],
    [4, 14],
    [3, 8]
  ];
  return immortalBosses.map((boss, index) => {
    const [tileX, tileY] = positions[index];
    const npc = createActor({ name: boss.name, spriteId: boss.spriteId, x: tileX * 16, y: tileY * 16 });
    npc.mapName = "仙人";
    npc.staticNpc = true;
    npc.wildMonsterId = boss.id;
    npc.immortalBossId = boss.id;
    npc.battleStats = immortalBossStats(boss);
    return npc;
  });
}

function createAfeiBattleEnemies(anchor = state.player) {
  const monster = wildMonsterTable.afei;
  const tileX = Math.floor((anchor?.x || state.player?.x || 0) / 16);
  const baseY = anchor?.y || state.player?.y || 0;
  const boss = createActor({
    name: monster.name,
    spriteId: monster.spriteId,
    x: Math.min(state.map.width - 2, tileX + 3) * 16,
    y: baseY
  });
  boss.wildMonsterId = "afei";
  boss.battleStats = mergeStats(monster.stats, { skillId: monster.stats.skillId });
  const minions = monster.minion.names.map((name, index) => {
    const minion = createActor({
      name,
      spriteId: monster.minion.spriteId,
      x: Math.min(state.map.width - 2, tileX + 2 + (index % 3)) * 16,
      y: baseY + (Math.floor(index / 3) + 1) * 4
    });
    minion.wildMonsterId = "afei";
    minion.battleStats = mergeStats(monster.minion.stats, { skillId: monster.minion.stats.skillId });
    minion.forceBasicAttack = true;
    return minion;
  });
  return [boss, ...minions];
}

async function startAfeiBossBattle() {
  if (!state.player || state.battle || ![NEW_FIELD_MAP, "\u539f\u91ce\u602a\u533a"].includes(state.mapName)) return;
  const boss = localActorsOnCurrentMap().find((actor) => actor.wildMonsterId === "afei") || createAfeiBossNpc();
  await startBattle(boss);
}

async function startIdleHuntBossBattle() {
  if (!state.player || state.battle || ![NEW_FIELD_MAP, "\u539f\u91ce\u602a\u533a"].includes(state.mapName)) return;
  const boss = findIdleHuntBossById(state.idleHuntBossId);
  if (!boss) {
    stopIdleHunt("附近Boss已不存在，挂机已取消");
    return;
  }
  await startBattle(boss);
}

function alliedBattleActors() {
  const actors = [state.player, state.pet].filter(Boolean);
  const mercenary = battleMercenaryActor();
  if (mercenary) actors.push(mercenary);
  for (const { peer } of onlineTeamMembers()) {
    actors.push(peer);
    if (peer.pet) actors.push(peer.pet);
    if (peer.mercenary) actors.push(peer.mercenary);
  }
  return actors;
}

function battleMercenaryActor() {
  const mercenary = activeMercenary();
  if (!mercenary) return null;
  const actor = createActor({
    name: mercenary.name,
    spriteId: mercenary.spriteId || mercenaryTypes[mercenary.type]?.spriteId || 869,
    x: state.player?.x || 0,
    y: state.player?.y || 0
  });
  actor.isMercenary = true;
  actor.mercenaryData = mercenary;
  actor.battleStats = statsForMercenary(mercenary);
  return actor;
}

function applySelfShield(fighter, action) {
  return battleEngine.applySelfShield(fighter, action);
}

function applyBattlePassives(team) {
  return battleEngine.applyBattlePassives(team);
}

function hideBattleActors(target) {
  hideLocalBattleActorsAt({
    x: Math.round(((state.player.x + target.x) / 2) / 16) * 16,
    y: Math.round(((state.player.y + target.y) / 2) / 16) * 16
  }, [target, target?.pet]);
}

function hideLocalBattleActorsAt(marker, additionalActors = []) {
  if (!state.player || !marker) return;
  state.hiddenOnMap.clear();
  [state.player, state.pet, ...additionalActors].filter(Boolean).forEach((actor) => state.hiddenOnMap.add(actor));
  state.battleMarker = createActor({
    name: "战斗",
    spriteId: 23,
    x: marker.x,
    y: marker.y
  });
  state.battleMarker.isBattleMarker = true;
  state.battleMarker.battleId = "";
}

function restoreBattleActors() {
  state.hiddenOnMap.clear();
  state.battleMarker = null;
}

function battleMarkerSnapshot() {
  return state.battleMarker ? { x: state.battleMarker.x, y: state.battleMarker.y, mapName: state.mapName } : null;
}

function battleActorSnapshot(actor) {
  return battleProtocol.battleActorSnapshot(actor);
}

function battleActorFromSnapshot(data) {
  return battleProtocol.battleActorFromSnapshot(data);
}

function battleActorFromAnySnapshot(data) {
  if (!data) return null;
  if ("s" in data || "bs" in data || "wm" in data) return battleActorFromSnapshot(data);
  const actor = createActor({
    name: data.name || "",
    spriteId: data.spriteId || 0,
    x: data.x || 0,
    y: data.y || 0
  });
  actor.direction = data.direction || "down";
  actor.ownerPeerId = data.ownerPeerId || "";
  actor.ownerName = data.ownerName || "";
  actor.isPet = data.isPet === true;
  actor.isMercenary = data.isMercenary === true;
  actor.mercenaryData = data.mercenaryData || null;
  actor.battleStats = data.battleStats || null;
  actor.wildMonsterId = data.wildMonsterId || "";
  actor.immortalBossId = data.immortalBossId || "";
  actor.elfKingVaultBossId = data.elfKingVaultBossId || "";
  actor.elfKingVaultStageId = data.elfKingVaultStageId || "";
  actor.forceBasicAttack = data.forceBasicAttack === true || data.battleStats?.forceBasicAttack === true;
  return actor;
}

function sendTeamBattleMessage(type, battleId, payload = {}) {
  teamRuntime.sendTeamBattleMessage(type, battleId, payload);
}

function sendTeamBattleMessageReliable(type, battleId, payload = {}) {
  teamRuntime.sendTeamBattleMessageReliable(type, battleId, payload);
}

function sendBattleEndReliable(battleId, opponentPeerId = "") {
  if (opponentPeerId) sendRoomMessage({ type: "battleEnd", battleId, to: opponentPeerId });
}

function isTeamMessageForMe(msg) {
  return teamRuntime.isTeamMessageForMe(msg);
}

function isActiveTeamBattleMessage(msg) {
  return teamRuntime.isActiveTeamBattleMessage(msg) && rosterMatchesBattle(msg);
}

async function showRemoteBattleMarker(msg) {
  const markerData = msg.marker;
  const battleId = String(msg.battleId || "");
  if (!markerData || !battleId || state.endedRemoteBattleMarkerIds.has(battleId)) return;
  await loadSprite(23);
  if (state.endedRemoteBattleMarkerIds.has(battleId)) return;
  const marker = createActor({ name: "战斗", spriteId: 23, x: markerData.x, y: markerData.y });
  marker.mapName = markerData.mapName || state.mapName;
  marker.isBattleMarker = true;
  marker.battleId = battleId;
  marker.participants = markerData.participants || [];
  for (const [existingBattleId, existingMarker] of state.remoteBattleMarkers) {
    if (existingBattleId !== battleId && remoteBattleMarkersShareParticipant(existingMarker, marker)) {
      state.remoteBattleMarkers.delete(existingBattleId);
    }
  }
  state.remoteBattleMarkers.delete(battleId);
  state.remoteBattleMarkers.set(battleId, marker);
  while (state.remoteBattleMarkers.size > MAX_REMOTE_BATTLE_MARKERS) {
    state.remoteBattleMarkers.delete(state.remoteBattleMarkers.keys().next().value);
  }
}

function removeRemoteBattleMarker(battleId) {
  const normalizedBattleId = String(battleId || "");
  if (!normalizedBattleId) return;
  state.remoteBattleMarkers.delete(normalizedBattleId);
  addBoundedId(state.endedRemoteBattleMarkerIds, normalizedBattleId, MAX_REMOTE_BATTLE_MARKERS * 4);
}

function remoteBattleMarkersShareParticipant(first, second) {
  const participantIds = new Set((first?.participants || []).map((participant) => participant.peerId).filter(Boolean));
  return (second?.participants || []).some((participant) => participant.peerId && participantIds.has(participant.peerId));
}

function isRemoteBattleParticipant(actor) {
  const peerId = actor?.ownerPeerId || findPeerIdByActor(actor);
  if (!peerId) return false;
  return [...state.remoteBattleMarkers.values()].some((marker) =>
    (marker.participants || []).some((participant) => participant.peerId === peerId)
  );
}

function battleRejectText(reason) {
  return ({
    busy: "对方正在战斗，强杀取消",
    stall: "对方摆摊中，强杀取消",
    same_team: "不能挑战队友",
    version_mismatch: "双方版本不一致，请刷新后再强杀",
    asset_failed: "对方资源未准备好，强杀取消",
    timeout: "对方无响应，强杀取消",
    invalid: "对方状态异常，强杀取消",
    attacker_offline: "本机实时连接未登记，请刷新后重试",
    battle_start_failed: "服务器未接收挑战请求",
    battle_start_rejected: "服务器拒绝创建战斗，请确认双方在线"
  })[reason] || "对方无法进入战斗，强杀取消";
}

function clearPendingBattleInvite(battleId = "") {
  const pending = state.pendingBattleInvite;
  if (!pending || (battleId && pending.battleId !== battleId)) return null;
  clearTimeout(pending.timeoutId);
  state.pendingBattleInvite = null;
  return pending;
}

function isTeammatePeerId(peerId = "") {
  if (!peerId) return false;
  if (peerId === state.peerId) return true;
  if (state.followLeaderId) {
    if (peerId === state.followLeaderId) return true;
    return (state.team.members || []).some((member) => resolvePeerId(member.peerId) === peerId || member.peerId === peerId);
  }
  return (state.team.members || []).some((member) => resolvePeerId(member.peerId) === peerId || member.peerId === peerId);
}

function battleStatePayload({
  battleId,
  role,
  opponentPeerId = "",
  playerTeam,
  enemyTeam,
  wildMonsterId = "",
  immortalBossId = "",
  monsterCount = 1,
  teamRoster = []
}) {
  return battleProtocol.battleStatePayload({
    battleId,
    role,
    opponentPeerId,
    playerTeam,
    enemyTeam,
    wildMonsterId,
    immortalBossId,
    monsterCount,
    teamRoster
  });
}

let battleTransitionRunId = 0;

function playBattleTransition(onCovered, orientation = Math.random() > 0.5 ? "vertical" : "horizontal", onComplete = null) {
  const transition = $("#battleTransition");
  if (!transition) {
    onCovered?.();
    onComplete?.();
    return;
  }

  const runId = ++battleTransitionRunId;
  const sliceCount = 8;
  const slicePercent = 100 / sliceCount;
  const vertical = orientation === "vertical";
  const blades = [];
  let maxDuration = 0;

  transition.replaceChildren();
  transition.className = `battle-transition active ${vertical ? "vertical" : "horizontal"}`;

  for (let index = 0; index < sliceCount; index += 1) {
    const firstHalf = index < sliceCount / 2;
    const distanceFromCenter = firstHalf ? sliceCount / 2 - 1 - index : index - sliceCount / 2;
    const duration = 300 + distanceFromCenter * 200;
    const blade = document.createElement("i");
    blade.className = "battle-transition-blade";
    blade.style.transitionDuration = `${duration}ms`;

    if (vertical) {
      blade.style.left = `${index * slicePercent}%`;
      blade.style.top = "0";
      blade.style.width = `calc(${slicePercent}% + 1px)`;
      blade.style.height = "100%";
      blade.style.transformOrigin = firstHalf ? "right center" : "left center";
      blade.style.transform = "scaleX(0)";
      blades.push({
        element: blade,
        closeOrigin: firstHalf ? "right center" : "left center",
        openOrigin: firstHalf ? "left center" : "right center",
        openTransform: "scaleX(0)",
        closeTransform: "scaleX(1.02)"
      });
    } else {
      blade.style.left = "0";
      blade.style.top = `${index * slicePercent}%`;
      blade.style.width = "100%";
      blade.style.height = `calc(${slicePercent}% + 1px)`;
      blade.style.transformOrigin = firstHalf ? "bottom center" : "top center";
      blade.style.transform = "scaleY(0)";
      blades.push({
        element: blade,
        closeOrigin: firstHalf ? "bottom center" : "top center",
        openOrigin: firstHalf ? "top center" : "bottom center",
        openTransform: "scaleY(0)",
        closeTransform: "scaleY(1.02)"
      });
    }

    maxDuration = Math.max(maxDuration, duration);
    transition.appendChild(blade);
  }

  requestAnimationFrame(() => {
    if (runId !== battleTransitionRunId) return;
    for (const blade of blades) {
      blade.element.style.transformOrigin = blade.closeOrigin;
      blade.element.style.transform = blade.closeTransform;
    }

    setTimeout(() => {
      if (runId !== battleTransitionRunId) return;
      try {
        onCovered?.();
      } catch (error) {
        console.error("[battle-transition-swap-error]", error);
      }

      for (const blade of blades) {
        blade.element.style.transformOrigin = blade.openOrigin;
        blade.element.style.transform = blade.openTransform;
      }

      setTimeout(() => {
        if (runId !== battleTransitionRunId) return;
        transition.className = "battle-transition";
        transition.replaceChildren();
        onComplete?.();
      }, maxDuration + 80);
    }, maxDuration + 50);
  });
}

function enterBattleAfterTransition(battleData) {
  playBattleTransition(() => {
    if (state.canceledBattleIds.has(battleData.id)) {
      state.canceledBattleIds.delete(battleData.id);
      restoreBattleActors();
      return;
    }
    state.battle = battleData;
    $("#battleOverlay").classList.add("active");
    renderBattle();
    if (state.battle.autoBattle) queueAutoBattleStep(120);
    broadcastState(true);
  });
}

function activePveEncounter(monsterId) {
  const encounter = state.pveEncounter;
  if (!encounter || encounter.expiresAt <= Date.now()) {
    state.pveEncounter = null;
    return null;
  }
  return encounter.monsterId === monsterId ? encounter : null;
}

function isEncounterWildBattle(target) {
  return target?.wildMonsterId === "amumu" || target?.wildMonsterId === "phantom";
}

function isServerPveBattle(target) {
  return isEncounterWildBattle(target) || target?.wildMonsterId === "afei";
}

async function startBattle(target) {
  if (!state.player || state.battle || state.pendingBattleInvite) return;
  if (state.stall.active) {
    showMenuHint("摆摊中不能战斗");
    return;
  }
  if (target?.stall) {
    showMenuHint("摆摊中不能强杀");
    return;
  }
  const blocked = battleTargetBlocked(target);
  if (blocked) {
    showMenuHint(blocked);
    return;
  }
  closeBattleRewardPanel();
  $("#nearbyPanel").classList.remove("active");
  if (await refreshClientVersion({ forceReload: true })) return;
  if (!state.player || state.battle || state.pendingBattleInvite) return;
  const targetPeerId = findPeerIdByActor(target);
  const battleId = `${state.peerId}-${Date.now()}`;
  const teamRoster = target.wildMonsterId ? activeTeamRoster() : [];
  const allies = target.wildMonsterId ? alliedBattleActors() : [state.player, state.pet, battleMercenaryActor()].filter(Boolean);
  const vaultStage = elfKingVault.stageById(target.elfKingVaultBossId);
  const enemyActors = vaultStage
    ? createElfKingVaultBattleEnemies(vaultStage, target)
    : target.wildMonsterId === "afei" ? createAfeiBattleEnemies(target) : (target.wildEnemies || [target, target.pet, target.mercenary].filter(Boolean));
  if (targetPeerId) {
    if (!realtimeReady(true)) return;
    if (isTeammatePeerId(targetPeerId)) {
      showMenuHint("不能挑战队友");
      return;
    }
    const peerVersion = state.peers.get(targetPeerId)?.clientVersion || "";
    if (state.clientVersion && peerVersion && peerVersion !== state.clientVersion) {
      showMenuHint("对方版本较旧，请双方刷新后再强杀");
      return;
    }
    const marker = battleMarkerSnapshotFor(target);
    sendRoomMessage({ type: "battleMarker", battleId, marker });
    const attackerMercenary = battleMercenaryActor();
    const timeoutId = setTimeout(() => {
      if (!clearPendingBattleInvite(battleId)) return;
      sendRoomMessage({ type: "battleMarkerEnd", battleId });
      showMenuHint("服务器同步战斗超时，请重试");
    }, Math.max(PVP_BATTLE_INVITE_TIMEOUT_MS, 15000));
    state.pendingBattleInvite = {
      battleId,
      targetPeerId,
      targetSnapshot: actorSnapshot(target),
      expiresAt: Date.now() + PVP_BATTLE_INVITE_TIMEOUT_MS,
      timeoutId
    };
    showMenuHint("等待服务器同步战斗...");
    try {
      const result = await postApi("/api/online-pvp/start", {
        account: state.account,
        battleId,
        defenderId: targetPeerId,
        defenderName: target.ownerName || target.name || "",
        defenderAccount: state.peers.get(targetPeerId)?.account || target.account || "",
        attacker: actorSnapshot(state.player),
        attackerPet: state.pet ? actorSnapshot(state.pet) : null,
        attackerMercenary: attackerMercenary ? actorSnapshot(attackerMercenary) : null,
        pvpMode: currentPvpMode(),
        marker,
        clientVersion: state.clientVersion || ""
      });
      if (!result?.ok) throw new Error(result?.error || "battle_start_failed");
    } catch (error) {
      clearPendingBattleInvite(battleId);
      sendRoomMessage({ type: "battleMarkerEnd", battleId });
      showMenuHint(`服务器同步战斗失败：${battleRejectText(error.message)}`);
    }
    return;
  }
  await Promise.all([
    loadSprite(23),
    loadImage("资源/图片/战斗数字.png"),
    loadImage("资源/图片/战斗箭头.png"),
    loadImage(BATTLE_ARBITRATION_EFFECT_SRC),
    loadImage("资源/图片/blood.png"),
    ...battleEffectIdsFor(...allies, ...enemyActors).map((id) => loadSpriteOptional(id)),
    ...battleSpriteLoadPromisesFor(...allies, ...enemyActors)
  ]);
  await hydrateImageCache();
  hideBattleActors(target);
  if (state.battleMarker) state.battleMarker.battleId = battleId;
  const marker = battleMarkerSnapshotFor(target);
  sendRoomMessage({ type: "battleMarker", battleId, marker });
  if (isServerPveBattle(target)) {
    if (!realtimeReady(true)) {
      restoreBattleActors();
      sendRoomMessage({ type: "battleMarkerEnd", battleId });
      return;
    }
    const encounter = isEncounterWildBattle(target) ? activePveEncounter(target.wildMonsterId) : null;
    if (isEncounterWildBattle(target) && !encounter) {
      restoreBattleActors();
      sendRoomMessage({ type: "battleMarkerEnd", battleId });
      sendRoomMessage({ type: "pveIdleEncounterRequest" });
      showMenuHint("等待服务器确认野怪遭遇...");
      return;
    }
    state.pendingTeamPveBattleId = battleId;
    showMenuHint("等待服务器同步 PVE 战斗...");
    try {
      const result = await postApi("/api/online-pve/start", {
        account: state.account,
        battleId,
        encounterId: encounter?.id || "",
        leaderId: state.peerId,
        attackerId: state.peerId,
        roster: teamRoster,
        wildMonsterId: target.wildMonsterId || "",
        monsterCount: enemyActors.length,
        enemies: enemyActors.map(battleActorSnapshot),
        marker
      });
      if (!result?.ok) throw new Error(result?.error || "battle_start_failed");
      state.pveEncounter = null;
    } catch (error) {
      state.pendingTeamPveBattleId = "";
      if (state.battleMarker?.battleId === battleId) restoreBattleActors();
      sendRoomMessage({ type: "battleMarkerEnd", battleId });
      showMenuHint(`队伍战斗同步失败：${battleRejectText(error.message)}`);
      return;
    }
    setTimeout(() => {
      if (state.pendingTeamPveBattleId !== battleId) return;
      state.pendingTeamPveBattleId = "";
      if (state.battle?.id === battleId) return;
      if (state.battleMarker?.battleId === battleId) restoreBattleActors();
      sendRoomMessage({ type: "battleMarkerEnd", battleId });
      showMenuHint("队伍战斗同步失败，请确认队友在线后重试");
    }, 5000);
    return;
  }
  enterBattleAfterTransition(battleStatePayload({
    battleId,
    role: "attacker",
    opponentPeerId: "",
    playerTeam: allies,
    enemyTeam: enemyActors,
    wildMonsterId: target.wildMonsterId || "",
    immortalBossId: target.immortalBossId || "",
    monsterCount: enemyActors.length,
    teamRoster
  }));
}

async function startWildBattle() {
  if (!state.player || state.battle || !canIdleHuntHere()) return;
  const isPhantom = state.mapName === "幻影狩猎场";
  const monster = isPhantom ? wildMonsterTable.phantom : wildMonsterTable.amumu;
  const count = wildMonsterCountForTeam(teamSizeForBattle());
  await Promise.all([loadSprite(monster.spriteId), loadSpriteOptional(battleAttackSpriteId({ spriteId: monster.spriteId }))]);
  const wildEnemies = Array.from({ length: count }, (_, index) => {
    const wild = createActor({
      name: count === 1 ? monster.name : `${monster.name}${index + 1}`,
      spriteId: monster.spriteId,
      x: Math.min(state.map.width - 2, Math.floor(state.player.x / 16) + 2 + (index % 2)) * 16,
      y: state.player.y + Math.floor(index / 2) * 4
    });
    wild.wildMonsterId = isPhantom ? "phantom" : "amumu";
    wild.battleStats = mergeStats(monster.stats, { skillId: monster.stats.skillId });
    return wild;
  });
  const wild = wildEnemies[0];
  wild.wildEnemies = wildEnemies;
  await startBattle(wild);
}

function handleBattleRejected(msg) {
  if (state.pendingTeamPveBattleId === msg.battleId) {
    state.pendingTeamPveBattleId = "";
    if (state.battleMarker?.battleId === msg.battleId) restoreBattleActors();
    sendRoomMessage({ type: "battleMarkerEnd", battleId: msg.battleId });
    showMenuHint(battleRejectText(msg.reason));
    return;
  }
  if (!clearPendingBattleInvite(msg.battleId)) return;
  sendRoomMessage({ type: "battleMarkerEnd", battleId: msg.battleId });
  showMenuHint(battleRejectText(msg.reason));
}

async function acceptTeamBattle(msg) {
  if (!state.player) return;
  if (state.battle?.id === msg.battleId) return;
  if (msg.teamBattleServer && state.pendingTeamPveBattleId === msg.battleId) {
    state.pendingTeamPveBattleId = "";
  }
  if (msg.pvp) clearPendingBattleInvite(msg.battleId);
  if (!msg.pvp && !msg.teamBattleServer) {
    if (!state.followLeaderId || msg.leaderId !== state.followLeaderId) return;
    if (msg.roster?.length && !rosterHasMe(msg.roster)) return;
    const myName = state.player?.name || state.account;
    const stillInTeam = (state.team.members || []).some((member) => member.peerId === state.peerId || member.name === myName)
      || state.followLeaderId === msg.leaderId;
    if (!stillInTeam) return;
  }
  if (msg.teamBattleServer && msg.roster?.length && !rosterHasMe(msg.roster)) return;
  if (state.battle) return;
  closeBattleRewardPanel();
  const serverAllies = (msg.allies || []).map(battleActorFromAnySnapshot).filter(Boolean);
  const serverEnemies = (msg.enemies || []).map(battleActorFromAnySnapshot).filter(Boolean);
  const allies = serverAllies;
  const enemies = serverEnemies;
  try {
    await Promise.all([
      loadSprite(23),
      loadImage("资源/图片/战斗数字.png"),
      loadImage("资源/图片/战斗箭头.png"),
      loadImage(BATTLE_ARBITRATION_EFFECT_SRC),
      loadImage("资源/图片/blood.png"),
      ...battleEffectIdsFor(...allies, ...enemies).map((id) => loadSpriteOptional(id)),
      ...battleSpriteLoadPromisesFor(...allies, ...enemies)
    ]);
  } catch (error) {
    console.warn("team battle assets failed", error);
  }
  await hydrateImageCache();
  if (msg.marker) await showRemoteBattleMarker({ battleId: msg.battleId, marker: msg.marker });
  if (msg.marker) {
    hideLocalBattleActorsAt(msg.marker);
    if (state.battleMarker) state.battleMarker.battleId = msg.battleId;
  }
  playBattleTransition(() => {
    const serverAutoBattle = msg.teamBattleServer === true && msg.pvp !== true && state.autoBattlePersistent === true;
    state.battle = {
      id: msg.battleId,
      role: msg.pvp ? (msg.role || "attacker") : (msg.teamBattleServer ? "attacker" : "team_member"),
      pvp: msg.pvp === true,
      opponentPeerId: "",
      playerTeam: allies.map((actor, index) => makeFighter(actor, "ally", index)),
      enemyTeam: enemies.map((actor, index) => makeFighter(actor, "enemy", index)),
      waiting: msg.teamBattleServer === true,
      ending: false,
      choices: {},
      choiceStep: msg.teamBattleServer ? "" : "actor",
      selectedTarget: "",
      pendingAction: null,
      targeting: false,
      selectedCommand: serverAutoBattle ? "auto" : "attack",
      rewardClaimed: false,
      wildMonsterId: msg.wildMonsterId || "",
      monsterCount: (msg.enemies || []).length || 1,
      teamRoster: msg.roster || [],
      commandFocus: battleCommands.findIndex((item) => item.key === (serverAutoBattle ? "auto" : "attack")),
      menuMode: "command",
      submenuIndex: 0,
      autoBattle: serverAutoBattle,
      autoStepQueued: false,
      openingSpeechDone: false,
      commandHint: msg.pvp ? "服务端同步 PVP，等待手动操作" : (serverAutoBattle ? "服务端同步 PVE，自动战斗中" : "服务端同步 PVE，等待手动操作"),
      choiceDeadline: msg.teamBattleServer ? performance.now() + (msg.choiceMs || BATTLE_CHOICE_MS) : 0,
      lastChoiceSecond: msg.teamBattleServer ? Math.ceil((msg.choiceMs || BATTLE_CHOICE_MS) / 1000) : 0,
      floatNumbers: [],
      floatTexts: [],
      effects: [],
      lastEffectTime: performance.now(),
      cameraShakeUntil: 0,
      cameraShakeStrength: 0,
      teamBattleServer: msg.teamBattleServer === true
    };
    if (msg.teamBattleServer) state.battle.choiceStep = firstControllableChoiceStep();
    $("#battleOverlay").classList.add("active");
    renderBattle();
    if (state.battle.autoBattle && state.battle.waiting) queueAutoBattleStep(120);
  });
}

function actorSnapshot(actor) {
  return battleProtocol.actorSnapshot(actor);
}

function actorFromSnapshot(data) {
  return battleProtocol.actorFromSnapshot(data);
}

function alive(team) {
  return team.filter((fighter) => !fighter.defeated && fighter.hp > 0);
}

function fighterRef(fighter) {
  return fighter?.battleId || fighter?.name || "";
}

function findFighterByRef(team, ref = "") {
  return team.find((fighter) => fighter.battleId === ref) || team.find((fighter) => fighter.name === ref) || null;
}

function allBattleFighters() {
  const battle = state.battle;
  return battle ? [...battle.playerTeam, ...battle.enemyTeam] : [];
}

function findBattleFighterByRef(ref = "") {
  return allBattleFighters().find((fighter) => fighter.battleId === ref) || allBattleFighters().find((fighter) => fighter.name === ref) || null;
}

function pickTarget(team, targetRef = "") {
  const candidates = alive(team);
  return findFighterByRef(candidates, targetRef) || candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function effectiveStat(fighter, stat) {
  return battleEngine.effectiveStat(fighter, stat);
}

function fighterKind(fighter) {
  if (fighter?.actor?.isPet) return "pet";
  if (fighter?.actor?.isMercenary) return "mercenary";
  return "role";
}

function guardReductionFor(attacker, defender) {
  return battleEngine.guardReductionFor(attacker, defender);
}

function calcDamage(attacker, defender, useSkill, skillId = "") {
  return battleEngine.calcDamage(attacker, defender, useSkill, skillId);
}

function damageEvent(attacker, defender, amount, critical, type = "damage", useSkill = false) {
  defender.hp = Math.max(0, defender.hp - amount);
  if (defender.hp <= 0) defender.defeated = true;
  const reborn = defender.defeated
    && defender.passiveRebirthChance
    && (!defender.passiveRebirthOnce || !defender.passiveRebirthUsed)
    && Math.random() < defender.passiveRebirthChance;
  if (reborn) {
    defender.hp = Math.max(1, Math.round(defender.maxHp * 0.5));
    defender.defeated = false;
    if (defender.passiveRebirthOnce) defender.passiveRebirthUsed = true;
  }
  return {
    attacker: attacker.name,
    attackerId: fighterRef(attacker),
    defender: defender.name,
    defenderId: fighterRef(defender),
    amount,
    critical,
    hp: defender.hp,
    defeated: defender.defeated,
    reborn,
    passiveRebirthUsed: defender.passiveRebirthUsed === true,
    passiveRebirthOnce: defender.passiveRebirthOnce === true,
    statuses: normalizeBattleStatuses(defender.statuses),
    defenseCleared: defender.defenseCleared === true,
    damageReductionDown: defender.damageReductionDown || 0,
    buffs: { ...(defender.buffs || {}) },
    type,
    effectId: effectIdForActor(attacker.actor, useSkill)
  };
}

function battleSpeechEvent(speaker, text, duration = 2600) {
  return battleEngine.battleSpeechEvent(speaker, text, duration);
}

function chooseBattleAction(useSkill, skillId = "") {
  const battle = state.battle;
  if (!battle || !battle.waiting) return;
  if (!currentChoiceFighter()) {
    battle.choiceStep = firstControllableChoiceStep();
    if (!currentChoiceFighter()) return;
  }
  battle.selectedCommand = useSkill ? "skill" : "attack";
  const actor = currentChoiceFighter();
  const resolvedSkillId = useSkill ? (skillId || defaultBattleSkillIdForFighter(actor)) : "";
  if (useSkill && (!resolvedSkillId || !roleSkillUsableForFighter(resolvedSkillId, actor))) {
    battle.commandHint = "技能条件不足";
    battle.menuMode = "skill";
    battle.submenuIndex = 0;
    renderBattle();
    return;
  }
  battle.pendingAction = { type: useSkill ? "skill" : "attack", skillId: resolvedSkillId };
  const selectedSkill = useSkill ? skillById(resolvedSkillId) : null;
  if (selectedSkill && ["self_buff", "heal", "buff"].includes(selectedSkill.type)) {
    commitBattleAction("");
    return;
  }
  battle.targeting = true;
  const currentTarget = findBattleFighterByRef(battle.selectedTarget || "");
  const targetTeam = battleTargetTeam();
  battle.selectedTarget = currentTarget && targetTeam.includes(currentTarget)
    ? fighterRef(currentTarget)
    : firstAliveTargetName();
  renderBattle();
}

function cancelBattleTargetSelection() {
  const battle = state.battle;
  if (!battle || !battle.waiting || !battle.targeting) return false;
  const pendingAction = battle.pendingAction || null;
  battle.pendingAction = null;
  battle.targeting = false;
  battle.commandHint = "";
  if (pendingAction?.type === "skill") {
    battle.selectedCommand = "skill";
    battle.menuMode = "skill";
    const skills = currentBattleSkillMenu();
    const index = skills.findIndex((item) => item.id === pendingAction.skillId);
    battle.submenuIndex = index >= 0 ? index : 0;
  } else {
    battle.selectedCommand = "attack";
    battle.menuMode = "command";
    battle.submenuIndex = 0;
  }
  renderBattle();
  return true;
}

function currentChoiceFighter() {
  const battle = state.battle;
  if (!battle) return null;
  if (battle.teamBattleServer) return findBattleFighterByRef(battle.choiceStep || "");
  const team = battle.role === "defender" ? battle.enemyTeam : battle.playerTeam;
  if (battle.choiceStep === "mercenary") return team.find((fighter) => fighter.actor.isMercenary && !fighter.defeated);
  if (battle.choiceStep === "pet") return team.find((fighter) => fighter.actor.isPet && !fighter.defeated);
  return team.find((fighter) => !fighter.actor.isPet && !fighter.actor.isMercenary && !fighter.defeated);
}

function hasControllableActor() {
  const battle = state.battle;
  if (!battle) return false;
  if (battle.teamBattleServer) return teamRuntime.controlledFighterSteps(battle).some((ref) => {
    const fighter = findBattleFighterByRef(ref);
    return fighter && !fighter.actor.isPet && !fighter.actor.isMercenary && !fighter.defeated;
  });
  const team = battle.role === "defender" ? battle.enemyTeam : battle.playerTeam;
  return team.some((fighter) => !fighter.actor.isPet && !fighter.actor.isMercenary && !fighter.defeated);
}

function firstControllableChoiceStep() {
  const battle = state.battle;
  if (battle?.teamBattleServer) return teamRuntime.controlledFighterSteps(battle)[0] || "actor";
  if (hasControllableActor()) return "actor";
  if (hasControllablePet()) return "pet";
  if (hasControllableMercenary()) return "mercenary";
  return "actor";
}

function nextControllableChoiceStep(currentStep) {
  const battle = state.battle;
  if (battle?.teamBattleServer) {
    const steps = teamRuntime.controlledFighterSteps(battle);
    const index = steps.indexOf(currentStep);
    return index >= 0 && index < steps.length - 1 ? steps[index + 1] : "";
  }
  if (currentStep === "actor" && hasControllablePet()) return "pet";
  if ((currentStep === "actor" || currentStep === "pet") && hasControllableMercenary()) return "mercenary";
  return "";
}

function battleChoiceStepLabel(step = state.battle?.choiceStep || "actor") {
  if (state.battle?.teamBattleServer) {
    const fighter = findBattleFighterByRef(step);
    if (fighter?.actor?.isPet) return "宠物";
    if (fighter?.actor?.isMercenary) return "佣兵";
  }
  if (step === "pet") return "宠物";
  if (step === "mercenary") return "佣兵";
  return "人物";
}

function battleChoiceStepText() {
  const label = battleChoiceStepLabel();
  const fighter = currentChoiceFighter();
  return fighter?.name ? `${label}：${fighter.name}` : label;
}

function currentBattleSkillMenu() {
  const fighter = currentChoiceFighter();
  return activeBattleSkillsForFighter(fighter).map((id) => ({ id, label: skillById(id).name, type: "skill" }));
}

function chooseBattleCommand(command) {
  const battle = state.battle;
  if (!battle || battle.ending) return;
  battle.selectedCommand = command;
  battle.commandFocus = Math.max(0, battleCommands.findIndex((item) => item.key === command));
  if (command === "attack") {
    chooseBattleAction(false);
    return;
  }
  if (command === "skill") {
    openBattleSubmenu("skill");
    return;
  }
  if (command === "item") {
    openBattleSubmenu("item");
    return;
  }
  if (command === "auto") {
    toggleAutoBattle();
    return;
  }
  if (command === "escape") {
    escapeBattle();
    return;
  }
  battle.commandHint = "道具暂未开放";
  renderBattle();
}

function openBattleSubmenu(type) {
  const battle = state.battle;
  if (!battle || !battle.waiting || battle.targeting) return;
  battle.menuMode = type;
  battle.submenuIndex = 0;
  battle.commandHint = "";
  renderBattle();
}

function closeBattleSubmenu() {
  const battle = state.battle;
  if (!battle || battle.menuMode === "command") return false;
  battle.menuMode = "command";
  battle.submenuIndex = 0;
  renderBattle();
  return true;
}

function moveBattleCommand(direction) {
  const battle = state.battle;
  if (!battle || !battle.waiting || battle.targeting || battle.menuMode !== "command") return;
  battle.commandFocus = (battle.commandFocus + direction + battleCommands.length) % battleCommands.length;
  battle.selectedCommand = battleCommands[battle.commandFocus].key;
  renderBattle();
}

function moveBattleSubmenu(direction) {
  const battle = state.battle;
  if (!battle || battle.menuMode === "command") return;
  const list = battle.menuMode === "skill" ? currentBattleSkillMenu() : battleItemMenu;
  if (!list.length) return;
  battle.submenuIndex = (battle.submenuIndex + direction + list.length) % list.length;
  renderBattle();
}

function confirmBattleCommand() {
  const battle = state.battle;
  if (!battle || !battle.waiting) return;
  if (battle.menuMode !== "command") {
    confirmBattleSubmenu();
    return;
  }
  chooseBattleCommand(battleCommands[battle.commandFocus]?.key || "attack");
}

function confirmBattleSubmenu() {
  const battle = state.battle;
  if (!battle || battle.menuMode === "command") return;
  const list = battle.menuMode === "skill" ? currentBattleSkillMenu() : battleItemMenu;
  const item = list[battle.submenuIndex];
  if (!item || item.disabled) {
    battle.commandHint = battle.menuMode === "item" ? "暂无可用道具" : "暂无可用技能";
    renderBattle();
    return;
  }
  const type = battle.menuMode;
  battle.menuMode = "command";
  battle.submenuIndex = 0;
  if (type === "skill") chooseBattleAction(true, item.id);
}

function toggleAutoBattle() {
  const battle = state.battle;
  if (!battle || battle.ending) return;
  setAutoBattle(!battle.autoBattle);
}

function setAutoBattle(enabled) {
  const battle = state.battle;
  if (!battle || battle.ending) return;
  state.autoBattlePersistent = enabled;
  battle.autoBattle = enabled;
  battle.commandHint = enabled ? "自动战斗开启，将持续到手动关闭" : "自动战斗关闭";
  battle.selectedCommand = enabled ? "auto" : "attack";
  battle.commandFocus = enabled ? battleCommands.findIndex((item) => item.key === "auto") : 0;
  battle.menuMode = "command";
  battle.submenuIndex = 0;
  battle.autoStepQueued = false;
  if (enabled && battle.waiting) {
    queueAutoBattleStep(80);
  }
  renderBattle();
}

function queueAutoBattleStep(delayMs = 80) {
  const battle = state.battle;
  if (!battle || battle.autoStepQueued) return;
  battle.autoStepQueued = true;
  setTimeout(() => {
    const current = state.battle;
    if (current) current.autoStepQueued = false;
    performAutoBattleStep();
  }, delayMs);
}

function confirmBattleTarget(targetName = "") {
  const battle = state.battle;
  if (!battle || !battle.waiting || !battle.pendingAction) return;
  const target = targetName || battle.selectedTarget || firstAliveTargetName();
  if (!target) return;
  commitBattleAction(target);
}

function commitBattleAction(target = "") {
  const battle = state.battle;
  if (!battle || !battle.waiting || !battle.pendingAction) return;
  const mine = battle.choices[state.peerId] || {};
  const fighter = currentChoiceFighter();
  const cleanAction = sanitizeBattleActionForFighter(fighter, battle.pendingAction);
  if (!cleanAction) return;
  const nextAction = target ? { ...cleanAction, target } : { ...cleanAction };
  if (battle.teamBattleServer) {
    mine.actions = { ...(mine.actions || {}), [fighterRef(fighter)]: nextAction };
  } else {
    mine[battle.choiceStep] = nextAction;
  }
  battle.choices[state.peerId] = mine;
  battle.pendingAction = null;
  battle.targeting = false;
  battle.menuMode = "command";
  battle.submenuIndex = 0;
  const nextStep = nextControllableChoiceStep(battle.choiceStep);
  if (nextStep) {
    battle.choiceStep = nextStep;
    battle.choiceDeadline = performance.now() + BATTLE_CHOICE_MS;
    battle.lastChoiceSecond = BATTLE_CHOICE_SECONDS;
    renderBattle();
    if (battle.autoBattle) queueAutoBattleStep(120);
    return;
  }
  battle.waiting = false;
  battle.choiceDeadline = 0;
  battle.lastChoiceSecond = 0;
  renderBattle();
  if (battle.teamBattleServer) {
    sendRoomMessage({ type: "teamBattleChoice", battleId: battle.id, choice: battle.choices[state.peerId] });
  } else if (battle.arenaServer) {
    // Arena turns are resolved by the server; the client only submits choices and plays back results.
  } else if (battle.opponentPeerId) {
    showMenuHint("旧版直连战斗已停用，请刷新后重新发起服务器同步战斗");
    return;
  } else {
    receiveBattleChoice("npc", makeAutoChoice(battle.enemyTeam, battle.playerTeam));
  }
  tryResolveBattleTurn();
}

function performAutoBattleStep() {
  const battle = state.battle;
  if (!battle || !battle.autoBattle || !battle.waiting || battle.ending) return;
  if (!currentChoiceFighter()) {
    battle.choiceStep = firstControllableChoiceStep();
    if (!currentChoiceFighter()) return;
  }
  battle.menuMode = "command";
  battle.submenuIndex = 0;
  battle.selectedCommand = "auto";
  battle.commandFocus = battleCommands.findIndex((item) => item.key === "auto");
  const fighter = currentChoiceFighter();
  const entry = battle.teamBattleServer
    ? autoStrategyEntryForFighter(fighter)
    : autoStrategyEntry(battle.choiceStep === "mercenary" ? "mercenary" : battle.choiceStep === "pet" ? "pet" : "actor");
  const skills = activeBattleSkillsForFighter(fighter);
  const skillId = skills.includes(entry.skillId) ? entry.skillId : defaultBattleSkillIdForFighter(fighter);
  const mode = entry.mode === "skill" && skillId ? "skill" : "attack";
  battle.pendingAction = { type: mode, skillId: mode === "skill" ? skillId : "" };
  battle.targeting = true;
  const currentTarget = findBattleFighterByRef(battle.selectedTarget || "");
  const targetTeam = battleTargetTeam();
  battle.selectedTarget = currentTarget && targetTeam.includes(currentTarget)
    ? fighterRef(currentTarget)
    : firstAliveTargetName();
  confirmBattleTarget(battle.selectedTarget || firstAliveTargetName());
}

function updateBattleChoiceTimer(now) {
  const battle = state.battle;
  if (!battle || !battle.waiting || battle.ending || !battle.choiceDeadline) return;
  const secondsLeft = Math.max(0, Math.ceil((battle.choiceDeadline - now) / 1000));
  if (secondsLeft !== battle.lastChoiceSecond) {
    battle.lastChoiceSecond = secondsLeft;
    renderBattle();
  }
  if (now >= battle.choiceDeadline) {
    if (battle.pvp) return;
    setAutoBattle(true);
  }
}

function hasControllablePet() {
  const battle = state.battle;
  if (!battle) return false;
  const team = battle.role === "defender" ? battle.enemyTeam : battle.playerTeam;
  return team.some((fighter) => fighter.actor.isPet && !fighter.defeated);
}

function hasControllableMercenary() {
  const battle = state.battle;
  if (!battle) return false;
  const team = battle.role === "defender" ? battle.enemyTeam : battle.playerTeam;
  return team.some((fighter) => fighter.actor.isMercenary && !fighter.defeated);
}

function makeAutoChoice(team, targetTeam = team) {
  const target = firstAliveRef(targetTeam);
  const npcActions = {};
  team.filter((fighter) => !fighter.defeated).forEach((fighter) => {
    const usesBasic = fighter.actor?.forceBasicAttack || fighter.stats?.forceBasicAttack;
    const skillId = autoSkillIdForFighter(fighter);
    npcActions[fighterRef(fighter)] = usesBasic
      ? { type: "attack", target }
      : skillId ? { type: "skill", target, skillId } : { type: "attack", target };
  });
  if (team.length > 3 || team.some((fighter) => fighter.actor?.elfKingVaultStageId)) {
    return { actions: npcActions };
  }
  const actor = team.find((fighter) => !fighter.actor.isPet && !fighter.actor.isMercenary && !fighter.defeated);
  const pet = team.find((fighter) => fighter.actor.isPet && !fighter.defeated);
  const mercenary = team.find((fighter) => fighter.actor.isMercenary && !fighter.defeated);
  const actorUsesBasic = actor?.actor?.forceBasicAttack || actor?.stats?.forceBasicAttack;
  const actorSkillId = autoSkillIdForFighter(actor);
  const mercenaryEntry = autoStrategyEntryForFighter(mercenary);
  const mercenarySkillId = activeSkillIdForStrategy(mercenary, mercenaryEntry);
  const choice = {
    actor: actorUsesBasic
      ? { type: "attack", target }
      : actorSkillId ? { type: "skill", target, skillId: actorSkillId } : { type: "attack", target }
  };
  if (team.some((fighter) => fighter.actor.isPet && !fighter.defeated)) {
    const petSkillId = defaultBattleSkillIdForFighter(pet);
    choice.pet = petSkillId ? { type: "skill", target, skillId: petSkillId } : { type: "attack", target };
  }
  if (mercenary) {
    choice.mercenary = mercenaryEntry.mode === "attack"
      ? { type: "attack", target }
      : mercenarySkillId ? { type: "skill", target, skillId: mercenarySkillId } : { type: "attack", target };
  }
  return choice;
}

function autoStrategyEntryForFighter(fighter) {
  if (!fighter) return { mode: "skill", skillId: "" };
  if (fighter.actor?.isMercenary) {
    const mercenaryId = String(fighter.actor.mercenaryData?.id || "");
    const current = state.autoStrategy.mercenaryById?.[mercenaryId];
    return typeof current === "object" && current ? { mode: current.mode || "skill", skillId: current.skillId || "" } : { mode: current === "attack" ? "attack" : "skill", skillId: "" };
  }
  if (fighter.actor?.isPet) return autoStrategyEntry("pet");
  if (fighterOwnedByLocalPlayer(fighter)) return autoStrategyEntry("actor");
  return { mode: "skill", skillId: "" };
}

function activeSkillIdForStrategy(fighter, entry) {
  const skills = activeBattleSkillsForFighter(fighter);
  return skills.includes(entry?.skillId) ? entry.skillId : defaultBattleSkillIdForFighter(fighter);
}

function autoSkillIdForFighter(fighter) {
  const skills = activeBattleSkillsForFighter(fighter);
  if (!skills.length) return "";
  if (fighter?.actor?.elfKingVaultStageId || elfKingVault.stageById(fighter?.actor?.wildMonsterId)) {
    return skills.includes(fighter?.stats?.skillId) ? fighter.stats.skillId : defaultBattleSkillIdForFighter(fighter);
  }
  if (fighter?.actor?.immortalBossId) {
    fighter.autoSkillIndex = ((fighter.autoSkillIndex ?? -1) + 1) % skills.length;
    return skills[fighter.autoSkillIndex];
  }
  return defaultBattleSkillIdForFighter(fighter);
}

function autoActionForFighter(fighter, targetTeam) {
  if (fighter?.actor?.forceBasicAttack || fighter?.stats?.forceBasicAttack) {
    return {
      type: "attack",
      target: firstAliveRef(targetTeam)
    };
  }
  const entry = autoStrategyEntryForFighter(fighter);
  if (entry.mode === "attack") {
    return {
      type: "attack",
      target: firstAliveRef(targetTeam)
    };
  }
  const skillId = fighter?.actor?.isMercenary || fighterOwnedByLocalPlayer(fighter) || fighter?.actor?.isPet
    ? activeSkillIdForStrategy(fighter, entry)
    : autoSkillIdForFighter(fighter);
  if (!skillId) {
    return {
      type: "attack",
      target: firstAliveRef(targetTeam)
    };
  }
  return {
    type: "skill",
    target: firstAliveRef(targetTeam),
    skillId
  };
}

function tickDownStatuses(fighter, includeBleed = false) {
  return battleEngine.tickDownStatuses(fighter, includeBleed);
}

function resolveEndOfRoundDamageStatuses() {
  return battleEngine.resolveEndOfRoundDamageStatuses();
}

function firstAliveTargetName() {
  return firstAliveTargetRef();
}

function firstAliveTargetRef() {
  const battle = state.battle;
  if (!battle) return "";
  const targetTeam = battle.role === "defender" ? battle.playerTeam : battle.enemyTeam;
  return firstAliveRef(targetTeam);
}

function firstAliveName(team) {
  return alive(team)[0]?.name || "";
}

function firstAliveRef(team) {
  return fighterRef(alive(team)[0]);
}

function receiveBattleChoice(peerId, choice) {
  const battle = state.battle;
  if (!battle || battle.ending) return;
  battle.choices[peerId] = choice;
  tryResolveBattleTurn();
  renderBattle();
}

function battleOpeningEvents() {
  const battle = state.battle;
  if (!battle || battle.openingSpeechDone) return [];
  battle.openingSpeechDone = true;
  if (battle.wildMonsterId === "afei") {
    const speakers = battle.enemyTeam.length ? battle.enemyTeam : [];
    const speaker = sample(speakers);
    return speaker ? [battleSpeechEvent(speaker, "我就不信我会坐牢，我家有钱[e0]", 3200)] : [];
  }
  if (battle.wildMonsterId === "amumu") {
    const speaker = sample(battle.enemyTeam || []);
    return speaker ? [battleSpeechEvent(speaker, sample(AMUMU_BATTLE_LINES), 2800)] : [];
  }
  return [];
}

function tryResolveBattleTurn() {
  const battle = state.battle;
  if (!battle || battle.role !== "attacker") return;
  if (battle.teamBattleServer) return;
  if (battle.arenaServer) {
    resolveArenaServerTurn(battle);
    return;
  }
  const enemyKey = battle.opponentPeerId || "npc";
  if (!battle.choices[state.peerId] || !battle.choices[enemyKey]) return;
  const result = resolveBattleTurn(battle.choices[state.peerId], battle.choices[enemyKey]);
  const openingEvents = battleOpeningEvents();
  if (openingEvents.length) result.events = [...openingEvents, ...result.events];
  battle.choices = {};
  playBattleTurn(result);
}

function resolveBattleTurn(allyChoice, enemyChoice) {
  return battleEngine.resolveBattleTurn(allyChoice, enemyChoice);
}

function fighterBattleSnapshot(fighter) {
  return {
    battleId: fighter.battleId,
    name: fighter.name,
    hp: fighter.hp,
    defeated: fighter.defeated,
    statuses: normalizeBattleStatuses(fighter.statuses),
    defenseCleared: fighter.defenseCleared === true,
    damageReductionDown: fighter.damageReductionDown || 0,
    buffs: { ...(fighter.buffs || {}) },
    passiveRebirthUsed: fighter.passiveRebirthUsed === true,
    passiveRebirthOnce: fighter.passiveRebirthOnce === true,
    maxHp: fighter.maxHp,
    selfGuardReduction: fighter.selfGuardReduction || 0,
    controlImmune: fighter.controlImmune === true,
    statMultiplier: fighter.statMultiplier || 1,
    statMultipliers: { ...(fighter.statMultipliers || {}) },
    passiveRebirthChance: fighter.passiveRebirthChance || 0,
    passiveComboBasic: fighter.passiveComboBasic === true,
    passiveLifesteal: fighter.passiveLifesteal || 0,
    passiveCounter: fighter.passiveCounter || 0,
    passiveBreakArmor: fighter.passiveBreakArmor || 0,
    reflectDamageRate: fighter.reflectDamageRate || 0,
    passiveDeathGrit: fighter.passiveDeathGrit || null,
    periodicSkillId: fighter.periodicSkillId || "",
    periodicEvery: fighter.periodicEvery || 0
  };
}

async function applyBattleTurn(msg) {
  if (msg.to && msg.to !== state.peerId) return;
  await playBattleTurn(msg.result);
}

async function playBattleTurn(result) {
  const battle = state.battle;
  if (!battle) return;
  battle.lastSkillNames = {};
  const turnIndex = battle.turnIndex || 1;
  const areaBatchDurations = battleAreaBatchDurations(result.events || []);
  for (const event of result.events) {
    if (event.type === "speech") {
      applyEventDamage(event);
      renderBattle();
      continue;
    }
    if (event.type === "skillName") {
      battle.lastSkillNames[event.attackerId || event.attacker] = event.skillName || "";
      const caster = findBattleFighterByRef(event.attackerId || event.attacker);
      const hasAreaDamage = (result.events || []).some((item) => item.areaBatchId && item.attackerId === event.attackerId);
      if (caster && hasAreaDamage && isPeerlessArbitrationActor(caster.actor)) {
        // Wait until the lunge has reached its attack position; the renderer
        // starts the effect on the first attack frame.
        caster.arbitrationAreaEffectPending = true;
      }
      pushBattleStatusLine(`第${turnIndex}回合，${event.attacker}施放了${event.skillName || "技能"}`, "positive");
      applyEventDamage(event);
      renderBattle();
      await delay(520);
      continue;
    }
    if (event.type === "bleedBatch") {
      applyBleedBatch(event.events || []);
      (event.events || []).forEach((item) => {
        const label = item.type === "curse" ? "诅咒" : "流血";
        const tone = item.type === "curse" ? "danger" : "warning";
        pushBattleStatusLine(`第${turnIndex}回合，${item.defender}受到了${label}伤害 -${item.amount}`, tone);
        if (item.reborn) pushBattleStatusLine(`${item.defender}触发复活，当前生命 ${item.hp}`, "positive");
      });
      renderBattle();
      continue;
    }
    if (event.type === "lifesteal") {
      applyEventDamage(event);
      pushBattleStatusLine(`${event.attacker}吸血恢复 +${event.amount}`, "positive");
      renderBattle();
      await delay(90);
      continue;
    }
    const defender = findBattleFighterByRef(event.defenderId || event.defender);
    const previousStatuses = normalizeBattleStatuses(defender?.statuses || {});
    const isFastAreaFollowup = event.areaBatchId && event.areaIndex > 0;
    const fighter = findBattleFighterByRef(event.attackerId || event.attacker);
    if (fighter && !isFastAreaFollowup) {
      fighter.action = "attack";
      const lungeStartedAt = performance.now();
      fighter.attackStartedAt = lungeStartedAt + (event.areaBatchId ? 220 : 0);
      fighter.actionUntil = lungeStartedAt + (areaBatchDurations.get(event.areaBatchId) || 980);
      const lungeTarget = event.areaBatchId
        ? battleAreaLungeTarget(fighter, defender)
        : defender;
      fighter.attackTargetId = lungeTarget ? lungeTarget.battleId || "" : event.defenderId || "";
      fighter.attackTargetName = lungeTarget?.name || event.defender;
      spawnBattleAttackLungeEffect(fighter);
      triggerBattleBackgroundShake();
    }
    renderBattle();
    await delay(isFastAreaFollowup ? 90 : 720);
    applyEventDamage(event);
    if (defender && event.statuses) logBattleStatusChanges(event, defender, previousStatuses);
    if (event.reborn) pushBattleStatusLine(`${event.defender}触发复活，当前生命 ${event.hp}`, "positive");
    if (event.grit) pushBattleStatusLine(`${event.defender}触发不死的毅力，剩余1点生命`, "positive");
    triggerBattleBackgroundShake(isFastAreaFollowup ? 80 : 180);
    renderBattle();
    await delay(isFastAreaFollowup ? 110 : 520);
  }
  applyHpSnapshot(result.hp);
  logBattleRoundStatusSummary(turnIndex);
  if (result.done) {
    battle.waiting = false;
    battle.ending = true;
    showBattleResult(result.winner);
    const mySide = battle.role === "defender" ? "enemy" : "ally";
    const localBossBattle = Boolean(battle.immortalBossId || elfKingVault.stageById(battle.wildMonsterId));
    if (!battle.teamBattleServer && !battle.opponentPeerId && result.winner === mySide && localBossBattle && !battle.rewardClaimed) {
      battle.rewardClaimed = true;
      await grantWildBattleReward(battle.wildMonsterId, battle.monsterCount || battle.enemyTeam.length || 1);
    }
    if (battle.arenaServer && result.arena && !battle.arenaClaimed) {
      battle.arenaClaimed = true;
      if (result.arena.won) {
        const swapText = result.arena.oldRank ? `，原第${result.arena.rank}名替换到你的原第${result.arena.oldRank}名` : "";
        state.pendingBattleReward = { notice: `竞技场占领成功：第${result.arena.rank}名${swapText}` };
      } else {
        state.pendingBattleReward = { error: `竞技场挑战失败：第${result.arena.rank}名守擂成功` };
      }
    }
    if (!battle.arenaServer && !battle.opponentPeerId && result.winner === mySide && battle.arenaRank && !battle.arenaClaimed) {
      battle.arenaClaimed = true;
      await occupyArenaRank(battle.arenaRank, battle.arenaMirror || currentArenaMirror());
    }
    renderBattle();
    setTimeout(() => {
      if (!battle.teamBattleServer && !battle.arenaServer && battle.role === "attacker") sendBattleEndReliable(battle.id, battle.opponentPeerId);
      endBattleToMap();
    }, 1600);
  } else {
    battle.waiting = true;
    battle.choices = {};
    battle.turnIndex = turnIndex + 1;
    battle.choiceStep = firstControllableChoiceStep();
    battle.selectedTarget = "";
    battle.pendingAction = null;
    battle.targeting = false;
    battle.menuMode = "command";
    battle.submenuIndex = 0;
    battle.choiceDeadline = performance.now() + BATTLE_CHOICE_MS;
    battle.lastChoiceSecond = BATTLE_CHOICE_SECONDS;
    if (battle.autoBattle) {
      queueAutoBattleStep(180);
    }
  }
  renderBattle();
}

function isPeerlessArbitrationActor(actor) {
  return actor?.spriteId === 783 || actor?.spriteId === 786;
}

function spawnArbitrationAreaEffect(fighter) {
  const battle = state.battle;
  const image = state.images.get(BATTLE_ARBITRATION_EFFECT_SRC)?.value;
  if (!battle || !fighter || !image) return;
  const target = battleAreaLungeTarget(fighter, null);
  battle.effects.push({
    customImage: image,
    customFrames: [0, 1],
    sourceFrameWidth: image.width / 2,
    sourceFrameHeight: image.height,
    x: fighter.battleX,
    y: fighter.battleY,
    elapsed: 0,
    // Play the enemy-facing strike at 1.5x speed without changing its frame order.
    frameMs: 240,
    frameDurations: [147, 187],
    scale: 1.35,
    anchor: "bottom-center",
    mirrorWithFacing: true,
    followRef: fighterRef(fighter),
    followCustom: true,
    targetRef: target ? fighterRef(target) : ""
  });
}

// Group attacks should visually lunge toward the first target in the front row,
// rather than whichever member happens to be first in the damage event list.
function battleAreaLungeTarget(attacker, fallback) {
  const battle = state.battle;
  if (!battle || !attacker) return fallback;
  const team = attacker.side === "ally" ? battle.enemyTeam : battle.playerTeam;
  const candidates = (team || []).filter((fighter) => fighter && !fighter.defeated && Number.isFinite(fighter.battleY));
  if (!candidates.length) return fallback;
  return candidates.slice().sort((a, b) => (a.battleY - b.battleY) || (a.battleX - b.battleX))[0] || fallback;
}

function snapshotBattleHp() {
  const battle = state.battle;
  return [...battle.playerTeam, ...battle.enemyTeam].map((fighter) => ({
    fighter,
    hp: fighter.hp,
    defeated: fighter.defeated,
    statuses: normalizeBattleStatuses(fighter.statuses),
    buffs: { ...(fighter.buffs || {}) },
    damageReductionDown: fighter.damageReductionDown || 0,
    defenseCleared: fighter.defenseCleared === true,
    passiveRebirthUsed: fighter.passiveRebirthUsed === true,
    passiveRebirthOnce: fighter.passiveRebirthOnce === true,
    passiveRebirthChance: fighter.passiveRebirthChance || 0,
    passiveCombo: fighter.passiveCombo === true,
    passiveComboBasic: fighter.passiveComboBasic === true,
    passiveCounter: fighter.passiveCounter === true,
    passiveBreakArmor: fighter.passiveBreakArmor === true,
    passiveLifesteal: fighter.passiveLifesteal || 0,
    reflectDamageRate: fighter.reflectDamageRate || 0,
    passiveDeathGrit: fighter.passiveDeathGrit || null,
    passiveGuardRole: fighter.passiveGuardRole || 0,
    passiveGuardPet: fighter.passiveGuardPet || 0,
    passiveGuardMercenary: fighter.passiveGuardMercenary || 0,
    selfGuardReduction: fighter.selfGuardReduction || 0,
    controlImmune: fighter.controlImmune === true,
    periodicSkillId: fighter.periodicSkillId || "",
    periodicEvery: fighter.periodicEvery || 0,
    statMultiplier: fighter.statMultiplier || 1,
    statMultipliers: { ...(fighter.statMultipliers || {}) },
    maxHp: fighter.maxHp,
    maxHpBoostApplied: fighter.maxHpBoostApplied === true
  }));
}

function restoreBattleHp(snapshot) {
  for (const item of snapshot) {
    item.fighter.hp = item.hp;
    item.fighter.defeated = item.defeated;
    item.fighter.statuses = normalizeBattleStatuses(item.statuses);
    item.fighter.buffs = { ...(item.buffs || {}) };
    item.fighter.damageReductionDown = item.damageReductionDown || 0;
    item.fighter.defenseCleared = item.defenseCleared === true;
    item.fighter.passiveRebirthUsed = item.passiveRebirthUsed === true;
    item.fighter.passiveRebirthOnce = item.passiveRebirthOnce === true;
    item.fighter.passiveRebirthChance = item.passiveRebirthChance || 0;
    item.fighter.passiveCombo = item.passiveCombo === true;
    item.fighter.passiveComboBasic = item.passiveComboBasic === true;
    item.fighter.passiveCounter = item.passiveCounter === true;
    item.fighter.passiveBreakArmor = item.passiveBreakArmor === true;
    item.fighter.passiveLifesteal = item.passiveLifesteal || 0;
    item.fighter.reflectDamageRate = item.reflectDamageRate || 0;
    item.fighter.passiveDeathGrit = item.passiveDeathGrit || null;
    item.fighter.passiveGuardRole = item.passiveGuardRole || 0;
    item.fighter.passiveGuardPet = item.passiveGuardPet || 0;
    item.fighter.passiveGuardMercenary = item.passiveGuardMercenary || 0;
    item.fighter.selfGuardReduction = item.selfGuardReduction || 0;
    item.fighter.controlImmune = item.controlImmune === true;
    item.fighter.periodicSkillId = item.periodicSkillId || "";
    item.fighter.periodicEvery = item.periodicEvery || 0;
    item.fighter.statMultiplier = item.statMultiplier || 1;
    item.fighter.statMultipliers = { ...(item.statMultipliers || {}) };
    item.fighter.maxHp = item.maxHp || item.fighter.stats.hp;
    item.fighter.maxHpBoostApplied = item.maxHpBoostApplied === true;
  }
}

function applyEventDamage(event) {
  const battle = state.battle;
  const fighter = findBattleFighterByRef(event.defenderId || event.defender);
  if (!fighter) return;
  const attacker = findBattleFighterByRef(event.attackerId || event.attacker);
  // Area damage resolves against each real defender, but the first floating
  // number is staged on the front-row anchor so the visual hit starts there.
  const visualFighter = event.areaBatchId && event.areaIndex === 0 && attacker
    ? battleAreaLungeTarget(attacker, fighter)
    : fighter;
  if (event.type === "skillName") {
    battle.floatTexts = battle.floatTexts || [];
    battle.floatTexts.push({
      text: event.skillName || "技能",
      color: event.skillColor || "",
      x: fighter.battleX,
      y: fighter.battleY - 94,
      start: performance.now(),
      duration: 950
    });
    return;
  }
  if (event.type === "speech") {
    fighter.battleBubble = event.text || "";
    fighter.battleBubbleUntil = performance.now() + (event.duration || 2400);
    return;
  }
  fighter.hp = event.hp;
  fighter.defeated = event.defeated;
  if (event.maxHp) fighter.maxHp = event.maxHp;
  if ("selfGuardReduction" in event) fighter.selfGuardReduction = event.selfGuardReduction || 0;
  if ("controlImmune" in event) fighter.controlImmune = event.controlImmune === true;
  if ("statMultiplier" in event) fighter.statMultiplier = event.statMultiplier || 1;
  if (event.statMultipliers) fighter.statMultipliers = { ...event.statMultipliers };
  if ("passiveRebirthChance" in event) fighter.passiveRebirthChance = event.passiveRebirthChance || 0;
  if ("passiveRebirthOnce" in event) fighter.passiveRebirthOnce = event.passiveRebirthOnce === true;
  if ("passiveRebirthUsed" in event) fighter.passiveRebirthUsed = event.passiveRebirthUsed === true;
  if ("passiveLifesteal" in event) fighter.passiveLifesteal = event.passiveLifesteal || 0;
  if (event.statuses) fighter.statuses = normalizeBattleStatuses(event.statuses);
  if (event.buffs) fighter.buffs = { ...event.buffs };
  fighter.defenseCleared = event.defenseCleared === true;
  fighter.damageReductionDown = event.damageReductionDown || 0;
  if (event.reborn && fighter.passiveRebirthOnce) fighter.passiveRebirthUsed = true;
  triggerBattleHitReaction(fighter, event);
  spawnBattleEffect(effectIdForBattleEvent(event), fighter);
  const text = event.type === "heal" || event.type === "lifesteal"
    ? `+${event.amount}`
    : event.type === "miss"
      ? "闪避"
      : event.type === "status"
        ? "状态"
        : event.type === "buff"
          ? "强化"
          : `-${event.amount}`;
  battle.floatNumbers.push({
    text,
    x: visualFighter?.battleX ?? fighter.battleX,
    y: (visualFighter?.battleY ?? fighter.battleY) - 76,
    start: performance.now(),
    duration: 1100
  });
  if (event.reborn) {
    battle.floatTexts = battle.floatTexts || [];
    battle.floatTexts.push({
      text: "复活",
      color: "sleep",
      x: fighter.battleX,
      y: fighter.battleY - 102,
      start: performance.now(),
      duration: 1000
    });
  }
}

function effectIdForBattleEvent(event) {
  if (event?.type === "heal" || event?.type === "lifesteal") return BATTLE_HEAL_EFFECT_ID;
  return event?.effectId || 0;
}

function applyBleedBatch(events) {
  const battle = state.battle;
  if (!battle) return;
  for (const event of events) {
    const fighter = findBattleFighterByRef(event.defenderId || event.defender);
    if (!fighter) continue;
    fighter.hp = event.hp;
    fighter.defeated = event.defeated;
    if (event.maxHp) fighter.maxHp = event.maxHp;
    if ("selfGuardReduction" in event) fighter.selfGuardReduction = event.selfGuardReduction || 0;
    if ("controlImmune" in event) fighter.controlImmune = event.controlImmune === true;
    if ("statMultiplier" in event) fighter.statMultiplier = event.statMultiplier || 1;
    if (event.statMultipliers) fighter.statMultipliers = { ...event.statMultipliers };
    if ("passiveRebirthChance" in event) fighter.passiveRebirthChance = event.passiveRebirthChance || 0;
    if ("passiveRebirthOnce" in event) fighter.passiveRebirthOnce = event.passiveRebirthOnce === true;
    if ("passiveRebirthUsed" in event) fighter.passiveRebirthUsed = event.passiveRebirthUsed === true;
    if ("passiveLifesteal" in event) fighter.passiveLifesteal = event.passiveLifesteal || 0;
    if (event.statuses) fighter.statuses = normalizeBattleStatuses(event.statuses);
    if (event.buffs) fighter.buffs = { ...event.buffs };
    fighter.defenseCleared = event.defenseCleared === true;
    fighter.damageReductionDown = event.damageReductionDown || 0;
    if (event.reborn && fighter.passiveRebirthOnce) fighter.passiveRebirthUsed = true;
  }
}

function spawnBattleEffect(effectId, target) {
  const battle = state.battle;
  if (!battle || !effectId || !state.sprites.has(effectId)) return;
  battle.effects.push({
    id: effectId,
    x: target.battleX,
    y: battleEffectAnchorY(target),
    elapsed: 0,
    frameMs: effectId >= 1044 ? BATTLE_LARGE_EFFECT_FRAME_MS : BATTLE_EFFECT_FRAME_MS,
    scale: effectId >= 1044 ? 2.1 : 2.35
  });
}

function createElfKingVaultBossNpcs() {
  const bosses = elfKingVault.stages.map((stage) => {
    const npc = createActor({
      name: stage.npcName,
      spriteId: stage.spriteId,
      x: stage.position.x * 16,
      y: stage.position.y * 16
    });
    npc.mapName = elfKingVault.dungeon.mapName;
    npc.staticNpc = true;
    npc.wildMonsterId = stage.id;
    npc.elfKingVaultBossId = stage.id;
    npc.battleStats = applyElfKingVaultAdventureStats(elfVaultStats(stage.boss, stage));
    return npc;
  });
  const hidden = elfKingVault.hiddenStage;
  if (hidden) {
    const npc = createActor({
      name: hidden.npcName,
      spriteId: hidden.spriteId,
      x: hidden.position.x * 16,
      y: hidden.position.y * 16
    });
    npc.mapName = elfKingVault.dungeon.mapName;
    npc.staticNpc = true;
    npc.wildMonsterId = hidden.id;
    npc.elfKingVaultBossId = hidden.id;
    npc.elfKingVaultHiddenNpc = true;
    bosses.push(npc);
  }
  return bosses;
}

function createElfKingVaultBattleEnemies(stage, anchor = state.player) {
  if (stage?.hidden) {
    return stage.compositeStageIds
      .map((stageId) => elfKingVault.stageById(stageId))
      .filter(Boolean)
      .flatMap((partStage, groupIndex) => createElfKingVaultStageBattleEnemies(partStage, anchor, { groupIndex, hidden: true }));
  }
  return createElfKingVaultStageBattleEnemies(stage, anchor);
}

function createElfKingVaultStageBattleEnemies(stage, anchor = state.player, options = {}) {
  const baseX = Math.floor((anchor?.x || state.player?.x || 0) / 16);
  const baseY = anchor?.y || state.player?.y || 0;
  const boss = createActor({
    name: stage.bossName || `${stage.name}首领`,
    spriteId: stage.boss.spriteId,
    x: Math.min(state.map.width - 2, baseX + 3) * 16,
    y: baseY
  });
  boss.wildMonsterId = stage.id;
  boss.elfKingVaultBossId = stage.id;
  boss.elfKingVaultStageId = stage.id;
  boss.elfKingVaultHidden = options.hidden === true;
  boss.elfKingVaultGroupIndex = options.groupIndex || 0;
  boss.battleStats = applyElfKingVaultAdventureStats(elfVaultStats(stage.boss, stage));
  const minions = [];
  stage.monsters.forEach((monster) => {
    for (let index = 0; index < monster.count; index += 1) {
      const n = minions.length;
      const duplicateSuffix = monster.count > 1 ? String(index + 1) : "";
      const minion = createActor({
        name: `${monster.name || `${stage.name}${monster.key}`}${duplicateSuffix}`,
        spriteId: monster.spriteId,
        x: Math.min(state.map.width - 2, baseX + 2 + (n % 3)) * 16,
        y: baseY + (Math.floor(n / 3) + 1) * 4
      });
      minion.wildMonsterId = stage.id;
      minion.elfKingVaultStageId = stage.id;
      minion.elfKingVaultHidden = options.hidden === true;
      minion.elfKingVaultGroupIndex = options.groupIndex || 0;
      minion.battleStats = applyElfKingVaultAdventureStats(elfVaultStats(monster, stage));
      minion.forceBasicAttack = monster.forceBasicAttack === true;
      minions.push(minion);
    }
  });
  return [boss, ...minions];
}

function triggerBattleHitReaction(fighter, event) {
  if (!fighter || event.type === "heal" || event.type === "lifesteal" || event.type === "buff" || event.type === "status") return;
  const attacker = findBattleFighterByRef(event.attackerId || event.attacker);
  const direction = attacker?.battleX && fighter.battleX
    ? (fighter.battleX >= attacker.battleX ? 1 : -1)
    : (fighter.facing === "left" ? 1 : -1);
  fighter.hitReactionUntil = performance.now() + BATTLE_HIT_REACTION_MS;
  fighter.hitReactionDirection = direction;
}

function spawnBattleAttackLungeEffect(fighter) {
  const battle = state.battle;
  if (!battle || !fighter || !state.sprites.has(BATTLE_ATTACK_LUNGE_EFFECT_ID)) return;
  battle.effects.push({
    id: BATTLE_ATTACK_LUNGE_EFFECT_ID,
    x: fighter.battleX,
    y: battleFootEffectAnchorY(fighter),
    elapsed: 0,
    frameMs: 42,
    scale: battleAttackLungeEffectScale(fighter),
    followRef: fighterRef(fighter),
    followAttack: true,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    anchor: "bottom-center",
    noFlip: true,
    mirrorWithFacing: true,
    sourceFrameWidth: BATTLE_ATTACK_LUNGE_EFFECT_FRAME_WIDTH,
    sourceFrameHeight: BATTLE_ATTACK_LUNGE_EFFECT_FRAME_HEIGHT
  });
}

function battleAttackLungeEffectScale(fighter) {
  const actor = fighter?.actor;
  const targetSprite = actor
    ? state.sprites.get(battleAttackSpriteId(actor)) || state.sprites.get(actor.spriteId)
    : null;
  const targetFrameWidth = targetSprite?.frameWidth || BATTLE_ATTACK_LUNGE_EFFECT_FRAME_WIDTH;
  const targetDrawWidth = targetFrameWidth * 1.2;
  const effectDrawWidth = Math.max(52, Math.min(118, targetDrawWidth * 0.72));
  return effectDrawWidth / BATTLE_ATTACK_LUNGE_EFFECT_FRAME_WIDTH;
}

function battleEffectAnchorY(target) {
  if (target.actor.isPet) return target.battleY + 4;
  if (target.actor.isMercenary) return target.battleY - 10;
  return target.battleY - 8;
}

function battleFootEffectAnchorY(fighter) {
  if (fighter.actor?.isPet) return fighter.battleY + 14;
  if (fighter.actor?.isMercenary) return fighter.battleY + 8;
  return fighter.battleY + 10;
}

function applyHpSnapshot(snapshot) {
  const battle = state.battle;
  if (!battle) return;
  applyTeamHp(battle.playerTeam, snapshot.ally);
  applyTeamHp(battle.enemyTeam, snapshot.enemy);
}

function applyTeamHp(team, hpList) {
  for (const item of hpList || []) {
    const fighter = findFighterByRef(team, item.battleId || item.name);
    if (fighter) {
      fighter.hp = item.hp;
      fighter.defeated = item.defeated;
      if (item.maxHp) fighter.maxHp = item.maxHp;
      if (item.statuses) fighter.statuses = normalizeBattleStatuses(item.statuses);
      fighter.defenseCleared = item.defenseCleared === true;
      fighter.damageReductionDown = item.damageReductionDown || 0;
      if (item.buffs) fighter.buffs = { ...item.buffs };
      fighter.passiveRebirthUsed = item.passiveRebirthUsed === true;
      fighter.selfGuardReduction = item.selfGuardReduction || 0;
      fighter.controlImmune = item.controlImmune === true;
      fighter.statMultiplier = item.statMultiplier || 1;
      fighter.statMultipliers = { ...(item.statMultipliers || {}) };
      fighter.passiveRebirthChance = item.passiveRebirthChance || 0;
      fighter.passiveRebirthOnce = item.passiveRebirthOnce === true;
      fighter.passiveLifesteal = item.passiveLifesteal || 0;
    }
  }
}

function normalizeBattleStatuses(statuses = {}) {
  const next = {};
  Object.entries(statuses || {}).forEach(([key, value]) => {
    if (key === "bleed" && value && typeof value === "object") {
      next.bleed = {
        turns: Number(value.turns) || 0,
        amount: Number(value.amount) || 0
      };
      return;
    }
    if (key === "curse" && value && typeof value === "object") {
      next.curse = {
        turns: Number(value.turns) || 0,
        amount: Number(value.amount) || 0
      };
      return;
    }
    if (value) next[key] = value;
  });
  return next;
}

function initializeBattleModules() {
  if (battleSkills && battleEngine && battleProtocol && teamRuntime) return;
  battleSkills = window.BattleSkills.createRuntime({
    getState: () => state,
    getEquippedItemInSlot: equippedItemInSlot,
    getBattleTeamForActor: battleTeamForActor,
    fighterKind
  });
  battleEngine = window.BattleEngine.createRuntime({
    statLimits: STAT_LIMITS,
    skillCatalog,
    skillById,
    skillsForStats,
    defaultSkillIdForStats,
    sacrificeAlliesReady,
    statsForActor,
    fighterKind,
    effectIdForActor,
    normalizeBattleStatuses,
    alive,
    pickTarget,
    fighterRef,
    sample,
    critLines: BATTLE_CRIT_LINES,
    getBattle: () => state.battle,
    getPlayer: () => state.player,
    getPet: () => state.pet,
    snapshotBattleHp,
    restoreBattleHp,
    autoActionForFighter,
    fighterBattleSnapshot
  });
  battleProtocol = window.BattleProtocol.createRuntime({
    createActor,
    statsForActor,
    makeFighter,
    getMapName: () => state.mapName,
    getAutoBattlePersistent: () => state.autoBattlePersistent,
    getBattleChoiceMs: () => BATTLE_CHOICE_MS,
    getBattleChoiceSeconds: () => BATTLE_CHOICE_SECONDS
  });
  teamRuntime = window.TeamRuntime.createRuntime({
    getState: () => state,
    getPlayerName: () => state.player?.name || state.account,
    getAccount: () => state.account || "",
    resolvePeerId,
    findPeerIdByName,
    sendRoomMessage,
    peerById: (peerId) => state.peers.get(peerId),
    fighterRef
  });
}

initializeBattleModules();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function battleStatusMeta(key, fighter = null) {
  const customPeerlessLabel = fighter?.statusLabels?.[key];
  const meta = {
    confuse: { label: "混乱", tone: "danger" },
    bind: { label: "束缚", tone: "danger" },
    paralyze: { label: "麻痹", tone: "danger" },
    seal: { label: "封印", tone: "danger" },
    sleep: { label: "睡眠", tone: "danger" },
    stun: { label: "眩晕", tone: "danger" },
    bleed: { label: "流血", tone: "danger" },
    curse: { label: "诅咒", tone: "danger" },
    noHeal: { label: "禁疗", tone: "danger" },
    controlImmune: { label: "控制免疫", tone: "positive" },
    vulnerable: { label: "破防", tone: "warning" },
    slow: { label: "减速", tone: "warning" },
    armorBreak: { label: "碎甲", tone: "warning" },
    critBuff: { label: "暴击强化", tone: "positive" },
    speedBuff: { label: "速度强化", tone: "positive" },
    peerlessBuff: { label: customPeerlessLabel || "焚灵祭命", tone: "positive" }
  };
  return meta[key] || { label: key, tone: "warning" };
}

function battleStatusTurns(value) {
  if (!value) return 0;
  if (typeof value === "object") return Math.max(0, Number(value.turns) || 0);
  return Math.max(0, Number(value) || 0);
}

function activeBattleStatusesForLog(fighter) {
  return Object.entries(normalizeBattleStatuses(fighter?.statuses || {}))
    .map(([key, value]) => ({ key, turns: battleStatusTurns(value), meta: battleStatusMeta(key, fighter) }))
    .filter((entry) => entry.turns > 0);
}

function pushBattleStatusLine(text, tone = "warning") {
  const battle = state.battle;
  if (!battle || !text) return;
  battle.statusLog = battle.statusLog || [];
  battle.statusLog.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text,
    tone
  });
  if (battle.statusLog.length > 18) battle.statusLog.splice(0, battle.statusLog.length - 18);
}

function renderBattleStatusFeed() {
  const battle = state.battle;
  const panel = $("#battleStatusFeed");
  if (!panel || !battle) return;
  const lines = battle.statusLog || [];
  panel.innerHTML = lines.map((line) => `<div class="battle-status-line ${escapeHtml(line.tone || "warning")}">${escapeHtml(line.text)}</div>`).join("");
  panel.scrollTop = panel.scrollHeight;
}

function logBattleStatusChanges(event, fighter, previousStatuses = {}) {
  const currentStatuses = normalizeBattleStatuses(event.statuses || fighter?.statuses || {});
  const previous = normalizeBattleStatuses(previousStatuses);
  const skillName = state.battle?.lastSkillNames?.[event.attackerId || event.attacker] || "";
  Object.entries(currentStatuses).forEach(([key, value]) => {
    const turns = battleStatusTurns(value);
    const previousTurns = battleStatusTurns(previous[key]);
    if (turns <= 0 || turns <= previousTurns) return;
    if (key === "peerlessBuff" && skillName) {
      fighter.statusLabels = { ...(fighter.statusLabels || {}), [key]: skillName };
    }
    const meta = battleStatusMeta(key, fighter);
    const verb = meta.tone === "positive" ? "获得了" : "中了";
    pushBattleStatusLine(`${fighter.name}${verb}${meta.label}，${meta.label}还剩${turns}回合`, meta.tone);
  });
}

function logBattleRoundStatusSummary(turnIndex) {
  const battle = state.battle;
  if (!battle) return;
  const fighters = [...battle.playerTeam, ...battle.enemyTeam];
  let found = false;
  fighters.forEach((fighter) => {
    const statuses = activeBattleStatusesForLog(fighter);
    if (!statuses.length) return;
    found = true;
    pushBattleStatusLine(`第${turnIndex}回合结束，${fighter.name}：${statuses.map((entry) => `${entry.meta.label}剩${entry.turns}回合`).join("，")}`, "warning");
  });
  if (!found) pushBattleStatusLine(`第${turnIndex}回合结束，当前没有持续状态`, "positive");
}

function renderBattle() {
  const battle = state.battle;
  if (!battle) return;
  const secondsLeft = battle.waiting && battle.choiceDeadline
    ? Math.max(0, Math.ceil((battle.choiceDeadline - performance.now()) / 1000))
    : 0;
  $("#battleTitle").textContent = battle.ending
    ? "战斗结束"
    : battle.waiting
      ? battle.targeting
        ? `${battleChoiceStepText()} 选择目标`
        : `${battleChoiceStepText()} 行动`
      : "等待对方";
  $("#battleTimer").textContent = battle.waiting && secondsLeft ? `${secondsLeft}` : "";
  $("#battleTimer").classList.toggle("active", battle.waiting && secondsLeft > 0);
  $("#attackBtn").disabled = !battle.waiting || battle.targeting;
  $("#skillBtn").disabled = !battle.waiting || battle.targeting;
  $("#battleClose").textContent = battle.targeting ? "返回" : "逃跑";
  renderBattleTargets();
  renderBattleStatusFeed();
  renderBattleCommandBar();
  drawBattleScene();
}

function renderBattleCommandBar() {
  const battle = state.battle;
  const bar = $("#battleCommandBar");
  if (!bar || !battle) return;
  bar.innerHTML = "";
  bar.classList.toggle("submenu-open", battle.menuMode !== "command");
  battleCommands.forEach((command, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "battle-command";
    if (battle.commandFocus === index || (command.key === "auto" && battle.autoBattle)) {
      button.classList.add("selected");
    }
    button.disabled = !battle.waiting || battle.targeting || battle.ending;
    if (command.key === "escape") button.disabled = battle.ending;
    if (command.key === "auto") button.disabled = battle.ending || battle.targeting;
    button.style.setProperty("--slot-pos", `${-command.slotX * BATTLE_UI_SCALE}px 0px`);
    button.style.setProperty("--icon-pos", `${-command.iconX * BATTLE_UI_SCALE}px ${-48 * BATTLE_UI_SCALE}px`);
    button.style.setProperty("--label-pos", `${-command.labelX * BATTLE_UI_SCALE}px ${-32 * BATTLE_UI_SCALE}px`);
    button.style.setProperty("--label-width", `${command.labelW * BATTLE_UI_SCALE}px`);
    button.title = command.label;
    button.setAttribute("aria-label", command.label);
    button.addEventListener("click", () => chooseBattleCommand(command.key));
    button.innerHTML = `<span class="battle-command-bg"></span><span class="battle-command-select"></span><span class="battle-command-icon"></span><span class="battle-command-label"></span>`;
    bar.appendChild(button);
  });
  renderBattleSubmenu();
}

function renderBattleSubmenu() {
  const battle = state.battle;
  const card = document.querySelector(".battle-card");
  if (!card || !battle) return;
  let menu = $("#battleSubmenu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "battleSubmenu";
    menu.className = "battle-submenu";
    card.appendChild(menu);
  }
  if (battle.menuMode === "command") {
    menu.classList.remove("active");
    menu.innerHTML = "";
    return;
  }
  const list = battle.menuMode === "skill" ? currentBattleSkillMenu() : battleItemMenu;
  menu.classList.add("active");
  menu.innerHTML = list.map((item, index) => {
    const classes = ["battle-submenu-row"];
    if (index === battle.submenuIndex) classes.push("active");
    if (item.disabled) classes.push("disabled");
    return `<button type="button" class="${classes.join(" ")}" data-index="${index}" ${item.disabled ? "disabled" : ""}>${escapeHtml(item.label)}</button>`;
  }).join("");
  menu.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      battle.submenuIndex = Number(button.dataset.index);
      confirmBattleSubmenu();
    });
  });
}

function renderBattleTargets() {
  const battle = state.battle;
  const panel = $("#battleTargets");
  if (!battle || !battle.waiting) {
    panel.innerHTML = "";
    return;
  }
  if (!battle.targeting) {
    panel.innerHTML = `<span>${escapeHtml(battle.commandHint || `${battleChoiceStepText()}：请选择战斗指令`)}</span>`;
    return;
  }
  battle.commandHint = "";
  ensureSelectedBattleTarget();
  panel.innerHTML = `<span>${escapeHtml(battleChoiceStepText())}：点击目标，或用上下键切换后按 Enter，点返回可重选技能</span>`;
}

function closeBattle(notifyMarkerEnd = true) {
  const battleId = state.battle?.id;
  if (battleId && notifyMarkerEnd) sendRoomMessage({ type: "battleMarkerEnd", battleId });
  state.battle = null;
  if (battleId) removeRemoteBattleMarker(battleId);
  if (battleId) state.canceledBattleIds.delete(battleId);
  restoreBattleActors();
  $("#battleResult").classList.remove("active", "fail");
  $("#battleResult").textContent = "";
  $("#battleTimer").classList.remove("active");
  $("#battleTimer").textContent = "";
  $("#battleOverlay").classList.remove("active");
  setTimeout(showBattleRewardPanel, 80);
  if (state.idleHuntActive) scheduleIdleHunt();
}

function escapeBattle() {
  const battle = state.battle;
  if (!battle || battle.ending) return;
  if (battle.arenaServer) {
    postApi("/api/arena/cancel", { account: state.account, battleId: battle.id }).catch(() => {});
  }
  if (battle.opponentPeerId) {
    sendRoomMessage({ type: "battleEscape", battleId: battle.id, to: battle.opponentPeerId });
  }
  if (battle.teamBattleServer) {
    sendRoomMessage({ type: "battleEscape", battleId: battle.id, reason: "escape" });
  }
  if (!battle.teamBattleServer && !battle.arenaServer && battle.role === "attacker") sendBattleEndReliable(battle.id, battle.opponentPeerId);
  handleBattleEscape("self");
}

function handleBattleEscape(source) {
  const battle = state.battle;
  if (!battle) return;
  battle.waiting = false;
  battle.ending = true;
  battle.choiceDeadline = 0;
  battle.lastChoiceSecond = 0;
  battle.pendingAction = null;
  battle.targeting = false;
  battle.selectedTarget = "";
  battle.autoStepQueued = false;
  showBattleEscapeResult(source);
  renderBattle();
  setTimeout(endBattleToMap, 1200);
}

function showBattleEscapeResult(source) {
  const result = $("#battleResult");
  result.textContent = source === "self" ? "你已逃跑" : "对方逃跑了";
  result.classList.toggle("fail", source === "self");
  result.classList.add("active");
}

function showBattleResult(winner) {
  const battle = state.battle;
  const result = $("#battleResult");
  const mySide = battle.role === "defender" ? "enemy" : "ally";
  const win = winner === mySide;
  result.textContent = win ? "胜利" : "失败";
  result.classList.toggle("fail", !win);
  result.classList.add("active");
}

function endBattleToMap() {
  const battle = state.battle;
  if (!battle || battle.endTransitionStarted) return;
  battle.endTransitionStarted = true;
  const battleId = battle.id;
  playBattleTransition(
    () => closeBattle(false),
    undefined,
    () => sendRoomMessage({ type: "battleMarkerEnd", battleId })
  );
}

function drawBattleScene() {
  const battle = state.battle;
  const canvas = $("#battleCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = resizeCanvasBackingStore(canvas, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  if (!battle) return;
  const now = performance.now();
  const centerX = width * 0.5;
  const mapViewportHeight = Math.min(430, width) * 20 / 15;
  const baseY = mapViewportHeight * 0.5 + 20;
  const useTeamGrid = isBattleTeamGrid(battle);
  battle.playerTeam.forEach((fighter, index) => {
    if (useTeamGrid) {
      placeAllyGridFighter(fighter, index, centerX, baseY);
    } else {
      placeSingleBattleFighter(fighter, battle.playerTeam, centerX - 92, baseY);
    }
    fighter.facing = "right";
  });
  battle.enemyTeam.forEach((fighter, index) => {
    if (isElfKingVaultHiddenBattle(battle) && battle.enemyTeam.length === 40) {
      placeElfKingVaultHiddenEnemyFighter(fighter, index, centerX, baseY);
    } else if (battle.enemyTeam.length >= 4) {
      // 多目标交错站位：前一半左列、后一半右列错开半格，避免互相遮挡
      placeEnemyGridFighter(fighter, index, battle.enemyTeam, centerX, baseY);
    } else {
      placeSingleBattleFighter(fighter, battle.enemyTeam, centerX + 92, baseY);
    }
    fighter.facing = "left";
  });
  const cameraShake = battleCameraShakeOffset(battle, now);
  ctx.save();
  ctx.translate(cameraShake.x, cameraShake.y);
  [...battle.playerTeam, ...battle.enemyTeam]
    .sort((a, b) => (a.battleY || 0) - (b.battleY || 0))
    .forEach((fighter) => drawBattleFighter(ctx, fighter, fighter.battleX, fighter.battleY, fighter.facing, now));
  drawSelectedTargetArrow(ctx, now);
  drawAutoBattlePrompt(ctx, width, now);
  drawBattleEffects(ctx, now);
  drawBattleClickEffects(ctx, now);
  drawBattleFloatNumbers(ctx, now);
  drawBattleFloatTexts(ctx, now);
  ctx.restore();
}

function battleCameraShakeOffset(battle, now) {
  if (!battle?.cameraShakeUntil || now >= battle.cameraShakeUntil) return { x: 0, y: 0 };
  const remaining = (battle.cameraShakeUntil - now) / Math.max(1, battle.cameraShakeDuration || 1);
  const strength = (battle.cameraShakeStrength || 0) * Math.max(0, remaining);
  return {
    x: Math.sin(now * 0.11) * strength,
    y: Math.cos(now * 0.16) * strength * 0.6
  };
}

function drawAutoBattlePrompt(ctx, width, now) {
  const battle = state.battle;
  if (!battle?.autoBattle) return;
  const image = state.images.get("资源/图片/自动战斗.png")?.value;
  if (!image) return;
  const scale = Math.min(1.18, Math.max(0.85, width * 0.32 / image.width));
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  ctx.drawImage(image, Math.round((width - drawW) / 2), 14, drawW, drawH);
}

function isElfKingVaultHiddenBattle(battle) {
  return Boolean(elfKingVault.stageById(battle?.wildMonsterId)?.hidden || battle?.enemyTeam?.some((fighter) => fighter.actor?.elfKingVaultHidden));
}

function isBattleTeamGrid(battle) {
  return isFighterTeamGrid(battle.playerTeam, battle.teamRoster || []);
}

function isFighterTeamGrid(team, roster = []) {
  return team.length >= 4 || roster.length > 1;
}

function drawSelectedTargetArrow(ctx, now) {
  const battle = state.battle;
  if (!battle || !battle.waiting || !battle.targeting || !battle.selectedTarget) return;
  const target = findBattleFighterByRef(battle.selectedTarget);
  if (!target || !target.battleX) return;
  const pulse = Math.sin(now * 0.01) * 3;
  const pointsRight = target.facing === "left";
  const x = target.battleX + (pointsRight ? -34 - pulse : 34 + pulse);
  const y = target.battleY - (target.actor.isPet ? 18 : 30);
  const image = state.images.get("资源/图片/战斗箭头.png")?.value;
  if (image) {
    const frameW = Math.floor(image.width / 2);
    const frameH = image.height;
    const sx = pointsRight ? frameW : 0;
    const scale = 1.25;
    const drawW = frameW * scale;
    const drawH = frameH * scale;
    ctx.drawImage(image, sx, 0, frameW, frameH, x - drawW / 2, y - drawH / 2, drawW, drawH);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.72, 0.72);
  if (!pointsRight) ctx.scale(-1, 1);
  ctx.fillStyle = "#e52222";
  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(36, 0);
  ctx.lineTo(16, -14);
  ctx.lineTo(16, -6);
  ctx.lineTo(-34, -6);
  ctx.lineTo(-34, 6);
  ctx.lineTo(16, 6);
  ctx.lineTo(16, 14);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function selectBattleTargetFromCanvas(event) {
  const battle = state.battle;
  if (!battle || !battle.waiting || !battle.targeting) return;
  const canvas = $("#battleCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const targetTeam = battle.role === "defender" ? battle.playerTeam : battle.enemyTeam;
  const target = alive(targetTeam)
    .filter((fighter) => fighter.battleX)
    .sort((a, b) => distanceToBattleFighter(a, x, y) - distanceToBattleFighter(b, x, y))[0];
  if (!target || distanceToBattleFighter(target, x, y) > 96) return;
  battle.selectedTarget = fighterRef(target);
  confirmBattleTarget(fighterRef(target));
}

function addCanvasClickEffect(event, targetList) {
  if (!targetList) return;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  targetList.push({ x, y, startedAt: performance.now() });
}

function addBattleClickEffect(event) {
  const battle = state.battle;
  if (!battle) return;
  battle.clickEffects = battle.clickEffects || [];
  addCanvasClickEffect(event, battle.clickEffects);
}

function addMapClickEffect(event) {
  state.clickEffects = state.clickEffects || [];
  addCanvasClickEffect(event, state.clickEffects);
}

function drawBattleClickEffects(ctx, now) {
  const battle = state.battle;
  if (!battle?.clickEffects?.length) return;
  drawCanvasClickEffects(ctx, now, battle.clickEffects, (next) => { battle.clickEffects = next; });
}

function drawCanvasClickEffects(ctx, now, effects, setEffects) {
  if (!effects?.length) return;
  const image = state.images.get("资源/图片/点击.png")?.value;
  if (!image) {
    setEffects([]);
    return;
  }
  const frameW = 12;
  const frameH = 12;
  const frameMs = 70;
  const scale = 2;
  const nextEffects = effects.filter((effect) => {
    const frame = Math.floor((now - effect.startedAt) / frameMs);
    if (frame >= 3) return false;
    const alpha = 1 - Math.max(0, (now - effect.startedAt - frameMs * 1.5) / (frameMs * 1.5));
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, Math.min(1, alpha));
    ctx.drawImage(
      image,
      frame * frameW,
      0,
      frameW,
      frameH,
      Math.round(effect.x - frameW * scale / 2),
      Math.round(effect.y - frameH * scale / 2),
      frameW * scale,
      frameH * scale
    );
    ctx.restore();
    return true;
  });
  setEffects(nextEffects);
}

function distanceToBattleFighter(fighter, x, y) {
  const dx = fighter.battleX - x;
  const dy = (fighter.battleY - 42) - y;
  return Math.hypot(dx, dy);
}

function battleTargetTeam() {
  const battle = state.battle;
  if (!battle) return [];
  return battle.role === "defender" ? battle.playerTeam : battle.enemyTeam;
}

function ensureSelectedBattleTarget() {
  const battle = state.battle;
  if (!battle) return;
  const targets = alive(battleTargetTeam());
  if (!targets.some((target) => fighterRef(target) === battle.selectedTarget || target.name === battle.selectedTarget)) {
    battle.selectedTarget = fighterRef(targets[0]);
  }
}

function moveBattleTarget(direction) {
  const battle = state.battle;
  if (!battle || !battle.waiting || !battle.targeting) return;
  const targets = alive(battleTargetTeam());
  if (!targets.length) return;
  const currentIndex = Math.max(0, targets.findIndex((target) => fighterRef(target) === battle.selectedTarget || target.name === battle.selectedTarget));
  const nextIndex = (currentIndex + direction + targets.length) % targets.length;
  battle.selectedTarget = fighterRef(targets[nextIndex]);
  renderBattle();
}

function handleBattleKey(event) {
  if (isTextInputTarget(event.target) || isInputUiActive()) return;
  const battle = state.battle;
  if (!battle) return;
  if (event.key === "Escape" && battle.waiting && battle.targeting) {
    event.preventDefault();
    cancelBattleTargetSelection();
    return;
  }
  if (battle.menuMode !== "command" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    moveBattleSubmenu(event.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (battle.waiting && !battle.targeting && battle.menuMode === "command" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    moveBattleCommand(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (battle.waiting && !battle.targeting && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    confirmBattleCommand();
    return;
  }
  if (!battle.waiting || !battle.targeting) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    moveBattleTarget(event.key === "ArrowUp" ? -1 : 1);
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    confirmBattleTarget();
  }
}

function drawBattleEffects(ctx, now) {
  const battle = state.battle;
  if (!battle) return;
  const dt = Math.min(50, now - (battle.lastEffectTime || now));
  battle.lastEffectTime = now;
  battle.effects = battle.effects.filter((effect) => {
    if (effect.customImage) {
      const frames = effect.customFrames || [0];
      const frameDurations = effect.frameDurations || frames.map(() => effect.frameMs);
      let tick = 0;
      let elapsedFrame = effect.elapsed;
      while (tick < frameDurations.length && elapsedFrame >= frameDurations[tick]) {
        elapsedFrame -= frameDurations[tick];
        tick += 1;
      }
      if (tick >= frames.length) return false;
      if (tick === 1 && effect.lastTick !== 1) {
        effect.lastTick = 1;
        triggerBattleImpactShake(180, 7);
        const target = findBattleFighterByRef(effect.targetRef);
        if (target) {
          target.hitReactionUntil = now + 180;
          target.hitReactionDirection = target.battleX >= (findBattleFighterByRef(effect.followRef)?.battleX || target.battleX) ? 1 : -1;
        }
      } else if (effect.lastTick == null) {
        effect.lastTick = 0;
      }
      const fw = effect.sourceFrameWidth;
      const fh = effect.sourceFrameHeight;
      const raw = frames[tick];
      const position = effect.followCustom ? battleCustomEffectPosition(effect) : { x: effect.x, y: effect.y };
      const w = fw * effect.scale;
      const h = fh * effect.scale;
      ctx.save();
      const angle = battleCustomEffectAngle(effect);
      ctx.translate(position.x, position.y);
      ctx.rotate(angle);
      ctx.drawImage(effect.customImage, raw * fw, 0, fw, fh, 0, -h / 2, w, h);
      ctx.restore();
      effect.elapsed += dt;
      return true;
    }
    const sprite = state.sprites.get(effect.id);
    if (!sprite) return false;
    const frames = sprite.animations[0] || [];
    const tick = Math.floor(effect.elapsed / effect.frameMs);
    if (tick >= frames.length) return false;
    drawEffectFrame(ctx, sprite, effect, tick);
    effect.elapsed += dt;
    return true;
  });
}

function battleCustomEffectPosition(effect) {
  const fighter = findBattleFighterByRef(effect.followRef);
  if (!fighter) return { x: effect.x, y: effect.y };
  const facing = fighter.facing || "right";
  const lunge = battleLungeOffset(fighter, facing);
  return {
    // Anchor from the fighter's post-lunge position, then place the effect
    // just in front of the body.
    x: fighter.battleX + lunge.x + (facing === "left" ? -34 : 34),
    y: fighter.battleY + lunge.y - 20
  };
}

function battleCustomEffectAngle(effect) {
  const attacker = findBattleFighterByRef(effect.followRef);
  const target = findBattleFighterByRef(effect.targetRef);
  if (!attacker || !target) return attacker?.facing === "left" ? Math.PI : 0;
  const facing = attacker.facing || "right";
  const lunge = battleLungeOffset(attacker, facing);
  const startX = attacker.battleX + lunge.x;
  const startY = attacker.battleY + lunge.y - 20;
  return Math.atan2(target.battleY - startY, target.battleX - startX);
}

function drawEffectFrame(ctx, sprite, effect, tick) {
  const frames = effect.frames || sprite.animations[0] || [];
  const raw = frames[tick % frames.length];
  if (raw === 255 || raw == null) return;
  const frame = {
    index: raw >= 128 ? raw - 128 : raw,
    flip: (!effect.noFlip && raw >= 128) || battleEffectMirrorX(effect)
  };
  const sourceFrameWidth = effect.sourceFrameWidth || sprite.frameWidth;
  const sourceFrameHeight = effect.sourceFrameHeight || sprite.frameHeight;
  const w = sourceFrameWidth * effect.scale;
  const h = sourceFrameHeight * effect.scale;
  const position = battleEffectPosition(effect);
  const x = position.x + (effect.anchor === "bottom-center" ? 0 : 8 * effect.scale) - w / 2;
  const y = position.y - h;
  drawSpriteFrameSource(ctx, sprite, frame, x, y, w, h, sourceFrameWidth, sourceFrameHeight);
}

function battleEffectMirrorX(effect) {
  if (!effect.mirrorWithFacing || !effect.followRef) return false;
  const fighter = findBattleFighterByRef(effect.followRef);
  return fighter?.facing === "left";
}

function drawSpriteFrameSource(ctx, sprite, frame, x, y, w, h, sourceFrameWidth, sourceFrameHeight) {
  const sx = frame.index * sourceFrameWidth;
  if (frame.flip) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.image, sx, 0, sourceFrameWidth, sourceFrameHeight, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(sprite.image, sx, 0, sourceFrameWidth, sourceFrameHeight, x, y, w, h);
  }
}

async function grantElfKingVaultReward(bossId) {
  const stage = elfKingVault.stageById(bossId);
  if (!stage || !state.account) return;
  try {
    const result = await postApi("/api/elf-king-vault/reward", { account: state.account, bossId });
    state.elfKingVaultProgress = result.elfKingVaultProgress || state.elfKingVaultProgress;
    if (result.player) {
      state.phantom.equippedTitle = result.player.equippedTitle || state.phantom.equippedTitle || "";
      state.phantom.claimedTitles = result.player.claimedTitles || state.phantom.claimedTitles || [];
      state.phantom.claimedTitleEntries = result.player.claimedTitleEntries || state.phantom.claimedTitleEntries || [];
    }
    state.pendingBattleReward = {
      exp: 0,
      forgeGem: 0,
      equipment: null,
      fragments: [],
      items: result.items || [],
      titleReward: result.titleReward || null,
      elfKingVaultName: stage.name
    };
    showMenuHint(`${stage.name}宝库奖励已发放`);
  } catch (error) {
    state.pendingBattleReward = {
      notice: error.message === "already_claimed_today"
        ? `${stage.name}今日奖励已领取`
        : error.message === "previous_required"
          ? "需要先击败上一关"
          : `${stage.name}奖励发放失败`
    };
  }
}

function battleAreaBatchDurations(events) {
  const batches = new Map();
  events.forEach((event) => {
    if (!event?.areaBatchId) return;
    if (event.type === "lifesteal" || event.type === "speech" || event.type === "skillName" || event.type === "bleedBatch") return;
    const item = batches.get(event.areaBatchId) || { count: 0 };
    item.count += 1;
    batches.set(event.areaBatchId, item);
  });
  const durations = new Map();
  batches.forEach((batch, id) => {
    durations.set(id, 780 + Math.max(0, batch.count - 1) * 120 + 360);
  });
  return durations;
}

function battleEffectPosition(effect) {
  if (!effect.followRef) return { x: effect.x, y: effect.y };
  const fighter = findBattleFighterByRef(effect.followRef);
  if (!fighter || !fighter.battleX) return { x: effect.x, y: effect.y };
  const facing = fighter.facing || (fighter.battleX < (effect.x || fighter.battleX) ? "right" : "left");
  const offset = effect.followAttack && fighter.action === "attack"
    ? battleLungeOffset(fighter, facing)
    : { x: 0, y: 0 };
  return {
    x: fighter.battleX + offset.x,
    y: battleFootEffectAnchorY(fighter) + offset.y
  };
}

function triggerBattleBackgroundShake(duration = 280) {
  const gameScreen = $("#gameScreen");
  if (!gameScreen) return;
  gameScreen.classList.remove("shake-bg");
  void gameScreen.offsetWidth;
  gameScreen.classList.add("shake-bg");
  setTimeout(() => {
    gameScreen.classList.remove("shake-bg");
  }, duration);
}

function triggerBattleImpactShake(duration = 180, strength = 7) {
  const battle = state.battle;
  if (battle) {
    battle.cameraShakeDuration = duration;
    battle.cameraShakeUntil = performance.now() + duration;
    battle.cameraShakeStrength = Math.max(battle.cameraShakeStrength || 0, strength);
  }
  triggerBattleBackgroundShake(duration);
}

function drawBattleFighter(ctx, fighter, x, y, facing, now) {
  if (fighter.arbitrationAreaEffectPending
    && fighter.action === "attack"
    && now >= (fighter.attackStartedAt || 0)) {
    fighter.arbitrationAreaEffectPending = false;
    spawnArbitrationAreaEffect(fighter);
  }
  const useAttack = fighter.action === "attack"
    && now >= (fighter.attackStartedAt || 0)
    && now < fighter.actionUntil;
  if (fighter.action === "attack" && now >= fighter.actionUntil) fighter.action = "idle";
  const sprite = state.sprites.get(useAttack ? battleAttackSpriteId(fighter.actor) : fighter.actor.spriteId) || state.sprites.get(fighter.actor.spriteId);
  if (!sprite) return;
  const actorState = {
    direction: facing,
    moving: useAttack && !fighter.actor.isMercenary,
    frameTick: now * 0.026,
    idleTick: now * 0.06
  };
  const frame = getFrame(sprite, actorState);
  const hiddenVaultEnemy = fighter.side === "enemy" && isElfKingVaultHiddenBattle(state.battle);
  const scale = hiddenVaultEnemy ? 0.72 : 1.2;
  const w = sprite.frameWidth * scale;
  const h = sprite.frameHeight * scale;
  const lungeActive = fighter.action === "attack" && now < fighter.actionUntil;
  const attackOffset = lungeActive ? battleLungeOffset(fighter, facing) : { x: 0, y: 0 };
  const hitOffset = battleHitReactionOffset(fighter, now);
  const offset = { x: attackOffset.x + hitOffset.x, y: attackOffset.y + hitOffset.y };
  drawSpriteFrame(ctx, sprite, frame, x - w / 2 + offset.x, y - h + offset.y, w, h);
  const barWidth = Math.max(hiddenVaultEnemy ? 28 : 46, w * 0.72);
  drawBattleHpBar(ctx, fighter, x + offset.x, y + 8 + offset.y, barWidth);
  if (shouldShowBattleEnergyBar(state.battle, fighter)) {
    drawBattleEnergyBar(ctx, fighter, x + offset.x, y + 15 + offset.y, barWidth);
  }
  if (fighter.defeated) drawDefeatedCross(ctx, x + offset.x, y - h / 2 + offset.y, Math.max(36, w * 0.64));
  drawBattleStatusIcons(ctx, fighter, x + offset.x, y - h + offset.y);
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `${hiddenVaultEnemy ? 8 : 12}px ${UI_FONT_FAMILY}`;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillText(fighter.name, x + offset.x + 1, y - h - 5 + offset.y + 1);
  ctx.fillStyle = "#fff4a8";
  ctx.fillText(fighter.name, x + offset.x, y - h - 5 + offset.y);
  ctx.restore();
  if (fighter.battleBubble && now < fighter.battleBubbleUntil) {
    drawBubble(ctx, fighter.battleBubble, x + offset.x, y - h - 8 + offset.y);
  }
}

function battleHitReactionOffset(fighter, now) {
  if (!fighter.hitReactionUntil || now >= fighter.hitReactionUntil) return { x: 0, y: 0 };
  const progress = 1 - ((fighter.hitReactionUntil - now) / BATTLE_HIT_REACTION_MS);
  const strength = (1 - progress) * 8;
  const wave = Math.sin(progress * Math.PI * 4);
  return {
    x: (fighter.hitReactionDirection || 1) * wave * strength,
    y: 0
  };
}

function activeBattleStatusIconIds(fighter) {
  const statuses = fighter.statuses || {};
  const keys = [];
  if (statuses.confuse) keys.push("confuse");
  if (statuses.seal) keys.push("seal");
  if (statuses.bleed?.turns) keys.push("bleed");
  if (statuses.curse?.turns) keys.push("curse");
  if (statuses.noHeal) keys.push("noHeal");
  if (statuses.controlImmune) keys.push("controlImmune");
  if (statuses.sleep) keys.push("sleep");
  if (statuses.stun) keys.push("stun");
  if (statuses.paralyze) keys.push("paralyze");
  if (statuses.bind) keys.push("bind");
  if (statuses.armorBreak) keys.push("armorBreak");
  if (statuses.vulnerable) keys.push("vulnerable");
  if (statuses.slow) keys.push("vulnerable");
  if (statuses.speedBuff || statuses.peerlessBuff) keys.push("critBuff");
  return keys.map((key) => BATTLE_STATUS_ICONS[key]).filter((id, index, list) => id && list.indexOf(id) === index);
}

function drawBattleStatusIcons(ctx, fighter, x, topY) {
  const ids = activeBattleStatusIconIds(fighter);
  if (!ids.length) return;
  const size = 16;
  const gap = 2;
  const totalWidth = ids.length * size + (ids.length - 1) * gap;
  let startX = x - totalWidth / 2;
  const y = topY - 23;
  ids.forEach((id) => {
    const sprite = state.sprites.get(id);
    if (sprite) {
      const frame = { index: 0, flip: false };
      drawSpriteFrame(ctx, sprite, frame, startX, y, size, size);
    } else {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(startX, y, size, size);
      ctx.restore();
    }
    startX += size + gap;
  });
}

function drawDefeatedCross(ctx, x, y, size) {
  ctx.save();
  ctx.strokeStyle = "rgba(220, 32, 42, 0.95)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(x - size / 2, y - size / 2);
  ctx.lineTo(x + size / 2, y + size / 2);
  ctx.moveTo(x + size / 2, y - size / 2);
  ctx.lineTo(x - size / 2, y + size / 2);
  ctx.stroke();
  ctx.restore();
}

function battleLungeOffset(fighter, facing) {
  const battle = state.battle;
  const target = findBattleFighterByRef(fighter.attackTargetId || fighter.attackTargetName);
  if (!target || !target.battleX) return { x: facing === "right" ? 38 : -38, y: 0 };
  const sideGap = fighter.actor.isPet ? 30 : 38;
  const targetX = target.battleX + (facing === "right" ? -sideGap : sideGap);
  const targetY = target.battleY;
  // Fine-tune the attack staging: two battle-grid units upward and two units
  // backward from the target-facing position. One unit is 16 canvas pixels.
  const rearOffset = facing === "right" ? -32 : 32;
  return {
    x: targetX - fighter.battleX + rearOffset,
    // Reach the target's row before the attack animation starts.
    y: targetY - fighter.battleY - 32
  };
}

function drawBattleHpBar(ctx, fighter, x, y, width) {
  const rate = fighter.maxHp ? Math.max(0, fighter.hp / fighter.maxHp) : 0;
  const image = state.images.get("资源/图片/blood.png")?.value;
  if (image) {
    battleBars.drawBloodBar(ctx, image, x, y, width, 7, rate);
    return;
  }
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  roundRect(ctx, x - width / 2, y, width, 7, 4);
  ctx.fill();
  ctx.fillStyle = "#bd2f34";
  roundRect(ctx, x - width / 2 + 1, y + 1, Math.max(0, (width - 2) * rate), 5, 3);
  ctx.fill();
  ctx.restore();
}

function isPvpBattle(battle) {
  return Boolean(battle && (battle.opponentPeerId || battle.arenaServer || (battle.teamBattleServer && battle.pvp)));
}

function shouldShowBattleEnergyBar(battle, fighter) {
  if (!battle || !fighter) return false;
  if (fighter.side === "ally") return true;
  return isPvpBattle(battle);
}

function drawBattleEnergyBar(ctx, fighter, x, y, width) {
  // 接口预留：未来技能消耗精力时由引擎写入 fighter.energy / maxEnergy，此处自动按比例显示；暂未接入时显示满值
  const rate = fighter.maxEnergy ? Math.max(0, Math.min(1, fighter.energy / fighter.maxEnergy)) : 1;
  const image = state.images.get("资源/图片/blood.png")?.value;
  if (image) {
    battleBars.drawEnergyBar(ctx, image, x, y, width, 7, rate);
    return;
  }
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  roundRect(ctx, x - width / 2, y, width, 7, 4);
  ctx.fill();
  ctx.fillStyle = "#1c5f9e";
  roundRect(ctx, x - width / 2 + 1, y + 1, Math.max(0, (width - 2) * rate), 5, 3);
  ctx.fill();
  ctx.restore();
}

function drawBattleFloatNumbers(ctx, now) {
  const battle = state.battle;
  const image = state.images.get("资源/图片/战斗数字.png")?.value;
  if (!battle || !image) return;
  battle.floatNumbers = battle.floatNumbers.filter((item) => now - item.start < item.duration);
  for (const item of battle.floatNumbers) {
    const t = (now - item.start) / item.duration;
    const y = item.y - t * 30;
    const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    drawDamageNumber(ctx, image, item.text, item.x, y, alpha);
  }
}

function drawBattleFloatTexts(ctx, now) {
  const battle = state.battle;
  if (!battle) return;
  battle.floatTexts = (battle.floatTexts || []).filter((item) => now - item.start < item.duration);
  for (const item of battle.floatTexts) {
    const t = (now - item.start) / item.duration;
    const y = item.y - t * 18;
    const alpha = t < 0.78 ? 1 : 1 - (t - 0.78) / 0.22;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = "center";
    ctx.font = `bold 16px ${UI_FONT_FAMILY}`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(31, 9, 43, 0.88)";
    const gradient = ctx.createLinearGradient(item.x - 70, y - 16, item.x + 70, y + 4);
    const colors = skillFloatColors(item.color);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.48, colors[1]);
    gradient.addColorStop(1, colors[2]);
    ctx.shadowColor = colors[1];
    ctx.shadowBlur = 10;
    ctx.fillStyle = gradient;
    ctx.strokeText(item.text, item.x, y);
    ctx.fillText(item.text, item.x, y);
    ctx.restore();
  }
}

function skillFloatColors(color = "") {
  const palettes = {
    chaos: ["#ff5ce8", "#ffe86a", "#7df7ff"],
    sleep: ["#8bd7ff", "#f7b7ff", "#ffffff"],
    thunder: ["#fff36a", "#61e8ff", "#b8ff5c"],
    curse: ["#b66cff", "#ff5c9a", "#ffe06a"],
    seal: ["#74fff0", "#b8ff70", "#ffffff"],
    fire: ["#ff8a3d", "#fff06a", "#ff4f8b"],
    default: ["#72f6ff", "#fff36a", "#ff79e9"]
  };
  return palettes[color] || palettes.default;
}

function drawDamageNumber(ctx, image, text, x, y, alpha) {
  const order = "0123456789+-";
  const scale = 1.4;
  const digitW = 13;
  const digitH = 16;
  const width = text.length * digitW * scale;
  let cx = x - width / 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (const char of text) {
    const index = order.indexOf(char);
    if (index >= 0) {
      ctx.drawImage(image, index * digitW, 0, digitW, digitH, cx, y, digitW * scale, digitH * scale);
    }
    cx += digitW * scale;
  }
  ctx.restore();
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function isTextInputTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return target.isContentEditable
    || (tagName === "INPUT" && target.type !== "range")
    || tagName === "TEXTAREA"
    || tagName === "SELECT";
}

function isInputUiActive() {
  return Boolean(document.activeElement && isTextInputTarget(document.activeElement))
    || state.roleStatsOpen
    || $("#chatForm")?.classList.contains("active")
    || $("#privateChatDialog")?.classList.contains("active")
    || $("#renamePanel")?.classList.contains("active")
    || $("#passwordPanel")?.classList.contains("active")
    || $("#redeemPanel")?.classList.contains("active")
    || $("#giveQuantityPanel")?.classList.contains("active")
    || $("#stallPricePanel")?.classList.contains("active")
    || $("#stallBuyQuantityPanel")?.classList.contains("active");
}

function tileFromCanvasEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const wx = (event.clientX - rect.left - state.mapViewportX) / state.mapScale + state.cameraX;
  const wy = (event.clientY - rect.top - state.mapViewportY) / state.mapScale + state.cameraY;
  const tileSize = state.map?.tileSize || 16;
  const maxX = Math.max(0, (state.map?.width || 1) - 1);
  const maxY = Math.max(0, (state.map?.height || 1) - 1);
  const x = Math.max(0, Math.min(maxX, Math.floor(wx / tileSize)));
  const y = Math.max(0, Math.min(maxY, Math.floor(wy / tileSize)));
  return { wx, wy, tile: { mapName: state.mapName, x, y } };
}

async function refreshGatewayServers() {
  const result = await apiGet("/api/servers");
  state.servers = Array.isArray(result.servers) ? result.servers : [];
  return state.servers;
}

function selectedGatewayServer() {
  return state.servers[state.gatewayServerIndex] || state.servers.find((server) => String(server.id) === String(state.serverId)) || null;
}

function renderServerSelection() {
  const list = $("#serverList");
  state.gatewayServerIndex = Math.max(0, Math.min(state.servers.length - 1, state.gatewayServerIndex || 0));
  list.innerHTML = state.servers.length ? state.servers.map((server, index) => `
    <button type="button" class="gateway-menu-item${index === state.gatewayServerIndex ? " active" : ""}" data-index="${index}" role="option" aria-selected="${index === state.gatewayServerIndex ? "true" : "false"}">
      <small>${index + 1}.</small>
      <span>${escapeHtml(server.name || `服务器${index + 1}`)}</span>
      <em>${Math.max(0, Number(server.onlineCount) || 0)} 人在线</em>
    </button>
  `).join("") : '<div class="gateway-empty">暂无可用服务器</div>';
  list.querySelectorAll(".gateway-menu-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.gatewayServerIndex = Number(button.dataset.index) || 0;
      renderServerSelection();
    });
    button.addEventListener("dblclick", confirmServerSelection);
  });
  list.querySelector(".gateway-menu-item.active")?.scrollIntoView({ block: "nearest" });
}

async function openServerSelection({ refresh = true } = {}) {
  showScreen("server");
  $("#serverMessage").textContent = "";
  try {
    if (refresh || !state.servers.length) {
      setLoading(true, "读取服务器列表中...");
      await refreshGatewayServers();
    }
    const currentIndex = state.servers.findIndex((server) => String(server.id) === String(state.serverId));
    state.gatewayServerIndex = currentIndex >= 0 ? currentIndex : 0;
    renderServerSelection();
    if (!state.servers.length) $("#serverMessage").textContent = "暂无可用服务器，请稍后刷新。";
  } catch (error) {
    console.warn("server list failed", error);
    state.servers = [];
    renderServerSelection();
    $("#serverMessage").textContent = "服务器列表读取失败，请稍后重试。";
  } finally {
    setLoading(false);
  }
}

function confirmServerSelection() {
  const server = selectedGatewayServer();
  if (!server) {
    $("#serverMessage").textContent = "请选择服务器。";
    return;
  }
  state.serverId = server.id;
  state.serverName = server.name || "服务器";
  state.gatewayChannelIndex = 0;
  state.channelId = "";
  renderLineSelection();
  showScreen("line");
}

function selectedServerChannels() {
  const server = state.servers.find((entry) => String(entry.id) === String(state.serverId)) || selectedGatewayServer();
  const source = Array.isArray(server?.channels) ? server.channels : [];
  return Array.from({ length: 6 }, (_, index) => {
    const expectedId = index + 1;
    const channel = source.find((entry) => String(entry.id) === String(expectedId)) || source[index] || {};
    return {
      ...channel,
      id: channel.id ?? expectedId,
      name: channel.name || `${expectedId}线`,
      onlineCount: Math.max(0, Number(channel.onlineCount) || 0)
    };
  });
}

function renderLineSelection() {
  const channels = selectedServerChannels();
  state.gatewayChannelIndex = Math.max(0, Math.min(channels.length - 1, state.gatewayChannelIndex || 0));
  $("#lineServerName").textContent = state.serverName || "服务器";
  $("#lineMenuTitle").textContent = `${state.serverName || "服务器"}:线路`;
  $("#lineMessage").textContent = "";
  $("#lineList").innerHTML = channels.map((channel, index) => `
    <button type="button" class="gateway-menu-item${index === state.gatewayChannelIndex ? " active" : ""}" data-index="${index}" role="option" aria-selected="${index === state.gatewayChannelIndex ? "true" : "false"}">
      <small>${index + 1}.</small>
      <span>${escapeHtml(channel.name)}</span>
      <em>${channel.onlineCount} 人在线</em>
    </button>
  `).join("");
  $("#lineList").querySelectorAll(".gateway-menu-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.gatewayChannelIndex = Number(button.dataset.index) || 0;
      renderLineSelection();
    });
    button.addEventListener("dblclick", confirmLineSelection);
  });
  $("#lineList .gateway-menu-item.active")?.scrollIntoView({ block: "nearest" });
}

async function refreshLineSelection() {
  try {
    setLoading(true, "刷新线路状态中...");
    const serverId = state.serverId;
    await refreshGatewayServers();
    const server = state.servers.find((entry) => String(entry.id) === String(serverId));
    if (!server) {
      await openServerSelection({ refresh: false });
      $("#serverMessage").textContent = "原服务器已不可用，请重新选择。";
      return;
    }
    state.serverName = server.name || state.serverName;
    renderLineSelection();
  } catch (error) {
    console.warn("channel refresh failed", error);
    $("#lineMessage").textContent = "线路状态刷新失败。";
  } finally {
    setLoading(false);
  }
}

async function confirmLineSelection() {
  const channel = selectedServerChannels()[state.gatewayChannelIndex];
  if (!channel) {
    $("#lineMessage").textContent = "请选择线路。";
    return;
  }
  state.channelId = channel.id;
  await openCharacterSelection();
}

function characterSelection(character = {}) {
  return normalizeSelection(character.selection || character.player?.selection || {
    gender: character.gender,
    className: character.className,
    sub: character.sub,
    petId: character.petId
  });
}

function characterIdOf(character = {}) {
  return character.id ?? character.characterId ?? "";
}

function characterSlots() {
  const slots = Array.from({ length: 3 }, () => null);
  (state.characters || []).slice(0, 3).forEach((character) => {
    let index = -1;
    if (Number.isInteger(Number(character.characterSlot))) index = Number(character.characterSlot) - 1;
    else if (Number.isInteger(Number(character.slotIndex))) index = Number(character.slotIndex);
    else if (Number.isInteger(Number(character.slot))) index = Number(character.slot) - 1;
    if (index < 0 || index >= slots.length || slots[index]) index = slots.findIndex((entry) => !entry);
    if (index >= 0) slots[index] = character;
  });
  return slots;
}

function selectedCharacterSlot() {
  return characterSlots()[state.gatewayCharacterIndex] || null;
}

function renderCharacterSelection() {
  if (!state.charactersLoaded) {
    $("#characterServerMeta").textContent = `${state.serverName || "服务器"} · ${activeChannelName()}`;
    $("#characterSlots").innerHTML = '<div class="gateway-empty">角色列表暂不可用，请点击刷新重试。</div>';
    decorateMenuFrame($("#characterSlots"));
    $("#characterConfirm").textContent = "进入游戏";
    $("#characterConfirm").disabled = true;
    return;
  }
  const slots = characterSlots();
  state.gatewayCharacterIndex = Math.max(0, Math.min(2, state.gatewayCharacterIndex || 0));
  $("#characterServerMeta").textContent = `${state.serverName || "服务器"} · ${activeChannelName()}`;
  $("#characterSlots").innerHTML = slots.map((character, index) => {
    if (!character) {
      return `
        <button type="button" class="character-slot selection-option empty${index === state.gatewayCharacterIndex ? " active" : ""}" data-index="${index}" role="option" aria-selected="${index === state.gatewayCharacterIndex ? "true" : "false"}">
          <span class="character-slot-figure selection-figure"><span class="character-slot-add" aria-hidden="true">+</span></span>
          <span class="character-slot-copy"><strong>创建角色</strong><span>空角色位</span></span>
        </button>
      `;
    }
    const selection = characterSelection(character);
    const role = careerTree.roleForSelection(selection);
    const level = Math.max(1, Number(character.level ?? character.player?.level) || 1);
    return `
      <button type="button" class="character-slot selection-option${index === state.gatewayCharacterIndex ? " active" : ""}" data-index="${index}" data-character-id="${escapeHtml(characterIdOf(character))}" role="option" aria-selected="${index === state.gatewayCharacterIndex ? "true" : "false"}">
        <span class="character-slot-figure selection-figure"><canvas width="96" height="112" data-sprite-id="${role?.id || (selection.gender === "男" ? 53 : 54)}" data-selected="${index === state.gatewayCharacterIndex ? "true" : "false"}"></canvas></span>
        <span class="character-slot-copy"><strong>${escapeHtml(character.name || character.player?.name || state.loginAccount)}</strong><span>${escapeHtml(role?.name || `${selection.gender}性角色`)}</span></span>
        <span class="character-slot-level">Lv.${level}</span>
      </button>
    `;
  }).join("");
  $("#characterSlots").querySelectorAll(".character-slot").forEach((button) => {
    button.addEventListener("click", () => {
      state.gatewayCharacterIndex = Number(button.dataset.index) || 0;
      renderCharacterSelection();
    });
    button.addEventListener("dblclick", confirmCharacterSelection);
  });
  $("#characterSlots").querySelectorAll("canvas[data-sprite-id]").forEach((canvas) => {
    drawPreview(canvas, Number(canvas.dataset.spriteId) || 54, canvas.dataset.selected === "true");
  });
  decorateMenuFrame($("#characterSlots"));
  $("#characterConfirm").textContent = selectedCharacterSlot() ? "进入游戏" : "创建角色";
  $("#characterConfirm").disabled = false;
  $("#characterSlots .character-slot.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function openCharacterSelection({ refresh = true } = {}) {
  showScreen("characters");
  $("#characterMessage").textContent = "";
  try {
    if (refresh) {
      state.charactersLoaded = false;
      renderCharacterSelection();
      setLoading(true, "读取角色列表中...");
      const result = await apiGet(`/api/characters?serverId=${encodeURIComponent(state.serverId)}`);
      state.characters = Array.isArray(result.characters) ? result.characters : [];
      state.maxCharacters = Math.min(3, Math.max(1, Number(result.maxCharacters) || 3));
      state.charactersLoaded = true;
    }
    state.gatewayCharacterIndex = Math.max(0, Math.min(2, state.gatewayCharacterIndex || 0));
    renderCharacterSelection();
  } catch (error) {
    console.warn("character list failed", error);
    state.characters = [];
    state.charactersLoaded = false;
    renderCharacterSelection();
    $("#characterMessage").textContent = "角色列表读取失败，请稍后重试。";
  } finally {
    setLoading(false);
  }
}

function beginCharacterCreation() {
  if (!state.charactersLoaded) {
    $("#characterMessage").textContent = "角色列表尚未读取成功，请先刷新。";
    return;
  }
  if (state.characters.length >= state.maxCharacters) {
    $("#characterMessage").textContent = `每个服务器最多创建 ${state.maxCharacters} 个角色。`;
    return;
  }
  state.creatingCharacter = true;
  state.account = "";
  state.selected = normalizeSelection({
    gender: "女",
    className: careerTree.INITIAL_CLASS,
    sub: careerTree.INITIAL_SUB,
    petId: 486
  });
  $("#characterNameInput").value = "";
  $("#createMessage").textContent = "";
  $("#createStepTitle").textContent = "选择角色性别";
  renderCreator();
  showScreen("create");
  setTimeout(() => $("#characterNameInput")?.focus(), 0);
}

async function enterSelectedCharacter(character) {
  const characterId = characterIdOf(character);
  if (!characterId) throw new Error("character_not_found");
  const result = await postApi("/api/characters/select", {
    serverId: state.serverId,
    characterId,
    channelId: state.channelId
  });
  const selectedCharacter = result.character || character;
  const internalId = characterIdOf(selectedCharacter) || characterId;
  state.authToken = result.token || state.authToken;
  state.account = String(internalId);
  state.serverId = result.server?.id ?? state.serverId;
  state.serverName = result.server?.name || state.serverName;
  state.channelId = result.channelId ?? state.channelId;
  state.selected = characterSelection(selectedCharacter);
  state.creatingCharacter = false;
  state.users[state.account] = { ...(state.users[state.account] || {}), selected: { ...state.selected } };
  saveUserHints();
  await enterGame(result.player || null);
}

async function confirmCharacterSelection() {
  if (!state.charactersLoaded) {
    $("#characterMessage").textContent = "角色列表尚未读取成功，请先刷新。";
    return;
  }
  const character = selectedCharacterSlot();
  if (!character) {
    beginCharacterCreation();
    return;
  }
  try {
    setLoading(true, "进入角色中...");
    await enterSelectedCharacter(character);
  } catch (error) {
    console.warn("character select failed", error);
    setLoading(false);
    showScreen("characters");
    $("#characterMessage").textContent = error.message === "character_not_found" ? "角色不存在，请刷新列表。" : "角色进入失败，请稍后重试。";
  }
}

function cancelCharacterCreation() {
  state.creatingCharacter = false;
  $("#createMessage").textContent = "";
  showScreen("characters");
  renderCharacterSelection();
}

async function createCharacterAndEnter() {
  const name = $("#characterNameInput").value.trim();
  if (!name) {
    $("#createMessage").textContent = "请输入角色名。";
    $("#characterNameInput").focus();
    return;
  }
  const button = $("#startGame");
  button.disabled = true;
  $("#createMessage").textContent = "";
  try {
    setLoading(true, "创建角色中...");
    const result = await postApi("/api/characters", {
      serverId: state.serverId,
      channelId: state.channelId,
      name,
      selection: normalizeSelection(state.selected)
    });
    const character = result.character || result.player || {};
    const internalId = characterIdOf(character) || result.player?.id;
    if (!internalId) throw new Error("bad_character_response");
    state.authToken = result.token || state.authToken;
    state.account = String(internalId);
    state.selected = normalizeSelection(result.player?.selection || character.selection || state.selected);
    state.creatingCharacter = false;
    state.characters = [...state.characters, { ...character, id: internalId, name }].slice(0, 3);
    state.users[state.account] = { ...(state.users[state.account] || {}), selected: { ...state.selected } };
    saveUserHints();
    await enterGame(result.player || null);
  } catch (error) {
    console.warn("character create failed", error);
    const messages = {
      character_limit: "该服务器的 3 个角色位已满。",
      name_exists: "角色名已被使用。",
      name_taken: "角色名已被使用。",
      bad_name: "角色名格式不正确。",
      bad_selection: "角色性别选择无效。",
      bad_character: "角色数据无效，请重新选择。"
    };
    setLoading(false);
    showScreen("create");
    $("#createMessage").textContent = messages[error.message] || "角色创建失败，请稍后重试。";
  } finally {
    button.disabled = false;
  }
}

function moveGatewaySelection(delta) {
  if (screens.server.classList.contains("active")) {
    if (!state.servers.length) return;
    state.gatewayServerIndex = (state.gatewayServerIndex + delta + state.servers.length) % state.servers.length;
    renderServerSelection();
  } else if (screens.line.classList.contains("active")) {
    state.gatewayChannelIndex = (state.gatewayChannelIndex + delta + 6) % 6;
    renderLineSelection();
  } else if (screens.characters.classList.contains("active")) {
    state.gatewayCharacterIndex = (state.gatewayCharacterIndex + delta + 3) % 3;
    renderCharacterSelection();
  } else if (screens.create.classList.contains("active")) {
    state.selected.gender = state.selected.gender === "女" ? "男" : "女";
    renderCreator();
  }
}

function handleGatewayKey(event) {
  const gatewayOpen = screens.server.classList.contains("active")
    || screens.line.classList.contains("active")
    || screens.characters.classList.contains("active")
    || screens.create.classList.contains("active");
  if (!gatewayOpen || $("#loading")?.classList.contains("active") || isTextInputTarget(event.target)) return;
  if (["ArrowUp", "ArrowLeft", "w", "W", "a", "A", "2", "4"].includes(event.key)) {
    event.preventDefault();
    moveGatewaySelection(-1);
  } else if (["ArrowDown", "ArrowRight", "s", "S", "d", "D", "6", "8"].includes(event.key)) {
    event.preventDefault();
    moveGatewaySelection(1);
  } else if (["Enter", " ", "1", "5"].includes(event.key)) {
    event.preventDefault();
    if (screens.server.classList.contains("active")) confirmServerSelection();
    else if (screens.line.classList.contains("active")) confirmLineSelection();
    else if (screens.characters.classList.contains("active")) confirmCharacterSelection();
    else createCharacterAndEnter();
  } else if (["Escape", "Backspace", "3"].includes(event.key)) {
    event.preventDefault();
    if (screens.create.classList.contains("active")) cancelCharacterCreation();
    else if (screens.characters.classList.contains("active")) showScreen("line");
    else if (screens.line.classList.contains("active")) showScreen("server");
    else showScreen("auth");
  }
}

function pressGatewayPadKey(key) {
  const gatewayOpen = screens.server.classList.contains("active")
    || screens.line.classList.contains("active")
    || screens.characters.classList.contains("active");
  if (!gatewayOpen || $("#loading")?.classList.contains("active")) return;
  if (key === "up" || key === "left") {
    moveGatewaySelection(-1);
  } else if (key === "down" || key === "right") {
    moveGatewaySelection(1);
  } else if (key === "confirm" || key === "nearby") {
    if (screens.server.classList.contains("active")) confirmServerSelection();
    else if (screens.line.classList.contains("active")) confirmLineSelection();
    else confirmCharacterSelection();
  } else if (key === "back") {
    if (screens.characters.classList.contains("active")) showScreen("line");
    else if (screens.line.classList.contains("active")) showScreen("server");
    else showScreen("auth");
  }
}

function setupGatewaySelection() {
  $("#serverBack").addEventListener("click", () => showScreen("auth"));
  $("#serverConfirm").addEventListener("click", confirmServerSelection);
  $("#serverRefresh").addEventListener("click", () => openServerSelection({ refresh: true }));
  $("#lineBack").addEventListener("click", () => showScreen("server"));
  $("#lineConfirm").addEventListener("click", confirmLineSelection);
  $("#lineRefresh").addEventListener("click", refreshLineSelection);
  $("#characterBack").addEventListener("click", () => showScreen("line"));
  $("#characterConfirm").addEventListener("click", confirmCharacterSelection);
  $("#characterRefresh").addEventListener("click", () => openCharacterSelection({ refresh: true }));
  const gatewayPad = $("#gatewayControlPad");
  const keyMap = controlPadKeys.map((row) => row.map((item) => item.key));
  gatewayPad?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const rect = gatewayPad.getBoundingClientRect();
    const column = Math.max(0, Math.min(3, Math.floor(((event.clientX - rect.left) / rect.width) * 4)));
    const row = Math.max(0, Math.min(2, Math.floor(((event.clientY - rect.top) / rect.height) * 3)));
    pressGatewayPadKey(keyMap[row][column]);
  });
  document.querySelectorAll(".gateway-menu:not(.selection-panel), .selection-panel > .gateway-menu-title, .gateway-actions .menu-framed-button").forEach(decorateMenuFrame);
  window.addEventListener("keydown", handleGatewayKey);
}

function setupAuth() {
  const cached = loadAuthCache();
  if (cached.account) $("#accountInput").value = cached.account;
  if (cached.account) $("#coverAccountInput").value = cached.account;
  applyLoginVisualMode();
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      document.querySelectorAll("[data-auth-mode]").forEach((b) => b.classList.toggle("active", b === button));
      $("#authMessage").textContent = "";
    });
  });

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const account = $("#accountInput").value.trim();
    const password = $("#passwordInput").value;
    await authenticateAccount({ account, password, mode: state.authMode, messageEl: $("#authMessage") });
  });

  setupCoverLogin();
}

function saveBrowserCredential(account, password) {
  if (!window.PasswordCredential || !navigator.credentials?.store || !account || !password) return;
  const credential = new window.PasswordCredential({ id: account, password, name: account });
  navigator.credentials.store(credential).catch(() => {});
}

function applyLoginVisualMode() {
  const coverEnabled = state.loginVisual?.mode === "cover";
  $("#authScreen").classList.toggle("cover-mode", coverEnabled);
  $("#coverLogin").classList.toggle("hidden", !coverEnabled);
  applyCoverLoginVisualSettings();
  if (coverEnabled) moveCoverSelection(0);
}

function applyCoverLoginVisualSettings() {
  const visual = normalizeLoginVisualSettings(state.loginVisual || {});
  state.loginVisual = visual;
  const stage = document.querySelector(".cover-stage");
  if (stage) {
    stage.style.setProperty("--cover-hotspot-left", `${visual.hotspotLeft}%`);
    stage.style.setProperty("--cover-hotspot-width", `${visual.hotspotWidth}%`);
    stage.style.setProperty("--cover-hotspot-height", `${visual.hotspotHeight}%`);
    stage.style.setProperty("--cover-arrow-left", `${visual.arrowLeft}%`);
    visual.positions.forEach((value, index) => stage.style.setProperty(`--cover-pos-${index}`, `${value}%`));
  }
  syncCoverLoginMedia(screens.auth.classList.contains("active"));
}

function syncCoverLoginMedia(active) {
  window.LoginMediaRuntime?.syncCoverMedia(document.querySelector(".cover-stage"), state.loginVisual, active);
}

async function authenticateAccount({ account, password, mode = "login", autoRegister = false, messageEl = $("#authMessage") }) {
  account = String(account || "").trim();
  password = String(password || "");
  if (!account || !password) {
    if (messageEl) messageEl.textContent = "请输入账号和密码。";
    return false;
  }
  const doRegister = async () => {
    const { response, result } = await authApi("/api/auth/register", { account, password });
    if (result.error === "network_error") {
      if (messageEl) messageEl.textContent = `连接服务器失败：${SERVER_ORIGIN || location.origin}`;
      return false;
    }
    if (!response.ok && result.error === "account_exists") {
      if (messageEl) messageEl.textContent = "账号已存在，请直接登录。";
      return false;
    }
    if (!response.ok) {
      if (messageEl) messageEl.textContent = "注册失败，请稍后再试。";
      return false;
    }
    state.authToken = result.token || "";
    state.isAdmin = false;
    return true;
  };
  const doLogin = async () => {
    const { response, result } = await authApi("/api/auth/login", { account, password });
    if (result.error === "network_error") {
      if (messageEl) messageEl.textContent = `连接服务器失败：${SERVER_ORIGIN || location.origin}`;
      return false;
    }
    if (!response.ok) {
      if (result.error === "account_banned") {
        const reason = String(result.banReason || "账号已被封禁").trim();
        const bannedAt = result.bannedAt ? `（封禁时间：${result.bannedAt}）` : "";
        if (messageEl) messageEl.textContent = `账号已被封禁：${reason}${bannedAt}`;
        return false;
      }
      if (autoRegister) return doRegister();
      if (messageEl) messageEl.textContent = "账号或密码不正确。";
      return false;
    }
    state.authToken = result.token || "";
    state.isAdmin = Boolean(result.admin);
    return true;
  };

  const ok = mode === "register" ? await doRegister() : await doLogin();
  if (!ok) return false;
  if (mode === "login") saveBrowserCredential(account, password);
  state.loginAccount = account;
  state.account = "";
  state.authPassword = password;
  state.serverId = "";
  state.serverName = "";
  state.channelId = "";
  state.characters = [];
  state.charactersLoaded = false;
  state.creatingCharacter = false;
  if (window.MapAdminEditor) window.MapAdminEditor.setAdmin(state.isAdmin);
  saveAuthCache(account);
  saveUserHints();
  $("#accountInput").value = account;
  $("#passwordInput").value = "";
  $("#coverAccountInput").value = account;
  $("#coverPasswordInput").value = "";
  await openServerSelection({ refresh: true });
  return true;
}

function setupCoverLogin() {
  const cover = $("#coverLogin");
  cover?.addEventListener("contextmenu", (event) => event.preventDefault());
  cover?.addEventListener("dragstart", (event) => event.preventDefault());
  document.querySelectorAll("[data-cover-index]").forEach((button) => {
    button.addEventListener("pointerdown", () => moveCoverSelection(Number(button.dataset.coverIndex) || 0));
    button.addEventListener("click", () => activateCoverSelection(Number(button.dataset.coverIndex) || 0));
  });
  $("#coverLoginBack")?.addEventListener("click", closeCoverDialog);
  $("#coverInfoBack")?.addEventListener("click", closeCoverInfoDialog);
  $("#coverInfoConfirm")?.addEventListener("click", () => {
    const networkOpen = !$("#coverNetworkOptions").classList.contains("hidden");
    if (networkOpen) confirmCoverNetworkSelection();
    else closeCoverInfoDialog();
  });
  $("#coverLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await authenticateAccount({
      account: $("#coverAccountInput").value,
      password: $("#coverPasswordInput").value,
      mode: "login",
      autoRegister: true,
      messageEl: $("#coverAuthMessage")
    });
    if (ok) closeCoverDialog();
  });
  document.querySelectorAll("[data-network-mode]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveCoverNetworkSelection(Number(button.dataset.networkIndex) || 0);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveCoverNetworkSelection(Number(button.dataset.networkIndex) || 0);
      confirmCoverNetworkSelection();
    });
  });
  setupCoverControlPad();
  window.addEventListener("keydown", handleCoverLoginKey);
}

function setupCoverControlPad() {
  const pad = $("#coverControlPad");
  if (!pad) return;
  const keyMap = controlPadKeys.map((row) => row.map((item) => item.key));
  const keyFromPointer = (event) => {
    const rect = pad.getBoundingClientRect();
    const col = Math.max(0, Math.min(3, Math.floor(((event.clientX - rect.left) / rect.width) * 4)));
    const row = Math.max(0, Math.min(2, Math.floor(((event.clientY - rect.top) / rect.height) * 3)));
    return keyMap[row][col];
  };
  const pressCoverKey = (key) => {
    if (state.loginVisual?.mode !== "cover" || !screens.auth.classList.contains("active")) return;
    if (handleCoverSubmenuKey(key)) return;
    if (key === "up" || key === "left") moveCoverSelection((state.coverLoginIndex + 4) % 5);
    if (key === "down" || key === "right") moveCoverSelection((state.coverLoginIndex + 1) % 5);
    if (key === "confirm" || key === "nearby") activateCoverSelection(state.coverLoginIndex);
  };
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    pressCoverKey(keyFromPointer(event));
  });
}

function moveCoverSelection(index) {
  const positions = state.loginVisual?.positions || defaultLoginVisualSettings().positions;
  state.coverLoginIndex = Math.max(0, Math.min(positions.length - 1, index));
  $("#coverArrow").style.top = `${positions[state.coverLoginIndex]}%`;
}

function handleCoverLoginKey(event) {
  if (state.loginVisual?.mode !== "cover" || !screens.auth.classList.contains("active")) return;
  const coverLoginOpen = !$("#coverDialog").classList.contains("hidden");
  if (coverLoginOpen && isTextInputTarget(event.target) && !["Enter", "Escape"].includes(event.key)) return;
  const keyMap = {
    ArrowUp: "up", w: "up", W: "up", "2": "up",
    ArrowDown: "down", s: "down", S: "down", "8": "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    Enter: "confirm", " ": "confirm", "1": "confirm", "5": "nearby",
    Escape: "back", Backspace: "back", "3": "back"
  };
  const mapped = keyMap[event.key];
  if (mapped && handleCoverSubmenuKey(mapped)) {
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowUp" || event.key === "w" || event.key === "W" || event.key === "2") {
    event.preventDefault();
    moveCoverSelection((state.coverLoginIndex + 4) % 5);
  } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S" || event.key === "8") {
    event.preventDefault();
    moveCoverSelection((state.coverLoginIndex + 1) % 5);
  } else if (event.key === "Enter" || event.key === " " || event.key === "1") {
    event.preventDefault();
    activateCoverSelection(state.coverLoginIndex);
  }
}

function handleCoverSubmenuKey(key) {
  const loginOpen = !$("#coverDialog").classList.contains("hidden");
  const infoOpen = !$("#coverInfoDialog").classList.contains("hidden");
  if (!loginOpen && !infoOpen) return false;
  if (key === "back") {
    closeCoverDialog();
    closeCoverInfoDialog();
    return true;
  }
  if (loginOpen) {
    if (key === "confirm" || key === "nearby") $("#coverLoginForm").requestSubmit();
    return true;
  }
  const networkOpen = !$("#coverNetworkOptions").classList.contains("hidden");
  if (networkOpen) {
    if (key === "up" || key === "left") moveCoverNetworkSelection((state.coverNetworkIndex + 2) % 3);
    if (key === "down" || key === "right") moveCoverNetworkSelection((state.coverNetworkIndex + 1) % 3);
    if (key === "confirm" || key === "nearby") confirmCoverNetworkSelection();
    return true;
  }
  if (key === "confirm" || key === "nearby") closeCoverInfoDialog();
  return true;
}

function moveCoverNetworkSelection(index) {
  state.coverNetworkIndex = Math.max(0, Math.min(2, index));
  $("#coverNetworkOptions").querySelectorAll("[data-network-mode]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.networkIndex) === state.coverNetworkIndex);
  });
}

function confirmCoverNetworkSelection() {
  const button = $("#coverNetworkOptions").querySelector(`[data-network-index="${state.coverNetworkIndex}"]`);
  const mode = button?.dataset.networkMode || "高速";
  localStorage.setItem("pocket-spirit-network-mode", mode);
  $("#coverInfoContent").textContent = `当前网络模式：${mode}\n功能入口已保留，后续可接入专用线路策略。`;
}

async function activateCoverSelection(index) {
  moveCoverSelection(index);
  $("#coverMessage").textContent = "";
  if (index === 0) {
    const cached = loadAuthCache();
    if (!cached.account) {
      $("#coverMessage").textContent = "请先登录一次。";
      return;
    }
    openCoverLoginDialog();
  } else if (index === 1) {
    openCoverLoginDialog();
  } else if (index === 2) {
    openCoverInfoDialog("帮助信息", "上下方向键或触屏选择菜单，回车确认。\n登录游戏需要输入密码；账号不存在时会自动注册并进入创建角色流程。");
  } else if (index === 3) {
    openCoverInfoDialog("网络设置", `当前网络模式：${localStorage.getItem("pocket-spirit-network-mode") || "高速"}\n请选择线路模式。`);
    $("#coverNetworkOptions").classList.remove("hidden");
    moveCoverNetworkSelection(["高速", "普通 A", "普通 B"].indexOf(localStorage.getItem("pocket-spirit-network-mode")) >= 0 ? ["高速", "普通 A", "普通 B"].indexOf(localStorage.getItem("pocket-spirit-network-mode")) : 0);
  } else if (index === 4) {
    $("#coverMessage").textContent = "请直接关闭当前页面或应用窗口。";
    try { window.close(); } catch {}
  }
}

function openCoverLoginDialog() {
  const cached = loadAuthCache();
  $("#coverAccountInput").value = cached.account || $("#accountInput").value || "";
  $("#coverPasswordInput").value = "";
  $("#coverAuthMessage").textContent = "";
  $("#coverDialog").classList.remove("hidden");
  decorateCoverDialog($("#coverDialog"));
}

function closeCoverDialog() {
  $("#coverDialog").classList.add("hidden");
}

function openCoverInfoDialog(title, content) {
  $("#coverInfoTitle").textContent = title;
  $("#coverInfoContent").textContent = content;
  $("#coverNetworkOptions").classList.add("hidden");
  $("#coverInfoDialog").classList.remove("hidden");
  decorateCoverDialog($("#coverInfoDialog"));
}

function closeCoverInfoDialog() {
  $("#coverInfoDialog").classList.add("hidden");
}

function decorateCoverDialog(dialog) {
  dialog.querySelectorAll(".cover-menu-title, .cover-menu-body").forEach(decorateMenuFrame);
  dialog.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
}

function setupCreator() {
  $("#backToLogin").addEventListener("click", cancelCharacterCreation);
  $("#characterNameInput").addEventListener("input", () => { $("#createMessage").textContent = ""; });
  $("#characterNameInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    createCharacterAndEnter();
  });
  $("#startGame").addEventListener("click", createCharacterAndEnter);
}

function setupControls() {
  const setDir = (dir) => {
    state.inputDir = dir;
  };
  const handleBattlePadKey = (key) => {
    const battle = state.battle;
    if (!battle) return false;
    if (key === "task") {
      toggleAutoBattle();
      return true;
    }
    if (!battle.waiting) return true;
    if (battle.targeting) {
      if (key === "up" || key === "left") {
        moveBattleTarget(-1);
        return true;
      }
      if (key === "down" || key === "right") {
        moveBattleTarget(1);
        return true;
      }
      if (key === "confirm" || key === "nearby") {
        confirmBattleTarget();
        return true;
      }
    }
    if (battle.menuMode !== "command") {
      if (key === "up" || key === "left") {
        moveBattleSubmenu(-1);
        return true;
      }
      if (key === "down" || key === "right") {
        moveBattleSubmenu(1);
        return true;
      }
      if (key === "confirm" || key === "nearby") {
        confirmBattleSubmenu();
        return true;
      }
      if (key === "back") {
        closeBattleSubmenu();
        return true;
      }
      return true;
    }
    if (key === "left" || key === "up") {
      moveBattleCommand(-1);
      return true;
    }
    if (key === "right" || key === "down") {
      moveBattleCommand(1);
      return true;
    }
    if (key === "confirm" || key === "nearby") {
      confirmBattleCommand();
      return true;
    }
    if (key === "back") {
      closeBattleSubmenu() || escapeBattle();
      return true;
    }
    return false;
  };
  const pad = $("#controlPad");
  const controlDigitByKey = new Map(controlPadKeys.flat().map((item) => [item.key, item.digit]).filter(([, digit]) => digit));
  const pressKey = (key) => {
    onUserActivity();
    if (activeRewardDialog()) {
      if (key === "nearby" || key === "confirm") closeActiveRewardDialog();
      return;
    }
    if (state.roleStatsOpen) {
      if (key === "confirm" || key === "nearby") toggleRoleStatsCardPage();
      if (key === "back") closeRoleStatsCard();
      return;
    }
    if (isInputUiActive()) return;
    if (handleBattlePadKey(key)) return;
    const digit = controlDigitByKey.get(key);
    if (handleQuickMenuDigit(digit)) return;
    if (state.menuOpen) {
      pressControlKey(key);
      return;
    }
    pressControlKey(key);
  };
  const pressControlKey = (key) => {
    if (window.RegionFlyMap?.isOpen?.()) {
      if (window.RegionFlyMap.handleKey(key)) return;
    }
    if (key === "channel" && window.ChatHistoryUI?.isOpen()) {
      window.ChatHistoryUI.close();
      return;
    }
    if (window.ChatHistoryUI?.handleKey(key)) return;
    if (state.menuOpen) {
      if (state.menuMode && state.menuMode !== "main") {
        if (state.menuMode === "model_scale_adjust") {
          if (key === "up" || key === "left") return adjustModelScaleBy(-1);
          if (key === "down" || key === "right") return adjustModelScaleBy(1);
          if (key === "confirm" || key === "nearby") return confirmModelScaleOptionMenu();
          if (key === "back") return backModelScaleMenu();
          return;
        }
        if (key === "up" || key === "left") return moveMainMenuItem(-1);
        if (key === "down" || key === "right") return moveMainMenuItem(1);
        if (key === "confirm" || key === "nearby") return confirmMainMenuItem();
        if (key === "back" && state.menuMode === "lucky_box_roll") return backLuckyBoxRollMenu();
        if (key === "back" && ["dizi_npc", "daily_news", "reading_exchange"].includes(state.menuMode)) return backDiziNpcMenu();
        if (key === "back" && ["dizi_npc_fallback", "dizi_news_fallback", "dizi_exchange_fallback"].includes(state.menuMode)) return openDiziNpcMenuFallback();
        if (key === "back" && state.menuMode.startsWith("mad_brag")) return backMadBragMenu();
        if (key === "back" && ["detail_settings", "model_scale"].includes(state.menuMode)) return backModelScaleMenu();
        if (key === "back") return closeMainMenu();
        return;
      }
      if (key === "left") return moveMainMenuTab(-1);
      if (key === "right") return moveMainMenuTab(1);
      if (key === "up") return moveMainMenuItem(-1);
      if (key === "down") return moveMainMenuItem(1);
      if (key === "confirm" || key === "nearby") return confirmMainMenuItem();
      if (key === "back") return closeMainMenu();
      if (key === "task") {
        state.menuTab = 3;
        state.menuItem = 0;
        return renderMainMenu();
      }
      return;
    }
    const dirMap = { up: "up", down: "down", left: "left", right: "right" };
    if (dirMap[key]) {
      if (state.followLeaderId) return;
      setDir(dirMap[key]);
      return;
    }
    if (key === "nearby") {
      openNearbyActionMenu();
    }
    if (key === "name") toggleNearbyPlayersHidden();
    if (key === "confirm") openMainMenuAt(0, "个人状态");
    if (key === "back") openMainMenu(1);
    if (key === "system") openMainMenu(4);
    if (key === "channel") openChatHistoryPanel();
    if (key === "task") openMainMenu(3);
    if (key === "chat") openMainMenuAt(2, "本线广播");
  };
  const keyMap = controlPadKeys.map((row) => row.map((item) => item.key));
  const keyFromPointer = (event) => {
    const rect = pad.getBoundingClientRect();
    const col = Math.max(0, Math.min(3, Math.floor(((event.clientX - rect.left) / rect.width) * 4)));
    const row = Math.max(0, Math.min(2, Math.floor(((event.clientY - rect.top) / rect.height) * 3)));
    return keyMap[row][col];
  };
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    pressKey(keyFromPointer(event));
  });
  document.querySelectorAll(".pad-softkeys [data-key], .pad-grid [data-key]").forEach((button) => {
    bindTouchButton(button, () => pressKey(button.dataset.key));
  });
  pad.addEventListener("pointerup", () => setDir(null));
  pad.addEventListener("pointercancel", () => setDir(null));

window.addEventListener('pointerdown', () => onUserActivity(), { passive: true });
window.addEventListener('keydown', (event) => {
    if (isTextInputTarget(event.target)) return;
    onUserActivity();
    if (activeRewardDialog()) {
      if (event.key === "5" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeActiveRewardDialog();
      }
      return;
    }
    if (state.roleStatsOpen) {
      if (event.key === "5" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleRoleStatsCardPage();
      }
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        closeRoleStatsCard();
      }
      return;
    }
    if (isInputUiActive()) return;
    if (state.battle && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"].includes(event.key)) return;
    const chatHistoryKey = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Enter: "confirm",
      " ": "confirm",
      "0": "nextChannel",
      Escape: "back",
      Backspace: "back"
    }[event.key];
    if (chatHistoryKey && window.ChatHistoryUI?.handleKey(chatHistoryKey)) {
      event.preventDefault();
      return;
    }
    if (/^[0-9]$/.test(event.key) && handleQuickMenuDigit(event.key)) {
      event.preventDefault();
      return;
    }
    if (window.RegionFlyMap?.isOpen?.()) {
      const mapped = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Enter: "confirm",
        " ": "confirm",
        Escape: "back",
        Backspace: "back"
      }[event.key];
      if (mapped) {
        event.preventDefault();
        window.RegionFlyMap.handleKey(mapped);
        return;
      }
    }
    if (state.menuOpen) {
      if (state.menuMode && state.menuMode !== "main") {
        if (state.menuMode === "lucky_box_roll" && event.key === "5") {
          event.preventDefault();
          confirmLuckyBoxRollMenu();
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault();
          moveMainMenuItem(-1);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          moveMainMenuItem(1);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          confirmMainMenuItem();
          return;
        }
        if (event.key === "Escape" || event.key === "Backspace") {
          event.preventDefault();
          if (state.menuMode === "lucky_box_roll") {
            backLuckyBoxRollMenu();
            return;
          }
          closeMainMenu();
          return;
        }
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveMainMenuTab(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveMainMenuTab(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveMainMenuItem(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveMainMenuItem(1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        confirmMainMenuItem();
        return;
      }
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        closeMainMenu();
        return;
      }
    }
    if (event.key === "#") {
      event.preventDefault();
      openChatHistoryPanel();
      return;
    }
    const keys = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
    if (event.key === "5") {
      event.preventDefault();
      openNearbyActionMenu();
      return;
    }
    if (keys[event.key] && !state.followLeaderId) setDir(keys[event.key]);
  });
  window.addEventListener("keyup", () => {
    if (isInputUiActive()) return;
    setDir(null);
  });
  $("#gameCanvas").addEventListener("pointerdown", (event) => {
    addMapClickEffect(event);
    if (!state.player) return;
    const { wx, wy, tile } = tileFromCanvasEvent(event);
    if (window.MapAdminEditor?.onCanvasPointerDown?.(tile)) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (isInputUiActive()) return;
    if (state.followLeaderId) return;
    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  });
  $("#gameCanvas").addEventListener("pointermove", (event) => {
    if (!state.player) return;
    if (window.MapAdminEditor?.onCanvasPointerMove?.(tileFromCanvasEvent(event).tile)) return;
    if (isInputUiActive()) return;
  });
  $("#gameCanvas").addEventListener("pointerup", (event) => {
    if (window.MapAdminEditor?.onCanvasPointerUp?.(tileFromCanvasEvent(event).tile)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setDir(null);
      return;
    }
    if (isInputUiActive()) return;
    setDir(null);
  });
  $("#statsClose").addEventListener("click", () => {
    $("#statsPanel").classList.remove("active");
  });
  $("#systemStats").addEventListener("click", () => {
    $("#systemPanel").classList.remove("active");
    openStatusMenu(1);
  });
  $("#systemMap").addEventListener("click", () => {
    $("#systemPanel").classList.remove("active");
    alert(`当前地图：${state.mapName}`);
  });
  $("#systemLogout").addEventListener("click", logoutGame);
  bindTouchButton($("#mainMenuConfirm"), confirmMainMenuItem);
  bindTouchButton($("#mainMenuBack"), () => {
    if (state.menuMode === "lucky_box_roll") return backLuckyBoxRollMenu();
    if (["dizi_npc", "daily_news", "reading_exchange"].includes(state.menuMode)) return backDiziNpcMenu();
    if (["dizi_npc_fallback", "dizi_news_fallback", "dizi_exchange_fallback"].includes(state.menuMode)) return openDiziNpcMenuFallback();
    if (state.menuMode?.startsWith("mad_brag")) return backMadBragMenu();
    if (["detail_settings", "model_scale", "model_scale_adjust"].includes(state.menuMode)) return backModelScaleMenu();
    return closeMainMenu();
  });
  $("#roleStatsAction")?.addEventListener("click", toggleRoleStatsCardPage);
  $("#roleStatsBack")?.addEventListener("click", closeRoleStatsCard);
  $("#renameConfirm").addEventListener("click", submitPenguinRename);
  $("#renameCancel").addEventListener("click", closePenguinRename);
  $("#passwordConfirm").addEventListener("click", submitPasswordChange);
  $("#passwordCancel").addEventListener("click", closePasswordPanel);
  $("#redeemConfirm").addEventListener("click", submitRoxasRedeemCode);
  $("#redeemCancel").addEventListener("click", closeRedeemPanel);
  $("#giveQuantityConfirm").addEventListener("click", submitGiveQuantity);
  $("#giveQuantityCancel").addEventListener("click", closeGiveQuantityPanel);
  $("#stallPriceConfirm").addEventListener("click", submitStallPrice);
  $("#stallPriceCancel").addEventListener("click", () => closeStallPricePanel(true));
  $("#stallBuyQuantityConfirm").addEventListener("click", submitStallBuyQuantity);
  $("#stallBuyQuantityCancel").addEventListener("click", () => closeStallBuyQuantityPanel(true));
  $("#battleRewardContinue").addEventListener("click", closeBattleRewardPanel);
  $("#soulPowderRewardContinue").addEventListener("click", closeSoulPowderRewardPanel);
  $("#infoDialogContinue").addEventListener("click", closeInfoDialog);
  $("#renameInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitPenguinRename();
    if (event.key === "Escape") closePenguinRename();
  });
  ["oldPasswordInput", "newPasswordInput", "confirmPasswordInput"].forEach((id) => {
    $(`#${id}`).addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitPasswordChange();
      if (event.key === "Escape") closePasswordPanel();
    });
  });
  $("#redeemInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitRoxasRedeemCode();
    if (event.key === "Escape") closeRedeemPanel();
  });
  $("#giveQuantityInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitGiveQuantity();
    if (event.key === "Escape") closeGiveQuantityPanel();
  });
  $("#stallPriceInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitStallPrice();
    if (event.key === "Escape") closeStallPricePanel(true);
  });
  $("#stallBuyQuantityInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitStallBuyQuantity();
    if (event.key === "Escape") closeStallBuyQuantityPanel(true);
  });
}

function closeHudPanels() {
  clearMenuHint();
  closeBattleRewardPanel();
  $("#statsPanel").classList.remove("active");
  $("#nearbyPanel").classList.remove("active");
  window.ChatHistoryUI?.close();
  closePrivateChatDialog();
  $("#emojiPanel").classList.remove("active");
  $("#chatForm").classList.remove("active");
  state.privateChatTarget = null;
  $("#chatInput").placeholder = "";
  $("#systemPanel").classList.remove("active");
  $("#renamePanel").classList.remove("active");
  $("#passwordPanel").classList.remove("active");
  $("#redeemPanel").classList.remove("active");
  $("#giveQuantityPanel").classList.remove("active");
  state.menuQuantityContext = null;
  $("#controlPad").style.pointerEvents = "";
  $("#stallPricePanel")?.classList.remove("active");
  $("#stallBuyQuantityPanel")?.classList.remove("active");
  state.menuStallBuy = null;
  state.penguinRenameOpen = false;
  closeRoleStatsCard();
  closeMainMenu();
}

function setupChat() {
  const emojiPanel = $("#emojiPanel");
  closePrivateChatDialog();
  let emojiPage = 0;
  const applyEmojiPage = () => {
    emojiPanel.classList.toggle("ico-page", emojiPage === 1);
    const pageToggle = $("#emojiPageToggle");
    if (pageToggle) pageToggle.textContent = emojiPage === 0 ? "图标表情" : "普通表情";
  };
  for (let index = 0; index < 39; index++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-choice emoji-page-0";
    button.style.backgroundPosition = `-${index * 18}px center`;
    button.addEventListener("click", () => {
      const input = $("#chatInput");
      input.value += `[e${index}]`;
      input.focus();
      emojiPanel.classList.remove("active");
    });
    emojiPanel.appendChild(button);
  }
  for (let index = 0; index < 45; index++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-choice ico-emoji-choice emoji-page-1";
    button.style.backgroundPosition = `-${(index % 9) * 16}px -${Math.floor(index / 9) * 16}px`;
    button.addEventListener("click", () => {
      const input = $("#chatInput");
      input.value += `[ico${index}]`;
      input.focus();
      emojiPanel.classList.remove("active");
    });
    emojiPanel.appendChild(button);
  }
  const pageActions = document.createElement("div");
  pageActions.className = "emoji-page-actions";
  const pageToggle = document.createElement("button");
  pageToggle.id = "emojiPageToggle";
  pageToggle.type = "button";
  pageToggle.addEventListener("click", () => {
    emojiPage = emojiPage === 0 ? 1 : 0;
    applyEmojiPage();
  });
  pageActions.appendChild(pageToggle);
  emojiPanel.appendChild(pageActions);
  applyEmojiPage();
  $("#emojiBtn").addEventListener("click", () => {
    emojiPanel.classList.toggle("active");
  });
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#chatInput");
    const text = input.value.trim();
    if (!text || !state.player) return;
    if (state.privateChatTarget) {
      sendRoomMessage({ type: "chat.send", channel: "whisper", to: state.privateChatTarget.peerId, text });
      addPrivateChatLine(state.privateChatTarget.name, text, true, state.privateChatTarget.peerId);
      input.value = "";
      return;
    }
    addChat(state.player, text);
    input.value = "";
  });
  $("#chatCancel").addEventListener("click", () => {
    $("#chatForm").classList.remove("active");
    $("#emojiPanel").classList.remove("active");
    state.privateChatTarget = null;
    $("#chatInput").value = "";
  });
  $("#privateChatClose").addEventListener("click", closePrivateChatDialog);
  $("#privateChatReply").addEventListener("click", () => {
    const panel = $("#privateChatDialog");
    const peerId = String(panel.dataset.peerId || "");
    const name = String(panel.dataset.name || "私聊");
    closePrivateChatDialog();
    if (peerId) openChatComposer("whisper", { peerId, name });
  });
}

function logoutGame() {
  stopIdleHunt();
  if (state.stall.active) stopStall(false, false);
  if (state.socket) {
    if (state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: "leave", peerId: state.peerId }));
    }
    state.socket.close();
    state.socket = null;
  }
  state.authToken = "";
  state.authPassword = "";
  state.loginAccount = "";
  state.account = "";
  state.serverId = "";
  state.serverName = "";
  state.channelId = "";
  state.characters = [];
  state.charactersLoaded = false;
  state.creatingCharacter = false;
  state.player = null;
  state.pet = null;
  state.remotes = [];
  state.peers.clear();
  restoreBattleActors();
  closeHudPanels();
  showScreen("auth");
}

function setupBattle() {
  setupBattleCommandBar();
  $("#battleClose").textContent = "逃跑";
  $("#attackBtn").addEventListener("click", () => chooseBattleAction(false));
  $("#skillBtn").addEventListener("click", () => chooseBattleAction(true));
  $("#battleClose").addEventListener("click", () => {
    if (!cancelBattleTargetSelection()) escapeBattle();
  });
  $("#battleCanvas").addEventListener("pointerdown", addBattleClickEffect);
  $("#battleCanvas").addEventListener("click", selectBattleTargetFromCanvas);
  window.addEventListener("keydown", handleBattleKey);
}

function setupBattleCommandBar() {
  const card = document.querySelector(".battle-card");
  if (!card || $("#battleCommandBar")) return;
  const title = $("#battleTitle");
  title.classList.add("battle-title");
  const bar = document.createElement("div");
  bar.id = "battleCommandBar";
  bar.className = "battle-command-bar";
  bar.setAttribute("aria-label", "战斗指令");
  const actions = document.querySelector(".battle-actions");
  card.insertBefore(bar, actions || null);
}

async function setupOfflineAssetCache() {
  if (isPackagedClient || !("serviceWorker" in navigator)) return;
  if (isEdgeBrowser) {
    await disableOfflineAssetCacheForEdge();
    return;
  }
  if (!/^(1|true|yes)$/i.test(String(localStorage.getItem("dw-enable-offline-cache") || ""))) return;
  try {
    const registration = await navigator.serviceWorker.register("sw.js");
    const prefetch = () => {
      const worker = registration.active || navigator.serviceWorker.controller;
      if (/^(1|true|yes)$/i.test(String(localStorage.getItem("dw-prefetch-assets") || ""))) {
        worker?.postMessage({ type: "prefetch-assets" });
      }
    };
    if (registration.active || navigator.serviceWorker.controller) {
      prefetch();
    } else {
      navigator.serviceWorker.addEventListener("controllerchange", prefetch, { once: true });
    }
  } catch (error) {
    console.warn("本地资源缓存未启用", error);
  }
}

async function disableOfflineAssetCacheForEdge() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn("Edge 离线缓存注销失败", error);
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("dw-")).map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Edge 离线缓存清理失败", error);
  }
}

async function refreshClientVersion({ forceReload = false } = {}) {
  try {
    const response = await fetch(`${SERVER_ORIGIN}/api/asset-manifest`, { cache: "no-store" });
    if (!response.ok) return false;
    const manifest = await response.json();
    const version = String(manifest.version || "");
    if (!version) return false;
    const previous = localStorage.getItem("dw-client-version") || "";
    state.clientVersion = version;
    localStorage.setItem("dw-client-version", version);
    if (forceReload && previous && previous !== version) {
      showMenuHint("检测到新版本，正在刷新...");
      setTimeout(() => location.reload(), 500);
      return true;
    }
    return previous && previous !== version;
  } catch (error) {
    console.warn("客户端版本检查失败", error);
    return false;
  }
}

window.addEventListener("beforeunload", () => {
  window.LoginMediaRuntime?.disposeCoverMedia(document.querySelector(".cover-stage"));
  if (state.pendingBattleInvite) {
    const battleId = state.pendingBattleInvite.battleId;
    sendRoomMessage({ type: "battleMarkerEnd", battleId });
    sendRoomMessage({ type: "battleEnd", battleId, to: state.pendingBattleInvite.targetPeerId });
  }
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: "leave", peerId: state.peerId }));
  }
});

async function boot() {
  state.showPetNames = loadPetNamePreference();
  await refreshClientVersion();
  setupOfflineAssetCache();
  setupBackgroundKeepAlive();
  await loadGameVisualSettings();
  await loadLoginVisualSettings();
  await loadGrowthConfig();
  setupAuth();
  setupGatewaySelection();
  setupCreator();
  if (window.MapAdminEditor) {
    window.MapAdminEditor.init({
      currentTile: () => {
        const tileSize = state.map?.tileSize || 16;
        return {
          mapName: state.mapName,
          x: Math.floor((state.player?.x || 0) / tileSize),
          y: Math.floor((state.player?.y || 0) / tileSize)
        };
      },
      savePortals: saveMapPortals,
      scanMaps: scanMapDirectory,
      switchMap: async (mapName) => {
        if (!mapName || mapName === state.mapName) return;
        const target = worldMapTargets().find((item) => item.name === mapName) || { name: mapName, x: 1, y: 1 };
        await changeMap(target.name, target.x, target.y);
      }
    });
    window.MapAdminEditor.setAdmin(state.isAdmin);
  }
  initRegionFlyMap();
  initQuickMenuHotkeys();
  setupControls();
  setupChat();
  setupBattle();
  renderCreator();
  setLoading(false);
  requestAnimationFrame(loop);
}

boot().catch((error) => {
  console.error(error);
  setLoading(true, `加载失败：${error.message}`);
});
