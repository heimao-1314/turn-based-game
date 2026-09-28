const test = require("node:test");
const assert = require("node:assert/strict");
const { compute } = require("./viewport.js");

test("镜头计算在宽地图与小地图保持原有位置", () => {
  const base = { width: 430, height: 573, viewWidth: 240, viewHeight: 320, tileSize: 16 };
  const wide = compute({ ...base, worldWidth: 640, worldHeight: 640, playerX: 200, playerY: 200 });
  assert.equal(wide.mapScale, Math.min(430 / 240, 573 / 320));
  assert.equal(wide.cameraX, 88);
  assert.equal(wide.cameraY, 48);
  const small = compute({ ...base, worldWidth: 160, worldHeight: 160, playerX: 32, playerY: 32 });
  assert.equal(small.cameraX, -40);
  assert.equal(small.cameraY, -80);
});

test("跟随移动中的角色时地图原点始终落在设备像素上", () => {
  const dpr = 2;
  for (let i = 0; i < 16; i += 1) {
    const viewport = compute({ width: 430, height: 573, worldWidth: 640, worldHeight: 640, viewWidth: 240, viewHeight: 320, playerX: 200 + i * 1.227, playerY: 200, tileSize: 16, devicePixelRatio: dpr });
    const originInPixels = (viewport.mapViewportX - viewport.cameraX * viewport.mapScale) * dpr;
    assert.ok(Math.abs(originInPixels - Math.round(originInPixels)) < 1e-9);
  }
});
