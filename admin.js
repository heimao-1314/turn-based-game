/**
 * @file admin.js
 * @description 管理后台 - 游戏运营管理的前端模块
 *
 * 模块架构:
 * - Core: 认证、API 调用、工具函数（HTML 转义、消息提示）
 * - Players: 玩家数据查询、编辑、封禁管理
 * - Rankings: 排行榜统计与展示
 * - Anomalies: 异常行为检测与告警
 * - Operations: 运营操作（兑换码、公告、奖励发放）
 * - Changelog: 变更日志管理
 * - System: 系统配置与监控
 * - Init: 页面初始化与事件绑定
 *
 * @requires fetch API, DOM API
 */


/* ============================================
   模块: Core - 认证、API、工具函数
   ============================================ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const Core = (() => {
  /* 认证信息（登录后缓存） */
  let auth = { account: "", password: "" };

  function getAccount() { return auth.account; }
  function getPassword() { return auth.password; }

  function setAuth(account, password) {
    auth = { account: String(account || "").trim(), password: String(password || "") };
  }
  function clearAuth() {
    auth = { account: "", password: "" };
  }

  /* 统一 API 调用 */
  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(auth.account ? { "x-admin-account": auth.account } : {}),
      "x-admin-password": auth.password,
      ...(options.headers || {})
    };
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({ ok: false, error: "bad_response" }));
    if (!res.ok || !data.ok) throw new Error(data.error || "request_failed");
    return data;
  }

  /* 将认证信息放入 body */
  function authBody(extra = {}) {
    const body = { adminPassword: auth.password, ...extra };
    if (auth.account) body.adminAccount = auth.account;
    return body;
  }

  /* 消息条 */
  let messageTimer = 0;
  function message(text, bad = false) {
    const el = $("#message");
    if (!el) return;
    el.textContent = text;
    el.style.color = bad ? "#ff8e8e" : "#8ef0a8";
    el.style.opacity = "1";
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { el.style.opacity = "0"; }, 4000);
  }

  /* HTML 转义 */
  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  /* 填充 select */
  function fillSelect(select, values, selectedValue) {
    select.innerHTML = values
      .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
      .join("");
    if (values.includes(selectedValue)) select.value = selectedValue;
  }

  return { getAccount, getPassword, setAuth, clearAuth, api, authBody, message, escapeHtml, fillSelect };
})();


/* ============================================
   模块: Players - 玩家列表与选择
   ============================================ */
const Players = (() => {
  let list = [];
  let selected = null;

  function getList() { return list; }
  function getSelected() { return selected; }
  function setSelected(val) { selected = val; }

  function playerKey(player = {}) {
    const direct = player.characterId || player.account;
    if (direct) return String(direct);
    return [player.ownerAccount, player.serverId, player.characterSlot]
      .map((value) => String(value ?? ""))
      .join(":");
  }

  function ownerAccountText(player = {}) {
    return String(player.ownerAccount || player.account || "未知账号");
  }

  function serverText(player = {}) {
    const id = String(player.serverId || "").trim();
    const name = String(player.serverName || "").trim();
    if (name && id && name !== id) return `${name} (${id})`;
    return name || id || "未分服";
  }

  function characterSlotText(player = {}) {
    const slot = player.characterSlot;
    return slot === undefined || slot === null || slot === "" ? "未分配" : `${slot}/3`;
  }

  function characterIdText(player = {}) {
    return String(player.characterId || player.account || "未知角色");
  }

  function matchesPlayer(player, key) {
    const value = String(key || "");
    return playerKey(player) === value
      || String(player.account || "") === value
      || String(player.ownerAccount || "") === value;
  }

  function commonIpText(player = {}) {
    const info = player.commonIp || {};
    if (!info.ip) return "常用IP：暂无记录";
    const region = info.region || "未知地区";
    const count = info.count || 0;
    const last = info.lastSeenAt ? ` / 最近 ${info.lastSeenAt}` : "";
    return `常用IP：${info.ip} / ${region} / ${count}次${last}`;
  }

  function render() {
    const el = $("#playerList");
    if (!el) return;
    const now = Date.now();
    el.innerHTML = list.map((p, index) => `
      <tr class="player-row ${selected && playerKey(selected) === playerKey(p) ? "selected" : ""}" data-player-key="${Core.escapeHtml(playerKey(p))}">
        <td><span class="status-dot ${isOnline(p, now) ? "status-online" : "status-offline"}"></span>${isOnline(p, now) ? "在线" : "离线"}</td>
        <td><div class="player-cell"><span class="cell-avatar avatar-tone-${index % 6}">${Core.escapeHtml(String(p.name || p.account || "P").charAt(0).toUpperCase())}</span><strong>${Core.escapeHtml(p.name || p.account)}${p.bannedAt ? "（已封）" : ""}</strong></div></td>
        <td>${Core.escapeHtml(ownerAccountText(p))}</td>
        <td><strong class="level-value">Lv. ${Number(p.level) || 1}</strong></td>
        <td>${Number(p.dragonSoul) || 1}</td>
        <td><strong class="silver-value">${formatNumber(p.silver)}</strong></td>
        <td><span class="ip-value" title="${Core.escapeHtml(p.commonIp?.ip || "暂无记录")}">${Core.escapeHtml(p.commonIp?.ip || "暂无记录")}</span></td>
        <td>${formatNumber(p.commonIp?.count)} 次</td>
        <td><span class="time-value">${Core.escapeHtml(formatTime(p.commonIp?.lastSeenAt || p.updatedAt))}</span></td>
      </tr>
    `).join("");
    el.querySelectorAll(".player-row").forEach((row) => {
      row.addEventListener("click", () => select(row.dataset.playerKey));
    });
  }

  function formatNumber(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("zh-CN");
  }

  function formatTime(value) {
    if (!value) return "暂无记录";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
  }

  function formatCompactNumber(value) {
    return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(Math.max(0, Number(value) || 0));
  }

  function isRecentlyOnline(player, now = Date.now()) {
    const seenAt = new Date(player.commonIp?.lastSeenAt || player.updatedAt || 0).getTime();
    return Number.isFinite(seenAt) && now - seenAt >= 0 && now - seenAt <= 10 * 60 * 1000;
  }

  /* 服务端权威在线标记优先；旧接口无该字段时退回最近活跃判断 */
  function isOnline(player, now = Date.now()) {
    if (typeof player.online === "boolean") return player.online;
    return isRecentlyOnline(player, now);
  }

  async function select(account) {
    if (!list.some((p) => matchesPlayer(p, account))) {
      try {
        const result = await Core.api(`/api/admin/players?q=${encodeURIComponent(account)}`, { method: "GET" });
        list = result.players || list;
      } catch { /* 降级：从排行/异常列表找 */ }
    }
    selected = list.find((p) => matchesPlayer(p, account))
      || Rankings.getList().find((p) => matchesPlayer(p, account))
      || Anomalies.getList().find((p) => matchesPlayer(p, account))
      || null;
    if (!selected) return;
    Operations.fillForm(selected);
    render();
    Rankings.render();
    Anomalies.render();
  }

  async function load() {
    try {
      const q = encodeURIComponent($("#searchInput").value.trim());
      const result = await Core.api(`/api/admin/players?q=${q}`, { method: "GET" });
      list = result.players || [];
      if (selected) selected = list.find((p) => playerKey(p) === playerKey(selected)) || null;
      render();
      const metric = $("#metricPlayers");
      if (metric) metric.textContent = String(list.length);
      const onlineMetric = $("#metricOnline");
      if (onlineMetric) onlineMetric.textContent = String(list.filter((player) => isOnline(player)).length);
      const silverMetric = $("#metricSilver");
      if (silverMetric) silverMetric.textContent = formatCompactNumber(list.reduce((total, player) => total + (Number(player.silver) || 0), 0));
      Core.message(`读取到 ${list.length} 个玩家`);
    } catch (err) {
      Core.message(`读取失败：${err.message}`, true);
    }
  }

  return {
    getList, getSelected, setSelected, render, select, load, commonIpText,
    ownerAccountText, serverText, characterSlotText, characterIdText, formatNumber, formatTime
  };
})();


/* ============================================
   模块: Servers - 服务器管理
   ============================================ */
const Servers = (() => {
  let list = [];
  let refreshTimer = 0;

  function isEnabled(server = {}) {
    if (server.enabled === undefined || server.enabled === null) {
      return String(server.status || "enabled").toLowerCase() !== "disabled";
    }
    return ![false, 0, "0", "false", "disabled"].includes(server.enabled);
  }

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function serverId(server = {}) {
    return String(server.id || server.serverId || "").trim();
  }

  function serverName(server = {}) {
    return String(server.name || server.serverName || serverId(server) || "未命名服务器").trim();
  }

  function render() {
    const el = $("#serverList");
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<tr class="empty-row"><td colspan="7">暂无服务器，请先创建服务器。</td></tr>';
      return;
    }

    el.innerHTML = list.map((server, index) => {
      const id = serverId(server);
      const enabled = isEnabled(server);
      const characterCount = count(server.characterCount ?? server.roleCount);
      const onlineCount = count(server.onlineCount ?? server.online);
      const channelCount = count(server.channelCount || 6) || 6;
      return `
        <tr class="server-row">
          <td><span class="status-dot ${enabled ? "status-online" : "status-offline"}"></span>${enabled ? "已启用" : "已停用"}</td>
          <td><div class="player-cell"><span class="cell-avatar avatar-tone-${index % 6}">S</span><strong>${Core.escapeHtml(serverName(server))}</strong></div></td>
          <td><span class="id-value">${Core.escapeHtml(id || "未提供")}</span></td>
          <td>${characterCount.toLocaleString("zh-CN")}</td>
          <td><strong class="online-value">${onlineCount.toLocaleString("zh-CN")}</strong></td>
          <td>${channelCount}</td>
          <td><button type="button" class="btn-sm ${enabled ? "btn-orange" : "btn-green"}" data-server-id="${Core.escapeHtml(id)}" data-server-enabled="${enabled ? "1" : "0"}" ${id ? "" : "disabled"}>${enabled ? "停用" : "启用"}</button></td>
        </tr>
      `;
    }).join("");

    el.querySelectorAll("[data-server-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const enabled = button.dataset.serverEnabled === "1";
        updateEnabled(button.dataset.serverId, !enabled);
      });
    });
  }

  async function load({ silent = false } = {}) {
    const el = $("#serverList");
    if (el && !list.length) el.innerHTML = '<tr class="empty-row"><td colspan="7">正在读取服务器列表...</td></tr>';
    try {
      const result = await Core.api("/api/admin/servers", { method: "GET" });
      list = Array.isArray(result.servers) ? result.servers : [];
      render();
      const updatedAtEl = $("#serverStatsUpdatedAt");
      if (updatedAtEl) updatedAtEl.textContent = `最近更新：${new Date().toLocaleTimeString()}`;
      if (!silent) Core.message(`已读取 ${list.length} 个服务器`);
    } catch (err) {
      if (el) el.innerHTML = `<tr class="empty-row"><td colspan="7">服务器列表读取失败：${Core.escapeHtml(err.message)}</td></tr>`;
      Core.message(`服务器列表读取失败：${err.message}`, true);
    }
  }

  async function create(event) {
    event?.preventDefault();
    const name = $("#serverNameInput")?.value.trim() || "";
    const id = $("#serverIdInput")?.value.trim() || "";
    if (!name) return Core.message("请输入服务器名称", true);

    const button = $("#createServerBtn");
    const previousText = button?.textContent || "新建服务器";
    if (button) {
      button.disabled = true;
      button.textContent = "创建中…";
    }
    try {
      const payload = { name };
      if (id) payload.id = id;
      const result = await Core.api("/api/admin/servers", {
        method: "POST",
        body: JSON.stringify(Core.authBody(payload))
      });
      $("#serverCreateForm")?.reset();
      await load({ silent: true });
      Core.message(`服务器“${serverName(result.server || payload)}”已创建`);
    } catch (err) {
      Core.message(`服务器创建失败：${err.message}`, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousText;
      }
    }
  }

  async function updateEnabled(id, enabled) {
    if (!id) return;
    const verb = enabled ? "启用" : "停用";
    if (!enabled && !confirm(`确定停用服务器 ${id} 吗？`)) return;
    try {
      await Core.api("/api/admin/servers/update", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ id, enabled }))
      });
      await load({ silent: true });
      Core.message(`服务器 ${id} 已${verb}`);
    } catch (err) {
      Core.message(`服务器${verb}失败：${err.message}`, true);
    }
  }

  /* 服务器页可见时每 5 秒静默刷新，保证在线人数实时 */
  function startAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = window.setInterval(() => {
      if (document.hidden) return;
      if ($("#app")?.classList.contains("hidden")) return;
      if (!$("#page-servers")?.classList.contains("active")) return;
      load({ silent: true });
    }, 5000);
  }

  return { load, create, render, startAutoRefresh };
})();


/* ============================================
   模块: Rankings - 属性排行榜
   ============================================ */
const Rankings = (() => {
  let list = [];

  function getList() { return list; }

  function statLabel(stat) {
    return ({
      power: "综合战力", hp: "生命", defense: "防御", speed: "速度",
      attack: "攻击", mana: "法力", crit: "致命", critDamage: "爆伤"
    })[stat] || stat;
  }

  function statLine(stats = {}) {
    return `攻 ${stats.attack || 0} / 血 ${stats.hp || 0} / 防 ${stats.defense || 0} / 速 ${stats.speed || 0} / 法 ${stats.mana || 0} / 致 ${stats.crit || 0} / 爆 ${stats.critDamage || 0}`;
  }

  function render() {
    const el = $("#rankingList");
    if (!el) return;
    const stat = $("#rankingStat")?.value || "power";
    el.innerHTML = list.length ? list.map((entry, i) => `
      <tr class="ranking-row ${entry.bannedAt ? "banned" : ""}" data-account="${Core.escapeHtml(entry.account)}">
        <td><span class="rank-number rank-${i + 1}">#${i + 1}</span></td>
        <td><div class="player-cell"><span class="cell-avatar avatar-tone-${i % 6}">${Core.escapeHtml(String(entry.name || entry.account || "P").charAt(0).toUpperCase())}</span><strong>${Core.escapeHtml(entry.name || entry.account)}${entry.bannedAt ? "（已封）" : ""}</strong></div></td>
        <td>${Core.escapeHtml(entry.account)}</td>
        <td><strong class="level-value">Lv. ${Number(entry.level) || 1}</strong></td>
        <td>${Number(entry.dragonSoul) || 1}</td>
        <td><strong class="rank-value">${Core.escapeHtml(statLabel(stat))} ${(Number(entry.value) || 0).toLocaleString("zh-CN")}</strong></td>
        <td><span class="detail-value" title="${Core.escapeHtml(statLine(entry.stats))}">${Core.escapeHtml(statLine(entry.stats))}</span></td>
      </tr>
    `).join("") : '<tr class="empty-row"><td colspan="7">暂无排行榜数据</td></tr>';
    el.querySelectorAll(".ranking-row").forEach((row) => {
      row.addEventListener("click", () => Players.select(row.dataset.account));
    });
  }

  async function load() {
    try {
      const stat = $("#rankingStat").value || "power";
      const result = await Core.api(`/api/admin/stat-rankings?stat=${encodeURIComponent(stat)}&limit=50`, { method: "GET" });
      list = result.rankings || [];
      render();
      Core.message(`已读取 ${list.length} 条${statLabel(stat)}排行`);
    } catch (err) {
      Core.message(`排行榜读取失败：${err.message}`, true);
    }
  }

  return { getList, render, load, statLabel };
})();


/* ============================================
   模块: Anomalies - 异常标记
   ============================================ */
const Anomalies = (() => {
  let list = [];

  function getList() { return list; }

  const typeLabels = {
    equipment_invalid: "装备数据异常", equipment_sanitized: "装备已修复",
    progress_invalid: "等级/经验异常", client_stats_tamper: "客户端属性篡改",
    client_pet_stats_tamper: "客户端宠物属性篡改", client_mercenary_stats_tamper: "客户端佣兵属性篡改",
    client_arena_stats_ignored: "客户端竞技场属性已忽略", client_equipment_reward_ignored: "客户端装备奖励已忽略",
    manual_ban: "手动封号", fashion_restored: "时装已恢复"
  };
  const actionLabels = {
    ws_state: "地图状态同步", scan: "检测", repair: "检测并修复",
    restore: "恢复", ban: "封号", ignore: "已忽略"
  };
  const reasonLabels = {
    bad_equipment_object: "装备数据不是有效对象，已丢弃",
    unknown_equipment_type: "装备类型不存在，已移除",
    demon_weapon_rewritten: "魔神武器属性与标准配置不一致，已重写",
    too_many_affixes: "装备词条数量超过上限，已裁剪",
    equipment_stats_rewritten: "装备主属性、强化值或非法固定属性不匹配，已重写",
    unknown_fashion_preserved: "未知时装，已保留并记录",
    duplicate_equipment_id: "装备 ID 重复，重复项已移除",
    invalid_equipped_slot: "已装备槽位与物品类型不匹配，已卸下",
    level_not_number: "等级不是数字", exp_not_number: "经验不是数字",
    level_out_of_range: "等级超出 1-100 范围", exp_negative: "经验小于 0",
    exp_exceeds_level_cap: "当前经验超过该等级升级上限"
  };

  function typeLabel(t) { return typeLabels[t] || t || "未知异常"; }
  function actionLabel(a) { return actionLabels[a] || a || ""; }

  function statDiffText(diff = {}) {
    return `${Rankings.statLabel(diff.key)}：客户端 ${diff.client} / 服务端 ${diff.server}`;
  }
  function equipmentSummary(eq = {}) {
    const parts = [];
    if (eq.name) parts.push(String(eq.name));
    if (eq.type) parts.push(`类型:${eq.type}`);
    if (eq.forgeLevel !== undefined) parts.push(`强化:+${eq.forgeLevel}`);
    if (eq.mainStat) parts.push(`${Rankings.statLabel(eq.mainStat)}+${eq.mainValue || 0}`);
    if (eq.id) parts.push(`ID:${eq.id}`);
    return parts.length ? parts.join(" / ") : "未知装备";
  }
  function reasonText(item = {}) {
    const text = reasonLabels[item.reason] || item.reason || "未知原因";
    const parts = [];
    if (item.target) parts.push(item.target);
    if (item.slot) parts.push(`槽位:${item.slot}`);
    if (item.type) parts.push(`类型:${item.type}`);
    if (item.id) parts.push(`ID:${item.id}`);
    if (item.field) parts.push(`字段:${item.field}`);
    if (item.value !== undefined) parts.push(`值:${item.value}`);
    if (item.limit !== undefined) parts.push(`上限:${item.limit}`);
    return parts.length ? `${text}（${parts.join(" / ")}）` : text;
  }
  function summary(detail = {}) {
    if (Array.isArray(detail.diffs) && detail.diffs.length) {
      const src = detail.source ? `来源：${actionLabel(detail.source)}。` : "";
      return `${src}客户端上报属性与服务端计算属性不一致：${detail.diffs.map(statDiffText).join("；")}`;
    }
    if (Array.isArray(detail.anomalies) && detail.anomalies.length) {
      return detail.anomalies.map(reasonText).join("；");
    }
    if (detail.equipment) return `客户端上传装备奖励已被忽略，服务端会重新生成掉落：${equipmentSummary(detail.equipment)}`;
    if (detail.reason) return reasonText(detail);
    return JSON.stringify(detail).slice(0, 120);
  }

  function render() {
    const el = $("#anomalyList");
    if (!el) return;
    el.innerHTML = list.length ? list.map((entry, index) => `
      <tr class="ranking-row ${entry.bannedAt ? "banned" : ""}" data-account="${Core.escapeHtml(entry.account)}">
        <td><span class="severity-badge severity-${Math.max(1, Math.min(5, Number(entry.severity) || 1))}">S${Number(entry.severity) || 1}</span></td>
        <td><div class="player-cell"><span class="cell-avatar avatar-tone-${index % 6}">${Core.escapeHtml(String(entry.name || entry.account || "P").charAt(0).toUpperCase())}</span><strong>${Core.escapeHtml(entry.name || entry.account)}${entry.bannedAt ? "（已封）" : ""}</strong></div></td>
        <td>${Core.escapeHtml(entry.account)}</td>
        <td><strong class="anomaly-type">${Core.escapeHtml(typeLabel(entry.type))}</strong></td>
        <td>${Core.escapeHtml(actionLabel(entry.action))}</td>
        <td><span class="time-value">${Core.escapeHtml(entry.createdAt || "暂无记录")}</span></td>
        <td><span class="detail-value anomaly-detail" title="${Core.escapeHtml(summary(entry.detail || {}))}">${Core.escapeHtml(summary(entry.detail || {}))}</span></td>
      </tr>
    `).join("") : '<tr class="empty-row"><td colspan="7">暂无异常标记</td></tr>';
    el.querySelectorAll(".ranking-row").forEach((row) => {
      row.addEventListener("click", () => Players.select(row.dataset.account));
    });
  }

  async function load() {
    try {
      const q = encodeURIComponent($("#searchInput").value.trim());
      const result = await Core.api(`/api/admin/anomalies?q=${q}&limit=100`, { method: "GET" });
      list = result.anomalies || [];
      render();
      Core.message(`已加载 ${list.length} 条异常标记`);
    } catch (err) {
      Core.message(`异常加载失败：${err.message}`, true);
    }
  }

  async function scan() {
    try {
      const result = await Core.api("/api/admin/scan-anomalies", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ repair: true }))
      });
      Core.message(`检测完成：发现 ${result.issueCount || 0} 个异常，已自动修复装备异常`);
      await Players.load();
      await load();
    } catch (err) {
      Core.message(`异常检测失败：${err.message}`, true);
    }
  }

  async function resetLevels() {
    if (!confirm("确定重置等级/经验异常的角色吗？正常角色不会被处理。")) return;
    try {
      const result = await Core.api("/api/admin/reset-abnormal-levels", {
        method: "POST",
        body: JSON.stringify(Core.authBody())
      });
      Core.message(`已重置 ${result.resetCount || 0} 个异常角色`);
      await Players.load();
    } catch (err) {
      Core.message(`异常等级重置失败：${err.message}`, true);
    }
  }

  return { getList, render, load, scan, resetLevels };
})();


/* ============================================
   模块: Operations - 玩家编辑/发放/封号
   ============================================ */
const Operations = (() => {
const roleCatalog = window.CareerTree.adminRoleCatalog;

  function currentSelection() {
    return {
      className: $("#classInput").value || window.CareerTree.INITIAL_CLASS,
      gender: $("#genderInput").value || "女",
      sub: $("#subInput").value || window.CareerTree.INITIAL_SUB
    };
  }
  function refreshSubInput(preferred = "") {
    const { className, gender } = currentSelection();
    const subs = roleCatalog[className]?.[gender] || roleCatalog[window.CareerTree.INITIAL_CLASS]["女"];
    Core.fillSelect($("#subInput"), subs, subs.includes(preferred) ? preferred : subs[0]);
  }
  function setRoleInputs(selection = {}) {
    const className = roleCatalog[selection.className] ? selection.className : window.CareerTree.INITIAL_CLASS;
    const gender = roleCatalog[className]?.[selection.gender] ? selection.gender : "女";
    Core.fillSelect($("#classInput"), Object.keys(roleCatalog), className);
    Core.fillSelect($("#genderInput"), ["女", "男"], gender);
    refreshSubInput(selection.sub);
  }

  /* 将选中玩家数据填入表单 */
  function fillForm(player) {
    const displayName = player.name || Players.characterIdText(player);
    const inspectorName = $("#inspectorName");
    const inspectorMeta = $("#inspectorMeta");
    const inspectorAvatar = $("#inspectorAvatar");
    if (inspectorName) inspectorName.textContent = displayName;
    if (inspectorMeta) inspectorMeta.textContent = `账号 ${Players.ownerAccountText(player)} · ${Players.serverText(player)}`;
    if (inspectorAvatar) inspectorAvatar.textContent = displayName.charAt(0).toUpperCase();
    const inspectorFields = {
      inspectorId: Players.characterIdText(player),
      inspectorLevel: `Lv. ${Number(player.level) || 1}`,
      inspectorDragon: String(Number(player.dragonSoul) || 1),
      inspectorSilver: Players.formatNumber(player.silver),
      inspectorIp: player.commonIp?.ip || "暂无记录",
      inspectorLogins: `${Players.formatNumber(player.commonIp?.count)} 次`,
      inspectorLastSeen: Players.formatTime(player.commonIp?.lastSeenAt || player.updatedAt)
    };
    Object.entries(inspectorFields).forEach(([id, value]) => {
      const field = $(`#${id}`);
      if (field) field.textContent = value;
    });
    $("#selectedPlayer").textContent = [
      displayName,
      `所属账号 ${Players.ownerAccountText(player)}`,
      `服务器 ${Players.serverText(player)}`,
      `角色槽 ${Players.characterSlotText(player)}`,
      `角色ID ${Players.characterIdText(player)}`,
      Players.commonIpText(player)
    ].join(" / ");
    $("#levelInput").value = player.level;
    $("#expInput").value = player.exp;
    $("#careerLevelInput").value = player.careerLevel || 1;
    $("#careerExpInput").value = player.careerExp || 0;
    $("#dragonSoulInput").value = player.dragonSoul;
    $("#petLevelInput").value = player.petLevel;
    $("#petExpInput").value = player.petExp;
    $("#silverInput").value = player.silver || 0;
    $("#yuanbaoInput").value = player.yuanbao || 0;
    setRoleInputs(player.selection || {});
  }

  /* 加载物品目录 */
  async function loadCatalog() {
    try {
      const result = await Core.api("/api/admin/catalog", { method: "GET" });
      const el = $("#itemSelect");
      if (el) el.innerHTML = (result.items || []).map((item) => `<option value="${item.id}">${Core.escapeHtml(item.name)}</option>`).join("");
    } catch (err) {
      Core.message(`目录读取失败：${err.message}`, true);
    }
  }

  /* 保存数值 */
  async function saveStats() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    try {
      await Core.api("/api/admin/update-player", {
        method: "POST",
        body: JSON.stringify(Core.authBody({
          targetAccount: sel.account,
          level: $("#levelInput").value,
          exp: $("#expInput").value,
          careerLevel: $("#careerLevelInput").value,
          careerExp: $("#careerExpInput").value,
          dragonSoul: $("#dragonSoulInput").value,
          petLevel: $("#petLevelInput").value,
          petExp: $("#petExpInput").value,
          silver: $("#silverInput").value,
          yuanbao: $("#yuanbaoInput").value,
          selection: currentSelection()
        }))
      });
      Core.message("数值已保存");
      await Players.load();
      await Anomalies.load();
    } catch (err) {
      Core.message(`保存失败：${err.message}`, true);
    }
  }

  /* 发放物品 */
  async function grantItem() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    try {
      await Core.api("/api/admin/grant-item", {
        method: "POST",
        body: JSON.stringify(Core.authBody({
          targetAccount: sel.account,
          itemId: $("#itemSelect").value,
          amount: $("#amountInput").value
        }))
      });
      Core.message("发放成功");
      await Players.load();
    } catch (err) {
      Core.message(`发放失败：${err.message}`, true);
    }
  }

  async function grantYuanbao() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    try {
      await Core.api("/api/admin/grant-yuanbao", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ targetAccount: sel.account, amount: $("#amountInput").value }))
      });
      Core.message("元宝发放成功");
      await Players.load();
    } catch (err) {
      Core.message(`元宝发放失败：${err.message}`, true);
    }
  }

  /* 清空物品 */
  async function clearItem() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    const itemId = $("#itemSelect").value;
    const itemName = $("#itemSelect").selectedOptions[0]?.textContent || itemId;
    if (!confirm(`确定清空 ${sel.name || sel.account} 的 ${itemName} 吗？`)) return;
    try {
      await Core.api("/api/admin/clear-item", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ targetAccount: sel.account, itemId }))
      });
      Core.message(`已清空 ${sel.account} 的 ${itemName}`);
      await Players.load();
    } catch (err) {
      Core.message(`清空物品失败：${err.message}`, true);
    }
  }

  /* 发放幻影称号 */
  async function grantPhantomTitle() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    try {
      const result = await Core.api("/api/admin/grant-phantom-title", {
        method: "POST",
        body: JSON.stringify(Core.authBody({
          targetAccount: sel.account,
          rank: $("#phantomTitleRankInput").value,
          durationDays: $("#phantomTitleDaysInput").value,
          equip: $("#phantomTitleEquipInput").checked
        }))
      });
      Core.message(`已发放 ${result.title} 给 ${sel.account}`);
      await Players.load();
    } catch (err) {
      Core.message(`发放幻影称号失败：${err.message}`, true);
    }
  }

  /* 重置密码 */
  async function resetPassword() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    const password = $("#resetPasswordInput").value;
    if (!password || password.length < 4 || password.length > 24) {
      return Core.message("新密码需要 4-24 位", true);
    }
    try {
      await Core.api("/api/admin/reset-password", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ targetAccount: sel.account, password }))
      });
      $("#resetPasswordInput").value = "";
      Core.message(`账号 ${sel.account} 数据库密码已重置`);
    } catch (err) {
      Core.message(`密码重置失败：${err.message}`, true);
    }
  }

  /* 重置幻影积分 */
  async function resetPhantomPoints() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    if (!confirm(`确定重置 ${sel.name || sel.account} 的幻影积分吗？`)) return;
    try {
      const result = await Core.api("/api/admin/reset-phantom-points", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ targetAccount: sel.account }))
      });
      Core.message(`已重置 ${sel.account} 的幻影积分，原积分 ${result.previousPoints || 0}`);
      await Players.load();
    } catch (err) {
      Core.message(`幻影积分重置失败：${err.message}`, true);
    }
  }

  /* 重置物品 */
  async function resetItems() {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    if (!confirm(`确定重置 ${sel.name || sel.account} 的物品吗？装备、仓库、材料、碎片、兑换券、宝箱、佣兵项链和宝珠都会清空。`)) return;
    try {
      await Core.api("/api/admin/reset-items", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ targetAccount: sel.account }))
      });
      Core.message(`已重置 ${sel.account} 的物品`);
      await Players.load();
    } catch (err) {
      Core.message(`物品重置失败：${err.message}`, true);
    }
  }

  /* 封号 / 解封 */
  async function setBan(banned) {
    const sel = Players.getSelected();
    if (!sel) return Core.message("请先选择玩家", true);
    const reason = banned ? prompt("封号原因", "装备属性异常") || "装备属性异常" : "";
    try {
      await Core.api(banned ? "/api/admin/ban-account" : "/api/admin/unban-account", {
        method: "POST",
        body: JSON.stringify(Core.authBody({ targetAccount: sel.account, reason }))
      });
      Core.message(`${sel.account} 已${banned ? "封号" : "解封"}`);
      await Players.load();
    } catch (err) {
      Core.message(`${banned ? "封号" : "解封"}失败：${err.message}`, true);
    }
  }

  return {
    setRoleInputs, fillForm, loadCatalog,
    saveStats, grantItem, grantYuanbao, clearItem, grantPhantomTitle,
    resetPassword, resetPhantomPoints, resetItems, setBan
  };
})();


/* ============================================
   模块: Changelog - 更新日志管理
   ============================================ */
const Changelog = (() => {
  async function load() {
    try {
      const result = await Core.api("/api/admin/changelog", { method: "GET" });
      const log = result.changelog || {};
      $("#changelogTitleInput").value = log.title || "更新日志";
      $("#changelogVersionInput").value = log.version || "";
      $("#changelogContentInput").value = log.content || "";
      $("#changelogEnabledInput").checked = log.enabled !== false;
    } catch (err) {
      Core.message(`更新日志读取失败：${err.message}`, true);
    }
  }

  async function save() {
    try {
      await Core.api("/api/admin/changelog", {
        method: "POST",
        body: JSON.stringify(Core.authBody({
          title: $("#changelogTitleInput").value,
          version: $("#changelogVersionInput").value,
          content: $("#changelogContentInput").value,
          enabled: $("#changelogEnabledInput").checked
        }))
      });
      Core.message("更新日志已保存");
    } catch (err) {
      Core.message(`更新日志保存失败：${err.message}`, true);
    }
  }

  return { load, save };
})();


/* ============================================
   模块: System - 全服操作
   ============================================ */
const System = (() => {
  function readScaleInput(id) {
    const number = Number($(id)?.value);
    if (!Number.isFinite(number)) return 1;
    return Math.max(0.5, Math.min(2.5, number));
  }

  function fillVisualForm(visual = {}) {
    $("#playerScaleInput").value = visual.playerScale ?? 1;
    $("#petScaleInput").value = visual.petScale ?? 1;
    $("#otherScaleInput").value = visual.otherScale ?? 1;
  }

  function fillLoginVisualForm(visual = {}) {
    const positions = Array.isArray(visual.positions) ? visual.positions : [64.0436, 70.3282, 76.3365, 82.5519, 88.9055];
    $("#loginVisualModeInput").value = visual.mode === "classic" ? "classic" : "cover";
    $("#loginMediaTypeInput").value = visual.mediaType === "image" ? "image" : "video";
    $("#loginMediaSrcInput").value = visual.mediaSrc || "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4";
    $("#loginHotspotLeftInput").value = visual.hotspotLeft ?? 65;
    $("#loginHotspotWidthInput").value = visual.hotspotWidth ?? 28;
    $("#loginHotspotHeightInput").value = visual.hotspotHeight ?? 5.2;
    $("#loginArrowLeftInput").value = visual.arrowLeft ?? 67.035;
    positions.forEach((value, index) => {
      const input = $(`#loginPos${index}Input`);
      if (input) input.value = value;
    });
  }

  function readLoginNumber(id, fallback, min, max) {
    const number = Number($(id)?.value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function readLoginVisualForm() {
    return {
      mode: $("#loginVisualModeInput").value === "classic" ? "classic" : "cover",
      mediaType: $("#loginMediaTypeInput").value === "image" ? "image" : "video",
      mediaSrc: $("#loginMediaSrcInput").value.trim() || "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4",
      hotspotLeft: readLoginNumber("#loginHotspotLeftInput", 65, 0, 100),
      hotspotWidth: readLoginNumber("#loginHotspotWidthInput", 28, 5, 100),
      hotspotHeight: readLoginNumber("#loginHotspotHeightInput", 5.2, 2, 30),
      arrowLeft: readLoginNumber("#loginArrowLeftInput", 67.035, 0, 100),
      positions: Array.from({ length: 5 }, (_, index) => readLoginNumber(`#loginPos${index}Input`, [64.0436, 70.3282, 76.3365, 82.5519, 88.9055][index], 0, 100))
    };
  }

  async function loadVisual() {
    try {
      const result = await Core.api("/api/admin/game-visual", { method: "GET" });
      fillVisualForm(result.visual || {});
    } catch (err) {
      Core.message(`模型大小读取失败：${err.message}`, true);
    }
  }

  async function saveVisual() {
    try {
      const result = await Core.api("/api/admin/game-visual", {
        method: "POST",
        body: JSON.stringify(Core.authBody({
          playerScale: readScaleInput("#playerScaleInput"),
          petScale: readScaleInput("#petScaleInput"),
          otherScale: readScaleInput("#otherScaleInput")
        }))
      });
      fillVisualForm(result.visual || {});
      Core.message("地图模型大小已保存");
    } catch (err) {
      Core.message(`模型大小保存失败：${err.message}`, true);
    }
  }

  async function resetVisual() {
    fillVisualForm({ playerScale: 1, petScale: 1, otherScale: 1 });
    await saveVisual();
  }

  async function loadLoginVisual() {
    try {
      const result = await Core.api("/api/admin/login-visual", { method: "GET" });
      fillLoginVisualForm(result.visual || {});
    } catch (err) {
      Core.message(`登录界面读取失败：${err.message}`, true);
    }
  }

  async function saveLoginVisual() {
    try {
      const result = await Core.api("/api/admin/login-visual", {
        method: "POST",
        body: JSON.stringify(Core.authBody(readLoginVisualForm()))
      });
      fillLoginVisualForm(result.visual || {});
      Core.message("\u767b\u5f55\u754c\u9762\u8bbe\u7f6e\u5df2\u4fdd\u5b58");
    } catch (err) {
      Core.message(`\u767b\u5f55\u754c\u9762\u4fdd\u5b58\u5931\u8d25\uff1a${err.message}`, true);
    }
  }

  async function resetLoginVisual() {
    fillLoginVisualForm({
      mode: "cover",
      mediaType: "video",
      mediaSrc: "\u8d44\u6e90/\u56fe\u7247/\u89c6\u9891\u767b\u5f55.mp4",
      hotspotLeft: 65,
      hotspotWidth: 28,
      hotspotHeight: 5.2,
      arrowLeft: 67.035,
      positions: [64.0436, 70.3282, 76.3365, 82.5519, 88.9055]
    });
    await saveLoginVisual();
  }

  async function resetArena() {
    if (!confirm("确定重置全服竞技场吗？")) return;
    try {
      await Core.api("/api/admin/reset-arena", {
        method: "POST",
        body: JSON.stringify(Core.authBody())
      });
      Core.message("竞技场已重置");
    } catch (err) {
      Core.message(`重置失败：${err.message}`, true);
    }
  }

  async function resetAllPhantom() {
    if (!confirm("确定清空全服幻影积分、全服背包幻影碎片和幻影排行榜吗？此操作不可恢复。")) return;
    if (!confirm("再次确认：所有玩家的幻影积分和幻影碎片都会归零。")) return;
    try {
      const result = await Core.api("/api/admin/reset-all-phantom", {
        method: "POST",
        body: JSON.stringify(Core.authBody())
      });
      Core.message(`已清空 ${result.playerCount || 0} 名玩家：原积分 ${result.previousPoints || 0}，原碎片 ${result.previousFragments || 0}`);
      await Players.load();
      await Rankings.load();
    } catch (err) {
      Core.message(`清空幻影数据失败：${err.message}`, true);
    }
  }

  return { loadVisual, saveVisual, resetVisual, loadLoginVisual, saveLoginVisual, resetLoginVisual, resetArena, resetAllPhantom };
})();


/* ============================================
   模块: GrowthConfig - 成长与经验配置
   ============================================ */
const GrowthConfig = (() => {
  let config = null;

  const STAT_LABELS = {
    attack: "攻击", hp: "生命", speed: "速度", mana: "法力", defense: "防御",
    energy: "能量", hit: "命中", dodge: "闪避", crit: "致命", critDamage: "爆伤"
  };
  const BASE_LABELS = {
    hp: "生命", defense: "防御", speed: "速度", attack: "攻击", mana: "法力", crit: "致命", critDamage: "爆伤"
  };

  function statPairHtml(prefix, stat, label, pair) {
    const base = Number(pair?.[0]) || 0;
    const per = Number(pair?.[1]) || 0;
    return `
      <div class="stat-pair">
        <div class="stat-name"><span>${Core.escapeHtml(label)}</span><small>基础 / 每级</small></div>
        <div class="pair-inputs">
          <label>基础值<input id="${prefix}-${stat}-base" type="number" min="0" step="any" value="${base}" /></label>
          <label>每级成长<input id="${prefix}-${stat}-per" type="number" min="0" step="any" value="${per}" /></label>
        </div>
      </div>
    `;
  }

  function statSingleHtml(prefix, stat, label, value) {
    return `
      <div class="stat-pair">
        <div class="stat-name"><span>${Core.escapeHtml(label)}</span><small>加成</small></div>
        <div class="pair-inputs">
          <label>数值<input id="${prefix}-${stat}" type="number" min="0" step="any" value="${Number(value) || 0}" /></label>
        </div>
      </div>
    `;
  }

  function render() {
    if (!config) return;
    const statKeys = Object.keys(STAT_LABELS);
    const baseKeys = Object.keys(BASE_LABELS);
    $("#growthCharacterGrid").innerHTML = statKeys.map((s) => statPairHtml("growth-character", s, STAT_LABELS[s], config.character?.growth?.[s])).join("");
    $("#growthDragonSoulGrid").innerHTML = baseKeys.map((s) => statSingleHtml("growth-dragon", s, BASE_LABELS[s], config.character?.dragonSoul?.[s])).join("");
    $("#growthPetGrid").innerHTML = statKeys.map((s) => statPairHtml("growth-pet", s, STAT_LABELS[s], config.pet?.growth?.[s])).join("");
    $("#growthMercenaryGrid").innerHTML = baseKeys.map((s) => statSingleHtml("growth-merc", s, BASE_LABELS[s], config.mercenary?.base?.[s])).join("");
    $("#mercMinFactorInput").value = config.mercenary?.minFactor ?? 0.1;
    $("#mercMaxFactorInput").value = config.mercenary?.maxFactor ?? 1;
    $("#growthExpTableInput").value = Array.isArray(config.expTable) ? config.expTable.slice(1).join("\n") : "";
  }

  function readNumber(id) {
    const selector = id.startsWith("#") ? id : `#${id}`;
    const value = Number($(selector)?.value);
    return Number.isFinite(value) ? value : 0;
  }

  function readPair(id) {
    return [readNumber(`${id}-base`), readNumber(`${id}-per`)];
  }

  function readConfig() {
    const statKeys = Object.keys(STAT_LABELS);
    const baseKeys = Object.keys(BASE_LABELS);
    const characterGrowth = {};
    statKeys.forEach((s) => { characterGrowth[s] = readPair(`growth-character-${s}`); });
    const petGrowth = {};
    statKeys.forEach((s) => { petGrowth[s] = readPair(`growth-pet-${s}`); });
    const dragonSoul = {};
    baseKeys.forEach((s) => { dragonSoul[s] = readNumber(`growth-dragon-${s}`); });
    const mercBase = {};
    baseKeys.forEach((s) => { mercBase[s] = readNumber(`growth-merc-${s}`); });
    const expLines = String($("#growthExpTableInput")?.value || "").split(/[\n,]+/).map((v) => v.trim()).filter((v) => v !== "");
    if (expLines.length !== 99) throw new Error(`升级经验表需要恰好 99 个数值（当前 ${expLines.length} 个）`);
    const expTable = [0];
    expLines.forEach((line) => {
      const num = Number(line);
      if (!Number.isFinite(num) || num < 1) throw new Error(`升级经验值必须为 ≥ 1 的数字：${line}`);
      expTable.push(Math.floor(num));
    });
    return {
      expTable,
      character: { growth: characterGrowth, dragonSoul },
      pet: { growth: petGrowth },
      mercenary: {
        base: mercBase,
        minFactor: readNumber("#mercMinFactorInput"),
        maxFactor: readNumber("#mercMaxFactorInput")
      }
    };
  }

  async function load() {
    try {
      const result = await Core.api("/api/admin/growth-config", { method: "GET" });
      config = result.config || null;
      render();
      Core.message("成长配置已载入");
    } catch (err) {
      Core.message(`成长配置读取失败：${err.message}`, true);
    }
  }

  async function save() {
    let payload;
    try {
      payload = readConfig();
    } catch (err) {
      return Core.message(err.message, true);
    }
    if (payload.mercenary.minFactor > payload.mercenary.maxFactor) {
      return Core.message("佣兵 1 级系数不能大于 100 级系数", true);
    }
    const button = $("#saveGrowthBtn");
    const previousText = button?.textContent || "保存全部配置";
    if (button) { button.disabled = true; button.textContent = "保存中…"; }
    try {
      const result = await Core.api("/api/admin/growth-config", {
        method: "POST",
        body: JSON.stringify(Core.authBody(payload))
      });
      config = result.config || payload;
      render();
      Core.message("成长配置已保存并全服生效");
    } catch (err) {
      Core.message(`保存失败：${err.message}`, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = previousText; }
    }
  }

  async function reset() {
    if (!confirm("确定恢复成长与经验配置为代码默认值吗？当前配置将被清空。")) return;
    if (!confirm("再次确认：恢复默认会覆盖当前保存的成长/经验数值。")) return;
    try {
      const result = await Core.api("/api/admin/growth-config/reset", {
        method: "POST",
        body: JSON.stringify(Core.authBody())
      });
      config = result.config || null;
      render();
      Core.message("已恢复默认成长与经验配置");
    } catch (err) {
      Core.message(`恢复默认失败：${err.message}`, true);
    }
  }

  return { load, save, reset };
})();


/* ============================================
   模块: Auth - 登录/登出
   ============================================ */
const Auth = (() => {
  function showLogin() {
    $("#loginScreen").classList.remove("hidden");
    $("#app").classList.add("hidden");
  }
  function showApp() {
    $("#loginScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#adminInfo").textContent = Core.getAccount()
      ? `账号: ${Core.getAccount()}`
      : "本机模式";
  }

  async function login() {
    const account = $("#loginAccount").value.trim();
    const password = $("#loginPassword").value;
    if (!password) {
      $("#loginError").textContent = "请输入口令";
      return;
    }
    Core.setAuth(account, password);
    $("#loginError").textContent = "";
    /* 尝试一次 API 来验证凭证 */
    try {
      await Core.api("/api/admin/catalog", { method: "GET" });
      showApp();
      Init.loadAll();
    } catch (err) {
      $("#loginError").textContent = `登录失败：${err.message}`;
      Core.clearAuth();
    }
  }

  function logout() {
    Core.clearAuth();
    showLogin();
    $("#loginPassword").value = "";
  }

  /* 本地自动登录（本机 + 默认口令） */
  async function tryAutoLogin() {
    Core.setAuth("", "admin123");
    try {
      await Core.api("/api/admin/catalog", { method: "GET" });
      showApp();
      Init.loadAll();
    } catch {
      Core.clearAuth();
      showLogin();
    }
  }

  return { login, logout, tryAutoLogin, showLogin, showApp };
})();


/* ============================================
   模块: Tabs - 标签切换
   ============================================ */
const Tabs = (() => {
  function init() {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab").forEach((t) => t.classList.remove("active"));
        $$(".tab-page").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $(`#page-${btn.dataset.tab}`)?.classList.add("active");
      });
    });
  }
  return { init };
})();


/* ============================================
   模块: Init - 初始化与事件绑定
   ============================================ */
const Init = (() => {
  function loadAll() {
    Operations.setRoleInputs();
    Operations.loadCatalog();
    Changelog.load();
    System.loadVisual();
    System.loadLoginVisual();
    GrowthConfig.load();
    Servers.load({ silent: true });
    Servers.startAutoRefresh();
    Players.load();
    Rankings.load();
    Anomalies.load();
  }

  function bindEvents() {
    /* 登录 */
    $("#loginBtn")?.addEventListener("click", Auth.login);
    $("#loginPassword")?.addEventListener("keydown", (e) => { if (e.key === "Enter") Auth.login(); });
    $("#logoutBtn")?.addEventListener("click", Auth.logout);

    /* 搜索 */
    $("#searchBtn")?.addEventListener("click", Players.load);
    $("#searchInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") Players.load(); });

    /* 服务器管理 */
    $("#serverCreateForm")?.addEventListener("submit", Servers.create);
    $("#loadServersBtn")?.addEventListener("click", () => Servers.load());

    /* 排行 */
    $("#loadRankingsBtn")?.addEventListener("click", Rankings.load);
    $("#rankingStat")?.addEventListener("change", Rankings.load);

    /* 异常 */
    $("#loadAnomaliesBtn")?.addEventListener("click", Anomalies.load);
    $("#scanAnomaliesBtn")?.addEventListener("click", Anomalies.scan);
    $("#scanAnomaliesBtn2")?.addEventListener("click", Anomalies.scan);
    $("#resetAbnormalLevelsBtn")?.addEventListener("click", Anomalies.resetLevels);
    $("#resetAbnormalLevelsBtn2")?.addEventListener("click", Anomalies.resetLevels);

    /* 玩家操作 */
    $("#saveStatsBtn")?.addEventListener("click", Operations.saveStats);
    $("#grantBtn")?.addEventListener("click", Operations.grantItem);
    $("#grantYuanbaoBtn")?.addEventListener("click", Operations.grantYuanbao);
    $("#clearItemBtn")?.addEventListener("click", Operations.clearItem);
    $("#grantPhantomTitleBtn")?.addEventListener("click", Operations.grantPhantomTitle);
    $("#resetPasswordBtn")?.addEventListener("click", Operations.resetPassword);
    $("#resetPasswordInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") Operations.resetPassword(); });
    $("#resetPhantomPointsBtn")?.addEventListener("click", Operations.resetPhantomPoints);
    $("#resetItemsBtn")?.addEventListener("click", Operations.resetItems);
    $("#banAccountBtn")?.addEventListener("click", () => Operations.setBan(true));
    $("#unbanAccountBtn")?.addEventListener("click", () => Operations.setBan(false));

    /* 角色选择联动 */
    const refreshSub = () => { const s = { className: $("#classInput").value, gender: $("#genderInput").value, sub: $("#subInput").value }; Operations.setRoleInputs(s); };
    $("#classInput")?.addEventListener("change", refreshSub);
    $("#genderInput")?.addEventListener("change", refreshSub);

    /* 更新日志 */
    $("#saveChangelogBtn")?.addEventListener("click", Changelog.save);

    /* 系统操作 */
    $("#resetArenaBtn")?.addEventListener("click", System.resetArena);
    $("#resetAllPhantomBtn")?.addEventListener("click", System.resetAllPhantom);
    $("#saveVisualBtn")?.addEventListener("click", System.saveVisual);
    $("#resetVisualBtn")?.addEventListener("click", System.resetVisual);
    $("#saveLoginVisualBtn")?.addEventListener("click", System.saveLoginVisual);
    $("#resetLoginVisualBtn")?.addEventListener("click", System.resetLoginVisual);
    /* 成长配置 */
    $("#loadGrowthBtn")?.addEventListener("click", GrowthConfig.load);
    $("#saveGrowthBtn")?.addEventListener("click", GrowthConfig.save);
    $("#resetGrowthBtn")?.addEventListener("click", GrowthConfig.reset);


  }

  return { loadAll, bindEvents };
})();


/* ============================================
   启动
   ============================================ */
document.addEventListener("DOMContentLoaded", () => {
  Tabs.init();
  Init.bindEvents();
  Auth.tryAutoLogin();
});
