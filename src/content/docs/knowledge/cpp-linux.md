---
title: C++ / Linux / 工程能力
description: C++、并发、Linux 系统开发和工程工具链托底。
---

# C++ / Linux / 工程能力

更新时间：2026-06-23

## 学习目标

这页不是 C++ 语法清单，而是工程开发托底能力地图。面试或项目复盘中，C++ / Linux 经常不是单独考，而是穿插在交易系统、模型部署工具链、推理服务、端侧程序、性能排查里一起问。

你需要形成这样的表达能力：

```text
资源生命周期由 RAII 管理
  -> 对象所有权用智能指针表达
  -> 容器和迭代器知道失效边界
  -> 并发共享状态用锁/原子/队列控制
  -> Linux IO 用 fd/socket/epoll 建模
  -> 线上问题能用 top/perf/strace/lsof/gdb 定位
  -> 工程交付靠 CMake/Git/Docker/测试/日志保证可维护
```

## 必须掌握

- C++ 对象模型、RAII、移动语义、智能指针、STL 容器、迭代器失效、模板基础。
- 多线程、互斥锁、条件变量、原子操作、线程池、生产者消费者模型、死锁排查。
- Linux 进程、线程、文件描述符、IO 多路复用、Socket、epoll、性能排查工具。
- Git、Docker、CMake、Shell、单元测试、日志、异常处理和 CI 基础。

## 一句话解释 RAII

RAII 是把资源生命周期绑定到对象生命周期：构造函数获取资源，析构函数释放资源。它解决的是**异常、提前 return、多分支退出时资源仍然能被释放**的问题。

资源不只是内存，也包括：

- 文件描述符；
- socket；
- mutex lock；
- 线程；
- GPU/NPU handle；
- 数据库连接；
- mmap 内存；
- 临时文件；
- runtime session。

## RAII 示例：文件描述符包装

```cpp
#include <fcntl.h>
#include <unistd.h>
#include <stdexcept>
#include <string>

class UniqueFd {
public:
    explicit UniqueFd(int fd = -1) noexcept : fd_(fd) {}

    ~UniqueFd() noexcept {
        if (fd_ >= 0) {
            ::close(fd_);
        }
    }

    UniqueFd(const UniqueFd&) = delete;
    UniqueFd& operator=(const UniqueFd&) = delete;

    UniqueFd(UniqueFd&& other) noexcept : fd_(other.fd_) {
        other.fd_ = -1;
    }

    UniqueFd& operator=(UniqueFd&& other) noexcept {
        if (this != &other) {
            reset();
            fd_ = other.fd_;
            other.fd_ = -1;
        }
        return *this;
    }

    int get() const noexcept { return fd_; }
    explicit operator bool() const noexcept { return fd_ >= 0; }

    int release() noexcept {
        int old = fd_;
        fd_ = -1;
        return old;
    }

    void reset(int new_fd = -1) noexcept {
        if (fd_ >= 0) {
            ::close(fd_);
        }
        fd_ = new_fd;
    }

private:
    int fd_;
};

UniqueFd open_file(const std::string& path) {
    int fd = ::open(path.c_str(), O_RDONLY);
    if (fd < 0) {
        throw std::runtime_error("open failed: " + path);
    }
    return UniqueFd(fd);
}
```

这个例子要能解释：

- 为什么禁用 copy：一个 fd 不能被两个对象重复 close；
- 为什么支持 move：所有权可以转移；
- 为什么析构函数 `noexcept`：析构阶段不能再抛异常；
- 为什么有 `release()`：有些系统调用需要转移裸 fd 所有权；
- 为什么有 `reset()`：替换资源时先释放旧资源。

## 智能指针选择

| 指针 | 所有权语义 | 适合场景 | 常见坑 |
|---|---|---|---|
| `std::unique_ptr<T>` | 独占所有权 | 对象只有一个明确 owner | 不能复制，只能移动 |
| `std::shared_ptr<T>` | 引用计数共享所有权 | 多模块确实共享生命周期 | 滥用会让生命周期不可控 |
| `std::weak_ptr<T>` | 弱引用，不延长生命周期 | 打破 shared_ptr 环引用 | 使用前必须 `lock()` |
| raw pointer / reference | 不拥有资源 | 参数传递、观察对象 | 不要表达所有权 |

### 经验规则

1. 默认用值语义或 `unique_ptr`。
2. 只有确实需要共享生命周期时才用 `shared_ptr`。
3. 回调、观察者、缓存索引尽量避免持有强引用。
4. 接口参数如果不接管所有权，用 `T&`、`const T&` 或 `T*`。
5. 工厂函数返回可转移所有权时，用 `std::unique_ptr<T>`。

## 移动语义要解决什么

移动语义解决“资源对象不能复制，但可以转移”的问题。

```cpp
std::unique_ptr<OrderBook> make_book() {
    auto book = std::make_unique<OrderBook>();
    return book; // 所有权移动/返回值优化
}

std::vector<std::unique_ptr<OrderBook>> books;
books.push_back(make_book());
```

要能解释：

- copy：复制值，两个对象逻辑上独立；
- move：转移资源，被移动对象处于有效但未指定状态；
- `std::move` 本身不移动，只是把表达式转成右值引用；
- 移动后对象只能析构、重新赋值或调用有明确定义的成员函数。

## STL 容器和迭代器失效

| 容器 | 典型用途 | 失效风险 |
|---|---|---|
| `vector` | 连续内存、缓存友好、随机访问 | 扩容后指针/引用/迭代器全部失效 |
| `deque` | 两端插入删除 | 中间插入删除可能导致迭代器失效 |
| `list` | 频繁任意位置插入删除 | 缓存不友好，内存开销大 |
| `unordered_map` | 哈希查找 | rehash 后迭代器失效，指针/引用通常仍需谨慎 |
| `map` | 有序 key | 节点稳定，但访问慢于哈希表 |

### vector 扩容示例

```cpp
std::vector<int> v;
v.reserve(2);
v.push_back(1);
v.push_back(2);

int* p = &v[0];
v.push_back(3); // 可能触发扩容
// p 此时可能悬空，继续使用就是未定义行为
```

工程建议：

- 需要保存元素位置时，优先保存 index 或稳定 ID，不要长期保存 vector 元素指针；
- 已知规模时先 `reserve()`；
- 热路径避免频繁 reallocation；
- 使用 `string_view`、`span` 时必须确认底层对象生命周期。

## 并发基本模型

并发问题的核心不是“开线程”，而是共享状态如何保护。

| 工具 | 用途 | 常见问题 |
|---|---|---|
| `std::mutex` | 保护临界区 | 忘记解锁、锁粒度过大、死锁 |
| `std::lock_guard` | 作用域自动加解锁 | 不能手动 unlock |
| `std::unique_lock` | 可延迟加锁、手动 unlock、配合 condition_variable | 复杂度更高 |
| `std::condition_variable` | 线程等待条件变化 | 虚假唤醒，必须用 while/predicate |
| `std::atomic` | 无锁原子读写和简单同步 | memory order 难，不要过早优化 |
| 线程池 | 控制任务并发度 | 队列积压、任务阻塞、停止流程 |

## 条件变量正确写法

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>

std::mutex m;
std::condition_variable cv;
std::queue<int> q;
bool stopped = false;

void producer(int x) {
    {
        std::lock_guard<std::mutex> lk(m);
        q.push(x);
    }
    cv.notify_one();
}

bool consumer(int& out) {
    std::unique_lock<std::mutex> lk(m);
    cv.wait(lk, [] { return stopped || !q.empty(); });

    if (q.empty()) {
        return false; // stopped
    }

    out = q.front();
    q.pop();
    return true;
}
```

必须说清楚：

- `wait` 要带 predicate，防止虚假唤醒；
- 修改共享状态时要持锁；
- `notify_one` 可以在释放锁后调用，减少被唤醒线程再次阻塞；
- 停止线程池时必须同时设置 stop flag 并 notify；
- 析构时要 join 线程，不能让后台线程访问已销毁对象。

## 死锁常见原因

| 原因 | 示例 | 解决方式 |
|---|---|---|
| 加锁顺序不一致 | 线程 A：先锁 a 再锁 b；线程 B：先锁 b 再锁 a | 固定全局加锁顺序，或用 `std::scoped_lock` |
| 持锁调用外部回调 | 回调里又尝试拿同一把锁 | 锁内只改状态，锁外执行回调 |
| 持锁做慢 IO | 日志、网络、磁盘操作阻塞 | 临界区只保护内存状态 |
| 忘记解锁 | 手动 lock/unlock + 多 return | 使用 RAII lock |
| 析构和线程退出竞争 | 对象析构后线程仍访问成员 | stop + notify + join |

## 原子操作怎么讲

普通变量在多线程下同时读写会产生 data race。`std::atomic` 提供原子读写和内存同步能力。

```cpp
std::atomic<bool> stop{false};

void worker() {
    while (!stop.load(std::memory_order_relaxed)) {
        // do work
    }
}

void shutdown() {
    stop.store(true, std::memory_order_relaxed);
}
```

面试里不要强行讲复杂 memory order。可以这样说：

> 简单 stop flag、计数器可以用 atomic。涉及多个变量的一致性时，优先用 mutex 保护不变量。只有明确性能瓶颈并能证明正确性时，才用更复杂的 lock-free 和 memory order。

## Linux 进程、线程、文件描述符

| 概念 | 解释 | 工程关注点 |
|---|---|---|
| 进程 | 资源隔离单位，有独立地址空间 | fork/exec、环境变量、退出码、信号 |
| 线程 | 同一进程内共享地址空间的执行流 | data race、栈大小、调度、同步 |
| fd | 进程内打开文件/ socket/pipe 的整数句柄 | 泄漏、阻塞模式、close-on-exec |
| socket | 网络通信端点 | backlog、半连接、超时、粘包、重连 |
| signal | 异步通知机制 | 只在 handler 做 async-signal-safe 操作 |

一个 Linux 服务常见资源路径：

```text
socket()
  -> setsockopt()
  -> bind()
  -> listen()
  -> accept()
  -> set_nonblocking()
  -> epoll_ctl(ADD)
  -> epoll_wait()
  -> read/write until EAGAIN
  -> close()
```

## select / poll / epoll 对比

| 机制 | 模型 | 适用场景 | 局限 |
|---|---|---|---|
| `select` | fd_set 位图 | 小规模 fd、兼容性 | fd 数量限制，重复拷贝和遍历 |
| `poll` | pollfd 数组 | 中等规模 fd | 每次仍要线性扫描 |
| `epoll` | 内核维护 interest list 和 ready list | Linux 大量连接 | 使用 ET 时必须正确 drain 到 EAGAIN |

`epoll` 要掌握三个系统调用：

```cpp
int epfd = epoll_create1(EPOLL_CLOEXEC);
epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &event);
int n = epoll_wait(epfd, events, max_events, timeout_ms);
```

## Level Trigger 与 Edge Trigger

| 模式 | 行为 | 写法 |
|---|---|---|
| LT | 只要 fd 仍可读/可写，就会持续通知 | 语义接近 poll，简单但可能重复唤醒 |
| ET | 只有状态变化时通知一次 | 必须非阻塞，并读/写到 `EAGAIN` |

ET 常见 bug：收到一次可读事件，只读了一部分数据就返回。由于没有读到 `EAGAIN`，后面可能不会再收到事件，连接看起来“卡死”。

正确原则：

```text
EPOLLET + nonblocking fd + loop read/write until EAGAIN
```

## Socket 粘包如何解释

TCP 是字节流，不保留消息边界。所谓“粘包/拆包”不是 TCP 错误，而是应用层协议没有定义边界。

常见解决方式：

| 协议方式 | 示例 | 说明 |
|---|---|---|
| 固定长度 | 每条消息 64 字节 | 简单但浪费空间 |
| 分隔符 | `\n` 结尾 | 文本协议常见，要处理转义和半包 |
| 长度前缀 | 4 字节 length + payload | 二进制协议常见 |
| TLV | type + length + value | 可扩展性好 |

## 性能排查工具链

| 问题 | 首选工具 | 看什么 |
|---|---|---|
| CPU 高 | `top`, `htop`, `perf top`, `perf record` | 热函数、系统态/用户态比例 |
| 内存涨 | `free`, `pmap`, `smem`, `valgrind`, ASan | RSS、heap、泄漏、碎片 |
| fd 泄漏 | `lsof -p`, `/proc/<pid>/fd` | fd 数量和类型 |
| 系统调用慢 | `strace -tt -T -p` | 哪个 syscall 阻塞 |
| 网络连接异常 | `ss -tanp`, `tcpdump` | 状态、重传、连接数 |
| 磁盘 IO 高 | `iostat`, `iotop` | util、await、吞吐 |
| 线程卡住 | `gdb -p`, `pstack` | 线程栈、锁等待 |
| 容器问题 | `docker stats`, `docker logs`, `docker inspect` | cgroup 限制、日志、挂载 |

## 一次线上 CPU 高的排查模板

```bash
top -Hp <pid>                 # 找到高 CPU 线程 TID
printf '%x\n' <tid>           # 转成 16 进制，方便和 gdb/perf 栈对齐
perf top -p <pid>             # 看热点函数
perf record -g -p <pid> -- sleep 30
perf report                   # 看调用栈
gdb -p <pid>                  # 必要时 attach
thread apply all bt           # 打印所有线程栈
```

判断方向：

- 热点在业务函数：算法或循环问题；
- 热点在锁：竞争严重；
- 热点在 memcpy/序列化：数据拷贝过多；
- 热点在系统调用：IO 或网络阻塞；
- 热点在日志：同步日志或日志量过大。

## CMake 最小工程模板

```cmake
cmake_minimum_required(VERSION 3.20)
project(demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(core
    src/order_book.cpp
    src/event_loop.cpp
)

target_include_directories(core PUBLIC include)
target_compile_options(core PRIVATE -Wall -Wextra -Wpedantic)

add_executable(app src/main.cpp)
target_link_libraries(app PRIVATE core)
```

原则：

- 现代 CMake 以 target 为中心；
- include、compile options、link libraries 尽量挂在 target 上；
- 不要全局乱改 CXX_FLAGS；
- Debug/Release 参数分开；
- 第三方依赖用 FetchContent、find_package、包管理器或 submodule 明确管理。

## Git 工程习惯

| 场景 | 命令 | 说明 |
|---|---|---|
| 修改最后一次提交信息 | `git commit --amend -m "new message"` | 未 push 或可接受 force push 时用 |
| 查看变更 | `git diff`, `git diff --staged` | 提交前必须看 |
| 拆分提交 | `git add -p` | 按逻辑拆分 patch |
| 临时保存 | `git stash push -m "msg"` | 切分上下文 |
| 找引入 bug 的提交 | `git bisect` | 二分定位回归 |
| 看文件历史 | `git log -- path` | 查责任链 |

## 面试高频问法

### Q1：RAII 解决什么问题？

RAII 把资源获取和释放绑定到对象生命周期。构造成功意味着资源可用，析构自动释放资源。这样即使函数提前 return 或抛异常，也能通过栈展开释放资源，避免内存、fd、锁等泄漏。

### Q2：`unique_ptr`、`shared_ptr`、`weak_ptr` 如何取舍？

默认用 `unique_ptr` 表达独占所有权；确实多个模块共享生命周期时才用 `shared_ptr`；存在观察关系或要打破环引用时用 `weak_ptr`。裸指针或引用只表达借用，不表达所有权。

### Q3：`vector` 扩容会发生什么？

当 size 超过 capacity，vector 会分配更大的连续内存，把旧元素移动或复制过去，然后释放旧内存。原来的指针、引用、迭代器可能全部失效。因此不能长期保存 vector 元素地址。

### Q4：`epoll` 和 `select` 的区别是什么？

`select` 每次调用都需要传入 fd_set，并受 fd 集合大小限制；`poll` 用数组表达但仍要线性扫描；`epoll` 在内核维护 interest list 和 ready list，更适合大量 fd。`epoll` 支持 LT/ET，ET 模式必须使用非阻塞 fd 并读写到 `EAGAIN`。

### Q5：如何定位线上 CPU、内存或 IO 问题？

先用 `top/htop/free/iostat/ss` 判断资源类型，再用 `perf/strace/lsof/gdb` 下钻到函数、系统调用、fd、线程栈。不要一上来猜代码问题，先确认是 CPU bound、IO bound、锁竞争、内存泄漏还是外部依赖阻塞。

## 最小实践任务

### 任务 1：实现 RAII fd

完成一个 `UniqueFd`，要求：

- 禁止 copy；
- 支持 move；
- 析构 close；
- 支持 `release/reset/get`；
- 写单元测试验证 move 后旧对象不再 close。

### 任务 2：实现线程安全队列

要求：

- `push(T)`；
- `pop(T&)` 阻塞等待；
- `stop()` 后所有等待线程退出；
- 使用 `mutex + condition_variable`；
- 写多 producer / 多 consumer 测试。

### 任务 3：实现 echo server

要求：

- socket 非阻塞；
- epoll 监听；
- 支持多个客户端；
- 处理半包；
- 客户端断开后清理 fd；
- 用 `lsof` 检查 fd 是否泄漏。

## 项目讲法模板

> 在工程实现上，我比较重视 C++ 资源生命周期和 Linux 服务稳定性。比如文件描述符、线程、锁、runtime handle 这类资源会尽量用 RAII 包装；并发部分优先用清晰的 mutex/condition_variable 表达共享状态，不会过早写复杂 lock-free。Linux 网络 IO 上会区分 fd、socket、非阻塞、epoll LT/ET 语义，排查问题时会先用 top、perf、strace、lsof、gdb 等工具确认瓶颈位置。

## 资料入口

- C++ RAII：https://en.cppreference.com/w/cpp/language/raii
- `std::unique_ptr`：https://en.cppreference.com/w/cpp/memory/unique_ptr
- C++ containers：https://en.cppreference.com/w/cpp/container
- C++ concurrency support：https://en.cppreference.com/w/cpp/thread
- Linux epoll manual：https://man7.org/linux/man-pages/man7/epoll.7.html
- Linux socket manual：https://man7.org/linux/man-pages/man7/socket.7.html
- CMake Tutorial：https://cmake.org/cmake/help/latest/guide/tutorial/index.html
- GoogleTest：https://google.github.io/googletest/
