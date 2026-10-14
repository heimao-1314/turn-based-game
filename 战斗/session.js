/**
 * @file session.js
 * @description 战斗会话管理 - 处理战斗的发起、进入、回合交互和结束
 *
 * 本模块管理战斗的完整生命周期：
 * - 战斗邀请的发送、接收、拒绝和超时处理
 * - 战斗转场动画与状态初始化
 * - 回合制战斗的指令接收与回合结算触发
 * - 特殊战斗开场事件（如 Boss 台词）
 *
 * @module BattleSession
 */
(function (global) {
  function createRuntime(deps) {
    /**
     * 获取战斗拒绝原因的用户友好文本
     *
     * @param {string} reason - 拒绝原因代码
     * @returns {string} 对应的中文提示文本
     */
    function battleRejectText(reason) {
      return ({
        busy: "对方正在战斗，强杀取消",
        stall: "对方摆摊中，强杀取消",
        version_mismatch: "双方版本不一致，请刷新后再强杀",
        asset_failed: "对方资源未准备好，强杀取消",
        timeout: "对方无响应，强杀取消",
        invalid: "对方状态异常，强杀取消"
      })[reason] || "对方无法进入战斗，强杀取消";
    }

    function clearPendingBattleInvite(battleId = "") {
      const state = deps.getState();
      const pending = state.pendingBattleInvite;
      if (!pending || (battleId && pending.battleId !== battleId)) return null;
      deps.clearTimeout(pending.timeoutId);
      state.pendingBattleInvite = null;
      return pending;
    }

    function rejectBattleInvite(msg, reason) {
      deps.sendRoomMessage({
        type: "battleRejected",
        battleId: msg.battleId,
        attackerId: msg.attackerId,
        defenderId: deps.getPeerId(),
        reason
      });
      deps.removeRemoteBattleMarker(msg.battleId);
      deps.sendRoomMessage({ type: "battleMarkerEnd", battleId: msg.battleId });
    }

    /**
     * 战斗转场后进入战斗
     * 播放随机方向的转场动画（横向/纵向百叶窗），640ms 后显示战斗界面。
     * 如果战斗已被取消（canceledBattleIds），则中止进入并恢复角色。
     *
     * @param {Object} battleData - 战斗状态数据
     */
    function enterBattleAfterTransition(battleData) {
      const state = deps.getState();
      const transition = deps.select("#battleTransition");
      transition.className = `battle-transition active ${Math.random() > 0.5 ? "vertical" : ""}`;
      (deps.setTimeout || setTimeout)(() => {
        if (state.canceledBattleIds.has(battleData.id)) {
          state.canceledBattleIds.delete(battleData.id);
          deps.restoreBattleActors();
          transition.classList.remove("active", "vertical");
          return;
        }
        transition.classList.remove("active", "vertical");
        state.battle = battleData;
        deps.select("#battleOverlay").classList.add("active");
        deps.renderBattle();
        if (state.battle.autoBattle) deps.queueAutoBattleStep(120);
        deps.broadcastState(true);
      }, 640);
    }

    function receiveBattleChoice(peerId, choice) {
      const battle = deps.getBattle();
      if (!battle || battle.ending) return;
      battle.choices[peerId] = choice;
      tryResolveBattleTurn();
      deps.renderBattle();
    }

    function battleOpeningEvents() {
      const battle = deps.getBattle();
      if (!battle || battle.openingSpeechDone) return [];
      battle.openingSpeechDone = true;
      if (battle.wildMonsterId === "afei") {
        const speakers = battle.enemyTeam.length ? battle.enemyTeam : [];
        const speaker = deps.sample(speakers);
        return speaker ? [deps.battleSpeechEvent(speaker, "我就不信我会坐牢，我家有钱[e0]", 3200)] : [];
      }
      if (battle.wildMonsterId === "amumu") {
        const speaker = deps.sample(battle.enemyTeam || []);
        return speaker ? [deps.battleSpeechEvent(speaker, deps.sample(deps.amumuBattleLines), 2800)] : [];
      }
      return [];
    }

    /**
     * 尝试结算当前战斗回合
     * 检查攻击方和防御方是否都已提交行动选择，如果双方就绪则触发回合结算。
     * 本地战斗只在当前客户端结算；联网战斗由服务器权威模块结算。
     */
    function tryResolveBattleTurn() {
      const battle = deps.getBattle();
      if (!battle || battle.role !== "attacker") return;
      const peerId = deps.getPeerId();
      const enemyKey = battle.opponentPeerId || "npc";
      if (!battle.choices[peerId] || !battle.choices[enemyKey]) return;
      const result = deps.resolveBattleTurn(battle.choices[peerId], battle.choices[enemyKey]);
      const openingEvents = battleOpeningEvents();
      if (openingEvents.length) result.events = [...openingEvents, ...result.events];
      battle.choices = {};
      deps.playBattleTurn(result);
    }

    return {
      battleRejectText,
      clearPendingBattleInvite,
      rejectBattleInvite,
      enterBattleAfterTransition,
      receiveBattleChoice,
      battleOpeningEvents,
      tryResolveBattleTurn
    };
  }

  global.BattleSession = {
    createRuntime
  };
})(window);
