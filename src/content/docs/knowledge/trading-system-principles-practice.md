---
title: 交易系统原理到应用
description: 从市场微观结构、行情、订单簿、撮合、风控、回测到实盘一致性的系统学习路线。
---

# 交易系统原理到应用

更新时间：2026-06-23

## 0. 为什么交易系统不能只讲“策略下单”

很多人讲交易系统会停留在：

```text
行情来了 -> 策略算信号 -> 下单 -> 成交 -> 赚钱
```

这太简单。真实交易系统的复杂度来自：

- 市场数据不完美：乱序、延迟、缺口、重复、快照增量不一致；
- 订单不是立即成交：会 accepted、rejected、partial fill、cancel pending；
- 交易所有规则：tick size、lot size、min notional、限频、维护、风控；
- 成交不是一个价格：可能吃多档盘口，有手续费和滑点；
- 回测不等于实盘：bar 内路径未知，实盘有延迟、拒单、部分成交；
- 本地状态可能错：请求超时后不知道订单是否成功；
- 资金和持仓必须严格一致：重复 fill 会导致灾难性错误。

所以交易系统的核心不是“策略公式”，而是**事件、状态、一致性和风险控制**。

## 1. 市场微观结构：交易到底发生在哪里

### 1.1 订单簿是什么

大多数连续竞价市场可以抽象成订单簿：

```text
卖盘 asks: 价格从低到高
  ask3: price=103, qty=5
  ask2: price=102, qty=3
  ask1: price=101, qty=2

买盘 bids: 价格从高到低
  bid1: price=100, qty=4
  bid2: price=99,  qty=8
  bid3: price=98,  qty=6
```

当前最优价格：

```text
best_bid = 100
best_ask = 101
spread = best_ask - best_bid = 1
mid_price = (best_bid + best_ask) / 2
```

### 1.2 为什么最新成交价不等于可成交价格

最新成交价只是最近一笔 trade 的价格，不代表你现在能以这个价格成交。

买入要看 ask，卖出要看 bid：

```text
买市价单 -> 吃 ask
卖市价单 -> 吃 bid
```

所以实盘里如果用 last price 回测成交，可能明显高估。

### 1.3 限价单和市价单的本质

| 类型 | 本质 | 风险 |
|---|---|---|
| 限价单 | 指定最差可接受价格 | 可能不成交或部分成交 |
| 市价单 | 立即吃对手盘 | 滑点不可控，流动性不足时很差 |
| Stop | 触发后转市价或限价 | 触发价不等于成交价 |
| Post-only | 只做 maker | 可能被拒绝或取消 |
| IOC/FOK | 即时成交约束 | 未成交部分取消或全不成交 |

面试里要强调：订单类型决定成交假设，回测必须模拟这些差异。

## 2. 行情系统：为什么数据本身就是风险

### 2.1 行情数据类型

| 数据 | 含义 | 用途 |
|---|---|---|
| trade/tick | 单笔成交 | 成交聚合、短周期统计 |
| kline/bar | 时间窗口 OHLCV | 中低频策略、指标计算 |
| quote | best bid/ask | 价差、即时可成交价格 |
| depth/order book | 多档盘口 | 滑点、流动性、盘口策略 |
| funding/open interest | 衍生品特有 | 资金费率、杠杆拥挤度 |

### 2.2 event_time 与 receive_time

行情事件至少有两个时间：

```text
event_time：交易所事件发生时间
receive_time：本地收到时间
```

回测通常按 event_time 推进；实盘还要监控 receive_time - event_time 的延迟。

如果只看本地接收时间，可能会把延迟数据当成新数据；如果只看事件时间，可能忽略实盘可用性。

### 2.3 K 线的时间语义

1 小时 K 线 `[10:00, 11:00)`：

```text
10:00 开始形成
11:00 才收盘确认
11:00 之后才能使用 close/high/low/volume
```

这就是为什么不能在 10:30 用这根 K 线的 close，也不能在 11:00 产生信号后又假设订单在 10:15 通过这根 K 线的 low 成交。

### 2.4 乱序、重复、缺口

| 问题 | 原因 | 处理 |
|---|---|---|
| 乱序 | 网络延迟、分片、异步流 | buffer + watermark + event_time 排序 |
| 重复 | 重连补发、交易所重复推送 | symbol + timestamp + seq 去重 |
| 缺口 | 断线、丢包、API 限制 | gap check + 补拉历史 |
| 快照增量断裂 | order book diff 丢失 | 重新拉 snapshot |

关键原则：发现 order book 增量断裂时，不要继续基于错误盘口做决策，必须重建状态。

## 3. 订单系统：核心是状态机

### 3.1 为什么需要订单状态机

订单不是一次函数调用。它是一个异步状态流：

```text
本地创建
  -> 发给交易所
  -> 交易所确认接收
  -> 部分成交
  -> 撤单请求
  -> 撤单确认
  -> 终态
```

每一步都可能延迟、失败、重复或乱序。

### 3.2 标准状态模型

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

Accepted / PartiallyFilled
  -> Expired
```

### 3.3 状态机不变量

订单状态机必须维护不变量：

```text
cum_qty >= 0
remaining_qty >= 0
cum_qty + remaining_qty = order_qty
cum_qty 单调增加
remaining_qty 单调减少
终态不能回到非终态
重复 fill 不能重复应用
```

这些不变量比具体 enum 名字更重要。

### 3.4 部分成交后撤单为什么容易错

错误理解：

```text
撤单成功 = 订单完全没成交
```

正确理解：

```text
撤单成功 = 未成交的剩余量被取消
已经成交的部分仍然有效
```

例子：

```text
订单 qty=10
成交 3
撤单成功
最终 Canceled，但 cum_qty=3，remaining_qty=7
```

### 3.5 幂等为什么重要

网络系统里同一回报可能重复到达。如果重复应用 fill：

```text
第一次 fill 3 -> 持仓 +3
第二次同一个 fill 3 -> 持仓又 +3
```

持仓直接错。

所以必须保存：

```text
processed_exec_ids
```

重复的 exec_id 直接忽略。

## 4. 下单、撤单、查询：为什么不能盲目重试

### 4.1 请求超时不代表失败

下单请求 timeout 时，可能发生了三种情况：

```text
请求没到交易所
请求到了但交易所没处理
交易所已创建订单，但响应丢了
```

如果你直接再下一个新订单，可能重复开仓。

### 4.2 client_order_id 的作用

`client_order_id` 是本地生成的幂等键。

正确流程：

```text
生成 client_order_id
发送下单请求
如果 timeout：
  用 client_order_id 查询
  如果订单存在：接管状态
  如果明确不存在：决定是否重试
```

### 4.3 撤单也不是简单操作

撤单请求 timeout 时：

```text
可能撤单成功但响应丢了
可能订单已经成交无法撤
可能订单不存在
可能请求没到
```

因此要查询订单最终状态，而不是只看撤单接口返回。

## 5. 撮合原理：价格优先和时间优先

### 5.1 基本规则

买单优先级：价格越高越优先，同价格时间越早越优先。

卖单优先级：价格越低越优先，同价格时间越早越优先。

成交条件：

```text
best_bid >= best_ask
```

### 5.2 数据结构

一种常见实现：

```text
buy_book:  price -> FIFO queue, price descending
sell_book: price -> FIFO queue, price ascending
order_index: order_id -> order location
```

为什么需要 order_index？

- 撤单需要 O(1) 或接近 O(1) 找到订单；
- 查询订单状态；
- 处理部分成交后的剩余量；
- 避免只靠遍历 order book。

### 5.3 撮合价由谁决定

不同市场规则不同。常见简化：成交价取 resting order 价格。

例如：

```text
簿上已有卖单 ask=101
新买单 limit=103
可成交，成交价可能是 101
```

回测时必须明确你的撮合价假设，否则收益不可解释。

## 6. 风控：为什么策略不能直接下单到交易所

策略信号只是“想交易”，不是“必须交易”。下单前必须检查：

| 风控项 | 为什么需要 |
|---|---|
| symbol 是否可交易 | 防止下架、维护、黑名单 |
| tick size | 价格不合法会被拒单 |
| lot size | 数量不合法会被拒单 |
| min notional | 金额太小会被拒单 |
| 可用资金 | 防止超额下单 |
| 最大仓位 | 控制单标的风险 |
| 最大订单金额 | 防止异常信号打出大单 |
| 最大杠杆 | 控制爆仓风险 |
| 日内亏损限制 | 防止策略失控 |
| 限频 | 防止 API ban |

风控不应该只存在实盘，回测也要尽量模拟，否则回测策略可能在实盘被大量拒单。

## 7. Portfolio：成交之后才改持仓

### 7.1 为什么不能策略自己改持仓

策略发出订单不代表成交。只有收到 fill，才能更新持仓。

错误做法：

```text
submit buy order -> position += qty
```

正确做法：

```text
submit buy order -> open order
收到 fill -> position += fill_qty
```

### 7.2 成交更新内容

一笔 fill 至少影响：

- position qty；
- average entry price；
- cash/balance；
- fee；
- realized PnL；
- unrealized PnL；
- exposure；
- margin。

### 7.3 手续费资产

加密货币交易里手续费可能不是 quote asset，而是平台币或 base asset。简单回测常忽略这一点，但实盘对账要注意。

## 8. 回测：为什么最容易骗自己

### 8.1 回测的本质

回测不是“把历史价格喂给策略”，而是模拟当时你能看到什么、能做什么、会以什么成本成交。

```text
历史数据事件流
  -> 策略按时间顺序接收
  -> 订单按当时可用信息产生
  -> 撮合按假设执行
  -> 资金和持仓按成交更新
```

### 8.2 未来函数

未来函数就是当前时刻使用了未来才知道的信息。

常见来源：

| 来源 | 例子 |
|---|---|
| 指标未 shift | 用当前 close 算信号，又在当前 close 成交 |
| 全局标准化 | 用全样本均值处理过去数据 |
| 未来收益筛选 | 用未来涨幅决定当前交易池 |
| 幸存者偏差 | 只保留今天还存在的标的 |
| bar 内路径乐观 | 同一根 bar 内先止盈后止损 |
| 调参污染 | 测试集反复试参数 |

### 8.3 OHLC bar 的限制

1h bar 只有 open/high/low/close，无法知道内部路径。

如果策略同一根 bar 内同时可能触发止盈和止损，只靠 OHLC 无法知道先后。

解决方式：

- 使用更低周期数据；
- 保守假设；
- 不在同 bar 内做路径依赖判断；
- 只在下一根 bar open 成交；
- 明确记录成交假设。

### 8.4 手续费和滑点为什么重要

高换手策略的净收益可能主要被费用决定。

```text
net_return = gross_return - fee - spread - slippage - impact - funding
```

如果只看 gross return，策略可能完全不可交易。

## 9. 实盘：状态同步比信号更重要

### 9.1 实盘异常

| 异常 | 后果 |
|---|---|
| WebSocket 断线 | 错过成交回报或行情 |
| REST timeout | 不知道请求是否成功 |
| 重复回报 | 持仓重复更新 |
| 本地进程重启 | 内存状态丢失 |
| 交易所维护 | 下单失败或行情停滞 |
| API 限频 | 查询和下单失败 |
| 时间漂移 | K 线收盘判断错误 |

### 9.2 Reconcile

实盘必须定期对账：

```text
本地 open orders vs 交易所 open orders
本地 positions vs 交易所 positions
本地 balances vs 交易所 balances
本地 fills vs 交易所 trade history
```

如果不对账，本地状态迟早会漂移。

### 9.3 重启恢复

系统重启后不能假设没有订单。需要：

1. 读取本地持久化订单；
2. 查询交易所 open orders；
3. 查询最近成交；
4. 重新构建 order state；
5. 修正 portfolio；
6. 策略恢复前确认状态一致。

## 10. 事件驱动框架为什么有价值

像 NautilusTrader 这样的事件驱动框架，价值在于把回测和实盘都抽象成事件流。

```text
MarketDataEvent
  -> Strategy
  -> OrderCommand
  -> OrderEvent
  -> FillEvent
  -> PortfolioUpdate
```

优点：

- 回测和实盘路径更一致；
- 订单状态机统一；
- 持仓和 PnL 由统一模块维护；
- 多策略多标的扩展更清晰；
- 测试可围绕事件序列构造。

代价：

- 比手写向量化回测慢；
- 全市场事件量大；
- 每根 bar 都要经过引擎；
- 需要正确设计数据注入边界。

合理优化：

```text
引擎外：全市场向量化特征、候选 symbol 预筛
引擎内：订单、撮合、持仓、PnL、风控
```

## 11. 结合你的全市场策略场景

你的策略是 1h K 线、全市场、多 symbol、先计算特征再筛选候选。

更合理的语义：

```text
每小时 bar close
  -> 全市场向量化计算特征
  -> 用当前已知特征筛掉不可能交易的 symbol
  -> 只把候选 symbol 送入引擎
  -> 策略在引擎内生成订单
  -> 撮合、手续费、滑点、PnL 走统一引擎路径
```

关键边界：

- 筛选不能用未来收益；
- warmup 数据不能产生交易；
- bar close 后才能用该 bar；
- 订单成交不能回到当前 bar 内部；
- 持仓必须由 fill 更新。

## 12. 面试扩展问题

### 原理层

- 为什么订单系统是异步状态机？
- 为什么成交回报需要幂等？
- 为什么撤单成功不代表完全没成交？
- 为什么 last price 不是可成交价格？
- 为什么 OHLC 无法决定 bar 内路径？

### 工程层

- 请求 timeout 后如何避免重复下单？
- 如何设计 order_id 映射？
- 如何测试部分成交后撤单？
- 行情增量丢失后怎么办？
- 系统重启后如何恢复状态？

### 回测层

- 如何避免未来函数？
- 如何建模手续费和滑点？
- 如何处理历史 universe？
- 如何验证回测和实盘时序一致？
- 为什么事件驱动回测比向量化慢但更可信？

### 风险层

- 最大仓位怎么限制？
- 单笔订单异常大怎么办？
- API 限频怎么办？
- 实盘和本地仓位不一致怎么办？
- 如何做 kill switch？

## 13. 最小实践路线

1. 实现 Order 状态机，覆盖 Created/Accepted/Partial/Filled/Canceled/Rejected。
2. 给状态机写非法转移测试。
3. 实现 exec_id 去重。
4. 实现简化 order book，支持限价单和撤单。
5. 用 price-time priority 写撮合测试。
6. 写一个 1h bar 回测器，强制下一根 bar 才成交。
7. 加入 fee/slippage 模型。
8. 构造 WebSocket 断线后的 reconcile 测试。
9. 构造 timeout 后用 client_order_id 查询的流程。
10. 对比“向量化信号”和“事件驱动订单路径”的差异。

## 14. 一句话总答

> 交易系统的核心是事件驱动状态机。行情提供按时间可用的数据，策略只是产生订单意图，订单必须经过风控和订单管理，成交回报才会改变持仓和资金。撮合要考虑价格时间优先、部分成交、手续费和滑点；回测要严格处理 bar close、未来函数和成交假设；实盘要处理 timeout、重复回报、断线、限频和状态 reconcile。真正重要的是让回测和实盘在数据时序、订单状态、成交和账户更新上尽量一致。

## 15. 资料入口

- FIX Trading Community Standards：https://fixtrading.org/standards/
- FIX Protocol Dictionary：https://www.onixs.biz/fix-dictionary.html
- NautilusTrader Docs：https://nautilustrader.io/docs/
- CCXT Docs：https://docs.ccxt.com/
- Binance Spot API Docs：https://developers.binance.com/docs/binance-spot-api-docs
