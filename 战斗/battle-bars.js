/**
 * @file battle-bars.js
 * @description 战斗血条/精力条一体绘制模块 - 基于 HP.png 精灵表
 *
 * HP.png 为 78x11 精灵表：
 * - 左半 x0-39,y0-10 是血条+精力条一体空框（含顶/底边框与中间分隔线），
 *   血条内槽 x1-38,y1-4，精力内槽 x1-38,y6-9。
 * - 右半为填充内容：血条填充 x40-77,y1-4（金色）；精力填充 x40-77,y6-9（青色）。
 *
 * 一体绘制：空框一次 drawImage 拉伸到目标尺寸，再按各自比例裁剪右半填充
 * 盖到对应内槽。血条与精力条共用同一框体，无需分开拼接。
 *
 * @module BattleBars
 */
(function (global) {
  const HP_SHEET = {
    frame: { x: 0, y: 0, w: 40, h: 11 },
    hpFill: { x: 40, y: 1, w: 38, h: 4 },
    energyFill: { x: 40, y: 6, w: 38, h: 4 }
  };
  const FRAME_W = 40;
  const FRAME_H = 11;
  const SLOT_X = 1;   // 内槽相对框的左偏移
  const SLOT_W = 38;  // 内槽宽
  const HP_SLOT_Y = 1;     // 血条内槽相对框的上偏移
  const HP_SLOT_H = 4;     // 血条内槽高
  const ENERGY_SLOT_Y = 6; // 精力内槽相对框的上偏移
  const ENERGY_SLOT_H = 4; // 精力内槽高

  /**
   * 按比例把右半填充裁剪到对应内槽。
   */
  function drawSlotFill(ctx, image, left, y, width, height, fill, slotY, slotH, rate) {
    const ratio = Math.max(0, Math.min(1, Number(rate) || 0));
    if (ratio <= 0) return;
    const srcW = Math.max(0, fill.w * ratio);
    if (srcW < 1) return;
    ctx.drawImage(
      image,
      fill.x, fill.y, srcW, fill.h,
      left + width * (SLOT_X / FRAME_W),
      y + height * (slotY / FRAME_H),
      width * (SLOT_W / FRAME_W) * ratio,
      height * (slotH / FRAME_H)
    );
  }

  /**
   * 血条+精力条一体框绘制。
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLImageElement} image HP.png 图像
   * @param {number} x 框中心横坐标
   * @param {number} y 框左上角纵坐标
   * @param {number} width 目标框宽
   * @param {number} height 目标框高
   * @param {number} hpRate 0..1 血条填充比例
   * @param {number} energyRate 0..1 精力条填充比例；0 表示只画空槽不填充
   */
  function drawHpEnergyBar(ctx, image, x, y, width, height, hpRate, energyRate) {
    if (!ctx || !image) return;
    const left = x - width / 2;
    const frame = HP_SHEET.frame;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, left, y, width, height);
    drawSlotFill(ctx, image, left, y, width, height, HP_SHEET.hpFill, HP_SLOT_Y, HP_SLOT_H, hpRate);
    if (Number(energyRate) > 0) {
      drawSlotFill(ctx, image, left, y, width, height, HP_SHEET.energyFill, ENERGY_SLOT_Y, ENERGY_SLOT_H, energyRate);
    }
  }

  global.BattleBars = {
    drawHpEnergyBar,
    HP_SHEET
  };
})(window);