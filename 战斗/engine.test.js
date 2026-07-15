/**
 * @file engine.test.js
 * @description 战斗引擎单元测试 - 验证战斗引擎核心逻辑的正确性
 *
 * 测试覆盖范围:
 * - 焚灵祭命(self_buff)技能的复活效果持续回合数验证
 * - 复活效果应在激活后的第 2、3 回合生效，第 4 回合失效
 *
 * 测试框架: Node.js 内置 node:test 模块
 * 运行命令: node --test 战斗/engine.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const BattleSkills = require("./skills.js");
const { createRuntime: createEngine } = require("./engine.js");

function createHarness() {
  const battle = { playerTeam: [], enemyTeam: [] };
  const playerActor = {
    name: "法师",
    spriteId: 1,
    stats: {
      hp: 1000,
      defense: 0,
      speed: 100,
      attack: 100,
      mana: 100,
      crit: 0,
      critDamage: 100,
      skillId: "role_mage_soul_burn",
      skillIds: ["role_mage_soul_burn"]
    }
  };
  const petActor = {
    name: "宠物",
    spriteId: 3,
    isPet: true,
    stats: {
      hp: 100,
      defense: 0,
      speed: 10,
      attack: 10,
      mana: 10,
      crit: 0,
      critDamage: 100,
      skillId: "pet_default",
      skillIds: ["pet_default"]
    }
  };
  const mercActor = {
    name: "佣兵",
    spriteId: 4,
    isMercenary: true,
    stats: {
      hp: 100,
      defense: 0,
      speed: 10,
      attack: 10,
      mana: 10,
      crit: 0,
      critDamage: 100,
      skillId: "merc_sword_deathblow",
      skillIds: ["merc_sword_deathblow"]
    }
  };
  const enemyActor = {
    name: "仙人",
    spriteId: 2,
    stats: {
      hp: 1000,
      defense: 0,
      speed: 1,
      attack: 5000,
      mana: 0,
      crit: 0,
      critDamage: 100,
      skillId: "immortal_hand_double",
      skillIds: ["immortal_hand_double"]
    }
  };

  const deps = {
    statsForActor: (actor) => actor.stats,
    fighterKind: (fighter) => fighter.actor.isMercenary ? "mercenary" : fighter.actor.isPet ? "pet" : "role",
    skillCatalog: BattleSkills.skillCatalog,
    skillById: (id) => BattleSkills.skillCatalog[id] || BattleSkills.skillCatalog.shining_strike,
    skillsForStats: (stats) => [...new Set(["shining_strike", ...(stats.skillIds || []), stats.skillId].filter(Boolean))],
    sacrificeAlliesReady: (skill, actor) => {
      if (!Array.isArray(skill?.sacrificeAllies) || !skill.sacrificeAllies.length || !actor) return true;
      const team = actor === playerActor || actor === petActor || actor === mercActor ? battle.playerTeam : battle.enemyTeam;
      return skill.sacrificeAllies.every((kind) => team.some((fighter) => fighter.actor !== actor && deps.fighterKind(fighter) === kind && !fighter.defeated));
    },
    statLimits: { crit: 100, critDamage: 2000 },
    fighterRef: (fighter) => fighter.battleId,
    effectIdForActor: () => 0,
    normalizeBattleStatuses: (statuses) => ({ ...statuses }),
    alive: (team) => team.filter((fighter) => !fighter.defeated),
    pickTarget: (team) => team.find((fighter) => !fighter.defeated),
    getPlayer: () => playerActor,
    getPet: () => petActor,
    getBattle: () => battle,
    getBattleTeamForActor: (actor) => (actor === playerActor || actor === petActor || actor === mercActor ? battle.playerTeam : battle.enemyTeam),
    getState: () => ({ selected: { className: "法师" }, player: playerActor }),
    defaultSkillIdForStats: (stats) => stats.skillId || "shining_strike",
    autoActionForFighter: (unit, defenders) => ({ type: "attack", target: defenders.find((fighter) => !fighter.defeated)?.battleId }),
    snapshotBattleHp: () => ({ ally: battle.playerTeam.map((fighter) => fighter.hp), enemy: battle.enemyTeam.map((fighter) => fighter.hp) }),
    restoreBattleHp: () => {},
    fighterBattleSnapshot: (fighter) => ({ name: fighter.name, hp: fighter.hp, defeated: fighter.defeated }),
    sample: (arr) => arr[0],
    critLines: ["crit"]
  };

  const engine = createEngine(deps);
  const player = engine.makeFighter(playerActor, "ally", 0);
  const pet = engine.makeFighter(petActor, "ally", 1);
  const merc = engine.makeFighter(mercActor, "ally", 2);
  const enemy = engine.makeFighter(enemyActor, "enemy", 0);
  battle.playerTeam.push(player, pet, merc);
  battle.enemyTeam.push(enemy);

  return { engine, battle, player, enemy };
}

function createSoulJudgeHarness() {
  const battle = { playerTeam: [], enemyTeam: [] };
  const playerActor = {
    name: "角色",
    spriteId: 1,
    stats: {
      hp: 1000,
      defense: 0,
      speed: 10,
      attack: 100,
      mana: 100,
      crit: 0,
      critDamage: 100,
      skillId: "shining_strike",
      skillIds: ["shining_strike"]
    }
  };
  const soulJudgeActor = {
    name: "灵魂裁判",
    spriteId: 2,
    isPet: true,
    stats: {
      hp: 1000,
      defense: 0,
      speed: 100,
      attack: 10,
      mana: 100,
      crit: 0,
      critDamage: 100,
      skillId: "pet_soul_judge_river",
      skillIds: ["pet_soul_judge_river"]
    }
  };
  const enemyActor = {
    name: "控制者",
    spriteId: 3,
    stats: {
      hp: 1000,
      defense: 0,
      speed: 50,
      attack: 10,
      mana: 10,
      crit: 0,
      critDamage: 100,
      skillId: "immortal_heart_confuse",
      skillIds: ["immortal_heart_confuse"]
    }
  };

  const deps = {
    statsForActor: (actor) => actor.stats,
    fighterKind: (fighter) => fighter.actor.isMercenary ? "mercenary" : fighter.actor.isPet ? "pet" : "role",
    skillCatalog: BattleSkills.skillCatalog,
    skillById: (id) => BattleSkills.skillCatalog[id] || BattleSkills.skillCatalog.shining_strike,
    skillsForStats: (stats) => [...new Set(["shining_strike", ...(stats.skillIds || []), stats.skillId].filter(Boolean))],
    sacrificeAlliesReady: () => true,
    statLimits: { crit: 100, critDamage: 2000 },
    fighterRef: (fighter) => fighter.battleId,
    effectIdForActor: () => 0,
    normalizeBattleStatuses: (statuses) => ({ ...statuses }),
    alive: (team) => team.filter((fighter) => !fighter.defeated),
    pickTarget: (team, target) => team.find((fighter) => fighter.battleId === target && !fighter.defeated) || team.find((fighter) => !fighter.defeated),
    getPlayer: () => playerActor,
    getPet: () => soulJudgeActor,
    getBattle: () => battle,
    getBattleTeamForActor: (actor) => (actor === playerActor || actor === soulJudgeActor ? battle.playerTeam : battle.enemyTeam),
    getState: () => ({ selected: { className: "剑士" }, player: playerActor }),
    defaultSkillIdForStats: (stats) => stats.skillId || "shining_strike",
    autoActionForFighter: (unit, defenders) => ({ type: "skill", skillId: unit.stats.skillId, target: defenders.find((fighter) => !fighter.defeated)?.battleId }),
    snapshotBattleHp: () => ({ ally: battle.playerTeam.map((fighter) => fighter.hp), enemy: battle.enemyTeam.map((fighter) => fighter.hp) }),
    restoreBattleHp: () => {},
    fighterBattleSnapshot: (fighter) => ({ name: fighter.name, hp: fighter.hp, defeated: fighter.defeated, statuses: { ...fighter.statuses } }),
    sample: (arr) => arr[0],
    critLines: ["crit"]
  };

  const engine = createEngine(deps);
  const player = engine.makeFighter(playerActor, "ally", 0);
  const soulJudge = engine.makeFighter(soulJudgeActor, "ally", 1);
  const enemy = engine.makeFighter(enemyActor, "enemy", 0);
  battle.playerTeam.push(player, soulJudge);
  battle.enemyTeam.push(enemy);

  return { engine, battle, player, soulJudge, enemy };
}

function resolveRound(engine, battle, round) {
  const allyChoice = round === 1
    ? { actor: { type: "skill", skillId: "role_mage_soul_burn", target: battle.enemyTeam[0].battleId } }
    : { actor: { type: "attack", target: battle.enemyTeam[0].battleId } };
  const enemyChoice = { actor: { type: "attack", target: battle.playerTeam[0].battleId } };
  return engine.resolveBattleTurn(allyChoice, enemyChoice);
}

test("焚灵祭命的复活应持续到第三回合结束", () => {
  const { engine, battle } = createHarness();

  const round1 = resolveRound(engine, battle, 1);
  const round2 = resolveRound(engine, battle, 2);
  const round3 = resolveRound(engine, battle, 3);
  const round4 = resolveRound(engine, battle, 4);

  const playerAfterRound3 = round3.hp.ally.find((fighter) => fighter.name === "法师");
  const playerAfterRound4 = round4.hp.ally.find((fighter) => fighter.name === "法师");
  const rebornOnRound3 = round3.events.some((event) => event.defender === "法师" && event.reborn === true);
  const rebornOnRound4 = round4.events.some((event) => event.defender === "法师" && event.reborn === true);

  assert.equal(round1.events.some((event) => event.type === "buff"), true);
  assert.equal(round2.events.some((event) => event.defender === "法师" && event.reborn === true), true);
  assert.equal(rebornOnRound3, true);
  assert.equal(playerAfterRound3.defeated, false);
  assert.equal(rebornOnRound4, false);
  assert.equal(playerAfterRound4.defeated, true);
});

test("灵魂裁判使用永恒之河后本回合自身免疫控制，队友仍为下回合免控", () => {
  const { engine, battle, player, soulJudge } = createSoulJudgeHarness();

  const result = engine.resolveBattleTurn(
    { pet: { type: "skill", skillId: "pet_soul_judge_river", target: soulJudge.battleId } },
    { actor: { type: "skill", skillId: "immortal_heart_confuse", target: soulJudge.battleId } }
  );

  const soulJudgeAfterTurn = result.hp.ally.find((fighter) => fighter.name === "灵魂裁判");
  const playerAfterTurn = result.hp.ally.find((fighter) => fighter.name === "角色");

  assert.equal(soulJudgeAfterTurn.statuses.confuse, undefined);
  assert.equal(playerAfterTurn.statuses.controlImmune, undefined);
  assert.equal(soulJudge.selfControlImmuneThisTurn, false);
  assert.equal(player.controlImmune, false);
});

test("陆行鸟连击被动在普攻后追加一发普攻", () => {
  const { engine, battle, player, enemy } = createHarness();
  player.actor.stats = {
    ...player.actor.stats,
    attack: 100,
    skillId: "pet_default",
    skillIds: ["holy_chocobo_combo"]
  };
  player.stats = player.actor.stats;
  enemy.actor.stats = {
    ...enemy.actor.stats,
    hp: 1000,
    attack: 1,
    speed: 1,
    skillId: "shining_strike",
    skillIds: ["shining_strike"],
    forceBasicAttack: true
  };
  enemy.stats = enemy.actor.stats;

  const result = engine.resolveBattleTurn(
    { actor: { type: "attack", target: enemy.battleId } },
    { actor: { type: "attack", target: player.battleId } }
  );

  const playerDamageEvents = result.events.filter((event) => event.attacker === "法师" && event.defender === "仙人" && event.type === "damage");
  assert.equal(playerDamageEvents.length, 2);
});
