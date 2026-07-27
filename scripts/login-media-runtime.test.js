const assert = require("node:assert/strict");
const test = require("node:test");
const { releaseVideo } = require("../菜单UI/login-media-runtime.js");

test("releasing a login video stops playback and detaches its media source", () => {
  const calls = [];
  const video = {
    tagName: "VIDEO",
    pause: () => calls.push("pause"),
    removeAttribute: (name) => calls.push(`remove:${name}`),
    querySelectorAll: () => [{ remove: () => calls.push("remove:source") }],
    load: () => calls.push("load")
  };

  releaseVideo(video);

  assert.deepEqual(calls, ["pause", "remove:src", "remove:source", "load"]);
});

test("releasing non-video media is a no-op", () => {
  const calls = [];
  releaseVideo({ tagName: "IMG", pause: () => calls.push("pause") });
  assert.deepEqual(calls, []);
});
