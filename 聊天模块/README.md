# 聊天模块

负责游戏内实时聊天的协议校验和菜单聊天 UI 接入。

- WS：`chat.send`，频道为 `nearby`、`server`、`channel`、`team`、`whisper`。
- 身份、角色名、服务器、线路、地图和队伍成员全部取自服务端 socket session metadata，忽略客户端自报字段。
- 单条消息最多 160 字符，服务端执行 800ms 冷却；拒绝使用稳定的 `chatError.error`。
- 客户端仅将纯文本插入 DOM，物品与表情标记在转义后再渲染。
