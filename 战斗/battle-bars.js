/**
 * @file battle-bars.js
 * @description 战斗血条/精力条绘制模块 - 支持多套素材样式（细节设置中可切换）
 *
 * 内置三种样式：
 * - blood（经典款，blood.png 22x7）：血条与精力条分两段绘制，精力条紧贴共用边，
 *   无精力时只显示血条。
 * - hp（金色款，HP.png 78x11）：一体框 40x11，金色血条填充 + 青色精力填充。
 * - 2hp（新款式，2HP.png 78x9）：一体框 40x9，金色血条填充 + 青色精力填充。
 *
 * 一体框样式：空框一次 drawImage 拉伸到目标尺寸，再按比例裁剪右半填充盖到
 * 对应内槽（精力槽留空用 energyRate=0 控制）。
 *
 * @module BattleBars
 */
(function (global) {
  const BATTLE_BAR_STYLES = {
    blood: {
      id: "blood",
      label: "经典款",
      src: "资源/图片/blood.png",
      mode: "split",
      bloodFrame: { x: 0, y: 0, w: 22, h: 4 },
      bloodFill: { x: 22, y: 1, w: 20, h: 2 },
      energyFrame: { x: 0, y: 3, w: 22, h: 4 },
      energyFill: { x: 22, y: 4, w: 20, h: 2 }
    },
    hp: {
      id: "hp",
      label: "金色款",
      src: "资源/图片/HP.png",
      mode: "frame",
      frame: { x: 0, y: 0, w: 40, h: 11 },
      hpFill: { x: 40, y: 1, w: 38, h: 4 },
      energyFill: { x: 40, y: 6, w: 38, h: 4 },
      slotX: 1,
      slotW: 38,
      hpSlot: { y: 1, h: 4 },
      energySlot: { y: 6, h: 4 }
    },
    "2hp": {
      id: "2hp",
      label: "新款式",
      src: "资源/图片/2HP.png",
      mode: "frame",
      frame: { x: 0, y: 0, w: 40, h: 9 },
      hpFill: { x: 40, y: 1, w: 38, h: 3 },
      energyFill: { x: 40, y: 5, w: 38, h: 3 },
      slotX: 1,
      slotW: 38,
      hpSlot: { y: 1, h: 3 },
      energySlot: { y: 5, h: 3 }
    }
  };

  /**
   * 经典款（split）：按比例裁剪填充盖到单条框的内槽。
   */
  function drawBarFrame(ctx, image, x, y, width, height, rate, frame, fill, slotX, slotY, slotW, slotH) {
    const left = x - width / 2;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, left, y, width, height);
    const ratio = Math.max(0, Math.min(1, Number(rate) || 0));
    if (ratio <= 0) return;
    const srcW = Math.max(0, fill.w * ratio);
    if (srcW < 1) return;
    ctx.drawImage(
      image,
      fill.x, fill.y, srcW, fill.h,
      left + width * (slotX / frame.w),
      y + height * (slotY / frame.h),
      width * (slotW / frame.w) * ratio,
      height * (slotH / frame.h)
    );
  }

  /**
   * 一体框款式：把填充裁剪盖到整体框的内槽。
   */
  function drawSlotFill(ctx, image, left, y, width, height, style, fill, slot, rate) {
    const ratio = Math.max(0, Math.min(1, Number(rate) || 0));
    if (ratio <= 0) return;
    const srcW = Math.max(0, fill.w * ratio);
    if (srcW < 1) return;
    ctx.drawImage(
      image,
      fill.x, fill.y, srcW, fill.h,
      left + width * (style.slotX / style.frame.w),
      y + height * (slot.y / style.frame.h),
      width * (style.slotW / style.frame.w) * ratio,
      height * (slot.h / style.frame.h)
    );
  }

  /**
   * 按样式绘制血条（+精力条）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLImageElement} image 当前样式素材图像
   * @param {number} x 条中心横坐标
   * @param {number} y 条左上角纵坐标
   * @param {number} width 目标条宽
   * @param {number} height 目标条高（一体框款式按比例传入；经典款忽略）
   * @param {number} hpRate 0..1 血条填充比例
   * @param {number} energyRate 0..1 精力条填充比例；0 表示不显示精力条
   * @param {Object} style BATTLE_BAR_STYLES 中的一项
   */
  function drawBattleBars(ctx, image, x, y, width, height, hpRate, energyRate, style) {
    if (!ctx || !image || !style) return;
    if (style.mode === "split") {
      drawBarFrame(ctx, image, x, y, width, 7, hpRate, style.bloodFrame, style.bloodFill, 1, 1, 20, 2);
      if (Number(energyRate) > 0) {
        drawBarFrame(ctx, image, x, y + 6, width, 7, energyRate, style.energyFrame, style.energyFill, 1, 1, 20, 2);
      }
      return;
    }
    const left = x - width / 2;
    const frame = style.frame;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, left, y, width, height);
    drawSlotFill(ctx, image, left, y, width, height, style, style.hpFill, style.hpSlot, hpRate);
    if (Number(energyRate) > 0) {
      drawSlotFill(ctx, image, left, y, width, height, style, style.energyFill, style.energySlot, energyRate);
    }
  }

  global.BattleBars = {
    BATTLE_BAR_STYLES,
    drawBattleBars
  };
})(window);