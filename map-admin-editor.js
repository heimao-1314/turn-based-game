(function () {
  "use strict";

  const state = {
    context: null,
    manifest: null,
    enabled: false,
    selecting: "from",
    dragging: false,
    dragStart: null,
    dragCurrent: null
  };

  function init(context) {
    state.context = context;
    ensureUi();
    bindEvents();
  }

  function setAdmin(enabled) {
    state.enabled = Boolean(enabled);
    const panel = document.querySelector("#mapAdminPanel");
    const toggle = document.querySelector("#mapAdminToggle");
    if (toggle) toggle.hidden = !state.enabled;
    if (panel && !state.enabled) panel.classList.remove("active");
  }

  async function setManifest(manifest) {
    state.manifest = manifest;
    renderSelects();
    renderPortalList();
  }

  function ensureUi() {
    if (document.querySelector("#mapAdminPanel")) return;
    const toggle = document.createElement("button");
    toggle.id = "mapAdminToggle";
    toggle.className = "map-admin-toggle";
    toggle.type = "button";
    toggle.hidden = true;
    toggle.textContent = "地图";

    const panel = document.createElement("section");
    panel.id = "mapAdminPanel";
    panel.className = "map-admin-panel";
    panel.innerHTML = `
      <header>
        <strong>地图传送编辑</strong>
        <button id="mapAdminClose" type="button">关闭</button>
      </header>
      <div class="map-admin-status" id="mapAdminStatus">请选择入口或目标区域</div>
      <div class="map-admin-grid">
        <label>入口地图<select id="mapAdminFrom"></select></label>
        <label>目标地图<select id="mapAdminTo"></select></label>
        <label>入口 X<input id="mapAdminFromX" type="number" min="0" inputmode="numeric" /></label>
        <label>入口 Y<input id="mapAdminFromY" type="number" min="0" inputmode="numeric" /></label>
        <label>入口 宽<input id="mapAdminFromW" type="number" min="1" inputmode="numeric" value="1" /></label>
        <label>入口 高<input id="mapAdminFromH" type="number" min="1" inputmode="numeric" value="1" /></label>
        <label>目标 X<input id="mapAdminToX" type="number" min="0" inputmode="numeric" /></label>
        <label>目标 Y<input id="mapAdminToY" type="number" min="0" inputmode="numeric" /></label>
        <label>目标 宽<input id="mapAdminToW" type="number" min="1" inputmode="numeric" value="1" /></label>
        <label>目标 高<input id="mapAdminToH" type="number" min="1" inputmode="numeric" value="1" /></label>
      </div>
      <div class="map-admin-actions">
        <button id="mapAdminPickFrom" type="button">框选入口</button>
        <button id="mapAdminPickTo" type="button">框选目标</button>
        <button id="mapAdminAdd" type="button">新增双向传送</button>
        <button id="mapAdminScan" type="button">扫描新地图</button>
      </div>
      <div id="mapAdminList" class="map-admin-list"></div>
    `;

    const game = document.querySelector("#gameScreen") || document.body;
    game.appendChild(toggle);
    game.appendChild(panel);
  }

  function bindEvents() {
    document.querySelector("#mapAdminToggle")?.addEventListener("click", () => {
      document.querySelector("#mapAdminPanel")?.classList.toggle("active");
      refreshCurrentPosition();
    });
    document.querySelector("#mapAdminClose")?.addEventListener("click", () => {
      document.querySelector("#mapAdminPanel")?.classList.remove("active");
    });
    document.querySelector("#mapAdminPickFrom")?.addEventListener("click", () => beginPick("from"));
    document.querySelector("#mapAdminPickTo")?.addEventListener("click", () => beginPick("to"));
    document.querySelector("#mapAdminFrom")?.addEventListener("change", () => switchSelectedMap("from"));
    document.querySelector("#mapAdminTo")?.addEventListener("change", () => switchSelectedMap("to"));
    document.querySelector("#mapAdminAdd")?.addEventListener("click", addPortal);
    document.querySelector("#mapAdminScan")?.addEventListener("click", scanMaps);
  }

  function isActive() {
    return state.enabled && document.querySelector("#mapAdminPanel")?.classList.contains("active");
  }

  function onCanvasPointerDown(tile) {
    if (!isActive()) return false;
    state.dragging = true;
    state.dragStart = tile;
    state.dragCurrent = tile;
    setStatus(`${labelFor(state.selecting)}框选中 ${tile.mapName} (${tile.x}, ${tile.y})`);
    return true;
  }

  function onCanvasPointerMove(tile) {
    if (!isActive() || !state.dragging) return false;
    state.dragCurrent = tile;
    const rect = rectFromPoints(state.dragStart, state.dragCurrent);
    setStatus(`${labelFor(state.selecting)}区域 ${rect.mapName} (${rect.x}, ${rect.y}) ${rect.w}x${rect.h}`);
    return true;
  }

  function onCanvasPointerUp(tile) {
    if (!isActive() || !state.dragging) return false;
    state.dragging = false;
    state.dragCurrent = tile || state.dragCurrent;
    const rect = rectFromPoints(state.dragStart, state.dragCurrent);
    fillRange(state.selecting, rect);
    state.selecting = state.selecting === "from" ? "to" : "from";
    state.dragStart = null;
    state.dragCurrent = null;
    return true;
  }

  function onCanvasTileClick(tile) {
    if (!isActive()) return false;
    fillRange(state.selecting, { mapName: tile.mapName, x: tile.x, y: tile.y, w: 1, h: 1 });
    state.selecting = state.selecting === "from" ? "to" : "from";
    return true;
  }

  async function beginPick(kind) {
    state.selecting = kind;
    await switchSelectedMap(kind);
    setStatus(`请拖拽框选${labelFor(kind)}区域，单击也可选择 1 格`);
  }

  async function switchSelectedMap(kind) {
    const select = document.querySelector(kind === "from" ? "#mapAdminFrom" : "#mapAdminTo");
    const mapName = select?.value || "";
    if (!mapName || !state.context?.switchMap) return;
    state.selecting = kind;
    try {
      await state.context.switchMap(mapName);
      setStatus(`已切换到${mapName}，请框选${labelFor(kind)}区域`);
    } catch (error) {
      setStatus(`切换地图失败：${error.message || error}`);
    }
  }

  function refreshCurrentPosition() {
    if (!state.context) return;
    const pos = state.context.currentTile();
    setStatus(`当前位置 ${pos.mapName} (${pos.x}, ${pos.y})`);
  }

  function fillRange(kind, rect) {
    const prefix = kind === "to" ? "mapAdminTo" : "mapAdminFrom";
    setInput(`${prefix}X`, rect.x);
    setInput(`${prefix}Y`, rect.y);
    setInput(`${prefix}W`, rect.w);
    setInput(`${prefix}H`, rect.h);
    const select = document.querySelector(kind === "to" ? "#mapAdminTo" : "#mapAdminFrom");
    if (select) select.value = rect.mapName;
    setStatus(`${labelFor(kind)}区域 ${rect.mapName} (${rect.x}, ${rect.y}) ${rect.w}x${rect.h}`);
  }

  async function addPortal() {
    const from = rangeFromInputs("from");
    const to = rangeFromInputs("to");
    if (!from.mapName || !to.mapName) return setStatus("请先选择入口和目标地图");
    const pairs = buildPairs(from, to);
    if (!pairs.length) {
      setStatus("入口和目标区域数量需要一致；或其中一边只选 1 格");
      return;
    }
    const baseId = `admin-${Date.now()}`;
    const additions = [];
    pairs.forEach((pair, index) => {
      const id = `${baseId}-${index}`;
      additions.push({
        id,
        from: from.mapName,
        x: pair.from.x,
        y: pair.from.y,
        direction: "*",
        to: to.mapName,
        toX: pair.to.x,
        toY: pair.to.y,
        note: "管理员可视化新增"
      });
      additions.push({
        id: `${id}-back`,
        from: to.mapName,
        x: pair.to.x,
        y: pair.to.y,
        direction: "*",
        to: from.mapName,
        toX: pair.from.x,
        toY: pair.from.y,
        note: "管理员可视化新增-自动反向"
      });
    });
    const next = [...(state.manifest?.portals || []), ...additions];
    const manifest = await state.context.savePortals(next);
    await setManifest(manifest);
    setStatus(`已新增 ${pairs.length} 组双向传送`);
  }

  async function removePortal(id) {
    const baseId = basePortalId(id);
    const next = (state.manifest?.portals || []).filter((portal) => basePortalId(portal.id) !== baseId);
    const manifest = await state.context.savePortals(next);
    await setManifest(manifest);
    setStatus("已删除传送连接");
  }

  async function scanMaps() {
    const manifest = await state.context.scanMaps();
    await setManifest(manifest);
    setStatus("已扫描资源/地图目录");
  }

  function renderSelects() {
    const fromValue = value("mapAdminFrom");
    const toValue = value("mapAdminTo");
    const maps = state.manifest?.maps || [];
    const html = maps.map((map) => `<option value="${escapeHtml(map.name)}">${escapeHtml(map.name)}</option>`).join("");
    const from = document.querySelector("#mapAdminFrom");
    const to = document.querySelector("#mapAdminTo");
    if (from) {
      from.innerHTML = html;
      if (fromValue && maps.some((map) => map.name === fromValue)) from.value = fromValue;
    }
    if (to) {
      to.innerHTML = html;
      if (toValue && maps.some((map) => map.name === toValue)) to.value = toValue;
    }
  }

  function renderPortalList() {
    const list = document.querySelector("#mapAdminList");
    if (!list) return;
    const portals = (state.manifest?.portals || []).filter((portal) => !String(portal.id || "").endsWith("-back"));
    list.innerHTML = portals.length ? portals.map((portal) => `
      <div class="map-admin-row">
        <span>${escapeHtml(portal.from)} (${portal.x},${portal.y}) <-> ${escapeHtml(portal.to)} (${portal.toX},${portal.toY})</span>
        <button type="button" data-remove="${escapeHtml(portal.id)}">删</button>
      </div>
    `).join("") : "<p>暂无传送连接</p>";
    list.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => removePortal(button.dataset.remove));
    });
  }

  function rectFromPoints(a, b) {
    if (!a || !b) return { mapName: a?.mapName || b?.mapName || "", x: 0, y: 0, w: 1, h: 1 };
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return { mapName: a.mapName, x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
  }

  function rangeFromInputs(kind) {
    const prefix = kind === "to" ? "mapAdminTo" : "mapAdminFrom";
    return {
      mapName: value(prefix),
      x: numberValue(`${prefix}X`),
      y: numberValue(`${prefix}Y`),
      w: positiveNumberValue(`${prefix}W`),
      h: positiveNumberValue(`${prefix}H`)
    };
  }

  function buildPairs(from, to) {
    const fromCells = cellsInRange(from);
    const toCells = cellsInRange(to);
    if (fromCells.length === toCells.length) return fromCells.map((cell, index) => ({ from: cell, to: toCells[index] }));
    if (toCells.length === 1) return fromCells.map((cell) => ({ from: cell, to: toCells[0] }));
    if (fromCells.length === 1) return toCells.map((cell) => ({ from: fromCells[0], to: cell }));
    return [];
  }

  function cellsInRange(range) {
    const cells = [];
    for (let y = 0; y < range.h; y += 1) {
      for (let x = 0; x < range.w; x += 1) {
        cells.push({ x: range.x + x, y: range.y + y });
      }
    }
    return cells;
  }

  function basePortalId(id) {
    const value = String(id || "");
    return value.endsWith("-back") ? value.slice(0, -5) : value;
  }

  function labelFor(kind) {
    return kind === "to" ? "目标" : "入口";
  }

  function setStatus(text) {
    const el = document.querySelector("#mapAdminStatus");
    if (el) el.textContent = text;
  }

  function value(id) {
    return document.querySelector(`#${id}`)?.value || "";
  }

  function numberValue(id) {
    return Math.max(0, Math.floor(Number(value(id)) || 0));
  }

  function positiveNumberValue(id) {
    return Math.max(1, Math.floor(Number(value(id)) || 1));
  }

  function setInput(id, value) {
    const input = document.querySelector(`#${id}`);
    if (input) input.value = value;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  window.MapAdminEditor = {
    init,
    setAdmin,
    setManifest,
    onCanvasTileClick,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp
  };
})();
