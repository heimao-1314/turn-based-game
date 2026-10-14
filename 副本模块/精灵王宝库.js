/**
 * @file 精灵王宝库.js
 * @description 精灵王宝库副本配置：地图、Boss、怪物阵容、奖励池。
 */
((global, factory) => {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.ElfKingVault = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const dungeon = {
    mapName: "精灵王宝库",
    mapFile: "宝库.json",
    entry: { x: 7, y: 10 }
  };

  const stages = [
    {
      id: "elf_vault_fire",
      stage: 1,
      name: "火焰之地",
      npcName: "火焰之地守卫",
      spriteId: 2103,
      position: { x: 2, y: 3 },
      bossName: "火焰领主",
      boss: { spriteId: 2103, hp: 100000000, attack: 500000, defense: 250000, speed: 200000, skillId: "elf_vault_boss_fire", skillIds: ["elf_vault_boss_fire", "holy_lifesteal", "holy_counter"] },
      monsters: [
        { key: "healer", name: "火灵之主", spriteId: 335, count: 3, hp: 2000000, speed: 100000, skillId: "elf_vault_heal_cleanse", skillIds: ["elf_vault_heal_cleanse", "elf_vault_rebirth_50"] },
        { key: "reflector", name: "火之刺甲", spriteId: 112, count: 2, hp: 1000000, speed: 90000, skillId: "shining_strike", skillIds: ["elf_vault_reflect_75", "elf_vault_death_grit"], forceBasicAttack: true },
        { key: "sealer", name: "火灵法师", spriteId: 241, count: 2, hp: 2000000, speed: 90000, skillId: "elf_vault_seal_two" },
        { key: "sleeper", name: "火焰梦魇", spriteId: 401, count: 2, hp: 3000000, speed: 90000, skillId: "elf_vault_sleep_two" }
      ]
    },
    {
      id: "elf_vault_wood",
      stage: 2,
      name: "木之源地",
      npcName: "木之源地守卫",
      spriteId: 214,
      position: { x: 12, y: 3 },
      bossName: "木源领主",
      boss: { spriteId: 214, hp: 150000000, attack: 750000, defense: 250000, speed: 200000, skillId: "elf_vault_boss_wood", skillIds: ["elf_vault_boss_wood", "holy_lifesteal", "holy_counter"] },
      monsters: [
        { key: "healer", name: "木灵之主", spriteId: 162, count: 3, hp: 2000000, speed: 100000, skillId: "elf_vault_heal_cleanse", skillIds: ["elf_vault_heal_cleanse", "elf_vault_rebirth_50"] },
        { key: "reflector", name: "木之刺甲", spriteId: 165, count: 2, hp: 1000000, speed: 90000, skillId: "shining_strike", skillIds: ["elf_vault_reflect_75", "elf_vault_death_grit"], forceBasicAttack: true },
        { key: "sealer", name: "木灵法师", spriteId: 239, count: 2, hp: 2000000, speed: 90000, skillId: "elf_vault_seal_two" },
        { key: "sleeper", name: "藤眠祭司", spriteId: 183, count: 2, hp: 3000000, speed: 90000, skillId: "elf_vault_sleep_two" }
      ]
    },
    {
      id: "elf_vault_water",
      stage: 3,
      name: "水之源地",
      npcName: "水之源地守卫",
      spriteId: 2091,
      position: { x: 2, y: 16 },
      bossName: "水源领主",
      boss: { spriteId: 2091, hp: 200000000, attack: 1000000, defense: 500000, speed: 200000, skillId: "elf_vault_boss_water", skillIds: ["elf_vault_boss_water", "holy_lifesteal", "holy_counter"] },
      monsters: [
        { key: "healer", name: "水灵之主", spriteId: 357, count: 3, hp: 2000000, speed: 100000, skillId: "elf_vault_heal_cleanse", skillIds: ["elf_vault_heal_cleanse", "elf_vault_rebirth_50"] },
        { key: "reflector", name: "水之刺甲", spriteId: 180, count: 2, hp: 1000000, speed: 90000, skillId: "shining_strike", skillIds: ["elf_vault_reflect_75", "elf_vault_death_grit"], forceBasicAttack: true },
        { key: "sealer", name: "水灵法师", spriteId: 158, count: 2, hp: 2000000, speed: 90000, skillId: "elf_vault_seal_two" },
        { key: "sleeper", name: "水雾梦魇", spriteId: 159, count: 2, hp: 3000000, speed: 90000, skillId: "elf_vault_sleep_two" }
      ]
    },
    {
      id: "elf_vault_ice",
      stage: 4,
      name: "寒冰王座",
      npcName: "寒冰王座守卫",
      spriteId: 429,
      battleSpriteId: 430,
      position: { x: 12, y: 16 },
      bossName: "寒冰王座",
      boss: { spriteId: 429, battleSpriteId: 430, hp: 500000000, attack: 1000000, defense: 1000000, speed: 200000, skillId: "elf_vault_boss_ice", skillIds: ["elf_vault_boss_ice", "holy_lifesteal", "holy_counter", "holy_break_armor"], controlImmune: true, passiveRebirthChance: 1, passiveRebirthOnce: true, periodicSkillId: "elf_vault_ice_seal", periodicEvery: 5 },
      monsters: [
        { key: "healer", name: "冰灵之主", spriteId: 157, count: 3, hp: 2000000, speed: 100000, skillId: "elf_vault_heal_cleanse", skillIds: ["elf_vault_heal_cleanse", "elf_vault_rebirth_50"] },
        { key: "reflector", name: "冰之刺甲", spriteId: 252, count: 2, hp: 1000000, speed: 90000, skillId: "shining_strike", skillIds: ["elf_vault_reflect_75", "elf_vault_death_grit"], forceBasicAttack: true },
        { key: "sealer", name: "冰灵法师", spriteId: 240, count: 2, hp: 2000000, speed: 90000, skillId: "elf_vault_seal_two" },
        { key: "sleeper", name: "寒眠祭司", spriteId: 249, count: 2, hp: 3000000, speed: 90000, skillId: "elf_vault_sleep_two" }
      ]
    }
  ];

  const hiddenStage = {
    id: "elf_vault_hidden",
    stage: 5,
    hidden: true,
    name: "隐藏第五关",
    npcName: "宝库守门人",
    spriteId: 452,
    position: { x: 7, y: 9 },
    bossName: "宝库总攻",
    challengeLabel: "太弱了，全部一起上",
    compositeStageIds: stages.map((stage) => stage.id)
  };

  const allStages = [...stages, hiddenStage];

  const rewardPools = {
    tickets: ["peerless_pet_scroll_ticket", "peerless_skill_ticket", "holy_skill_ticket", "fashion_ticket", "peerless_holy_weapon_ticket", "peerless_role_skill_ticket"],
    skillCards: [
      "skill_card_double_dragon",
      "skill_card_magic_field",
      "skill_card_eternal_sleep",
      "skill_card_role_sword_dragon_slash",
      "skill_card_role_sword_blood_burst",
      "skill_card_role_mage_frost_domain",
      "skill_card_role_mage_soul_burn",
      "skill_card_role_gun_shadow_barrage",
      "skill_card_role_gun_soul_snipe",
      "skill_card_holy_combo",
      "skill_card_holy_counter",
      "skill_card_holy_rebirth",
      "skill_card_holy_break_armor",
      "skill_card_holy_lifesteal",
      "skill_card_holy_elf_spring",
      "skill_card_holy_king_guard",
      "skill_card_holy_elf_guard",
      "skill_card_holy_guild_guard"
    ]
  };

  const rewardProfiles = {
    1: { rolls: 1, bonusChance: 0.35, paint: [1, 2] },
    2: { rolls: 2, bonusChance: 0.45, paint: [2, 4] },
    3: { rolls: 3, bonusChance: 0.55, paint: [4, 7] },
    4: { rolls: 4, bonusChance: 0.75, paint: [8, 12], phantomTitleChance: 0.5 },
    5: { rolls: 8, bonusChance: 1, paint: [18, 28], phantomTitleChance: 0.5 }
  };

  function stageById(id) {
    return allStages.find((stage) => stage.id === id) || null;
  }

  function stageByNumber(stageNumber) {
    return allStages.find((stage) => stage.stage === Number(stageNumber)) || null;
  }

  function previousStageId(stage) {
    return stage.stage > 1 ? stageByNumber(stage.stage - 1)?.id || "" : "";
  }

  function normalizeProgress(raw, todayKey = "") {
    const progress = raw && typeof raw === "object" ? raw : {};
    const today = progress.date === todayKey ? progress : {};
    return {
      date: todayKey,
      claimed: today.claimed && typeof today.claimed === "object" ? today.claimed : {}
    };
  }

  function canChallenge(progress, stage, todayKey) {
    if (!stage) return { ok: false, error: "bad_boss" };
    const current = normalizeProgress(progress, todayKey);
    if (current.claimed[stage.id]) return { ok: false, error: "already_claimed_today" };
    const previous = previousStageId(stage);
    if (previous && !current.claimed[previous]) return { ok: false, error: "previous_required" };
    return { ok: true };
  }

  return {
    dungeon,
    stages,
    hiddenStage,
    allStages,
    rewardPools,
    rewardProfiles,
    stageById,
    stageByNumber,
    previousStageId,
    normalizeProgress,
    canChallenge
  };
});
