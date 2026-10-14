const madBragStakeOptions = [
  { id: "silver", name: "银币", icon: "1.11", max: 999999999 },
  { id: "immortal_pill", name: "仙丹", icon: "1.49" },
  { id: "peerless_pet_scroll_ticket", name: "绝世宠物召唤券", icon: "2.12" }
];

function madBragStakeText(stake = {}) {
  return `${stake.name || stake.id || "下注"} x${stake.quantity || 0}`;
}

function madBragChallengeText(item = {}) {
  const status = item.status === "resolved" ? `，胜：${item.winnerName || "未知"}` : "";
  return `${item.creatorName || "玩家"}：${item.question}（${madBragStakeText(item.stake)}${status}）`;
}

async function openMadBragMenu() {
  state.menuMode = "mad_brag";
  state.menuItem = 0;
  setMenuAsSingleList("疯狂吹牛", [
    { label: "发起公开挑战", icon: "1.39" },
    { label: "最新吹牛列表", icon: "1.49" },
    { label: "我的大话", icon: "2.10" },
    { label: "我的抢话", icon: "2.12" },
    { label: "排行榜", icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmMadBragMenu);
}

function confirmMadBragMenu() {
  if (state.menuMode === "mad_brag") {
    if (state.menuItem === 0) return startMadBragCreate();
    if (state.menuItem === 1) return openMadBragList();
    if (state.menuItem === 2) return openMadBragMine();
    if (state.menuItem === 3) return openMadBragResponses();
    if (state.menuItem === 4) return openMadBragRankingRoot();
  }
  if (state.menuMode === "mad_brag_create_text") return submitMadBragTextForm();
  if (state.menuMode === "mad_brag_stake_type") return chooseMadBragStakeType();
  if (state.menuMode === "mad_brag_correct") return chooseMadBragCorrect();
  if (state.menuMode === "mad_brag_list") return openMadBragDetail();
  if (state.menuMode === "mad_brag_detail") return answerMadBragChoice();
  if (state.menuMode === "mad_brag_ranking_root") return openMadBragRankingList();
}

function backMadBragMenu() {
  if (state.menuMode === "mad_brag") return closeMainMenu();
  if (state.menuMode === "mad_brag_create_text") return openMadBragMenu();
  if (state.menuMode === "mad_brag_detail") return openMadBragList();
  if (state.menuMode === "mad_brag_list" || state.menuMode === "mad_brag_mine" || state.menuMode === "mad_brag_responses" || state.menuMode === "mad_brag_ranking_root") return openMadBragMenu();
  if (state.menuMode === "mad_brag_ranking_list") return openMadBragRankingRoot();
  return openMadBragMenu();
}

function startMadBragCreate() {
  state.menuMode = "mad_brag_create_text";
  state.menuOpen = true;
  $("#mainMenu").classList.remove("lucky-box-roll");
  $("#mainMenu").classList.add("active");
  $("#mainMenuTabs").innerHTML = `<button type="button" class="active">发起公开挑战</button>`;
  $("#mainMenuList").innerHTML = `
    <div class="main-menu-list-scroll" style="gap:6px;padding:6px;">
      <label style="display:grid;gap:3px;color:#f6edd0;font-size:12px;">问题
        <input id="madBragQuestionInput" maxlength="90" autocomplete="off" placeholder="一加一是不是等于二" style="width:100%;box-sizing:border-box;" />
      </label>
      <label style="display:grid;gap:3px;color:#f6edd0;font-size:12px;">选项一
        <input id="madBragOptionAInput" maxlength="36" autocomplete="off" value="是" style="width:100%;box-sizing:border-box;" />
      </label>
      <label style="display:grid;gap:3px;color:#f6edd0;font-size:12px;">选项二
        <input id="madBragOptionBInput" maxlength="36" autocomplete="off" value="不是" style="width:100%;box-sizing:border-box;" />
      </label>
      <div id="madBragCreateMessage" class="rename-message"></div>
      <button id="madBragTextNext" type="button" class="menu-framed-button compact">下一步</button>
    </div>
  `;
  decorateMenuFrame($("#mainMenuTabs"));
  decorateMenuFrame($("#mainMenuList"));
  $("#mainMenuList").querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
  $("#madBragTextNext")?.addEventListener("click", submitMadBragTextForm);
  setTimeout(() => $("#madBragQuestionInput")?.focus(), 0);
}

function submitMadBragTextForm() {
  const question = String($("#madBragQuestionInput")?.value || "").trim();
  const optionA = String($("#madBragOptionAInput")?.value || "").trim();
  const optionB = String($("#madBragOptionBInput")?.value || "").trim();
  if (!question || !optionA || !optionB) {
    const message = $("#madBragCreateMessage");
    if (message) message.textContent = "请填写问题和两个选项";
    return;
  }
  state.madBragDraft = { question, optionA, optionB, correctOption: "A", stake: null };
  state.menuMode = "mad_brag_correct";
  state.menuItem = 0;
  setMenuAsSingleList("设置正确选项", [
    { label: `选项一：${optionA}`, icon: "1.49" },
    { label: `选项二：${optionB}`, icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmMadBragMenu);
}

function chooseMadBragCorrect() {
  if (!state.madBragDraft) return openMadBragMenu();
  state.madBragDraft.correctOption = state.menuItem === 0 ? "A" : "B";
  state.menuMode = "mad_brag_stake_type";
  state.menuItem = 0;
  setMenuAsSingleList("选择下注物品", madBragStakeOptions.map((item) => ({
    label: item.name,
    icon: item.icon
  })));
  bindCurrentMenuClicks(confirmMadBragMenu);
}

function chooseMadBragStakeType() {
  const option = madBragStakeOptions[state.menuItem];
  if (!option || !state.madBragDraft) return openMadBragMenu();
  openQuantityPanel({
    title: "疯狂吹牛下注",
    label: `请输入${option.name}数量`,
    maxQuantity: option.max || 999999,
    initialQuantity: 1,
    onCancel: () => openMadBragMenu(),
    onConfirm: async (quantity) => {
      hideQuantityPanel();
      await submitMadBragChallenge(option, quantity);
    }
  });
}

async function submitMadBragChallenge(option, quantity) {
  try {
    await postApi("/api/mad-brag/create", {
      account: state.account,
      ...state.madBragDraft,
      stake: { type: option.id, quantity }
    });
    state.madBragDraft = null;
    await refreshBag().catch(() => null);
    showMenuHint("公开挑战已发布");
    openMadBragMenu();
  } catch (error) {
    showMenuHint(error.message === "not_enough_stake" ? "下注不足" : "发布失败");
    openMadBragMenu();
  }
}

async function openMadBragList() {
  state.menuMode = "mad_brag_list";
  state.menuItem = 0;
  try {
    const result = await apiGet("/api/mad-brag/list");
    state.madBragList = result.challenges || [];
    const rows = state.madBragList.map((item) => ({
      label: madBragChallengeText(item),
      icon: item.mine ? "2.10" : item.stake?.icon || "1.49",
      disabled: item.mine === true
    }));
    setMenuAsSingleList("最新吹牛列表", rows.length ? rows : [{ label: "暂无公开挑战", icon: "1.49", disabled: true }]);
    bindCurrentMenuClicks(confirmMadBragMenu);
  } catch {
    setMenuAsSingleList("最新吹牛列表", [{ label: "读取失败", icon: "1.49", disabled: true }]);
  }
}

function openMadBragDetail() {
  const item = state.madBragList?.[state.menuItem];
  if (!item || item.mine) return;
  state.madBragSelected = item;
  state.menuMode = "mad_brag_detail";
  state.menuItem = 0;
  setMenuAsSingleList(item.question, [
    { label: `选项一：${item.optionA}`, icon: "1.49" },
    { label: `选项二：${item.optionB}`, icon: "1.49" },
    { label: `下注：${madBragStakeText(item.stake)}`, icon: item.stake?.icon || "1.49", disabled: true }
  ]);
  bindCurrentMenuClicks(confirmMadBragMenu);
}

async function answerMadBragChoice() {
  const item = state.madBragSelected;
  if (!item || state.menuItem > 1) return;
  try {
    const result = await postApi("/api/mad-brag/answer", {
      account: state.account,
      challengeId: item.id,
      choice: state.menuItem === 0 ? "A" : "B"
    });
    if (result.player) {
      state.silver = result.player.silver ?? state.silver;
      state.immortalPill = result.player.immortalPill ?? state.immortalPill;
    }
    await refreshBag().catch(() => null);
    showMenuHint(result.won ? "抢话成功，奖励已到账" : "抢话失败，下注已扣除");
    openMadBragList();
  } catch (error) {
    showMenuHint(error.message === "not_enough_stake" ? "下注不足，无法应战" : error.message === "cannot_answer_self" ? "不能应战自己的大话" : "应战失败");
    openMadBragList();
  }
}

async function openMadBragMine() {
  state.menuMode = "mad_brag_mine";
  state.menuItem = 0;
  try {
    const result = await apiGet("/api/mad-brag/mine");
    const rows = (result.challenges || []).map((item) => ({
      label: `${item.status === "open" ? "[进行中]" : "[已结算]"} ${madBragChallengeText(item)}`,
      icon: item.stake?.icon || "1.49"
    }));
    setMenuAsSingleList("我的大话", rows.length ? rows : [{ label: "暂无记录", icon: "1.49", disabled: true }]);
    bindCurrentMenuClicks(() => {});
  } catch {
    setMenuAsSingleList("我的大话", [{ label: "读取失败", icon: "1.49", disabled: true }]);
  }
}

async function openMadBragResponses() {
  state.menuMode = "mad_brag_responses";
  state.menuItem = 0;
  try {
    const result = await apiGet("/api/mad-brag/responses");
    const rows = (result.challenges || []).map((item) => ({
      label: `${item.winnerAccount === state.account ? "[赢]" : "[输]"} ${madBragChallengeText(item)}`,
      icon: item.stake?.icon || "1.49"
    }));
    setMenuAsSingleList("我的抢话", rows.length ? rows : [{ label: "暂无记录", icon: "1.49", disabled: true }]);
    bindCurrentMenuClicks(() => {});
  } catch {
    setMenuAsSingleList("我的抢话", [{ label: "读取失败", icon: "1.49", disabled: true }]);
  }
}

function openMadBragRankingRoot() {
  state.menuMode = "mad_brag_ranking_root";
  state.menuItem = 0;
  setMenuAsSingleList("吹牛榜排行榜", [
    { label: "盈利排行榜", icon: "1.49" },
    { label: "亏损排行榜", icon: "1.49" }
  ]);
  bindCurrentMenuClicks(confirmMadBragMenu);
}

async function openMadBragRankingList() {
  const mode = state.menuItem === 0 ? "profit" : "loss";
  state.madBragRankingMode = mode;
  state.menuMode = "mad_brag_ranking_list";
  state.menuItem = 0;
  try {
    const result = await apiGet("/api/mad-brag/rankings");
    const rows = (result[mode] || []).map((item, index) => ({
      label: `${index + 1}. ${item.name} ${item.profit}价值（胜${item.wins}/负${item.losses}）`,
      icon: "1.49"
    }));
    setMenuAsSingleList(mode === "profit" ? "盈利排行榜" : "亏损排行榜", rows.length ? rows : [{ label: "暂无排行", icon: "1.49", disabled: true }]);
    bindCurrentMenuClicks(() => {});
  } catch {
    setMenuAsSingleList("吹牛榜排行榜", [{ label: "读取失败", icon: "1.49", disabled: true }]);
  }
}

window.openMadBragMenu = openMadBragMenu;
window.confirmMadBragMenu = confirmMadBragMenu;
window.backMadBragMenu = backMadBragMenu;
