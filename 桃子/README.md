# 桃子 AI NPC

## 职责

- 在“罗克萨斯家”右上角生成静态 NPC 桃子，使用当前桃子时装 `资源/精灵图/2018.chj`。
- 桃子可通过局内交互加入现有好友列表，并在好友列表中保持在线。
- 对话复用局内“悄悄话”输入、私聊分类、消息记录和回复弹窗。
- 服务端代理 OpenAI 兼容接口，执行会话鉴权、输入裁剪、限流和超时控制。
- 服务端按已认证角色查询玩家名并注入人设；回复限制为简短的日常口语。
- 桃子可理解并回复全部 39 个 `[eN]` 表情和 45 个 `[icoN]` 图标；语义目录集中在 `emoji-catalog.js`。
- 玩家从其他地图回到“罗克萨斯家”时生成一条 AI 欢迎气泡。气泡只修改当前客户端的桃子 actor，不写聊天记录、不经 WebSocket 广播。

## 配置

复制 `.env.example` 为 `.env`，设置 `TAOZI_AI_API_KEY`。接口地址和模型可分别通过 `TAOZI_AI_BASE_URL`、`TAOZI_AI_MODEL` 调整。真实密钥不得提交。

## API

`POST /api/taozi/chat`：需要有效角色会话。请求体为 `{ message, history }`，成功返回 `{ ok: true, reply }`。

`POST /api/taozi/welcome`：需要有效角色会话。玩家名由服务端会话查询，成功返回 `{ ok: true, reply }`。

## 导出

- 服务端：`createTaoziRuntime(deps)`
- 客户端：`window.TaoziNpc` 提供 NPC 创建、好友目标识别和私聊发送适配。
