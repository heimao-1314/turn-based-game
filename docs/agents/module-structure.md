# 模块目录结构与扩展指南

强制规则：[AGENTS.md](../../AGENTS.md)。工作流：[ai-workflow.md](./ai-workflow.md)。商用条：[commercial-bar.md](./commercial-bar.md)。

## 1. 当前布局（摘要）

```text
./
  AGENTS.md
  docs/agents/     AI 与商用规则
  docs/git/        Git 与 AI 操作手册
  server.js        服务端入口（薄装配）
  app.js           客户端入口（薄装配）
  scripts/         测试与工具
  联网战斗/ 全服竞技场/ 仙气修炼/ 疯狂吹牛/
  地图系统/ 宠物模块/ 职业模块/ 生活技能/
  副本模块/ 战斗/ 队伍/ 菜单UI/ 飞图小地图/
  资源/ assets/ maps/
```

扩展时优先复制：`createOnlineBattleRuntime`、`createArenaRuntime`、`地图系统/*` 等**工厂 + 依赖注入**模式。

## 2. 目标结构（渐进，不要求一次迁完）

```text
src/
  server/
    config.js
    db/ repositories/ migrations/
    auth/
    http/          # router static cors
    realtime/
    routes/
    domain/
  client/
    net/ state/ ui/ systems/
  shared/          # 纯函数与数值表真相源
```

中文领域目录可与 `src/` 共存。**新代码禁止因「目录还没建」而写回入口文件**——可以先建领域目录。

## 3. 领域标准形态

```text
领域名/
  README.md        # 职责、鉴权、API/WS、错误码、数据表
  server.js        # createXxxRuntime(deps)
  client.js        # initXxx(ctx)
  shared.js        # 可选
  admin.js         # 可选
```

### 服务端工厂

```js
function createXxxRuntime(deps) {
  const { db, sendJson, requireAuthAccount, config } = deps;
  function handleApi(req, res, url, body) {
    // 认领则处理并 return true
    return false;
  }
  return { handleApi };
}
module.exports = { createXxxRuntime };
```

根入口只注入与分发，不写业务细节。

### 客户端

```js
function initXxx(ctx) {
  const { state, api, ws } = ctx;
  return { destroy() {} };
}
module.exports = { initXxx };
// 或与项目现有全局挂载方式一致
```

## 4. 绞杀者迁移

1. 新功能只进新文件  
2. 改旧功能：原样搬迁 → 单独 `refactor` commit → 再改行为  
3. 删除入口旧实现，留薄委托或直接分发  
4. 一次一个领域，保证可回滚  

## 5. 数据与经济模块特别要求

- repository 层集中 SQL，便于审计  
- 一切 grant/deduct 走服务端函数，禁止「客户端算完再存盘」  
- 写路径打点 anomaly 的拒绝原因要稳定  

## 6. 新建系统检查表

- [ ] README（职责/鉴权/接口）  
- [ ] server/client 按需  
- [ ] 入口仅接线  
- [ ] AGENTS §3 更新  
- [ ] commercial-bar 相关项  
- [ ] Git 精确提交  
