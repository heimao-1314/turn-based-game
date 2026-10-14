# 龙魂系统

服务端权威的七阶段龙魂养成。每阶段 10 级，阶段内属性按该阶段满级值线性增长，完成阶段后与之前阶段累加。

- `shared.js`：阶段名、默认数值、等级展示和属性计算的前后端单一真相。
- `server.js`：配置持久化、每日次数、扣除灵魂粉末、暴击和经验升级事务。
- 玩家字段：`dragon_soul`（0–70）、`dragon_soul_exp`、`dragon_soul_daily_key`、`dragon_soul_daily_used`。
- 配置键：`app_settings.dragon_soul_config_v1`，与人物/宠物等级成长经验配置隔离。
- API：`POST /api/dragon-soul/evolve`；管理端 `GET/POST /api/admin/dragon-soul-config` 与 reset。
