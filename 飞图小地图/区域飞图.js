(function () {
  const BASE = "assets/kdjl-map";
  const AREA_ART = {
    sgz: { img: "sgz", title: "闪光镇", scale: 1.5 },
    sgpy: { img: "sgpy", title: "闪光平原", scale: 1.5 },
    jlmg: { img: "jlmg", title: "精灵迷宫", scale: 1.5 }
  };
  const WORLD_SCALE = 1.5;
  let deps = {};
  let overlay = null;
  let mode = "area";
  let currentArea = "sgz";
  let selectedIndex = 0;
  let open = false;
  let dataLoaded = false;
  let mapPoints = { areas: {} };
  let worldPoints = { nodes: {} };
  let ignoreBackdropClickUntil = 0;
  let areaReturnMode = "close";

  function init(options) {
    deps = options || {};
    ensureOverlay();
    preloadData();
  }

  async function preloadData() {
    if (dataLoaded) return;
    try {
      const [mp, wp] = await Promise.all([
        fetch(`${BASE}/data/map-points.json`).then((r) => r.ok ? r.json() : { areas: {} }),
        fetch(`${BASE}/data/world-points.json`).then((r) => r.ok ? r.json() : { nodes: {} })
      ]);
      mapPoints = mp || { areas: {} };
      worldPoints = wp || { nodes: {} };
    } catch {
      mapPoints = { areas: {} };
      worldPoints = { nodes: {} };
    }
    dataLoaded = true;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    const host = deps.host || document.getElementById("gameScreen") || document.body;
    overlay = document.createElement("div");
    overlay.className = "region-fly-layer";
    host.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (performance.now() < ignoreBackdropClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target === overlay) close();
    });
    return overlay;
  }

  async function showArea(area = null, options = {}) {
    await preloadData();
    mode = "area";
    areaReturnMode = options.fromWorld ? "world" : "close";
    currentArea = area || currentRuntimeMap()?.world || currentArea || "sgz";
    selectedIndex = Math.max(0, areaTargets(currentArea).findIndex((target) => target.name === deps.getMapName?.()));
    show();
  }

  async function showWorld() {
    await preloadData();
    mode = "world";
    areaReturnMode = "world";
    selectedIndex = Math.max(0, worldTargets().findIndex((target) => target.area === (currentRuntimeMap()?.world || currentArea)));
    show();
  }

  function show() {
    ensureOverlay();
    open = true;
    ignoreBackdropClickUntil = performance.now() + 500;
    overlay.classList.add("active");
    render();
  }

  function close() {
    open = false;
    overlay?.classList.remove("active");
  }

  function isOpen() { return open; }

  function runtime() { return deps.getNewMapRuntime?.() || {}; }

  function currentRuntimeMap() {
    const name = deps.getMapName?.() || "";
    return runtime().byName?.get?.(name) || null;
  }

  function keyToName(key) {
    return runtime().nameByKey?.get?.(key) || runtime().byKey?.get?.(key)?.__gameName || key;
  }

  function worldTargets() {
    return Object.entries(worldPoints.nodes || {}).map(([area, node]) => ({
      area,
      label: node.name || area,
      x: Number(node.x) || 0,
      y: Number(node.y) || 0
    })).filter((item) => AREA_ART[item.area]);
  }

  function areaTargets(area) {
    const maps = mapPoints.areas?.[area]?.maps || {};
    return Object.entries(maps).map(([key, point]) => ({
      key,
      name: keyToName(key),
      label: point.title || runtime().byKey?.get?.(key)?.title || key,
      x: Number(point.x) || 0,
      y: Number(point.y) || 0
    }));
  }

  function targets() { return mode === "world" ? worldTargets() : areaTargets(currentArea); }

  function imageSrc() {
    if (mode === "world") return `${BASE}/assets/map-art/world.png`;
    return `${BASE}/assets/map-art/${AREA_ART[currentArea]?.img || "sgz"}.png`;
  }

  function render() {
    if (!overlay) return;
    const list = targets();
    const cfg = mode === "world" ? { title: "世界地图", scale: WORLD_SCALE } : AREA_ART[currentArea] || AREA_ART.sgz;
    const natural = mode === "world" ? { width: 176, height: 176 } : (mapPoints.areas?.[currentArea]?.imageSize || { width: 192, height: 208 });
    const scale = cfg.scale || 3;
    const stageW = natural.width * scale;
    const stageH = natural.height * scale;
    overlay.innerHTML = `
      <div class="region-fly-stage" role="application" aria-label="${escapeHtml(cfg.title)}" style="width:${stageW}px;height:${stageH}px">
        <img class="region-fly-image" src="${imageSrc()}" alt="" style="width:${stageW}px;height:${stageH}px">
        ${list.map((target, index) => `<button type="button" class="region-fly-hotspot" data-index="${index}" aria-label="${escapeHtml(target.label)}" style="left:${target.x * scale}px;top:${target.y * scale}px"></button>`).join("")}
        <i class="region-fly-selection" aria-hidden="true"></i>
        <i class="region-fly-current" aria-hidden="true"></i>
        <button type="button" class="region-fly-back">返回</button>
        <div class="region-fly-title">${escapeHtml(cfg.title)}${mode === "world" ? "：选择区域" : "：选择地图飞行"}</div>
      </div>`;
    overlay.querySelectorAll(".region-fly-hotspot").forEach((button) => {
      button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); });
      button.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        selectedIndex = Number(button.dataset.index) || 0;
        renderSelection();
        confirm();
      });
    });
    overlay.querySelector(".region-fly-back")?.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      goBack();
    });
    renderSelection();
  }

  function edgeSvg() {
    if (mode !== "area") return "";
    const area = mapPoints.areas?.[currentArea];
    if (!area?.edges?.length || !area.maps) return "";
    return area.edges.map((edge) => {
      const a = area.maps[edge.from], b = area.maps[edge.to];
      if (!a || !b) return "";
      if (edge.from === edge.to) return `<circle cx="${a.x + 6}" cy="${a.y - 6}" r="8" />`;
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    }).join("");
  }

  function renderSelection() {
    const list = targets();
    const target = list[selectedIndex] || list[0];
    const scale = mode === "world" ? WORLD_SCALE : (AREA_ART[currentArea]?.scale || 3);
    overlay.querySelectorAll(".region-fly-hotspot").forEach((button) => button.classList.toggle("active", Number(button.dataset.index) === selectedIndex));
    const selection = overlay.querySelector(".region-fly-selection");
    if (selection && target) {
      selection.style.left = `${target.x * scale - 14}px`;
      selection.style.top = `${target.y * scale - 14}px`;
    }
    const current = currentTarget();
    const currentIcon = overlay.querySelector(".region-fly-current");
    if (currentIcon) {
      currentIcon.classList.toggle("active", Boolean(current));
      if (current) {
        currentIcon.style.left = `${current.x * scale}px`;
        currentIcon.style.top = `${current.y * scale}px`;
      }
    }
  }

  function currentTarget() {
    if (mode === "world") return worldTargets().find((target) => target.area === currentRuntimeMap()?.world);
    const mapName = deps.getMapName?.() || "";
    return areaTargets(currentArea).find((target) => target.name === mapName);
  }

  async function confirm() {
    const target = targets()[selectedIndex];
    if (!target) return;
    if (mode === "world") {
      currentArea = target.area;
      await showArea(target.area, { fromWorld: true });
      return;
    }
    if ((deps.getMapName?.() || "") === target.name) {
      deps.showHint?.("已经在当前地图");
      return;
    }
    if (deps.isStallActive?.()) deps.stopStall?.(false);
    close();
    await deps.changeMap(target.name, "center", "center");
    await deps.savePlayerPosition?.(true);
    deps.showHint?.(`已飞行到${target.label}`);
  }

  function goBack() {
    if (mode === "area") {
      if (areaReturnMode === "world") showWorld();
      else close();
      return;
    }
    close();
  }

  function handleKey(key) {
    if (!open) return false;
    if (["up", "down", "left", "right"].includes(key)) return move(key);
    if (key === "confirm" || key === "nearby") { confirm(); return true; }
    if (key === "back") {
      goBack();
      return true;
    }
    return true;
  }

  function move(direction) {
    const list = targets();
    const current = list[selectedIndex] || list[0];
    if (!current) return true;
    const candidates = list.map((target, index) => ({ index, dx: target.x - current.x, dy: target.y - current.y })).filter((item) => item.index !== selectedIndex && (direction === "left" ? item.dx < 0 : direction === "right" ? item.dx > 0 : direction === "up" ? item.dy < 0 : item.dy > 0));
    if (!candidates.length) return true;
    const axis = direction === "left" || direction === "right" ? "dx" : "dy";
    const cross = axis === "dx" ? "dy" : "dx";
    candidates.sort((a, b) => Math.abs(a[cross]) / Math.max(1, Math.abs(a[axis])) + Math.abs(a[axis]) / 1000 - (Math.abs(b[cross]) / Math.max(1, Math.abs(b[axis])) + Math.abs(b[axis]) / 1000));
    selectedIndex = candidates[0].index;
    renderSelection();
    return true;
  }

  function shortLabel(label) {
    return String(label || "").replace(/^(闪光镇|闪光平原|精灵迷宫)/, "").slice(0, 4) || String(label || "?").slice(0, 2);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  window.RegionFlyMap = {
    init,
    open: showArea,
    openArea: showArea,
    openWorld: showWorld,
    close,
    isOpen,
    handleKey,
    move,
    confirm,
    targets: () => targets().slice()
  };
})();





