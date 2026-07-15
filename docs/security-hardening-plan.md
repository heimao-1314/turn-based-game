# 外网暴露修复方案

## 摘要

当前风险来自静态文件服务把项目根目录当作可下载目录，导致 `players.sqlite`、`players.sqlite-wal`、服务端源码、文档和其他内部文件可能被外网直接读取。本次修复采用最小变更策略：数据库路径不移动、业务接口不改，只在静态文件读取前增加白名单，并要求生产环境显式配置管理员口令。

## 已落地修复

1. 静态文件白名单

   只允许以下内容被 HTTP 静态访问：

   - 根目录前端入口文件：`index.html`、`app.js`、`styles.css`、`sw.js`、`manifest.webmanifest` 等。
   - 前端资源目录：`assets/`、`资源/`、`战斗/`、`队伍/`、`全服竞技场/`、`仙气修炼/`。
   - 文件扩展名限制为 `.html`、`.css`、`.js`、`.json`、`.png`、`.chj`、`.webmanifest`。

   `players.sqlite`、`players.sqlite-wal`、`players.sqlite-shm`、`server.js`、`docs/`、`.git/` 等路径现在不会进入 `fs.readFile`，直接返回 404。

2. 生产环境弱口令保护

   当 `NODE_ENV=production` 时，必须显式设置且不能使用默认值：

   - `ADMIN_PASSWORD`
   - `REMOTE_ADMIN_ACCOUNT`
   - `REMOTE_ADMIN_PASSWORD`
   - `GAME_ADMIN_ACCOUNT`
   - `GAME_ADMIN_PASSWORD`

   本地开发不受影响，未设置 `NODE_ENV=production` 时仍可按旧方式启动。

## 上线步骤

1. 先在生产机器设置环境变量：

   ```powershell
   $env:NODE_ENV="production"
   $env:ADMIN_PASSWORD="替换为强口令"
   $env:REMOTE_ADMIN_ACCOUNT="替换为管理员账号"
   $env:REMOTE_ADMIN_PASSWORD="替换为强口令"
   $env:GAME_ADMIN_ACCOUNT="替换为游戏管理员账号"
   $env:GAME_ADMIN_PASSWORD="替换为强口令"
   node server.js
   ```

2. 如果用 `.bat`、PM2、NSSM 或面板启动，把上述环境变量写入启动配置。

3. 启动后立即验证：

   - `/` 应返回 200。
   - `/app.js` 应返回 200。
   - `/资源/图片/mm1.png` 应返回 200。
   - `/players.sqlite` 应返回 404。
   - `/players.sqlite-wal` 应返回 404。
   - `/server.js` 应返回 404。
   - `/.git/config` 应返回 404。

## 后续加固建议

1. 把数据库迁到项目目录外

   当前补丁已挡住外网下载，但最佳实践是让运行数据不在静态站点根目录。建议后续增加 `DB_PATH` 环境变量，把 SQLite 放到如 `D:\gz\dx\data\players.sqlite`。

2. 前置反向代理

   如果服务公网开放，建议用 Nginx/Caddy/宝塔反代，只暴露 80/443，并在反代层再次阻断 `.sqlite`、`.db`、`.git`、`.env`、`.md`、源码等内部文件。

3. 管理后台改为会话或短期令牌

   当前管理接口通过请求头传口令，功能可用但不够理想。后续可改成登录后签发短期管理令牌，配合失败次数限制。

4. 密码哈希升级

   玩家账号当前使用 SHA-256 哈希，建议后续迁移到 `scrypt` 或 `argon2`，并为每个账号加入随机盐。
