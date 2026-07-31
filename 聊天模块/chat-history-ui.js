(function () {
  "use strict";

  const channels = ["all", "nearby", "server", "channel", "team", "whisper"];
  let currentChannel = "all";
  let selectedLine = null;
  let getLines = () => [];
  let renderLine = () => "";
  let canPrivateChat = () => false;
  let openPrivateChat = () => {};

  function panel() {
    return document.querySelector("#chatHistoryPanel");
  }

  function filteredLines() {
    const lines = getLines();
    return currentChannel === "all" ? lines : lines.filter((line) => line.channel === currentChannel);
  }

  function render() {
    const root = panel();
    const list = document.querySelector("#chatHistoryList");
    if (!root || !list) return;
    const lines = filteredLines();
    const selectableLines = lines.filter(canPrivateChat);
    if (!selectableLines.includes(selectedLine)) selectedLine = selectableLines.at(-1) || null;
    list.innerHTML = lines.length
      ? lines.map((line) => renderLine(line, true)).join("")
      : '<div class="chat-line chat-history-empty">暂无该频道聊天记录</div>';
    list.querySelectorAll(".chat-line").forEach((node, index) => {
      const line = lines[index];
      if (!line || !canPrivateChat(line)) return;
      node.classList.add("chat-history-selectable");
      node.classList.toggle("selected", line === selectedLine);
      node.addEventListener("click", () => {
        selectedLine = line;
        render();
      });
    });
    root.querySelectorAll("[data-chat-history-channel]").forEach((button) => {
      const active = button.dataset.chatHistoryChannel === currentChannel;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const selectedNode = Array.from(list.querySelectorAll(".chat-line")).find((node, index) => lines[index] === selectedLine);
    if (selectedNode) selectedNode.scrollIntoView({ block: "nearest" });
    else list.scrollTop = list.scrollHeight;
    window.MenuUI?.decorateTabDeck?.(document.querySelector("#chatHistoryTabs"));
    window.MenuUI?.decorateFrame?.(list);
    window.MenuUI?.decorateFrame?.(document.querySelector("#chatHistoryHint"));
  }

  function open() {
    const root = panel();
    if (!root) return;
    root.classList.add("active");
    root.setAttribute("aria-hidden", "false");
    render();
  }

  function close() {
    const root = panel();
    if (!root) return;
    root.classList.remove("active");
    root.setAttribute("aria-hidden", "true");
  }

  function isOpen() {
    return Boolean(panel()?.classList.contains("active"));
  }

  function changeChannel(delta) {
    const index = channels.indexOf(currentChannel);
    currentChannel = channels[(index + delta + channels.length) % channels.length];
    render();
  }

  function changePage(delta) {
    const list = document.querySelector("#chatHistoryList");
    if (!list) return;
    list.scrollTop += delta * list.clientHeight;
  }

  function moveSelection(delta) {
    const lines = filteredLines().filter(canPrivateChat);
    if (!lines.length) return;
    const index = lines.indexOf(selectedLine);
    selectedLine = lines[(index + delta + lines.length) % lines.length];
    render();
  }

  function handleKey(key) {
    if (!isOpen()) return false;
    if (key === "left") changePage(-1);
    else if (key === "right") changePage(1);
    else if (key === "up") moveSelection(-1);
    else if (key === "down") moveSelection(1);
    else if (key === "confirm" && selectedLine) openPrivateChat(selectedLine);
    else if (key === "nextChannel" || key === "system") changeChannel(1);
    else if (key === "back") close();
    else return false;
    return true;
  }

  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-chat-history-channel]");
    if (tab && isOpen()) {
      currentChannel = tab.dataset.chatHistoryChannel;
      render();
      return;
    }
    if (event.target.closest("#chatHistoryHint") && isOpen()) changeChannel(1);
  });

  window.ChatHistoryUI = Object.freeze({
    configure(options) {
      getLines = options.getLines;
      renderLine = options.renderLine;
      canPrivateChat = options.canPrivateChat || canPrivateChat;
      openPrivateChat = options.openPrivateChat || openPrivateChat;
    },
    open,
    close,
    render,
    isOpen,
    handleKey
  });
})();
