/**
 * @file 贴纸生产.js
 * @description 生活技能：贴纸生产、库存与宠物贴纸效果规则。
 */
((global, factory) => {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.LifeSkillStickerModule = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const gradeOrder = ["一品", "二品", "三品", "四品", "五品", "神品", "魂品"];
  const gradeColors = {
    一品: "#7fc97f",
    二品: "#5bc0de",
    三品: "#6d8cff",
    四品: "#b37cff",
    五品: "#ff9f43",
    神品: "#ffd166",
    魂品: "#ff5d8f"
  };

  const gradeCosts = {
    一品: { paint: 1, silver: 1000, soulPowder: 20 },
    二品: { paint: 2, silver: 2000, soulPowder: 40 },
    三品: { paint: 3, silver: 4000, soulPowder: 80 },
    四品: { paint: 4, silver: 8000, soulPowder: 120 },
    五品: { paint: 5, silver: 16000, soulPowder: 200 },
    神品: { paint: 6, silver: 32000, soulPowder: 400 },
    魂品: { paint: 7, silver: 64000, soulPowder: 600 }
  };

  const applyOptions = [
    { quantity: 1, days: 1, soulPowder: 200 },
    { quantity: 3, days: 7, soulPowder: 400 },
    { quantity: 7, days: 21, soulPowder: 600 }
  ];

  const rawCatalog = {
    一品: [
      ["NPC.奥巴马", { attack: 3 }],
      ["NPC.锻皇柳柳(简笔画)", { hp: 38 }],
      ["宠物.葡萄", { attack: 6 }],
      ["宠物.妙树扇贝", { mana: 4 }],
      ["宠物.赤尾狐", { speed: 25 }],
      ["宠物.冰原扇贝", { defense: 9 }],
      ["宠物.蜗牛", { defense: 25 }],
      ["小生肖.酉鸡", { mana: 3 }],
      ["小生肖.巳蛇", { mana: 9 }],
      ["小生肖.申猴", { speed: 9 }],
      ["小生肖.子鼠", { speed: 12 }],
      ["小生肖.戌狗", { hp: 14 }],
      ["小生肖.丑牛", { hp: 19 }],
      ["小生肖.亥猪", { hp: 29 }],
      ["小生肖.寅虎", { attack: 2, defense: 4 }],
      ["小生肖.辰龙", { defense: 12 }]
    ],
    二品: [
      ["NPC.巴菲特", { defense: 37 }],
      ["宠物.草虫", { attack: 7 }],
      ["宠物.小蓝龙", { attack: 9 }],
      ["宠物.幽魂", { mana: 14 }],
      ["宠物.兔叉叉", { speed: 37 }],
      ["宠物.长毛猪", { hp: 57 }],
      ["宠物.水溅龟", { hp: 18, defense: 29 }],
      ["迷失国度.狂野号令者", { hp: 44, speed: 12 }]
    ],
    三品: [
      ["宠物.淘汰狼", { attack: 8 }],
      ["宠物.气鼓鱼", { attack: 9 }],
      ["宠物.美人鱼", { mana: 19 }],
      ["宠物.小树精", { mana: 13 }],
      ["宠物.帽子兔", { speed: 16, mana: 14 }],
      ["宠物.青螳", { speed: 34 }],
      ["宠物.蓝媚熊", { hp: 52 }],
      ["宠物.融冰兽", { hp: 59, mana: 6 }],
      ["宠物.加农炮", { defense: 34 }],
      ["宠物.绿帽鸭", { attack: 3, defense: 8 }],
      ["宠物.火鸡", { defense: 14 }],
      ["迷失国度.峭壁号令者", { attack: 3 }],
      ["迷失国度.深渊巨兽", { hp: 17, attack: 7, defense: 13, speed: 11 }],
      ["迷失国度.唤雨兽", { attack: 12 }],
      ["迷失国度.峭壁守护者", { speed: 13, mana: 11 }],
      ["迷失国度.邪恶灵魂", { speed: 50 }],
      ["迷失国度.火焰兽", { speed: 30, mana: 5 }],
      ["迷失国度.深渊怪物", { hp: 46, attack: 3, defense: 11, mana: 4 }],
      ["迷失国度.巨食兽", { hp: 76 }],
      ["迷失国度.冰雪兽", { hp: 20, attack: 2, defense: 30, mana: 4 }],
      ["迷失国度.邪恶意志", { defense: 50 }],
      ["迷失国度.史前巨兽", { attack: 4 }]
    ],
    四品: [
      ["NPC.舞镜", { mana: 7 }],
      ["宠物.独角兽", { attack: 15 }],
      ["宠物.爆爆熊", { hp: 25, attack: 9, defense: 14, speed: 14 }],
      ["宠物.红龙", { hp: 16, attack: 10, mana: 6 }],
      ["宠物.火巨人", { attack: 5, mana: 18 }],
      ["宠物.花仙子", { attack: 3, mana: 21 }],
      ["宠物.粉红狐", { mana: 23 }],
      ["宠物.死神鸟", { speed: 48, mana: 7 }],
      ["宠物.火蝙蝠", { speed: 63 }],
      ["宠物.绿牙兽", { hp: 95 }],
      ["宠物.丑小鸭", { hp: 57, attack: 3, defense: 16 }],
      ["宠物.火龙兽", { defense: 63 }],
      ["宠物.小翼龙", { hp: 31 }],
      ["生肖王.虎", { attack: 15 }],
      ["生肖王.猴", { speed: 43 }],
      ["生肖王.牛", { hp: 73, attack: 5 }],
      ["生肖王.猪", { hp: 57 }],
      ["生肖王.狗", { defense: 48, speed: 20 }],
      ["永恒梦境.幽灵", { mana: 7 }]
    ],
    五品: [
      ["宠物.不死鸟七色羽", { attack: 13, mana: 8 }],
      ["宠物.吸血猫叮当", { attack: 19 }],
      ["宠物.天使兔", { mana: 31 }],
      ["宠物.猪九戒", { hp: 124 }],
      ["宠物.猪坚强", { hp: 96, defense: 27 }],
      ["宠物.流感猪", { hp: 105 }],
      ["宠物.熊猫酒仙", { attack: 6, defense: 63 }]
    ],
    神品: [
      ["NPC.星澈", { speed: 33, mana: 29 }],
      ["NPC.粽子精灵", { speed: 27 }],
      ["宠物.百变魔女", { attack: 24 }],
      ["宠物.卡比", { mana: 10 }],
      ["宠物.神灯巨人", { mana: 38 }],
      ["宠物.小白狼", { speed: 40 }],
      ["宠物.人鱼公主", { speed: 101 }],
      ["宠物.邪恶之星", { attack: 10 }],
      ["彩云传说.甲兽", { hp: 105, defense: 17 }],
      ["彩云传说.雷兽", { hp: 118 }],
      ["彩云传说.魔神", { hp: 44, defense: 69, speed: 17 }],
      ["彩云传说.绿魔", { defense: 101 }],
      ["彩云传说.水兽", { attack: 44 }],
      ["彩云传说.地精", { speed: 33 }],
      ["彩云传说.风兽", { defense: 93, mana: 8 }]
    ],
    魂品: [
      ["NPC.桃子妹妹", { mana: 150 }],
      ["NPC.关重七", { speed: 132 }],
      ["NPC.锻皇柳柳", { hp: 301 }],
      ["BOSS.人造人零号", { attack: 132 }],
      ["BOSS.神泣时代逆流", { hp: 145, defense: 30, speed: 35, mana: 30 }],
      ["BOSS.神泣时代幻世", { defense: 132 }],
      ["BOSS.神泣时代天工", { speed: 143 }]
    ]
  };

  const statLabels = { attack: "攻击", hp: "生命", defense: "防御", speed: "速度", mana: "法力" };
  const stickers = gradeOrder.flatMap((grade) => rawCatalog[grade].map(([shortName, stats], index) => {
    const id = `sticker_${gradeOrder.indexOf(grade) + 1}_${String(index + 1).padStart(2, "0")}`;
    return { id, grade, name: `${grade}${shortName}`, stats, color: gradeColors[grade] };
  }));
  const stickerById = Object.fromEntries(stickers.map((item) => [item.id, item]));

  function normalizeInventory(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const inventory = {};
    stickers.forEach((item) => {
      const value = Math.max(0, Math.floor(Number(source[item.id]) || 0));
      if (value > 0) inventory[item.id] = value;
    });
    return inventory;
  }

  function normalizePetStickers(raw, nowMs = Date.now()) {
    const source = raw && typeof raw === "object" ? raw : {};
    const result = {};
    Object.entries(source).forEach(([petId, entries]) => {
      const list = Array.isArray(entries) ? entries : [];
      const normalized = list
        .filter((entry) => stickerById[entry?.stickerId])
        .map((entry) => ({
          stickerId: entry.stickerId,
          expiresAt: String(entry.expiresAt || "")
        }))
        .filter((entry) => Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) > nowMs)
        .slice(0, 5);
      if (normalized.length) result[String(petId)] = normalized;
    });
    return result;
  }

  function formatStats(stats) {
    return Object.entries(stats || {})
      .map(([stat, value]) => `${statLabels[stat] || stat}+${value}%`)
      .join("");
  }

  function addDays(iso, days, nowMs = Date.now()) {
    const base = Math.max(Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : 0, nowMs);
    return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  }

  function petStickerStats(petStickerEntries, nowMs = Date.now()) {
    const percent = {};
    normalizePetStickers({ pet: petStickerEntries }, nowMs).pet?.forEach((entry) => {
      const sticker = stickerById[entry.stickerId];
      Object.entries(sticker?.stats || {}).forEach(([stat, value]) => {
        percent[stat] = (percent[stat] || 0) + (Number(value) || 0);
      });
    });
    return percent;
  }

  return {
    gradeOrder,
    gradeColors,
    gradeCosts,
    applyOptions,
    stickers,
    stickerById,
    statLabels,
    normalizeInventory,
    normalizePetStickers,
    formatStats,
    addDays,
    petStickerStats
  };
});
