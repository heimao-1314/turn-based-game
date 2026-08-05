/**
 * @file battle-placement.js
 * @description 战斗站位模块 - 计算我方/敌方单位在战斗画布上的落位坐标
 *
 * 本模块只做纯坐标计算：根据队伍规模把每个 fighter 写入 battleX / battleY，
 * 不读取也不修改战斗规则状态，由 app.js 的 drawBattleScene 每帧调用。
 *
 * 多目标敌人采用交错双列布局（前一半目标在左列，后一半目标在右列并错开半格）：
 *
 *   1    -
 *   -    6
 *   2    -
 *   -    7
 *   3    -
 *   -    8
 *   4    -
 *   -    9
 *   5    -
 *   -    10
 *
 * 相比旧的两列行对齐网格，同一水平线的目标不再垂直重叠，能显著减少相互遮挡。
 *
 * @module BattlePlacement
 */
(function (global) {
  /**
   * 敌方多目标交错站位（敌方数量 >= 4 时使用）。
   * 前一半目标在左列自上而下，后一半目标在右列自上而下并错开半个行距。
   */
  function placeEnemyGridFighter(fighter, index, team, centerX, baseY) {
    const leftCount = Math.ceil(team.length / 2);
    const isLeft = index < leftCount;
    const local = isLeft ? index : index - leftCount;
    const colGap = 66;
    const rowStep = 52;
    const stagger = rowStep / 2;
    fighter.battleX = centerX + 72 + (isLeft ? 0 : colGap);
    fighter.battleY = baseY - 120 + local * rowStep + (isLeft ? 0 : stagger);
  }

  /**
   * 单人队伍站位：人物居中，宠物前下方，佣兵后上方。
   */
  function placeSingleBattleFighter(fighter, team, x, baseY) {
    const gap = 56;
    const roleSlots = [
      { key: "pet", y: baseY - 54 - gap },
      { key: "actor", y: baseY - 54 },
      { key: "mercenary", y: baseY - 54 + gap }
    ];
    const key = fighter.actor.isPet ? "pet" : fighter.actor.isMercenary ? "mercenary" : "actor";
    const roleSlot = roleSlots.find((slot) => slot.key === key);
    if (roleSlot) {
      fighter.battleX = x;
      fighter.battleY = roleSlot.y;
      return;
    }
    const fallbackIndex = team.indexOf(fighter);
    fighter.battleX = x;
    fighter.battleY = baseY - 54 + (fallbackIndex - 1) * gap;
  }

  /**
   * 我方队伍网格站位（多人战斗时使用）。
   */
  function placeAllyGridFighter(fighter, index, centerX, baseY) {
    const slots = [
      { col: 1, row: 0 }, { col: 0, row: 0 },
      { col: 1, row: 1 }, { col: 0, row: 1 },
      { col: 1, row: 2 }, { col: 0, row: 2 }
    ];
    const slot = slots[index] || { col: index % 2 ? 0 : 1, row: Math.floor(index / 2) };
    fighter.battleX = centerX - 122 - slot.col * 48;
    fighter.battleY = baseY - 98 + slot.row * 46;
  }

  /**
   * 精灵王宝库隐藏战斗（40 个目标）紧凑分块站位。
   */
  function placeElfKingVaultHiddenEnemyFighter(fighter, index, centerX, baseY) {
    const group = Math.floor(index / 10);
    const localIndex = index % 10;
    const blockCol = group % 2;
    const blockRow = Math.floor(group / 2);
    const originX = centerX + 44 + blockCol * 82;
    const originY = baseY - 132 + blockRow * 108;
    if (localIndex === 0) {
      fighter.battleX = originX;
      fighter.battleY = originY + 40;
      return;
    }
    const slots = [
      { col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 3 }, { col: 0, row: 4 },
      { col: 1, row: 0 }, { col: 1, row: 1 }, { col: 1, row: 2 }, { col: 1, row: 3 }, { col: 1, row: 4 }
    ];
    const slot = slots[localIndex - 1] || { col: (localIndex - 1) % 2, row: Math.floor((localIndex - 1) / 2) };
    fighter.battleX = originX + slot.col * 28;
    fighter.battleY = originY + slot.row * 20;
  }

  global.BattlePlacement = {
    placeEnemyGridFighter,
    placeSingleBattleFighter,
    placeAllyGridFighter,
    placeElfKingVaultHiddenEnemyFighter
  };
})(window);