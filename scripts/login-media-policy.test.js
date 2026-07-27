const assert = require("node:assert/strict");
const test = require("node:test");
const { shouldUseStaticImage } = require("../菜单UI/login-media-policy.js");

test("desktop Chromium browsers use the static login cover and skip audio keepalive", () => {
  assert.equal(shouldUseStaticImage("Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36"), true);
  assert.equal(shouldUseStaticImage("Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"), true);
  assert.equal(shouldUseStaticImage("Mozilla/5.0 Chromium/150.0.0.0 Safari/537.36"), true);
  assert.equal(shouldUseStaticImage("Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36 OPR/120.0.0.0"), true);
});

test("non-Chromium browsers retain configured login media", () => {
  assert.equal(shouldUseStaticImage("Mozilla/5.0 Firefox/140.0"), false);
  assert.equal(shouldUseStaticImage("Mozilla/5.0 Version/18.5 Safari/605.1.15"), false);
});
