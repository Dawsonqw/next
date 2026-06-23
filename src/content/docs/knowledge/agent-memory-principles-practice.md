---
title: Agent Memory 原理到应用
description: 从上下文窗口、短期/长期记忆、写入、召回、评估、隐私到生产架构的系统学习路线。
---

# Agent Memory 原理到应用

更新时间：2026-06-23

## 0. 为什么 Agent Memory 不是“把历史聊天存起来”

很多人把记忆系统理解成：

```text
把所有聊天记录存数据库
  -> 下次全部取出来塞给大模型
```

这不是真正可用的 Agent Memory。原因：

- 上下文窗口有限，不能无限塞；
- 历史对话噪声很多；
- 用户临时情绪不能长期固化；
- 错误记忆会污染后续回复；
- 敏感信息不能随便保存和注入；
- 用户纠正后必须更新；
- 多条记忆可能冲突；
- 记忆召回相关不等于有用；
- 记忆越多，越需要评估和治理。

真正的 Agent Memory 是一个系统：

```text
识别什么值得记
  -> 结构化保存
  -> 去重合并更新
  -> 向量和元数据共同召回
  -> 过滤冲突/过期/敏感记忆
  -> 少量注入 prompt
  -> 回复后评估是否要写新记忆
  -> 支持删除、纠错、审计
```

## 1. 为什么 LLM 需要外部 Memory

LLM 本身有两种“知识”：

| 类型 | 来源 | 局限 |
|---|---|---|
| 参数知识 | 训练阶段学到 | 更新慢，不包含用户私人历史 |
| 上下文知识 | 当前 prompt 输入 | 窗口有限，成本高，会被截断 |

用户长期偏好、关系状态、近期事件、正在做的事、互动边界，这些通常不在模型参数里，也不应该通过每次塞完整历史解决。

所以需要外部 memory store。

## 2. 情感陪伴场景为什么更需要 Memory

文档问答 RAG 追求“根据外部文档回答正确”。情感陪伴 Agent 更关心：

- 你记不记得用户喜欢什么；
- 你是否知道用户最近在准备什么；
- 你是否尊重用户不喜欢的称呼；
- 你是否能延续上次话题；
- 你是否不会把一次情绪当成永久标签；
- 你是否不会泄露或滥用敏感信息。

这类连续性不是靠文档 chunk 解决，而是靠用户状态和关系状态管理。

## 3. Memory 分层

### 3.1 工作记忆

工作记忆是当前一次模型调用能看到的 prompt 内容：

```text
system prompt
角色设定
当前用户消息
短期对话摘要
召回的少量长期记忆
tool result
```

它决定当前回答，但调用结束就不自动保存。

### 3.2 短期记忆

短期记忆用于当前会话/thread：

- 最近 N 轮消息；
- rolling summary；
- 当前任务状态；
- tool 调用中间结果；
- 会话内用户临时偏好。

它解决“刚刚聊到哪”。

### 3.3 长期记忆

长期记忆跨会话保存：

- 用户偏好；
- 稳定事实；
- 重要事件；
- 互动边界；
- 关系状态；
- 长期目标；
- 可复用摘要。

它解决“这个用户长期是谁”。

### 3.4 程序性记忆

程序性记忆是系统行为规则：

- 角色语气；
- 安全边界；
- 工具使用规则；
- 不允许做的事情；
- 输出格式偏好。

这类通常不来自用户对话抽取，而是产品或系统配置。

## 4. Memory 和 RAG 的根本差异

| 维度 | RAG | Memory |
|---|---|---|
| 数据来源 | 文档、网页、知识库 | 用户对话和状态 |
| 数据单位 | chunk | fact/preference/event/state/summary |
| 更新频率 | 文档更新相对低频 | 每次对话都可能变化 |
| 主要目标 | 事实问答 grounded | 连续性、个性化、关系一致性 |
| 最大风险 | 检索错文档 | 错误记忆、过期记忆、隐私 |
| 删除需求 | 文档版本管理 | 用户可删除、纠错、撤回 |
| 评估方式 | Recall@K、faithfulness | 写入准确率、召回相关性、污染率 |

面试时要明确：

```text
情感陪伴 Agent 的 memory 更像用户状态管理，不是传统文档 RAG。
```

## 5. 什么值得记

### 5.1 适合写入

| 类型 | 示例 | 生命周期 |
|---|---|---|
| 稳定偏好 | 喜欢夜跑，不喜欢太吵 | 长期，可更新 |
| 身份事实 | 在准备后端面试 | 中长期，可过期 |
| 重要事件 | 下周三面试 | 到期后降权或过期 |
| 关系边界 | 不希望被叫某个称呼 | 长期 |
| 沟通偏好 | 喜欢直接给步骤 | 长期 |
| 长期目标 | 想系统学习 embedding | 中长期 |
| 近期状态 | 最近压力大 | 短期，必须带时间 |

### 5.2 不适合写入

| 类型 | 原因 |
|---|---|
| 闲聊语气词 | 价值低，噪声大 |
| 一次性情绪 | 容易过度长期化 |
| 模型推断的人格标签 | 容易错误和冒犯 |
| 敏感证件/密码/token | 安全风险高 |
| 未确认健康/心理诊断 | 高风险、不应推断 |
| 可能伤害用户的标签 | 污染后续互动 |

### 5.3 判断标准

一条 memory 是否值得写，可以问：

```text
未来会不会复用？
用户是否明确表达？
置信度够不够？
是否敏感？
是否会过期？
是否和已有记忆冲突？
是否需要用户确认？
```

## 6. Memory Schema 为什么重要

随便保存一段文本会导致后续无法管理。结构化 schema 的价值是：

- 支持类型过滤；
- 支持时间衰减；
- 支持置信度；
- 支持敏感级别；
- 支持来源追溯；
- 支持删除和更新；
- 支持评估。

推荐字段：

```json
{
  "id": "memory_001",
  "user_id": "user_123",
  "type": "preference | fact | event | emotion | relationship | summary | rule",
  "content": "用户喜欢晚上跑步",
  "embedding_text": "运动偏好：用户喜欢晚上跑步",
  "importance": 0.8,
  "confidence": 0.9,
  "sensitivity": "low",
  "source_message_ids": ["msg_1"],
  "created_at": "2026-06-23T10:00:00Z",
  "updated_at": "2026-06-23T10:00:00Z",
  "expire_at": null,
  "status": "active"
}
```

## 7. 写入流程

### 7.1 热路径和冷路径

不要让复杂写入阻塞用户回复。

```text
热路径：用户输入 -> 召回 -> 回复
冷路径：对话片段 -> 抽取候选记忆 -> 过滤 -> 合并 -> 写入
```

### 7.2 写入候选抽取

LLM 可以用于抽取候选 memory，但不能无条件相信。

抽取后还要做：

- 类型校验；
- 重要性评分；
- 敏感信息过滤；
- 置信度判断；
- 去重合并；
- 过期时间设置；
- 用户删除规则检查。

### 7.3 为什么用户明确表达更重要

用户明确说：

```text
我不喜欢咖啡
```

比模型推断：

```text
用户可能不喜欢咖啡
```

置信度高得多。模型推断不能轻易写成事实。

## 8. 更新、合并、冲突

### 8.1 去重

旧记忆：

```text
用户喜欢跑步
```

新记忆：

```text
用户喜欢晚上跑步
```

更合理是更新旧记忆，而不是新增两条相似记忆。

### 8.2 冲突

旧记忆：

```text
用户喜欢咖啡
```

新记忆：

```text
用户现在不喝咖啡了
```

处理：

```text
旧记忆 status = superseded
新记忆 status = active
保留来源和时间
召回时只用 active
```

### 8.3 删除

用户说“不要记这个”时，必须：

- 结构化库标记 deleted；
- 向量索引删除或过滤；
- 缓存失效；
- prompt 注入不能再出现；
- 后续写入不能马上重新抽取同一内容。

## 9. 召回为什么不能只用向量 TopK

向量相似只是“语义近”，不是“当前应该用”。

问题：

- 召回过期情绪；
- 召回敏感内容；
- 召回低置信推断；
- 召回同义但不相关内容；
- 忽略 memory type；
- 忽略用户当前意图。

更合理的召回：

```text
metadata filter
  -> vector search
  -> type match
  -> recency / importance / confidence scoring
  -> conflict resolution
  -> safety filter
  -> top few injection
```

### 9.1 召回过滤条件

至少要过滤：

```text
user_id == current_user
status == active
expire_at is null or expire_at > now
sensitivity allowed
namespace == current_app
```

### 9.2 召回评分

```text
score = semantic_similarity
      + type_match
      + importance
      + confidence
      + recency
      - sensitivity_penalty
      - staleness_penalty
      - conflict_penalty
```

## 10. Prompt 注入原则

### 10.1 不要暴露内部机制

不要直接说：

```text
我从记忆库查到你喜欢夜跑。
```

更自然：

```text
你之前提到过比较喜欢晚上运动，那这次计划也可以按晚上安排。
```

### 10.2 注入要少而准

只注入：

- 与当前问题相关；
- 高置信；
- 未过期；
- 非敏感；
- 不冲突；
- 对回答有帮助。

### 10.3 情绪类记忆必须带时间

错误：

```text
用户压力很大。
```

更好：

```text
用户在 2026-06-20 提到最近准备面试压力较大，该状态可能已变化。
```

## 11. 向量库和结构化库如何配合

### 11.1 为什么不能只用向量库

向量库适合语义召回，但不擅长表达复杂状态：

- status；
- expire_at；
- sensitivity；
- source；
- version；
- delete audit；
- conflict relation。

所以通常需要：

```text
结构化库：管理事实、状态、版本、权限
向量库：负责语义召回
```

### 11.2 Collection 字段

| 字段 | 作用 |
|---|---|
| memory_id | 主键 |
| user_id | 用户隔离 |
| type | 类型过滤 |
| status | active/deleted/superseded |
| importance | 排序 |
| confidence | 排序 |
| sensitivity | 安全过滤 |
| expire_at | 过期过滤 |
| embedding | 向量召回 |
| content | prompt 注入文本 |

## 12. HNSW 原理直觉

HNSW 可以理解为多层近邻图：

```text
高层：稀疏，快速跳到大致区域
低层：密集，精细搜索邻居
```

常见参数：

| 参数 | 含义 | 调大影响 |
|---|---|---|
| M | 每个点连接邻居数 | 召回更好，内存更大 |
| efConstruction | 建图搜索宽度 | 索引质量更好，构建更慢 |
| ef | 查询搜索宽度 | 召回更好，延迟更高 |

面试讲法：

> 向量检索不是精确全表扫描，而是在召回率和延迟之间折中。HNSW 通过图结构近似搜索，查询时 ef 越大，探索候选越多，召回更好但更慢。

## 13. 评估体系

### 13.1 写入评估

| 指标 | 说明 |
|---|---|
| write precision | 写入的是否真的该写 |
| write recall | 该写的有没有漏 |
| sensitivity violation | 是否误写敏感信息 |
| conflict handling | 冲突是否正确更新 |

### 13.2 召回评估

| 指标 | 说明 |
|---|---|
| recall@k | 该召回的是否在 top k |
| injection precision | 注入 prompt 的是否相关 |
| stale rate | 是否使用过期记忆 |
| privacy leak rate | 是否注入敏感记忆 |

### 13.3 回复效果评估

看最终回答是否：

- 自然使用记忆；
- 不过度暴露记忆；
- 不强行套用过期状态；
- 遵守用户当前表达；
- 尊重删除和纠错；
- 提升连续性。

## 14. 安全与隐私

情感陪伴场景尤其要注意：

| 风险 | 例子 | 处理 |
|---|---|---|
| 过度记忆 | 用户随口一句被永久保存 | importance/confidence 过滤 |
| 错误标签 | 把临时情绪写成长期人格 | emotion 设置过期，不做诊断 |
| 敏感信息 | 证件、密码、token | 默认不写或加密隔离 |
| 跨用户串记忆 | A 的记忆给 B 用 | user_id 强过滤 |
| prompt injection | 用户诱导泄露记忆 | 工具/记忆权限隔离 |
| 删除不彻底 | vector 仍可召回 | 删除链路一致性测试 |

## 15. 生产架构

```text
Conversation Service
  -> Context Builder
  -> Memory Recall Service
      -> Structured DB
      -> Vector DB
      -> Reranker
      -> Safety Filter
  -> LLM Gateway
  -> Async Memory Writer
      -> Candidate Extractor
      -> Policy Filter
      -> Dedup/Merge
      -> Embedding Worker
      -> DB/Vector Upsert
  -> Evaluation / Audit / User Controls
```

关键工程点：

- 写入异步化；
- embedding batch；
- 用户隔离；
- 删除一致性；
- 召回缓存；
- 可观测指标；
- 灰度开关；
- fallback；
- 人工标注评估集。

## 16. 应用到你的情感陪伴机器人项目

你可以这样描述：

```text
语音 ASR/TTS 不是我主要负责部分。
我负责或参与的是文本进入对话 Agent 后的记忆能力：
  - 抽取用户偏好、事实、事件、情绪状态
  - 结构化保存并生成 embedding
  - 召回时结合向量和 metadata
  - 过滤过期、敏感、冲突记忆
  - 注入 prompt 保持上下文连续性
```

强调边界：

- 不是传统文档 RAG；
- 不是心理诊断；
- 不是所有历史都存；
- 不是所有记忆都注入；
- 用户纠正和删除必须优先。

## 17. 面试扩展问题

### 原理层

- 为什么上下文窗口不能替代长期记忆？
- Memory 和 RAG 的区别？
- 为什么记忆不能只存原始聊天？
- 为什么情绪记忆要过期？
- 为什么向量相似不等于应该注入？

### 工程层

- memory schema 怎么设计？
- 写入是同步还是异步？
- 如何做去重合并？
- 用户纠正后如何更新？
- 删除如何保证 vector DB 也生效？

### 检索层

- HNSW 参数怎么影响召回和延迟？
- metadata filter 为什么必须有？
- 召回 query 如何构造？
- rerank 有什么价值？
- 如何避免召回低置信记忆？

### 安全层

- 哪些信息不该写？
- 敏感信息如何识别？
- 如何防止 prompt injection 泄露记忆？
- 如何做跨用户隔离？
- 如何让用户删除自己的记忆？

### 评估层

- 如何评估写入准确率？
- 如何构造 memory 测试集？
- 如何评估记忆是否改善回答？
- 如何评估记忆污染率？
- 如何做回归测试？

## 18. 最小实践路线

1. 设计 memory schema。
2. 手写 20 条对话样本，标注 expected memories。
3. 写一个候选记忆抽取 prompt。
4. 写规则过滤敏感信息和低重要性内容。
5. 实现去重合并。
6. 用 embedding 做向量召回。
7. 加 metadata filter。
8. 加 recency/importance/confidence scoring。
9. 构造冲突记忆测试。
10. 构造用户删除测试。
11. 评估 write precision/recall 和 retrieval recall@k。
12. 把召回记忆注入 prompt，观察回答是否自然。

## 19. 一句话总答

> Agent Memory 的本质是用户状态管理系统，不是简单保存聊天记录。它要解决上下文窗口有限、长期个性化、历史连续性和隐私安全之间的矛盾。生产级 Memory 需要分层：短期会话记忆解决当前上下文，长期记忆保存稳定偏好和事实；写入时要做重要性、置信度、敏感性和过期判断；召回时不能只靠向量 TopK，还要结合 metadata、类型、时间、冲突和安全过滤；注入 prompt 时要少而准，并支持用户纠错和删除。

## 20. 资料入口

- LangChain Memory Concepts：https://docs.langchain.com/oss/python/concepts/memory
- LangChain Short-term Memory：https://docs.langchain.com/oss/python/langchain/short-term-memory
- Milvus Overview：https://milvus.io/docs/overview.md
- Milvus HNSW：https://milvus.io/docs/hnsw.md
- RAG 原始论文：https://arxiv.org/abs/2005.11401
- MemGPT：https://arxiv.org/abs/2310.08560
- HNSW：https://arxiv.org/abs/1603.09320
- OWASP LLM Top 10：https://owasp.org/www-project-top-10-for-large-language-model-applications/
