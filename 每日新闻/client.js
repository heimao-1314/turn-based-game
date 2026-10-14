(function () {
  function rows(items) {
    return items.length ? items : [{ label: "暂无可兑换物品", icon: "1.49", disabled: true }];
  }

  async function openDiziNpcMenu() {
    state.menuMode = "dizi_npc";
    state.menuItem = 0;
    let status = null;
    try { status = await apiGet("/api/daily-news/status"); } catch {}
    setMenuAsSingleList("笛子", [
      { label: "疯狂吹牛", icon: "1.39" },
      { label: status?.hasReadToday ? "每日新闻（今日已阅读）" : "每日新闻（可得1阅读点）", icon: "1.49" },
      { label: `阅读兑换（${status?.readingPoints || 0}点）`, icon: "1.11" }
    ]);
    bindCurrentMenuClicks(confirmDiziNpcMenu);
  }

  async function openDailyNews() {
    state.menuMode = "daily_news";
    state.menuItem = 0;
    try {
      const result = await postApi("/api/daily-news/read", {});
      const label = result.gainedPoints ? "阅读完成，获得 1 点阅读点数" : "今日已阅读，明天再来";
      setMenuAsSingleList("每日新闻", [
        { label, icon: "1.49", disabled: true },
        ...String(result.text || "").split(/\r?\n/).filter(Boolean).map((line) => ({ label: line.slice(0, 96), icon: "1.49", disabled: true }))
      ]);
      bindCurrentMenuClicks(() => {});
    } catch (error) {
      showMenuHint(error.message === "daily_news_unavailable" ? "新闻暂时不可用" : "新闻读取失败");
      openDiziNpcMenu();
    }
  }

  async function openReadingExchange() {
    state.menuMode = "reading_exchange";
    state.menuItem = 0;
    try {
      const result = await apiGet("/api/reading-exchange/catalog");
      state.readingExchangeItems = result.items || [];
      setMenuAsSingleList(`阅读兑换（${result.readingPoints || 0}点）`, rows(state.readingExchangeItems.map((item) => ({
        label: `${item.name}（${item.cost}点）`, icon: item.icon || "1.49"
      }))));
      bindCurrentMenuClicks(confirmDiziNpcMenu);
    } catch {
      showMenuHint("兑换列表读取失败");
      openDiziNpcMenu();
    }
  }

  async function confirmDiziNpcMenu() {
    if (state.menuMode === "dizi_npc") {
      if (state.menuItem === 0) return openMadBragMenu();
      if (state.menuItem === 1) return openDailyNews();
      if (state.menuItem === 2) return openReadingExchange();
    }
    if (state.menuMode === "reading_exchange") {
      const item = state.readingExchangeItems?.[state.menuItem];
      if (!item) return;
      try {
        const result = await postApi("/api/reading-exchange/redeem", { itemId: item.id });
        await refreshBag().catch(() => null);
        showMenuHint(`兑换成功：${result.item.name} x${result.item.quantity}`);
        openReadingExchange();
      } catch (error) {
        showMenuHint(error.message === "not_enough_reading_points" ? "阅读点数不足" : "兑换失败");
      }
    }
  }

  function backDiziNpcMenu() {
    if (state.menuMode === "dizi_npc") return closeMainMenu();
    return openDiziNpcMenu();
  }

  window.openDiziNpcMenu = openDiziNpcMenu;
  window.confirmDiziNpcMenu = confirmDiziNpcMenu;
  window.backDiziNpcMenu = backDiziNpcMenu;
})();
