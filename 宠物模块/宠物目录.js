/**
 * @file 宠物目录.js
 * @description 统一维护宠物目录、免费领取名单、宠物技能和战斗形象映射。
 */
((global, factory) => {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PetModule = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const petCatalog = [
    { name: "狮子王", id: 486 },
    { name: "野猪王", id: 495 },
    { name: "白色幻影", id: 832 },
    { name: "骚猫", id: 836 },
    { name: "恶魔武士", id: 840 },
    { name: "阿木木", id: 895 },
    { name: "混沌女王", id: 905 },
    { name: "精灵女王", id: 909 },
    { name: "武装独角兽", id: 901 },
    { name: "青色独角兽", id: 899 },
    { name: "虚空恐惧", id: 893 },
    { name: "狐狸", id: 889 },
    { name: "龙骑领主", id: 752 },
    { name: "天空领主", id: 760 },
    { name: "铠甲", id: 756 },
    { name: "雪人宝宝", id: 4922, battleSpriteId: 4932 },
    { name: "花香宝宝", id: 5962, battleSpriteId: 5972 },
    { name: "冰龙宝宝", id: 5942, battleSpriteId: 5952 },
    { name: "机械神兽", id: 6252, battleSpriteId: 6262 },
    { name: "多头怪蛇", id: 6272, battleSpriteId: 6282 },
    { name: "黑暗死神", id: 6232, battleSpriteId: 6242 },
    { name: "灵魂裁判", id: 546, battleSpriteId: 547 },
    { name: "茉莉卡", id: 5012, battleSpriteId: 5022 },
    { name: "绝世雪妖", id: 407, battleSpriteId: 408 },
    { name: "陆行鸟", id: 297, battleSpriteId: 298 }
  ];

  const creatorPetIds = [486, 495, 832, 836, 840, 895];
  const freeClaimPetIds = [
    ...creatorPetIds,
    4922, 5962, 5942, 6252, 6272, 6232, 546, 5012, 407, 297
  ];
  const peerlessPetIds = [905, 909, 901, 899, 893, 889, 752, 760, 756];

  const petSkillIds = {
    486: "pet_lion",
    495: "pet_boar",
    832: "pet_phantom",
    836: "pet_cat",
    840: "pet_demon",
    895: "pet_amumu_curse",
    905: "peerless_chaos_invasion",
    909: "peerless_elf_sleep",
    901: "peerless_armed_thunder",
    899: "peerless_cyan_curse",
    893: "peerless_void_seal",
    889: "peerless_fox_confuse",
    752: "peerless_dragon_paralyze",
    760: "peerless_sky_curse",
    756: "peerless_armor_seal",
    4922: "pet_snowman_crush",
    5962: "pet_flower_fragrance",
    5942: "pet_ice_dragon_breath",
    6252: "pet_mechanical_destroy",
    6272: "pet_hydra_gaze",
    6232: "pet_dark_reaper",
    546: "pet_soul_judge_river",
    5012: "pet_molika_seal",
    407: "pet_peerless_snow_demon",
    297: "pet_default"
  };

  const petInnateSkillIds = {
    297: ["holy_chocobo_combo"]
  };

  const battleSpriteIdToPetId = Object.fromEntries(
    petCatalog
      .filter((pet) => pet.battleSpriteId)
      .map((pet) => [pet.battleSpriteId, pet.id])
  );
  Object.assign(battleSpriteIdToPetId, {
    906: 905,
    910: 909,
    902: 901,
    900: 899,
    894: 893,
    890: 889,
    753: 752,
    761: 760,
    757: 756
  });

  function normalizePetId(petId) {
    const id = Number(petId) || 0;
    return battleSpriteIdToPetId[id] || id;
  }

  function battleSpriteIdForPet(petId) {
    const id = normalizePetId(petId);
    const pet = petCatalog.find((item) => item.id === id);
    return pet?.battleSpriteId || id + 1;
  }

  return {
    petCatalog,
    creatorPetIds,
    freeClaimPetIds,
    peerlessPetIds,
    petSkillIds,
    petInnateSkillIds,
    battleSpriteIdToPetId,
    normalizePetId,
    battleSpriteIdForPet
  };
});
