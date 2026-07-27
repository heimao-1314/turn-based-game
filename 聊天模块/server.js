"use strict";

const CHAT_MAX_LENGTH = 160;
const CHAT_COOLDOWN_MS = 800;
const CHAT_CHANNELS = new Set(["nearby", "server", "channel", "team", "whisper"]);

function normalizeText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, CHAT_MAX_LENGTH);
}

function createChatRuntime({ sockets, socketMeta, sendSocketJson, recordAnomalyOnce }) {
  const lastMessageAt = new WeakMap();

  function reject(socket, meta, error, detail = {}) {
    recordAnomalyOnce(meta.loginAccount || meta.account, `chat_${error}`, detail, 1, "reject", 60 * 1000);
    sendSocketJson(socket, { type: "chatError", error });
    return true;
  }

  function sameRealm(left, right) {
    return left.serverId === right.serverId && Number(left.channelId) === Number(right.channelId);
  }

  function recipientsFor(channel, sender, meta, targetPeerId) {
    if (channel === "whisper") {
      for (const socket of sockets) {
        const target = socketMeta.get(socket) || {};
        if (!socket.destroyed && target.peerId === targetPeerId && sameRealm(meta, target)) return [socket];
      }
      return [];
    }
    const teamPeerIds = new Set((meta.team?.members || []).map((member) => String(member?.peerId || "")).filter(Boolean));
    if (meta.team?.leaderId) teamPeerIds.add(String(meta.team.leaderId));
    const recipients = [];
    for (const socket of sockets) {
      const target = socketMeta.get(socket) || {};
      if (socket === sender || socket.destroyed || target.serverId !== meta.serverId) continue;
      if (channel === "channel" && Number(target.channelId) !== Number(meta.channelId)) continue;
      if (channel === "nearby" && (Number(target.channelId) !== Number(meta.channelId) || target.mapName !== meta.mapName)) continue;
      if (channel === "team" && !teamPeerIds.has(String(target.peerId || ""))) continue;
      recipients.push(socket);
    }
    return recipients;
  }

  function handleRoomMessage(data, socket) {
    if (!data || !["chat.send", "chat", "privateChat"].includes(data.type)) return false;
    const meta = socketMeta.get(socket) || {};
    const text = normalizeText(data.text);
    const legacyPrivate = data.type === "privateChat";
    const channel = legacyPrivate ? "whisper" : (data.type === "chat" ? "nearby" : String(data.channel || ""));
    if (!meta.account || !meta.peerId || !meta.name) return reject(socket, meta, "not_ready");
    if (!CHAT_CHANNELS.has(channel)) return reject(socket, meta, "bad_channel", { channel });
    if (!text) return reject(socket, meta, "empty_message");
    const now = Date.now();
    if (now - (lastMessageAt.get(socket) || 0) < CHAT_COOLDOWN_MS) return reject(socket, meta, "rate_limited");
    if (channel === "team" && !(meta.team?.leaderId || (meta.team?.members || []).length)) return reject(socket, meta, "not_in_team");
    const targetPeerId = String(data.to || "");
    if (channel === "whisper" && (!targetPeerId || targetPeerId === meta.peerId)) return reject(socket, meta, "bad_target");
    const recipients = recipientsFor(channel, socket, meta, targetPeerId);
    if (channel === "whisper" && !recipients.length) return reject(socket, meta, "target_offline");
    lastMessageAt.set(socket, now);
    const payload = {
      type: channel === "whisper" ? "privateChat" : "chat",
      channel,
      peerId: meta.peerId,
      name: meta.name,
      text,
      ...(channel === "whisper" ? { to: targetPeerId } : {})
    };
    recipients.forEach((recipient) => sendSocketJson(recipient, payload));
    return true;
  }

  return { handleRoomMessage };
}

module.exports = { createChatRuntime };
