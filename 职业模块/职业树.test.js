const test = require("node:test");
const assert = require("node:assert/strict");
const careerTree = require("./职业树.js");

test("initial roles use the requested walk and attack sprites", () => {
  assert.deepEqual(careerTree.initialSprites["男"], { walk: 53, attack: "a53" });
  assert.deepEqual(careerTree.initialSprites["女"], { walk: 54, attack: "a54" });
});

test("first transfer sprites match every class and gender", () => {
  assert.deepEqual(careerTree.branches["剑士"].firstSprites["男"], { walk: 639, attack: 640 });
  assert.deepEqual(careerTree.branches["剑士"].firstSprites["女"], { walk: 641, attack: 642 });
  assert.deepEqual(careerTree.branches["法师"].firstSprites["男"], { walk: 655, attack: 656 });
  assert.deepEqual(careerTree.branches["法师"].firstSprites["女"], { walk: 657, attack: 658 });
  assert.deepEqual(careerTree.branches["枪手"].firstSprites["男"], { walk: 671, attack: 672 });
  assert.deepEqual(careerTree.branches["枪手"].firstSprites["女"], { walk: 673, attack: 674 });
});

test("career transitions are level gated and branch locked", () => {
  const initial = { gender: "女", className: "初始角色", sub: "未转职", petId: 486 };
  const firstMage = careerTree.firstTransferSelections(initial).find((selection) => selection.className === "法师");
  assert.equal(careerTree.transitionCheck(initial, firstMage, { playerLevel: 39, careerLevel: 1 }).error, "first_transfer_level_required");
  assert.equal(careerTree.transitionCheck(initial, firstMage, { playerLevel: 40, careerLevel: 1 }).ok, true);

  const secondMage = careerTree.secondTransferSelections(firstMage).find((selection) => selection.sub === "神圣");
  assert.equal(careerTree.transitionCheck(firstMage, secondMage, { playerLevel: 40, careerLevel: 39 }).error, "second_transfer_level_required");
  assert.equal(careerTree.transitionCheck(firstMage, secondMage, { playerLevel: 40, careerLevel: 40 }).ok, true);

  const firstSword = careerTree.firstTransferSelections(initial).find((selection) => selection.className === "剑士");
  const secondSword = careerTree.secondTransferSelections(firstSword)[0];
  assert.equal(careerTree.transitionCheck(firstMage, secondSword, { playerLevel: 100, careerLevel: 100 }).error, "invalid_career_transition");
});

test("legacy light mage is normalized to holy mage", () => {
  const selection = careerTree.normalizeSelection({ gender: "男", className: "法师", sub: "光明", petId: 486 });
  assert.equal(selection.sub, "神圣");
  assert.equal(careerTree.careerName(selection), "神圣法师");
  assert.equal(careerTree.careerStage(selection), 2);
});

test("base growth matches the requested level-one and level-one-hundred values", () => {
  const valueAt = (stat, level) => careerTree.baseGrowth[stat][0] + careerTree.baseGrowth[stat][1] * (level - 1);
  assert.deepEqual({
    attack: valueAt("attack", 1),
    hp: valueAt("hp", 1),
    speed: valueAt("speed", 1),
    mana: valueAt("mana", 1),
    defense: valueAt("defense", 1),
    energy: valueAt("energy", 1),
    hit: valueAt("hit", 1),
    dodge: valueAt("dodge", 1),
    crit: valueAt("crit", 1),
    critDamage: valueAt("critDamage", 1)
  }, { attack: 100, hp: 1000, speed: 100, mana: 100, defense: 0, energy: 50, hit: 100, dodge: 0, crit: 0, critDamage: 150 });
  assert.equal(valueAt("attack", 100), 10000);
  assert.equal(valueAt("hp", 100), 100000);
  assert.equal(valueAt("speed", 100), 1090);
  assert.equal(valueAt("mana", 100), 1090);
});

test("bag capacity starts at fifty slots", () => {
  assert.equal(careerTree.BAG_CAPACITY, 50);
});
