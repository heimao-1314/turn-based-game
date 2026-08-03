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
  const SESSION_KEY = "loginMediaSession";

  // 每次重新加载/播放前递增会话号；releaseVideo 会清空它，
  // 从而让旧会话遗留的 error 事件 / play() 拒绝回调不再误触发回退替换。
  function sessionOf(media) {
    return Number(media?.dataset?.[SESSION_KEY]) || 0;
  }

  function isCurrentSession(media, session) {
    return !!media && media.isConnected && sessionOf(media) === session;
  }

  // 已回退为静态图且失败源与当前配置一致时，保持现状，
  // 避免反复重建 <video> 导致元素与解码资源堆积。
  function isStableFallback(media, mediaSrc) {
    return !!media && media.dataset?.fallbackDone === "1" && media.dataset.fallbackSrc === mediaSrc;
  }

  function releaseVideo(video) {
    if (!video || video.tagName !== "VIDEO") return;
    if (video.dataset) video.dataset[SESSION_KEY] = "";
    video.onerror = null;
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

  function replaceWithStaticFallback(stage, failed, failedSrc) {
    if (!stage || !failed || !failed.isConnected) return;
    if (failed.dataset?.fallbackDone === "1") return;
    releaseVideo(failed);
    const img = createMedia({ mediaType: "image", mediaSrc: DEFAULT_STATIC_IMAGE });
    img.dataset.fallbackDone = "1";
    if (failedSrc) img.dataset.fallbackSrc = failedSrc;
    img.src = DEFAULT_STATIC_IMAGE;
    failed.replaceWith(img);
  }

  function syncCoverMedia(stage, visual, active) {
    if (!stage || !visual) return;
    const { mediaType, mediaSrc } = resolveMedia(visual);
    let media = stage.querySelector(".cover-bg");
    const typeMatches = media && (mediaType === "video" ? media.tagName === "VIDEO" : media.tagName === "IMG");
    if (!typeMatches) {
      if (isStableFallback(media, mediaSrc)) return;
      releaseVideo(media);
      media = createMedia({ mediaType, mediaSrc });
      stage.querySelector(".cover-bg")?.replaceWith(media);
    }
    const session = sessionOf(media) + 1;
    media.dataset[SESSION_KEY] = String(session);
    media.onerror = () => {
      if (!isCurrentSession(media, session)) return;
      replaceWithStaticFallback(stage, media, mediaSrc);
    };
    if (mediaType === "image") {
      if (media.getAttribute("src") !== mediaSrc) {
        if (isStableFallback(media, mediaSrc)) return;
        media.src = mediaSrc;
      }
      return;
    }
    if (!active) {
      releaseVideo(media);
      return;
    }
    if (media.getAttribute("src") !== mediaSrc) {
      if (isStableFallback(media, mediaSrc)) return;
      media.src = mediaSrc;
      media.load?.();
    }
    media.play?.().catch(() => {
      if (!isCurrentSession(media, session)) return;
      replaceWithStaticFallback(stage, media, mediaSrc);
    });
  }

  function disposeCoverMedia(stage) {
    releaseVideo(stage?.querySelector?.(".cover-bg"));
  }

  return Object.freeze({ DEFAULT_STATIC_IMAGE, DEFAULT_VIDEO, disposeCoverMedia, releaseVideo, resolveMedia, syncCoverMedia });
});
