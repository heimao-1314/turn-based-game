/**
 * Server-authoritative team membership runtime.
 * Team identity is bound to authenticated accounts; peerId only addresses
 * the account's current WebSocket connection.
 */
function createTeamRuntime(deps) {
  const teams = new Map();
  const memberLeaders = new Map();
  const pendingInvites = new Map();
  const pendingDisconnects = new Map();
  const INVITE_TTL_MS = 30_000;
  const MAX_MEMBERS = 3;
  const requestedDisconnectGraceMs = Number(deps.disconnectGraceMs);
  const disconnectGraceMs = Number.isFinite(requestedDisconnectGraceMs)
    ? Math.max(0, requestedDisconnectGraceMs)
    : 15_000;

  function realmKey(meta = {}) {
    return `${String(meta.serverId || "")}:${Math.floor(Number(meta.channelId) || 0)}`;
  }

  function accountKey(account, meta = {}) {
    return `${realmKey(meta)}:${String(account || "")}`;
  }

  function teamKey(leaderAccount, meta = {}) {
    return accountKey(leaderAccount, meta);
  }

  function inviteKey(requesterAccount, leaderAccount, meta = {}) {
    return `${realmKey(meta)}:${String(requesterAccount || "")}:${String(leaderAccount || "")}`;
  }

  function send(socket, payload) {
    if (socket && !socket.destroyed) deps.sendSocketJson(socket, payload);
  }

  function socketForAccount(account, realm) {
    if (!account || typeof deps.findSocketByAccount !== "function") return null;
    const socket = deps.findSocketByAccount(account, realm);
    return socket && !socket.destroyed ? socket : null;
  }

  function peerSocket(peerId, realm) {
    if (!peerId) return null;
    const socket = deps.findSocketByPeerId(peerId, realm);
    return socket && !socket.destroyed ? socket : null;
  }

  function metaForAccount(account, realm) {
    const socket = socketForAccount(account, realm);
    return socket ? deps.getSocketMeta(socket) || null : null;
  }

  function publicMember(member, realm) {
    const meta = metaForAccount(member?.account, realm);
    if (!meta?.peerId) return null;
    return {
      peerId: meta.peerId,
      account: meta.account || member.account || "",
      name: meta.name || member.name || meta.account || member.account || ""
    };
  }

  function publicMembers(team, realm) {
    return (team?.members || []).map((member) => publicMember(member, realm)).filter(Boolean);
  }

  function applyTeamMeta(meta, account, team, realm) {
    if (!team) {
      meta.team = { leaderId: "", members: [] };
      meta.leaderId = "";
      meta.teamLeaderAccount = "";
      return meta;
    }
    meta.team = {
      leaderId: team.leaderId || "",
      members: publicMembers(team, realm)
    };
    meta.leaderId = account === team.leaderAccount ? "" : team.leaderId || "";
    meta.teamLeaderAccount = team.leaderAccount;
    return meta;
  }

  function clearTeamMetaForAccount(account, realm) {
    const socket = socketForAccount(account, realm);
    if (!socket) return;
    const meta = deps.getSocketMeta(socket) || {};
    applyTeamMeta(meta, account, null, realm);
    deps.setSocketMeta(socket, meta);
  }

  function teamForLeader(leaderAccount, realm) {
    return teams.get(teamKey(leaderAccount, realm)) || null;
  }

  function memberLeaderAccount(account, realm) {
    return memberLeaders.get(accountKey(account, realm)) || "";
  }

  function accountHasTeam(account, realm) {
    return Boolean(memberLeaderAccount(account, realm) || teamForLeader(account, realm));
  }

  function updateMemberConnection(team, account, meta) {
    const member = team?.members?.find((item) => item.account === account);
    if (!member) return;
    member.peerId = meta.peerId || member.peerId || "";
    member.name = meta.name || meta.account || member.name || account;
  }

  function syncTeam(leaderAccount, realm) {
    const team = teamForLeader(leaderAccount, realm);
    if (!team) return;

    const leaderSocket = socketForAccount(team.leaderAccount, realm);
    const leaderMeta = leaderSocket ? deps.getSocketMeta(leaderSocket) || {} : null;
    if (leaderMeta?.peerId) {
      team.leaderId = leaderMeta.peerId;
      team.leaderName = leaderMeta.name || leaderMeta.account || team.leaderName || "";
    }
    for (const member of team.members) {
      const memberMeta = metaForAccount(member.account, realm);
      if (memberMeta) updateMemberConnection(team, member.account, memberMeta);
    }

    const members = publicMembers(team, realm);
    const accounts = [team.leaderAccount, ...team.members.map((member) => member.account)];
    for (const account of new Set(accounts.filter(Boolean))) {
      const socket = socketForAccount(account, realm);
      if (!socket) continue;
      const meta = deps.getSocketMeta(socket) || {};
      applyTeamMeta(meta, account, team, realm);
      deps.setSocketMeta(socket, meta);
      send(socket, {
        type: "teamUpdate",
        to: meta.peerId,
        leaderId: team.leaderId || "",
        leaderName: team.leaderName || "",
        members
      });
    }
  }

  function reject(socket, error) {
    send(socket, { type: "teamRejected", error });
  }

  function purgeExpiredInvites() {
    const current = Date.now();
    for (const [key, invite] of pendingInvites) {
      if (invite.expiresAt < current) pendingInvites.delete(key);
    }
  }

  function pendingInviteForLeader(leaderAccount, requesterId, realm) {
    purgeExpiredInvites();
    return [...pendingInvites.values()].find((invite) => (
      invite.realm === realmKey(realm)
      && invite.leaderAccount === leaderAccount
      && invite.requesterId === requesterId
    )) || null;
  }

  function removePendingInvite(invite, realm) {
    if (!invite) return;
    pendingInvites.delete(inviteKey(invite.requesterAccount, invite.leaderAccount, realm));
  }

  function handleJoinRequest(data, sender) {
    const requester = deps.getSocketMeta(sender) || {};
    const requesterAccount = String(requester.account || "");
    const leaderId = String(data.to || "");
    const leaderSocket = peerSocket(leaderId, requester);
    const leader = leaderSocket ? deps.getSocketMeta(leaderSocket) || {} : null;
    const leaderAccount = String(leader?.account || "");
    if (
      !requester.peerId
      || !requesterAccount
      || !leader
      || !leaderAccount
      || realmKey(leader) !== realmKey(requester)
      || requesterAccount === leaderAccount
    ) {
      reject(sender, "team_target_unavailable");
      return true;
    }
    if (accountHasTeam(requesterAccount, requester) || memberLeaderAccount(leaderAccount, leader)) {
      reject(sender, "team_member_busy");
      return true;
    }
    const inviteId = inviteKey(requesterAccount, leaderAccount, requester);
    const existing = pendingInvites.get(inviteId);
    if (existing?.expiresAt >= Date.now()) {
      reject(sender, "team_invite_pending");
      return true;
    }
    const team = teamForLeader(leaderAccount, leader);
    if (team && team.members.length >= MAX_MEMBERS) {
      reject(sender, "team_full");
      return true;
    }
    pendingInvites.set(inviteId, {
      realm: realmKey(requester),
      requesterAccount,
      requesterId: requester.peerId,
      leaderAccount,
      expiresAt: Date.now() + INVITE_TTL_MS
    });
    send(leaderSocket, {
      type: "teamJoinRequest",
      to: leader.peerId,
      peerId: requester.peerId,
      name: requester.name || requesterAccount
    });
    return true;
  }

  function handleAccept(data, sender) {
    const leader = deps.getSocketMeta(sender) || {};
    const leaderAccount = String(leader.account || "");
    const requesterId = String(data.to || "");
    const invite = pendingInviteForLeader(leaderAccount, requesterId, leader);
    if (!leader.peerId || !leaderAccount || !invite) {
      reject(sender, "team_invite_expired");
      return true;
    }

    const requesterSocket = socketForAccount(invite.requesterAccount, leader);
    const requester = requesterSocket ? deps.getSocketMeta(requesterSocket) || {} : null;
    if (memberLeaderAccount(leaderAccount, leader)) {
      removePendingInvite(invite, leader);
      reject(requesterSocket, "team_member_busy");
      reject(sender, "team_member_busy");
      return true;
    }
    if (!requester || accountHasTeam(invite.requesterAccount, leader)) {
      removePendingInvite(invite, leader);
      reject(sender, "team_invite_expired");
      return true;
    }

    const key = teamKey(leaderAccount, leader);
    const team = teams.get(key) || {
      leaderAccount,
      leaderId: leader.peerId,
      leaderName: leader.name || leaderAccount,
      members: []
    };
    if (team.members.length >= MAX_MEMBERS) {
      reject(sender, "team_full");
      return true;
    }

    removePendingInvite(invite, leader);
    if (!team.members.some((member) => member.account === invite.requesterAccount)) {
      team.members.push({
        account: invite.requesterAccount,
        peerId: requester.peerId || "",
        name: requester.name || invite.requesterAccount
      });
    }
    teams.set(key, team);
    memberLeaders.set(accountKey(invite.requesterAccount, leader), leaderAccount);

    const members = publicMembers(team, leader);
    applyTeamMeta(requester, invite.requesterAccount, team, leader);
    deps.setSocketMeta(requesterSocket, requester);
    send(requesterSocket, {
      type: "teamAccepted",
      to: requester.peerId,
      leaderId: team.leaderId,
      leaderName: team.leaderName,
      members
    });
    syncTeam(leaderAccount, leader);
    return true;
  }

  function handleDecline(data, sender) {
    const leader = deps.getSocketMeta(sender) || {};
    const leaderAccount = String(leader.account || "");
    const requesterId = String(data.to || "");
    const invite = pendingInviteForLeader(leaderAccount, requesterId, leader);
    if (!leader.peerId || !leaderAccount || !invite) {
      reject(sender, "team_invite_expired");
      return true;
    }
    removePendingInvite(invite, leader);
    reject(socketForAccount(invite.requesterAccount, leader), "team_invite_declined");
    return true;
  }

  function removeMember(memberAccount, leaderAccount, realm) {
    const team = teamForLeader(leaderAccount, realm);
    if (!team) return false;
    const remainingMembers = team.members.filter((member) => member.account !== memberAccount);
    if (remainingMembers.length === team.members.length) return false;
    if (!remainingMembers.length) {
      disband(leaderAccount, realm, { skipMemberDisbandNotice: memberAccount });
      return true;
    }
    team.members = remainingMembers;
    memberLeaders.delete(accountKey(memberAccount, realm));
    clearTeamMetaForAccount(memberAccount, realm);
    syncTeam(leaderAccount, realm);
    return true;
  }

  function handleLeave(sender) {
    const meta = deps.getSocketMeta(sender) || {};
    const account = String(meta.account || "");
    if (account && teamForLeader(account, meta)) {
      disband(account, meta);
      return true;
    }
    const leaderAccount = memberLeaderAccount(account, meta);
    if (!account || !leaderAccount) {
      clearTeamMetaForAccount(account, meta);
      return true;
    }
    removeMember(account, leaderAccount, meta);
    return true;
  }

  function disband(leaderAccount, realm, options = {}) {
    const team = teamForLeader(leaderAccount, realm);
    if (!team) return;
    teams.delete(teamKey(leaderAccount, realm));
    deps.onTeamDisband?.({
      leaderAccount,
      leaderId: team.leaderId || "",
      realm: {
        serverId: String(realm.serverId || ""),
        channelId: Math.floor(Number(realm.channelId) || 0)
      }
    });
    for (const member of team.members) {
      memberLeaders.delete(accountKey(member.account, realm));
      const socket = socketForAccount(member.account, realm);
      clearTeamMetaForAccount(member.account, realm);
      const meta = socket ? deps.getSocketMeta(socket) || {} : null;
      if (member.account !== options.skipMemberDisbandNotice) {
        send(socket, { type: "teamDisband", to: meta?.peerId || "", leaderId: team.leaderId || "" });
      }
    }
    const leaderSocket = socketForAccount(leaderAccount, realm);
    const leaderMeta = leaderSocket ? deps.getSocketMeta(leaderSocket) || {} : null;
    clearTeamMetaForAccount(leaderAccount, realm);
    send(leaderSocket, {
      type: "teamUpdate",
      to: leaderMeta?.peerId || "",
      leaderId: "",
      leaderName: "",
      members: []
    });
  }

  function handleDisband(sender) {
    const meta = deps.getSocketMeta(sender) || {};
    const account = String(meta.account || "");
    if (!account || !teamForLeader(account, meta)) {
      reject(sender, "team_not_leader");
      return true;
    }
    disband(account, meta);
    return true;
  }

  function finalizeDisconnect(account, meta = {}) {
    if (!account) return;
    if (teamForLeader(account, meta)) {
      disband(account, meta);
      return;
    }
    const leaderAccount = memberLeaderAccount(account, meta);
    if (leaderAccount) removeMember(account, leaderAccount, meta);
  }

  function handlePeerConnected(peerId, meta = {}) {
    const account = String(meta.account || "");
    if (!peerId || !account) return;
    purgeExpiredInvites();
    const disconnectKey = accountKey(account, meta);
    const timer = pendingDisconnects.get(disconnectKey);
    if (timer) {
      clearTimeout(timer);
      pendingDisconnects.delete(disconnectKey);
    }

    const ownTeam = teamForLeader(account, meta);
    if (ownTeam) {
      ownTeam.leaderId = peerId;
      ownTeam.leaderName = meta.name || account;
      syncTeam(account, meta);
      return;
    }

    const leaderAccount = memberLeaderAccount(account, meta);
    const team = leaderAccount ? teamForLeader(leaderAccount, meta) : null;
    if (!team) {
      if (leaderAccount) memberLeaders.delete(accountKey(account, meta));
      applyTeamMeta(meta, account, null, meta);
      const socket = socketForAccount(account, meta);
      if (socket && deps.getSocketMeta(socket) === meta) deps.setSocketMeta(socket, meta);
      return;
    }

    updateMemberConnection(team, account, meta);
    syncTeam(leaderAccount, meta);
  }

  function handleDisconnect(peerId, meta = {}) {
    const account = String(meta.account || "");
    if (!account) return;
    const key = accountKey(account, meta);
    const previous = pendingDisconnects.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      pendingDisconnects.delete(key);
      if (socketForAccount(account, meta)) return;
      finalizeDisconnect(account, meta);
    }, disconnectGraceMs);
    timer.unref?.();
    pendingDisconnects.set(key, timer);
  }

  function handleRoomMessage(data, sender) {
    if (!data || typeof data !== "object") return false;
    if (data.type === "teamJoinRequest") return handleJoinRequest(data, sender);
    if (data.type === "teamAccepted") return handleAccept(data, sender);
    if (data.type === "teamDeclined") return handleDecline(data, sender);
    if (data.type === "teamLeave") return handleLeave(sender);
    if (data.type === "teamDisband") return handleDisband(sender);
    if (data.type === "teamUpdate") return true;
    return false;
  }

  return { handleRoomMessage, handlePeerConnected, handleDisconnect };
}

module.exports = { createTeamRuntime };
