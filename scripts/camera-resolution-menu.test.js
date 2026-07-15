const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("opening camera resolution does not fall through to the system-menu action", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
  const match = source.match(/function confirmDetailSettingsMenu\(\) \{([\s\S]*?)\n\}/);

  assert.ok(match, "detail settings confirmation handler exists");
  assert.match(match[1], /if \(state\.menuItem === 0\) return openCameraResolutionMenu\(\);/);
  assert.match(match[1], /if \(state\.menuItem === 1\) return openMainMenuAt\(4, "细节设置"\);/);
});
