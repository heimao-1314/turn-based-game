/**
 * 全服竞技场客户端模块。
 * app.js 只保留通用菜单/战斗循环，本文件负责竞技场菜单、上传、开战和服务器回合提交。
 */
async function openArenaMenu() {
  state.menuMode = "arena";
  state.menuItem = 0;
  try {
    const result = await apiGet(`/api/arena/rankings?account=${encodeURIComponent(state.account)}`);
    const rankings = result.rankings || [];
    const serverMyRank = Number(result.myRank) || 0;
    const myRank = serverMyRank || Number(state.menuArenaMyRank) || 0;
    state.menuArenaMyRank = myRank;
    state.menuArenaAllRankings = rankings;
    state.menuArenaRankings = serverMyRank && Array.isArray(result.challengeRankings) && result.challengeRankings.length
      ? result.challengeRankings
      : rankings.filter((entry) => myRank
      ? entry.rank >= Math.max(1, myRank - 10) && entry.rank < myRank
      : entry.rank >= 91 && entry.rank <= 100);
    const title = myRank ? `全服竞技场 当前第${myRank}名` : "全服竞技场 未上榜";
    setMenuAsSingleList(title, [
      { label: "上传数据", icon: "1.41" },
      { label: "查看名次", icon: "2.10" },
      { label: "领取奖励", icon: "1.49" },
      { label: "发起挑战", icon: "1.39" }
    ]);
    bindCurrentMenuClicks(confirmArenaMenu);
  } catch {
    setMenuAsSingleList("全服竞技场", [{ label: "排行榜读取失败", icon: "1.49", disabled: true }]);
  }
}

async function confirmArenaMenu() {
  if (state.menuItem === 0) {
    await uploadArenaData();
    return;
  }
  if (state.menuItem === 1) {
    openArenaRankingListMenu();
    return;
  }
  if (state.menuItem === 2) {
    claimArenaReward();
    return;
  }
  if (state.menuItem === 3) openArenaChallengeMenu();
}

function arenaRankLabel(entry) {
  return `第${entry.rank}名 ${entry.name}${entry.isNpc ? " / 占位" : ""}`;
}

function openArenaRankingListMenu() {
  state.menuMode = "arena_rankings";
  state.menuItem = 0;
  const rows = (state.menuArenaAllRankings || []).map((entry) => ({
    label: arenaRankLabel(entry),
    icon: entry.account === state.account ? "1.49" : entry.isNpc ? "2.10" : "1.49"
  }));
  setMenuAsSingleList("全服竞技场名次", rows.length ? rows : [{ label: "暂无名次", icon: "1.49", disabled: true }]);
  bindCurrentMenuClicks(openArenaMenu);
}

function claimArenaReward() {
  postApi("/api/arena/claim-reward", { account: state.account }).then((result) => {
    state.soulPowder = result.player?.soulPowder || state.soulPowder;
    state.immortalPill = result.player?.immortalPill || state.immortalPill;
    state.pendingBattleReward = {
      notice: `竞技场第${result.rank}名奖励：灵魂粉末 +${result.soulPowder}，仙丹 +${result.immortalPill}`
    };
    showBattleRewardPanel();
  }).catch((error) => {
    showMenuHint(error.message === "already_claimed"
      ? "今日竞技场奖励已领取"
      : error.message === "before_settlement"
        ? "中午12点后才能领取"
      : error.message === "not_qualified"
        ? "当前名次暂无奖励"
        : "竞技场奖励领取失败");
  });
}

function openArenaChallengeMenu() {
  state.menuMode = "arena_challenge";
  state.menuItem = 0;
  const items = (state.menuArenaRankings || []).map((entry) => ({
    label: arenaRankLabel(entry),
    icon: entry.isNpc ? "2.10" : "1.49"
  }));
  setMenuAsSingleList("选择挑战目标", items.length ? items : [{ label: "当前没有可挑战名次", icon: "1.49", disabled: true }]);
  bindCurrentMenuClicks(confirmArenaChallengeMenu);
}

async function confirmArenaChallengeMenu() {
  const entry = state.menuArenaRankings?.[state.menuItem];
  if (!entry?.mirror) return;
  closeMainMenu();
  await startArenaBattle(entry);
}

function arenaActorFromMirror(data, isPet = false, isMercenary = false) {
  const actor = createActor({
    name: String(data?.name || (isMercenary ? "镜像佣兵" : isPet ? "镜像宠物" : "镜像玩家")),
    spriteId: Number(data?.spriteId) || (isMercenary ? 869 : isPet ? 486 : 895),
    x: state.player?.x || 0,
    y: state.player?.y || 0
  });
  actor.isPet = isPet;
  actor.isMercenary = isMercenary;
  if (isMercenary) {
    actor.mercenaryData = {
      id: String(data?.id || ""),
      type: String(data?.type || ""),
      passiveSkills: Array.isArray(data?.passiveSkills) ? data.passiveSkills : [],
      extraSkills: Array.isArray(data?.extraSkills) ? data.extraSkills : []
    };
  }
  actor.arenaStats = mergeStats({}, {
    ...(data?.stats || {}),
    skillId: data?.stats?.skillId || (isMercenary ? "merc_sword_deathblow" : isPet ? "pet_default" : "wild_amumu")
  }, false);
  return actor;
}

function currentArenaMirror() {
  const mercenary = activeMercenary();
  return {
    actor: {
      name: state.player?.name || state.account,
      spriteId: state.player?.spriteId || findRole().id,
      stats: statsForRole()
    },
    pet: state.pet ? {
      name: state.pet.name,
      spriteId: state.pet.spriteId,
      stats: statsForPet(state.pet.spriteId)
    } : null,
    mercenary: mercenary ? {
      id: mercenary.id,
      type: mercenary.type,
      name: mercenary.name,
      spriteId: mercenary.spriteId,
      passiveSkills: mercenary.passiveSkills || [],
      extraSkills: mercenary.extraSkills || [],
      stats: statsForMercenary(mercenary)
    } : null
  };
}

async function uploadArenaData() {
  try {
    await savePlayerPosition(true);
    const result = await postApi("/api/arena/upload", { account: state.account, mirror: currentArenaMirror() });
    showMenuHint(`竞技场数据已上传：第${result.rank}名`);
    await openArenaMenu();
  } catch {
    showMenuHint("竞技场数据上传失败");
  }
}

async function occupyArenaRank(rank, mirror) {
  try {
    const result = await postApi("/api/arena/occupy", { account: state.account, rank, mirror });
    const swapText = result.oldRank ? `，原第${rank}名替换到你的原第${result.oldRank}名` : "";
    state.pendingBattleReward = { notice: `竞技场占领成功：第${rank}名${swapText}` };
  } catch (error) {
    state.pendingBattleReward = { error: error.message === "rank_not_allowed" ? "只能挑战最近的十名" : "竞技场占领失败" };
  }
}

async function startArenaBattle(entry) {
  if (!state.player || state.battle) return;
  closeBattleRewardPanel();
  await refreshServerStats();
  let serverBattle;
  try {
    serverBattle = await postApi("/api/arena/start", { account: state.account, rank: entry.rank, mirror: currentArenaMirror() });
  } catch (error) {
    showMenuHint(error.message === "rank_not_allowed" ? "只能挑战最近的十名" : "竞技场战斗创建失败");
    return;
  }

  const attackerMirror = serverBattle.attacker || currentArenaMirror();
  const defenderMirror = serverBattle.defender?.mirror || entry.mirror;
  const enemies = [
    arenaActorFromMirror(defenderMirror.actor, false),
    defenderMirror.pet ? arenaActorFromMirror(defenderMirror.pet, true) : null,
    defenderMirror.mercenary ? arenaActorFromMirror(defenderMirror.mercenary, false, true) : null
  ].filter(Boolean);
  const allyRole = arenaActorFromMirror(attackerMirror.actor, false);
  allyRole.arenaSelf = true;
  const allies = [
    allyRole,
    attackerMirror.pet ? arenaActorFromMirror(attackerMirror.pet, true) : null,
    attackerMirror.mercenary ? arenaActorFromMirror(attackerMirror.mercenary, false, true) : null
  ].filter(Boolean);

  await Promise.all([
    loadSprite(23),
    loadImage("资源/图片/战斗数字.png"),
    loadImage("资源/图片/战斗箭头.png"),
    ...battleEffectIdsFor(...allies, ...enemies).map((id) => loadSpriteOptional(id)),
    ...battleSpriteLoadPromisesFor(...allies, ...enemies)
  ]);
  await hydrateImageCache();
  const transition = $("#battleTransition");
  transition.className = `battle-transition active ${Math.random() > 0.5 ? "vertical" : ""}`;
  setTimeout(() => {
    transition.classList.remove("active", "vertical");
    state.battle = {
      id: serverBattle.battleId,
      role: "attacker",
      opponentPeerId: "",
      arenaServer: true,
      playerTeam: allies.map((actor, index) => makeFighter(actor, "ally", index)),
      enemyTeam: enemies.map((actor, index) => makeFighter(actor, "enemy", index)),
      waiting: true,
      ending: false,
      choices: {},
      choiceStep: "actor",
      selectedTarget: "",
      pendingAction: null,
      targeting: false,
      selectedCommand: "attack",
      rewardClaimed: false,
      wildMonsterId: "",
      arenaRank: serverBattle.rank || entry.rank,
      arenaMirror: attackerMirror,
      commandFocus: 0,
      menuMode: "command",
      submenuIndex: 0,
      autoBattle: state.autoBattlePersistent,
      autoStepQueued: false,
      openingSpeechDone: true,
      commandHint: "",
      choiceDeadline: performance.now() + BATTLE_CHOICE_MS,
      lastChoiceSecond: BATTLE_CHOICE_SECONDS,
      turnIndex: 1,
      statusLog: [],
      lastSkillNames: {},
      floatNumbers: [],
      floatTexts: [],
      effects: [],
      lastEffectTime: performance.now()
    };
    $("#battleOverlay").classList.add("active");
    renderBattle();
    if (state.battle.autoBattle) queueAutoBattleStep(120);
  }, 640);
}

async function resolveArenaServerTurn(battle) {
  if (!battle || battle.arenaResolving) return;
  if (!battle.choices[state.peerId]) return;
  battle.arenaResolving = true;
  try {
    const payload = await postApi("/api/arena/turn", { account: state.account, battleId: battle.id, choice: battle.choices[state.peerId] });
    if (payload?.result) {
      payload.result.arena = {
        won: payload.won === true,
        rank: payload.rank || battle.arenaRank,
        oldRank: payload.oldRank || 0,
        swapped: payload.swapped === true
      };
      battle.choices = {};
      await playBattleTurn(payload.result);
    }
  } catch (error) {
    battle.waiting = true;
    battle.commandHint = error.message === "battle_not_found" ? "竞技场战斗已失效" : "服务器裁决失败，请重试";
    renderBattle();
  } finally {
    if (state.battle === battle) battle.arenaResolving = false;
  }
}
