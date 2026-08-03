/**
 * @file login-visual-editor.js
 * @description 管理后台「登录界面」封面按钮位置可视化编辑器。
 *
 * 在封面预览上直接拖拽：
 * - 「登录游戏」按钮：水平拖动改 hotspotLeft，垂直拖动改 positions[1]，右下角手柄调整宽高；
 * - 箭头：水平拖动改 arrowLeft；
 * - 5 个菜单标记：垂直拖动改 positions[0..4]。
 *
 * 职责：只负责预览渲染与拖拽交互，通过注入的 read/applyPartial 与表单双向同步。
 * 依赖：无；挂载为 window.LoginVisualEditor。
 */
(function initLoginVisualEditor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LoginVisualEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLoginVisualEditor() {
  const DEFAULT_POSITIONS = [64.0436, 70.3282, 76.3365, 82.5519, 88.9055];
  const HOTSPOT_INDEX = 1;
  const WATCH_SELECTORS = [
    "#loginHotspotLeftInput", "#loginHotspotWidthInput", "#loginHotspotHeightInput",
    "#loginArrowLeftInput", "#loginPos0Input", "#loginPos1Input", "#loginPos2Input",
    "#loginPos3Input", "#loginPos4Input", "#loginMediaTypeInput", "#loginMediaSrcInput"
  ];

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  }

  let active = null;

  function createEditor(options = {}) {
    const { read, applyPartial } = options;
    const preview = document.querySelector("#loginPreview");
    if (!preview || typeof read !== "function" || typeof applyPartial !== "function") {
      return { render() {} };
    }
    const mediaHost = preview.querySelector('[data-role="media"]');
    const hotspotEl = preview.querySelector('[data-role="hotspot"]');
    const arrowEl = preview.querySelector('[data-role="arrow"]');
    const posEls = Array.from(preview.querySelectorAll("[data-pos-index]"));

    function currentPositions(visual) {
      const positions = Array.isArray(visual.positions) ? visual.positions : DEFAULT_POSITIONS;
      return positions.map((value, index) => clamp(value, 0, 100));
    }

    function syncMedia(visual) {
      if (!mediaHost) return;
      const isVideo = visual.mediaType === "video";
      const src = String(visual.mediaSrc || "").trim();
      if (!src) return;
      const tag = isVideo ? "video" : "img";
      let el = mediaHost.firstElementChild;
      if (!el || el.tagName !== tag.toUpperCase() || el.getAttribute("src") !== src) {
        el = document.createElement(tag);
        el.className = "login-preview-media";
        el.alt = "";
        if (isVideo) {
          el.muted = true;
          el.autoplay = true;
          el.loop = true;
          el.playsInline = true;
        }
        mediaHost.replaceChildren(el);
        el.src = src;
      }
    }

    function render() {
      const visual = read();
      syncMedia(visual);
      const positions = currentPositions(visual);
      const left = clamp(visual.hotspotLeft, 0, 100);
      const width = clamp(visual.hotspotWidth, 5, 100);
      const height = clamp(visual.hotspotHeight, 2, 30);
      if (hotspotEl) {
        hotspotEl.style.left = `${left}%`;
        hotspotEl.style.top = `${positions[HOTSPOT_INDEX] ?? DEFAULT_POSITIONS[HOTSPOT_INDEX]}%`;
        hotspotEl.style.width = `${width}%`;
        hotspotEl.style.height = `${height}%`;
      }
      if (arrowEl) arrowEl.style.left = `${clamp(visual.arrowLeft, 0, 100)}%`;
      posEls.forEach((el, index) => {
        el.style.top = `${positions[index] ?? DEFAULT_POSITIONS[index]}%`;
      });
    }

    function attachDrag(handle, { get, set }) {
      let startX = 0;
      let startY = 0;
      let startValue = null;
      handle.addEventListener("pointerdown", (event) => {
        if (handle.closest?.("[data-role=\"hotspot\"]") && event.target !== handle && event.target?.closest?.("[data-handle]")) return;
        event.preventDefault();
        startX = event.clientX;
        startY = event.clientY;
        startValue = get();
        handle.setPointerCapture?.(event.pointerId);
        const onMove = (moveEvent) => {
          const rect = preview.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
          const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
          set(startValue, { dx, dy });
        };
        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
      });
    }

    function setPositions(start, dy, index) {
      const positions = currentPositions(read());
      positions[index] = clamp(Number(start) + dy, 0, 100);
      applyPartial({ positions });
    }

    if (hotspotEl) {
      attachDrag(hotspotEl, {
        get: () => ({
          left: Number(read().hotspotLeft),
          pos: Number(read().positions?.[HOTSPOT_INDEX] ?? DEFAULT_POSITIONS[HOTSPOT_INDEX])
        }),
        set: (start, { dx, dy }) => {
          const width = clamp(Number(read().hotspotWidth), 5, 100);
          applyPartial({
            hotspotLeft: round(clamp(start.left + dx, 0, 100 - width)),
            positions: setPositionsForIndex(start.pos + dy, HOTSPOT_INDEX)
          });
        }
      });
      const resizeHandle = hotspotEl.querySelector('[data-handle="resize-se"]');
      if (resizeHandle) {
        attachDrag(resizeHandle, {
          get: () => ({ width: Number(read().hotspotWidth), height: Number(read().hotspotHeight) }),
          set: (start, { dx, dy }) => {
            const left = clamp(Number(read().hotspotLeft), 0, 100);
            applyPartial({
              hotspotWidth: round(clamp(start.width + dx, 5, 100 - left)),
              hotspotHeight: round(clamp(start.height + dy, 2, 30))
            });
          }
        });
      }
    }

    if (arrowEl) {
      attachDrag(arrowEl, {
        get: () => Number(read().arrowLeft),
        set: (start, { dx }) => {
          applyPartial({ arrowLeft: round(clamp(start + dx, 0, 100)) });
        }
      });
    }

    posEls.forEach((el, index) => {
      attachDrag(el, {
        get: () => Number(read().positions?.[index] ?? DEFAULT_POSITIONS[index]),
        set: (start, { dy }) => {
          setPositions(start, dy, index);
        }
      });
    });

    function setPositionsForIndex(value, index) {
      const positions = currentPositions(read());
      positions[index] = clamp(Number(value), 0, 100);
      return positions;
    }

    WATCH_SELECTORS.forEach((selector) => {
      document.querySelector(selector)?.addEventListener("input", render);
    });

    render();
    active = { render };
    return active;
  }

  function render() {
    active?.render();
  }

  return Object.freeze({ createEditor, render });
});
