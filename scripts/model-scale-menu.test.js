const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

test("detail settings exposes menu-native model scale controls", () => {
  assert.match(source, /\{ label: "调整模型大小", icon: "1\.13" \}/);
  assert.match(source, /function openModelScaleMenu\(\)[\s\S]*?宠物模型大小[\s\S]*?人物模型大小/);
  assert.match(source, /state\.menuMode === "model_scale_adjust"[\s\S]*?confirmModelScaleOptionMenu\(\)/);
  assert.match(source, /class="menu-scale-range" type="range"/);
  assert.match(source, /MODEL_SCALE_STEP = 0\.05/);
});

test("model scale settings stay local and do not alter remote player rendering", () => {
  assert.match(source, /localStorage\.setItem\(MODEL_SCALE_STORAGE_KEY, JSON\.stringify\(saved\)\)/);
  assert.doesNotMatch(source, /function saveModelScalePreference[\s\S]*?\/api\/admin\/game-visual/);
  assert.match(source, /if \(actor === state\.player\) return state\.actorScales\.player \|\| 1;/);
  assert.match(source, /return state\.actorScales\.other \|\| 1;/);
});

test("pet name visibility is local and only affects pet labels", () => {
  assert.match(source, /显示宠物名字：\$\{state\.showPetNames \? "开" : "关"\}/);
  assert.match(source, /localStorage\.setItem\(SHOW_PET_NAME_STORAGE_KEY, String\(state\.showPetNames\)\)/);
  assert.match(source, /if \(!actor\.isPet \|\| state\.showPetNames\) \{/);
});
