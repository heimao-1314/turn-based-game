(function initLoginMediaRuntime(root, factory) {
  const policy = typeof module === "object" && module.exports
    ? require("./login-media-policy.js")
    : root?.LoginMediaPolicy;
  const api = factory(policy);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LoginMediaRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLoginMediaRuntime(policy) {
  const DEFAULT_VIDEO = "资源/图片/视频登录.mp4";
  const DEFAULT_STATIC_IMAGE = "资源/图片/登录封面.png";

  function releaseVideo(video) {
    if (!video || video.tagName !== "VIDEO") return;
    video.pause?.();
    video.removeAttribute("src");
    video.querySelectorAll?.("source").forEach((source) => source.remove());
    video.load?.();
  }

  function resolveMedia(visual = {}) {
    const isVideo = visual.mediaType === "video";
    const mediaSrc = String(visual.mediaSrc || "").trim() || (isVideo ? DEFAULT_VIDEO : DEFAULT_STATIC_IMAGE);
    return { mediaType: isVideo ? "video" : "image", mediaSrc };
  }

  function createMedia({ mediaType, mediaSrc }) {
    const isVideo = mediaType === "video";
    const media = document.createElement(isVideo ? "video" : "img");
    media.className = `cover-bg ${isVideo ? "cover-video" : "cover-image"}`;
    media.setAttribute("aria-hidden", "true");
    media.draggable = false;
    if (isVideo) {
      media.autoplay = true;
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = "metadata";
      media.setAttribute("webkit-playsinline", "true");
    } else {
      media.alt = "";
    }
    return media;
  }

  function replaceWithStaticFallback(stage, failed) {
    if (!stage || !failed || !failed.isConnected) return;
    if (failed.dataset?.fallbackDone === "1") return;
    releaseVideo(failed);
    const img = createMedia({ mediaType: "image", mediaSrc: DEFAULT_STATIC_IMAGE });
    img.dataset.fallbackDone = "1";
    img.src = DEFAULT_STATIC_IMAGE;
    failed.replaceWith(img);
  }

  function syncCoverMedia(stage, visual, active) {
    if (!stage || !visual) return;
    const { mediaType, mediaSrc } = resolveMedia(visual);
    let media = stage.querySelector(".cover-bg");
    const typeMatches = media && (mediaType === "video" ? media.tagName === "VIDEO" : media.tagName === "IMG");
    if (!typeMatches) {
      releaseVideo(media);
      media = createMedia({ mediaType, mediaSrc });
      stage.querySelector(".cover-bg")?.replaceWith(media);
    }
    media.onerror = () => replaceWithStaticFallback(stage, media);
    if (mediaType === "image") {
      if (media.getAttribute("src") !== mediaSrc) media.src = mediaSrc;
      return;
    }
    if (!active) {
      releaseVideo(media);
      return;
    }
    if (media.getAttribute("src") !== mediaSrc) {
      media.src = mediaSrc;
      media.load?.();
    }
    media.play?.().catch(() => replaceWithStaticFallback(stage, media));
  }

  function disposeCoverMedia(stage) {
    releaseVideo(stage?.querySelector?.(".cover-bg"));
  }

  return Object.freeze({ DEFAULT_STATIC_IMAGE, DEFAULT_VIDEO, disposeCoverMedia, releaseVideo, resolveMedia, syncCoverMedia });
});
