---
title: 交易系统
description: 行情、委托、撮合、订单状态流转、回测一致性和风险边界。
---

# 交易系统

更新时间：2026-06-23

## 学习目标

交易系统不是“策略代码下单”这么简单。真正的主线是：行情如何进入系统、策略如何做决策、订单如何经过风控和交易通道、撮合或交易所如何产生成交、成交回报如何驱动订单状态和持仓资金变化。

可以用下面这条链路理解：

```text
行情源 / 交易所 WebSocket / 历史数据
  -> 行情接入与标准化
  -> K 线聚合 / 特征计算 / 策略信号
  -> 风控检查 / 资金检查 / 仓位检查
  -> 订单生成 / 订单路由
  -> 撮合引擎或交易所 API
  -> 成交回报 / 撤单回报 / 拒单回报
  -> 订单状态机
  -> 持仓 / 资金 / PnL / 风险暴露更新
```

## 必须掌握

- 行情模块、委托模块、撮合模块的职责边界。
- 策略侧行情接入、订单流转、成交回报。
- 订单状态机、异常处理、幂等和重试。
- 交易系统中的延迟、吞吐、可靠性和一致性取舍。
- 回测与实盘语义一致：数据时间、成交假设、手续费、滑点、仓位更新时机。

## 模块架构图

```text
                ┌────────────────────┐
                │ Market Data Source │
                └─────────┬──────────┘
                          │ tick / bar / depth
                          ▼
┌────────────────────────────────────────────────┐
│ Market Data Adapter                            │
│ - normalize symbol                             │
│ - timestamp alignment                          │
│ - dedup / gap check                            │
│ - bar aggregation                              │
└───────────────────────┬────────────────────────┘
                        │ normalized market data
                        ▼
┌────────────────────────────────────────────────┐
│ Strategy / Alpha Engine                         │
│ - feature calculation                           │
│ - signal generation                             │
│ - position target                               │
└───────────────────────┬────────────────────────┘
                        │ order intent
                        ▼
┌────────────────────────────────────────────────┐
│ Risk / Portfolio / Order Manager                │
│ - cash / margin check                           │
│ - max position / max order size                 │
│ - idempotency / client_order_id                 │
│ - order state machine                           │
└───────────────────────┬────────────────────────┘
                        │ accepted order
                        ▼
┌────────────────────────────────────────────────┐
│ Execution Adapter / Matching Engine             │
│ - live: exchange REST/WebSocket                 │
│ - backtest: simulated matching                  │
└───────────────────────┬────────────────────────┘
                        │ execution report
                        ▼
┌────────────────────────────────────────────────┐
│ Accounting / Position / PnL                      │
│ - fills                                           │
│ - fees                                            │
│ - realized/unrealized PnL                         │
│ - exposure                                        │
└────────────────────────────────────────────────┘
```

## 各模块职责边界

| 模块 | 输入 | 输出 | 不能做什么 |
|---|---|---|---|
| 行情接入 | 原始 tick/depth/bar | 标准化行情事件 | 不应该直接改仓位 |
| K 线聚合 | tick 或 lower timeframe bar | 对齐后的 bar | 不应该偷看未来数据 |
| 策略 | 行情、特征、持仓快照 | order intent / target position | 不应该绕过风控直接成交 |
| 风控 | order intent、账户、持仓 | accept/reject/resize | 不应该修改策略逻辑 |
| 订单管理 | accepted order、回报 | order state | 不应该自己创造成交 |
| 撮合/执行 | 订单、市场流动性 | execution report | 不应该直接改策略状态 |
| 会计/组合 | fill、fee、price | position、cash、PnL | 不应该接收未确认成交 |

## 订单生命周期

一个订单从策略发出到结束，核心是状态机。

```text
Created
  -> Submitted
  -> Accepted
  -> PartiallyFilled
  -> Filled

Accepted
  -> CancelPending
  -> Canceled

Created / Submitted / Accepted
  -> Rejected

Submitted / Accepted
  -> Expired
```

更细一些可以区分：

| 状态 | 含义 | 触发事件 |
|---|---|---|
| Created | 本地创建，尚未发出 | 策略产生订单意图 |
| Submitted | 已发给交易通道，等待确认 | send_order 成功返回或异步发送 |
| Accepted | 交易所或撮合模块确认接收 | ack / new order report |
| PartiallyFilled | 部分成交 | fill qty 小于剩余数量 |
| Filled | 全部成交 | 累计成交量等于订单量 |
| CancelPending | 撤单请求已发出 | cancel request |
| Canceled | 撤单成功 | cancel ack |
| Rejected | 拒单 | 风控拒绝、交易所拒绝、参数非法 |
| Expired | 订单过期 | TIF 到期 |

## 订单状态机设计原则

### 1. 状态转移必须单调

成交量只能增加，不能减少；最终状态不能回退。

```text
Filled / Canceled / Rejected / Expired 是终态
终态订单不再接受新的普通状态变更
```

### 2. 回报要幂等

交易系统里同一个 execution report 可能重复到达。要用 `exec_id`、`trade_id` 或 `(order_id, fill_id)` 做去重。

```text
if fill_id already processed:
    ignore
else:
    apply fill to order and position
```

### 3. 本地 ID 和交易所 ID 要区分

| ID | 来源 | 用途 |
|---|---|---|
| `client_order_id` | 本地生成 | 幂等、重试、关联请求 |
| `exchange_order_id` | 交易所返回 | 查询、撤单、回报匹配 |
| `exec_id` / `trade_id` | 成交回报返回 | 成交去重 |

### 4. 部分成交和撤单可能交错

常见真实情况：

```text
订单 Accepted
  -> 发起 CancelPending
  -> 撤单成功前又收到一笔 Fill
  -> 最终 Canceled，但累计成交量 > 0
```

因此不能把 `CancelPending` 当成“不会再成交”。撤单只是请求，不是结果。

## 一笔订单经过哪些模块

以策略发起限价买单为例：

```text
1. Strategy 根据最新 bar 和持仓生成 buy limit order intent。
2. Risk 检查最大仓位、可用资金、单笔订单大小、交易对是否允许交易。
3. OrderManager 分配 client_order_id，记录 Created 状态。
4. ExecutionAdapter 把订单转成交易所 API 请求或回测撮合请求。
5. 交易所返回 accepted/rejected。
6. OrderManager 更新状态为 Accepted 或 Rejected。
7. 后续收到 partial fill / full fill / cancel ack。
8. Portfolio 根据 fill 更新持仓、现金、手续费和 PnL。
9. Strategy 下一次决策读取更新后的账户状态。
```

## 行情数据问题

| 问题 | 现象 | 处理方式 |
|---|---|---|
| 乱序 | 后到的数据时间戳更早 | 按 event_time 排序，设置 watermark |
| 重复 | 同一 bar 或 tick 多次到达 | 用 `(symbol, timestamp, seq)` 去重 |
| 缺口 | 某段时间没有数据 | gap check、补拉历史、标记不可交易 |
| 时区错误 | bar close 对不齐 | 全系统统一 UTC 或明确 exchange timezone |
| 未收盘 K 线 | 使用了还会变化的 bar | 只在 bar close 后决策 |
| survivorship bias | 回测只用了现在还存在的币/股票 | 保存历史 universe |
| look-ahead bias | 用未来数据产生当前信号 | 严格按时间推进，特征 shift |

## K 线和策略时序

对于 1 小时 K 线策略，最重要的是明确：

```text
10:00 - 11:00 的 K 线
  -> 11:00 才收盘
  -> 11:00 之后才能用于计算信号
  -> 订单最早在 11:00 之后撮合
```

禁止：

- 用当前未收盘 K 线的 close 作为已知价格；
- 在同一根 bar 内用 high/low 判断本来无法知道的成交顺序；
- 用全市场未来涨跌幅筛选当前 symbol；
- 用未来是否退市决定过去 universe。

## 撮合逻辑

### 简化限价单撮合

买入限价单：

```text
如果 bar.low <= limit_price，则认为有机会成交
成交价可以设为：
  - limit_price
  - next_open
  - min(limit_price, next_open)
  - 根据更细粒度 tick/depth 模拟
```

卖出限价单：

```text
如果 bar.high >= limit_price，则认为有机会成交
```

### 关键问题：同一根 bar 的路径未知

OHLC 只有四个价格，无法知道 bar 内先触发止盈还是先触发止损。

解决方式：

| 方法 | 特点 |
|---|---|
| 保守假设 | 对策略不利的事件先发生 |
| 乐观假设 | 对策略有利的事件先发生，容易高估 |
| 使用更小周期数据 | 例如 1h 策略用 1m 数据辅助撮合 |
| 使用 tick/depth | 更接近真实，但数据成本高 |
| 明确限制订单类型 | 避免同 bar 同时存在多个路径依赖条件 |

## 手续费、滑点、冲击成本

| 成本 | 含义 | 回测处理 |
|---|---|---|
| maker fee | 挂单成交费率 | 根据订单是否提供流动性决定 |
| taker fee | 吃单成交费率 | 市价单或立即成交限价单常用 |
| spread | 买卖一价差 | 用 bid/ask 或加价差模型 |
| slippage | 理论价和实际成交价差异 | 固定 bps、波动率相关、成交量相关 |
| market impact | 大单推动市场价格 | 与订单量/市场成交量比例相关 |

对高换手策略，手续费和滑点可能决定策略是否还有收益。回测里必须显式记录费率和滑点模型，不能只看 gross return。

## 回测与实盘一致性

| 维度 | 回测 | 实盘 | 风险 |
|---|---|---|---|
| 时间 | 历史事件重放 | 实时事件流 | bar close 对齐不一致 |
| 成交 | 模拟撮合 | 交易所真实撮合 | 滑点、部分成交、拒单 |
| 资金 | 模拟账户 | 真实账户 | 手续费、冻结资金、杠杆规则 |
| 数据 | 干净历史数据 | 延迟、丢包、补推 | 实盘状态和回测状态漂移 |
| Universe | 历史池 | 当前可交易池 | 幸存者偏差 |
| 异常 | 通常简化 | 网络、限频、维护、风控 | 实盘不可用 |

一句话：回测系统的目标不是“跑得快”本身，而是让策略看到的数据、下单的时机、成交的假设、账户状态更新的顺序尽量接近实盘语义。

## 风控检查清单

下单前：

- symbol 是否允许交易；
- 当前是否在维护或黑名单；
- 订单数量是否满足最小下单量；
- 价格是否满足 tick size；
- 数量是否满足 lot size；
- 可用资金或保证金是否足够；
- 单笔最大名义金额；
- 单 symbol 最大仓位；
- 全账户最大杠杆/最大风险暴露；
- 当日最大亏损或回撤限制；
- 是否已有冲突订单。

下单后：

- ack 超时是否查询订单状态；
- 网络超时是否避免重复下单；
- 撤单失败是否重查；
- 部分成交是否更新剩余数量；
- 手续费资产是否影响余额；
- 实盘和本地状态是否定期 reconcile。

## 幂等和重试

交易系统最怕“请求超时后不知道订单到底有没有成功”。正确思路：

```text
每个订单先生成 client_order_id
发送请求超时
  -> 不要立刻生成新订单重发
  -> 先用 client_order_id 查询订单
  -> 如果存在，接管后续状态
  -> 如果明确不存在，再按同一个意图重试或放弃
```

重试分三类：

| 类型 | 是否可直接重试 | 说明 |
|---|---|---|
| 查询请求 | 通常可以 | 幂等读操作 |
| 撤单请求 | 谨慎可重试 | 需要处理已成交/已撤/不存在 |
| 下单请求 | 不能盲目重试 | 必须依赖 client_order_id 去重 |

## 撮合逻辑如何测试

### 单元测试维度

| 用例 | 输入 | 期望 |
|---|---|---|
| 限价买不成交 | bar.low > limit_price | no fill |
| 限价买成交 | bar.low <= limit_price | fill |
| 部分成交 | 市场可成交量不足 | partial fill |
| 市价单 | 有可用盘口 | 按盘口成交 |
| 撤单前成交 | cancel pending 后收到 fill | 先记 fill，再最终 canceled |
| 重复成交回报 | 同一 fill_id 到达两次 | 只应用一次 |
| 拒单 | 价格/数量非法 | rejected，不改仓位 |
| 手续费 | fill 后扣 fee | cash 和 fee asset 正确 |

### 状态机测试

```text
Created -> Submitted -> Accepted -> Filled       合法
Created -> Rejected                              合法
Accepted -> CancelPending -> Canceled            合法
Accepted -> PartiallyFilled -> Canceled          合法
Filled -> Canceled                               非法
Rejected -> Filled                               非法
Canceled -> PartiallyFilled                      通常非法，除非是撤单前已成交回报延迟且带更早时间戳，需要特殊处理
```

## 事件驱动系统常见坑

| 坑 | 结果 | 规避 |
|---|---|---|
| 策略直接读写全局持仓 | 回测和实盘状态不一致 | 通过 Portfolio/Cache 统一读 |
| 同一时间戳事件顺序不固定 | 结果不可复现 | 定义稳定排序规则 |
| 成交回报重复应用 | 仓位翻倍 | fill_id 去重 |
| 订单发送失败后盲目重发 | 重复下单 | client_order_id 幂等 |
| 回测使用未来 bar close | 收益虚高 | bar close 后才决策 |
| 手续费漏算 | 高频策略收益虚高 | fill 级别计算 fee |
| 忽略最小下单量 | 实盘拒单 | symbol filter |
| 忽略交易所限频 | 实盘不可用 | rate limiter 和批量查询 |

## 结合 NautilusTrader 的理解

如果使用 NautilusTrader 这类事件驱动交易框架，核心不是手写一个“最快捷”的回测循环，而是尽量尊重引擎语义：

```text
Data Event
  -> Strategy.on_bar / on_data
  -> submit_order
  -> ExecutionClient / MatchingEngine
  -> OrderEvent / FillEvent
  -> Portfolio / Cache update
```

优点：

- 回测和实盘共享更接近的事件语义；
- 订单状态、持仓、撮合、手续费更可控；
- 多策略、多 symbol、更复杂订单类型更容易扩展。

代价：

- 全市场多 symbol、长周期回测会有事件重放开销；
- 如果每根 bar 每个 symbol 都进引擎，性能会受限；
- 需要在“外部向量化预计算”和“引擎内订单路径”之间做好边界。

较合理架构：

```text
全市场历史数据
  -> 外部向量化 feature / coarse filter
  -> 只把候选 symbol 和必要 bar 注入交易引擎
  -> 策略仍通过引擎订单路径下单
  -> 撮合、持仓、PnL 由引擎维护
```

这样既能减少无意义事件，又不绕过订单和账户语义。

## 面试高频问法

### Q1：一笔订单从发起到成交回报经过哪些模块？

策略生成订单意图后，先经过风控和资金检查；订单管理模块分配本地 client_order_id 并记录状态；执行适配器发送到交易所或回测撮合模块；收到 ack 后更新为 accepted 或 rejected；收到 fill 后更新订单累计成交、持仓、现金、手续费和 PnL；最后策略下一轮基于新账户状态继续决策。

### Q2：撮合逻辑如何测试？

分三层：订单状态机测试、撮合价格/数量测试、账户更新测试。状态机测试覆盖 accepted、partial fill、filled、cancel、reject、duplicate fill；撮合测试覆盖限价单、市价单、bar 内 high/low 触发、流动性不足；账户测试覆盖持仓均价、手续费、现金、PnL。

### Q3：行情数据乱序或丢失时如何处理？

每条行情要有 event_time、receive_time 和序列信息。对乱序数据可以设置 watermark 和缓冲窗口；对重复数据用 symbol+timestamp+seq 去重；对缺口要补拉历史或标记不可交易。策略只消费已确认收盘且时间对齐的数据。

### Q4：如何设计订单状态流转单元测试？

把状态机转移表显式写出来。每个测试输入一个当前状态和事件，断言新状态、累计成交量、剩余量、终态标记和是否更新持仓。非法转移必须拒绝或记录异常，不能静默吞掉。

### Q5：为什么回测收益和实盘差很多？

常见原因包括未来函数、bar 内成交路径假设过于乐观、手续费/滑点漏算、部分成交和拒单未模拟、历史 universe 有幸存者偏差、实盘延迟和限频、行情源不一致、仓位更新时机不一致。

## 最小实践任务

### 任务 1：订单状态机

实现一个 `Order` 类：

- 支持 `on_accepted()`；
- 支持 `on_rejected(reason)`；
- 支持 `on_fill(fill_id, qty, price, fee)`；
- 支持 `on_cancel_requested()`；
- 支持 `on_canceled()`；
- 重复 fill_id 不重复记账；
- 终态后拒绝非法状态转移。

### 任务 2：简化撮合器

输入：

```text
bar: open/high/low/close/volume
order: side/price/qty/type
```

输出：

```text
fill 或 no fill
```

要求：

- 限价买：`bar.low <= limit_price` 成交；
- 限价卖：`bar.high >= limit_price` 成交；
- 支持手续费；
- 支持滑点；
- 记录成交时间不能早于订单创建时间。

### 任务 3：回测时序检查

给定一组 1h K 线，检查：

- 特征是否只使用当前 bar close 之前的数据；
- 信号是否在 bar close 后产生；
- 订单是否在下一可交易时刻撮合；
- 是否存在同一根 bar 内既用 close 发信号又用 high/low 成交的路径问题。

## 项目讲法模板

> 我理解交易系统的核心不是策略函数本身，而是行情、订单、成交、持仓和风控之间的一致状态流。比如一笔订单会经过策略生成、风控检查、订单管理、执行适配器、撮合或交易所、成交回报、组合更新等阶段。回测时我会特别关注 bar close 时序、手续费滑点、订单状态机、重复回报幂等和回测实盘语义一致，避免因为未来函数或过于乐观的成交假设把策略收益高估。

## 资料入口

- FIX Trading Community Standards：https://fixtrading.org/standards/
- FIX Protocol Online Dictionary：https://www.onixs.biz/fix-dictionary.html
- NautilusTrader Docs：https://nautilustrader.io/docs/
- CCXT Docs：https://docs.ccxt.com/
- Binance Spot API Docs：https://developers.binance.com/docs/binance-spot-api-docs
- CME Market Data：https://www.cmegroup.com/market-data.html
