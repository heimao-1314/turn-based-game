/**
 * @file runtime.js
 * @description 中心化联网战斗运行时。
 *
 * 这个 Module 统一接管单人 PVP、队伍 PVP、队伍 PVE。客户端只连接中心服务器
 * WebSocket，不依赖两个手机之间互相可达；家庭宽带 IPv6 公网、移动数据、NAT
 * 都只影响客户端到中心服务器的一条长连接。
 *
 * 依赖模块:
 * - BattleSkills: 技能目录与技能查询
 * - BattleEngine: 战斗引擎核心计算
 *
 * @module OnlineBattleRuntime
 * @requires ../战斗/skills.js
 * @requires ../战斗/engine.js
 */
const BattleSkills = require("../战斗/skills.js");
const BattleEngine = require("../战斗/engine.js");

function createRuntime(deps) {
  const activeBattles = new Map();
  const pendingStarts = new Map();

  function realmFromMeta(meta = {}) {
    return {
      serverId: String(meta.serverId || ""),
      channelId: Math.floor(Number(meta.channelId) || 0)
    };
  }

  function battleKey(realm = {}, battleId = "") {
    return `${realm.serverId || "default"}:${realm.channelId || 0}:${battleId}`;
  }

  function expandDirection(direction) {
    return ({ u: "up", d: "down", l: "left", r: "right" })[direction] || direction || "down";
  }

  function parseNetworkActor(packet, flags = {}) {
    if (!Array.isArray(packet) || packet.length < 6) return null;
    return {
      name: String(packet[0] || "").slice(0, 24),
      spriteId: Number(packet[1]) || 0,
      x: Number(packet[2]) || 0,
      y: Number(packet[3]) || 0,
      direction: expandDirection(packet[4]),
      moving: Boolean(packet[5]),
      stats: flags.isMercenary
        ? (packet[7] && typeof packet[7] === "object" ? packet[7] : null)
        : (packet[6] && typeof packet[6] === "object" ? packet[6] : null),
      mercenaryData: flags.isMercenary && packet[6] && typeof packet[6] === "object" ? packet[6] : null,
      isPet: flags.isPet === true,
      isMercenary: flags.isMercenary === true
    };
  }

  function buildClientMirrorFromState(data) {
    return {
      actor: {
        name: String(data.name || "").slice(0, 24),
        spriteId: Number(data.spriteId) || 0,
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        direction: expandDirection(data.direction),
        moving: Boolean(data.moving),
        stats: data.battleStats || null
      },
      pet: parseNetworkActor(data.pet, { isPet: true }),
      mercenary: parseNetworkActor(data.mercenary, { isMercenary: true })
    };
  }

  function normalizeBattleStatuses(statuses = {}) {
    const next = {};
    Object.entries(statuses || {}).forEach(([key, value]) => {
      if (!value) return;
      if (key === "bleed" || key === "curse") {
        next[key] = {
          turns: Number(value.turns) || 0,
          amount: Number(value.amount) || 0
        };
        return;
      }
      next[key] = typeof value === "number" ? value : Number(value) || 0;
    });
    return next;
  }

  function fighterRef(fighter) {
    return fighter?.battleId || fighter?.name || "";
  }

  function fighterKind(fighter) {
    if (fighter?.actor?.isPet) return "pet";
    if (fighter?.actor?.isMercenary) return "mercenary";
    return "role";
  }

  function alive(team) {
    return (team || []).filter((fighter) => !fighter.defeated && fighter.hp > 0);
  }

  function pickTarget(team, targetRef = "") {
    const candidates = alive(team);
    return (candidates.find((fighter) => fighter.battleId === targetRef) || candidates.find((fighter) => fighter.name === targetRef) || candidates[0] || null);
  }

  function findFighterByRef(team, ref = "") {
    return (team || []).find((fighter) => fighter.battleId === ref) || (team || []).find((fighter) => fighter.name === ref) || null;
  }

  function firstAliveRef(team) {
    return fighterRef(alive(team)[0]);
  }

  function skillsForStats(stats) {
    return [...new Set(["shining_strike", ...(stats?.skillIds || []), stats?.skillId].filter(Boolean))];
  }

  function activeSkillsForStats(stats) {
    return skillsForStats(stats).filter((id) => BattleSkills.skillCatalog[id] && BattleSkills.skillCatalog[id].type !== "passive");
  }

  function skillById(skillId) {
    return BattleSkills.skillCatalog[skillId] || BattleSkills.skillCatalog.shining_strike || BattleSkills.skillCatalog.pet_default;
  }

  function getEquippedItemInSlot(row, slot) {
    const equipped = deps.safeJsonObject(row?.equipped_json);
    const equipment = deps.safeJsonArray(row?.equipment_json);
    const id = equipped?.[slot];
    return Array.isArray(equipment) ? equipment.find((item) => item?.id === id) || null : null;
  }

  function teamForFighter(fighter, battleState) {
    if (!fighter || !battleState) return [];
    return [battleState.playerTeam || [], battleState.enemyTeam || []].find((team) => team.includes(fighter)) || [];
  }

  function sacrificeAlliesReadyForFighter(skill, fighter, battleState) {
    if (!Array.isArray(skill?.sacrificeAllies) || !skill.sacrificeAllies.length) return true;
    const team = teamForFighter(fighter, battleState);
    if (!team.length) return false;
    return skill.sacrificeAllies.every((kind) => team.some((unit) => unit !== fighter && fighterKind(unit) === kind && !unit.defeated));
  }

  function roleSkillUsableForFighter(skillId, fighter, battleState) {
    const skill = skillById(skillId);
    if (!skill.requiredClass) return true;
    const actor = fighter?.actor || {};
    const row = actor.playerRow || null;
    const selection = actor.selection || {};
    if (!row || selection.className !== skill.requiredClass) return false;
    if (!sacrificeAlliesReadyForFighter(skill, fighter, battleState)) return false;
    return getEquippedItemInSlot(row, "weapon")?.type === skill.requiredWeapon
      && getEquippedItemInSlot(row, "demonWeapon")?.type === skill.requiredDemonWeapon;
  }

  function activeBattleSkillsForFighter(fighter, battleState) {
    return activeSkillsForStats(fighter?.stats || {}).filter((skillId) => roleSkillUsableForFighter(skillId, fighter, battleState));
  }

  function defaultSkillIdForStats(stats) {
    const active = activeSkillsForStats(stats);
    return active.includes(stats?.skillId) ? stats.skillId : active[0] || "shining_strike";
  }

  function defaultBattleSkillIdForFighter(fighter, battleState) {
    const active = activeBattleSkillsForFighter(fighter, battleState);
    if (!active.length) return "";
    return active.includes(fighter?.stats?.skillId) ? fighter.stats.skillId : active[0] || defaultSkillIdForStats(fighter?.stats || {});
  }

  function sanitizeActionForFighter(fighter, action, targetTeam, battleState) {
    const target = action?.target || firstAliveRef(targetTeam);
    if (!fighter || !action || typeof action !== "object") return null;
    if (action.type !== "skill") return { type: "attack", target };
    const skillId = action.skillId || defaultBattleSkillIdForFighter(fighter, battleState);
    if (!skillId || !roleSkillUsableForFighter(skillId, fighter, battleState)) {
      return { type: "attack", target };
    }
    return { type: "skill", target, skillId };
  }

  function effectIdForActor(actor, useSkill) {
    if (actor?.isPet) return useSkill ? 1047 : 1044;
    if (actor?.isMercenary) return useSkill ? 1046 : 1044;
    const mapped = { "枪手": 1045, "法师": 1051, "剑士": 1044 };
    return useSkill ? (mapped[actor?.selection?.className] || 1044) : 1044;
  }

  function buildActorSnapshot(actor, ownerPeerId, ownerName, isPet = false, isMercenary = false) {
    return {
      name: String(actor?.name || "").slice(0, 24),
      spriteId: Number(actor?.spriteId) || 0,
      x: Number(actor?.x) || 0,
      y: Number(actor?.y) || 0,
      direction: actor?.direction || "down",
      ownerPeerId: ownerPeerId || "",
      ownerName: ownerName || "",
      isPet,
      isMercenary,
      mercenaryData: actor?.mercenaryData || null,
      battleStats: actor?.battleStats || actor?.stats || null,
      forceBasicAttack: actor?.stats?.forceBasicAttack === true || actor?.forceBasicAttack === true
    };
  }

  function publicBattleActor(actor) {
    if (!actor || typeof actor !== "object") return null;
    return {
      name: String(actor.name || "").slice(0, 24),
      spriteId: Number(actor.spriteId) || 0,
      x: Number(actor.x) || 0,
      y: Number(actor.y) || 0,
      direction: actor.direction || "down",
      ownerPeerId: actor.ownerPeerId || "",
      ownerName: actor.ownerName || "",
      isPet: actor.isPet === true,
      isMercenary: actor.isMercenary === true,
      mercenaryData: actor.mercenaryData || null,
      battleStats: actor.battleStats || null,
      forceBasicAttack: actor.forceBasicAttack === true || actor.battleStats?.forceBasicAttack === true,
      selection: actor.selection || null,
      wildMonsterId: actor.wildMonsterId || "",
      immortalBossId: actor.immortalBossId || "",
      elfKingVaultBossId: actor.elfKingVaultBossId || "",
      elfKingVaultStageId: actor.elfKingVaultStageId || ""
    };
  }

  function buildBattleParticipants(row, meta, ownerPeerId, ownerName) {
    const mirror = deps.arenaMirrorForPlayerRow(row, meta?.clientMirror || null);
    const selection = mirror.selection || deps.safeJsonObject(row.selection_json);
    const mercenary = deps.activeMercenaryForRow(row);
    return {
      actorSnapshot: buildActorSnapshot(mirror.actor, ownerPeerId, ownerName),
      petSnapshot: mirror.pet ? buildActorSnapshot(mirror.pet, ownerPeerId, ownerName, true) : null,
      mercenarySnapshot: mirror.mercenary ? buildActorSnapshot(mirror.mercenary, ownerPeerId, ownerName, false, true) : null,
      actorBattle: {
        name: String(mirror.actor?.name || "").slice(0, 24),
        spriteId: Number(mirror.actor?.spriteId) || 0,
        x: Number(mirror.actor?.x) || 0,
        y: Number(mirror.actor?.y) || 0,
        direction: mirror.actor?.direction || "down",
        ownerPeerId: ownerPeerId || "",
        ownerName: ownerName || "",
        isPet: false,
        isMercenary: false,
        battleStats: mirror.actor?.stats || null,
        forceBasicAttack: mirror.actor?.stats?.forceBasicAttack === true,
        selection,
        playerRow: row
      },
      petBattle: mirror.pet ? {
        name: String(mirror.pet?.name || "").slice(0, 24),
        spriteId: Number(mirror.pet?.spriteId) || 0,
        x: Number(mirror.pet?.x) || 0,
        y: Number(mirror.pet?.y) || 0,
        direction: mirror.pet?.direction || "down",
        ownerPeerId: ownerPeerId || "",
        ownerName: ownerName || "",
        isPet: true,
        isMercenary: false,
        battleStats: mirror.pet?.stats || null,
        forceBasicAttack: mirror.pet?.stats?.forceBasicAttack === true,
        selection
      } : null,
      mercenaryBattle: mirror.mercenary ? {
        name: String(mirror.mercenary?.name || "").slice(0, 24),
        spriteId: Number(mirror.mercenary?.spriteId) || 0,
        x: Number(mirror.mercenary?.x) || 0,
        y: Number(mirror.mercenary?.y) || 0,
        direction: mirror.mercenary?.direction || "down",
        ownerPeerId: ownerPeerId || "",
        ownerName: ownerName || "",
        isPet: false,
        isMercenary: true,
        mercenaryData: mercenary || null,
        battleStats: mirror.mercenary?.stats || null,
        forceBasicAttack: mirror.mercenary?.stats?.forceBasicAttack === true,
        selection
      } : null
    };
  }

  function normalizeRoster(peerIds, realm = null) {
    const seen = new Set();
    return peerIds
      .filter(Boolean)
      .filter((peerId) => {
        if (seen.has(peerId)) return false;
        seen.add(peerId);
        return true;
      })
      .map((peerId) => {
        const socket = deps.findSocketByPeerId(peerId, realm);
        const meta = socket ? deps.getSocketMeta(socket) : null;
        return { peerId, account: meta?.account || "", name: meta?.name || meta?.account || peerId };
      });
  }

  function resolvePeerId(peerId = "", hints = {}, realm = null) {
    const account = String(hints.account || "");
    if (account) {
      const socket = deps.findSocketByAccount?.(account, realm);
      const meta = socket ? deps.getSocketMeta(socket) : null;
      return meta?.peerId || "";
    }
    if (peerId && deps.findSocketByPeerId(peerId, realm)) return peerId;
    if (hints.name) {
      const socket = deps.findSocketByName?.(hints.name, realm);
      const meta = socket ? deps.getSocketMeta(socket) : null;
      if (meta?.peerId) return meta.peerId;
    }
    return peerId || "";
  }

  function socketForAccount(account = "", realm = null) {
    if (!account || typeof deps.findSocketByAccount !== "function") return null;
    return deps.findSocketByAccount(account, realm) || null;
  }

  function canonicalTeamLeaderAccount(meta = {}) {
    const account = String(meta.account || "");
    if (!account) return "";
    if (meta.teamLeaderAccount) return String(meta.teamLeaderAccount);
    if (meta.leaderId && meta.leaderId !== meta.peerId) return "";
    if (meta.team?.leaderId && meta.team.leaderId !== meta.peerId) return "";
    return account;
  }

  function teamPeerIds(peerId, hints = {}, realm = null) {
    peerId = resolvePeerId(peerId, hints, realm);
    const socket = deps.findSocketByPeerId(peerId, realm);
    const meta = socket ? deps.getSocketMeta(socket) : null;
    if (!meta) return [peerId];
    const leaderAccount = canonicalTeamLeaderAccount(meta);
    if (!leaderAccount) return [peerId];
    const leaderSocket = socketForAccount(leaderAccount, realm);
    const leaderMeta = leaderSocket ? deps.getSocketMeta(leaderSocket) : null;
    if (!leaderMeta?.peerId || leaderMeta.account !== leaderAccount) return [peerId];
    const leaderMap = leaderMeta?.mapName || "";
    const memberAccounts = Array.isArray(leaderMeta?.team?.members)
      ? leaderMeta.team.members.map((member) => String(member?.account || "")).filter(Boolean)
      : [];
    return [...new Set([leaderAccount, ...memberAccounts])]
      .map((account) => {
        const memberSocket = socketForAccount(account, realm);
        const memberMeta = memberSocket ? deps.getSocketMeta(memberSocket) : null;
        return memberMeta?.peerId && (!leaderMap || memberMeta.mapName === leaderMap) ? memberMeta.peerId : "";
      })
      .filter(Boolean)
      .slice(0, 4);
  }

  function sharesTeam(attackerIds, defenderIds) {
    const defenderSet = new Set(defenderIds || []);
    return (attackerIds || []).some((peerId) => defenderSet.has(peerId));
  }

  function isPeerInActiveBattle(peerId, realm = {}) {
    if (!peerId) return false;
    const account = accountForPeerId(peerId, realm);
    if (account) return isAccountInActiveBattle(account, realm);
    return [...activeBattles.values()].some((active) => (
      active.realm?.serverId === realm.serverId
      && Number(active.realm?.channelId) === Number(realm.channelId)
      && (active.attackerIds.includes(peerId) || active.defenderIds.includes(peerId))
    ));
  }

  function isAccountInActiveBattle(account, realm = {}) {
    if (!account) return false;
    return [...activeBattles.values()].some((active) => (
      active.realm?.serverId === realm.serverId
      && Number(active.realm?.channelId) === Number(realm.channelId)
      && [...(active.participantAccounts?.values() || [])].includes(account)
    ));
  }

  function buildSide(peerIds, realm = null) {
    const actors = [];
    const roster = [];
    for (const peerId of peerIds) {
      const socket = deps.findSocketByPeerId(peerId, realm);
      const meta = socket ? deps.getSocketMeta(socket) : null;
      if (!meta?.account) continue;
      const row = deps.fetchPlayerRow(meta.account);
      if (!row) continue;
      const participants = buildBattleParticipants(row, meta, peerId, meta.name || meta.account);
      roster.push({ peerId, account: meta.account || "", name: meta.name || meta.account });
      actors.push(participants.actorBattle, participants.petBattle, participants.mercenaryBattle);
    }
    return {
      roster: normalizeRoster(roster.map((item) => item.peerId), realm),
      actors: actors.filter(Boolean)
    };
  }

  function accountForPeerId(peerId = "", realm = null) {
    const socket = deps.findSocketByPeerId(peerId, realm);
    const meta = socket ? deps.getSocketMeta(socket) : null;
    if (meta?.account) return meta.account;
    for (const session of activeBattles.values()) {
      if (realm?.serverId && (session.realm?.serverId !== realm.serverId || Number(session.realm?.channelId) !== Number(realm.channelId))) continue;
      const account = session.participantAccounts?.get(peerId);
      if (account) return account;
    }
    return "";
  }

  function livePeerIdForAccount(account = "", realm = null) {
    if (!account) return "";
    const socket = deps.findSocketByAccount?.(account, realm);
    const meta = socket ? deps.getSocketMeta(socket) : null;
    return meta?.peerId || "";
  }

  function participantAccountMap(peerIds = [], realm = null) {
    const map = new Map();
    for (const peerId of peerIds) {
      const account = accountForPeerId(peerId, realm);
      if (peerId && account) map.set(peerId, account);
    }
    return map;
  }

  function createSession(invite, attackerIds, defenderIds, realm = null) {
    const attacker = buildSide(attackerIds, realm);
    const defender = invite.pve ? { roster: [], actors: buildWildSide(invite, attackerIds) } : buildSide(defenderIds, realm);
    const teamLeaderAccounts = [...new Set((invite.teamLeaderAccounts || []).map((account) => String(account || "")).filter(Boolean))];
    const session = {
      battleId: invite.battleId,
      key: battleKey(realm, invite.battleId),
      realm: realm || { serverId: "", channelId: 0 },
      attackerIds,
      defenderIds,
      attackerRoster: attacker.roster,
      defenderRoster: defender.roster,
      pve: invite.pve === true,
      wildMonsterId: invite.wildMonsterId || "",
      monsterCount: defender.actors.length || 1,
      battleState: null,
      choices: new Map(),
      timer: null,
      participantAccounts: participantAccountMap([...attackerIds, ...defenderIds], realm),
      // Only the originating group leaders may tear down this session through team disband.
      teamLeaderAccounts
    };
    session.engine = BattleEngine.createRuntime({
      statLimits: deps.statLimits,
      skillCatalog: BattleSkills.skillCatalog,
      skillById,
      skillsForStats,
      defaultSkillIdForStats,
      sacrificeAlliesReady: (skill, actor) => {
        const battleState = session.battleState;
        const fighter = battleState ? [...battleState.playerTeam, ...battleState.enemyTeam].find((unit) => unit.actor === actor) : null;
        return sacrificeAlliesReadyForFighter(skill, fighter, battleState);
      },
      statsForActor: (actor) => actor?.battleStats || null,
      fighterKind,
      effectIdForActor,
      normalizeBattleStatuses,
      alive,
      pickTarget,
      fighterRef,
      sample: deps.sample,
      critLines: [],
      getBattle: () => session.battleState,
      getPlayer: () => session.battleState?.playerTeam.find((fighter) => fighter.actor?.ownerPeerId === session.attackerIds[0] && fighterKind(fighter) === "role")?.actor || null,
      getPet: () => session.battleState?.playerTeam.find((fighter) => fighter.actor?.ownerPeerId === session.attackerIds[0] && fighterKind(fighter) === "pet")?.actor || null,
      snapshotBattleHp: () => session.battleState ? [...session.battleState.playerTeam, ...session.battleState.enemyTeam].map((fighter) => ({
        fighter,
        hp: fighter.hp,
        defeated: fighter.defeated,
        statuses: normalizeBattleStatuses(fighter.statuses),
        buffs: { ...(fighter.buffs || {}) },
        damageReductionDown: fighter.damageReductionDown || 0,
        defenseCleared: fighter.defenseCleared === true,
        passiveRebirthUsed: fighter.passiveRebirthUsed === true,
        passiveRebirthChance: fighter.passiveRebirthChance || 0,
        passiveCombo: fighter.passiveCombo === true,
        passiveComboBasic: fighter.passiveComboBasic === true,
        passiveCounter: fighter.passiveCounter === true,
        passiveBreakArmor: fighter.passiveBreakArmor === true,
        passiveLifesteal: fighter.passiveLifesteal || 0,
        passiveGuardRole: fighter.passiveGuardRole || 0,
        passiveGuardPet: fighter.passiveGuardPet || 0,
        passiveGuardMercenary: fighter.passiveGuardMercenary || 0,
        selfGuardReduction: fighter.selfGuardReduction || 0,
        controlImmune: fighter.controlImmune === true,
        statMultiplier: fighter.statMultiplier || 1,
        statMultipliers: { ...(fighter.statMultipliers || {}) },
        maxHp: fighter.maxHp,
        maxHpBoostApplied: fighter.maxHpBoostApplied === true
      })) : [],
      restoreBattleHp: (snapshot) => {
        for (const item of snapshot || []) {
          item.fighter.hp = item.hp;
          item.fighter.defeated = item.defeated;
        }
      },
      autoActionForFighter: (fighter, targetTeam) => {
        const target = alive(targetTeam)[0];
        if (fighter?.actor?.forceBasicAttack || fighter?.stats?.forceBasicAttack) return { type: "attack", target: fighterRef(target) };
        const skillId = defaultBattleSkillIdForFighter(fighter, session.battleState);
        return skillId
          ? { type: "skill", target: fighterRef(target), skillId }
          : { type: "attack", target: fighterRef(target) };
      },
      fighterBattleSnapshot: (fighter) => ({
        battleId: fighter.battleId,
        name: fighter.name,
        hp: fighter.hp,
        defeated: fighter.defeated,
        statuses: normalizeBattleStatuses(fighter.statuses),
        defenseCleared: fighter.defenseCleared === true,
        damageReductionDown: fighter.damageReductionDown || 0,
        buffs: { ...(fighter.buffs || {}) },
        passiveRebirthUsed: fighter.passiveRebirthUsed === true,
        maxHp: fighter.maxHp,
        selfGuardReduction: fighter.selfGuardReduction || 0,
        controlImmune: fighter.controlImmune === true,
        statMultiplier: fighter.statMultiplier || 1,
        statMultipliers: { ...(fighter.statMultipliers || {}) },
        passiveRebirthChance: fighter.passiveRebirthChance || 0,
        passiveComboBasic: fighter.passiveComboBasic === true,
        passiveLifesteal: fighter.passiveLifesteal || 0
      })
    });
    session.battleState = {
      id: session.battleId,
      playerTeam: attacker.actors.map((actor, index) => session.engine.makeFighter(actor, "ally", index)),
      enemyTeam: defender.actors.map((actor, index) => session.engine.makeFighter(actor, "enemy", index))
    };
    return session;
  }

  function wildMonsterCountForTeam(size) {
    if (size >= 4) return 14;
    if (size >= 3) return 10;
    if (size === 2) return 4;
    return 1;
  }

  function wildMonsterStats(monsterId) {
    const id = String(monsterId || "");
    if (id === "phantom") {
      return {
        name: "幻影",
        spriteId: 459,
        stats: { hp: 1500000, defense: 85000, speed: 1810, attack: 72000, mana: 18000, crit: 12, critDamage: 320, skillId: "wild_afei_heal" }
      };
    }
    if (id === "afei") {
      return {
        name: "阿飞",
        spriteId: 234,
        stats: { hp: 1500000, defense: 85000, speed: 1810, attack: 72000, mana: 18000, crit: 12, critDamage: 320, skillId: "wild_afei_heal" },
        minion: {
          spriteId: 235,
          names: ["丽丽", "琉璃", "萝莉", "莉莉", "兰兰", "玲玲", "琪琪", "七七", "微微"],
          stats: { hp: 360000, defense: 42000, speed: 1500, attack: 38000, mana: 7000, crit: 8, critDamage: 260, skillId: "shining_strike", forceBasicAttack: true }
        }
      };
    }
    return {
      name: "阿木木",
      spriteId: 895,
      stats: { hp: 118000, defense: 14500, speed: 1350, attack: 18500, mana: 2600, crit: 6, critDamage: 240, skillId: "wild_amumu" }
    };
  }

  function isSupportedPveMonster(monsterId) {
    return monsterId === "amumu" || monsterId === "phantom" || monsterId === "afei";
  }

  function requiresPveEncounter(monsterId) {
    return monsterId === "amumu" || monsterId === "phantom";
  }

  function buildWildSide(invite, attackerIds) {
    const monsterId = String(invite.wildMonsterId || "");
    const monster = wildMonsterStats(monsterId);
    if (monsterId === "afei") {
      const boss = {
        name: monster.name,
        spriteId: monster.spriteId,
        ownerPeerId: "",
        ownerName: "",
        wildMonsterId: monsterId,
        battleStats: { ...monster.stats },
        forceBasicAttack: monster.stats.forceBasicAttack === true
      };
      const minions = (monster.minion?.names || []).map((name) => ({
        name,
        spriteId: monster.minion.spriteId,
        ownerPeerId: "",
        ownerName: "",
        wildMonsterId: monsterId,
        battleStats: { ...monster.minion.stats },
        forceBasicAttack: true
      }));
      return [boss, ...minions];
    }
    const count = wildMonsterCountForTeam(attackerIds.length);
    return Array.from({ length: count }, (_, index) => ({
      name: count === 1 ? monster.name : `${monster.name}${index + 1}`,
      spriteId: monster.spriteId,
      ownerPeerId: "",
      ownerName: "",
      wildMonsterId: monsterId,
      battleStats: { ...monster.stats },
      forceBasicAttack: monster.stats.forceBasicAttack === true
    }));
  }

  function buildChoiceForSide(session, sidePeerIds) {
    const result = { actions: {} };
    const isAttackerSide = sidePeerIds === session.attackerIds || (sidePeerIds || []).some((peerId) => session.attackerIds.includes(peerId));
    const ownTeam = isAttackerSide ? session.battleState.playerTeam : session.battleState.enemyTeam;
    const targetTeam = isAttackerSide ? session.battleState.enemyTeam : session.battleState.playerTeam;
    for (const peerId of sidePeerIds) {
      const choice = session.choices.get(peerId);
      if (!choice) continue;
      if (choice.actions && typeof choice.actions === "object") {
        Object.entries(choice.actions).forEach(([ref, action]) => {
          if (!action || typeof action !== "object") return;
          const fighter = findFighterByRef(ownTeam, ref);
          if (fighter?.actor?.ownerPeerId !== peerId) return;
          const clean = sanitizeActionForFighter(fighter, action, targetTeam, session.battleState);
          if (clean) result.actions[fighterRef(fighter)] = clean;
        });
        continue;
      }
      const fighters = session.battleState.playerTeam.concat(session.battleState.enemyTeam).filter((fighter) => fighter.actor?.ownerPeerId === peerId);
      for (const fighter of fighters) {
        const kind = fighter.actor.isMercenary ? "mercenary" : fighter.actor.isPet ? "pet" : "actor";
        if (choice[kind]) {
          const clean = sanitizeActionForFighter(fighter, choice[kind], targetTeam, session.battleState);
          if (clean) result.actions[fighterRef(fighter)] = clean;
        }
      }
    }
    return result;
  }

  function applyTeamHp(team, hpList) {
    for (const item of hpList || []) {
      const fighter = (team || []).find((entry) => entry.battleId === (item.battleId || item.name)) || (team || []).find((entry) => entry.name === item.name);
      if (!fighter) continue;
      fighter.hp = item.hp;
      fighter.defeated = item.defeated;
      fighter.maxHp = item.maxHp || fighter.maxHp;
      fighter.statuses = normalizeBattleStatuses(item.statuses);
      fighter.defenseCleared = item.defenseCleared === true;
      fighter.damageReductionDown = item.damageReductionDown || 0;
      fighter.buffs = { ...(item.buffs || {}) };
      fighter.passiveRebirthUsed = item.passiveRebirthUsed === true;
      fighter.selfGuardReduction = item.selfGuardReduction || 0;
      fighter.controlImmune = item.controlImmune === true;
      fighter.statMultiplier = item.statMultiplier || 1;
      fighter.statMultipliers = { ...(item.statMultipliers || {}) };
      fighter.passiveRebirthChance = item.passiveRebirthChance || 0;
      fighter.passiveLifesteal = item.passiveLifesteal || 0;
    }
  }

  function sendToPeer(peerId, payload, realm = null) {
    let resolvedPeerId = peerId;
    let socket = deps.findSocketByPeerId(resolvedPeerId, realm);
    if (!socket) {
      const account = accountForPeerId(peerId, realm);
      resolvedPeerId = livePeerIdForAccount(account, realm) || peerId;
      socket = resolvedPeerId ? deps.findSocketByPeerId(resolvedPeerId, realm) : null;
    }
    if (!socket) return false;
    deps.sendSocketJson(socket, resolvedPeerId && resolvedPeerId !== payload.to ? { ...payload, to: resolvedPeerId } : payload);
    return true;
  }

  function sendToParticipant(session, peerId, payload) {
    const account = session.participantAccounts?.get(peerId) || "";
    const socket = socketForAccount(account, session.realm);
    const meta = socket ? deps.getSocketMeta(socket) || {} : null;
    if (!socket || !meta?.peerId) return false;
    deps.sendSocketJson(socket, { ...payload, to: meta.peerId });
    return true;
  }

  function broadcastBattleStart(session, attackerInvite) {
    const attackerMessage = {
      type: "teamBattleStart",
      battleId: session.battleId,
      role: "attacker",
      pvp: !session.pve,
      teamBattleServer: true,
      roster: session.attackerRoster,
      friendlyRoster: session.attackerRoster,
      enemyRoster: session.defenderRoster,
      allies: session.battleState.playerTeam.map((fighter) => publicBattleActor(fighter.actor)).filter(Boolean),
      enemies: session.battleState.enemyTeam.map((fighter) => publicBattleActor(fighter.actor)).filter(Boolean),
      wildMonsterId: session.wildMonsterId,
      monsterCount: session.monsterCount,
      marker: attackerInvite.marker || null,
      choiceMs: deps.choiceMs
    };
    const defenderMessage = {
      ...attackerMessage,
      role: "defender",
      roster: session.defenderRoster,
      friendlyRoster: session.defenderRoster,
      enemyRoster: session.attackerRoster
    };
    for (const peerId of session.attackerIds) sendToParticipant(session, peerId, { ...attackerMessage, controlledPeerId: peerId });
    for (const peerId of session.defenderIds) sendToParticipant(session, peerId, { ...defenderMessage, controlledPeerId: peerId });
  }

  function broadcastBattleEnd(session, extra = {}) {
    for (const peerId of session.attackerIds) {
      sendToParticipant(session, peerId, { type: "teamBattleEnd", battleId: session.battleId, roster: session.attackerRoster, ...extra });
    }
    for (const peerId of session.defenderIds) {
      sendToParticipant(session, peerId, { type: "teamBattleEnd", battleId: session.battleId, roster: session.defenderRoster, ...extra });
    }
  }

  function startResolutionTimer(session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => resolveSession(session.key), deps.choiceMs || 15000);
    session.timer.unref?.();
  }

  function resolveSession(sessionKey) {
    const session = activeBattles.get(sessionKey);
    if (!session) return;
    clearTimeout(session.timer);
    const allyChoice = buildChoiceForSide(session, session.attackerIds);
    const enemyChoice = buildChoiceForSide(session, session.defenderIds);
    const result = session.engine.resolveBattleTurn(allyChoice, enemyChoice);
    applyTeamHp(session.battleState.playerTeam, result.hp.ally);
    applyTeamHp(session.battleState.enemyTeam, result.hp.enemy);
    for (const peerId of session.attackerIds) {
      sendToParticipant(session, peerId, { type: "teamBattleTurn", battleId: session.battleId, result, roster: session.attackerRoster });
    }
    for (const peerId of session.defenderIds) {
      sendToParticipant(session, peerId, { type: "teamBattleTurn", battleId: session.battleId, result, roster: session.defenderRoster });
    }
    if (result.done) {
      // Boss rewards need their own server-issued challenge ticket and cannot reuse wild encounters.
      if (session.pve && requiresPveEncounter(session.wildMonsterId) && result.winner === "ally" && typeof deps.issuePveRewardTickets === "function") {
        for (const peerId of session.attackerIds) {
          const account = session.participantAccounts.get(peerId);
          const rewardTicket = account ? deps.issuePveRewardTickets({
            battleId: session.battleId,
            account,
            monsterId: session.wildMonsterId,
            monsterCount: session.monsterCount
          }) : "";
          if (rewardTicket) {
            sendToParticipant(session, peerId, {
              type: "teamBattleReward",
              battleId: session.battleId,
              roster: session.attackerRoster,
              wildMonsterId: session.wildMonsterId,
              monsterCount: session.monsterCount,
              rewardTicket,
              rewardId: rewardTicket
            });
          }
        }
      }
      broadcastBattleEnd(session);
      activeBattles.delete(sessionKey);
      pendingStarts.delete(sessionKey);
    } else {
      session.choices.clear();
      startResolutionTimer(session);
    }
  }

  function handleBattleStart(data, sender) {
    if (!data?.battleId || !data?.attackerId || !data?.defenderId) return false;
    const senderMeta = deps.getSocketMeta(sender) || {};
    const realm = realmFromMeta(senderMeta);
    const senderPeerId = senderMeta.peerId || "";
    const attackerPeerId = senderPeerId || resolvePeerId(data.attackerId, { account: senderMeta.account || data.attackerAccount || "", name: senderMeta.name || data.attackerName || "" }, realm);
    if (!attackerPeerId) return false;
    const soloPvp = data.pvpMode === "solo" || data.solo === true;
    data = {
      ...data,
      attackerId: attackerPeerId,
      attackerAccount: senderMeta.account || data.attackerAccount || "",
      attackerName: senderMeta.name || data.attackerName || ""
    };
    const defenderPeerId = resolvePeerId(data.defenderId, { account: data.defenderAccount || "", name: data.defenderName || "" }, realm);
    const defenderSocket = deps.findSocketByPeerId(defenderPeerId, realm);
    const defenderMeta = defenderSocket ? deps.getSocketMeta(defenderSocket) || {} : null;
    if (!defenderMeta?.account) {
      sendToPeer(data.attackerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: data.attackerId,
        defenderId: data.defenderId,
        reason: "offline"
      }, realm);
      return true;
    }
    if (!senderMeta.mapName || !defenderMeta.mapName || senderMeta.mapName !== defenderMeta.mapName) {
      sendToPeer(data.attackerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: data.attackerId,
        defenderId: data.defenderId,
        reason: "different_map"
      }, realm);
      return true;
    }
    const attackerIds = soloPvp
      ? [attackerPeerId]
      : teamPeerIds(data.attackerId, { account: data.attackerAccount || "", name: data.attackerName || "" }, realm);
    const defenderIds = soloPvp
      ? [defenderPeerId].filter(Boolean)
      : teamPeerIds(data.defenderId, { account: data.defenderAccount || "", name: data.defenderName || "" }, realm);
    if (sharesTeam(attackerIds, defenderIds)) {
      sendToPeer(data.attackerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: data.attackerId,
        defenderId: data.defenderId,
        reason: "same_team"
      }, realm);
      return true;
    }
    const teamLeaderAccounts = [];
    if (!soloPvp && attackerIds.length > 1) {
      const leaderAccount = canonicalTeamLeaderAccount(senderMeta);
      if (leaderAccount) teamLeaderAccounts.push(leaderAccount);
    }
    if (!soloPvp && defenderIds.length > 1) {
      const leaderAccount = canonicalTeamLeaderAccount(defenderMeta);
      if (leaderAccount) teamLeaderAccounts.push(leaderAccount);
    }
    const requestedKey = battleKey(realm, data.battleId);
    const participantAccounts = [...new Set([
      senderMeta.account,
      ...attackerIds.map((peerId) => accountForPeerId(peerId, realm)),
      ...defenderIds.map((peerId) => accountForPeerId(peerId, realm))
    ].filter(Boolean))];
    if (activeBattles.has(requestedKey) || participantAccounts.some((account) => isAccountInActiveBattle(account, realm))) {
      sendToPeer(data.attackerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: data.attackerId,
        defenderId: data.defenderId,
        reason: "battle_in_progress"
      }, realm);
      return true;
    }
    const session = createSession({ ...data, teamLeaderAccounts }, attackerIds, defenderIds, realm);
    if (!session.battleState?.playerTeam?.length || !session.battleState?.enemyTeam?.length) {
      sendToPeer(data.attackerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: data.attackerId,
        defenderId: data.defenderId,
        reason: "offline"
      }, realm);
      return true;
    }
    activeBattles.set(session.key, session);
    pendingStarts.set(session.key, { ...data, realm });
    broadcastBattleStart(session, data);
    startResolutionTimer(session);
    return true;
  }

  function handlePveIdleEncounterRequest(sender) {
    const senderMeta = deps.getSocketMeta(sender) || {};
    const realm = realmFromMeta(senderMeta);
    const leaderPeerId = senderMeta.peerId || "";
    if (!leaderPeerId || !senderMeta.account) return true;
    const canonicalLeaderAccount = canonicalTeamLeaderAccount(senderMeta);
    const canonicalLeaderId = String(senderMeta.team?.leaderId || senderMeta.leaderId || leaderPeerId);
    if (canonicalLeaderAccount !== senderMeta.account || canonicalLeaderId !== leaderPeerId) return true;
    const attackerIds = teamPeerIds(leaderPeerId, {}, realm);
    const participantAccounts = attackerIds.map((peerId) => accountForPeerId(peerId, realm)).filter(Boolean);
    if (
      !attackerIds.length
      || attackerIds.some((peerId) => isPeerInActiveBattle(peerId, realm))
      || participantAccounts.some((account) => isAccountInActiveBattle(account, realm))
    ) return true;
    deps.requestPveIdleEncounter?.({ ...senderMeta, socket: sender });
    return true;
  }

  function handleTeamPveStart(data, sender) {
    const senderMeta = deps.getSocketMeta(sender) || {};
    const realm = realmFromMeta(senderMeta);
    const leaderPeerId = senderMeta.peerId || "";
    const monsterId = String(data?.wildMonsterId || "");
    if (!data?.battleId || !leaderPeerId || !senderMeta.account) return true;
    if (!isSupportedPveMonster(monsterId)) {
      sendToPeer(leaderPeerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: leaderPeerId,
        reason: "unsupported_monster"
      }, realm);
      return true;
    }
    const canonicalLeaderAccount = canonicalTeamLeaderAccount(senderMeta);
    const canonicalLeaderId = String(senderMeta.team?.leaderId || senderMeta.leaderId || leaderPeerId);
    if (canonicalLeaderAccount !== senderMeta.account || canonicalLeaderId !== leaderPeerId) {
      sendToPeer(leaderPeerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: leaderPeerId,
        reason: "team_leader_required"
      }, realm);
      return true;
    }
    const attackerIds = teamPeerIds(leaderPeerId, {}, realm);
    if (!attackerIds.length) {
      sendToPeer(leaderPeerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: leaderPeerId,
        reason: "offline"
      }, realm);
      return true;
    }
    const requestedKey = battleKey(realm, data.battleId);
    const participantAccounts = attackerIds.map((peerId) => accountForPeerId(peerId, realm)).filter(Boolean);
    const participantAlreadyBattling = (
      attackerIds.some((peerId) => isPeerInActiveBattle(peerId, realm))
      || participantAccounts.some((account) => isAccountInActiveBattle(account, realm))
    );
    if (activeBattles.has(requestedKey) || participantAlreadyBattling) {
      sendToPeer(leaderPeerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: leaderPeerId,
        reason: "battle_in_progress"
      }, realm);
      return true;
    }
    let startCheck = { ok: true };
    for (const peerId of attackerIds) {
      const account = accountForPeerId(peerId, realm);
      const check = deps.canStartPve?.(account) || { ok: true };
      if (check.ok) continue;
      startCheck = check;
      break;
    }
    if (!startCheck?.ok) {
      sendToPeer(leaderPeerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: leaderPeerId,
        reason: startCheck.error || "battle_cooldown"
      }, realm);
      return true;
    }
    const invite = {
      battleId: data.battleId,
      pve: true,
      attackerId: leaderPeerId,
      leaderId: leaderPeerId,
      wildMonsterId: monsterId,
      marker: data.marker || null,
      teamLeaderAccounts: attackerIds.length > 1 ? [canonicalLeaderAccount] : []
    };
    const session = createSession(invite, attackerIds, [], realm);
    if (!session.battleState?.playerTeam?.length || !session.battleState?.enemyTeam?.length) {
      sendToPeer(leaderPeerId, {
        type: "battleRejected",
        battleId: data.battleId,
        attackerId: leaderPeerId,
        reason: "offline"
      }, realm);
      return true;
    }
    if (requiresPveEncounter(monsterId)) {
      let encounterCheck = null;
      try {
        encounterCheck = deps.consumePveEncounter?.({
          account: senderMeta.account,
          encounterId: data.encounterId,
          monsterId,
          meta: senderMeta
        });
      } catch {}
      if (!encounterCheck?.ok) {
        sendToPeer(leaderPeerId, {
          type: "battleRejected",
          battleId: data.battleId,
          attackerId: leaderPeerId,
          reason: encounterCheck?.error === "pve_encounter_mismatch" ? "pve_encounter_mismatch" : "pve_encounter_required"
        }, realm);
        return true;
      }
    }
    activeBattles.set(session.key, session);
    pendingStarts.set(session.key, { battleId: session.battleId, attackerId: leaderPeerId, realm });
    broadcastBattleStart(session, invite);
    startResolutionTimer(session);
    return true;
  }

  function handleState(data, sender) {
    const meta = deps.getSocketMeta(sender) || {};
    meta.clientVersion = data.clientVersion || meta.clientVersion || "";
    meta.clientMirror = buildClientMirrorFromState(data);
    deps.setSocketMeta(sender, meta);
    return false;
  }

  function sessionPeerIdForSender(session, sender, data = {}) {
    const meta = deps.getSocketMeta(sender) || {};
    const realm = realmFromMeta(meta);
    if (session.realm?.serverId !== realm.serverId || Number(session.realm?.channelId) !== Number(realm.channelId)) return "";
    const account = String(meta.account || "");
    if (!account) return "";
    for (const [knownPeerId, knownAccount] of session.participantAccounts || []) {
      if (knownAccount === account) return knownPeerId;
    }
    return "";
  }

  function handleTeamBattleChoice(data, sender) {
    const key = battleKey(realmFromMeta(deps.getSocketMeta(sender) || {}), data?.battleId);
    const session = activeBattles.get(key);
    if (!session) return true;
    const peerId = sessionPeerIdForSender(session, sender, data);
    if (!peerId) return true;
    session.choices.set(peerId, data.choice || {});
    if (session.choices.size >= session.attackerIds.length + session.defenderIds.length) {
      resolveSession(key);
      return true;
    }
    startResolutionTimer(session);
    return true;
  }

  function handleBattleEnd(data, sender, allowEscape = false) {
    if (!data?.battleId) return false;
    const key = battleKey(realmFromMeta(deps.getSocketMeta(sender) || {}), data.battleId);
    const session = activeBattles.get(key);
    const escapedPeerId = session ? sessionPeerIdForSender(session, sender, data) : "";
    if (session && (!allowEscape || data.reason !== "escape" || !escapedPeerId)) return true;
    if (session?.timer) clearTimeout(session.timer);
    if (session) {
      broadcastBattleEnd(session, { reason: "escape", escapedPeerId });
    }
    activeBattles.delete(key);
    pendingStarts.delete(key);
    return Boolean(session);
  }

  function endTeamBattlesForLeader(account = "", realm = {}, reason = "team_disbanded") {
    const targetRealm = realmFromMeta(realm);
    const leaderAccount = String(account || "");
    let ended = 0;
    for (const [key, session] of activeBattles) {
      if (
        session.realm?.serverId !== targetRealm.serverId
        || Number(session.realm?.channelId) !== Number(targetRealm.channelId)
        || !session.teamLeaderAccounts?.includes(leaderAccount)
      ) continue;
      if (session.timer) clearTimeout(session.timer);
      broadcastBattleEnd(session, { reason });
      activeBattles.delete(key);
      pendingStarts.delete(key);
      ended += 1;
    }
    return ended;
  }

  function handleDisconnect(peerId = "", realm = null) {
    if (!peerId) return;
    const disconnectedRealm = realmFromMeta(realm || {});
    for (const [key, data] of pendingStarts) {
      const pendingRealm = realmFromMeta(data?.realm || {});
      if (disconnectedRealm.serverId && (
        pendingRealm.serverId !== disconnectedRealm.serverId
        || pendingRealm.channelId !== disconnectedRealm.channelId
      )) continue;
      if (data?.attackerId === peerId || data?.defenderId === peerId) pendingStarts.delete(key);
    }
  }

  function handleRoomMessage(data, sender) {
    if (!data || typeof data !== "object") return false;
    if (data.type === "state") return handleState(data, sender);
    if (data.type === "pveIdleEncounterRequest") return handlePveIdleEncounterRequest(sender);
    if (data.type === "teamPveStart") return handleTeamPveStart(data, sender);
    if (data.type === "battleStart") return handleBattleStart(data, sender);
    if (data.type === "teamBattleChoice") return handleTeamBattleChoice(data, sender);
    if (data.type === "battleEnd") return handleBattleEnd(data, sender, false);
    if (data.type === "battleEscape") return handleBattleEnd(data, sender, true);
    if (data.type === "teamBattleEnd") return true;
    if (data.type === "battleAccepted" || data.type === "battleChoice" || data.type === "battleTurn" || data.type === "battleRejected") return true;
    return false;
  }

  function startPvp(account = "", data = {}) {
    const requestedRealm = data.serverId
      ? { serverId: String(data.serverId), channelId: Math.floor(Number(data.channelId) || 0) }
      : null;
    const socket = deps.findSocketByAccount?.(account, requestedRealm);
    if (!socket) return { ok: false, status: 409, error: "attacker_offline" };
    const meta = deps.getSocketMeta(socket) || {};
    const realm = realmFromMeta(meta);
    const battleId = data.battleId || `pvp_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const payload = {
      ...data,
      type: "battleStart",
      battleId,
      attackerId: meta.peerId || data.attackerId || "",
      attackerAccount: account,
      attackerName: meta.name || data.attackerName || account,
      pvpMode: data.pvpMode || "solo"
    };
    const handled = handleBattleStart(payload, socket);
    if (!handled) return { ok: false, status: 400, error: "battle_start_failed", battleId };
    if (!activeBattles.has(battleKey(realm, battleId))) return { ok: false, status: 409, error: "battle_start_rejected", battleId };
    return { ok: true, battleId };
  }

  function startPve(account = "", data = {}) {
    const requestedRealm = data.serverId
      ? { serverId: String(data.serverId), channelId: Math.floor(Number(data.channelId) || 0) }
      : null;
    const socket = deps.findSocketByAccount?.(account, requestedRealm);
    if (!socket) return { ok: false, status: 409, error: "attacker_offline" };
    const meta = deps.getSocketMeta(socket) || {};
    const realm = realmFromMeta(meta);
    const battleId = data.battleId || `pve_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const payload = {
      ...data,
      type: "teamPveStart",
      battleId,
      encounterId: data.encounterId,
      leaderId: meta.peerId || data.leaderId || data.attackerId || "",
      attackerId: meta.peerId || data.attackerId || "",
      attackerAccount: account,
      attackerName: meta.name || account
    };
    const handled = handleTeamPveStart(payload, socket);
    if (!handled) return { ok: false, status: 400, error: "battle_start_failed", battleId };
    if (!activeBattles.has(battleKey(realm, battleId))) return { ok: false, status: 409, error: "battle_start_rejected", battleId };
    return { ok: true, battleId };
  }

  return {
    handleRoomMessage,
    handleDisconnect,
    endTeamBattlesForLeader,
    startPvp,
    startPve
  };
}

module.exports = createRuntime;
