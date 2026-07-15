/**
 * @file skills.js
 * @description 战斗技能系统 - 定义所有战斗技能的目录和技能查询逻辑
 *
 * 本模块是战斗系统的核心组件之一，包含：
 * - 技能目录 (skillCatalog): 定义所有技能的属性、效果和数值参数
 * - 技能运行时 (createRuntime): 提供技能查询、过滤和验证的工具函数
 *
 * 技能类型分类:
 * - physical: 物理攻击技能，基于攻击力和速度计算伤害
 * - magic: 魔法攻击技能，基于法力值计算伤害
 * - special: 特殊技能，通常附带控制效果（束缚、混乱等）
 * - heal: 治疗技能，恢复队友生命值
 * - self_buff: 自身增益技能，提升自身属性
 * - buff: 团队增益技能，提升队友属性
 * - passive: 被动技能，提供持续性效果
 *
 * @module BattleSkills
 * @requires 无外部依赖（可通过 module.exports 导出供 Node.js 使用）
 */
((global, factory) => {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.BattleSkills = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const skillCatalog = {
    gun_breaker: { name: "破魔双袭", type: "physical", attackScale: 1.7, manaScale: 0.25, targetCount: 2, sealChance: 0.75 },
    gun_bastion: { name: "流星重炮", type: "physical", speedScale: 18, attackScale: 0, bleed: { stat: "speed", scale: 5, turns: 3 } },
    gun_sniper: { name: "完美狙击", type: "physical", speedScale: 30, attackScale: 0 },
    mage_judgement: { name: "裁决禁锢", type: "special", sacrificeHpRate: 0.3, bindChance: 1, bindTurns: 3 },
    mage_shadow: { name: "混沌之眼", type: "special", confuseChance: 1, confuseTurns: 2 },
    mage_light: { name: "神圣治疗", type: "heal", teamHealRate: 0.5, cleanse: true },
    mage_wildfire: { name: "天火燎原", type: "magic", manaScale: 15, attackScale: 0, targetRule: "all" },
    sword_assassin: { name: "封喉", type: "physical", attackScale: 4, sealChance: 1, sealTurns: 2 },
    sword_fury: { name: "斩龙击", type: "physical", attackScale: 18, ignoreDefense: true, canCrit: false },
    sword_guard: { name: "蛮力", type: "physical", attackScale: 6, targetRule: "all", ignoreDefense: true, canCrit: false },
    sword_blade_dance: { name: "剑刃乱舞", type: "physical", attackScale: 2, targetRule: "all" },
    gun_demon_sting: { name: "恶魔钉刺", type: "physical", speedScale: 18, attackScale: 0, targetRule: "all" },
    pet_default: { name: "灵兽猛击", type: "physical", attackScale: 1.25, manaScale: 0.35 },
    pet_boar: { name: "野性闪避", type: "passive", passiveDodge: 0.5 },
    pet_lion: { name: "王者威压", type: "passive", passiveClearDefense: true },
    pet_phantom: { name: "幻影闪击", type: "physical", speedScale: 18, attackScale: 0, targetRule: "all", damageReductionDown: 0.25, debuffTurns: 2 },
    pet_demon: { name: "恶魔之力", type: "physical", attackScale: 2.5, targetRule: "all", confuseChance: 0.5, confuseTurns: 2 },
    pet_cat: { name: "魅惑之风", type: "magic", manaScale: 15, attackScale: 0, targetRule: "all", bleed: { stat: "mana", scale: 5, turns: 3 } },
    pet_amumu_curse: { name: "圣技木乃伊的诅咒", type: "physical", attackScale: 4, manaScale: 20, speedScale: 20, stunChance: 0.5, stunTurns: 2 },
    pet_snowman_crush: { name: "强力碾压", type: "physical", attackScale: 3, targetRule: "all" },
    pet_flower_fragrance: { name: "花香绽放", type: "magic", manaScale: 10, speedScale: 20, attackScale: 0, targetRule: "all", skillDamageMultiplier: 1.25, color: "sleep" },
    pet_ice_dragon_breath: { name: "寒冰吐息", type: "magic", speedScale: 30, attackScale: 0, targetRule: "all", selfSpeedBuffFlat: 1500, buffTurns: 1, color: "ice" },
    pet_mechanical_destroy: { name: "武装摧毁", type: "physical", attackScale: 2, speedScale: 15, targetRule: "all", color: "thunder" },
    pet_hydra_gaze: { name: "怪蛇凝视", type: "magic", manaScale: 15, speedScale: 15, attackScale: 0, targetRule: "all", confuseChance: 0.6, confuseTurns: 2, color: "chaos" },
    pet_dark_reaper: { name: "黑暗收割", type: "magic", manaScale: 15, attackScale: 0, targetRule: "all", bleed: { stat: "mana", scale: 20, turns: 30 }, noHealChance: 1, noHealTurns: 30, color: "curse" },
    pet_soul_judge_river: { name: "永恒之河", type: "heal", teamHealManaScale: 30, cleanseControls: true, controlImmuneTurns: 1, selfControlImmuneThisTurn: true, revive: true, color: "heal" },
    pet_molika_seal: { name: "茉莉双封", type: "magic", targetCount: 2, manaScale: 10, attackScale: 0, sealChance: 0.9, sealTurns: 2, color: "seal" },
    pet_peerless_snow_demon: { name: "绝世冰雪风暴", type: "magic", speedScale: 30, manaScale: 30, attackScale: 0, targetRule: "all", selfSpeedBuffFlat: 2000, buffTurns: 1, color: "ice" },
    holy_chocobo_combo: { name: "圣技.连击", type: "passive", passiveCombo: true, passiveComboBasic: true },
    peerless_chaos_invasion: { name: "绝世混沌侵袭", type: "magic", speedScale: 30, manaScale: 30, attackScale: 0, targetRule: "all", confuseChance: 0.75, confuseTurns: 2, color: "chaos" },
    peerless_elf_sleep: { name: "绝世精灵沉睡", type: "magic", speedScale: 30, manaScale: 30, attackScale: 0, targetRule: "all", sleepChance: 0.75, sleepTurns: 2, color: "sleep" },
    peerless_armed_thunder: { name: "绝世武装雷击", type: "physical", attackScale: 6, speedScale: 30, targetRule: "all", paralyzeChance: 0.75, paralyzeTurns: 2, color: "thunder" },
    peerless_cyan_curse: { name: "绝世青焰诅咒", type: "magic", manaScale: 30, speedScale: 30, attackScale: 0, targetRule: "all", curseChance: 0.75, curseTurns: 20, curseManaScale: 15, color: "fire" },
    peerless_void_seal: { name: "绝世虚空封印", type: "magic", speedScale: 30, manaScale: 30, attackScale: 0, targetRule: "all", sealChance: 0.75, sealTurns: 2, color: "seal" },
    peerless_fox_confuse: { name: "绝世狐惑迷心", type: "magic", speedScale: 30, manaScale: 30, attackScale: 0, targetRule: "all", confuseChance: 0.75, confuseTurns: 2, color: "chaos" },
    peerless_dragon_paralyze: { name: "绝世龙威震慑", type: "physical", attackScale: 6, speedScale: 30, targetRule: "all", paralyzeChance: 0.75, paralyzeTurns: 2, color: "thunder" },
    peerless_sky_curse: { name: "绝世天罚诅咒", type: "magic", manaScale: 30, speedScale: 30, attackScale: 0, targetRule: "all", curseChance: 0.75, curseTurns: 20, curseManaScale: 15, color: "curse" },
    peerless_armor_seal: { name: "绝世铁甲禁锢", type: "physical", attackScale: 6, defenseScale: 8, targetRule: "all", sealChance: 0.75, sealTurns: 2, color: "seal" },
    role_sword_dragon_slash: { name: "封龙斩", type: "physical", requiredClass: "剑士", requiredWeapon: "sword", requiredDemonWeapon: "demon_sword", targetRule: "all", hpDamageRate: 0.3, attackScale: 6, manaScale: 15, speedScale: 30 },
    role_sword_blood_burst: { name: "气血爆发", type: "self_buff", requiredClass: "剑士", requiredWeapon: "sword", requiredDemonWeapon: "demon_sword", maxHpMultiplier: 8, guardReduction: 0.75, passiveLifesteal: 1 },
    role_mage_frost_domain: { name: "冰封万域", type: "magic", requiredClass: "法师", requiredWeapon: "staff", requiredDemonWeapon: "demon_staff", targetRule: "all", bindChance: 0.75, bindTurns: 3, manaScale: 50, attackScale: 0, speedDownRate: 0.5, debuffTurns: 3 },
    role_mage_soul_burn: { name: "焚灵祭命", type: "self_buff", requiredClass: "法师", requiredWeapon: "staff", requiredDemonWeapon: "demon_staff", sacrificeAllies: ["pet", "mercenary"], controlImmune: true, allStatMultiplier: 3, passiveRebirthChance: 1, buffTurns: 3 },
    role_gun_shadow_barrage: { name: "迅影万弹", type: "physical", requiredClass: "枪手", requiredWeapon: "firearm", requiredDemonWeapon: "demon_firearm", targetRule: "all", speedScale: 50, attackScale: 0, speedBuffPerHit: 1, buffTurns: 3 },
    role_gun_soul_snipe: { name: "冥封魂狙", type: "physical", requiredClass: "枪手", requiredWeapon: "firearm", requiredDemonWeapon: "demon_firearm", targetRule: "all", sealChance: 0.8, sealTurns: 1, speedScale: 30, attackScale: 0 },
    merc_sword_deathblow: { name: "致死打击", type: "physical", attackScale: 8 },
    merc_gun_multishot: { name: "多重射击", type: "physical", speedScale: 28, attackScale: 0, targetRule: "all" },
    merc_mage_starfall: { name: "星陨法阵", type: "magic", manaScale: 25, attackScale: 0, targetRule: "all" },
    pet_double_dragon: { name: "双龙击", type: "physical", targetCount: 2, attackScale: 15, ignoreDefense: true, canCrit: false, severeBleedChance: 0.5, severeBleedAmount: 9999999, severeBleedTurns: 3 },
    pet_magic_field: { name: "禁魔立场", type: "physical", speedScale: 30, attackScale: 0, targetRule: "all", sealChance: 0.75, sealTurns: 2 },
    pet_eternal_sleep: { name: "永恒之眠", type: "special", sleepChance: 1, sleepTurns: 3 },
    holy_combo: { name: "圣品.连击", type: "passive", passiveCombo: true },
    holy_counter: { name: "圣品.反噬", type: "passive", passiveCounter: true },
    holy_rebirth: { name: "圣品.涅磐", type: "passive", passiveRebirthChance: 0.75 },
    holy_break_armor: { name: "圣品.破甲", type: "passive", passiveBreakArmor: true },
    holy_lifesteal: { name: "圣品.嗜血", type: "passive", passiveLifesteal: 0.5 },
    holy_elf_spring: { name: "圣品.精灵温泉", type: "heal", teamHealRate: 0.35, revive: true },
    holy_zeus_field: { name: "圣品.宙斯力场", type: "passive", panelStatMultiplier: 1.3, panelStatMultiplierStats: ["hp", "attack", "defense", "mana", "speed"] },
    holy_king_guard: { name: "圣品.国王守护", type: "passive", passiveGuardRole: true, guardReduction: 0.75 },
    holy_elf_guard: { name: "圣品.精灵守护", type: "passive", passiveGuardPet: true, guardReduction: 0.75 },
    holy_guild_guard: { name: "圣品.公会守护", type: "passive", passiveGuardMercenary: true, guardReduction: 0.75 },
    wild_amumu: { name: "藤木缠击", type: "physical", attackScale: 1.18, manaScale: 0.2, defenseScale: 0.12 },
    wild_afei_heal: { name: "飞羽回生", type: "heal", teamHealRate: 0.3, revive: true, targetDefeated: true },
    immortal_hand_curse: { name: "仙手血咒", type: "special", targetRule: "all", severeBleedChance: 1, severeBleedAmount: 20000, severeBleedTurns: 3 },
    immortal_foot_paralyze: { name: "仙脚麻痹", type: "special", targetRule: "all", paralyzeChance: 1, paralyzeTurns: 1, damageReductionDown: 0.2, debuffTurns: 3 },
    immortal_body_seal: { name: "仙身封印", type: "special", targetRule: "all", sealChance: 1, sealTurns: 2 },
    immortal_brain_stun_sleep: { name: "仙脑昏眠", type: "special", targetRule: "all", stunChance: 1, stunTurns: 1, sleepChance: 1, sleepTurns: 2 },
    immortal_heart_confuse: { name: "仙心混乱", type: "special", targetRule: "all", confuseChance: 1, confuseTurns: 2 },
    immortal_hand_double: { name: "仙手双断", type: "physical", targetCount: 2, attackScale: 0, fixedDamage: 200000, ignoreDefense: true, canCrit: false },
    immortal_foot_double: { name: "仙脚双断", type: "physical", targetCount: 2, attackScale: 0, fixedDamage: 400000, ignoreDefense: true, canCrit: false },
    immortal_body_double: { name: "仙身双断", type: "physical", targetCount: 2, attackScale: 0, fixedDamage: 600000, ignoreDefense: true, canCrit: false },
    immortal_brain_double: { name: "仙脑双断", type: "physical", targetCount: 2, attackScale: 0, fixedDamage: 800000, ignoreDefense: true, canCrit: false },
    immortal_heart_double: { name: "仙心双断", type: "physical", targetCount: 2, attackScale: 0, fixedDamage: 1000000, ignoreDefense: true, canCrit: false },
    elf_vault_rebirth_50: { name: "复活", type: "passive", passiveRebirthChance: 0.5 },
    elf_vault_reflect_75: { name: "反伤", type: "passive", reflectDamageRate: 0.75 },
    elf_vault_death_grit: { name: "不死的毅力", type: "passive", passiveDeathGrit: { threshold: 0.5 } },
    elf_vault_heal_cleanse: { name: "生命源泉", type: "heal", teamHealRate: 0.51, cleanseControls: true, revive: true, color: "heal" },
    elf_vault_seal_two: { name: "宝库封印", type: "special", targetCount: 2, sealChance: 1, sealTurns: 2, color: "seal" },
    elf_vault_sleep_two: { name: "宝库昏睡", type: "special", targetCount: 2, sleepChance: 1, sleepTurns: 2, color: "sleep" },
    elf_vault_boss_fire: { name: "火焰宝库裁决", type: "physical", fixedDamage: 10000000, targetRule: "all", ignoreDefense: true, canCrit: false, color: "fire" },
    elf_vault_boss_wood: { name: "木源宝库裁决", type: "physical", fixedDamage: 18000000, targetRule: "all", ignoreDefense: true, canCrit: false, color: "curse" },
    elf_vault_boss_water: { name: "水源宝库裁决", type: "physical", fixedDamage: 25000000, targetRule: "all", ignoreDefense: true, canCrit: false, color: "ice" },
    elf_vault_boss_ice: { name: "寒冰王座裁决", type: "physical", fixedDamage: 50000000, targetRule: "all", ignoreDefense: true, canCrit: false, color: "ice" },
    elf_vault_ice_seal: { name: "寒冰王座封印", type: "special", targetRule: "all", sealChance: 1, sealTurns: 2, color: "seal" },
    shining_strike: { name: "闪耀一击", type: "physical", attackScale: 1.1 }
  };

  /**
   * 创建技能系统运行时实例
   * 通过依赖注入方式提供技能查询和过滤功能。
   *
   * @param {Object} deps - 依赖对象
   * @param {Function} deps.getState - 获取游戏状态
   * @param {Function} deps.getEquippedItemInSlot - 获取装备栏物品
   * @param {Function} deps.getBattleTeamForActor - 获取角色所在战斗队伍
   * @param {Function} deps.fighterKind - 获取战斗单位类型 (role/pet/mercenary)
   * @returns {Object} 技能系统运行时 API
   */
  function createRuntime(deps) {
    /**
     * 获取角色所有可用技能 ID 列表（含被动技能）
     * 合并 skillId 和 skillIds 数组，去重后返回。
     *
     * @param {Object} stats - 角色属性对象
     * @param {string} [stats.skillId] - 主技能 ID
     * @param {string[]} [stats.skillIds] - 技能 ID 列表
     * @returns {string[]} 去重后的技能 ID 数组
     */
    function skillsForStats(stats) {
      return [...new Set(["shining_strike", ...(stats.skillIds || []), stats.skillId].filter(Boolean))];
    }

    function activeSkillsForStats(stats) {
      return skillsForStats(stats).filter((id) => skillCatalog[id] && skillCatalog[id].type !== "passive");
    }

    function skillById(skillId) {
      return skillCatalog[skillId] || skillCatalog.shining_strike || skillCatalog.pet_default;
    }

    function sacrificeAlliesReady(skill, actor = null) {
      if (!Array.isArray(skill?.sacrificeAllies) || !skill.sacrificeAllies.length || !actor) return true;
      const team = deps.getBattleTeamForActor(actor);
      if (!team.length) return true;
      return skill.sacrificeAllies.every((kind) => team.some((fighter) => fighter.actor !== actor && deps.fighterKind(fighter) === kind && !fighter.defeated));
    }

    /**
     * 检查职业技能是否可使用
     * 验证角色职业、武器类型、恶魔武器类型是否匹配技能要求，
     * 以及献祭类技能的前置条件是否满足。
     *
     * @param {string} skillId - 技能 ID
     * @param {Object} [selection] - 角色选择信息（含 className）
     * @param {Object} [actor] - 角色对象
     * @returns {boolean} 技能是否可用
     */
    function roleSkillUsable(skillId, selection = deps.getState().selected, actor = null) {
      const skill = skillById(skillId);
      if (!skill.requiredClass) return true;
      if (selection.className !== skill.requiredClass) return false;
      if (!sacrificeAlliesReady(skill, actor)) return false;
      return deps.getEquippedItemInSlot("weapon")?.type === skill.requiredWeapon
        && deps.getEquippedItemInSlot("demonWeapon")?.type === skill.requiredDemonWeapon;
    }

    function activeBattleSkillsForStats(stats, actor = null) {
      return activeSkillsForStats(stats).filter((id) => actor !== deps.getState().player || roleSkillUsable(id, deps.getState().selected, actor));
    }

    function defaultSkillIdForStats(stats) {
      const active = activeSkillsForStats(stats);
      return active.includes(stats?.skillId) ? stats.skillId : active[0] || "shining_strike";
    }

    function defaultBattleSkillIdForStats(stats, actor = null) {
      const active = activeBattleSkillsForStats(stats, actor);
      return active.includes(stats?.skillId) ? stats.skillId : active[0] || defaultSkillIdForStats(stats);
    }

    return {
      skillCatalog,
      skillsForStats,
      activeSkillsForStats,
      skillById,
      sacrificeAlliesReady,
      roleSkillUsable,
      activeBattleSkillsForStats,
      defaultSkillIdForStats,
      defaultBattleSkillIdForStats
    };
  }

  return {
    skillCatalog,
    createRuntime
  };
});
