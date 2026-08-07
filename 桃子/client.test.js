const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadClient() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("./client.js"), "utf8"), { window });
  return window.TaoziNpc;
}

test("Taozi joins friends and uses the existing whisper message callbacks", async () => {
  const taozi = loadClient();
  const friends = [];
  const lines = [];
  let menuIndex = 0;
  let menu = null;
  let dialog = null;
  taozi.configure({
    friends: () => friends,
    menuIndex: () => menuIndex,
    addFriend: (friend) => friends.push(friend),
    setMenu: (title, items) => { menu = { title, items }; },
    bindMenu: () => {},
    openWhisper: () => {},
    addPrivateLine: (name, text, outgoing, peerId) => lines.push({ name, text, outgoing, peerId }),
    openPrivateDialog: (data) => { dialog = data; },
    postApi: async () => ({ ok: true, reply: "嘿嘿，准备出发啦！" }),
    showHint: () => {}
  });

  taozi.open();
  assert.equal(menu.title, "桃子");
  assert.equal(menu.items[0].label, "加好友");
  taozi.confirmInteraction();
  assert.equal(friends[0].peerId, "npc:taozi");
  assert.equal(taozi.whisperTarget(friends).name, "桃子");

  menuIndex = 1;
  assert.equal(taozi.sendWhisper({ peerId: "npc:taozi" }, "去比武吗？"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines.map((line) => [line.text, line.outgoing]), [
    ["去比武吗？", true],
    ["嘿嘿，准备出发啦！", false]
  ]);
  assert.equal(dialog.peerId, "npc:taozi");
});

test("Taozi shows an isolated welcome bubble only after returning home", async () => {
  const taozi = loadClient();
  const bubbles = [];
  let calls = 0;
  taozi.configure({
    playerName: () => "小洛",
    postApi: async (path) => {
      calls += 1;
      assert.equal(path, "/api/taozi/welcome");
      return { reply: "小洛，你去哪儿啦[e0]" };
    },
    showLocalBubble: (text) => bubbles.push(text)
  });

  await taozi.onMapChanged("", "罗克萨斯家");
  await taozi.onMapChanged("罗克萨斯家", "罗克萨斯家");
  await taozi.onMapChanged("光芒市场", "光芒市场");
  await taozi.onMapChanged("光芒市场", "罗克萨斯家");
  assert.equal(calls, 1);
  assert.deepEqual(bubbles, ["小洛，你去哪儿啦[e0]"]);
});
