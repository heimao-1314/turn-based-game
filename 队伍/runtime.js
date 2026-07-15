/**
 * @file runtime.js
 * @description 队伍运行时管理 - 处理多人组队的客户端逻辑
 *
 * 本模块管理组队系统的客户端运行时，包括：
 * - 队伍成员的规范化与去重
 * - 在线队友的检测与状态同步
 * - 组队战斗的服务器房间消息发送
 * - 战斗归属判定（判断战斗单位属于哪个玩家）
 * - 队伍人数对战斗规模的影响计算
 *
 * 联网战斗已经统一由服务器仲裁，本模块不再执行 P2P 战斗同步。
 *
 * @module TeamRuntime
 */
(function (global) {
  function createRuntime(deps) {
    function myName() {
      return deps.getPlayerName();
    }

    function myAccount() {
      return deps.getAccount?.() || "";
    }

    /**
     * 获取去重后的队伍成员列表
     * 过滤掉自己和重复的成员名，确保队伍成员列表的唯一性。
     *
     * @returns {Array} 去重后的队伍成员数组
     */
    function normalizedTeamMembers() {
      const state = deps.getState();
      const seen = new Set();
      return (state.team?.members || []).filter((member) => {
        const name = member?.name || "";
        if (!name || name === myName() || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    }

    function activeTeamRoster() {
      const state = deps.getState();
      const self = { peerId: state.peerId, account: myAccount(), name: myName() };
      return [self, ...normalizedTeamMembers().map((member) => ({
        peerId: deps.resolvePeerId(member.peerId) || member.peerId || "",
        account: member.account || "",
        name: member.name || ""
      }))].filter((member) => member.peerId || member.name);
    }

    function rosterHasMe(roster = []) {
      const state = deps.getState();
      const account = myAccount();
      const name = myName();
      return (roster || []).some((member) => (
        member?.peerId === state.peerId
        || (account && member?.account === account)
        || (name && member?.name === name)
      ));
    }

    function leaderNameFromPeers() {
      const state = deps.getState();
      return deps.peerById(state.followLeaderId)?.name || "";
    }

    function onlineTeamMembers() {
      const state = deps.getState();
      if (state.followLeaderId) return [];
      return normalizedTeamMembers()
        .map((member) => ({ member, peer: deps.peerById(member.peerId) }))
        .filter((item) => item.peer && (item.peer.mapName || state.mapName) === state.mapName);
    }

    function teamSizeForBattle() {
      return Math.max(1, Math.min(4, 1 + onlineTeamMembers().length));
    }

    /**
     * 根据队伍人数计算野怪数量
     * 队伍人数越多，遇到的野怪数量也越多，提供组队战斗的挑战性。
     *
     * @param {number} size - 队伍人数 (1-4)
     * @returns {number} 野怪数量
     */
    function wildMonsterCountForTeam(size) {
      if (size >= 4) return 14;
      if (size >= 3) return 10;
      if (size === 2) return 4;
      return 1;
    }

    function teamRecipients(roster = null) {
      const state = deps.getState();
      const source = roster || state.battle?.teamRoster || activeTeamRoster();
      return source.filter((member) => member.peerId !== state.peerId && member.name !== myName());
    }

    function sendTeamBattleMessage(type, battleId, payload = {}) {
      const state = deps.getState();
      const roster = payload.roster || state.battle?.teamRoster || activeTeamRoster();
      for (const member of teamRecipients(roster)) {
        const to = deps.resolvePeerId(member.peerId) || deps.findPeerIdByName(member.name) || "";
        if (!to && !member.name) continue;
        deps.sendRoomMessage({ type, battleId, to, toName: member.name, leaderId: state.peerId, leaderName: myName(), roster, ...payload });
      }
    }

    function sendTeamBattleMessageReliable(type, battleId, payload = {}) {
      const state = deps.getState();
      if (!state.battle && type !== "teamBattleStart") return;
      sendTeamBattleMessage(type, battleId, payload);
    }

    function isTeamMessageForMe(msg) {
      const state = deps.getState();
      if (state.pendingBattleInvite?.battleId && state.pendingBattleInvite.battleId === msg.battleId) return true;
      if (state.pendingTeamPveBattleId && state.pendingTeamPveBattleId === msg.battleId) return true;
      if (msg.to === state.peerId || msg.toName === myName()) return true;
      if (msg.roster?.length) return rosterHasMe(msg.roster);
      return state.followLeaderId && msg.leaderId === state.followLeaderId;
    }

    function rosterMatchesBattle(msg) {
      const state = deps.getState();
      const roster = state.battle?.teamRoster || [];
      if (!roster.length) return true;
      const incoming = msg.roster || [];
      if (!incoming.length) return true;
      const ids = new Set(roster.map((member) => member.peerId || member.name).filter(Boolean));
      return incoming.some((member) => ids.has(member?.peerId || member?.name));
    }

    function isActiveTeamBattleMessage(msg) {
      const state = deps.getState();
      return isTeamMessageForMe(msg)
        && state.battle?.id === msg.battleId
        && ["team_member", "attacker", "defender", "team_attacker", "team_defender"].includes(state.battle?.role)
        && rosterMatchesBattle(msg);
    }

    function isOwnedBattleFighter(fighter, peerId = deps.getState().peerId) {
      if (!fighter?.actor) return false;
      if (fighter.actor.ownerPeerId) return fighter.actor.ownerPeerId === peerId;
      const state = deps.getState();
      if (peerId !== state.peerId) return false;
      if (fighter.actor === state.player || fighter.actor === state.pet) return true;
      if (fighter.actor.isMercenary && fighter.actor.mercenaryData) return true;
      return false;
    }

    function controlledBattleFighters(battle, peerId = deps.getState().peerId) {
      if (!battle) return [];
      const friendlyTeam = battle.role === "defender" || battle.role === "team_defender" ? battle.enemyTeam : battle.playerTeam;
      return friendlyTeam.filter((fighter) => !fighter.defeated && isOwnedBattleFighter(fighter, peerId));
    }

    function controlledFighterSteps(battle, peerId = deps.getState().peerId) {
      return controlledBattleFighters(battle, peerId).map((fighter) => deps.fighterRef(fighter));
    }

    return {
      normalizedTeamMembers,
      activeTeamRoster,
      rosterHasMe,
      leaderNameFromPeers,
      onlineTeamMembers,
      teamSizeForBattle,
      wildMonsterCountForTeam,
      sendTeamBattleMessage,
      sendTeamBattleMessageReliable,
      isTeamMessageForMe,
      isActiveTeamBattleMessage,
      isOwnedBattleFighter,
      controlledBattleFighters,
      controlledFighterSteps
    };
  }

  global.TeamRuntime = {
    createRuntime
  };
})(window);
