const TEAM_V2_COMMANDS = Object.freeze({
  CREATE: "team.v2.create",
  INVITE: "team.v2.invite",
  INVITE_RESPOND: "team.v2.invite.respond",
  LEAVE: "team.v2.leave",
  KICK: "team.v2.kick",
  DISBAND: "team.v2.disband",
  SNAPSHOT_REQUEST: "team.v2.snapshot.request"
});

const TEAM_V2_ERRORS = Object.freeze({
  INVALID_COMMAND: "team_command_invalid",
  DUPLICATE: "team_command_duplicate",
  NOT_FOUND: "team_not_found",
  NOT_LEADER: "team_not_leader",
  FULL: "team_full",
  MEMBER_BUSY: "team_member_busy",
  INVITE_EXPIRED: "team_invite_expired",
  REVISION_CONFLICT: "team_revision_conflict",
  CROSS_REALM: "team_cross_realm"
});

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function normalizeRealm(value = {}) {
  return {
    serverId: String(value.serverId || ""),
    channelId: Math.floor(Number(value.channelId) || 0)
  };
}

function realmKey(value = {}) {
  const realm = normalizeRealm(value);
  return `${realm.serverId}:${realm.channelId}`;
}

function isValidRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ""));
}

function isTeamV2Command(value) {
  return Object.values(TEAM_V2_COMMANDS).includes(String(value || ""));
}

module.exports = {
  TEAM_V2_COMMANDS,
  TEAM_V2_ERRORS,
  isTeamV2Command,
  isValidRequestId,
  normalizeRealm,
  realmKey
};
