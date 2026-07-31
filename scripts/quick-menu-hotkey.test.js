const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");

const source = readFileSync(require.resolve("../app.js"), "utf8");

test("closing a menu clears a pending quick-menu hotkey", () => {
  assert.match(
    source,
    /function closeMainMenu\(\) \{[\s\S]*?clearPendingQuickMenuHotkey\(\);[\s\S]*?state\.menuOpen = false;/
  );
});

test("control-pad menu input is consumed before quick-menu hotkeys", () => {
  assert.match(
    source,
    /if \(state\.menuOpen\) \{\s*pressControlKey\(key\);\s*return;\s*\}[\s\S]*?const digit = controlDigitByKey\.get\(key\);/
  );
  assert.match(source, /state\.roleStatsOpen \|\| state\.menuOpen \|\| isInputUiActive\(\)/);
});
