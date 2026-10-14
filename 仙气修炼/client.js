const immortalCultivationPartIds = ["foot", "hand", "body", "brain", "heart"];
const immortalCultivationPartNames = {
  foot: "脚之修炼",
  hand: "手之修炼",
  body: "身之修炼",
  brain: "脑之修炼",
  heart: "心之修炼"
};
const immortalCultivationStatLabels = {
  speed: "速度",
  mana: "法力",
  hp: "生命",
  attack: "攻击",
  defense: "防御",
  crit: "致命"
};
const immortalCultivationStatMax = {
  speed: 150,
  mana: 200,
  hp: 15000,
  attack: 1500,
  defense: 1500,
  crit: 10
};

function openImmortalCultivationMenu() {
  state.menuMode = "immortal_cultivation";
  state.menuItem = 0;
  loadImmortalCultivation().then(() => {
    const amp = Math.round((state.immortalCultivation?.amplification || 0) * 100);
    const fullness = Math.round((state.immortalCultivation?.fullness || 0) * 100);
    setMenuAsSingleList(`仙气修炼 ${fullness}% / 增幅${amp}%`, immortalCultivationPartIds.map((id) => ({
      label: immortalCultivationPartNames[id],
      icon: "1.49"
    })));
    bindCurrentMenuClicks(confirmImmortalCultivationMenu);
  }).catch((error) => {
    setMenuAsSingleList("仙气修炼", [
      { label: error.message === "auth_required" ? "登录状态失效，请重新登录" : "仙气修炼读取失败", icon: "1.49", disabled: true }
    ]);
  });
}

async function loadImmortalCultivation() {
  const result = await apiGet("/api/immortal-cultivation/status");
  state.immortalCultivation = result.cultivation;
  return result.cultivation;
}

function confirmImmortalCultivationMenu() {
  const partId = immortalCultivationPartIds[state.menuItem];
  if (partId) openImmortalCultivationPartMenu(partId);
}

function slotText(slot, amp = 0) {
  if (!slot) return "空槽位";
  const label = immortalCultivationStatLabels[slot.stat] || slot.stat;
  const max = immortalCultivationStatMax[slot.stat] || 1;
  const value = Math.round(Number(slot.value) || 0);
  const ampPercent = Math.round((Number(amp) || 0) * 100);
  return `${label}:${value}/${max}（${ampPercent}%）`;
}

function openImmortalCultivationPartMenu(partId) {
  state.menuMode = "immortal_cultivation_part";
  state.menuItem = 0;
  state.immortalCultivationPartId = partId;
  const data = state.immortalCultivation?.data?.parts?.[partId] || [null, null, null];
  const amp = state.immortalCultivation?.amplification || 0;
  setMenuAsSingleList(immortalCultivationPartNames[partId], data.map((slot, index) => ({
    label: slot ? slotText(slot, amp) : `槽位${index + 1} 空槽位`,
    icon: "1.49"
  })));
  bindCurrentMenuClicks(confirmImmortalCultivationPartMenu);
}

function confirmImmortalCultivationPartMenu() {
  state.immortalCultivationSlotIndex = state.menuItem;
  state.menuMode = "immortal_cultivation_slot";
  state.menuItem = 0;
  setMenuAsSingleList(`槽位${state.immortalCultivationSlotIndex + 1}`, [
    { label: "洗练（1仙丹/200粉末）", icon: "1.49" },
    { label: "锁定属性洗练（2仙丹/400粉末）", icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmImmortalCultivationSlotMenu);
}

async function confirmImmortalCultivationSlotMenu() {
  const locked = state.menuItem === 1;
  try {
    const result = await postApi("/api/immortal-cultivation/reroll", {
      account: state.account,
      partId: state.immortalCultivationPartId,
      slotIndex: state.immortalCultivationSlotIndex,
      locked
    });
    state.immortalCultivation = result;
    state.serverStats = result.player?.serverStats || state.serverStats;
    state.soulPowder = result.soulPowder || state.soulPowder;
    showMenuHint(locked ? "锁定洗练完成" : "洗练完成");
    openImmortalCultivationPartMenu(state.immortalCultivationPartId);
  } catch (error) {
    showMenuHint(error.message === "not_enough_pill" ? "仙丹不足" : error.message === "not_enough_powder" ? "灵魂粉末不足" : "洗练失败");
  }
}
