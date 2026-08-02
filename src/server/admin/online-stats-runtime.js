/**
 * @file online-stats-runtime.js
 * @description 在线人数统计运行时（服务端权威）
 *
 * 职责：
 * - 以服务端 socket 注册表（sockets + socketMeta）为唯一数据源计算
 *   每个服务器/线路的在线人数，不信任客户端上报。
 * - 统计口径：只统计已认证连接（meta.account 非空），同一账号多开
 *   只计 1 人（按 account 去重）；已销毁连接与无效线路号不计。
 *
 * 依赖注入：
 * - sockets: Set<net.Socket>  当前已建立且未销毁的连接
 * - socketMeta: Map<socket, meta>  连接元数据（account/serverId/channelId）
 *
 * 导出：
 * - createOnlineStatsRuntime(deps) -> { countsForServer }
 *   countsForServer(serverId, channelCount) ->
 *     { onlineCount, channels: [{ id, name, onlineCount }] }
 *
 * 安全说明：
 * - 本模块只读服务端状态，不写库、不产生经济影响；
 * - 统计口径变化必须同步 docs/API文档.md 的 onlineCount 语义。
 */

function createOnlineStatsRuntime({ sockets, socketMeta }) {
  if (!sockets || !socketMeta) throw new TypeError("online_stats_dependencies_required");

  /**
   * 计算指定服务器的分线路在线人数。
   * @param {string} serverId 服务器 ID（与 socketMeta.serverId 同源）
   * @param {number|string} channelCount 服务器配置的线路数
   * @returns {{ onlineCount: number, channels: Array<{id: number, name: string, onlineCount: number}> }}
   */
  function countsForServer(serverId, channelCount) {
    const normalizedServerId = String(serverId || "").trim();
    const totalChannels = Math.max(1, Math.floor(Number(channelCount) || 1));
    const accountsByChannel = Array.from({ length: totalChannels }, () => new Set());
    for (const socket of sockets) {
      if (!socket || socket.destroyed) continue;
      const meta = socketMeta.get(socket) || {};
      if (!meta || meta.serverId !== normalizedServerId) continue;
      const account = String(meta.account || "").trim();
      if (!account) continue;
      const channelIndex = Math.floor(Number(meta.channelId) || 0) - 1;
      if (channelIndex < 0 || channelIndex >= totalChannels) continue;
      accountsByChannel[channelIndex].add(account);
    }
    const channels = accountsByChannel.map((accounts, index) => ({
      id: index + 1,
      name: `${index + 1}线`,
      onlineCount: accounts.size
    }));
    return {
      onlineCount: channels.reduce((sum, channel) => sum + channel.onlineCount, 0),
      channels
    };
  }

  return { countsForServer };
}

module.exports = { createOnlineStatsRuntime };
