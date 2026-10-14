((global, factory) => {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.CareerTree = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const INITIAL_CLASS = "初始角色";
  const INITIAL_SUB = "未转职";
  const FIRST_TRANSFER_LEVEL = 40;
  const SECOND_TRANSFER_CAREER_LEVEL = 10;
  const BAG_CAPACITY = 50;

  const branches = {
    "剑士": {
      first: "初级剑士",
      firstSprites: {
        "男": { walk: 639, attack: 640 },
        "女": { walk: 641, attack: 642 }
      },
      second: {
        "刺杀": { name: "刺杀剑士", "男": { walk: 651, attack: 652 }, "女": { walk: 653, attack: 654 } },
        "狂暴": { name: "狂暴剑士", "男": { walk: 647, attack: 648 }, "女": { walk: 649, attack: 650 } },
        "防御": { name: "防御剑士", "男": { walk: 643, attack: 644 }, "女": { walk: 645, attack: 646 } }
      }
    },
    "法师": {
      first: "初级法师",
      firstSprites: {
        "男": { walk: 655, attack: 656 },
        "女": { walk: 657, attack: 658 }
      },
      second: {
        "裁决": { name: "裁决法师", "男": { walk: 667, attack: 668 }, "女": { walk: 669, attack: 670 } },
        "暗影": { name: "暗影法师", "男": { walk: 663, attack: 664 }, "女": { walk: 665, attack: 666 } },
        "神圣": { name: "神圣法师", "男": { walk: 659, attack: 660 }, "女": { walk: 661, attack: 662 } }
      }
    },
    "枪手": {
      first: "初级枪手",
      firstSprites: {
        "男": { walk: 671, attack: 672 },
        "女": { walk: 673, attack: 674 }
      },
      second: {
        "狙击": { name: "狙击枪手", "男": { walk: 675, attack: 676 }, "女": { walk: 677, attack: 678 } },
        "破魔": { name: "破魔枪手", "男": { walk: 683, attack: 684 }, "女": { walk: 685, attack: 686 } },
        "重装": { name: "重装枪手", "男": { walk: 679, attack: 680 }, "女": { walk: 681, attack: 682 } }
      }
    }
  };

  const initialSprites = {
    "男": { walk: 53, attack: "a53" },
    "女": { walk: 54, attack: "a54" }
  };

  const baseGrowth = {
    attack: [100, 100],
    hp: [1000, 1000],
    speed: [100, 10],
    mana: [100, 10],
    defense: [0, 0],
    energy: [50, 0],
    hit: [100, 0],
    dodge: [0, 0],
    crit: [0, 0],
    critDamage: [150, 0]
  };

  const roleCatalog = {
    [INITIAL_CLASS]: [
      { sub: INITIAL_SUB, gender: "女", id: initialSprites["女"].walk, attackId: initialSprites["女"].attack, stage: 0, name: "初始角色-女" },
      { sub: INITIAL_SUB, gender: "男", id: initialSprites["男"].walk, attackId: initialSprites["男"].attack, stage: 0, name: "初始角色-男" }
    ]
  };

  Object.entries(branches).forEach(([className, branch]) => {
    roleCatalog[className] = ["女", "男"].map((gender) => ({
      sub: branch.first,
      gender,
      id: branch.firstSprites[gender].walk,
      attackId: branch.firstSprites[gender].attack,
      stage: 1,
      name: branch.first
    }));
    Object.entries(branch.second).forEach(([sub, config]) => {
      ["女", "男"].forEach((gender) => {
        roleCatalog[className].push({
          sub,
          gender,
          id: config[gender].walk,
          attackId: config[gender].attack,
          stage: 2,
          name: config.name
        });
      });
    });
  });

  const adminRoleCatalog = Object.fromEntries(Object.entries(roleCatalog).map(([className, roles]) => [
    className,
    Object.fromEntries(["女", "男"].map((gender) => [gender, roles.filter((role) => role.gender === gender).map((role) => role.sub)]))
  ]));

  const attackSpriteByWalkSprite = {};
  Object.values(roleCatalog).flat().forEach((role) => {
    attackSpriteByWalkSprite[String(role.id)] = role.attackId;
  });

  function canonicalSub(sub) {
    return sub === "光明" ? "神圣" : String(sub || "");
  }

  function careerStage(selection = {}) {
    if (selection.className === INITIAL_CLASS) return 0;
    const branch = branches[selection.className];
    if (!branch) return 0;
    return canonicalSub(selection.sub) === branch.first ? 1 : Object.prototype.hasOwnProperty.call(branch.second, canonicalSub(selection.sub)) ? 2 : 0;
  }

  function normalizeSelection(selection = {}, fallbackPetId = 486) {
    const gender = ["女", "男"].includes(selection.gender) ? selection.gender : "女";
    let className = roleCatalog[selection.className] ? selection.className : INITIAL_CLASS;
    let sub = canonicalSub(selection.sub);
    let roles = roleCatalog[className].filter((role) => role.gender === gender);
    if (!roles.some((role) => role.sub === sub)) {
      if (className !== INITIAL_CLASS && !sub) sub = branches[className].first;
      if (!roles.some((role) => role.sub === sub)) {
        className = INITIAL_CLASS;
        roles = roleCatalog[className].filter((role) => role.gender === gender);
        sub = INITIAL_SUB;
      }
    }
    return {
      ...selection,
      gender,
      className,
      sub,
      petId: Number(selection.petId) || Number(fallbackPetId) || 486
    };
  }

  function roleForSelection(selection = {}) {
    const normalized = normalizeSelection(selection);
    return roleCatalog[normalized.className].find((role) => role.gender === normalized.gender && role.sub === normalized.sub);
  }

  function careerName(selection = {}) {
    return roleForSelection(selection)?.name || INITIAL_CLASS;
  }

  function firstTransferSelections(selection = {}) {
    const normalized = normalizeSelection(selection);
    return Object.entries(branches).map(([className, branch]) => ({
      ...normalized,
      className,
      sub: branch.first
    }));
  }

  function secondTransferSelections(selection = {}) {
    const normalized = normalizeSelection(selection);
    const branch = branches[normalized.className];
    if (!branch) return [];
    return Object.keys(branch.second).map((sub) => ({ ...normalized, sub }));
  }

  function transitionCheck(currentSelection, targetSelection, progress = {}) {
    const current = normalizeSelection(currentSelection);
    const target = normalizeSelection(targetSelection);
    const currentStage = careerStage(current);
    const targetStage = careerStage(target);
    if (target.gender !== current.gender) return { ok: false, error: "gender_locked" };
    if (currentStage === 0) {
      if ((Number(progress.playerLevel) || 1) < FIRST_TRANSFER_LEVEL) return { ok: false, error: "first_transfer_level_required" };
      if (targetStage !== 1) return { ok: false, error: "invalid_career_transition" };
      return { ok: true, resetCareerProgress: true };
    }
    if (currentStage === 1) {
      if ((Number(progress.careerLevel) || 1) < SECOND_TRANSFER_CAREER_LEVEL) return { ok: false, error: "second_transfer_level_required" };
      if (targetStage !== 2 || target.className !== current.className) return { ok: false, error: "invalid_career_transition" };
      return { ok: true, resetCareerProgress: false };
    }
    return { ok: false, error: "career_max_stage" };
  }

  return {
    INITIAL_CLASS,
    INITIAL_SUB,
    FIRST_TRANSFER_LEVEL,
    SECOND_TRANSFER_CAREER_LEVEL,
    BAG_CAPACITY,
    branches,
    initialSprites,
    baseGrowth,
    roleCatalog,
    adminRoleCatalog,
    attackSpriteByWalkSprite,
    canonicalSub,
    careerStage,
    careerName,
    normalizeSelection,
    roleForSelection,
    firstTransferSelections,
    secondTransferSelections,
    transitionCheck
  };
});
