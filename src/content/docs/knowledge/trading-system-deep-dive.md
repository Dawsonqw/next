---
title: 交易系统基础深度笔记
description: 行情、委托、撮合、订单状态机、回测一致性和实习经历面试边界。
---

# 交易系统基础深度笔记

更新时间：2026-06-23

## 1. 学习目标

交易系统经历是 C++ 工程能力的辅助证明，不应包装成金融核心系统专家。重点是能讲清：行情如何进入系统、订单如何流转、撮合如何生成成交、成交回报如何更新订单/持仓、回测为什么容易和实盘不一致。

面试中交易系统通常会这样追问：

```text
你做了什么模块？
  -> 订单从策略到成交经过什么？
  -> 状态机怎么设计？
  -> 部分成交和撤单交错怎么办？
  -> 行情乱序/重复/缺口怎么办？
  -> 撮合如何测试？
  -> 回测如何避免未来函数？
  -> 实盘异常如何恢复？
```

## 2. 基本模块

| 模块 | 作用 | 面试容易追问 |
|---|---|---|
| 行情模块 | 接收、解析、缓存和分发市场数据 | tick/bar/depth、乱序、缺口、快照增量 |
| 委托模块 | 接收策略订单、校验、发送、维护订单状态 | 状态机、幂等、重试、撤单 |
| 撮合模块 | 根据规则生成成交结果，可用于回测或模拟交易 | 价格优先、时间优先、部分成交 |
| 策略接入 | 将行情、账户、订单、成交回报暴露给策略 | 是否偷看未来、账户状态时序 |
| 风控模块 | 检查资金、仓位、价格、频率等约束 | 单笔限制、最大仓位、可用资金 |
| Portfolio | 维护持仓、现金、手续费和 PnL | 成交后更新、重复成交去重 |

## 3. 订单生命周期深挖

### 3.1 状态图

```text
Created
  -> Submitted
  -> Accepted
  -> PartiallyFilled
  -> Filled

Accepted / PartiallyFilled
  -> CancelPending
  -> Canceled

Created / Submitted / Accepted
  -> Rejected

Accepted
  -> Expired
```

### 3.2 终态

终态通常包括：

- Filled；
- Canceled；
- Rejected；
- Expired。

进入终态后，订单不能再接受普通状态转移。但真实系统可能出现延迟回报，因此要区分“业务事件时间”和“系统接收时间”。

### 3.3 部分成交后撤单

典型链路：

```text
Order Accepted, qty = 10
  -> Fill 3
  -> Cancel requested
  -> Fill 2 arrives before cancel ack
  -> Cancel ack
最终状态：Canceled
累计成交：5
剩余未成交：5
```

面试关键点：Canceled 不代表成交量为 0，而是剩余量被取消。

### 3.4 重复成交回报

同一个成交回报可能重复到达。必须用 `exec_id` / `trade_id` 去重。

```text
if exec_id in processed_exec_ids:
    ignore
else:
    apply fill
    processed_exec_ids.add(exec_id)
```

如果不去重，持仓和现金会被重复更新。

### 3.5 本地 ID 和交易所 ID

| ID | 来源 | 作用 |
|---|---|---|
| client_order_id | 本地生成 | 幂等、查询、重试、关联策略意图 |
| exchange_order_id | 交易所返回 | 后续查询、撤单、回报匹配 |
| exec_id / trade_id | 成交系统返回 | 成交去重和审计 |
| strategy_order_id | 策略内部 | 策略意图和订单关联 |

追问：请求超时但订单其实成功了怎么办？

答：不能盲目生成新订单重发。应该用原来的 `client_order_id` 查询订单状态；如果交易所已接收，就接管后续状态；如果明确不存在，再决定是否重试。

## 4. 委托模块追问树

### Q1：订单参数校验有哪些？

| 校验 | 示例 |
|---|---|
| symbol 是否可交易 | 是否下架、维护、黑名单 |
| side/type 合法 | buy/sell、limit/market |
| price tick size | 价格必须符合最小变动单位 |
| quantity lot size | 数量必须符合最小下单单位 |
| min notional | 名义金额不能太小 |
| 可用资金 | 现金或保证金足够 |
| 最大仓位 | 单 symbol 和总账户限制 |
| 风险限制 | 最大杠杆、最大亏损、最大订单频率 |

### Q2：下单失败如何分类？

| 类型 | 示例 | 处理 |
|---|---|---|
| 本地风控拒绝 | 资金不足、数量非法 | 不发送，订单 Rejected |
| 网络失败 | timeout、连接断开 | 查询确认，不盲目重发 |
| 交易所拒绝 | min notional、价格越界 | Rejected，记录 reason |
| 限频失败 | too many requests | backoff、rate limiter |
| 未知状态 | 请求超时无回报 | reconcile/query |

### Q3：撤单失败怎么办？

撤单失败不一定是坏事，需要看原因：

| 原因 | 含义 | 处理 |
|---|---|---|
| order already filled | 已成交，不能撤 | 更新为 Filled |
| order already canceled | 已撤 | 更新为 Canceled 或忽略 |
| order not found | 可能 ID 错、已过期、状态不同步 | 查询 open orders / history |
| network timeout | 不知道是否撤成功 | 查询订单状态 |

## 5. 撮合模块深挖

### 5.1 价格优先、时间优先

买单：价格高优先；同价时间早优先。

卖单：价格低优先；同价时间早优先。

```text
best_bid >= best_ask 时可以成交
成交价常取 resting order 价格，具体取决于撮合规则
```

### 5.2 Order Book 数据结构

一种常见结构：

```text
buy_book:  map<price, queue<order>, greater<price>>
sell_book: map<price, queue<order>, less<price>>
order_index: unordered_map<order_id, pointer/location>
```

为什么需要 `order_index`？

- 撤单要快速找到订单；
- 查询订单状态；
- 修改订单或取消剩余量。

### 5.3 市价单风险

市价单不是“按最新价成交”，而是吃当前盘口流动性：

```text
买市价单吃 ask1, ask2, ask3...
卖市价单吃 bid1, bid2, bid3...
```

如果盘口流动性不足，可能部分成交或滑点很大。

### 5.4 回测用 OHLC 撮合的限制

OHLC 只有 open/high/low/close，不知道 bar 内路径。

例子：

```text
当前持仓多头
同一根 bar 同时 high 触发止盈、low 触发止损
只看 OHLC 无法知道先触发哪个
```

处理方式：

- 保守假设；
- 使用更小周期数据；
- 使用 tick/depth；
- 策略设计上避免同 bar 多个路径依赖条件；
- 在文档中明确撮合假设。

## 6. 行情模块深挖

### 6.1 tick、bar、depth 区别

| 类型 | 含义 | 用途 |
|---|---|---|
| tick/trade | 单笔成交 | 高频成交分析、聚合 K 线 |
| bar/kline | 一段时间 OHLCV | 中低频策略、指标计算 |
| depth/order book | 买卖盘口 | 滑点、流动性、盘口策略 |
| quote | best bid/ask | 点差、即时可成交价格 |

### 6.2 快照和增量

盘口数据常见流程：

```text
拉取 REST snapshot
  -> 记录 lastUpdateId
  -> 接收 WebSocket 增量
  -> 丢弃旧增量
  -> 从连续的增量开始应用
  -> 如果发现序号断裂，重新拉 snapshot
```

追问点：如果中间丢了一条增量怎么办？

答：order book 已不可信，应该重新同步快照，而不是继续基于错误盘口撮合或决策。

### 6.3 时间戳

| 时间 | 含义 |
|---|---|
| event_time | 交易所事件发生时间 |
| receive_time | 本地收到时间 |
| process_time | 系统处理时间 |
| bar_close_time | K 线收盘时间 |

回测一般按 event_time 推进；实盘要同时监控 receive_time 延迟。

### 6.4 行情缺口

如果某个 symbol 的 1h K 线缺了一根：

- 不能用下一根直接补；
- 可以补拉历史；
- 如果无法补齐，标记该时间段不可交易；
- 指标计算要考虑 NaN 和 warmup；
- 回测结果要记录数据质量问题。

## 7. 回测一致性深挖

### 7.1 bar close 时序

```text
[10:00, 11:00) 的 bar
  -> 11:00 才确认 close/high/low/volume
  -> 11:00 后才能计算信号
  -> 订单不能在 10:00-11:00 内用这根 bar 的 high/low 成交
```

面试中一定要强调“信号时间”和“成交时间”分离。

### 7.2 未来函数常见来源

| 来源 | 例子 |
|---|---|
| 指标未 shift | 用当前 close 计算后又在当前 close 买入 |
| 全局归一化 | 用全样本均值/std 处理过去数据 |
| 未来涨幅筛选 symbol | 先看未来表现再纳入 universe |
| 退市/下架偏差 | 只保留当前还存在的标的 |
| bar 内路径乐观 | 同 bar 内先止盈后止损 |
| 调参过拟合 | 在测试集反复优化参数 |

### 7.3 手续费和滑点

高频或中频策略必须考虑：

```text
gross return
  - maker/taker fee
  - spread
  - slippage
  - market impact
  - funding/borrow cost
  = net return
```

如果策略换手高，手续费可能吞掉大部分收益。

### 7.4 实盘状态 reconcile

实盘需要定期对账：

- open orders；
- positions；
- balances；
- recent trades；
- local order state；
- missed fills。

如果本地认为订单 open，但交易所已经 filled/canceled，必须以交易所最终状态修正。

## 8. NautilusTrader 相关追问

### Q1：为什么用事件驱动引擎？

因为回测和实盘都可以抽象为事件流：行情事件、订单事件、成交事件、账户事件。事件驱动引擎能让策略、撮合、portfolio/cache 走统一路径，减少回测和实盘语义漂移。

### Q2：为什么全市场回测慢？

因为引擎不只是计算指标，而是重放每个 symbol 每根 bar，每个事件都要经过 data engine、message bus、strategy、matching、portfolio、cache。全市场长周期会产生大量事件。

### Q3：如何优化但不破坏语义？

合理边界：

```text
引擎外：全市场向量化特征、粗筛 symbol、准备候选数据
引擎内：订单生成、撮合、成交、持仓、PnL、风控语义
```

不建议：

- 在引擎外直接改持仓；
- 在引擎外直接生成 PnL 替代引擎成交；
- 用未来全局信息筛候选 symbol。

## 9. 测试设计

### 9.1 订单状态机测试表

| 当前状态 | 事件 | 期望 |
|---|---|---|
| Created | submit ok | Submitted |
| Submitted | accepted | Accepted |
| Accepted | fill partial | PartiallyFilled |
| PartiallyFilled | fill rest | Filled |
| Accepted | cancel request | CancelPending |
| CancelPending | fill partial | CancelPending + cum_qty 增加 |
| CancelPending | cancel ack | Canceled |
| Filled | cancel ack | 忽略或报非法，不能改 Canceled |
| Rejected | fill | 非法 |

### 9.2 撮合测试表

| 测试 | 输入 | 期望 |
|---|---|---|
| 价格优先 | 多个买单价格不同 | 高价先成交 |
| 时间优先 | 同价多个订单 | 先到先成交 |
| 部分成交 | 对手盘数量不足 | partial fill |
| 市价单吃多档 | ask1 不足 | 继续吃 ask2 |
| 撤单 | order_id 存在 | 从 book 移除 |
| 重复撤单 | 已撤订单再次撤 | 幂等或明确失败 |
| 重复成交 | 同 exec_id 两次 | 只记一次 |

### 9.3 回测测试表

| 测试 | 检查点 |
|---|---|
| bar close | 信号只在 close 后出现 |
| warmup | 指标不足时不交易 |
| fee | 每笔 fill 扣费 |
| slippage | 成交价含滑点 |
| universe | 不使用未来标的信息 |
| missing data | 缺口不悄悄 forward-fill 价格 |

## 10. 面试边界

可以说：

> 我参与过行情、委托、撮合相关模块开发和测试，理解订单从策略发出到成交回报的状态流转，也做过订单状态机、异常状态和撮合规则的测试。

谨慎说：

> 我负责整个低延迟交易系统架构。

更稳表达：

> 我不是整个交易系统架构负责人，但我对行情、委托、撮合、订单状态机和回测/实盘一致性的关键链路做过实现或测试，因此能解释这些模块的职责边界和常见异常处理。

## 11. 高频追问速查

| 问题 | 答题关键词 |
|---|---|
| 行情、委托、撮合分别负责什么？ | 数据、订单、成交 |
| 一个订单如何流转？ | strategy -> risk -> order manager -> execution -> fill -> portfolio |
| client_order_id 有什么用？ | 幂等、查询、重试 |
| 部分成交后撤单怎么办？ | 先记成交，剩余取消 |
| 重复成交回报怎么办？ | exec_id 去重 |
| 撮合价格时间优先怎么实现？ | price level + FIFO queue |
| 行情乱序怎么办？ | event_time、seq、watermark、gap check |
| 回测如何避免未来函数？ | bar close 后决策，信号和成交时间分离 |
| 回测为什么高估收益？ | fee/slippage/partial fill/survivorship/look-ahead |
| 实盘状态不同步怎么办？ | reconcile open orders/positions/trades |

## 12. 资料入口

- FIX Trading Community Standards：https://fixtrading.org/standards/
- FIX Protocol Online Dictionary：https://www.onixs.biz/fix-dictionary.html
- NautilusTrader Docs：https://nautilustrader.io/docs/
- CCXT Docs：https://docs.ccxt.com/
- Binance Spot API Docs：https://developers.binance.com/docs/binance-spot-api-docs
