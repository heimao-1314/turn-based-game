/**
 * @file battle-bars.js
 * @description 战斗血条/精力条绘制模块 - 基于 blood.png 精灵表
 *
 * blood.png 为 42x7 像素精灵表：
 * - 左半（x 0-21）为空槽：y0-3 是血条（顶边框 + 2px 内槽 + 分隔线），
 *   y3-6 是精力条（分隔线 + 2px 内槽 + 底边框）。
 * - 右半为填充内容：x22-41,y1-2 血条红色填充；x22-41,y4-5 精力蓝色填充。
 *
 * 绘制方式：按目标宽度把空槽整体拉伸，再按比例裁剪右半填充盖到内槽位置，
 * 与百分比血条通用做法一致。精力条接口已按同构规则实现，供后续精力 UI 接入。
 *
 * @module BattleBars
 */
(function (global) {
  const FRAME_W = 22; // 空槽总宽
  const FRAME_H = 4;  // 单条空槽总高（血条 y0-3 / 精力条 y3-6）
  const FILL_W = 20;  // 填充可用宽度（内槽宽）
  const FILL_H = 2;   // 填充可用高度（内槽高）
  const INSET_X = 1;  // 内槽相对空槽的左偏移
  const INSET_Y = 1;  // 内槽相对空槽的上偏移

  const BAR_SHEET = {
    blood: {
      frame: { x: 0, y: 0, w: FRAME_W, h: FRAME_H },
      fill: { x: 22, y: 1, w: FILL_W, h: FILL_H }
    },
    energy: {
      frame: { x: 0, y: 3, w: FRAME_W, h: FRAME_H },
      fill: { x: 22, y: 4, w: FILL_W, h: FILL_H }
    }
  };

  /**
   * 通用条绘制：空槽整体拉伸到 (width, height)，再按 rate 裁剪填充盖到内槽。
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLImageElement} image blood.png 图像
   * @param {number} x 条中心横坐标
   * @param {number} y 条左上角纵坐标
   * @param {number} width 目标条宽
   * @param {number} height 目标条高
   * @param {number} rate 0..1 填充比例
   * @param {Object} part BAR_SHEET 中的一部分
   */
  function drawBar(ctx, image, x, y, width, height, rate, part) {
    if (!ctx || !image) return;
    const left = x - width / 2;
    const frame = part.frame;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, left, y, width, height);
    const ratio = Math.max(0, Math.min(1, Number(rate) || 0));
    if (ratio <= 0) return;
    const fill = part.fill;
    const srcW = Math.max(0, fill.w * ratio);
    if (srcW < 1) return;
    ctx.drawImage(
      image,
      fill.x, fill.y, srcW, fill.h,
      left + width * (INSET_X / FRAME_W),
      y + height * (INSET_Y / FRAME_H),
      width * (FILL_W / FRAME_W) * ratio,
      height * (FILL_H / FRAME_H)
    );
  }

  function drawBloodBar(ctx, image, x, y, width, height, rate) {
    drawBar(ctx, image, x, y, width, height, rate, BAR_SHEET.blood);
  }

  function drawEnergyBar(ctx, image, x, y, width, height, rate) {
    drawBar(ctx, image, x, y, width, height, rate, BAR_SHEET.energy);
  }

  global.BattleBars = {
    drawBloodBar,
    drawEnergyBar,
    BAR_SHEET
  };
})(window);