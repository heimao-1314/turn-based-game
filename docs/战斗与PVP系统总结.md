# 战斗与PVP系统完整总结

> 当前联网战斗入口已重置为 `联网战斗/runtime.js`。单人 PVP、多人 PVP、多人 PVE 共用同一个中心化战斗房间 Module；旧 `战斗/server-pvp.js` 与 `队伍/server-pvp.js` 不再参与主 WebSocket 联网战斗链路。

## 一、架构概览

战斗系统采用**规则层与传输层分离**的设计：

| 层次 | 文件 | 职责 |
|------|------|------|
| 技能规则层 | 战斗/skills.js | 技能目录定义、技能过滤、职业/装备前置检查 |
| 战斗引擎层 | 战斗/engine.js | 伤害计算、状态施加、回合结算（纯领域逻辑） |
| 协议层 | 战斗/protocol.js | 角色快照序列化/反序列化、战斗初始载荷构建 |
| 联网战斗服务端 | 联网战斗/runtime.js | 单人 PVP、多人 PVP、多人 PVE 的中心化房间、回合仲裁、结果广播 |
| 客户端集成 | pp.js | 战斗UI渲染、玩家输入、动画播放、奖励发放 |

**关键设计原则**：
- NPC/本地战斗：客户端本地结算
- PVP战斗：服务端权威结算，客户端只渲染结果
- 同一套 engine.js 和 skills.js 被客户端和服务端共用，保证规则一致性

---

## 二、战斗界面

### 2.1 指令栏（Battle Command Bar）

战斗界面底部显示5个指令按钮：

`
[攻击] [技能] [道具] [自动战斗] [逃跑]
`

- **攻击**：普通攻击，对选中目标造成基础伤害
- **技能**：打开技能子菜单，选择技能施放
- **道具**：预留功能，当前显示"暂无道具"
- **自动战斗**：切换自动/手动模式（持久化设置）
- **逃跑**：尝试脱离战斗

### 2.2 操作方式

**触屏/鼠标操作**：
- 点击指令按钮选择操作
- 点击敌方角色选择目标
- 选中目标后点击确认

**键盘操作**：
- ←/→：切换指令
- ↑/↓：切换技能子菜单或目标
- Enter/空格：确认选择
- Escape/Backspace：返回/逃跑

**手柄操作**：
- 方向键：移动选择
- 确认键：执行
- 返回键：取消/逃跑
- 功能键：切换自动战斗

### 2.3 选择流程

1. **选择阶段** (choiceStep)：依次为 角色(actor) → 宠物(pet) → 佣兵(mercenary)
2. **选择操作**：攻击/技能
3. **选择目标**：敌方存活单位（点击或方向键切换）
4. **自动推进**：当前单位选择完毕后自动跳到下一个可控制单位

### 2.4 选中目标指示

- 选中目标时显示**脉冲箭头**（红色，左右交替）
- 箭头图片：资源/图片/战斗箭头.png
- 无图片时使用 Canvas 绘制的红色箭头

### 2.5 战斗场景渲染

- Canvas 绘制战斗场景
- 双方角色按阵型排列（左侧我方，右侧敌方）
- 每个角色显示：精灵图、HP条、状态图标、名称
- HP条：黑色背景 + 红色血条，按百分比显示
- 状态图标：16×16像素，显示在角色上方
- 阵亡标记：红色"×"覆盖在角色上

### 2.6 状态图标映射

`javascript
BATTLE_STATUS_ICONS = {
  confuse: ...,    // 混乱
  seal: ...,       // 封印
  bleed: ...,      // 流血
  curse: ...,      // 诅咒
  sleep: ...,      // 沉睡
  stun: ...,       // 眩晕
  paralyze: ...,   // 麻痹
  bind: ...,       // 束缚
  armorBreak: ..., // 破甲
  vulnerable: ..., // 虚弱/减速
  critBuff: ...    // 暴击增益/无敌增益
};
`

### 2.7 战斗动画

- **攻击冲刺**：角色向目标方向移动38像素
- **背景震动**：攻击命中时触发280ms震动
- **浮动数字**：伤害/治疗数值从角色头顶飘出（1100ms）
- **浮动文字**：如"复活"等特殊文字（1000ms）
- **技能名称**：施放技能时显示技能名（950ms）
- **气泡对话**：暴击时显示特殊台词（1800-2600ms）

### 2.8 战斗日志

- 底部显示状态日志（statusLog）
- 记录每回合事件：技能施放、伤害、控制、复活等
- 颜色分类：positive(绿色)、warning(黄色)、danger(红色)

---

## 三、数值计算

### 3.1 核心伤害公式

`
raw = hpDamage + attack × attackScale + mana × manaScale + defense × defenseScale + speed × speedScale

effectiveDefense = defense × (1 - pierce)
damageReduction = min(0.9, effectiveDefense / (effectiveDefense + 100000) - damageReductionDown)

final = max(1, raw × (1 - damageReduction) × (1 - guardReduction)) × critMultiplier
`

### 3.2 属性计算

**有效属性** = (基础属性 + Buff加成) × 属性倍率

`javascript
effectiveStat(fighter, stat) {
  const multiplier = fighter.statMultipliers?.[stat] || fighter.statMultiplier || 1;
  return Math.round(((fighter.stats[stat] || 0) + (fighter.buffs?.[stat] || 0)) * multiplier);
}
`

### 3.3 减伤机制

**防御减伤**：
- effectiveDefense = defense × (1 - pierce) （穿甲无视部分防御）
- damageReduction = effectiveDefense / (effectiveDefense + 100000)
- 上限90%，下限受 damageReductionDown 影响

**格挡减伤**（guardReduction）：
- 按攻击者类型分别计算：角色/宠物/佣兵
- 取最大值作为最终格挡率
- 来源：被动技能（如 passiveGuardRole、passiveGuardPet、passiveGuardMercenary）

### 3.4 暴击系统

- 暴击率：crit 属性（上限100%）
- 暴击伤害：critDamage 属性（上限2000%）
- 暴击倍率：1 + critDamage / 100
- 暴击时触发特殊台词（仅己方角色）

### 3.5 穿甲

- pierce 属性：无视目标防御的百分比
- 有效防御 = 原始防御 × (1 - pierce)

### 3.6 固定伤害

- 部分技能有 ixedDamage 属性（如仙人系列技能：200000-1000000）
- 固定伤害无视防御和暴击

### 3.7 技能伤害类型

| 类型 | 说明 | 计算方式 |
|------|------|----------|
| physical | 物理攻击 | 基于 attack、speed |
| magic | 魔法攻击 | 基于 mana |
| special | 特殊技能 | 可能带控制效果，无伤害或固定伤害 |
| heal | 治疗 | 恢复队友 HP |
| self_buff | 自身增益 | 提升自身属性 |
| uff | 团队增益 | 提升队友属性 |
| passive | 被动技能 | 战斗开始时自动生效 |

---

## 四、操作逻辑

### 4.1 回合结算流程

1. **应用被动技能**：双方队伍根据被动技能初始化属性
2. **速度排序**：所有存活单位按速度降序排列，速度相同时随机打乱
3. **依次行动**：
   - 跳过被控制单位（束缚、沉睡、眩晕、麻痹）
   - 确定行动：普通攻击/技能
   - 混乱状态：随机攻击任意存活单位（包括队友）
   - 执行行动并产生事件
   - 递减该单位的状态持续时间
4. **回合末结算**：
   - 流血伤害
   - 诅咒伤害
   - 递减所有状态持续时间
5. **判断胜负**：任一方全灭则结束

### 4.2 目标选择规则

| 规则 | 说明 |
|------|------|
| 默认 | 选择指定目标或随机存活目标 |
| 	argetRule: "all" | 攻击全体敌人 |
| 	argetCount: N | 攻击指定数量目标（从指定目标开始） |

### 4.3 选择顺序

战斗开始后按以下顺序选择操作：

1. **角色**（玩家本体）
2. **宠物**（如果存活）
3. **佣兵**（如果存活）

组队PVP中，顺序由服务端控制（controlledFighterSteps）。

### 4.4 自动选择

- 非玩家控制的单位（宠物、佣兵、NPC队友）自动选择行动
- 自动逻辑：选择敌方第一个存活目标进行普通攻击或默认技能

---

## 五、自动战斗逻辑

### 5.1 自动战斗模式

- utoBattlePersistent：全局持久化设置
- 开启后自动跳过手动选择，直接使用预设策略
- 挂机模式下自动开启

### 5.2 自动策略配置

`javascript
autoStrategy: {
  actor: { mode: "skill", skillId: "" },  // 角色策略
  petById: {}                              // 宠物策略（按ID配置）
}
`

- mode: "attack"：始终普通攻击
- mode: "skill"：使用指定技能或默认技能

### 5.3 挂机系统（Idle Hunt）

**功能**：
- 原地挂机：在可遇怪区域自动战斗
- Boss挂机：针对特定Boss自动战斗

**流程**：
1. 检查是否在可遇怪区域
2. 设置 utoBattlePersistent = true
3. 每5-10秒随机触发一次遇怪
4. 战斗结束后自动继续挂机
5. 遇到以下情况自动取消：
   - 离开遇怪区域
   - 队员跟随状态
   - 手动取消

### 5.4 自动战斗的回合处理

- 开启自动战斗时，跳过所有手动选择步骤
- 自动为每个可控制单位选择行动（使用 utoActionForFighter）
- 自动提交选择，触发回合结算

---

## 六、状态效果系统

### 6.1 控制状态

| 状态 | 效果 | 持续时间 |
|------|------|----------|
| ind (束缚) | 无法行动 | 1-3回合 |
| sleep (沉睡) | 无法行动 | 1-2回合 |
| stun (眩晕) | 无法行动 | 1-2回合 |
| paralyze (麻痹) | 无法行动 | 1-2回合 |
| confuse (混乱) | 随机攻击任意单位（含队友） | 1-2回合 |
| seal (封印) | 无法使用技能 | 1-2回合 |

**免疫机制**：controlImmune = true 时免疫所有控制状态

### 6.2 持续伤害状态

| 状态 | 效果 | 计算方式 |
|------|------|----------|
| leed (流血) | 每回合末扣血 | 固定值（技能设定） |
| curse (诅咒) | 每回合末扣血 | 攻击者法力 × 诅咒系数 |

### 6.3 增益/减益状态

| 状态 | 效果 | 来源 |
|------|------|------|
| ulnerable (虚弱) | 增加受伤 damageReductionDown | 技能效果 |
| slow (减速) | 速度倍率降低 | 技能效果 |
| rmorBreak (破甲) | 清除防御 defenseCleared | 被动技能 |
| critBuff (暴击增益) | 增加暴击率 | 团队增益技能 |
| speedBuff (速度增益) | 增加速度 | 技能命中后触发 |
| peerlessBuff (无敌增益) | 控制免疫 + 全属性倍率 + 复活概率提升 | 自身增益技能 |

### 6.4 状态持续时间递减

- 每回合结束后递减所有有持续时间的状态
- peerlessBuff 在回合末递减
- 其他状态在行动后递减
- 状态持续时间为0时自动清除

### 6.5 特殊状态效果

**破甲（armorBreak）**：
- 设置 defenseCleared = true
- 清除时恢复防御

**减速（slow）**：
- 设置 statMultipliers.speed = 1 - speedDownRate
- 清除时恢复速度倍率

**无敌增益（peerlessBuff）**：
- 控制免疫
- 全属性倍率提升
- 复活概率提升
- 清除时恢复所有属性

---

## 七、被动技能系统

### 7.1 被动技能列表

| 被动效果 | 属性 | 说明 |
|----------|------|------|
| 闪避 | passiveDodge | 概率闪避攻击（0.5 = 50%） |
| 连击 | passiveCombo | 攻击后追加一次普通攻击 |
| 反击 | passiveCounter | 受击后自动反击 |
| 复活 | passiveRebirthChance | 死亡时概率复活 |
| 破甲 | passiveBreakArmor | 攻击时清除目标防御 |
| 吸血 | passiveLifesteal | 造成伤害时恢复生命 |
| 格挡角色 | passiveGuardRole | 减少来自角色的伤害 |
| 格挡宠物 | passiveGuardPet | 减少来自宠物的伤害 |
| 格挡佣兵 | passiveGuardMercenary | 减少来自佣兵的伤害 |

### 7.2 被动技能生效时机

- **战斗开始时**：pplyBattlePassives 遍历队伍，为每个单位设置被动属性
- **复活检测**：passiveRebirthBaselineFor 计算基础复活概率

### 7.3 吸血计算

`javascript
amount = max(1, round(damageAmount × passiveLifesteal))
`

---

## 八、PVP系统

### 8.1 单人PVP流程

**邀请阶段**：
1. 攻击者发送 attleStart（含双方信息）
2. 服务端验证并记录到 pendingInvites
3. 服务端转发 attleStart 给防御者

**确认阶段**：
4. 防御者发送 attleAccepted
5. 服务端重建双方战斗数据（从数据库 + 客户端镜像）
6. 创建 ctiveBattle 会话
7. 服务端发送 attleAccepted 给攻击者

**战斗阶段**：
8. 双方客户端发送 attleChoice
9. 服务端等待双方都提交选择
10. 服务端调用 engine.resolveBattleTurn 计算结果
11. 服务端发送 attleTurn 给双方

**结算阶段**：
12. 客户端播放战斗动画
13. 战斗结束后清理会话

### 8.2 服务端数据重建

服务端从以下来源重建战斗参与者：

`javascript
buildBattleParticipants(playerRow, socketMeta) {
  // 1. 服务端数据库（playerRow）
  // 2. 客户端镜像（socketMeta.clientMirror）
  // 3. 在线角色状态（通过镜像同步）
}
`

**信任边界**：
- 服务端始终使用自己的数据库数据
- 客户端镜像仅用于位置、方向等非关键数据
- 战斗属性计算完全在服务端完成

### 8.3 PVP超时处理

- 配置超时时间：getBattleChoiceMs()（默认约15秒）
- 超时后自动为未提交的玩家生成默认行动
- 默认行动：普通攻击，目标为敌方第一个存活单位

### 8.4 断线处理

- 任一方断线时清理相关会话（pendingInvites 和 ctiveBattles）
- 避免残留无效会话

---

## 九、组队PVP系统

### 9.1 组队战斗流程

**发起阶段**：
1. 验证攻击方和防御方队伍（至少一方有多人）
2. 检查是否同队（禁止同队PK）
3. 创建组队战斗会话
4. 广播 attleStart 给所有参与者

**战斗阶段**：
5. 服务端控制选择顺序（controlledFighterSteps）
6. 每个玩家提交自己的 	eamBattleChoice
7. 所有玩家都提交或超时后触发结算
8. 服务端调用 engine.resolveBattleTurn
9. 广播 	eamBattleTurn 给所有参与者

**结算阶段**：
10. 战斗结束后广播 	eamBattleEnd
11. 清理会话和定时器

### 9.2 组队战斗特点

- **多单位控制**：每个玩家控制自己的角色、宠物、佣兵
- **统一回合**：所有玩家选择完毕后统一结算
- **超时机制**：未提交的玩家自动使用默认行动
- **队伍同步**：所有玩家看到相同的战斗结果

### 9.3 组队PVP消息类型

`javascript
teamBattleChoice  // 玩家提交选择
teamBattleTurn    // 服务端广播回合结果
teamBattleEnd     // 战斗结束
teamBattleReward  // 奖励分配
`

---

## 十、特殊机制

### 10.1 自身增益技能（self_buff）

**焚灵祭命（role_mage_soul_burn）**：
- 效果：全属性倍率提升 + 复活概率提升 + 控制免疫
- 持续3回合
- 复活效果：第2、3回合生效，第4回合失效
- 献祭要求：需要队伍中有宠物和佣兵

**其他自身增益技能**：
- 最大生命值提升（maxHpMultiplier）
- 格挡率提升（guardReduction）
- 吸血（passiveLifesteal）
- 控制免疫（controlImmune）

### 10.2 治疗技能

**神圣治疗（mage_light）**：
- 恢复全队50%最大生命值
- 清除所有控制状态（cleanse）
- 可复活已阵亡队友

### 10.3 团队增益技能

**团队暴击增益（buff类型）**：
- 为全队增加暴击率
- 持续指定回合数

### 10.4 献祭机制

- 部分技能需要献祭队友才能施放
- 要求队伍中存在指定类型的存活单位
- 献祭后队友立即阵亡
- 示例：ole_mage_soul_burn 需要献祭宠物和佣兵

### 10.5 仙人Boss特殊机制

**仙人系列技能**：
- 固定伤害：200000-1000000（无视防御）
- 必中控制：100%概率施加控制状态
- 群体效果：	argetRule: "all"
- 示例技能：
  - 仙脑昏眠：100%眩晕+100%沉睡
  - 仙心混乱：100%混乱
  - 仙手双断：固定伤害200000×2目标

### 10.6 绝世技能

- 绝世技能有特殊颜色标识（color属性）
- 效果强大：高速度/法力加成 + 高概率控制
- 持续时间较长（控制2回合，诅咒20回合）
- 示例：
  - 绝世混沌侵袭：75%混乱，2回合
  - 绝世青焰诅咒：75%诅咒，20回合
  - 绝世虚空封印：75%封印，2回合

---

## 十一、奖励系统

### 11.1 野怪战斗奖励

- 战斗胜利后自动发放奖励
- 奖励ID：${battleId}-reward
- 奖励内容由 grantWildBattleReward 处理
- 组队战斗中通过 	eamBattleReward 消息同步

### 11.2 竞技场奖励

- 占领竞技场排名时触发
- 调用 occupyArenaRank 更新排名
- 记录 renaClaimed 防止重复领取

### 11.3 组队奖励

- 组队战斗胜利后广播奖励消息
- 奖励包含：oster（队伍名单）、wildMonsterId、monsterCount
- 由发起者（ole: "attacker"）触发

---

## 十二、战斗配置参数

### 12.1 时间参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 回合选择超时 | getBattleChoiceMs() | 默认约15秒 |
| 倒计时显示 | getBattleChoiceSeconds() | 倒计时秒数 |
| 攻击动画 | 980ms | 角色冲刺动画 |
| 技能名称显示 | 950ms | 技能名飘字 |
| 浮动数字 | 1100ms | 伤害/治疗数字 |
| 浮动文字 | 1000ms | 特殊文字（如"复活"） |
| 气泡对话 | 1800-2600ms | 暴击台词 |
| 背景震动 | 80-280ms | 攻击命中震动 |
| 挂机间隔 | 5000-10000ms | 挂机遇怪间隔 |

### 12.2 属性上限

| 属性 | 上限 | 说明 |
|------|------|------|
| crit | 100 | 暴击率上限100% |
| critDamage | 2000 | 暴击伤害上限2000% |
| damageReduction | 0.9 | 减伤上限90% |

### 12.3 角色名长度限制

- 最大24字符（String.slice(0, 24)）

---

## 十三、网络同步机制

### 13.1 消息类型

`javascript
// 战斗相关
battleStart       // 战斗发起
battleAccepted    // 战斗接受
battleRejected    // 战斗拒绝
teamBattleChoice  // 提交联网战斗选择
battleTurn        // 回合结果
battleEnd         // 战斗结束

// 组队战斗
teamBattleChoice  // 组队选择
teamBattleTurn    // 组队回合结果
teamBattleEnd     // 组队战斗结束
teamBattleReward  // 组队奖励

// 状态同步
state             // 角色状态广播
`

### 13.2 同步策略

- **服务器中转**：联网状态和战斗相关消息都通过 WebSocket
- **权威仲裁**：强杀、队 v 队 PK、组队 PVE 战斗结果由服务端决定

### 13.3 快照机制

**角色快照（actorSnapshot）**：
- 序列化：attleActorSnapshot / ctorSnapshot
- 反序列化：attleActorFromSnapshot / ctorFromSnapshot
- 包含：名称、精灵图ID、坐标、方向、归属、属性等

**战斗初始载荷（battleStatePayload）**：
- 包含双方队伍、UI状态、倒计时等所有初始化数据
- 用于初始化战斗界面

---

## 十四、扩展与修改指南

### 14.1 添加新技能

1. 在 skills.js 的 skillCatalog 中添加技能定义
2. 定义技能类型、伤害系数、效果概率等
3. 如有新效果类型，在 engine.js 中添加处理逻辑

### 14.2 修改伤害公式

1. 修改 engine.js 中的 calcDamage 函数
2. 确保客户端和服务端使用同一份代码
3. 运行测试验证：
ode --test 战斗/engine.test.js

### 14.3 添加新状态效果

1. 在 engine.js 中添加状态施加逻辑（pplySkillStatus）
2. 添加状态结算逻辑（回合末效果）
3. 添加状态图标到 BATTLE_STATUS_ICONS
4. 在 ctiveBattleStatusIconIds 中添加显示逻辑

### 14.4 修改PVP逻辑

1. 单人/多人/组队联网战斗：修改 联网战斗/runtime.js
3. 确保修改不破坏客户端渲染逻辑

### 14.5 添加新被动技能

1. 在 skills.js 中定义被动技能（	ype: "passive"）
2. 在 engine.js 的 pplyBattlePassives 中添加效果
3. 如需战斗中生效，在 ighterAction 或相关函数中添加触发逻辑

---

## 十五、测试与调试

### 15.1 单元测试

`ash
node --test 战斗/engine.test.js
`

测试覆盖：
- 焚灵祭命的复活效果持续时间验证
- 复活应在第2、3回合生效，第4回合失效

### 15.2 调试技巧

- 查看 state.battle 对象了解当前战斗状态
- 查看 state.battle.statusLog 了解战斗日志
- 查看 state.battle.effects 了解当前特效
- 使用浏览器开发者工具调试客户端逻辑
- 查看服务器日志调试PVP逻辑

---

## 十六、注意事项

### 16.1 客户端/服务端一致性

- skills.js 和 engine.js 同时支持浏览器和Node.js
- 修改规则层后需确保两端同步更新
- 避免在规则层添加UI或网络逻辑

### 16.2 性能考虑

- 状态图标渲染：避免过多图标影响性能
- 特效渲染：及时清理过期特效
- 快照传输：压缩数据包大小

### 16.3 安全性

- PVP战斗结果由服务端决定，客户端不可篡改
- 服务端验证所有战斗选择的合法性
- 防止客户端发送无效的battleId或选择数据

### 16.4 已知限制

- protocol.js 仍使用浏览器全局变量风格
- session.js 存在但未激活
- NPC/Boss战斗仍在客户端结算
- 如果需要将NPC战斗也移到服务端，可复用 engine.js 添加新的服务端编排器
