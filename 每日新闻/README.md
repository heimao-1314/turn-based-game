# 每日新闻

“笛子”NPC 下的每日阅读与阅读点数兑换领域。

- 新闻由服务端从 `https://60s.viki.moe/v2/60s?encoding=text` 拉取并短暂缓存。
- 每个账号按上海自然日最多获得 1 点阅读点数；领取记录由 `daily_news_reads` 的 `(account, read_day)` 主键保证幂等。
- 兑换目录集中在 `server.js` 的 `EXCHANGE_CATALOG`；新增物品时添加一个配置项和对应的服务端发奖实现。

API（均要求玩家会话）：

- `GET /api/daily-news/status`
- `POST /api/daily-news/read`
- `GET /api/reading-exchange/catalog`
- `POST /api/reading-exchange/redeem`，body: `{ itemId }`
