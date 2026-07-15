# 模块目录结构与扩展指南

强制规则见 [AGENTS.md](../../AGENTS.md)。工作流见 [ai-workflow.md](./ai-workflow.md)。

## 1. 当前布局（摘要）

```text
./
  AGENTS.md
  docs/agents/          AI 规则
  docs/git/             Git 规则
  server.js             服务端入口（薄装配）
  app.js                客户端入口（薄装配）
  admin.* index.html styles.css
  scripts/              测试与工具脚本
  联网战斗/ 全服竞技场/ 仙气修炼/ 疯狂吹牛/
  地图系统/ 宠物模块/ 职业模块/ 生活技能/
  副本模块/ 战斗/ 队伍/ 菜单UI/ 飞图小地图/
  资源/ assets/ maps/
```

优先复制现有工厂模式：`createOnlineBattleRuntime`、`createArenaRuntime`、`地图系统/admin-map-api.js` 等。

## 2. 目标结构（渐进）

```text
src/
  server/
    config.js
    db/
    auth/
    http/
    realtime/
    routes/
    domain/
  client/
    net/ state/ ui/ systems/
  shared/
```

旧中文领域目录可与 `src/` 长期共存。新代码优先进清晰模块，而不是入口文件。

## 3. 领域目录标准形态

```text
领域名/
  README.md
  server.js     # createXxxRuntime(deps)
  client.js     # initXxx(ctx)
  shared.js     # 可选
  admin.js      # 可选
```

### 服务端工厂

```js
function createXxxRuntime(deps) {
  const { db, sendJson, requireAuthAccount } = deps;
  function handleApi(req, res, url, body) {
    // 已处理返回 true
  }
  return { handleApi };
}
module.exports = { createXxxRuntime };
```

根 `server.js` 只：`require` + 注入 deps + 调用 `handleApi`。

## 4. 迁移原则（绞杀者）

1. 新功能只进新文件  
2. 改旧功能：先搬迁再改行为  
3. 禁止双份真理  
4. 一次只迁一个领域  

## 5. 数据库

- 注入 `db`，领域不要自己乱建连接  
- `prepare` + 占位符  
- 背包/货币用事务  
- 运行时库文件不入库（见 `.gitignore`）  

## 6. 新建系统检查表

- [ ] 领域 README  
- [ ] server/client 按需实现  
- [ ] 根入口仅接线  
- [ ] 更新 AGENTS §3  
- [ ] 协议文档  
- [ ] 无密钥入库  
