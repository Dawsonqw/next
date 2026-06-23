---
title: 扩展问答清单
description: 面试复习用扩展问题集合，按一问、追问、答题框架和常见误区组织。
---

# 扩展问答清单

更新时间：2026-06-23

## 使用方式

这页不是只背标准答案，而是用来训练“被连续追问时如何不慌”。每个问题都按下面结构复习：

```text
一问：面试官最可能直接问什么
答题框架：先讲什么，再讲什么
追问：面试官可能继续挖哪里
误区：哪些说法容易暴露不熟
项目落点：如何把答案落回自己的项目经历
```

复习时建议：

1. 先用 30 秒回答“一问”；
2. 再用 2 分钟回答“追问”；
3. 最后补一个项目例子；
4. 不确定的细节不要硬编，明确边界。

## C++ / Linux / 工程能力

### Q1：RAII 解决什么问题？

**答题框架：**

1. RAII 把资源生命周期绑定到对象生命周期；
2. 构造函数获取资源，析构函数释放资源；
3. 解决异常、提前 return、多分支退出时资源释放问题；
4. 资源不只是内存，还包括 fd、socket、mutex、thread、runtime handle；
5. 结合 `lock_guard`、`unique_ptr`、自定义 fd wrapper 举例。

**可能追问：**

- 析构函数为什么通常不应该抛异常？
- RAII 和 Java 的 finally 有什么区别？
- 如何用 RAII 包装一个 socket fd？
- 如果构造函数中途失败，已构造成员如何释放？
- RAII 是否能解决所有资源泄漏？

**常见误区：**

- 只说“自动释放内存”，范围太窄；
- 忘记异常安全；
- 用裸指针手动 delete 举例，反而显得没有掌握现代 C++；
- 不知道 copy/move 对资源所有权的影响。

**项目落点：**

> 模型部署或交易系统里会有文件、socket、线程、设备 handle、runtime session 等资源。我会倾向用 RAII 包装，避免异常路径和提前 return 导致泄漏。

### Q2：`unique_ptr`、`shared_ptr`、`weak_ptr` 怎么选？

**答题框架：**

| 指针 | 语义 | 典型场景 |
|---|---|---|
| `unique_ptr` | 独占所有权 | 默认优先，工厂返回对象，容器保存对象 |
| `shared_ptr` | 共享所有权 | 多个模块确实共同决定生命周期 |
| `weak_ptr` | 弱观察，不延长生命周期 | 打破环引用，缓存、观察者、回调 |
| raw pointer/reference | 借用，不拥有 | 参数传递、临时访问 |

**可能追问：**

- `shared_ptr` 的引用计数线程安全吗？对象本身线程安全吗？
- `shared_ptr` 循环引用怎么产生？
- `make_shared` 和 `shared_ptr<T>(new T)` 有什么区别？
- 为什么不要到处传 `shared_ptr`？
- 接口参数该传 `shared_ptr`、引用还是裸指针？

**要点：**

- `shared_ptr` 控制块的引用计数操作是线程安全的，但被管理对象不是自动线程安全；
- `weak_ptr` 需要 `lock()` 后判断是否拿到对象；
- 滥用 `shared_ptr` 会让所有权边界不清晰，造成对象生命周期过长。

### Q3：移动语义解决什么？

**答题框架：**

1. 复制是创建新资源，移动是转移资源所有权；
2. 对文件、socket、`unique_ptr` 这类不可复制资源，move 让它们可以放入容器、从函数返回；
3. `std::move` 本身不移动，只是转换成右值引用；
4. 被 move 的对象仍然有效，但状态未指定，只适合析构或重新赋值。

**可能追问：**

- 移动构造和移动赋值分别什么时候调用？
- 为什么 move constructor 通常标记 `noexcept`？
- vector 扩容时为什么 `noexcept` move 很重要？
- 自己写 RAII 类时为什么要遵守 rule of five？

**常见误区：**

- 说 `std::move` 会立刻搬数据；
- move 后继续使用旧对象里的资源；
- 自定义 RAII 类型只写析构，不处理 copy/move，导致 double free。

### Q4：`vector` 扩容会发生什么？

**答题框架：**

1. `vector` 底层是连续内存；
2. size 超过 capacity 时重新分配更大内存；
3. 旧元素 move/copy 到新内存；
4. 旧内存释放；
5. 原来的指针、引用、迭代器可能全部失效。

**可能追问：**

- `reserve` 和 `resize` 区别？
- vector 和 deque/list 的差异？
- 为什么 vector 通常比 list 快？
- 如何避免迭代器失效 bug？

**项目落点：**

> 如果 order book、行情缓存、任务队列保存对象索引，长期保存 vector 元素指针很危险。更稳的是保存 stable id、index 或使用节点稳定容器。

### Q5：mutex 和 atomic 怎么选？

**答题框架：**

- `mutex` 保护一组共享状态和不变量；
- `atomic` 适合简单计数、flag、单变量状态；
- 多变量一致性优先 mutex；
- lock-free 不等于一定更快，也更难证明正确性；
- 先写清晰正确，再用 profiling 判断是否需要优化。

**可能追问：**

- 什么是 data race？
- atomic 能否保护复合操作？
- `memory_order_relaxed` 能做什么、不能做什么？
- 如何减少锁竞争？
- 什么是 false sharing？

**常见误区：**

- 认为 atomic 就一定线程安全地保护整个对象；
- 多个 atomic 变量组合起来就认为有一致快照；
- 不知道条件变量必须配合锁和 predicate。

### Q6：condition_variable 为什么要用 while/predicate？

**答题框架：**

1. 条件变量可能虚假唤醒；
2. 即使被正常唤醒，条件也可能被其他线程先消费；
3. 所以醒来后必须重新检查条件；
4. 推荐用 `cv.wait(lock, predicate)`；
5. 停止线程时要设置 stop flag 并 notify。

**可能追问：**

- `notify_one` 和 `notify_all` 怎么选？
- notify 在锁内还是锁外？
- 线程池析构怎么安全退出？
- 生产者消费者队列如何避免丢任务？

### Q7：epoll、select、poll 区别？

**答题框架：**

| 机制 | 特点 | 局限 |
|---|---|---|
| select | fd_set，兼容性好 | fd 数量限制，每次拷贝和扫描 |
| poll | pollfd 数组，无固定 fd_set 限制 | 仍然线性扫描 |
| epoll | 内核维护 interest list/ready list | Linux 专有，ET 使用复杂 |

**可能追问：**

- epoll LT 和 ET 区别？
- ET 为什么必须非阻塞？
- 为什么要读到 `EAGAIN`？
- epoll 惊群是什么？
- Reactor 和 Proactor 区别？

**项目落点：**

> 对交易系统、推理服务、行情接入这类网络程序，epoll/Reactor 可以用少量线程管理大量连接，但业务 handler 不能长时间阻塞事件循环。

### Q8：线上 CPU 高怎么排查？

**答题框架：**

1. `top` 看进程，`top -H` 看线程；
2. `perf top` / `perf record -g` 看热点函数；
3. `gdb` 或 `pstack` 看线程栈；
4. 判断是业务计算、锁竞争、系统调用、日志、序列化还是死循环；
5. 最后再改代码并复测。

**可能追问：**

- CPU 高但 QPS 低可能是什么？
- 系统态 CPU 高和用户态 CPU 高区别？
- 如何定位锁竞争？
- perf 看不到符号怎么办？
- 容器里如何排查 CPU 限制？

### Q9：内存泄漏怎么排查？

**答题框架：**

- 先看 RSS、VSZ、heap、mmap、fd 数量；
- C++ 用 ASan、LSan、valgrind、heap profiler；
- 容器场景看 cgroup memory limit；
- 区分真正泄漏、缓存增长、内存碎片、mmap 未释放；
- 对 shared_ptr 环引用、全局 cache、线程局部变量保持警惕。

## 交易系统

### Q1：一笔订单从策略发出到成交回报经历什么？

**答题框架：**

```text
Strategy 生成订单意图
  -> Risk 检查资金、仓位、价格、交易权限
  -> OrderManager 分配 client_order_id，记录本地状态
  -> ExecutionAdapter 发给交易所或撮合器
  -> 收到 accepted/rejected
  -> 收到 partial/full fill 或 cancel report
  -> 更新 Order 状态
  -> Portfolio 更新持仓、现金、手续费、PnL
  -> Strategy 下一轮读取新状态
```

**可能追问：**

- client_order_id 和 exchange_order_id 区别？
- 发送超时后怎么办？
- 部分成交后撤单怎么处理？
- 成交回报重复到达怎么办？
- 本地状态和交易所状态不一致怎么办？

**误区：**

- 说“下单后马上成交”，忽略 accepted/rejected/partial/cancel；
- 不考虑网络超时和幂等；
- 直接让策略改持仓，绕过成交回报。

### Q2：订单状态机怎么设计？

**答题框架：**

- 明确状态：Created、Submitted、Accepted、PartiallyFilled、Filled、CancelPending、Canceled、Rejected、Expired；
- 明确终态：Filled/Canceled/Rejected/Expired；
- 状态转移表驱动，不允许非法转移静默成功；
- 成交量单调增加，remaining qty 单调减少；
- fill_id 去重；
- cancel pending 不代表不会再成交。

**可能追问：**

- Filled 后收到 CancelReport 怎么办？
- CancelPending 后收到 Fill 怎么办？
- Rejected 是否要更新持仓？
- duplicate fill 如何处理？
- 状态乱序如何处理？

### Q3：撮合价格优先、时间优先怎么实现？

**答题框架：**

- 买单簿按价格高优先，同价按时间早优先；
- 卖单簿按价格低优先，同价按时间早优先；
- 新买单和最低卖价比较，买价 >= 卖价可成交；
- 新卖单和最高买价比较，卖价 <= 买价可成交；
- 部分成交后剩余量继续撮合或入簿；
- 需要维护 price level 和 FIFO queue。

**可能追问：**

- 市价单如何处理？
- 订单部分成交后时间优先级如何变化？
- 撤单怎么从 order book 删除？
- 如何测试同价格时间优先？
- 撮合价取 maker 价还是 taker 价？

### Q4：行情乱序、重复、缺口怎么处理？

**答题框架：**

| 问题 | 处理 |
|---|---|
| 乱序 | event_time 排序、watermark、缓冲窗口 |
| 重复 | `(symbol, timestamp, seq)` 去重 |
| 缺口 | gap check、补拉历史、标记不可交易 |
| 延迟 | receive_time 和 event_time 分开记录 |
| 未收盘 bar | 只在 close 后产生信号 |

**可能追问：**

- WebSocket 断线后怎么恢复？
- 快照和增量如何对齐？
- order book 增量丢一条怎么办？
- 回测里如何避免未来函数？

### Q5：回测为什么容易高估收益？

**答题框架：**

1. 未来函数；
2. 使用未收盘 K 线；
3. 同一根 bar 内高低点路径未知；
4. 手续费/滑点/冲击成本漏算；
5. 忽略部分成交、拒单、限频；
6. 历史 universe 幸存者偏差；
7. 调参过拟合；
8. 回测和实盘仓位更新时间不一致。

**项目落点：**

> 如果做 1h K 线策略，10:00-11:00 的 K 线只能在 11:00 收盘后用于决策，订单也不能在这根 K 线内部用已经知道的 high/low 乐观成交。

### Q6：NautilusTrader 这类引擎为什么比手写回测慢？

**答题框架：**

- 它不只是算信号，而是在重放事件；
- 每个 bar/order/fill 都经过消息总线、策略、撮合、portfolio/cache；
- 好处是回测和实盘语义接近；
- 代价是全市场长周期事件量大；
- 优化方向是外部向量化预计算和预筛 symbol，但订单路径仍走引擎。

**可能追问：**

- 如何减少事件量？
- 什么逻辑可以放在引擎外？
- 什么逻辑不能绕过引擎？
- 预筛 symbol 会不会引入未来函数？

## 模型部署 / ONNX / Runtime

### Q1：ONNX 图结构由哪些部分组成？

**答题框架：**

- ModelProto：整体容器；
- GraphProto：计算图；
- NodeProto：算子节点；
- Initializer：权重/常量；
- Attribute：算子静态属性；
- ValueInfo：shape/type 元信息；
- Opset：算子语义版本。

**可能追问：**

- initializer 和 input 有什么关系？
- opset 为什么重要？
- shape inference 能解决什么，不能解决什么？
- ONNX 是 runtime 吗？
- 同一个 ONNX 为什么不同 backend 性能不同？

### Q2：Caffe 到 ONNX 转换最容易错在哪里？

**答题框架：**

- 算子语义差异，不是简单改名字；
- Conv 的 padding/group/dilation/weight layout；
- BN/Scale 的推理态参数和 epsilon；
- Pooling 的 ceil_mode 和 padding；
- InnerProduct 的 flatten 和 transpose；
- Softmax/Concat/Reshape 的 axis；
- NCHW/NHWC layout；
- 前后处理不一致。

**可能追问：**

- 如何验证 50 个算子都正确？
- 单算子、子图、整模型测试怎么设计？
- 逐层 dump 怎么做？
- 如果目标 runtime 不支持某算子怎么办？

### Q3：模型转换后输出不一致怎么排查？

**答题框架：**

```text
先排除输入前处理
  -> 检查模型结构和权重
  -> 检查 opset 和算子属性
  -> 检查 layout/shape/dtype
  -> 检查后处理
  -> 逐层 dump 找首次误差放大层
  -> 针对该层查属性、量化、backend kernel
```

**可能追问：**

- 为什么先看第一层输出？
- cosine 高但 max diff 大说明什么？
- 分类 top-1 一致是否足够？
- 检测模型后处理为什么容易造成误判？

### Q4：动态 shape 为什么影响部署？

**答题框架：**

- runtime/编译器需要做内存规划、kernel 选择、图优化；
- 动态 batch、动态 H/W、动态 seq_len 会影响 shape inference；
- 某些 NPU 要求静态 shape 或有限 profile；
- TensorRT 这类系统需要 min/opt/max profile；
- shape 太宽会导致 engine 性能差或内存大。

**可能追问：**

- 动态 batch 和动态图像尺寸哪个更麻烦？
- 如何处理业务里的多分辨率输入？
- 为什么 reshape 依赖运行时数据会难部署？

### Q5：算子不支持怎么办？

**答题框架：**

| 方法 | 适用 | 代价 |
|---|---|---|
| 等价改写 | op 可分解为支持算子 | 需证明语义等价 |
| 自定义 plugin/kernel | 性能关键且平台支持扩展 | 开发和维护成本高 |
| CPU fallback | 非热路径、低频 op | 数据搬运可能拖慢端到端 |
| 换 opset/导出方式 | 语义兼容时 | 可能影响其他 op |
| 模型结构调整 | 可重新训练或微调 | 成本高 |

## MLIR / 图优化

### Q1：MLIR 和 LLVM IR 区别？

**答题框架：**

- LLVM IR 更偏底层编译后端；
- MLIR 支持多层级 IR 和多 Dialect；
- 适合表达从高层模型算子到低层硬件约束的逐步 lowering；
- Dialect 可以定义 op/type/attr；
- Pass/Pattern 支持分析和改写。

**可能追问：**

- Dialect 是什么？
- Operation 包含哪些部分？
- Region/Block 用来表达什么？
- 为什么模型部署适合 MLIR？

### Q2：Conversion Pattern 和 Rewrite Pattern 区别？

**答题框架：**

- Rewrite Pattern：通用局部匹配和改写；
- Conversion Pattern：用于 Dialect Conversion，配合 ConversionTarget/TypeConverter；
- Conversion 关注把非法 op 转成合法 op；
- Rewrite 更广，可以做融合、消除、替换。

**可能追问：**

- 什么是 legality？
- partial conversion 和 full conversion 区别？
- TypeConverter 做什么？
- Pass 和 Pattern 区别？

### Q3：图优化如何保证语义等价？

**答题框架：**

1. 规则前置条件严格；
2. shape/type 检查；
3. 数学等价推导；
4. 单元测试和随机测试；
5. 逐层输出误差对齐；
6. pass 可开关、可回滚；
7. 业务模型回归测试。

**常见追问：**

- Conv+BN 融合公式？
- 哪些情况下不能融合？
- 融合为什么提升性能？
- 如果融合后精度有微小差异怎么办？

## 量化 / 精度分析

### Q1：量化为什么会掉精度？

**答题框架：**

- 连续浮点映射到离散整数，产生舍入误差；
- 超出范围会 clip/saturate；
- outlier 会拉大量化范围，正常值分辨率下降；
- per-tensor 粒度过粗；
- 激活分布和 calibration 不匹配；
- backend kernel 数值实现差异。

**可能追问：**

- scale 和 zero_point 怎么计算？
- 对称和非对称量化区别？
- per-channel 为什么比 per-tensor 精度好？
- INT8 一定比 FP16 快吗？

### Q2：PTQ、QAT、Dynamic Quantization 区别？

**答题框架：**

| 方法 | 量化参数来源 | 是否训练 | 特点 |
|---|---|---|---|
| Dynamic | 推理时动态算激活范围 | 否 | 简单，但有运行时代价 |
| Static PTQ | calibration 离线估计 | 否 | 部署稳定，依赖数据代表性 |
| QAT | 训练中模拟量化 | 是 | 精度更好，成本更高 |
| Weight-only | 主要量化权重 | 通常否 | LLM 常见，依赖 matmul kernel |

**追问：**

- calibration 数据怎么选？
- KL/MinMax/Percentile/MSE 怎么理解？
- 为什么 LLM 常用 weight-only？
- KV Cache 量化会影响什么？

### Q3：如何逐层定位量化异常层？

**答题框架：**

```text
FP32 baseline 输出
  -> 量化模型输出
  -> 同一输入同一前后处理
  -> dump 每层 tensor
  -> 按拓扑/名称对齐
  -> 计算 cosine、MSE、MAE、max diff
  -> 找首次明显放大层
  -> 分析该层输入分布、scale、op、kernel
```

**追问：**

- 如果层名对不上怎么办？
- cosine 很高但精度掉点怎么办？
- 为什么最终输出不一致不一定是最后一层问题？
- 如何做敏感层回退？

### Q4：GPTQ、AWQ、SmoothQuant 分别解决什么？

**答题框架：**

- GPTQ：近似二阶信息，做 one-shot weight quantization，强调误差补偿；
- AWQ：根据激活识别 salient weights，保护重要通道，强调硬件友好；
- SmoothQuant：把 activation outlier 迁移/平滑到 weight，实现 W8A8；
- 三者都不是万能，依赖模型、硬件 kernel、任务和量化 bit。

## 大模型推理

### Q1：Prefill 和 Decode 区别？

**答题框架：**

- Prefill 处理完整 prompt，可并行，计算密集；
- Decode 一次生成一个 token，强自回归，常受 KV Cache 访存影响；
- TTFT 主要受 prefill 影响；
- TPOT/吞吐主要受 decode 调度和 KV Cache 影响。

**追问：**

- KV Cache 存的是什么？
- 长上下文为什么占显存？
- batch size 增加对 prefill/decode 影响不同吗？
- PagedAttention 解决什么问题？

### Q2：投机采样为什么能加速？

**答题框架：**

- draft model 先生成多个候选 token；
- target model 批量验证；
- 如果接受多个 token，就减少 target 逐 token 调用轮数；
- 正确实现通过拒绝采样修正保持 target 分布；
- 收益取决于 draft 延迟、接受率、验证效率、KV Cache 复用、算子支持。

**追问：**

- acceptance rate 低会怎样？
- draft model 越小越好吗？
- 拒绝后如何采样？
- 为什么平台算子不支持会抵消收益？

## Agent / RAG / Memory

### Q1：为什么情感陪伴机器人需要 Memory？

**答题框架：**

- 情感陪伴重视连续性和个性化；
- 用户偏好、长期事实、近期事件、情绪状态、关系边界需要跨轮次保留；
- 只靠上下文窗口成本高且会丢历史；
- Memory 需要写入、更新、召回、注入和删除机制；
- 不等同于文档 RAG。

**追问：**

- 哪些信息不该写？
- 如何避免错误记忆？
- 用户纠正后怎么办？
- 如何评估 memory 是否有效？

### Q2：RAG 和 Memory 区别？

**答题框架：**

| 维度 | RAG | Memory |
|---|---|---|
| 数据 | 外部文档/知识库 | 用户对话和状态 |
| 目标 | 回答知识问题 | 保持个性化和连续性 |
| 风险 | 检索错文档 | 记忆污染、隐私、过期状态 |
| 评估 | Recall@K、groundedness | 写入准确率、召回相关性、冲突率 |

### Q3：记忆召回只用向量 TopK 有什么问题？

**答题框架：**

- 语义相似不等于当前有用；
- 可能召回过期情绪；
- 可能召回低置信推断；
- 可能忽略 memory type；
- 可能引入敏感信息；
- 必须结合 metadata filter、importance、recency、confidence、type、sensitivity。

### Q4：如何避免记忆污染？

**答题框架：**

- 写入前做重要性、置信度、敏感性判断；
- 用户明确表达优先于模型推断；
- 情绪类设置过期；
- 冲突记忆版本化；
- 用户可删除/纠正；
- prompt 注入只放少量高置信记忆。

## OpenGL 2D 渲染

### Q1：OpenGL 渲染一个 2D 图元基本流程？

**答题框架：**

```text
创建窗口和 OpenGL context
  -> 编译 shader
  -> 创建 VBO/VAO/EBO
  -> 上传顶点坐标/纹理坐标
  -> 加载 texture
  -> 设置 transform / projection
  -> draw call
  -> swap buffers
```

**追问：**

- VBO、VAO、EBO 分别是什么？
- 顶点坐标和纹理坐标区别？
- 为什么纹理坐标和屏幕坐标方向可能不一致？
- alpha blending 怎么设置？
- 2D batching 为什么能减少 draw call？

### Q2：shader 做什么？

**答题框架：**

- vertex shader 处理顶点位置和属性；
- fragment shader 计算像素颜色；
- uniform 传全局参数；
- attribute 传每个顶点属性；
- texture sampler 采样图片。

## 行为边界与表达

### Q1：如果被问到你没有深入负责的内容怎么办？

**答题框架：**

1. 先明确自己负责的边界；
2. 再讲自己理解的链路；
3. 区分“参与实现”“调研验证”“阅读理解”“独立负责”；
4. 不把团队成果包装成个人核心贡献；
5. 可以补充如果继续做会如何深入。

**推荐表达：**

> 这部分我不是完整负责人，我实际参与的是其中的工程实现和验证环节。整体架构我理解为……我负责的具体部分是……当时遇到的问题是……我是这样排查和验证的。

### Q2：如何把项目讲得可信？

**答题框架：**

- 背景：为什么做；
- 目标：优化什么指标；
- 方案：技术路线；
- 实现：你写了什么模块；
- 验证：怎么证明正确；
- 问题：遇到什么坑；
- 边界：哪些没做、哪些是团队工作；
- 复盘：如果重做会怎么改。

## 总复习顺序

建议按下面顺序复习：

```text
C++ RAII / 智能指针 / 多线程 / epoll
  -> 交易系统订单状态机 / 撮合 / 回测一致性
  -> ONNX / Caffe 转换 / 逐层 dump
  -> MLIR Dialect / Pattern / Pass / 图优化等价性
  -> 量化公式 / PTQ / QAT / 异常层定位
  -> LLM Prefill/Decode / KV Cache / 投机采样
  -> Agent Memory 写入/召回/评估/隐私
  -> OpenGL 2D 渲染管线
```
