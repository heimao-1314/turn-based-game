(() => {
  const rewards = [
    ["精炼宝石", 1, 5.6667, "forge_refine_gem", "1.13"],
    ["修复宝石", 1, 5.6667, "repair_gem", "1.13"],
    ["轻段宝石", 1, 5.6667, "light_forge_gem", "1.13"],
    ["精灵锻造宝石", 3, 10, "elf_forge_gem", "1.13"],
    ["铁质宠物腰带", 10, 7, "iron_pet_belt", "1.19"],
    ["普通启魂书", 10, 7, "common_soul_book", "1.11"],
    ["神宠召唤券", 10, 7, "divine_pet_ticket", "2.6"],
    ["超级启魂书", 20, 7.5, "super_soul_book", "1.11"],
    ["魂宠召唤券", 20, 7.5, "soul_pet_ticket", "2.6"],
    ["神迹三星石", 40, 3.8, "miracle_three_star_stone", "1.13"],
    ["单向项重制注魔宝石", 40, 3.8, "single_recast_enchant_gem", "1.13"],
    ["银质宠物腰带", 40, 3.8, "silver_pet_belt", "1.19"],
    ["圣品启魂书", 40, 3.8, "holy_soul_book", "1.11"],
    ["圣宠召唤券", 40, 3.8, "holy_pet_ticket", "2.6"],
    ["完美启魂书", 50, 2.5, "perfect_soul_book", "1.11"],
    ["S圣宠召唤券", 50, 2.5, "s_holy_pet_ticket", "2.6"],
    ["无瑕的极致黄宝石·抗封印", 100, 0.5882, "flawless_yellow_anti_seal", "2.17"],
    ["无瑕的极致黄宝石·抗昏睡", 100, 0.5882, "flawless_yellow_anti_sleep", "2.17"],
    ["无瑕的极致黄宝石·抗混乱", 100, 0.5882, "flawless_yellow_anti_confusion", "2.17"],
    ["无瑕的极致黄宝石·抗麻痹", 100, 0.5882, "flawless_yellow_anti_paralysis", "2.17"],
    ["无瑕的极致黄宝石·抗诅咒", 100, 0.5882, "flawless_yellow_anti_curse", "2.17"],
    ["无瑕的极致蓝宝石·抗技能", 100, 0.5882, "flawless_blue_anti_skill", "2.14"],
    ["无瑕的极致蓝宝石·抗物理", 100, 0.5882, "flawless_blue_anti_physical", "2.14"],
    ["无瑕的极致黄宝石·抗暴伤", 100, 0.5882, "flawless_yellow_anti_crit_damage", "2.17"],
    ["无瑕的极致红宝石·致命", 100, 0.5882, "flawless_red_crit", "2.13"],
    ["无瑕的极致蓝宝石·闪避", 100, 0.5882, "flawless_blue_dodge", "2.14"],
    ["无瑕的极致红宝石·暴伤", 100, 0.5882, "flawless_red_crit_damage", "2.13"],
    ["无瑕的极致红宝石·命中", 100, 0.5882, "flawless_red_hit", "2.13"],
    ["无瑕的极致蓝宝石·生命", 100, 0.5882, "flawless_blue_hp", "2.14"],
    ["无瑕的极致蓝宝石·防御", 100, 0.5882, "flawless_blue_defense", "2.14"],
    ["无瑕的极致黄宝石·速度", 100, 0.5882, "flawless_yellow_speed", "2.17"],
    ["无瑕的极致红宝石·法力", 100, 0.5882, "flawless_red_mana", "2.13"],
    ["无瑕的极致红宝石·攻击", 100, 0.5882, "flawless_red_attack", "2.13"],
    ["SS圣宠召唤券", 150, 1, "ss_holy_pet_ticket", "2.6"],
    ["S圣技·魔力之光·宠物技能卡", 300, 0.7, "s_skill_magic_light", "skill"],
    ["S圣技·奥秘飞弹·宠物技能卡", 400, 0.08, "s_skill_arcane_missile", "skill"],
    ["S圣技·狂风术·宠物技能卡", 400, 0.08, "s_skill_gale", "skill"],
    ["S圣技·神风术·宠物技能卡", 400, 0.08, "s_skill_divine_wind", "skill"],
    ["S圣技·横扫千军·宠物技能卡", 400, 0.08, "s_skill_whirlwind", "skill"],
    ["S圣技·连击·宠物技能卡", 400, 0.08, "s_skill_combo", "skill"],
    ["S圣技·破坏一击·宠物技能卡", 500, 0.2, "s_skill_breaking_strike", "skill"],
    ["S圣技·涅槃·宠物技能卡", 600, 0.1, "s_skill_rebirth", "skill"],
    ["珍奇宠物召唤券", 450, 0.5, "rare_pet_ticket", "2.6"],
    ["SS圣技·旋风斩·宠物技能卡", 1000, 0.0167, "ss_skill_whirlwind_slash", "skill"],
    ["SS圣技·神速斩·宠物技能卡", 1000, 0.0167, "ss_skill_swift_slash", "skill"],
    ["SS圣技·恶魔谜语·宠物技能卡", 1000, 0.0167, "ss_skill_demon_riddle", "skill"],
    ["SS圣技·混沌之眼·宠物技能卡", 1000, 0.0167, "ss_skill_eye_of_chaos", "skill"],
    ["SS圣技·雷霆咆哮·宠物技能卡", 1000, 0.0167, "ss_skill_thunder_roar", "skill"],
    ["SS圣技·神灭一击·宠物技能卡", 1000, 0.0167, "ss_skill_divine_smite", "skill"]
  ].map(([name, value, probability, id, icon]) => ({ name, value, probability, id, icon }));

  const targetIconRefs = {
    forge_refine_gem: "lucky:1:13", repair_gem: "lucky:1:13", light_forge_gem: "lucky:1:13", elf_forge_gem: "lucky:1:13",
    miracle_three_star_stone: "lucky:1:13", single_recast_enchant_gem: "lucky:1:13",
    iron_pet_belt: "lucky:1:19", silver_pet_belt: "lucky:1:19",
    common_soul_book: "lucky:1:last", super_soul_book: "lucky:1:last", holy_soul_book: "lucky:1:last", perfect_soul_book: "lucky:1:last",
    divine_pet_ticket: "lucky:2:6", soul_pet_ticket: "lucky:2:6", holy_pet_ticket: "lucky:2:6", s_holy_pet_ticket: "lucky:2:6", ss_holy_pet_ticket: "lucky:2:6", rare_pet_ticket: "lucky:2:6",
    flawless_yellow_anti_seal: "lucky:2:17", flawless_yellow_anti_sleep: "lucky:2:17", flawless_yellow_anti_confusion: "lucky:2:17", flawless_yellow_anti_paralysis: "lucky:2:17", flawless_yellow_anti_curse: "lucky:2:17", flawless_yellow_anti_crit_damage: "lucky:2:17", flawless_yellow_speed: "lucky:2:17",
    flawless_blue_anti_skill: "lucky:2:14", flawless_blue_anti_physical: "lucky:2:14", flawless_blue_dodge: "lucky:2:14", flawless_blue_hp: "lucky:2:14", flawless_blue_defense: "lucky:2:14",
    flawless_red_crit: "lucky:2:13", flawless_red_crit_damage: "lucky:2:13", flawless_red_hit: "lucky:2:13", flawless_red_mana: "lucky:2:13", flawless_red_attack: "lucky:2:13"
  };
  rewards.forEach((item) => { if (targetIconRefs[item.id]) item.icon = targetIconRefs[item.id]; else if (item.icon === "skill") item.icon = "lucky:skill"; });

  const totalWeight = rewards.reduce((sum, item) => sum + item.probability, 0);
  function roll(random = Math.random()) {
    let cursor = random * totalWeight;
    for (const item of rewards) {
      cursor -= item.probability;
      if (cursor <= 0) return { ...item, quantity: 1 };
    }
    return { ...rewards[rewards.length - 1], quantity: 1 };
  }

  const api = { boxId: "lucky_box", boxName: "好运宝箱", boxIcon: "1.11", boxPrice: 40, currency: "yuanbao", rewards, totalWeight, roll };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.LuckyBoxModule = api;
})();
