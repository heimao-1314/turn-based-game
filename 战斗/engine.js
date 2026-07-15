/**
 * @file engine.js
 * @description 战斗引擎核心 - 实现回合制战斗的完整计算逻辑
 *
 * 本模块是整个战斗系统的核心引擎，负责：
 * - 战斗单位(fighter)的创建与属性计算
 * - 伤害计算公式（含攻击力、法力、速度、防御、暴击等多维度）
 * - 技能效果的施放与目标选择
 * - 状态效果（控制、增益、减益、流血、诅咒）的施加与结算
 * - 被动技能（闪避、连击、反噬、涅磐、破甲、吸血等）的处理
 * - 回合制战斗的完整回合结算流程
 *
 * 伤害计算公式:
 *   raw = hpDamage + attack*attackScale + mana*manaScale + defense*defenseScale + speed*speedScale
 *   effectiveDefense = defense * (1 - pierce)
 *   damageReduction = min(0.9, effectiveDefense/(effectiveDefense+100000) - damageReductionDown)
 *   final = max(1, raw * (1 - damageReduction) * (1 - guardReduction)) * critMultiplier
 *
 * @module BattleEngine
 */
((global, factory) => {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.BattleEngine = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function createRuntime(deps) {
    /**
     * 创建战斗单位(fighter)
     * 将角色/宠物/佣兵的运行时数据转换为战斗引擎可处理的战斗单位对象。
     *
     * @param {Object} actor - 角色对象（包含 name, spriteId, stats 等属性）
     * @param {string} side - 所属阵营 ("ally" | "enemy")
     * @param {number} index - 在队伍中的位置索引
     * @returns {Object} 战斗单位对象，包含 battleId、属性、状态等完整战斗数据
     */
    function makeFighter(actor, side, index = 0) {
      const stats = deps.statsForActor(actor);
      const role = actor.isPet ? "pet" : actor.isMercenary ? "mercenary" : "actor";
      return {
        battleId: `${side}-${index}-${role}-${actor.spriteId}`,
        name: actor.name,
        side,
        actor,
        stats,
        hp: stats.hp,
        maxHp: stats.hp,
        defeated: false,
        statuses: {},
        buffs: {},
        damageReductionDown: 0,
        defenseCleared: false,
        actionUntil: 0,
        action: "idle",
        battleX: 0,
        battleY: 0,
        attackTargetId: "",
        attackTargetName: "",
        passiveRebirthChance: stats.passiveRebirthChance || 0,
        passiveRebirthOnce: stats.passiveRebirthOnce === true,
        passiveCounter: stats.passiveCounter === true,
        passiveLifesteal: stats.passiveLifesteal || 0,
        passiveBreakArmor: stats.passiveBreakArmor === true,
        reflectDamageRate: stats.reflectDamageRate || 0,
        passiveDeathGrit: stats.passiveDeathGrit || null,
        controlImmune: stats.controlImmune === true,
        periodicSkillId: stats.periodicSkillId || "",
        periodicEvery: stats.periodicEvery || 0
      };
    }

    /**
     * 计算战斗单位的有效属性值
     * 有效值 = (基础属性 + buff 加成) * 属性倍率
     *
     * @param {Object} fighter - 战斗单位
     * @param {string} stat - 属性名称 ("attack" | "defense" | "speed" | "mana" | "crit" | "critDamage")
     * @returns {number} 计算后的有效属性值（四舍五入取整）
     */
    function effectiveStat(fighter, stat) {
      const multiplier = fighter.statMultipliers?.[stat] || fighter.statMultiplier || 1;
      return Math.round(((fighter.stats[stat] || 0) + (fighter.buffs?.[stat] || 0)) * multiplier);
    }

    function guardReductionFor(attacker, defender) {
      if (defender.defeated) return 0;
      const attackerKind = deps.fighterKind(attacker);
      const reductions = [];
      if (attackerKind === "role") reductions.push(defender.passiveGuardRole || 0);
      if (attackerKind === "pet") reductions.push(defender.passiveGuardPet || 0);
      if (attackerKind === "mercenary") reductions.push(defender.passiveGuardMercenary || 0);
      reductions.push(defender.selfGuardReduction || 0);
      return Math.max(0, ...reductions);
    }

    function passiveRebirthBaselineFor(fighter) {
      let chance = 0;
      for (const skillId of deps.skillsForStats(fighter.stats)) {
        const skill = deps.skillCatalog[skillId];
        if (!skill || skill.type !== "passive" || !skill.passiveRebirthChance) continue;
        chance = Math.max(chance, skill.passiveRebirthChance);
      }
      return chance;
    }

    /**
     * 计算攻击伤害
     * 综合考虑攻击力、法力、速度、防御、穿甲、暴击等多维度因素。
     *
     * 伤害公式:
     *   raw = hpDamage + attack*attackScale + mana*manaScale + defense*defenseScale + speed*speedScale
     *   effectiveDefense = defense * (1 - pierce)
     *   damageReduction = min(0.9, effectiveDefense/(effectiveDefense+100000) - damageReductionDown)
     *   final = max(1, raw * (1 - damageReduction) * (1 - guardReduction)) * critMultiplier
     *
     * @param {Object} attacker - 攻击方战斗单位
     * @param {Object} defender - 防御方战斗单位
     * @param {boolean} useSkill - 是否使用技能（否则为普通攻击）
     * @param {string} skillId - 技能 ID（useSkill 为 true 时必填）
     * @returns {{ amount: number, critical: boolean }} 伤害值与是否暴击
     */
    function calcDamage(attacker, defender, useSkill, skillId = "") {
      const skill = useSkill ? deps.skillById(skillId || attacker.stats.skillId) : null;
      if (skill?.fixedDamage) {
        return { amount: Math.max(1, Math.round(skill.fixedDamage)), critical: false };
      }
      const attackScale = useSkill ? skill.attackScale || 0 : 1;
      const manaScale = useSkill ? skill.manaScale || 0 : 0.35;
      const defenseScale = useSkill ? skill.defenseScale || 0 : 0;
      const speedScale = useSkill ? skill.speedScale || 0 : 0;
      const hpDamage = useSkill && skill?.hpDamageRate ? defender.hp * skill.hpDamageRate : 0;
      const raw = hpDamage
        + effectiveStat(attacker, "attack") * attackScale
        + effectiveStat(attacker, "mana") * manaScale
        + effectiveStat(attacker, "defense") * defenseScale
        + effectiveStat(attacker, "speed") * speedScale;      // 穿甲计算: pierce 百分比减少防御效果
      const pierce = useSkill ? skill.pierce || 0 : 0;
      const defenseBase = defender.defenseCleared ? 0 : effectiveStat(defender, "defense");
      const effectiveDefense = skill?.ignoreDefense ? 0 : defenseBase * (1 - pierce);      // 防御减伤公式: 使用双曲线函数，防御越高减伤越接近 90% 上限
      // 公式: reduction = defense / (defense + 100000)
      const baseReduction = Math.min(0.9, effectiveDefense / (effectiveDefense + 100000));
      const damageReduction = Math.max(0, Math.min(0.9, baseReduction - (defender.damageReductionDown || 0)));      // 守护减伤: 圣品守护技能提供的额外减伤（最高 75%）
      const guardReduction = guardReductionFor(attacker, defender);
      const boostedRaw = useSkill && skill?.skillDamageMultiplier ? raw * skill.skillDamageMultiplier : raw;
      const reduced = Math.max(1, boostedRaw * (1 - damageReduction) * (1 - guardReduction));
      const canCrit = !skill || skill.canCrit !== false;
      const critical = canCrit && Math.random() * 100 < Math.min(deps.statLimits.crit, effectiveStat(attacker, "crit") + (useSkill ? skill.critBonus || 0 : 0));
      const critDamage = Math.min(deps.statLimits.critDamage, effectiveStat(attacker, "critDamage") + (useSkill ? skill.critDamageBonus || 0 : 0));
      const critMul = critical ? critDamage / 100 : 1;
      return { amount: Math.max(1, Math.round(reduced * critMul)), critical };
    }

    function damageEvent(attacker, defender, amount, critical, type = "damage", useSkill = false) {
      const hpBefore = defender.hp;
      defender.hp = Math.max(0, defender.hp - amount);
      if (defender.hp <= 0) defender.defeated = true;
      const grit = defender.defeated
        && defender.passiveDeathGrit
        && hpBefore / Math.max(1, defender.maxHp) >= (defender.passiveDeathGrit.threshold || 0.5);
      if (grit) {
        defender.hp = 1;
        defender.defeated = false;
      }
      const reborn = !grit && defender.defeated
        && defender.passiveRebirthChance
        && (!defender.passiveRebirthOnce || !defender.passiveRebirthUsed)
        && Math.random() < defender.passiveRebirthChance;
      if (reborn) {
        defender.hp = Math.max(1, Math.round(defender.maxHp * 0.5));
        defender.defeated = false;
        if (defender.passiveRebirthOnce) defender.passiveRebirthUsed = true;
      }
      return {
        attacker: attacker.name,
        attackerId: deps.fighterRef(attacker),
        defender: defender.name,
        defenderId: deps.fighterRef(defender),
        amount,
        critical,
        hp: defender.hp,
        defeated: defender.defeated,
        reborn,
        grit,
        statuses: deps.normalizeBattleStatuses(defender.statuses),
        defenseCleared: defender.defenseCleared === true,
        damageReductionDown: defender.damageReductionDown || 0,
        buffs: { ...(defender.buffs || {}) },
        passiveRebirthUsed: defender.passiveRebirthUsed === true,
        passiveRebirthOnce: defender.passiveRebirthOnce === true,
        type,
        effectId: deps.effectIdForActor(attacker.actor, useSkill)
      };
    }

    function markAreaEvent(event, batchId, index) {
      event.areaBatchId = batchId;
      event.areaIndex = index;
      return event;
    }

    function healEvent(attacker, target, amount, revive = true) {
      if (target.defeated && !revive) return null;
      const blocked = Boolean(target.statuses?.noHeal);
      if (!blocked) target.hp = Math.min(target.maxHp, target.hp + amount);
      if (target.hp > 0) target.defeated = false;
      return {
        attacker: attacker.name,
        attackerId: deps.fighterRef(attacker),
        defender: target.name,
        defenderId: deps.fighterRef(target),
        amount: blocked ? 0 : amount,
        critical: false,
        hp: target.hp,
        defeated: target.defeated,
        reborn: false,
        statuses: deps.normalizeBattleStatuses(target.statuses),
        defenseCleared: target.defenseCleared === true,
        damageReductionDown: target.damageReductionDown || 0,
        buffs: { ...(target.buffs || {}) },
        controlImmune: target.controlImmune === true,
        type: "heal",
        effectId: deps.effectIdForActor(attacker.actor, true)
      };
    }

    function basicAttackFollowup(attacker, defender, type = "damage", useSkill = false) {
      const result = calcDamage(attacker, defender, false, "");
      return damageEvent(attacker, defender, result.amount, result.critical, type, useSkill);
    }

    function lifestealEvent(attacker, damageAmount) {
      if (!attacker.passiveLifesteal || attacker.defeated || damageAmount <= 0) return null;
      const amount = Math.max(1, Math.round(damageAmount * attacker.passiveLifesteal));
      const event = healEvent(attacker, attacker, amount, false);
      if (event) {
        event.type = "lifesteal";
        event.effectId = 0;
      }
      return event;
    }

    function battleSpeechEvent(speaker, text, duration = 2600) {
      return {
        attacker: speaker.name,
        attackerId: deps.fighterRef(speaker),
        defender: speaker.name,
        defenderId: deps.fighterRef(speaker),
        amount: 0,
        critical: false,
        hp: speaker.hp,
        defeated: speaker.defeated,
        type: "speech",
        text,
        duration
      };
    }

    function skillCastEvent(attacker, skill) {
      return {
        attacker: attacker.name,
        attackerId: deps.fighterRef(attacker),
        defender: attacker.name,
        defenderId: deps.fighterRef(attacker),
        amount: 0,
        critical: false,
        hp: attacker.hp,
        defeated: attacker.defeated,
        type: "skillName",
        skillName: skill?.name || "",
        skillColor: skill?.color || ""
      };
    }

    function selectSkillTargets(defenderTeam, targetName, skill) {
      const candidates = deps.alive(defenderTeam);
      if (skill.targetRule === "all") return candidates;
      if (skill.targetCount && skill.targetCount > 1) {
        const first = deps.pickTarget(defenderTeam, targetName);
        return [first, ...candidates.filter((item) => item !== first)].filter(Boolean).slice(0, skill.targetCount);
      }
      return [deps.pickTarget(defenderTeam, targetName)].filter(Boolean);
    }

    function isControlImmune(fighter) {
      return fighter.controlImmune === true || fighter.selfControlImmuneThisTurn === true;
    }

    function applySkillStatus(skill, attacker, defender) {
      if (isControlImmune(defender)) return;
      if (skill.confuseChance && Math.random() < skill.confuseChance) defender.statuses.confuse = Math.max(defender.statuses.confuse || 0, skill.confuseTurns || 1);
      if (skill.bindChance && Math.random() < skill.bindChance) defender.statuses.bind = Math.max(defender.statuses.bind || 0, skill.bindTurns || 1);
      if (skill.paralyzeChance && Math.random() < skill.paralyzeChance) defender.statuses.paralyze = Math.max(defender.statuses.paralyze || 0, skill.paralyzeTurns || 1);
      if (skill.sealChance && Math.random() < skill.sealChance) defender.statuses.seal = Math.max(defender.statuses.seal || 0, skill.sealTurns || 2);
      if (skill.sleepChance && Math.random() < skill.sleepChance) defender.statuses.sleep = Math.max(defender.statuses.sleep || 0, skill.sleepTurns || 1);
      if (skill.stunChance && Math.random() < skill.stunChance) defender.statuses.stun = Math.max(defender.statuses.stun || 0, skill.stunTurns || 1);
      if (skill.curseChance && Math.random() < skill.curseChance) {
        defender.statuses.curse = {
          turns: skill.curseTurns || 1,
          amount: Math.max(1, Math.round(effectiveStat(attacker, "mana") * (skill.curseManaScale || 0.75)))
        };
      }
      if (skill.severeBleedChance && Math.random() < skill.severeBleedChance) {
        defender.statuses.bleed = {
          turns: skill.severeBleedTurns || 1,
          amount: skill.severeBleedAmount || 1
        };
      }
      if (skill.damageReductionDown) {
        defender.damageReductionDown = Math.max(defender.damageReductionDown || 0, skill.damageReductionDown);
        defender.statuses.vulnerable = Math.max(defender.statuses.vulnerable || 0, skill.debuffTurns || 1);
      }
      if (skill.speedDownRate) {
        defender.statMultipliers = { ...(defender.statMultipliers || {}), speed: Math.min(defender.statMultipliers?.speed || 1, Math.max(0.1, 1 - skill.speedDownRate)) };
        defender.statuses.slow = Math.max(defender.statuses.slow || 0, skill.debuffTurns || 1);
      }
      if (skill.bleed) {
        defender.statuses.bleed = {
          turns: skill.bleed.turns || 1,
          amount: Math.max(1, Math.round(effectiveStat(attacker, skill.bleed.stat || "mana") * (skill.bleed.scale || 1)))
        };
      }
      if (skill.noHealChance && Math.random() < skill.noHealChance) {
        defender.statuses.noHeal = Math.max(defender.statuses.noHeal || 0, skill.noHealTurns || 1);
      }
    }

    function applySelfBattleSkill(attacker, allyTeam, skill) {
      if (skill.maxHpMultiplier && !attacker.maxHpBoostApplied) {
        const oldMax = attacker.maxHp;
        attacker.maxHp = Math.max(attacker.maxHp, Math.round(attacker.stats.hp * skill.maxHpMultiplier));
        attacker.hp += Math.max(0, attacker.maxHp - oldMax);
        attacker.maxHpBoostApplied = true;
      }
      if (skill.guardReduction) attacker.selfGuardReduction = Math.max(attacker.selfGuardReduction || 0, skill.guardReduction);
      if (skill.passiveLifesteal) attacker.passiveLifesteal = Math.max(attacker.passiveLifesteal || 0, skill.passiveLifesteal);
      if (skill.controlImmune) {
        attacker.controlImmune = true;
        ["confuse", "bind", "paralyze", "seal", "sleep", "stun"].forEach((key) => delete attacker.statuses[key]);
      }
      if (skill.allStatMultiplier) attacker.statMultiplier = Math.max(attacker.statMultiplier || 1, skill.allStatMultiplier);
      if (skill.passiveRebirthChance) attacker.passiveRebirthChance = Math.max(attacker.passiveRebirthChance || 0, skill.passiveRebirthChance);
      if (skill.buffTurns) attacker.statuses.peerlessBuff = Math.max(attacker.statuses.peerlessBuff || 0, skill.buffTurns);
      if (Array.isArray(skill.sacrificeAllies)) {
        allyTeam.forEach((fighter) => {
          const kind = deps.fighterKind(fighter);
          if (fighter !== attacker && skill.sacrificeAllies.includes(kind) && !fighter.defeated) {
            fighter.hp = 0;
            fighter.defeated = true;
          }
        });
      }
    }

    function fighterAction(attacker, defenderTeam, action = {}, allyTeam = []) {
      action = action && typeof action === "object" ? action : {};
      let useSkill = action.type === "skill" && !attacker.statuses.seal;
      let skillId = useSkill ? (action.skillId || deps.defaultSkillIdForStats(attacker.stats)) : "";
      let skill = useSkill ? deps.skillById(skillId) : null;
      if (useSkill && !deps.sacrificeAlliesReady(skill, attacker.actor)) {
        useSkill = false;
        skillId = "";
        skill = null;
      }
      if (skill?.type === "passive") {
        useSkill = false;
        skillId = "";
        skill = null;
      }
      const events = [];
      if (useSkill && skill) events.push(skillCastEvent(attacker, skill));
      if (skill?.type === "self_buff") {
        applySelfBattleSkill(attacker, allyTeam, skill);
        events.push({
          attacker: attacker.name,
          attackerId: deps.fighterRef(attacker),
          defender: attacker.name,
          defenderId: deps.fighterRef(attacker),
          amount: 0,
          critical: false,
          hp: attacker.hp,
          defeated: false,
          statuses: deps.normalizeBattleStatuses(attacker.statuses),
          defenseCleared: attacker.defenseCleared === true,
          damageReductionDown: attacker.damageReductionDown || 0,
          buffs: { ...(attacker.buffs || {}) },
          maxHp: attacker.maxHp,
          selfGuardReduction: attacker.selfGuardReduction || 0,
          controlImmune: attacker.controlImmune === true,
          statMultiplier: attacker.statMultiplier || 1,
          statMultipliers: { ...(attacker.statMultipliers || {}) },
          passiveRebirthChance: attacker.passiveRebirthChance || 0,
          passiveLifesteal: attacker.passiveLifesteal || 0,
          type: "buff",
          effectId: deps.effectIdForActor(attacker.actor, true)
        });
        return events;
      }
      if (skill?.type === "heal") {
        const targets = allyTeam.filter((fighter) => skill.targetDefeated || skill.revive !== false || !fighter.defeated);
        const areaBatchId = targets.length > 1 ? `${attacker.name}-${Date.now()}-${Math.random().toString(16).slice(2)}` : "";
        if (skill.selfControlImmuneThisTurn) attacker.selfControlImmuneThisTurn = true;
        targets.forEach((target, targetIndex) => {
          const amount = Math.round(target.maxHp * (skill.teamHealRate || 0) + effectiveStat(attacker, "mana") * (skill.teamHealManaScale || 0));
          if (skill.cleanse) target.statuses = {};
          if (skill.cleanseControls) ["confuse", "bind", "paralyze", "seal", "sleep", "stun"].forEach((key) => delete target.statuses[key]);
          if (skill.controlImmuneTurns) {
            target.controlImmune = true;
            target.statuses.controlImmune = Math.max(target.statuses.controlImmune || 0, skill.controlImmuneTurns);
          }
          target.damageReductionDown = 0;
          const event = healEvent(attacker, target, amount, skill.revive !== false);
          if (event) events.push(markAreaEvent(event, areaBatchId, targetIndex));
        });
        return events;
      }
      if (skill?.type === "buff") {
        allyTeam.filter((fighter) => !fighter.defeated).forEach((target) => {
          target.buffs.crit = Math.max(target.buffs.crit || 0, skill.teamCritBonus || 0);
          target.statuses.critBuff = Math.max(target.statuses.critBuff || 0, skill.buffTurns || 1);
        });
        events.push({
          attacker: attacker.name,
          attackerId: deps.fighterRef(attacker),
          defender: attacker.name,
          defenderId: deps.fighterRef(attacker),
          amount: 0,
          critical: false,
          hp: attacker.hp,
          defeated: false,
          statuses: deps.normalizeBattleStatuses(attacker.statuses),
          defenseCleared: attacker.defenseCleared === true,
          damageReductionDown: attacker.damageReductionDown || 0,
          buffs: { ...(attacker.buffs || {}) },
          type: "buff",
          effectId: deps.effectIdForActor(attacker.actor, true)
        });
        return events;
      }
      if (skill?.sacrificeHpRate) {
        const cost = Math.round(attacker.maxHp * skill.sacrificeHpRate);
        if (attacker.hp <= cost) return events;
        events.push(damageEvent(attacker, attacker, cost, false, "sacrifice", true));
      }
      const targets = selectSkillTargets(defenderTeam, action.target, skill || {});
      const areaBatchId = skill?.targetRule === "all" && targets.length > 1 ? `${attacker.name}-${Date.now()}-${Math.random().toString(16).slice(2)}` : "";
      for (const [targetIndex, defender] of targets.entries()) {
        if (defender.statuses.dodge && Math.random() < defender.statuses.dodge) {
          events.push(markAreaEvent({
            attacker: attacker.name,
            attackerId: deps.fighterRef(attacker),
            defender: defender.name,
            defenderId: deps.fighterRef(defender),
            amount: 0,
            critical: false,
            hp: defender.hp,
            defeated: defender.defeated,
            statuses: deps.normalizeBattleStatuses(defender.statuses),
            defenseCleared: defender.defenseCleared === true,
            damageReductionDown: defender.damageReductionDown || 0,
            buffs: { ...(defender.buffs || {}) },
            type: "miss",
            effectId: deps.effectIdForActor(attacker.actor, useSkill)
          }, areaBatchId, targetIndex));
          continue;
        }
        if (skill?.type === "special" && !skill.attackScale && !skill.manaScale && !skill.speedScale && !skill.defenseScale) {
          applySkillStatus(skill, attacker, defender);
          events.push(markAreaEvent({
            attacker: attacker.name,
            attackerId: deps.fighterRef(attacker),
            defender: defender.name,
            defenderId: deps.fighterRef(defender),
            amount: 0,
            critical: false,
            hp: defender.hp,
            defeated: defender.defeated,
            statuses: deps.normalizeBattleStatuses(defender.statuses),
            defenseCleared: defender.defenseCleared === true,
            damageReductionDown: defender.damageReductionDown || 0,
            buffs: { ...(defender.buffs || {}) },
            type: "status",
            effectId: deps.effectIdForActor(attacker.actor, true)
          }, areaBatchId, targetIndex));
          continue;
        }
        const result = calcDamage(attacker, defender, useSkill, skillId);
        const event = markAreaEvent(damageEvent(attacker, defender, result.amount, result.critical, "damage", useSkill), areaBatchId, targetIndex);
        if (attacker.passiveBreakArmor) {
          defender.defenseCleared = true;
          defender.statuses.armorBreak = Math.max(defender.statuses.armorBreak || 0, 2);
        }
        if (result.critical && (attacker.side === "ally" || attacker.actor === deps.getPlayer() || attacker.actor === deps.getPet())) {
          events.push(battleSpeechEvent(attacker, deps.sample(deps.critLines), 1800));
        }
        if (skill) applySkillStatus(skill, attacker, defender);
        if (skill?.speedBuffPerHit && result.amount > 0) {
          attacker.buffs.speed = (attacker.buffs.speed || 0) + Math.round(attacker.stats.speed * skill.speedBuffPerHit);
          attacker.statuses.speedBuff = Math.max(attacker.statuses.speedBuff || 0, skill.buffTurns || 1);
        }
        if (skill?.selfSpeedBuffFlat && result.amount > 0) {
          attacker.buffs.speed = (attacker.buffs.speed || 0) + Math.round(skill.selfSpeedBuffFlat);
          attacker.statuses.speedBuff = Math.max(attacker.statuses.speedBuff || 0, skill.buffTurns || 1);
        }
        event.statuses = deps.normalizeBattleStatuses(defender.statuses);
        event.defenseCleared = defender.defenseCleared === true;
        event.damageReductionDown = defender.damageReductionDown || 0;
        event.buffs = { ...(defender.buffs || {}) };
        events.push(event);
        const steal = lifestealEvent(attacker, result.amount);
        if (steal) events.push(steal);
        if (defender.reflectDamageRate && result.amount > 0 && !defender.defeated && !attacker.defeated) {
          const reflect = damageEvent(defender, attacker, Math.max(1, Math.round(result.amount * defender.reflectDamageRate)), false, "reflect", false);
          events.push(reflect);
        }
        if ((useSkill ? attacker.passiveCombo : attacker.passiveComboBasic) && !defender.defeated) {
          const combo = markAreaEvent(basicAttackFollowup(attacker, defender, "damage", false), areaBatchId, targetIndex + 0.2);
          events.push(combo);
          const comboSteal = lifestealEvent(attacker, combo.amount);
          if (comboSteal) events.push(comboSteal);
        }
        if (defender.passiveCounter && !defender.defeated && !attacker.defeated) {
          const counter = damageEvent(defender, attacker, calcDamage(defender, attacker, false, "").amount, false, "damage", false);
          events.push(counter);
          const counterSteal = lifestealEvent(defender, counter.amount);
          if (counterSteal) events.push(counterSteal);
        }
      }
      return events;
    }

    function applySelfShield(fighter, action) {
      if (action?.type !== "skill") return;
      const skill = deps.skillCatalog[fighter.stats.skillId];
      if (!skill?.selfShield) return;
      const heal = Math.round(fighter.maxHp * skill.selfShield);
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + heal);
    }

    function choiceActionForUnit(choice, unit, isAlly) {
      if (!choice || !unit) return null;
      const ref = deps.fighterRef(unit);
      if (choice.actions && typeof choice.actions === "object") {
        return choice.actions[ref] || choice.actions[unit.name] || null;
      }
      if (unit.actor.isMercenary) return choice.mercenary || null;
      if (unit.actor.isPet) return choice.pet || null;
      if (isAlly && unit.actor !== deps.getPlayer()) return null;
      return choice.actor || null;
    }

    function applyBattlePassives(team) {
      team.forEach((fighter) => {
        for (const skillId of deps.skillsForStats(fighter.stats)) {
          const skill = deps.skillCatalog[skillId];
          if (!skill || skill.type !== "passive") continue;
          if (skill.passiveDodge) fighter.statuses.dodge = skill.passiveDodge;
          if (skill.passiveCombo) fighter.passiveCombo = true;
          if (skill.passiveComboBasic) fighter.passiveComboBasic = true;
          if (skill.passiveCounter) fighter.passiveCounter = true;
          if (skill.passiveRebirthChance) fighter.passiveRebirthChance = Math.max(fighter.passiveRebirthChance || 0, skill.passiveRebirthChance);
          if (skill.passiveBreakArmor || skill.passiveClearDefense) fighter.passiveBreakArmor = true;
          if (skill.passiveLifesteal) fighter.passiveLifesteal = Math.max(fighter.passiveLifesteal || 0, skill.passiveLifesteal);
          if (skill.reflectDamageRate) fighter.reflectDamageRate = Math.max(fighter.reflectDamageRate || 0, skill.reflectDamageRate);
          if (skill.passiveDeathGrit) fighter.passiveDeathGrit = fighter.passiveDeathGrit || skill.passiveDeathGrit;
          if (skill.passiveGuardRole) fighter.passiveGuardRole = Math.max(fighter.passiveGuardRole || 0, skill.guardReduction || 0.75);
          if (skill.passiveGuardPet) fighter.passiveGuardPet = Math.max(fighter.passiveGuardPet || 0, skill.guardReduction || 0.75);
          if (skill.passiveGuardMercenary) fighter.passiveGuardMercenary = Math.max(fighter.passiveGuardMercenary || 0, skill.guardReduction || 0.75);
        }
      });
    }

    function tickDownStatuses(fighter, includeBleed = false, options = {}) {
      const includePeerlessBuff = options.includePeerlessBuff !== false;
      const timedStatuses = ["confuse", "bind", "seal", "sleep", "stun", "paralyze", "vulnerable", "critBuff", "armorBreak", "slow", "speedBuff", "controlImmune", "noHeal"];
      if (includePeerlessBuff) timedStatuses.push("peerlessBuff");
      timedStatuses.forEach((key) => {
        if (!fighter.statuses[key]) return;
        fighter.statuses[key] -= 1;
        if (fighter.statuses[key] <= 0) {
          delete fighter.statuses[key];
          if (key === "vulnerable") fighter.damageReductionDown = 0;
          if (key === "critBuff") fighter.buffs.crit = 0;
          if (key === "armorBreak") fighter.defenseCleared = false;
          if (key === "slow" && fighter.statMultipliers) delete fighter.statMultipliers.speed;
          if (key === "speedBuff") fighter.buffs.speed = 0;
          if (key === "controlImmune") fighter.controlImmune = false;
          if (key === "peerlessBuff") {
            fighter.controlImmune = false;
            fighter.statMultiplier = 1;
            fighter.passiveRebirthChance = passiveRebirthBaselineFor(fighter);
          }
        }
      });
      if (includeBleed && fighter.statuses.bleed) {
        fighter.statuses.bleed.turns -= 1;
        if (fighter.statuses.bleed.turns <= 0) delete fighter.statuses.bleed;
      }
      if (includeBleed && fighter.statuses.curse) {
        fighter.statuses.curse.turns -= 1;
        if (fighter.statuses.curse.turns <= 0) delete fighter.statuses.curse;
      }
    }

    function bleedEvent(fighter) {
      if (!fighter.statuses.bleed?.turns || fighter.defeated) return null;
      const amount = fighter.statuses.bleed.amount || 1;
      return damageEvent({ name: "流血", actor: fighter.actor, stats: fighter.stats }, fighter, amount, false, "bleed", false);
    }

    function curseEvent(fighter) {
      if (!fighter.statuses.curse?.turns || fighter.defeated) return null;
      const amount = fighter.statuses.curse.amount || 1;
      return damageEvent({ name: "诅咒", actor: fighter.actor, stats: fighter.stats }, fighter, amount, false, "curse", false);
    }

    function resolveEndOfRoundDamageStatuses() {
      const battle = deps.getBattle();
      const events = [];
      for (const fighter of [...battle.playerTeam, ...battle.enemyTeam]) {
        const bleed = bleedEvent(fighter);
        if (bleed) events.push(bleed);
        const curse = curseEvent(fighter);
        if (curse) events.push(curse);
        if (fighter.statuses.bleed) {
          fighter.statuses.bleed.turns -= 1;
          if (fighter.statuses.bleed.turns <= 0) delete fighter.statuses.bleed;
        }
        if (fighter.statuses.curse) {
          fighter.statuses.curse.turns -= 1;
          if (fighter.statuses.curse.turns <= 0) delete fighter.statuses.curse;
        }
      }
      return events;
    }

    /**
     * 结算一个完整的战斗回合
     * 这是战斗引擎的核心函数，执行以下流程：
     * 1. 应用双方被动技能
     * 2. 按速度排序所有存活单位（速度相同时随机打乱）
     * 3. 依次执行每个单位的行动（跳过被控制的单位）
     * 4. 结算回合末的状态伤害（流血、诅咒）
     * 5. 递减所有状态的持续回合数
     * 6. 判断战斗是否结束
     *
     * @param {Object} allyChoice - 己方玩家的行动选择
     * @param {Object} enemyChoice - 敌方的行动选择
     * @returns {{ events: Array, hp: Object, done: boolean, winner: string }}
     *   - events: 本回合所有战斗事件（伤害、治疗、状态变化等）
     *   - hp: 双方队伍的最终血量快照
     *   - done: 战斗是否结束
     *   - winner: 胜利方 ("ally" | "enemy" | "")
     */
    function resolveBattleTurn(allyChoice, enemyChoice) {
      const battle = deps.getBattle();
      const events = [];
      const before = deps.snapshotBattleHp();
      applyBattlePassives(battle.playerTeam);
      applyBattlePassives(battle.enemyTeam);      // 速度相同时使用随机数打破平局，确保公平性
      const speedTieBreakers = new Map();
      for (const unit of [...deps.alive(battle.playerTeam), ...deps.alive(battle.enemyTeam)]) {
        speedTieBreakers.set(unit, Math.random());
      }
      const units = [...deps.alive(battle.playerTeam), ...deps.alive(battle.enemyTeam)].sort((a, b) => {
        const speedDiff = effectiveStat(b, "speed") - effectiveStat(a, "speed");
        if (speedDiff) return speedDiff;
        return (speedTieBreakers.get(b) || 0) - (speedTieBreakers.get(a) || 0);
      });
      for (const unit of units) {
        if (!deps.alive(battle.playerTeam).length || !deps.alive(battle.enemyTeam).length) break;
        if (unit.defeated || unit.statuses.bind || unit.statuses.sleep || unit.statuses.stun || unit.statuses.paralyze) {
          tickDownStatuses(unit, false, { includePeerlessBuff: false });
          continue;
        }
        const isAlly = unit.side === "ally";
        const defenderTeam = isAlly ? battle.enemyTeam : battle.playerTeam;
        const allyTeam = isAlly ? battle.playerTeam : battle.enemyTeam;
        const choice = isAlly ? allyChoice : enemyChoice;
        let action = choiceActionForUnit(choice, unit, isAlly);
        if (isAlly && unit.actor !== deps.getPlayer() && unit.actor !== deps.getPet() && !action) action = deps.autoActionForFighter(unit, defenderTeam);
        if (!isAlly && !action) action = deps.autoActionForFighter(unit, defenderTeam);      // 混乱状态: 随机攻击任意存活单位（包括队友）
        if (!isAlly && unit.periodicSkillId && unit.periodicEvery && battle.turnIndex % unit.periodicEvery === 0) {
          action = { type: "skill", skillId: unit.periodicSkillId };
        }
      if (unit.statuses.confuse) {
          const allTargets = [...deps.alive(battle.playerTeam), ...deps.alive(battle.enemyTeam)].filter((fighter) => fighter !== unit);
          action = { type: "attack", target: deps.fighterRef(allTargets[Math.floor(Math.random() * allTargets.length)]) || action?.target };
        }
        applySelfShield(unit, action);
        const actualDefenderTeam = unit.statuses.confuse ? [...battle.playerTeam, ...battle.enemyTeam].filter((fighter) => fighter !== unit) : defenderTeam;
        const actionEvents = fighterAction(unit, actualDefenderTeam, action, allyTeam);
        if (actionEvents?.length) events.push(...actionEvents);
        tickDownStatuses(unit, false, { includePeerlessBuff: false });
      }
      const bleedEvents = resolveEndOfRoundDamageStatuses();
      if (bleedEvents.length) events.push({ type: "bleedBatch", events: bleedEvents });
      for (const fighter of [...battle.playerTeam, ...battle.enemyTeam]) {
        tickDownStatuses(fighter, false, { includePeerlessBuff: true });
        fighter.selfControlImmuneThisTurn = false;
      }
      const playerAlive = deps.alive(battle.playerTeam).length > 0;
      const enemyAlive = deps.alive(battle.enemyTeam).length > 0;
      const finalHp = {
        ally: battle.playerTeam.map(deps.fighterBattleSnapshot),
        enemy: battle.enemyTeam.map(deps.fighterBattleSnapshot)
      };
      deps.restoreBattleHp(before);
      return {
        events,
        hp: finalHp,
        done: !playerAlive || !enemyAlive,
        winner: playerAlive && !enemyAlive ? "ally" : !playerAlive && enemyAlive ? "enemy" : ""
      };
    }

    return {
      makeFighter,
      effectiveStat,
      guardReductionFor,
      calcDamage,
      battleSpeechEvent,
      applySelfShield,
      applyBattlePassives,
      tickDownStatuses,
      resolveEndOfRoundDamageStatuses,
      resolveBattleTurn,
      fighterAction
    };
  }

  return {
    createRuntime
  };
});
