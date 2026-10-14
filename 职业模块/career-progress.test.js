const test = require("node:test");
const assert = require("node:assert/strict");
const { applyExp, progress } = require("./career-progress.js");

test("职业经验按击败数量独立升级并显示阶级", () => {
  const next = applyExp(1, 0, 10, 10);
  assert.equal(next.level, 2);
  assert.equal(next.stage, 1);
  assert.equal(next.stageLevel, 2);
  assert.equal(progress(100).stage, 10);
  assert.equal(progress(100).stageLevel, 10);
});

test("一转职业十级经验满后停在转职门槛", () => {
  const next = applyExp(9, 95, 10, 100, 10);
  assert.deepEqual(next, { level: 10, stage: 1, stageLevel: 10, exp: 100, expPerLevel: 100, atCap: true });
  assert.equal(applyExp(10, 100, 999, 100, 10).level, 10);
});
