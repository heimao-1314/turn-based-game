# 桃子 AI NPC

## 职责

- 在“罗克萨斯家”右上角生成静态 NPC 桃子，使用当前桃子时装 `资源/精灵图/2018.chj`。
- 桃子可通过局内交互加入现有好友列表，并在好友列表中保持在线。
- 对话复用局内“悄悄话”输入、私聊分类、消息记录和回复弹窗。
- 服务端代理 OpenAI 兼容接口，执行会话鉴权、输入裁剪、限流和超时控制。

## 配置

复制 `.env.example` 为 `.env`，设置 `TAOZI_AI_API_KEY`。接口地址和模型可分别通过 `TAOZI_AI_BASE_URL`、`TAOZI_AI_MODEL` 调整。真实密钥不得提交。

## API

`POST /api/taozi/chat`：需要有效角色会话。请求体为 `{ message, history }`，成功返回 `{ ok: true, reply }`。

## 导出

- 服务端：`createTaoziRuntime(deps)`
- 客户端：`window.TaoziNpc` 提供 NPC 创建、好友目标识别和私聊发送适配。
