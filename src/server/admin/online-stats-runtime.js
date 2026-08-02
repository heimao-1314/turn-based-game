/**
 * @file online-stats-runtime.js
 * @description 在线人数统计运行时（服务端权威）
 *
 * 职责：
 * - 以服务端 socket 注册表（sockets + socketMeta）为唯一数据源计算
 *   每个服务器/线路的在线人数，不信任客户端上报。
 * - 同一账号多开是否去重、是否只统计已认证连接，由本模块内的
 *   统计口径决定（见 countsForServer 内注释）。
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
    const totalChannels = Math.max(1, Math.floor(Number(channelCount) || 1));
    const channelOnline = Array.from({ length: totalChannels }, () => 0);
    for (const socket of sockets) {
      if (!socket || socket.destroyed) continue;
      const meta = socketMeta.get(socket) || {};
      if (meta.serverId !== serverId) continue;
      const index = Math.floor(Number(meta.channelId) || 0) - 1;
      if (index >= 0 && index < channelOnline.length) channelOnline[index] += 1;
    }
    return {
      onlineCount: channelOnline.reduce((sum, count) => sum + count, 0),
      channels: channelOnline.map((onlineCount, index) => ({
        id: index + 1,
        name: `${index + 1}线`,
        onlineCount
      }))
    };
  }

  return { countsForServer };
}

module.exports = { createOnlineStatsRuntime };
