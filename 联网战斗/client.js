/**
 * @file client.js
 * @description 联网战斗客户端工具 - 生成服务器 WebSocket 地址，兼容 IPv6。
 */
(function (global) {
  function bracketIpv6(hostname = "") {
    if (!hostname || hostname.startsWith("[") || !hostname.includes(":")) return hostname;
    return `[${hostname}]`;
  }

  function parseOrigin(origin, currentLocation) {
    const text = String(origin || "").trim();
    if (!text) return new URL(currentLocation.href);
    try {
      return new URL(text, currentLocation.href);
    } catch (error) {
      const match = text.match(/^(https?:)\/\/([^/]+)(\/.*)?$/i);
      if (!match || !match[2].includes(":") || match[2].startsWith("[")) throw error;
      let address = match[2];
      let port = "";
      const parts = address.split(":");
      const tail = parts[parts.length - 1];
      if (/^\d{2,5}$/.test(tail) && Number(tail) <= 65535) {
        port = tail;
        address = parts.slice(0, -1).join(":");
      }
      return new URL(`${match[1]}//[${address}]${port ? `:${port}` : ""}${match[3] || "/"}`);
    }
  }

  function roomWebSocketUrl(options = {}) {
    const currentLocation = options.location || global.location;
    const source = options.serverOrigin ?? global.APP_CONFIG?.serverOrigin ?? "";
    const url = parseOrigin(source, currentLocation);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const host = `${bracketIpv6(url.hostname)}${url.port ? `:${url.port}` : ""}`;
    const wsUrl = `${protocol}//${host}/room`;
    const token = options.token ? `token=${encodeURIComponent(options.token)}` : "";
    return token ? `${wsUrl}?${token}` : wsUrl;
  }

  function createHeartbeatRuntime(options = {}) {
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 10000);
    const timeoutMs = Math.max(intervalMs * 2, Number(options.timeoutMs) || 90000);
    const now = typeof options.now === "function" ? options.now : Date.now;
    let timer = null;
    let pendingPingAt = 0;

    function tick() {
      const socket = options.getSocket?.();
      if (!socket || socket.readyState !== 1) return;
      const currentTime = now();
      if (pendingPingAt && currentTime - pendingPingAt > timeoutMs) {
        options.onTimeout?.(socket);
        return;
      }
      if (pendingPingAt) return;
      try {
        socket.send(JSON.stringify({ type: "ping", peerId: options.getPeerId?.() || "", ts: currentTime }));
        pendingPingAt = currentTime;
      } catch {
        options.onSendError?.(socket);
      }
    }

    function start() {
      stop();
      tick();
      timer = global.setInterval(tick, intervalMs);
    }

    function stop() {
      if (timer) global.clearInterval(timer);
      timer = null;
      pendingPingAt = 0;
    }

    function markPong() {
      pendingPingAt = 0;
    }

    return { start, stop, markPong, tick };
  }

  global.OnlineBattleClient = {
    roomWebSocketUrl,
    createHeartbeatRuntime
  };
})(window);
