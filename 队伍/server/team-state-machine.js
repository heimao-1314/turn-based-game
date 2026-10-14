const crypto = require("node:crypto");
const {
  TEAM_V2_COMMANDS,
  TEAM_V2_ERRORS,
  isTeamV2Command,
  isValidRequestId,
  normalizeRealm,
  realmKey
} = require("../shared.js");

function createTeamStateMachine(deps = {}) {
  const teams = new Map();
  const teamIdByMember = new Map();
  const invites = new Map();
  const commandResults = new Map();
  const now = deps.now || Date.now;
  const createId = deps.createId || (() => crypto.randomBytes(18).toString("base64url"));
  const inviteTtlMs = positiveInteger(deps.inviteTtlMs, 30_000);
  const requestTtlMs = positiveInteger(deps.requestTtlMs, 60_000);
  const maxMembers = positiveInteger(deps.maxMembers, 4);

  function positiveInteger(value, fallback) {
    const normalized = Math.floor(Number(value));
    return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
  }

  function memberKey(account, realm) {
    return `${realmKey(realm)}:${String(account || "")}`;
  }

  function actorContext(actor = {}) {
    const realm = normalizeRealm(actor);
    const account = String(actor.account || "");
    if (!account || !realm.serverId || !realm.channelId) return null;
    return {
      account,
      name: String(actor.name || account),
      currentPeerId: String(actor.currentPeerId || actor.peerId || ""),
      realm
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function snapshot(team) {
    if (!team) return null;
    return clone({
      id: team.id,
      realm: team.realm,
      leaderAccount: team.leaderAccount,
      revision: team.revision,
      status: team.status,
      members: team.members,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt
    });
  }

  function teamForAccount(account, realm) {
    const teamId = teamIdByMember.get(memberKey(account, realm));
    return teamId ? teams.get(teamId) || null : null;
  }

  function reject(error, requestId = "") {
    return { ok: false, requestId, error };
  }

  function success(requestId, event, team = null, extra = {}) {
    return {
      ok: true,
      requestId,
      event,
      teamId: team?.id || extra.teamId || "",
      revision: team?.revision || extra.revision || 0,
      ...(team ? { snapshot: snapshot(team) } : {}),
      ...clone(extra)
    };
  }

  function record(event, details) {
    deps.recordEvent?.(event, clone(details));
  }

  function bump(team, event, details = {}) {
    team.revision += 1;
    team.updatedAt = new Date(now()).toISOString();
    record("team_revision_changed", {
      teamId: team.id,
      realm: team.realm,
      revision: team.revision,
      event,
      ...details
    });
  }

  function purgeExpired() {
    const timestamp = now();
    for (const [id, invite] of invites) {
      if (invite.status === "pending" && invite.expiresAt <= timestamp) {
        invite.status = "expired";
      }
      if (invite.expiresAt + requestTtlMs <= timestamp) invites.delete(id);
    }
    for (const [key, cached] of commandResults) {
      if (cached.expiresAt <= timestamp) commandResults.delete(key);
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }

  function fingerprint(command) {
    return JSON.stringify(stableValue({ type: command.type, payload: command.payload || {} }));
  }

  function revisionMatches(team, payload) {
    return Number(payload.teamRevision) === team.revision;
  }

  function createTeam(ctx, requestId) {
    if (teamForAccount(ctx.account, ctx.realm)) return reject(TEAM_V2_ERRORS.MEMBER_BUSY, requestId);
    const timestamp = new Date(now()).toISOString();
    const team = {
      id: createId("team"),
      realm: ctx.realm,
      leaderAccount: ctx.account,
      revision: 1,
      status: "active",
      members: [{
        account: ctx.account,
        name: ctx.name,
        role: "leader",
        joinedAt: timestamp,
        presence: "online",
        currentPeerId: ctx.currentPeerId,
        canonicalMapName: "",
        readyState: "idle"
      }],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    teams.set(team.id, team);
    teamIdByMember.set(memberKey(ctx.account, ctx.realm), team.id);
    record("team_created", { teamId: team.id, realm: team.realm, revision: team.revision, account: ctx.account });
    return success(requestId, "created", team);
  }

  function inviteMember(ctx, requestId, payload) {
    const team = teamForAccount(ctx.account, ctx.realm);
    if (!team) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    if (team.id !== String(payload.teamId || "")) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    if (team.leaderAccount !== ctx.account) return reject(TEAM_V2_ERRORS.NOT_LEADER, requestId);
    if (!revisionMatches(team, payload)) return reject(TEAM_V2_ERRORS.REVISION_CONFLICT, requestId);
    if (team.members.length >= maxMembers) return reject(TEAM_V2_ERRORS.FULL, requestId);
    const targetAccount = String(payload.targetAccount || "");
    if (!targetAccount || targetAccount === ctx.account) return reject(TEAM_V2_ERRORS.INVALID_COMMAND, requestId);
    if (teamForAccount(targetAccount, ctx.realm)) return reject(TEAM_V2_ERRORS.MEMBER_BUSY, requestId);
    const existing = [...invites.values()].find((item) => (
      item.status === "pending"
      && item.teamId === team.id
      && item.targetAccount === targetAccount
      && item.expiresAt > now()
    ));
    if (existing) return success(requestId, "invite_pending", team, { invite: existing });
    const invite = {
      id: createId("invite"),
      teamId: team.id,
      inviterAccount: ctx.account,
      targetAccount,
      realm: ctx.realm,
      expiresAt: now() + inviteTtlMs,
      status: "pending"
    };
    invites.set(invite.id, invite);
    return success(requestId, "invited", team, { invite });
  }

  function respondToInvite(ctx, requestId, payload) {
    const invite = invites.get(String(payload.inviteId || ""));
    if (!invite || invite.status !== "pending" || invite.expiresAt <= now()) {
      if (invite?.status === "pending") invite.status = "expired";
      return reject(TEAM_V2_ERRORS.INVITE_EXPIRED, requestId);
    }
    if (realmKey(invite.realm) !== realmKey(ctx.realm)) return reject(TEAM_V2_ERRORS.CROSS_REALM, requestId);
    if (invite.targetAccount !== ctx.account) {
      deps.recordAnomaly?.(ctx.account, "team_invite_impersonation", TEAM_V2_ERRORS.INVALID_COMMAND);
      return reject(TEAM_V2_ERRORS.INVALID_COMMAND, requestId);
    }
    const response = String(payload.response || "");
    if (response === "decline") {
      invite.status = "declined";
      return success(requestId, "invite_declined", null, { teamId: invite.teamId, invite: invite });
    }
    if (response !== "accept") return reject(TEAM_V2_ERRORS.INVALID_COMMAND, requestId);
    if (teamForAccount(ctx.account, ctx.realm)) return reject(TEAM_V2_ERRORS.MEMBER_BUSY, requestId);
    const team = teams.get(invite.teamId);
    if (!team || team.status !== "active") return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    if (team.members.length >= maxMembers) return reject(TEAM_V2_ERRORS.FULL, requestId);
    const joinedAt = new Date(now()).toISOString();
    team.members.push({
      account: ctx.account,
      name: ctx.name,
      role: "member",
      joinedAt,
      presence: "online",
      currentPeerId: ctx.currentPeerId,
      canonicalMapName: "",
      readyState: "idle"
    });
    teamIdByMember.set(memberKey(ctx.account, ctx.realm), team.id);
    invite.status = "accepted";
    bump(team, "member_joined", { account: ctx.account });
    return success(requestId, "invite_accepted", team, { invite });
  }

  function disbandTeam(team, requestId, event = "disbanded") {
    team.status = "disbanded";
    bump(team, event);
    for (const member of team.members) teamIdByMember.delete(memberKey(member.account, team.realm));
    for (const invite of invites.values()) {
      if (invite.teamId === team.id && invite.status === "pending") invite.status = "cancelled";
    }
    return success(requestId, event, team);
  }

  function leaveTeam(ctx, requestId, payload) {
    const team = teamForAccount(ctx.account, ctx.realm);
    if (!team || team.id !== String(payload.teamId || "")) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    if (!revisionMatches(team, payload)) return reject(TEAM_V2_ERRORS.REVISION_CONFLICT, requestId);
    if (team.leaderAccount === ctx.account) return disbandTeam(team, requestId, "leader_left");
    team.members = team.members.filter((member) => member.account !== ctx.account);
    teamIdByMember.delete(memberKey(ctx.account, ctx.realm));
    bump(team, "member_left", { account: ctx.account });
    return success(requestId, "left", team);
  }

  function kickMember(ctx, requestId, payload) {
    const team = teamForAccount(ctx.account, ctx.realm);
    if (!team || team.id !== String(payload.teamId || "")) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    if (team.leaderAccount !== ctx.account) return reject(TEAM_V2_ERRORS.NOT_LEADER, requestId);
    if (!revisionMatches(team, payload)) return reject(TEAM_V2_ERRORS.REVISION_CONFLICT, requestId);
    const targetAccount = String(payload.targetAccount || "");
    if (!targetAccount || targetAccount === ctx.account) return reject(TEAM_V2_ERRORS.INVALID_COMMAND, requestId);
    const member = team.members.find((item) => item.account === targetAccount);
    if (!member) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    team.members = team.members.filter((item) => item.account !== targetAccount);
    teamIdByMember.delete(memberKey(targetAccount, ctx.realm));
    bump(team, "member_kicked", { account: targetAccount });
    return success(requestId, "kicked", team, { targetAccount });
  }

  function disbandByCommand(ctx, requestId, payload) {
    const team = teamForAccount(ctx.account, ctx.realm);
    if (!team || team.id !== String(payload.teamId || "")) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    if (team.leaderAccount !== ctx.account) return reject(TEAM_V2_ERRORS.NOT_LEADER, requestId);
    if (!revisionMatches(team, payload)) return reject(TEAM_V2_ERRORS.REVISION_CONFLICT, requestId);
    return disbandTeam(team, requestId);
  }

  function snapshotForAccount(ctx, requestId) {
    const team = teamForAccount(ctx.account, ctx.realm);
    if (!team) return reject(TEAM_V2_ERRORS.NOT_FOUND, requestId);
    return success(requestId, "snapshot", team);
  }

  function execute(command = {}, actor = {}) {
    purgeExpired();
    const ctx = actorContext(actor);
    const requestId = String(command.requestId || "");
    if (!ctx || !isTeamV2Command(command.type) || !isValidRequestId(requestId)) {
      return reject(TEAM_V2_ERRORS.INVALID_COMMAND, requestId);
    }
    const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
      ? command.payload
      : {};
    if ("account" in payload || "leaderAccount" in payload || "members" in payload || "realm" in payload) {
      deps.recordAnomaly?.(ctx.account, "team_identity_override", TEAM_V2_ERRORS.INVALID_COMMAND);
      return reject(TEAM_V2_ERRORS.INVALID_COMMAND, requestId);
    }
    const cacheKey = `${memberKey(ctx.account, ctx.realm)}:${requestId}`;
    const signature = fingerprint({ type: command.type, payload });
    const cached = commandResults.get(cacheKey);
    if (cached) {
      if (cached.signature !== signature) {
        deps.recordAnomaly?.(ctx.account, "team_request_id_reuse", TEAM_V2_ERRORS.DUPLICATE);
        return reject(TEAM_V2_ERRORS.DUPLICATE, requestId);
      }
      return { ...clone(cached.result), duplicate: true };
    }

    let result;
    if (command.type === TEAM_V2_COMMANDS.CREATE) result = createTeam(ctx, requestId);
    else if (command.type === TEAM_V2_COMMANDS.INVITE) result = inviteMember(ctx, requestId, payload);
    else if (command.type === TEAM_V2_COMMANDS.INVITE_RESPOND) result = respondToInvite(ctx, requestId, payload);
    else if (command.type === TEAM_V2_COMMANDS.LEAVE) result = leaveTeam(ctx, requestId, payload);
    else if (command.type === TEAM_V2_COMMANDS.KICK) result = kickMember(ctx, requestId, payload);
    else if (command.type === TEAM_V2_COMMANDS.DISBAND) result = disbandByCommand(ctx, requestId, payload);
    else result = snapshotForAccount(ctx, requestId);

    commandResults.set(cacheKey, { signature, result: clone(result), expiresAt: now() + requestTtlMs });
    if (!result.ok) record("team_command_rejected", {
      account: ctx.account,
      realm: ctx.realm,
      requestId,
      type: command.type,
      error: result.error
    });
    return result;
  }

  function reconnect(actor = {}) {
    const ctx = actorContext(actor);
    if (!ctx) return null;
    const team = teamForAccount(ctx.account, ctx.realm);
    if (!team || team.status !== "active") return null;
    const member = team.members.find((item) => item.account === ctx.account);
    if (!member) return null;
    const changed = member.currentPeerId !== ctx.currentPeerId || member.presence !== "online" || member.name !== ctx.name;
    member.currentPeerId = ctx.currentPeerId;
    member.presence = "online";
    member.name = ctx.name;
    if (changed) bump(team, "member_reconnected", { account: ctx.account });
    return snapshot(team);
  }

  return { execute, reconnect, snapshotForAccount: (actor) => snapshot(teamForAccount(actor.account, actor)) };
}

module.exports = { createTeamStateMachine };
