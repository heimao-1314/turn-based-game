/**
 * @file battle-placement.test.js
 * @description 战斗站位模块单元测试 - 验证多目标交错站位与各落位函数
 *
 * 测试覆盖范围:
 * - 10 目标交错双列布局（前 5 左列、后 5 右列并错开半行）
 * - 奇数目标数时左列多一个
 * - 4-10 目标在桌面/手机画布内不越界
 * - 单人三角站位、我方网格站位行为保持
 *
 * 测试框架: Node.js 内置 node:test 模块
 * 运行命令: node --test 战斗/battle-placement.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const modulePath = path.join(__dirname, "battle-placement.js");
const source = fs.readFileSync(modulePath, "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const bp = sandbox.window.BattlePlacement;

function positions(count, centerX, baseY) {
  const team = Array.from({ length: count }, () => ({}));
  team.forEach((fighter, index) => bp.placeEnemyGridFighter(fighter, index, team, centerX, baseY));
  return team.map((fighter) => ({ x: fighter.battleX, y: fighter.battleY }));
}

test("10 目标按前 5 左列、后 5 右列交错分布", () => {
  const pts = positions(10, 215, 306);
  const left = pts.slice(0, 5);
  const right = pts.slice(5);
  const leftX = left[0].x;
  const rightX = right[0].x;
  for (const p of left) assert.equal(p.x, leftX, "左列 x 相同");
  for (const p of right) assert.equal(p.x, rightX, "右列 x 相同");
  assert.ok(rightX > leftX, "右列在左列右侧");
  for (let i = 1; i < 5; i++) assert.ok(left[i].y > left[i - 1].y, "左列 y 自上而下递增");
  for (let i = 1; i < 5; i++) assert.ok(right[i].y > right[i - 1].y, "右列 y 自上而下递增");
  const rowStep = left[1].y - left[0].y;
  for (let k = 0; k < 5; k++) {
    assert.equal(right[k].y - left[k].y, rowStep / 2, `第 ${k + 1} 组右列错开半行`);
  }
});

test("奇数目标数时左列多一个", () => {
  const pts = positions(5, 215, 306);
  const left = pts.slice(0, 3);
  const right = pts.slice(3);
  assert.equal(left.length, 3);
  assert.equal(right.length, 2);
  assert.notEqual(left[0].x, right[0].x);
});

test("4-10 目标在桌面/手机画布内不越界", () => {
  const sizes = [
    { label: "desktop", width: 430, baseY: (Math.min(430, 430) * 20 / 15) / 2 + 20 },
    { label: "mobile-375", width: 375, baseY: (Math.min(430, 375) * 20 / 15) / 2 + 20 },
    { label: "mobile-360", width: 360, baseY: (Math.min(430, 360) * 20 / 15) / 2 + 20 }
  ];
  for (const size of sizes) {
    const centerX = size.width / 2;
    const height = (size.baseY - 20) * 2;
    for (let n = 4; n <= 10; n++) {
      const pts = positions(n, centerX, size.baseY);
      const ys = pts.map((p) => p.y);
      const xs = pts.map((p) => p.x);
      assert.ok(Math.min(...ys) - 80 >= 0, `${size.label} n=${n} 顶部不越界`);
      assert.ok(Math.max(...ys) + 12 <= height, `${size.label} n=${n} 底部不越界`);
      assert.ok(Math.max(...xs) + 42 <= size.width, `${size.label} n=${n} 右侧不越界`);
    }
  }
});

test("placeSingleBattleFighter 保持三角站位", () => {
  const team = [
    { actor: { isPet: true } },
    { actor: {} },
    { actor: { isMercenary: true } }
  ];
  team.forEach((fighter) => bp.placeSingleBattleFighter(fighter, team, 300, 300));
  assert.equal(team[0].battleX, 300);
  assert.ok(team[0].battleY < team[1].battleY, "宠物在前下方");
  assert.ok(team[2].battleY > team[1].battleY, "佣兵在后上方");
});

test("placeAllyGridFighter 保持我方两列网格", () => {
  const team = [{}, {}, {}, {}];
  team.forEach((fighter, i) => bp.placeAllyGridFighter(fighter, i, 215, 306));
  assert.equal(team[0].battleY, team[1].battleY, "前两个同排");
  assert.notEqual(team[0].battleX, team[1].battleX, "前两个左右错列");
});