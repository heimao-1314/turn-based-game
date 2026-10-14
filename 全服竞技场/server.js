/**
 * @file server.js
 * @description 全服竞技场服务端模块：排行、上传防守数据、服务器权威挑战结算。
 */
const BattleSkills = require("../战斗/skills.js");
const BattleEngine = require("../战斗/engine.js");

function createArenaRuntime(deps) {
  const MAX_RANK = 100;
  const MAX_TURNS = 60;
  const effectPool = [1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051, 1052];
  const activeSessions = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function settlementKey(now = new Date()) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function rewardForRank(rank) {
    if (rank === 1) return { soulPowder: 5000, immortalPill: 20 };
    if (rank === 2) return { soulPowder: 3000, immortalPill: 15 };
    if (rank === 3) return { soulPowder: 2000, immortalPill: 10 };
    if (rank >= 5 && rank <= 10) return { soulPowder: 1000, immortalPill: 5 };
    if (rank >= 11 && rank <= 100) return { soulPowder: 500, immortalPill: 2 };
    return { soulPowder: 0, immortalPill: 0 };
  }

  function objectOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeBattleStatuses(statuses = {}) {
    const next = {};
    Object.entries(statuses || {}).forEach(([key, value]) => {
      if (!value) return;
      if (key === "bleed" || key === "curse") {
        next[key] = { turns: Number(value.turns) || 0, amount: Number(value.amount) || 0 };
        return;
      }
      next[key] = typeof value === "number" ? value : Number(value) || 0;
    });
    return next;
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

  function alive(team) {
    return (team || []).filter((fighter) => !fighter.defeated && fighter.hp > 0);
  }

  function fighterRef(fighter) {
    return fighter?.battleId || fighter?.name || "";
  }

  function fighterKind(fighter) {
    if (fighter?.actor?.isPet) return "pet";
    if (fighter?.actor?.isMercenary) return "mercenary";
    return "role";
  }

  function findFighterByRef(team, ref = "") {
    return (team || []).find((fighter) => fighter.battleId === ref) || (team || []).find((fighter) => fighter.name === ref) || null;
  }

  function pickTarget(team, targetRef = "") {
    const candidates = alive(team);
    return findFighterByRef(candidates, targetRef) || candidates[Math.floor(Math.random() * candidates.length)] || null;
  }

  function firstAliveRef(team) {
    return fighterRef(alive(team)[0]);
  }

  function getEquippedItemInSlot(row, slot) {
    const equipped = deps.safeJsonObject(row?.equipped_json);
    const equipment = deps.safeJsonArray(row?.equipment_json);
    const id = equipped[slot];
    return equipment.find((item) => item.id === id) || null;
  }

  function roleSkillUsableForFighter(skillId, fighter, battleState) {
    const skill = skillById(skillId);
    if (!skill.requiredClass) return true;
    const actor = fighter?.actor || {};
    const row = actor.playerRow || null;
    const selection = actor.selection || {};
    if (!row || selection.className !== skill.requiredClass) return false;
    if (Array.isArray(skill.sacrificeAllies) && skill.sacrificeAllies.length) {
      const team = battleState.playerTeam.includes(fighter) ? battleState.playerTeam : battleState.enemyTeam;
      const ready = skill.sacrificeAllies.every((kind) => team.some((unit) => unit !== fighter && fighterKind(unit) === kind && !unit.defeated));
      if (!ready) return false;
    }
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
    if (fighter?.actor?.isMercenary && active.includes("holy_elf_spring")) return "holy_elf_spring";
    return active.includes(fighter?.stats?.skillId) ? fighter.stats.skillId : active[0] || defaultSkillIdForStats(fighter?.stats || {});
  }

  function normalizeAutoStrategyEntry(value) {
    if (value && typeof value === "object") return { mode: value.mode === "attack" ? "attack" : "skill", skillId: value.skillId || "" };
    return { mode: value === "attack" ? "attack" : "skill", skillId: "" };
  }

  function autoStrategyEntryForFighter(fighter) {
    const row = fighter?.actor?.playerRow;
    const source = deps.safeJsonObject(row?.auto_strategy_json);
    if (fighter?.actor?.isMercenary) {
      const mercenaryId = String(fighter.actor.mercenaryData?.id || "");
      return normalizeAutoStrategyEntry(objectOrEmpty(source.mercenaryById)[mercenaryId]);
    }
    if (fighter?.actor?.isPet) {
      const petId = String(fighter.actor.spriteId || "");
      return normalizeAutoStrategyEntry(objectOrEmpty(source.petById)[petId]);
    }
    return normalizeAutoStrategyEntry(source.actor);
  }

  function activeSkillIdForStrategy(fighter, entry, battleState) {
    const skills = activeBattleSkillsForFighter(fighter, battleState);
    return skills.includes(entry?.skillId) ? entry.skillId : defaultBattleSkillIdForFighter(fighter, battleState);
  }

  function autoActionForFighter(fighter, targetTeam, battleState) {
    if (fighter?.actor?.forceBasicAttack || fighter?.stats?.forceBasicAttack) {
      return { type: "attack", target: firstAliveRef(targetTeam) };
    }
    const entry = autoStrategyEntryForFighter(fighter);
    if (entry.mode === "attack") return { type: "attack", target: firstAliveRef(targetTeam) };
    return { type: "skill", target: firstAliveRef(targetTeam), skillId: activeSkillIdForStrategy(fighter, entry, battleState) };
  }

  function makeAutoChoice(team, targetTeam, battleState) {
    const actions = {};
    alive(team).forEach((fighter) => {
      actions[fighterRef(fighter)] = autoActionForFighter(fighter, targetTeam, battleState);
    });
    return { actions };
  }

  function sanitizeActionForFighter(fighter, action, targetTeam, battleState) {
    const target = firstAliveRef(targetTeam);
    if (!fighter || !action || typeof action !== "object") return null;
    if (action.type === "attack") return { type: "attack", target: action.target || target };
    const entry = normalizeAutoStrategyEntry({ mode: "skill", skillId: action.skillId || "" });
    return {
      type: "skill",
      target: action.target || target,
      skillId: activeSkillIdForStrategy(fighter, entry, battleState)
    };
  }

  function sanitizeChoiceForTeam(choice, ownTeam, targetTeam, battleState) {
    const next = {};
    const byKind = {
      actor: ownTeam.find((fighter) => !fighter.actor?.isPet && !fighter.actor?.isMercenary && !fighter.defeated),
      pet: ownTeam.find((fighter) => fighter.actor?.isPet && !fighter.defeated),
      mercenary: ownTeam.find((fighter) => fighter.actor?.isMercenary && !fighter.defeated)
    };
    Object.entries(byKind).forEach(([key, fighter]) => {
      const action = choice?.[key];
      const clean = sanitizeActionForFighter(fighter, action, targetTeam, battleState);
      if (clean) next[key] = clean;
    });
    const actions = objectOrEmpty(choice?.actions);
    Object.entries(actions).forEach(([ref, action]) => {
      const fighter = findFighterByRef(ownTeam, ref);
      const clean = sanitizeActionForFighter(fighter, action, targetTeam, battleState);
      if (clean) {
        next.actions = next.actions || {};
        next.actions[fighterRef(fighter)] = clean;
      }
    });
    return next;
  }

  function fighterBattleSnapshot(fighter) {
    return {
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
    };
  }

  function snapshotBattleState(battleState) {
    return [...battleState.playerTeam, ...battleState.enemyTeam].map((fighter) => ({
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
    }));
  }

  function restoreBattleState(snapshot) {
    for (const item of snapshot || []) {
      item.fighter.hp = item.hp;
      item.fighter.defeated = item.defeated;
      item.fighter.statuses = normalizeBattleStatuses(item.statuses);
      item.fighter.buffs = { ...(item.buffs || {}) };
      item.fighter.damageReductionDown = item.damageReductionDown || 0;
      item.fighter.defenseCleared = item.defenseCleared === true;
      item.fighter.passiveRebirthUsed = item.passiveRebirthUsed === true;
      item.fighter.passiveRebirthChance = item.passiveRebirthChance || 0;
      item.fighter.passiveCombo = item.passiveCombo === true;
      item.fighter.passiveComboBasic = item.passiveComboBasic === true;
      item.fighter.passiveCounter = item.passiveCounter === true;
      item.fighter.passiveBreakArmor = item.passiveBreakArmor === true;
      item.fighter.passiveLifesteal = item.passiveLifesteal || 0;
      item.fighter.passiveGuardRole = item.passiveGuardRole || 0;
      item.fighter.passiveGuardPet = item.passiveGuardPet || 0;
      item.fighter.passiveGuardMercenary = item.passiveGuardMercenary || 0;
      item.fighter.selfGuardReduction = item.selfGuardReduction || 0;
      item.fighter.controlImmune = item.controlImmune === true;
      item.fighter.statMultiplier = item.statMultiplier || 1;
      item.fighter.statMultipliers = { ...(item.statMultipliers || {}) };
      item.fighter.maxHp = item.maxHp || item.fighter.stats.hp;
      item.fighter.maxHpBoostApplied = item.maxHpBoostApplied === true;
    }
  }

  function applyTeamHp(team, hpList) {
    for (const item of hpList || []) {
      const fighter = findFighterByRef(team, item.battleId || item.name);
      if (!fighter) continue;
      Object.assign(fighter, {
        hp: item.hp,
        defeated: item.defeated,
        maxHp: item.maxHp || fighter.maxHp,
        statuses: normalizeBattleStatuses(item.statuses),
        defenseCleared: item.defenseCleared === true,
        damageReductionDown: item.damageReductionDown || 0,
        buffs: { ...(item.buffs || {}) },
        passiveRebirthUsed: item.passiveRebirthUsed === true,
        selfGuardReduction: item.selfGuardReduction || 0,
        controlImmune: item.controlImmune === true,
        statMultiplier: item.statMultiplier || 1,
        statMultipliers: { ...(item.statMultipliers || {}) },
        passiveRebirthChance: item.passiveRebirthChance || 0,
        passiveLifesteal: item.passiveLifesteal || 0
      });
    }
  }

  function effectIdForActor(actor, useSkill) {
    if (actor?.isPet) {
      const petIds = { 486: 1047, 495: 1048, 832: 1049, 836: 1050, 840: 1052 };
      return useSkill ? (petIds[actor.spriteId] || 1044) : effectPool[(actor.spriteId || 0) % effectPool.length];
    }
    if (actor?.isMercenary) return useSkill ? 1046 : 1044;
    const mapped = { "枪手": 1045, "法师": 1051, "剑士": 1044 };
    return useSkill ? (mapped[actor?.selection?.className] || 1044) : effectPool[(actor?.spriteId || 0) % effectPool.length];
  }

  function mirrorActorToBattleActor(actor, opts = {}) {
    if (!actor) return null;
    const mirrorMercenaryData = opts.isMercenary ? {
      id: String(actor.id || opts.mercenaryData?.id || ""),
      type: String(actor.type || opts.mercenaryData?.type || ""),
      passiveSkills: Array.isArray(actor.passiveSkills)
        ? actor.passiveSkills
        : Array.isArray(opts.mercenaryData?.passiveSkills) ? opts.mercenaryData.passiveSkills : [],
      extraSkills: Array.isArray(actor.extraSkills)
        ? actor.extraSkills
        : Array.isArray(opts.mercenaryData?.extraSkills) ? opts.mercenaryData.extraSkills : []
    } : null;
    return {
      name: String(actor.name || "").slice(0, 24),
      spriteId: Number(actor.spriteId) || 0,
      x: Number(actor.x) || 0,
      y: Number(actor.y) || 0,
      direction: actor.direction || "down",
      isPet: opts.isPet === true,
      isMercenary: opts.isMercenary === true,
      mercenaryData: mirrorMercenaryData || opts.mercenaryData || null,
      battleStats: actor.stats ? { ...actor.stats } : null,
      forceBasicAttack: actor.stats?.forceBasicAttack === true,
      selection: opts.selection || null,
      playerRow: opts.playerRow || null
    };
  }

  function participantsForPlayerRow(row, clientMirror = null) {
    const mirror = deps.arenaMirrorForPlayerRow(row, clientMirror);
    const selection = mirror.selection || deps.safeJsonObject(row.selection_json);
    const mercenary = deps.activeMercenaryForRow(row);
    return {
      mirror,
      actors: [
        mirrorActorToBattleActor(mirror.actor, { selection, playerRow: row }),
        mirror.pet ? mirrorActorToBattleActor(mirror.pet, { isPet: true, playerRow: row }) : null,
        mirror.mercenary ? mirrorActorToBattleActor(mirror.mercenary, { isMercenary: true, mercenaryData: mercenary || null, playerRow: row }) : null
      ].filter(Boolean)
    };
  }

  function participantsForMirror(mirror) {
    const server = objectOrEmpty(mirror?._server);
    const row = server.row || null;
    return {
      mirror,
      actors: [
        mirrorActorToBattleActor(mirror?.actor, { selection: mirror?.selection || null, playerRow: row }),
        mirror?.pet ? mirrorActorToBattleActor(mirror.pet, { isPet: true, playerRow: row }) : null,
        mirror?.mercenary ? mirrorActorToBattleActor(mirror.mercenary, { isMercenary: true, mercenaryData: server.activeMercenary || null, playerRow: row }) : null
      ].filter(Boolean)
    };
  }

  function defenseSnapshotForRow(row, clientMirror = null) {
    const mirror = deps.arenaMirrorForPlayerRow(row, clientMirror);
    mirror._server = {
      row: {
        account: row.account,
        selection_json: row.selection_json || "{}",
        equipment_json: row.equipment_json || "[]",
        equipped_json: row.equipped_json || "{}",
        auto_strategy_json: row.auto_strategy_json || "{}",
        active_mercenary_id: row.active_mercenary_id || "",
        mercenaries_json: row.mercenaries_json || "[]",
        mercenary_necklaces_json: row.mercenary_necklaces_json || "[]",
        mercenary_orbs_json: row.mercenary_orbs_json || "[]"
      },
      activeMercenary: deps.activeMercenaryForRow(row) || null
    };
    return mirror;
  }

  function publicMirror(mirror) {
    if (!mirror || typeof mirror !== "object") return mirror;
    const { _server, ...rest } = mirror;
    return rest;
  }

  function fallbackEntry(rank) {
    return {
      rank,
      account: `arena_amumu_${rank}`,
      name: `阿木木${rank}`,
      mirror: {
        actor: {
          name: `阿木木${rank}`,
          spriteId: 895,
          stats: { hp: 118000, defense: 14500, speed: 1350, attack: 18500, mana: 2600, crit: 6, critDamage: 240, skillId: "wild_amumu" }
        },
        pet: null,
        mercenary: null,
        selection: {}
      },
      isNpc: true,
      updatedAt: ""
    };
  }

  function rankRowToApi(row) {
    if (!row) return null;
    const savedMirror = deps.safeJsonObject(row.mirror_json);
    return {
      rank: row.rank,
      account: row.account,
      name: row.name,
      mirror: publicMirror(savedMirror),
      isNpc: false,
      updatedAt: row.updated_at
    };
  }

  function rankings(account = "", requestedServerId = "") {
    const serverId = requestedServerId || deps.fetchPlayerRow(account)?.server_id || "penguin_village";
    const rows = deps.selectArenaRows(serverId);
    const byRank = new Map(rows.map((row) => [row.rank, rankRowToApi(row)]));
    const myRank = account ? rows.find((row) => row.account === account)?.rank || 0 : 0;
    const allRankings = Array.from({ length: MAX_RANK }, (_, index) => byRank.get(index + 1) || fallbackEntry(index + 1));
    const challengeRankings = allRankings.filter((entry) => canChallengeRank(myRank, entry.rank));
    return {
      ok: true,
      rankings: allRankings,
      myRank,
      challengeRankings
    };
  }

  function canChallengeRank(currentRank, rank) {
    return currentRank
      ? rank >= Math.max(1, currentRank - 10) && rank < currentRank
      : rank >= 91 && rank <= MAX_RANK;
  }

  function upload(account, clientMirror = null) {
    const row = deps.fetchPlayerRow(account);
    if (!row) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = row.server_id || "penguin_village";
    const mirror = defenseSnapshotForRow(row, clientMirror);
    deps.recordMirrorAnomalies?.(account, "/api/arena/upload", clientMirror, mirror);
    const current = deps.selectArenaByAccount(account, serverId);
    let rank = current?.rank || 0;
    if (!rank) {
      for (let candidate = MAX_RANK; candidate >= 1; candidate -= 1) {
        if (!deps.selectArenaByRank(candidate, serverId)) {
          rank = candidate;
          break;
        }
      }
    }
    if (!rank) return { ok: false, status: 409, error: "arena_full" };
    deps.upsertArenaRank(rank, account, String(row.name || account).slice(0, 24), JSON.stringify(mirror), nowIso(), serverId);
    return { ok: true, rank, name: String(row.name || account).slice(0, 24), mirror: publicMirror(mirror) };
  }

  function uploadedDefenseSnapshotForAccount(account, clientMirror = null) {
    const row = deps.fetchPlayerRow(account);
    const serverId = row?.server_id || "penguin_village";
    const current = deps.selectArenaByAccount(account, serverId);
    const saved = current ? deps.safeJsonObject(current.mirror_json) : null;
    if (saved?.actor && saved?._server?.row?.auto_strategy_json) return saved;
    return row ? defenseSnapshotForRow(row, clientMirror) : null;
  }

  function createBattleSession(attacker, defender) {
    const session = { battleState: null };
    session.engine = BattleEngine.createRuntime({
      statLimits: deps.statLimits,
      skillCatalog: BattleSkills.skillCatalog,
      skillById,
      skillsForStats,
      defaultSkillIdForStats,
      sacrificeAlliesReady: (skill, actor = null) => {
        if (!Array.isArray(skill?.sacrificeAllies) || !skill.sacrificeAllies.length || !actor || !session.battleState) return true;
        const team = session.battleState.playerTeam.some((fighter) => fighter.actor === actor) ? session.battleState.playerTeam : session.battleState.enemyTeam;
        return skill.sacrificeAllies.every((kind) => team.some((fighter) => fighter.actor !== actor && fighterKind(fighter) === kind && !fighter.defeated));
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
      getPlayer: () => session.battleState?.playerTeam.find((fighter) => fighterKind(fighter) === "role")?.actor || null,
      getPet: () => session.battleState?.playerTeam.find((fighter) => fighterKind(fighter) === "pet")?.actor || null,
      snapshotBattleHp: () => snapshotBattleState(session.battleState),
      restoreBattleHp: restoreBattleState,
      autoActionForFighter: (fighter, targetTeam) => autoActionForFighter(fighter, targetTeam, session.battleState),
      fighterBattleSnapshot
    });
    session.battleState = {
      playerTeam: attacker.actors.map((actor, index) => session.engine.makeFighter(actor, "ally", index)),
      enemyTeam: defender.actors.map((actor, index) => session.engine.makeFighter(actor, "enemy", index))
    };
    return session;
  }

  function resolveServerBattle(attacker, defender) {
    const session = createBattleSession(attacker, defender);
    const rounds = [];
    let result = null;
    for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
      const allyChoice = makeAutoChoice(session.battleState.playerTeam, session.battleState.enemyTeam, session.battleState);
      const enemyChoice = makeAutoChoice(session.battleState.enemyTeam, session.battleState.playerTeam, session.battleState);
      result = session.engine.resolveBattleTurn(allyChoice, enemyChoice);
      applyTeamHp(session.battleState.playerTeam, result.hp.ally);
      applyTeamHp(session.battleState.enemyTeam, result.hp.enemy);
      rounds.push({ turn, winner: result.winner || "", done: result.done, events: result.events || [], hp: result.hp });
      if (result.done) break;
    }
    if (!result?.done) {
      const allyHp = alive(session.battleState.playerTeam).reduce((sum, fighter) => sum + Math.max(0, fighter.hp), 0);
      const enemyHp = alive(session.battleState.enemyTeam).reduce((sum, fighter) => sum + Math.max(0, fighter.hp), 0);
      result = { ...(result || {}), done: true, winner: allyHp >= enemyHp ? "ally" : "enemy" };
    }
    return { winner: result.winner, rounds, finalHp: result.hp };
  }

  function occupyRank(account, rank, mirror) {
    const row = deps.fetchPlayerRow(account);
    const serverId = row?.server_id || "penguin_village";
    const current = deps.selectArenaByAccount(account, serverId);
    const defender = deps.selectArenaByRank(rank, serverId);
    const currentRank = current?.rank || 0;
    const updatedAt = nowIso();
    if (currentRank && currentRank !== rank) {
      if (defender) deps.upsertArenaRank(currentRank, defender.account, defender.name, defender.mirror_json, updatedAt, serverId);
      else deps.deleteArenaRank(currentRank, serverId);
    }
    deps.upsertArenaRank(rank, account, String(row?.name || account).slice(0, 24), JSON.stringify(mirror), updatedAt, serverId);
    return { oldRank: currentRank, swapped: Boolean(currentRank && defender) };
  }

  function buildChallengeParts(account, rank, clientMirror = null) {
    const attackerRow = deps.fetchPlayerRow(account);
    if (!attackerRow) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = attackerRow.server_id || "penguin_village";
    rank = Math.max(1, Math.min(MAX_RANK, Number(rank) || 0));
    if (!rank) return { ok: false, status: 400, error: "invalid_rank" };
    const current = deps.selectArenaByAccount(account, serverId);
    const currentRank = current?.rank || 0;
    if (!canChallengeRank(currentRank, rank)) return { ok: false, status: 409, error: "rank_not_allowed", currentRank };

    const attacker = participantsForPlayerRow(attackerRow, clientMirror);
    deps.recordMirrorAnomalies?.(account, "/api/arena/start", clientMirror, attacker.mirror);
    const defenderRow = deps.selectArenaByRank(rank, serverId);
    const defenderEntry = defenderRow ? rankRowToApi(defenderRow) : fallbackEntry(rank);
    if (defenderEntry.account === account) return { ok: false, status: 409, error: "self_rank", currentRank };
    const savedDefenderMirror = defenderRow ? deps.safeJsonObject(defenderRow.mirror_json) : defenderEntry.mirror;
    const defender = participantsForMirror(savedDefenderMirror);
    return { ok: true, rank, currentRank, attacker, defender, defenderEntry };
  }

  function start(account, rank, clientMirror = null) {
    const parts = buildChallengeParts(account, rank, clientMirror);
    if (!parts.ok) return parts;
    const battleId = `arena_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const session = createBattleSession(parts.attacker, parts.defender);
    Object.assign(session, {
      battleId,
      account,
      rank: parts.rank,
      currentRank: parts.currentRank,
      attackerMirror: uploadedDefenseSnapshotForAccount(account, clientMirror),
      defender: parts.defenderEntry,
      createdAt: Date.now(),
      turn: 1
    });
    activeSessions.set(battleId, session);
    return {
      ok: true,
      battleId,
      rank: parts.rank,
      currentRank: parts.currentRank,
      attacker: publicMirror(parts.attacker.mirror),
      defender: { ...parts.defenderEntry, mirror: publicMirror(parts.defender.mirror) }
    };
  }

  function turn(account, battleId, choice) {
    const session = activeSessions.get(String(battleId || ""));
    if (!session || session.account !== account) return { ok: false, status: 404, error: "battle_not_found" };
    const allyChoice = sanitizeChoiceForTeam(choice || {}, session.battleState.playerTeam, session.battleState.enemyTeam, session.battleState);
    const enemyChoice = makeAutoChoice(session.battleState.enemyTeam, session.battleState.playerTeam, session.battleState);
    const result = session.engine.resolveBattleTurn(allyChoice, enemyChoice);
    applyTeamHp(session.battleState.playerTeam, result.hp.ally);
    applyTeamHp(session.battleState.enemyTeam, result.hp.enemy);
    session.turn += 1;
    let occupy = null;
    if (result.done) {
      activeSessions.delete(session.battleId);
      if (result.winner === "ally") occupy = occupyRank(account, session.rank, session.attackerMirror);
    }
    return {
      ok: true,
      result,
      rank: session.rank,
      oldRank: occupy?.oldRank || session.currentRank,
      swapped: occupy?.swapped || false,
      won: result.done ? result.winner === "ally" : false
    };
  }

  function cancel(account, battleId) {
    const session = activeSessions.get(String(battleId || ""));
    if (session?.account === account) activeSessions.delete(session.battleId);
    return { ok: true };
  }

  function claimReward(account) {
    const now = new Date();
    if (now.getHours() < 12) return { ok: false, status: 409, error: "before_settlement" };
    const key = settlementKey(now);
    const row = deps.fetchPlayerRow(account);
    if (!row) return { ok: false, status: 404, error: "player_not_found" };
    if (row.arena_reward_claimed_key === key) return { ok: false, status: 409, error: "already_claimed", key };
    const current = deps.selectArenaByAccount(account, row.server_id || "penguin_village");
    const rank = current?.rank || 0;
    const reward = rewardForRank(rank);
    if (!reward.soulPowder && !reward.immortalPill) return { ok: false, status: 409, error: "not_qualified", rank, key };
    deps.grantArenaReward(account, reward.soulPowder, reward.immortalPill, key);
    return { ok: true, key, rank, ...reward };
  }

  function challenge(account, rank, clientMirror = null) {
    const parts = buildChallengeParts(account, rank, clientMirror);
    if (!parts.ok) return parts;
    const { attacker, defender, defenderEntry, currentRank } = parts;
    const battle = resolveServerBattle(attacker, defender);
    let occupy = null;
    if (battle.winner === "ally") occupy = occupyRank(account, parts.rank, uploadedDefenseSnapshotForAccount(account, clientMirror));
    return {
      ok: true,
      rank: parts.rank,
      oldRank: occupy?.oldRank || currentRank,
      swapped: occupy?.swapped || false,
      won: battle.winner === "ally",
      winner: battle.winner,
      rounds: battle.rounds.length,
      defender: { account: defenderEntry.account, name: defenderEntry.name, isNpc: defenderEntry.isNpc === true },
      mirror: attacker.mirror
    };
  }

  return {
    rankings,
    upload,
    start,
    turn,
    cancel,
    claimReward,
    challenge,
    fallbackEntry,
    rankRowToApi
  };
}

module.exports = createArenaRuntime;
