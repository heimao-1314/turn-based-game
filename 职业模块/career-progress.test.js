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
