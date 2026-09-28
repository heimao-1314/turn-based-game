# 职业与转职

`职业树.js` 定义职业分支和转职等级门槛；`career-progress.js` 计算职业经验；`transfer-quest.js` 定义二转阿木木击杀任务的门槛、计数上限与状态。

人物40级可在罗克萨斯家进行一转。一转职业10级后，玩家在原野怪区参与服务端权威阿木木战斗，凭一次性奖励票据累计999次击杀。进度存在 `players.transfer_amumu_kills`，玩家 API 的 `transferQuest` 返回进度；二转接口以服务端存档检查进度，未达标返回 `transfer_quest_incomplete`。转职后清零任务计数。

客户端请求里的怪物 ID、数量不用于计数，只有服务端票据里的战斗结果可增加进度。
