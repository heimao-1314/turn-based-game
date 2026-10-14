const assert = require("node:assert/strict");
const test = require("node:test");
const { releaseVideo, resolveMedia } = require("../菜单UI/login-media-runtime.js");

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

test("resolveMedia keeps the configured media type and src", () => {
  assert.deepEqual(resolveMedia({ mediaType: "video", mediaSrc: "资源/图片/视频登录.mp4" }), {
    mediaType: "video",
    mediaSrc: "资源/图片/视频登录.mp4"
  });
  assert.deepEqual(resolveMedia({ mediaType: "image", mediaSrc: "资源/图片/cover0.png" }), {
    mediaType: "image",
    mediaSrc: "资源/图片/cover0.png"
  });
});

test("resolveMedia falls back to per-type defaults when src is empty", () => {
  assert.deepEqual(resolveMedia({ mediaType: "video", mediaSrc: "" }), {
    mediaType: "video",
    mediaSrc: "资源/图片/视频登录.mp4"
  });
  assert.deepEqual(resolveMedia({ mediaType: "image", mediaSrc: "  " }), {
    mediaType: "image",
    mediaSrc: "资源/图片/登录封面.png"
  });
  assert.deepEqual(resolveMedia({}), {
    mediaType: "image",
    mediaSrc: "资源/图片/登录封面.png"
  });
});

test("releasing a video invalidates its session and clears stale error handlers", () => {
  const calls = [];
  const video = {
    tagName: "VIDEO",
    dataset: { loginMediaSession: "3" },
    onerror: () => calls.push("stale-error"),
    pause: () => calls.push("pause"),
    removeAttribute: (name) => calls.push(`remove:${name}`),
    querySelectorAll: () => [{ remove: () => calls.push("remove:source") }],
    load: () => calls.push("load")
  };

  releaseVideo(video);

  assert.equal(video.dataset.loginMediaSession, "");
  assert.equal(video.onerror, null);
  assert.deepEqual(calls, ["pause", "remove:src", "remove:source", "load"]);
});
