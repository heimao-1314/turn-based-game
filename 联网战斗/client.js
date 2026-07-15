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

  global.OnlineBattleClient = {
    roomWebSocketUrl
  };
})(window);
