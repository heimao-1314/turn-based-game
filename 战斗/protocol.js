/**
 * @file protocol.js
 * @description 战斗协议模块 - 处理战斗参与者(actor)的序列化与反序列化
 *
 * 本模块负责战斗数据的网络传输格式转换，包括：
 * - 战斗参与者快照的创建与恢复（用于服务器战斗同步）
 * - 地图角色快照的创建与恢复（用于状态广播）
 * - 战斗状态载荷的构建（用于初始化战斗界面）
 *
 * 设计模式: 工厂模式 (createRuntime)，通过依赖注入实现模块解耦
 *
 * @module BattleProtocol
 */
(function (global) {
  function createRuntime(deps) {
    /**
     * 创建战斗参与者的序列化快照
     * 用于服务器战斗同步时传输角色状态。
     *
     * @param {Object} actor - 角色对象
     * @returns {Object} 包含名称、精灵图ID、坐标、方向、归属等信息的快照对象
     */
    function battleActorSnapshot(actor) {
      return {
        name: actor.name,
        spriteId: actor.spriteId,
        x: actor.x,
        y: actor.y,
        direction: actor.direction || "down",
        ownerPeerId: actor.ownerPeerId || "",
        ownerName: actor.ownerName || "",
        isPet: actor.isPet === true,
        isMercenary: actor.isMercenary === true,
        mercenaryData: actor.mercenaryData || null,
        wildMonsterId: actor.wildMonsterId || "",
        immortalBossId: actor.immortalBossId || "",
        elfKingVaultBossId: actor.elfKingVaultBossId || "",
        elfKingVaultStageId: actor.elfKingVaultStageId || "",
        battleStats: deps.statsForActor(actor),
        forceBasicAttack: actor.forceBasicAttack === true
      };
    }

    /**
     * 从快照数据恢复战斗参与者对象
     * battleActorSnapshot 的逆操作，用于接收到远端数据后重建本地角色。
     *
     * @param {Object} data - 快照数据对象
     * @returns {Object} 恢复后的角色对象
     */
    function battleActorFromSnapshot(data) {
      const actor = deps.createActor({ name: data.name, spriteId: data.spriteId, x: data.x || 0, y: data.y || 0 });
      actor.direction = data.direction || "down";
      actor.ownerPeerId = data.ownerPeerId || "";
      actor.ownerName = data.ownerName || "";
      actor.isPet = data.isPet === true;
      actor.isMercenary = data.isMercenary === true;
      actor.wildMonsterId = data.wildMonsterId || "";
      actor.immortalBossId = data.immortalBossId || "";
      actor.elfKingVaultBossId = data.elfKingVaultBossId || "";
      actor.elfKingVaultStageId = data.elfKingVaultStageId || "";
      actor.battleStats = data.battleStats || null;
      actor.mercenaryData = data.mercenaryData || null;
      actor.forceBasicAttack = data.forceBasicAttack === true || data.battleStats?.forceBasicAttack === true;
      return actor;
    }

    function actorSnapshot(actor) {
      return {
        name: actor.name,
        spriteId: actor.spriteId,
        x: actor.x,
        y: actor.y,
        mapName: deps.getMapName(),
        direction: actor.direction,
        ownerPeerId: actor.ownerPeerId || "",
        ownerName: actor.ownerName || "",
        isPet: actor.isPet === true,
        isMercenary: actor.isMercenary === true,
        mercenaryData: actor.mercenaryData || null,
        battleStats: deps.statsForActor(actor),
        wildMonsterId: actor.wildMonsterId || "",
        elfKingVaultBossId: actor.elfKingVaultBossId || "",
        elfKingVaultStageId: actor.elfKingVaultStageId || ""
      };
    }

    function actorFromSnapshot(data) {
      const actor = deps.createActor({ name: data.name, spriteId: data.spriteId, x: data.x, y: data.y });
      actor.direction = data.direction || "down";
      actor.mapName = data.mapName || "仓库";
      actor.isPet = data.isPet === true;
      actor.isMercenary = data.isMercenary === true;
      actor.mercenaryData = data.mercenaryData || null;
      actor.battleStats = data.battleStats || null;
      actor.wildMonsterId = data.wildMonsterId || "";
      actor.elfKingVaultBossId = data.elfKingVaultBossId || "";
      actor.elfKingVaultStageId = data.elfKingVaultStageId || "";
      return actor;
    }

    /**
     * 构建战斗初始状态载荷
     * 创建完整的战斗状态对象，包含双方队伍、UI 状态、倒计时等所有初始化数据。
     *
     * @param {Object} params - 战斗参数
     * @param {string} params.battleId - 战斗唯一标识
     * @param {string} params.role - 战斗角色 ("attacker" | "defender")
     * @param {string} [params.opponentPeerId] - 对手的联网节点 ID
     * @param {Array} params.playerTeam - 己方队伍成员列表
     * @param {Array} params.enemyTeam - 敌方队伍成员列表
     * @param {string} [params.wildMonsterId] - 野生怪物 ID
     * @param {string} [params.immortalBossId] - 仙人 Boss ID
     * @returns {Object} 完整的战斗状态对象
     */
    function battleStatePayload({
      battleId,
      role,
      opponentPeerId = "",
      playerTeam,
      enemyTeam,
      wildMonsterId = "",
      immortalBossId = "",
      monsterCount = 1,
      teamRoster = []
    }) {
      return {
        id: battleId,
        role,
        opponentPeerId,
        playerTeam: playerTeam.map((actor, index) => deps.makeFighter(actor, "ally", index)),
        enemyTeam: enemyTeam.map((actor, index) => deps.makeFighter(actor, "enemy", index)),
        waiting: true,
        ending: false,
        choices: {},
        choiceStep: "actor",
        selectedTarget: "",
        pendingAction: null,
        targeting: false,
        selectedCommand: "attack",
        rewardClaimed: false,
        wildMonsterId,
        immortalBossId,
        monsterCount,
        teamRoster,
        commandFocus: 0,
        menuMode: "command",
        submenuIndex: 0,
        autoBattle: deps.getAutoBattlePersistent(),
        autoStepQueued: false,
        openingSpeechDone: false,
        commandHint: "",
        choiceDeadline: performance.now() + deps.getBattleChoiceMs(),
        lastChoiceSecond: deps.getBattleChoiceSeconds(),
        turnIndex: 1,
        statusLog: [],
        lastSkillNames: {},
        floatNumbers: [],
        floatTexts: [],
        effects: [],
        lastEffectTime: performance.now()
      };
    }

    return {
      battleActorSnapshot,
      battleActorFromSnapshot,
      actorSnapshot,
      actorFromSnapshot,
      battleStatePayload
    };
  }

  global.BattleProtocol = {
    createRuntime
  };
})(window);
