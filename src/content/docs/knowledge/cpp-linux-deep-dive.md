---
title: C++ 与 Linux 工程能力深度笔记
description: RAII、智能指针、多线程、Reactor、CMake、调试与性能分析。
---

# C++ 与 Linux 工程能力深度笔记

## 1. 学习目标

这部分是所有项目的工程托底。面试中即使目标是 AI 工程，也可能从 C++、Linux、多线程、网络、CMake、调试工具切入，验证基本工程能力。

## 2. C++ RAII

RAII 的核心是“资源获取即初始化”，让资源生命周期绑定到对象生命周期。构造函数获取资源，析构函数释放资源。适用于内存、文件句柄、锁、socket、GPU/NPU runtime handle 等。

面试回答：RAII 的价值是异常安全和资源自动释放，减少忘记释放、提前 return、异常路径泄漏的问题。

## 3. 智能指针

| 类型 | 所有权 | 用途 |
|---|---|---|
| unique_ptr | 独占所有权 | 默认优先使用，不能拷贝，可移动 |
| shared_ptr | 共享所有权 | 多处共享对象生命周期 |
| weak_ptr | 弱引用 | 打破 shared_ptr 循环引用 |

注意：shared_ptr 的引用计数操作是线程安全的，但被管理对象本身不是自动线程安全。

## 4. move 语义

move 语义避免不必要的深拷贝，把资源所有权从一个对象转移到另一个对象。常见在容器扩容、返回大对象、unique_ptr 转移所有权中使用。

## 5. 多线程基础

必须掌握：

- mutex：互斥访问共享数据；
- condition_variable：线程间等待和通知；
- atomic：原子变量，适合简单状态和计数；
- thread pool：任务队列 + worker 线程 + 安全退出；
- deadlock：互斥、占有并等待、不可抢占、循环等待；
- false sharing：不同线程频繁写同一 cache line 上的不同变量。

## 6. Reactor 模型

Reactor 用事件循环监听 fd 就绪事件，再分发给 handler 处理。Linux 下常用 epoll 实现。

```text
epoll_wait
  -> 返回就绪事件
  -> 分发给 read/write handler
  -> 非阻塞 IO 处理
  -> 注册下一轮事件
```

LT 是水平触发，只要 fd 仍就绪会反复通知；ET 是边缘触发，状态变化时通知，通常要求非阻塞 IO 并循环读到 EAGAIN。

## 7. Linux 调试工具

| 工具 | 用途 |
|---|---|
| gdb | 崩溃、断点、栈、变量 |
| perf | CPU 性能热点 |
| strace | 系统调用跟踪 |
| ldd | 动态库依赖 |
| nm / objdump | 符号和二进制分析 |
| top / htop | 进程资源观察 |
| ss / lsof | 网络连接和文件句柄 |

## 8. CMake 和构建

必须会解释：target、include path、link library、编译选项、Debug/Release、静态库/动态库、安装路径和跨平台差异。

## 9. 面试高频问题

- RAII 如何保证异常安全？
- shared_ptr 循环引用怎么解决？
- vector 扩容时会发生什么？
- mutex 和 atomic 的区别？
- condition_variable 为什么要配合 while 判断条件？
- epoll LT 和 ET 的区别？
- 如何排查 CPU 占用高？
- 如何排查内存泄漏？
- CMake 中 target_link_libraries 的作用是什么？

## 10. 项目结合讲法

> 我的项目主要是 C++ 工程实现和 AI 工具链/部署链路，因此 C++ 侧更关注资源生命周期、多线程任务组织、工具链构建、Linux 环境调试和性能排查。比如模型部署工具和端侧 runtime 集成都涉及文件、内存、设备 handle、日志和异常路径的资源管理。
