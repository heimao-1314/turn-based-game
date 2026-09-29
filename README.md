# 口袋精灵 Dome

**一个纯 AI 制作的回合制网页游戏实验项目。**

本项目由维护者提出需求、操作工具并组织迭代，代码实现与项目文档通过 AI 生成和修改，用于展示 AI 辅助下从玩法原型到多模块网页游戏的开发过程。“纯 AI 制作”描述项目的开发方式，不代表所有图片、字体、音效或第三方内容均由 AI 原创，也不代表已经完成独立人工审计。

> 当前定位：学习、研究与本地体验用 Demo。功能、平衡性、稳定性和安全性仍需持续验证。仓库中的“商用标准”是工程目标与验收要求，不是已经通过商用验收的承诺。使用前请阅读 [免责声明](DISCLAIMER.md)。

## 项目内容

- 回合制战斗、联网战斗、组队与全服竞技场。
- 宠物、职业成长、装备、生活技能与副本模块。
- 地图探索、小地图、聊天与管理工具。
- 仙气修炼、好运宝箱、每日新闻等扩展玩法。

以上为现有代码模块的范围，部分功能可能仍处于实验或迭代状态，不保证所有流程均已验证。

## 技术与运行环境

服务端使用 Node.js、内置 HTTP、WebSocket 处理逻辑和 `node:sqlite`；客户端使用 HTML、CSS 和 JavaScript；数据保存在本地 SQLite 数据库。业务主要按中文领域目录拆分，CommonJS 为主要服务端模块形式。

请使用 **Node.js 22.14.0 或更高、支持 `node:sqlite` 的版本**。基础游戏运行不需要安装 Python；Python/Pillow 仅用于部分地图工具。`package.json` 中的历史打包和混淆开发依赖不是基础启动条件，当前不维护这套发布链路。

## 本地快速启动

```sh
git clone --branch develop https://github.com/heimao-1314/turn-based-game.git
cd turn-based-game
```

在 Windows PowerShell 中复制配置模板：

```powershell
Copy-Item .env.example .env
```

macOS / Linux 可使用 `cp .env.example .env`。编辑本地 `.env`，将管理员账号与口令占位值替换为自己设置的值；不要提交该文件，也不要使用真实常用密码进行测试。然后运行：

```sh
node server.js
```

打开 <http://127.0.0.1:6588/index.html>。也可执行 `npm start`；Windows 可双击根目录的 `一键启动.bat`。管理页面为 `/admin.html`，凭证由本地配置提供。直接运行 `node server.js` 时可用 `Ctrl+C` 停止服务。

**注意：服务端当前监听 `::`，并非仅绑定回环地址。** 本地体验时请通过系统防火墙限制入站访问，不要直接把开发配置暴露到公网。GitHub 上公开源代码不会自动部署游戏；本项目需要 Node.js 服务端，不能仅靠 GitHub Pages 完整运行。

## 配置与数据

| 配置项 | 用途 |
| --- | --- |
| `PORT` | HTTP 端口，默认 `6588` |
| `NODE_ENV` | 开发或生产模式；生产模式会检查管理员配置 |
| `ADMIN_PASSWORD` | 本机管理口令 |
| `REMOTE_ADMIN_ACCOUNT` / `REMOTE_ADMIN_PASSWORD` | 远程管理员配置 |
| `GAME_ADMIN_ACCOUNT` / `GAME_ADMIN_PASSWORD` | 游戏/地图管理员配置 |
| `PLAYER_DB_PATH` | SQLite 数据库路径；生产环境应放在站点目录之外 |
| `TAOZI_AI_*` | 可选 AI NPC 配置；启用前自行确认服务商、数据传输与费用 |

完整模板见 [.env.example](.env.example)。AI NPC 并非基础启动必需项；模板中的外部服务地址不构成推荐或安全背书。未经了解不要配置真实密钥或向外部服务发送个人敏感信息。

玩家数据库由本地运行维护，不随源代码提供。请单独备份数据库；`git revert` 只能回滚代码，不能回滚玩家数据。`.env`、数据库、日志和 `node_modules` 不应进入 Git。

## 目录与文档

| 路径 | 内容 |
| --- | --- |
| `server.js` / `app.js` | 服务端与客户端入口；遗留逻辑正在逐步模块化 |
| `src/server/` | 通用服务端运行时和领域支持模块 |
| `战斗/`、`联网战斗/`、`队伍/` | 战斗与联网玩法 |
| `宠物模块/`、`职业模块/`、`地图系统/` | 宠物、成长与地图 |
| `scripts/` | 测试与维护工具 |
| `docs/` | 协议、设计与工程说明 |
| `AGENTS.md` | AI 开发规则、代码结构与安全约束 |

- [AI 开发规范](AGENTS.md)
- [API 文档](docs/API文档.md)
- [战斗与 PVP 说明](docs/战斗与PVP系统总结.md)
- [全服竞技场说明](docs/全服竞技场系统说明与迁移指南.md)
- [安全加固说明](docs/security-hardening-plan.md)
- [商用验收要求](docs/agents/commercial-bar.md)
- [Git 工作流](docs/git/ai-git-playbook.md)

部分历史文档可能滞后；启动信息优先参考本 README 与实际代码。领域细节请结合各目录 README 阅读。

## 测试与参与

可从 `package.json` 查看测试入口，例如：

```sh
npm run test:security
npm run test:online-battle
npm run test:forge
```

测试通过只能说明对应检查通过，不等于全面安全审计或商业部署认证。运行测试请使用隔离环境与测试数据。

当前公开开发分支为 `develop`。提交问题请附上复现步骤、运行环境与脱敏日志；切勿在公开 Issue 中贴出密码、Token、玩家数据或未修复漏洞的可利用细节。代码修改应遵循 `AGENTS.md`，业务进入领域模块，经济和权限判断由服务端负责。

## AI 制作、素材与许可

项目按维护者声明为纯 AI 制作，AI 输出可能出现逻辑错误、不安全实现、文档偏差或来源不明的内容。维护者与使用者仍需对实际发布和使用行为负责。

本仓库尚未选择开源许可证。**公开可见不等于授予任意复制、再分发或商业使用的许可**；本说明不额外授予代码或素材使用权。第三方素材、名称、角色形象及依赖应分别核对来源与授权，不因收录在仓库中而改变其权利归属。如有权利疑问，可通过 [仓库 Issues](https://github.com/heimao-1314/turn-based-game/issues) 提供文件路径与不含个人敏感信息的说明，维护者将核实处理。

详见 [免责声明](DISCLAIMER.md)。
