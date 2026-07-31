const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(require.resolve("../菜单UI/quick-menu-hotkeys.js"), "utf8");
const appSource = readFileSync(require.resolve("../app.js"), "utf8");

function createHarness() {
  const context = { window: {}, setTimeout: () => 1, clearTimeout: () => {} };
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  vm.runInNewContext(source, context);
  const events = [];
  let menuOpen = false;
  const hotkeys = context.window.QuickMenuHotkeys.createQuickMenuHotkeys({
    isRootDigit: (digit) => ["1", "9"].includes(digit),
    openRoot: (digit) => { menuOpen = true; events.push(`root:${digit}`); },
    selectCurrentItem: (digit) => { events.push(`item:${digit}`); if (events.join(",") === "root:9,item:2") menuOpen = false; },
    isMenuOpen: () => menuOpen
  });
  return { events, hotkeys };
}

test("92 opens a second-level action and clears the path", () => {
  const { events, hotkeys } = createHarness();
  assert.equal(hotkeys.acceptDigit("9"), true);
  assert.equal(hotkeys.acceptDigit("2"), true);
  assert.deepEqual(events, ["root:9", "item:2"]);
  assert.equal(hotkeys.pendingPath, "");
});

test("142 selects a third-level action", () => {
  const { events, hotkeys } = createHarness();
  hotkeys.acceptDigit("1");
  hotkeys.acceptDigit("4");
  hotkeys.acceptDigit("2");
  assert.deepEqual(events, ["root:1", "item:4", "item:2"]);
  assert.equal(hotkeys.pendingPath, "");
});

test("only numbered top-level menus begin a shortcut path", () => {
  const { events, hotkeys } = createHarness();
  assert.equal(hotkeys.acceptDigit("5"), false);
  assert.deepEqual(events, []);
});

test("opening a root menu cannot clear its first shortcut digit", () => {
  const context = { window: {}, setTimeout: () => 1, clearTimeout: () => {} };
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  vm.runInNewContext(source, context);
  let hotkeys;
  hotkeys = context.window.QuickMenuHotkeys.createQuickMenuHotkeys({
    isRootDigit: (digit) => digit === "9",
    openRoot: () => hotkeys.clear(),
    selectCurrentItem: () => true,
    isMenuOpen: () => true
  });
  hotkeys.acceptDigit("9");
  assert.equal(hotkeys.pendingPath, "9");
});

test("detail settings exposes the persisted quick-menu hotkey switch", () => {
  assert.match(appSource, /const QUICK_MENU_HOTKEYS_STORAGE_KEY = "dw-quick-menu-hotkeys"/);
  assert.ok(appSource.includes("快捷操作：${quickMenuHotkeysEnabled() ? \"开\" : \"关\"}"));
  assert.ok(appSource.includes("setQuickMenuHotkeysEnabled(!quickMenuHotkeysEnabled())"));
});
