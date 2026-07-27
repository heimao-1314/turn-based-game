const REPLAY_INTERVAL_MS = 5000;

function createRewardDeliveryRuntime({ listPendingTickets, sendSocketJson, now = () => Date.now() }) {
  const nextReplayAtByConnection = new Map();

  function connectionKey(meta = {}) {
    return [meta.serverId || "", Number(meta.channelId) || 0, meta.account || "", meta.peerId || ""].join(":");
  }

  function replay(meta = {}, socket) {
    const account = String(meta.account || "");
    const peerId = String(meta.peerId || "");
    if (!account || !peerId || !socket) return 0;
    const key = connectionKey(meta);
    if ((nextReplayAtByConnection.get(key) || 0) > now()) return 0;
    nextReplayAtByConnection.set(key, now() + REPLAY_INTERVAL_MS);
    let tickets = [];
    try { tickets = listPendingTickets(account); } catch { return 0; }
    for (const ticket of tickets) {
      sendSocketJson(socket, {
        type: "teamBattleReward",
        battleId: ticket.battleId,
        to: peerId,
        roster: [],
        wildMonsterId: ticket.monsterId,
        monsterCount: ticket.monsterCount,
        rewardTicket: ticket.id,
        rewardId: ticket.id,
        recovered: true
      });
    }
    return tickets.length;
  }

  function handleDisconnect(meta = {}) {
    nextReplayAtByConnection.delete(connectionKey(meta));
  }

  return { replay, handleDisconnect };
}

module.exports = { createRewardDeliveryRuntime };
