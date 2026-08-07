(function () {
  "use strict";

  const SPRITE_ID = 2018;
  const MAP_NAME = "罗克萨斯家";
  const PEER_ID = "npc:taozi";
  const NAME = "桃子";
  const history = [];
  let context = null;
  let busy = false;

  function createNpc(createActor) {
    const npc = createActor({ name: NAME, spriteId: SPRITE_ID, x: 11 * 16, y: 5 * 16 });
    npc.mapName = MAP_NAME;
    npc.staticNpc = true;
    npc.taoziNpc = true;
    npc.peerId = PEER_ID;
    return npc;
  }

  function configure(nextContext) {
    context = nextContext;
  }

  function isFriend() {
    return Boolean(context?.friends().some((friend) => friend.peerId === PEER_ID || friend.name === NAME));
  }

  function target() {
    return { peerId: PEER_ID, name: NAME, virtualNpc: true };
  }

  function friendTarget(friend) {
    return friend?.peerId === PEER_ID || friend?.name === NAME ? target() : null;
  }

  function whisperTarget(friends) {
    return (friends || []).some((friend) => friendTarget(friend)) ? target() : null;
  }

  function open() {
    if (!context) return;
    const added = isFriend();
    context.setMenu(NAME, [
      { label: added ? "已是好友" : "加好友", icon: "1.42", disabled: added },
      { label: "悄悄话", icon: "2.7", disabled: !added }
    ]);
    context.bindMenu(confirmInteraction);
  }

  function confirmInteraction() {
    if (!context) return;
    if (context.menuIndex() === 0 && !isFriend()) {
      context.addFriend(target());
      context.showHint("桃子 已加为好友");
      open();
      return;
    }
    if (context.menuIndex() === 1 && isFriend()) context.openWhisper(target());
  }

  function sendWhisper(selectedTarget, message) {
    if (selectedTarget?.peerId !== PEER_ID) return false;
    const text = String(message || "").trim();
    if (!text) return true;
    if (busy) {
      context.showHint("桃子正在回复上一句话");
      return true;
    }
    context.addPrivateLine(NAME, text, true, PEER_ID);
    busy = true;
    requestReply(text);
    return true;
  }

  async function requestReply(message) {
    try {
      const result = await context.postApi("/api/taozi/chat", { message, history: history.slice(-10) });
      history.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
      if (history.length > 10) history.splice(0, history.length - 10);
      context.addPrivateLine(NAME, result.reply, false, PEER_ID);
      context.openPrivateDialog({ peerId: PEER_ID, name: NAME, text: result.reply });
    } catch (error) {
      const errors = {
        taozi_ai_rate_limited: "先让我喘口气嘛，等一小会儿再聊啦。",
        taozi_ai_upstream_busy: "唔，刚才的话被风吹散啦。等一小会儿再和我说嘛。",
        taozi_ai_unconfigured: "我现在还没准备好说话，晚一点再来找我嘛。"
      };
      const reply = errors[error.message] || "唔，我刚才没听清。再和我说一次，好不好？";
      context.addPrivateLine(NAME, reply, false, PEER_ID);
      context.openPrivateDialog({ peerId: PEER_ID, name: NAME, text: reply });
    } finally {
      busy = false;
    }
  }

  async function onMapChanged(previousMap, currentMap) {
    if (!context || !previousMap || previousMap === MAP_NAME || currentMap !== MAP_NAME) return;
    let reply;
    try {
      reply = (await context.postApi("/api/taozi/welcome", {})).reply;
    } catch {
      reply = `${context.playerName()}，欢迎回家[e0]`;
    }
    context.showLocalBubble(reply);
  }

  window.TaoziNpc = { createNpc, configure, friendTarget, whisperTarget, open, confirmInteraction, sendWhisper, onMapChanged };
})();
