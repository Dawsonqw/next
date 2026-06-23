---
title: 高级工程师视角：交易系统
description: 基于 FIX、交易所 API 和事件驱动框架理念整理的高级交易系统工程笔记。
---

# 高级工程师视角：交易系统

更新时间：2026-06-23

## 0. 官方资料锚点

| 资料 | 关键结论 | 工程含义 |
|---|---|---|
| FIX Trading Community Standards | FIX 是开放、技术中立的电子交易和交易处理规范，覆盖 pre-trade、execution、clearing、settlement、reporting 等完整生命周期 | 交易系统不是单个下单接口，而是完整交易生命周期状态机 |
| Binance Spot Trading API | 新订单需要 symbol、side、type 等字段；`newClientOrderId` 在 open orders 中唯一，重复使用会被拒；订单响应可为 ACK/RESULT/FULL | 实盘下单必须有幂等键、状态查询和不同响应粒度处理 |
| Binance WebSocket Streams | 行情、深度和用户数据以事件流形式到达 | 实盘系统必须面对异步事件、延迟、乱序、断线恢复 |
| NautilusTrader 文档 | 交易系统可建模为事件驱动的数据、策略、执行、账户与组合更新流程 | 回测与实盘一致性应靠统一事件语义，而不是只靠向量化收益计算 |

## 1. 高级工程师如何理解交易系统

初级理解：策略看到行情后调用 API 下单。

高级理解：交易系统是一个**分布式、异步、状态一致性系统**。策略只是状态机中的一个输入源，不是交易系统本身。

真正要控制的是：

```text
市场数据是否可信
策略是否只看到当时可用信息
订单意图是否通过风控
订单请求是否幂等
交易所是否接受
成交回报是否重复或乱序
持仓资金是否只由 fill 驱动
本地状态和交易所状态是否 reconcile
回测和实盘语义是否一致
```

高级面试里，如果只说“买入信号就下单”，会暴露没有交易系统意识。

## 2. 市场数据：不是价格数组，而是事件流

### 2.1 行情类型的工程含义

| 类型 | 数据语义 | 工程风险 |
|---|---|---|
| trade/tick | 已发生成交 | 不代表当前可成交价格 |
| quote/bbo | best bid/ask | 只给最优价，不给深度 |
| depth/order book | 多档挂单 | 快照/增量一致性难 |
| kline/bar | 时间窗口聚合 | close 前不可用；bar 内路径未知 |
| user data stream | 账户订单成交事件 | 断线会导致本地状态漂移 |

高级工程师要把行情当成事件流处理，而不是当成完美 dataframe。

### 2.2 event_time / receive_time / process_time

| 时间 | 含义 | 用途 |
|---|---|---|
| event_time | 交易所事件发生时间 | 回测语义、K 线对齐 |
| receive_time | 本地收到时间 | 实盘延迟监控 |
| process_time | 系统处理完成时间 | 内部 pipeline 性能 |
| decision_time | 策略决策时间 | 避免未来函数 |
| order_send_time | 订单发出时间 | 延迟和成交可解释性 |

如果只保存一个 timestamp，后续很难判断：收益来自策略，还是来自错误的时间语义。

### 2.3 深度快照和增量

真实 order book 不是“每次推完整盘口”。常见模式：

```text
REST snapshot
  -> WebSocket diff stream
  -> 根据 sequence/update id 应用增量
  -> 检测 gap
  -> gap 后重建 snapshot
```

工程原则：一旦发现增量断裂，order book 状态不可继续信任。继续用错误盘口做撮合或信号，会导致实盘风险。

## 3. 订单不是函数返回值，而是异步状态机

### 3.1 为什么订单必须建模成状态机

交易所响应、网络、撮合、用户数据流都是异步的：

```text
send order request
  -> HTTP ACK 可能先到
  -> execution report 可能后到
  -> partial fill 可能多次到
  -> cancel request 和 fill 可能交错
  -> duplicate event 可能重复到达
```

所以订单对象必须维护不变量，而不是仅仅保存一个 status 字符串。

### 3.2 核心不变量

```text
orig_qty >= 0
cum_qty >= 0
leaves_qty >= 0
cum_qty + leaves_qty = orig_qty
cum_qty 单调增加
终态不可回到活动态
同一 exec_id 不可重复应用
订单状态变更必须可审计
```

高级工程师面试时要主动讲“不变量”。这比枚举状态名更能体现工程能力。

### 3.3 状态转移

```text
Created
  -> Submitted
  -> Accepted / Rejected
  -> PartiallyFilled
  -> Filled

Accepted / PartiallyFilled
  -> CancelPending
  -> Canceled

Accepted / PartiallyFilled
  -> Expired
```

注意：`Canceled` 不代表 `cum_qty == 0`。它只表示剩余未成交数量被取消。

## 4. 幂等：实盘交易的生死线

### 4.1 请求超时的三种可能

下单 timeout 并不等于失败：

```text
请求没到交易所
请求到达但未处理
订单已创建但响应丢失
```

如果此时直接生成新 order 再发一次，可能重复开仓。

### 4.2 client_order_id 的工程价值

交易所 API 中 `clientOrderId/newClientOrderId` 通常用于客户端幂等和订单关联。高级系统必须本地生成：

```text
strategy_id + symbol + decision_time + sequence
```

超时后流程：

```text
send order with client_order_id
if timeout:
    query by client_order_id
    if exists:
        adopt remote state
    elif definitely_not_exists:
        retry same intent if still valid
    else:
        enter unknown state and reconcile
```

### 4.3 unknown state

高级系统要显式建模 `Unknown` 或 `PendingReconcile`，而不是把 timeout 简化成 rejected。

```text
Submitted -> Unknown
Unknown -> Accepted / Rejected / Filled / Canceled after reconcile
```

## 5. 成交回报：只应用一次，且必须可追溯

### 5.1 Fill 是资金和持仓的唯一来源

策略发出 order intent 不改变持仓；交易所 accepted 也不改变持仓；只有 fill 改变持仓。

```text
order accepted: open order 增加
fill received: position/cash/fee/PnL 更新
```

### 5.2 exec_id 去重

每个 fill 需要唯一执行 ID 或 trade ID。

```text
if exec_id already_processed:
    ignore
else:
    apply fill
    persist exec_id
```

注意：去重必须先于 portfolio 更新，并且最好是事务式的：写入 fill、更新订单、更新持仓要么都成功，要么可恢复。

### 5.3 成交回报乱序

可能先收到 fill，再收到 accepted。处理思路：

- 不要依赖事件到达顺序等于交易所发生顺序；
- 用 exchange event time、order id、exec id 关联；
- 对缺失前置状态做补状态或 reconcile；
- 事件处理要幂等。

## 6. 风控：策略和交易所之间的防火墙

策略输出的是意图，不是命令。

```text
signal -> order intent -> pre-trade risk -> order command
```

### 6.1 pre-trade risk

| 检查 | 为什么高级系统必须做 |
|---|---|
| symbol status | 避免下架/维护/禁用标的 |
| price tick | 避免交易所拒单 |
| lot size | 避免数量非法 |
| min notional | 避免小额拒单 |
| max order notional | 防止异常信号打大单 |
| max position | 控制单标的风险 |
| exposure | 控制组合风险 |
| rate limit | 防止 API ban |
| duplicate intent | 防止重复下单 |
| kill switch | 快速停止策略 |

### 6.2 风控也要进入回测

如果回测不模拟 tick size、lot size、min notional、手续费、滑点、部分成交，那么实盘会出现大量回测没有的拒单和成交偏差。

## 7. 撮合与订单簿：为什么 OHLC 回测天然不完整

### 7.1 连续竞价撮合

核心规则：

```text
买单：价格高优先，同价格时间早优先
卖单：价格低优先，同价格时间早优先
成交条件：best_bid >= best_ask
```

数据结构：

```text
bid levels: price desc -> FIFO queue
ask levels: price asc  -> FIFO queue
order_index: order_id -> location
```

### 7.2 市价单不是按最新价成交

市价买单吃 ask，可能吃多档：

```text
ask1 qty 不够 -> ask2 -> ask3
```

这会产生滑点。回测只用 close/last price 成交，会低估交易成本。

### 7.3 OHLC 的不可观测路径问题

一根 bar 包含 open/high/low/close，但没有内部顺序。

如果一根 bar 内同时满足：

```text
high >= take_profit
low <= stop_loss
```

你无法仅凭 OHLC 知道先止盈还是先止损。

高级回测必须选择：

- 使用更细粒度数据；
- 保守假设；
- 下一根 bar 成交；
- 限制策略避免同 bar 路径依赖；
- 明确记录撮合假设。

## 8. 回测与实盘一致性

### 8.1 回测不是收益计算器

回测应该是实盘事件流的可控模拟：

```text
market data event
  -> strategy decision
  -> order command
  -> simulated exchange/matching
  -> execution report
  -> portfolio update
```

如果直接用 dataframe 计算持仓收益，很容易绕过订单和成交语义。

### 8.2 未来函数的高级来源

| 来源 | 为什么隐蔽 |
|---|---|
| bar close 未 shift | Pandas 计算自然包含当前 close |
| 全样本标准化 | 训练/测试时间边界被打穿 |
| universe selection | 用未来活跃/未下架 symbol 筛过去 |
| 参数选择 | 在测试集反复调参 |
| 特征预计算 | 全局 rolling/expanding 写错边界 |
| 同 bar 成交 | 信号和成交使用同一根 bar 的 high/low |

### 8.3 全市场 1h 策略的正确切分

你的场景里更合理的 pipeline：

```text
bar close T
  -> 使用 <= T 的数据计算全市场特征
  -> 只基于 <= T 的特征筛选候选 symbol
  -> T 之后策略才产生 order intent
  -> 成交发生在 T 之后的可交易事件
  -> portfolio 由 fill 更新
```

预筛 symbol 可以放在引擎外，但不能用未来收益、未来成交量、未来下架信息。

## 9. 实盘恢复与 reconcile

### 9.1 必须持久化什么

| 数据 | 作用 |
|---|---|
| client_order_id | 幂等和查询 |
| exchange_order_id | 远端订单关联 |
| order state | 重启恢复 |
| processed exec_id | fill 去重 |
| fills | 审计和 portfolio rebuild |
| positions | 快速恢复，但需和 fills/交易所对账 |
| balances | 资金对账 |
| strategy state | 防止重复决策 |

### 9.2 重启恢复流程

```text
load local orders/fills
query exchange open orders
query recent trades
rebuild order states
rebuild portfolio from fills
compare balances/positions
mark unresolved orders as PendingReconcile
strategy resumes only after state is consistent
```

### 9.3 定期 reconcile

实盘系统应定期核对：

- open orders；
- recent fills；
- balances；
- positions；
- local pending orders；
- websocket sequence health。

## 10. 事件驱动框架的价值与代价

### 10.1 价值

事件驱动框架把回测和实盘统一成事件处理：

```text
DataEvent
OrderEvent
FillEvent
PortfolioUpdate
```

好处：

- 订单状态机统一；
- portfolio 更新路径统一；
- 手续费滑点可插拔；
- 多策略多 symbol 更清晰；
- 更接近实盘。

### 10.2 代价

- 事件量大；
- 全市场长周期回测慢；
- 框架抽象有学习成本；
- 不适合把所有矩阵计算都塞进事件循环。

### 10.3 高级优化边界

```text
可以外置：全市场向量化特征、候选 symbol 粗筛、数据预清洗
不应绕过：订单生成、撮合、fill、portfolio、PnL、风险检查
```

## 11. 高级面试追问

1. 为什么下单 timeout 不能直接重试？
2. client_order_id 怎么设计才能幂等？
3. cancel ack 到达前收到 fill 怎么处理？
4. duplicate fill 怎么保证不重复更新持仓？
5. order book 快照增量断裂怎么办？
6. last price、mid price、bid/ask 分别适合什么？
7. OHLC 回测为什么无法确定止盈止损先后？
8. 预筛 symbol 如何避免未来函数？
9. 事件驱动回测为什么比向量化慢但更可信？
10. 实盘重启后如何恢复订单和持仓？
11. 交易系统如何设计 kill switch？
12. 如何证明回测和实盘时序一致？

## 12. 工程实践任务

1. 实现 Order 状态机和不变量检查。
2. 实现 client_order_id 幂等查询流程。
3. 实现 exec_id 去重并保证 portfolio 只更新一次。
4. 实现 price-time priority order book。
5. 实现 bar-based conservative matcher。
6. 构造同 bar 触发止盈止损的反例。
7. 构造 websocket gap 后重建 snapshot 流程。
8. 实现重启后的 open orders / fills reconcile。
9. 给所有事件加 event_time、receive_time、process_time。
10. 写一个报告对比 vectorized PnL 和 event-driven PnL 差异。

## 13. 资料入口

- FIX Standards：https://fixtrading.org/standards/
- Binance Spot Trading Endpoints：https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints
- Binance WebSocket Streams：https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
- NautilusTrader Docs：https://nautilustrader.io/docs/latest/
