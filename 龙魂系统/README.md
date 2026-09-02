# 龙魂系统

服务端权威的七阶段龙魂养成。每阶段 10 级，阶段内属性按该阶段满级值线性增长，完成阶段后与之前阶段累加。

- `shared.js`：阶段名、默认数值、等级展示和属性计算的前后端单一真相。
- `server.js`：配置持久化、每日次数、灵魂粉末领取/扣除、暴击和经验升级事务。
- 玩家字段：`dragon_soul`（0–70）、`dragon_soul_exp`、`dragon_soul_daily_key`、`dragon_soul_daily_used`、`soul_powder`、`soul_powder_300_at`、`soul_powder_400_at`。
- 配置键：`app_settings.dragon_soul_config_v1`，与人物/宠物等级成长经验配置隔离。
- API：`GET /api/soul-powder/status`、`POST /api/soul-powder/claim`（300 粉末/8 小时与 400 粉末/4 小时独立冷却）、`POST /api/dragon-soul/evolve`；管理端 `GET/POST /api/admin/dragon-soul-config` 与 reset。
