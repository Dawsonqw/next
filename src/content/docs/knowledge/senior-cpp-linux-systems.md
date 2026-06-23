---
title: 高级工程师视角：C++ / Linux 系统工程
description: 基于 C++ Core Guidelines、Linux man-pages、CMake 官方文档整理的高级工程师级系统工程笔记。
---

# 高级工程师视角：C++ / Linux 系统工程

更新时间：2026-06-23

## 0. 官方资料锚点

这篇笔记基于以下资料组织，而不是只按经验罗列：

| 资料 | 关键结论 | 工程含义 |
|---|---|---|
| C++ Core Guidelines | 指南目标包括资源管理、内存管理、并发等高层问题；目标是类型安全、资源安全、无资源泄漏，并支持渐进式引入 | 面试时不要把 C++ 只讲成语法，要讲“资源安全 + 接口边界 + 可维护性” |
| C++ Core Guidelines Resource Management | 不泄漏资源、使用 RAII、避免裸 `new/delete` 是现代 C++ 核心方向 | 资源生命周期要由类型系统和对象生命周期表达 |
| Linux `epoll(7)` | epoll 维护 interest list 和 ready list；ET 模式建议非阻塞 fd，并在 `read/write` 返回 `EAGAIN` 后再等待下一次事件 | 能解释为什么 ET 写错会卡死，而不是只背 LT/ET 区别 |
| CMake `target_link_libraries` | `PUBLIC/PRIVATE/INTERFACE` 同时决定链接依赖和 link interface；依赖默认可传递 | 会现代 CMake 不是会写命令，而是会建模 usage requirements |

## 1. 高级工程师如何理解 C++

初级回答：C++ 有指针、类、模板、多线程。

高级回答：C++ 是一门允许你把**资源生命周期、所有权、错误边界、性能成本**显式建模的语言。

在工程里，C++ 最大价值不是“语法复杂”，而是你可以把这些东西固化在类型系统和对象模型里：

```text
谁拥有资源？
什么时候释放？
异常路径是否安全？
是否允许复制？
是否允许移动？
是否跨线程共享？
是否有明确的不变量？
接口是否暴露了生命周期风险？
```

这也是为什么高级 C++ 面试不是只问 `unique_ptr` 和 `shared_ptr`，而是追问：

- 你为什么选择这个所有权模型？
- 这个对象移动后还能不能被使用？
- 析构失败怎么办？
- shared_ptr 是否掩盖了所有权边界？
- 异常路径是否会泄漏 fd/socket/device handle？
- 多线程下对象本身是否安全？

## 2. RAII：不是技巧，是资源安全架构

### 2.1 本质

RAII 的本质是把“资源有效性”变成类不变量：对象构造成功，资源就可用；对象析构，资源就释放。

这比手动 `open/close` 更可靠，因为资源释放不再散落在每个调用点，而是集中在类型定义里。

```cpp
class UniqueFd {
public:
    explicit UniqueFd(int fd = -1) noexcept : fd_(fd) {}
    ~UniqueFd() noexcept { if (fd_ >= 0) ::close(fd_); }

    UniqueFd(const UniqueFd&) = delete;
    UniqueFd& operator=(const UniqueFd&) = delete;

    UniqueFd(UniqueFd&& other) noexcept : fd_(std::exchange(other.fd_, -1)) {}
    UniqueFd& operator=(UniqueFd&& other) noexcept {
        if (this != &other) {
            reset(std::exchange(other.fd_, -1));
        }
        return *this;
    }

    int get() const noexcept { return fd_; }
    int release() noexcept { return std::exchange(fd_, -1); }

    void reset(int new_fd = -1) noexcept {
        if (fd_ >= 0) ::close(fd_);
        fd_ = new_fd;
    }

private:
    int fd_;
};
```

### 2.2 高级追问：析构函数为什么不应抛异常？

因为析构经常发生在栈展开期间。如果析构再抛异常，程序可能 `std::terminate`。工程上常用策略：

| 场景 | 处理 |
|---|---|
| close 失败 | 析构中吞掉并记录底层错误；需要显式处理时提供 `close()` |
| transaction rollback 失败 | 析构只做 best-effort；业务层用显式 commit/rollback 接口处理失败 |
| device/session destroy 失败 | 析构不破坏控制流，记录错误并暴露健康状态 |

### 2.3 高级追问：RAII 和异常安全的关系

RAII 是异常安全的基础，但异常安全还分层：

| 级别 | 含义 | 示例 |
|---|---|---|
| no guarantee | 异常后状态不可预期 | 手写裸资源管理 |
| basic guarantee | 不泄漏，状态仍有效但可能变化 | 大多数容器操作 |
| strong guarantee | 要么成功，要么像没发生 | copy-and-swap |
| no-throw guarantee | 承诺不抛异常 | 析构、move、swap 常见目标 |

高级回答要能说：RAII 主要保证资源释放，但不自动保证业务状态回滚。业务状态需要事务式设计。

## 3. 所有权模型：接口设计比智能指针 API 更重要

### 3.1 选择智能指针的原则

| 设计意图 | 推荐表达 |
|---|---|
| 当前对象独占资源 | 值成员或 `std::unique_ptr` |
| 工厂创建并转交调用方 | 返回 `std::unique_ptr<T>` |
| 函数只读不拥有 | `const T&` |
| 函数可空借用 | `T*` |
| 多模块共同延长生命周期 | `std::shared_ptr<T>` |
| 回调/观察者不想延长生命周期 | `std::weak_ptr<T>` |

高级工程师不会到处传 `shared_ptr`，因为这会把“谁负责生命周期”变成全系统隐式约定。

### 3.2 shared_ptr 的线程安全边界

结论必须准确：

```text
shared_ptr 控制块引用计数操作是线程安全的。
shared_ptr 指向的对象本身不是自动线程安全。
同一个 shared_ptr 实例被多线程同时读写也需要同步。
```

因此：

```cpp
std::shared_ptr<OrderBook> book;
```

只能说明 `OrderBook` 生命周期被共享，不说明 order book 内部读写线程安全。

### 3.3 高级追问：shared_ptr 循环引用为什么是设计问题

循环引用不是“忘了 weak_ptr”这么简单，而是对象图所有权设计错误。

如果 `Parent` 拥有 `Child`，`Child` 反向引用 `Parent`，反向引用通常应该是：

- raw pointer/reference：如果 parent 生命周期严格长于 child；
- weak_ptr：如果 parent 生命周期可能独立结束；
- ID：如果跨线程/跨进程/持久化引用。

## 4. 并发：保护不变量，而不是保护变量

### 4.1 data race 与业务 race

| 概念 | 定义 | 例子 |
|---|---|---|
| data race | C++ 层面未同步并发读写同一内存，至少一个写 | 两线程同时写 `int x` |
| race condition | 业务结果依赖执行时序 | 先撤单还是先成交导致状态差异 |

无 data race 不代表业务正确。交易系统里即使用锁保护 map，也可能因为事件顺序处理错而导致订单状态错误。

### 4.2 mutex 保护的是不变量

线程安全队列的不变量：

```text
queue 内容
stopped 标志
condition_variable 的唤醒条件
```

必须在同一把锁下维护。

错误设计：

```cpp
std::atomic<bool> stopped;
std::mutex m;
std::queue<Task> q;
```

如果 `stopped` 和 `q` 分别用不同同步方式管理，consumer 可能看到不一致状态。高级工程师会先问“不变量是什么”，再决定锁粒度。

### 4.3 condition_variable 的真实语义

`notify_one` 不等于投递消息，condition_variable 不保存通知次数。它只是告诉等待线程“条件可能变了”。

正确模式：

```cpp
cv.wait(lock, [&] { return stopped || !q.empty(); });
```

高级追问：如果 `notify` 先于 `wait` 发生怎么办？

回答：没有问题，因为等待的依据不是通知本身，而是 predicate 所描述的共享状态。只要共享状态已经改变，后续 wait 会直接通过。

### 4.4 atomic 的使用边界

atomic 适合单变量状态：

- stop flag；
- request counter；
- metrics；
- once flag；
- lock-free ring buffer 中的 head/tail。

不适合直接保护复合不变量：

```text
balance + position + pending_orders
queue + stopped
order_status + cumulative_qty + remaining_qty
```

这些需要 mutex、actor/event-loop、单线程状态机或事务式更新。

## 5. Linux IO：fd、open file description、epoll

### 5.1 fd 不是资源本身

fd 是进程 fd table 里的整数句柄。内核里还有 open file description。一个 open file description 可能被多个 fd 引用，例如 `dup()` 或 fork 之后。

这会影响 epoll：关闭一个 fd 不一定立刻从所有 interest list 中彻底消失，因为其他 duplicate fd 可能仍引用同一个 open file description。

高级工程师要知道：在复杂系统中，close 前显式 `EPOLL_CTL_DEL` 常常比“反正 close 会清理”更稳。

### 5.2 epoll 的 interest list / ready list

Linux man-pages 对 epoll 的定义非常关键：

```text
interest list：进程注册关心的 fd 集合
ready list：已经 ready 的 fd 集合
```

这说明 epoll 不是每次线性扫描所有 fd，而是由内核维护就绪集合。

### 5.3 ET 模式为什么必须读到 EAGAIN

ET 只在状态变化时通知。如果你只读一部分数据，缓冲区里还有数据，但状态没有新的变化，下一次 `epoll_wait` 可能不会再返回这个 fd。

正确原则：

```text
EPOLLET + nonblocking fd + read/write until EAGAIN
```

这不是性能建议，而是正确性要求。

### 5.4 EPOLLONESHOT 的工程价值

多线程处理同一个 epoll fd 时，可能多个 worker 同时处理同一连接。`EPOLLONESHOT` 让 fd 触发一次后暂时禁用，需要处理完成后 rearm。

适用：

- 多 worker 共享 epoll；
- 每个连接状态不能并发修改；
- handler 可能被投递到线程池。

## 6. Reactor 不是“用了 epoll”

Reactor 是一种事件分发架构：

```text
event demultiplexer: epoll_wait
  -> dispatcher
  -> handler
  -> update interest events
```

高级设计问题：handler 能做什么？

| 行为 | 是否适合在 event loop 里做 | 原因 |
|---|---|---|
| 非阻塞 read/write | 适合 | 推进 IO 状态机 |
| 解析少量协议头 | 适合 | CPU 很短 |
| 大 JSON 解析 | 谨慎 | 可能阻塞 loop |
| 同步数据库查询 | 不适合 | 阻塞所有连接 |
| 模型推理 | 不适合 | CPU/GPU 重任务 |
| 同步大量日志 | 不适合 | IO 抖动大 |

高级回答：event loop 应该只推进状态机，重任务丢 worker，结果回投事件循环。

## 7. 性能排查：高级工程师重证据链

### 7.1 CPU 高

证据链：

```text
top -H 定位线程
perf top/record/report 定位热点函数
gdb/pstack 看线程栈
火焰图看调用路径
结合业务指标判断是否正常负载
```

不要直接说“优化算法”。先分类：

| 热点 | 可能结论 |
|---|---|
| 业务函数 | 算法复杂度、数据规模、热路径 |
| mutex | 锁竞争或临界区太大 |
| memcpy | 过多拷贝、序列化、layout transform |
| write/fsync | 日志或磁盘瓶颈 |
| epoll_wait | 可能不是 CPU 高源头，系统在等 IO |
| malloc/free | 分配频繁或内存碎片 |

### 7.2 内存增长

高级排查不是只说 valgrind：

```text
RSS 是否涨？
heap 是否涨？
mmap 是否涨？
线程数是否涨？
fd 是否涨？
队列长度是否涨？
cache 是否有上限？
```

常见“不是泄漏但像泄漏”的情况：

- cache 无界增长；
- vector capacity 保留；
- allocator arena 不还给 OS；
- 队列积压；
- mmap/direct buffer；
- 线程栈；
- shared_ptr 环引用。

### 7.3 延迟高

延迟高通常需要拆：

```text
排队时间
执行时间
外部依赖时间
锁等待时间
IO 时间
序列化时间
日志时间
```

高级系统要有：

- request_id / trace_id；
- 队列长度指标；
- p50/p95/p99；
- per-stage latency；
- error code；
- saturation 指标。

## 8. CMake：现代工程建模，而不是脚本堆砌

### 8.1 target 思维

现代 CMake 关注 target 的 usage requirements：

```cmake
add_library(core src/core.cpp)
target_include_directories(core PUBLIC include)
target_compile_features(core PUBLIC cxx_std_20)
target_link_libraries(app PRIVATE core)
```

### 8.2 PUBLIC / PRIVATE / INTERFACE 的本质

| 关键字 | 当前 target 使用 | 传递给依赖者 | 典型场景 |
|---|---:|---:|---|
| PRIVATE | 是 | 否 | 实现细节依赖 |
| PUBLIC | 是 | 是 | 头文件暴露的依赖 |
| INTERFACE | 否 | 是 | header-only 或 usage requirement |

高级追问：为什么 include dir 经常要 PUBLIC？

如果库的 public header 包含了某个依赖的 header，那么使用这个库的下游 target 也需要看到这个 include path，因此是 PUBLIC。

## 9. 应用到你的项目

### 9.1 交易系统

C++/Linux 不是独立知识点，会落到：

- 行情 socket 非阻塞读写；
- order state 单线程 actor 或锁保护；
- fill 去重；
- 回测事件队列；
- epoll/Reactor 模型；
- 日志和审计；
- 性能 profiling。

### 9.2 模型部署

落到：

- ONNX/MLIR 文件和 buffer 生命周期；
- runtime session RAII；
- device handle 释放；
- tensor 内存复用；
- CPU/GPU/NPU 数据拷贝定位；
- 多线程 batch 调度；
- profiling 和错误回滚。

### 9.3 Agent/Embedding 服务

落到：

- embedding 请求队列；
- backpressure；
- batch 聚合；
- async writer；
- vector DB 连接池；
- memory store 一致性；
- 指标和 tracing。

## 10. 高级面试追问

1. 为什么 RAII 不只是内存管理？
2. 析构失败时如何设计接口？
3. shared_ptr 的线程安全边界是什么？
4. 如何避免 shared_ptr 掩盖架构所有权？
5. condition_variable 为什么必须配合 predicate？
6. atomic 为什么不能替代事务式状态更新？
7. epoll ET 卡死的根因是什么？
8. close fd 后为什么 epoll 还可能报告事件？
9. Reactor handler 为什么不能做长任务？
10. CPU 高如何从现象定位到函数和业务原因？
11. 内存增长如何区分泄漏、缓存和积压？
12. CMake 的 PUBLIC/PRIVATE/INTERFACE 如何影响下游构建？

## 11. 工程实践任务

1. 实现 `UniqueFd`，覆盖 move/release/reset。
2. 实现线程安全队列，支持 bounded queue 和 shutdown。
3. 写 epoll echo server，ET 模式读到 EAGAIN。
4. 加 EPOLLONESHOT，worker 处理后 rearm。
5. 制造 fd 泄漏，用 `/proc/<pid>/fd` 和 `lsof` 定位。
6. 制造 CPU 热点，用 perf 定位。
7. 设计 CMake target，使 public header 依赖正确传播。
8. 给每个模块加 trace_id 和 stage latency。

## 12. 资料入口

- C++ Core Guidelines：https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines
- Linux epoll：https://man7.org/linux/man-pages/man7/epoll.7.html
- CMake target_link_libraries：https://cmake.org/cmake/help/latest/command/target_link_libraries.html
- perf wiki：https://perfwiki.github.io/
