(function () {
  const SPRITE_ID = 2018;
  const MAP_NAME = "罗克萨斯家";
  const history = [];
  let busy = false;

  function createNpc(createActor) {
    const npc = createActor({ name: "桃子", spriteId: SPRITE_ID, x: 11 * 16, y: 5 * 16 });
    npc.mapName = MAP_NAME;
    npc.staticNpc = true;
    npc.taoziNpc = true;
    return npc;
  }

  function ensurePanel() {
    let panel = document.getElementById("taoziDialog");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "taoziDialog";
    panel.className = "taozi-dialog";
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `<div class="taozi-dialog__head"><strong>桃子</strong><button type="button" data-close aria-label="关闭">×</button></div><div class="taozi-dialog__messages" aria-live="polite"></div><form><input maxlength="500" autocomplete="off" placeholder="和桃子说点什么……" aria-label="对话内容"><button type="submit">发送</button></form>`;
    const style = document.createElement("style");
    style.textContent = `.taozi-dialog{position:fixed;z-index:1200;right:18px;bottom:18px;width:min(390px,calc(100vw - 24px));height:min(500px,calc(100vh - 36px));display:none;grid-template-rows:auto 1fr auto;background:#fff;border:2px solid #704b4b;box-shadow:0 8px 28px #0007;color:#2d2525}.taozi-dialog.active{display:grid}.taozi-dialog__head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#f3d7d7;border-bottom:1px solid #ad8585}.taozi-dialog__head button{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer}.taozi-dialog__messages{overflow:auto;padding:12px;background:#fffafa}.taozi-dialog__message{margin:0 0 10px;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #927070;background:#f6eeee}.taozi-dialog__message.user{border-color:#557b83;background:#edf5f6}.taozi-dialog form{display:grid;grid-template-columns:1fr auto;gap:8px;padding:10px;border-top:1px solid #d4bcbc}.taozi-dialog input{min-width:0;padding:9px;border:1px solid #9c8585}.taozi-dialog form button{padding:0 16px;border:1px solid #704b4b;background:#704b4b;color:#fff}@media(max-width:520px){.taozi-dialog{right:12px;bottom:12px;height:min(460px,calc(100vh - 24px))}}`;
    document.head.appendChild(style);
    document.body.appendChild(panel);
    panel.querySelector("[data-close]").addEventListener("click", close);
    panel.querySelector("form").addEventListener("submit", send);
    return panel;
  }

  function append(role, content) {
    const panel = ensurePanel();
    const item = document.createElement("div");
    item.className = `taozi-dialog__message ${role}`;
    item.textContent = content;
    panel.querySelector(".taozi-dialog__messages").appendChild(item);
    item.scrollIntoView({ block: "end" });
  }

  function open() {
    const panel = ensurePanel();
    panel.classList.add("active");
    panel.setAttribute("aria-hidden", "false");
    if (!history.length) append("assistant", "嘿嘿，你来啦！行李快收拾好啦，我们聊一会儿就向闪光平原出发，好不好？");
    panel.querySelector("input").focus();
  }

  function close() {
    const panel = ensurePanel();
    panel.classList.remove("active");
    panel.setAttribute("aria-hidden", "true");
  }

  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const panel = ensurePanel();
    const input = panel.querySelector("input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    append("user", message);
    busy = true;
    panel.querySelector("form button").disabled = true;
    try {
      const result = await window.postApi("/api/taozi/chat", { message, history: history.slice(-10) });
      history.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
      if (history.length > 10) history.splice(0, history.length - 10);
      append("assistant", result.reply);
    } catch (error) {
      const messages = { taozi_ai_rate_limited: "先让我喘口气嘛，等一小会儿再聊啦。", taozi_ai_upstream_busy: "唔，刚才的话被风吹散啦。等一小会儿再和我说嘛。", taozi_ai_unconfigured: "我现在还没准备好说话，晚一点再来找我嘛。" };
      append("assistant", messages[error.message] || "唔，我刚才没听清。再和我说一次，好不好？");
    } finally {
      busy = false;
      panel.querySelector("form button").disabled = false;
      input.focus();
    }
  }

  window.TaoziNpc = { createNpc, open };
})();
