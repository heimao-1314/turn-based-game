(function initLoginMediaRuntime(root, factory) {
  const policy = typeof module === "object" && module.exports
    ? require("./login-media-policy.js")
    : root?.LoginMediaPolicy;
  const api = factory(policy);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LoginMediaRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLoginMediaRuntime(policy) {
  function releaseVideo(video) {
    if (!video || video.tagName !== "VIDEO") return;
    video.pause?.();
    video.removeAttribute("src");
    video.querySelectorAll?.("source").forEach((source) => source.remove());
    video.load?.();
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
      media.src = mediaSrc;
    }
    return media;
  }

  function syncCoverMedia(stage, visual, active) {
    if (!stage || !visual) return;
    const useStaticImage = policy?.shouldUseStaticImage?.(navigator.userAgent);
    const mediaType = useStaticImage || visual.mediaType === "image" ? "image" : "video";
    const mediaSrc = mediaType === "image" && useStaticImage
      ? "资源/图片/登录封面.png"
      : visual.mediaSrc;
    let media = stage.querySelector(".cover-bg");
    const typeMatches = media && (mediaType === "video" ? media.tagName === "VIDEO" : media.tagName === "IMG");
    if (!typeMatches) {
      releaseVideo(media);
      media = createMedia({ mediaType, mediaSrc });
      stage.querySelector(".cover-bg")?.replaceWith(media);
    }
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
    media.play?.().catch(() => {});
  }

  function disposeCoverMedia(stage) {
    releaseVideo(stage?.querySelector?.(".cover-bg"));
  }

  return Object.freeze({ disposeCoverMedia, releaseVideo, syncCoverMedia });
});
