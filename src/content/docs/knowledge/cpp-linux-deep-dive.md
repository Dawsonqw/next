---
title: C++ 与 Linux 工程能力深度笔记
description: RAII、智能指针、多线程、Reactor、CMake、调试与性能分析的面试追问树。
---

# C++ 与 Linux 工程能力深度笔记

更新时间：2026-06-23

## 1. 学习目标

这部分是所有项目的工程托底。面试中即使目标是 AI 工程，也可能从 C++、Linux、多线程、网络、CMake、调试工具切入，验证你是否具备真实工程开发能力。

这页按“面试追问树”组织：

```text
基础概念
  -> 为什么这么设计
  -> 常见 bug
  -> 如何排查
  -> 项目中怎么用
  -> 如果规模变大怎么优化
```

## 2. RAII 与异常安全

### 2.1 一句话回答

RAII 是把资源生命周期绑定到对象生命周期。构造函数获取资源，析构函数释放资源。这样函数提前 return 或抛异常时，栈上对象会自动析构，资源能被释放。

### 2.2 资源范围

不要把 RAII 只说成“自动释放内存”。工程里的资源包括：

| 资源 | RAII 包装例子 |
|---|---|
| heap memory | `std::unique_ptr`、`std::vector` |
| mutex lock | `std::lock_guard`、`std::unique_lock` |
| file fd | 自定义 `UniqueFd` |
| socket | 自定义 socket wrapper |
| thread | `std::jthread` 或封装 join 的线程类 |
| temporary file | 析构时删除临时文件 |
| GPU/NPU runtime handle | 析构时释放 device/session/context |
| transaction guard | 析构时 rollback，commit 后取消 rollback |

### 2.3 面试追问：析构函数为什么不要抛异常？

答题要点：

- 析构通常发生在作用域退出或异常栈展开过程中；
- 如果栈展开时析构函数再次抛异常，程序可能 `std::terminate`；
- 析构函数应该尽量 `noexcept`；
- 释放资源失败时通常记录日志、设置状态，不能让析构破坏控制流；
- 如果必须显式处理失败，提供 `close()` / `commit()` 这类显式函数。

### 2.4 面试追问：构造函数中途失败会泄漏吗？

如果对象构造过程中某个成员已经构造成功，后续成员或构造函数体抛异常，已经构造成功的成员会按逆序析构。因此把资源放进成员对象，比在构造函数里裸 `new/open` 再手动释放更安全。

### 2.5 典型错误代码

```cpp
void f() {
    int* p = new int[1024];
    do_something(); // 如果这里抛异常，p 泄漏
    delete[] p;
}
```

改法：

```cpp
void f() {
    std::vector<int> p(1024);
    do_something();
}
```

或：

```cpp
void f() {
    auto p = std::make_unique<int[]>(1024);
    do_something();
}
```

## 3. 智能指针深挖

### 3.1 `shared_ptr` 是否线程安全？

准确回答：

- 不同 `shared_ptr` 实例共享同一个控制块时，引用计数增减是线程安全的；
- 但 `shared_ptr` 指向的对象本身不是自动线程安全；
- 多线程同时读写对象内容仍然需要锁或其他同步；
- 同一个 `shared_ptr` 对象实例被多个线程同时读写，也要同步。

### 3.2 `make_shared` 和 `shared_ptr<T>(new T)` 区别

| 方式 | 特点 |
|---|---|
| `make_shared<T>()` | 对象和控制块通常一次分配，性能和局部性更好，异常安全更好 |
| `shared_ptr<T>(new T)` | 对象和控制块可能两次分配，可配合自定义 deleter |

追问点：

- `make_shared` 下对象内存可能要等 weak_ptr 控制块释放后才能完全释放；
- 需要自定义 deleter 或私有构造等情况可能不能直接用 `make_shared`。

### 3.3 循环引用

```cpp
struct A { std::shared_ptr<B> b; };
struct B { std::shared_ptr<A> a; };
```

两个对象互相持有强引用，引用计数永远不归零。解决：其中一边改成 `weak_ptr`。

### 3.4 面试表达边界

推荐表达：

> 我默认用值语义或 `unique_ptr` 表达清晰所有权。只有多个模块确实共享生命周期时才用 `shared_ptr`。如果只是观察对象或回调中避免延长生命周期，会用 `weak_ptr` 或裸指针/引用表达非拥有关系。

## 4. 移动语义与 Rule of Five

### 4.1 `std::move` 做了什么？

`std::move` 不移动对象，它只是把表达式转换为右值引用，让移动构造或移动赋值有机会被调用。

### 4.2 被 move 后对象能不能用？

能析构、能重新赋值，也能调用那些明确支持 moved-from 状态的成员函数。但不要假设旧资源还在。

### 4.3 为什么移动构造最好 `noexcept`？

`vector` 扩容时如果元素的 move constructor 不是 `noexcept`，为了异常安全，容器可能选择 copy 而不是 move。对不可复制对象或昂贵对象，这会影响性能和可用性。

### 4.4 Rule of Five

如果类自己管理资源，通常要考虑：

```text
析构函数
拷贝构造
拷贝赋值
移动构造
移动赋值
```

对于独占资源包装类，常见策略是：

```text
delete copy
enable move
noexcept destructor
noexcept move
```

## 5. STL 容器深挖

### 5.1 vector 为什么常比 list 快？

虽然 list 插入删除理论上 O(1)，但实际工程里 vector 往往更快，因为：

- 连续内存，CPU cache 友好；
- 分配次数少；
- 遍历速度快；
- list 每个节点有额外指针和分配开销；
- 现代 CPU 上 cache miss 成本很高。

### 5.2 `reserve` 和 `resize`

| API | 作用 |
|---|---|
| `reserve(n)` | 只改变 capacity，不改变 size，不构造元素 |
| `resize(n)` | 改变 size，必要时构造或销毁元素 |

### 5.3 unordered_map rehash

`unordered_map` 插入元素可能触发 rehash。rehash 会重建 bucket，迭代器失效。面试里可以补一句：如果知道元素数量，可以提前 `reserve()` 降低 rehash 次数。

### 5.4 `string_view` 的坑

`std::string_view` 不拥有字符串，只是指针+长度。不能返回指向局部 string 的 string_view：

```cpp
std::string_view bad() {
    std::string s = "hello";
    return std::string_view(s); // 悬空
}
```

## 6. 多线程与同步

### 6.1 data race 和 race condition

| 概念 | 含义 |
|---|---|
| data race | 多线程同时访问同一内存，至少一个写，且无同步；C++ 中是未定义行为 |
| race condition | 结果依赖线程调度顺序，不一定都是 data race |

有锁不代表没有 race condition；没有 data race 也可能业务顺序错。

### 6.2 mutex 保护的是不变量

不要只说 mutex 保护变量。更准确是：mutex 保护一组共享状态的不变量。

例子：队列的 `queue` 和 `stopped` 要在同一把锁下维护，否则 consumer 可能看到不一致状态。

### 6.3 条件变量为什么会丢通知？

如果没有在同一把锁下修改条件并检查条件，可能出现：

```text
producer notify
consumer 还没进入 wait
consumer 进入 wait 后永远等不到
```

正确做法不是“记住通知”，而是让 wait 检查条件本身：

```cpp
cv.wait(lock, [&] { return stopped || !queue.empty(); });
```

### 6.4 线程池面试追问

一个可靠线程池要考虑：

- task queue；
- worker loop；
- stop flag；
- condition_variable 唤醒；
- 析构时 stop + notify_all + join；
- 任务异常不能杀死 worker；
- 队列过长要 backpressure；
- 任务不能无限阻塞 worker。

### 6.5 false sharing

多个线程写不同变量，但这些变量落在同一个 cache line 上，会导致 cache line 在 CPU 核之间反复失效，性能下降。

常见优化：

- 热计数器按线程分片；
- cache line padding；
- 避免多个线程频繁写相邻字段。

### 6.6 死锁四条件

```text
互斥
占有并等待
不可抢占
循环等待
```

工程规避：

- 固定加锁顺序；
- 用 `std::scoped_lock` 同时拿多把锁；
- 锁内不调用外部回调；
- 锁内不做慢 IO；
- 缩小临界区；
- 用超时锁定位问题。

## 7. Linux IO 与 epoll

### 7.1 fd 是什么？

fd 是进程内打开文件、socket、pipe、eventfd、timerfd 等内核对象的整数句柄。常见 bug：

- fd 泄漏；
- close 后继续使用；
- fork/exec 后 fd 泄漏到子进程；
- 阻塞 fd 放进事件循环；
- 多线程重复 close。

### 7.2 close-on-exec

服务程序创建 fd 时建议使用 `O_CLOEXEC` 或 `FD_CLOEXEC`，避免 exec 新进程时把敏感 fd 继承过去。

### 7.3 epoll LT/ET 真实区别

LT：只要 fd 仍然可读，`epoll_wait` 会继续返回。简单，但可能重复唤醒。

ET：只有状态从不可读变为可读时通知。必须配合非阻塞 fd，并循环读到 `EAGAIN`。

```cpp
while (true) {
    ssize_t n = ::read(fd, buf, sizeof(buf));
    if (n > 0) {
        // process
    } else if (n == 0) {
        // peer closed
        close(fd);
        break;
    } else if (errno == EAGAIN || errno == EWOULDBLOCK) {
        break;
    } else if (errno == EINTR) {
        continue;
    } else {
        close(fd);
        break;
    }
}
```

### 7.4 EPOLLONESHOT

多线程 Reactor 中，同一个 fd 的事件可能被多个 worker 同时处理。`EPOLLONESHOT` 可以让事件触发一次后自动禁用，处理完成后再 rearm，避免并发处理同一连接。

### 7.5 TCP 粘包和半包

TCP 是字节流，不保留消息边界。应用层必须定义协议边界：

- 固定长度；
- delimiter，例如 `\n`；
- length-prefix；
- TLV。

面试回答不要说“TCP 粘包是 TCP 的问题”，正确说法是应用层没有处理字节流边界。

## 8. Reactor 模型

### 8.1 基本结构

```text
EventLoop
  -> epoll_wait
  -> dispatch ready events
  -> read/write handler
  -> business task queue
  -> update interest events
```

### 8.2 事件循环不能做什么？

- 不能长时间阻塞；
- 不能做重 CPU 计算；
- 不能同步等外部慢服务；
- 不能无界写日志；
- 不能在 handler 里递归调用复杂业务导致事件饥饿。

重任务应投递到 worker pool，结果再回到 event loop 更新连接状态。

### 8.3 Reactor vs Proactor

| 模型 | 含义 |
|---|---|
| Reactor | 等待 IO 就绪，应用自己 read/write |
| Proactor | 发起异步 IO，完成后通知结果 |

Linux epoll 更接近 Reactor；io_uring 可以支持更接近 Proactor 的完成队列模型。

## 9. 性能排查追问树

### 9.1 CPU 高

```text
top 找进程
  -> top -H 找线程
  -> perf top 看热点
  -> perf record -g 采样调用栈
  -> gdb/pstack 看线程状态
  -> 判断业务计算/锁/系统调用/日志/死循环
```

常见结论：

| 热点 | 可能原因 |
|---|---|
| 业务函数 | 算法复杂度或循环问题 |
| `pthread_mutex_lock` | 锁竞争 |
| `memcpy` | 数据拷贝过多 |
| `write` / `fsync` | 同步日志或磁盘 IO |
| `poll/epoll_wait` 不高但 QPS 低 | 可能阻塞在外部依赖 |

### 9.2 内存增长

区分：

- heap 泄漏；
- shared_ptr 环引用；
- cache 无界增长；
- 内存碎片；
- mmap 或 direct buffer；
- 线程栈增长；
- 容器 capacity 未释放。

工具：

```text
free / top / pmap / smem
/proc/<pid>/smaps
ASan / LSan / valgrind
heap profiler
```

### 9.3 fd 泄漏

```bash
ls /proc/<pid>/fd | wc -l
lsof -p <pid>
```

排查：

- accept 后异常路径忘 close；
- 文件打开失败路径未释放；
- 定时器/pipe/eventfd 未关闭；
- 连接状态机终态没有 cleanup。

### 9.4 程序卡死

```bash
gdb -p <pid>
thread apply all bt
```

看：

- 是否所有线程都在等同一把锁；
- 是否 worker 都阻塞在 IO；
- 是否 event loop 被业务阻塞；
- 是否 condition_variable 条件永远不满足；
- 是否死锁。

## 10. CMake 与构建追问

### 10.1 现代 CMake 核心

现代 CMake 以 target 为中心：

```cmake
add_library(core src/core.cpp)
target_include_directories(core PUBLIC include)
target_compile_features(core PUBLIC cxx_std_20)
target_link_libraries(app PRIVATE core)
```

### 10.2 PUBLIC / PRIVATE / INTERFACE

| 关键字 | 影响当前 target | 传递给依赖者 |
|---|---|---|
| PRIVATE | 是 | 否 |
| PUBLIC | 是 | 是 |
| INTERFACE | 否 | 是 |

常见追问：

- 头文件 include 目录什么时候用 PUBLIC？
- 编译选项为什么不要全局设置？
- 静态库和动态库链接差异？
- RPATH 是什么？
- 交叉编译 toolchain file 做什么？

## 11. 项目结合讲法

### 11.1 模型部署工具链

> 模型部署工具里会涉及模型文件读取、临时文件、runtime session、设备 handle、日志和错误路径。我会用 RAII 管理资源，用明确的错误返回或异常边界处理失败路径。性能排查上会先确认是 CPU 算子、IO、内存拷贝还是设备同步耗时。

### 11.2 交易系统

> 交易系统里 C++ 工程能力体现在订单状态机、行情缓存、网络 IO 和并发队列。比如行情接入可能需要非阻塞 socket 和事件循环，订单状态更新需要保证幂等和线程安全，成交回报不能因为重复到达导致持仓错误。

### 11.3 Agent/Embedding 服务

> Embedding 服务如果做本地部署，会涉及批处理队列、线程池、GPU 推理 session、超时和 backpressure。这里不能只关注模型效果，还要关注队列积压、资源释放、服务降级和监控指标。

## 12. 高频追问速查

| 问题 | 关键词 |
|---|---|
| RAII 如何保证异常安全？ | 栈展开、析构释放、noexcept |
| shared_ptr 循环引用怎么解决？ | weak_ptr |
| vector 扩容时会发生什么？ | reallocate、move/copy、迭代器失效 |
| mutex 和 atomic 区别？ | 多变量不变量 vs 单变量原子 |
| condition_variable 为什么要 while？ | 虚假唤醒、条件被消费 |
| epoll LT 和 ET 区别？ | 持续通知 vs 状态变化通知，ET 读到 EAGAIN |
| 如何排查 CPU 占用高？ | top -H、perf、gdb、锁/日志/系统调用 |
| 如何排查内存泄漏？ | ASan/LSan/valgrind、smaps、cache/碎片 |
| CMake target_link_libraries 作用？ | target 依赖、链接库、传递属性 |
| TCP 粘包怎么处理？ | 应用层协议边界 length-prefix/TLV |

## 13. 资料入口

- C++ RAII：https://en.cppreference.com/w/cpp/language/raii
- `std::unique_ptr`：https://en.cppreference.com/w/cpp/memory/unique_ptr
- `std::shared_ptr`：https://en.cppreference.com/w/cpp/memory/shared_ptr
- C++ containers：https://en.cppreference.com/w/cpp/container
- C++ concurrency support：https://en.cppreference.com/w/cpp/thread
- Linux epoll manual：https://man7.org/linux/man-pages/man7/epoll.7.html
- Linux socket manual：https://man7.org/linux/man-pages/man7/socket.7.html
- Linux perf：https://perf.wiki.kernel.org/
- CMake Tutorial：https://cmake.org/cmake/help/latest/guide/tutorial/index.html
