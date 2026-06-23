---
title: 高级工程师视角：Agent Memory 架构
description: 基于 LangChain/LangGraph、Milvus、OWASP LLM Top 10 整理的高级 Agent Memory 工程笔记。
---

# 高级工程师视角：Agent Memory 架构

更新时间：2026-06-23

## 0. 官方资料锚点

| 资料 | 关键结论 | 工程含义 |
|---|---|---|
| LangChain Memory Overview | Memory 让 agent 记住过往交互、从反馈中学习、适应用户偏好；短期记忆是 thread-scoped，长期记忆跨 session/thread，并可按 namespace 保存 | Memory 不是聊天历史，而是有作用域、生命周期和访问边界的状态系统 |
| LangChain Long-term Memory | 长期记忆可分 semantic、episodic、procedural；写入可在 hot path 或 background | 生产架构必须拆写入时机、记忆类型和延迟/质量 trade-off |
| Milvus HNSW | HNSW 是图索引，高召回低延迟但内存开销高；`M`、`efConstruction`、`ef` 控制图结构和搜索行为 | 向量检索需要调参和评估，不是 “TopK 一把梭” |
| OWASP LLM Top 10 | Prompt Injection、Sensitive Information Disclosure、Excessive Agency 等是 LLM 应用关键风险 | Memory 系统必须有安全过滤、权限边界、删除治理和审计 |

## 1. 高级工程师如何定义 Memory

初级理解：保存聊天记录，下次拼到 prompt。

高级理解：Agent Memory 是一个**跨会话用户状态管理系统**，需要同时解决：

```text
写什么
何时写
如何表示
如何更新
如何召回
如何排序
如何注入
如何删除
如何评估
如何隔离
如何防攻击
```

真正难点不是“存储”，而是“治理”。

## 2. Memory 的作用域：短期、长期、程序性

### 2.1 短期记忆

短期记忆是当前 thread/session 的状态：

- 消息历史；
- 当前任务进度；
- 工具调用结果；
- 临时偏好；
- rolling summary；
- 当前上下文约束。

高级设计点：短期记忆要解决 context window 限制。长对话不能无限保留完整历史，需要：

- trim；
- summarize；
- drop stale content；
- checkpoint；
- state schema。

### 2.2 长期记忆

长期记忆跨 session/thread：

- 用户事实；
- 稳定偏好；
- 重要事件；
- 沟通风格；
- 关系边界；
- 长期目标；
- 可复用经验。

高级设计点：长期记忆不能无脑写入，它需要 namespace、schema、confidence、sensitivity、expire_at、source 和 version。

### 2.3 程序性记忆

程序性记忆是 agent 行为方式：

- system prompt；
- 工具使用策略；
- 安全边界；
- 输出风格；
- 反思后更新的规则。

高级工程上，程序性记忆要比用户偏好更谨慎，因为它会改变 agent 全局行为。

## 3. Semantic / Episodic / Procedural：不要混成一张表

| 类型 | 存什么 | 例子 | 用法 |
|---|---|---|---|
| Semantic | 事实和偏好 | 用户喜欢短答案 | 个性化回复 |
| Episodic | 过去事件和动作 | 上次如何帮用户排查网络 | 复用解决流程、few-shot |
| Procedural | 行为规则 | 以后回答先给结论再解释 | 控制 agent 行为 |

为什么要区分？

因为不同类型的记忆有不同生命周期、召回方式和风险：

- semantic 可以长期保存；
- episodic 常用于任务复用；
- emotion/event 需要过期；
- procedural 影响系统行为，必须更严格审核。

## 4. Memory Schema：生产级字段

```json
{
  "id": "memory_001",
  "tenant_id": "tenant_a",
  "user_id": "user_123",
  "namespace": ["companion", "user_123", "profile"],
  "type": "semantic | episodic | procedural | emotion | event | relationship",
  "content": "用户喜欢直接、步骤化的技术解释",
  "embedding_text": "沟通偏好：用户喜欢直接、步骤化的技术解释",
  "importance": 0.82,
  "confidence": 0.91,
  "sensitivity": "low | medium | high",
  "source": "conversation | user_edit | system | import",
  "source_message_ids": ["msg_001"],
  "created_at": "2026-06-23T10:00:00Z",
  "updated_at": "2026-06-23T10:00:00Z",
  "last_used_at": null,
  "expire_at": null,
  "status": "active | superseded | deleted | quarantined",
  "version": 3,
  "supersedes": ["memory_old"],
  "audit": {
    "created_by": "memory_writer_v2",
    "policy_version": "2026-06-23"
  }
}
```

### 高级字段解释

| 字段 | 为什么需要 |
|---|---|
| tenant_id | SaaS/多用户隔离 |
| namespace | 支持分层组织和跨作用域检索 |
| sensitivity | 控制是否允许注入 prompt |
| source_message_ids | 支持用户纠错和审计 |
| status | 支持软删除、覆盖和隔离 |
| version | 支持并发更新和回滚 |
| supersedes | 处理冲突和历史版本 |
| audit | 追踪写入策略和模型版本 |

## 5. 写入架构：hot path vs background

### 5.1 Hot path 写入

```text
用户消息
  -> agent 判断是否需要记忆
  -> 立即写入
  -> 本轮或下轮可用
```

优点：

- 新记忆马上可用；
- 用户可感知；
- 适合显式指令：记住这个、不要再叫我 X。

缺点：

- 增加延迟；
- agent 同时回答和记忆，质量可能下降；
- 容易过写；
- 需要把写入工具暴露给 agent。

### 5.2 Background 写入

```text
对话完成
  -> 异步 memory extractor
  -> policy filter
  -> dedup/merge
  -> embedding
  -> upsert
```

优点：

- 不影响主路径延迟；
- 可以批处理；
- 可以做更严格过滤；
- 可结合人工标注/离线评估。

缺点：

- 新记忆不是立即可用；
- 触发频率要设计；
- 需要处理并发更新。

### 5.3 推荐策略

| 事件 | 写入方式 |
|---|---|
| 用户明确说“记住” | hot path |
| 用户纠正记忆 | hot path，优先级最高 |
| 普通对话偏好抽取 | background |
| 长对话摘要 | background 或 session end |
| 情绪状态 | background，但设置 expire_at |
| 敏感信息 | 默认拒写或 quarantine |

## 6. 写入质量控制

### 6.1 抽取器不是最终裁判

LLM extractor 只能产出候选 memory。后面必须经过 policy：

```text
candidate memory
  -> schema validation
  -> sensitivity classification
  -> importance threshold
  -> confidence threshold
  -> dedup search
  -> conflict check
  -> expiry assignment
  -> upsert / reject / quarantine
```

### 6.2 低质量记忆的危害

| 问题 | 后果 |
|---|---|
| 过度写入 | 召回噪声大，prompt 被污染 |
| 错误写入 | 长期误导 agent |
| 情绪永久化 | 把短期状态当人格 |
| 敏感信息写入 | 安全和合规风险 |
| 冲突不处理 | agent 自相矛盾 |
| 删除不彻底 | 用户信任受损 |

### 6.3 记忆写入 policy

建议规则：

```text
if sensitivity == high:
    reject or quarantine
elif confidence < 0.7:
    reject or require confirmation
elif importance < 0.5:
    reject
elif type in [emotion, event] and expire_at is null:
    assign expiration
else:
    dedup_merge_upsert
```

## 7. 召回架构：向量只是第一步

### 7.1 为什么不能只用向量 TopK

向量相似回答的是“语义上近不近”，不是“当前该不该用”。

需要考虑：

- user_id 是否匹配；
- namespace 是否匹配；
- memory 是否 active；
- 是否过期；
- 是否敏感；
- 是否和当前用户表达冲突；
- 该 type 是否适合当前任务；
- 是否最近刚被纠正。

### 7.2 生产召回流程

```text
current user message
  -> intent classification
  -> retrieval query rewrite
  -> metadata filter
  -> vector search
  -> structured search
  -> merge candidates
  -> rerank
  -> safety filter
  -> prompt budget allocator
  -> injection
```

### 7.3 Scoring

```text
score = w1 * semantic_similarity
      + w2 * type_match
      + w3 * importance
      + w4 * confidence
      + w5 * recency
      - w6 * sensitivity_penalty
      - w7 * staleness_penalty
      - w8 * conflict_penalty
```

权重不应该凭感觉定，应该通过评估集调。

## 8. Milvus / HNSW：高召回低延迟的代价

### 8.1 HNSW 原理直觉

HNSW 是多层图：

```text
上层：少量节点，快速导航到近邻区域
下层：更多节点，精细搜索
```

它用内存换延迟和召回。适合低延迟语义召回，但需要关注内存成本和构建时间。

### 8.2 参数工程含义

| 参数 | 增大后 | 工程取舍 |
|---|---|---|
| M | 图更密，路径更多 | 召回更高，内存和构建成本更高 |
| efConstruction | 构建时探索更多候选 | 图质量更好，构建更慢 |
| ef | 查询时探索更多候选 | 召回更好，查询更慢 |

高级调参流程：

```text
固定 embedding 模型和 metric
构造 query-memory 标注集
测 recall@k 与 p95 latency
从 ef 调起
召回不够再重建 M/efConstruction
记录内存和构建时间
```

### 8.3 metric 选择

| metric | 适合 |
|---|---|
| COSINE | 归一化语义 embedding 常用 |
| IP | 部分 embedding/推荐模型 |
| L2 | 欧式距离语义明确的向量 |

metric 选错会直接影响召回质量。

## 9. Prompt 注入：少而准

### 9.1 注入不是展示数据库

错误：

```text
以下是用户所有记忆：...
```

正确：

```text
只注入与当前回答相关的 3-5 条高置信、未过期、非敏感记忆。
```

### 9.2 注入模板

```text
[Long-term user preferences]
- 用户喜欢直接、步骤化的技术解释。

[Recent context]
- 用户最近在系统学习 Agent Memory。记录于 2026-06-20，可能仍相关。

[Interaction boundaries]
- 不要把临时情绪当作长期事实。

[Instruction]
Use these memories only if relevant. Current user message overrides historical memory.
```

### 9.3 高级规则

- 当前用户明确表达优先于历史记忆；
- 过期记忆不注入；
- 情绪记忆必须带时间；
- 敏感记忆默认不注入；
- 冲突记忆只注入最新 active 版本；
- 不要让模型显得“监视用户”。

## 10. 安全：Memory 是高风险数据面

### 10.1 OWASP 风险映射

| OWASP 风险 | Memory 系统里的表现 | 防护 |
|---|---|---|
| Prompt Injection | 用户诱导 agent 泄露或改写记忆 | 指令/数据隔离、工具权限、策略过滤 |
| Sensitive Information Disclosure | 记忆注入泄露隐私 | sensitivity 分类、默认不注入、脱敏 |
| Excessive Agency | agent 自动写/删/用记忆过度 | user confirmation、权限最小化 |
| Model DoS | 超长历史/大量召回导致成本暴涨 | prompt budget、rate limit、summarization |
| Overreliance | 过度相信错误记忆 | confidence、source、current message priority |

### 10.2 删除治理

删除必须覆盖：

```text
structured DB
vector index
cache
prompt context
async writer pending queue
audit log visibility
```

如果只删结构化库，不删向量库，用户仍可能被召回到已删除记忆。

### 10.3 跨用户隔离

强制 filter：

```text
tenant_id == current_tenant
user_id == current_user
namespace starts with current app/user scope
status == active
```

不要依赖 prompt 让模型“不要用别人的记忆”。隔离必须在检索层做。

## 11. 评估体系

### 11.1 写入评估

| 指标 | 说明 |
|---|---|
| write precision | 写入的记忆是否应该写 |
| write recall | 应该写的是否漏掉 |
| sensitivity false negative | 敏感信息是否误写 |
| conflict resolution accuracy | 冲突是否正确覆盖 |
| schema validity | 输出是否符合 schema |

### 11.2 召回评估

| 指标 | 说明 |
|---|---|
| recall@k | 目标记忆是否在 top k |
| MRR/NDCG | 排序质量 |
| stale usage rate | 过期记忆使用率 |
| cross-user leak rate | 跨用户召回率，必须接近 0 |
| p95 latency | 召回延迟 |

### 11.3 回答评估

- 是否自然使用记忆；
- 是否过度暴露记忆；
- 是否尊重当前用户表达；
- 是否避免过期情绪；
- 是否提升连续性；
- 是否触发安全风险。

## 12. 生产架构

```text
Conversation API
  -> Short-term State / Checkpoint
  -> Memory Recall Service
      -> Policy Filter
      -> Vector Search
      -> Structured Store
      -> Rerank
      -> Prompt Budget
  -> LLM Gateway
  -> Async Memory Pipeline
      -> Extractor
      -> Classifier
      -> Dedup/Merge
      -> Embedding Batch Worker
      -> Store Upsert
      -> Evaluation Sampling
  -> User Memory Control UI
      -> View/Edit/Delete
      -> Audit
```

### 高级工程要点

- recall service 要有超时和 fallback；
- async writer 要幂等；
- embedding 维度/模型版本要写入 metadata；
- vector index 重建要有版本；
- 删除要能打断 pending writer；
- prompt budget 要限制 memory 数量；
- 评估集要覆盖冲突、删除、敏感、跨用户。

## 13. 应用到你的项目

你的情感陪伴机器人项目可以这样高级表达：

```text
我参与的是语音转文本之后的 Agent Memory 能力。
它不是文档 RAG，而是用户状态管理系统：
  - 短期记忆维护当前会话状态
  - 长期记忆保存稳定偏好、事实、事件、关系边界
  - 写入分 hot path 和 background
  - 召回结合向量、metadata、importance、confidence、recency
  - 注入 prompt 时做敏感过滤和冲突处理
  - 支持用户纠错和删除
```

如果面试官追问“你怎么评估”，要回答：

```text
写入看 precision/recall 和敏感误写率；
召回看 recall@k、NDCG、p95 latency、cross-user leak；
最终回答看是否自然使用记忆、是否产生过期/冲突/隐私问题。
```

## 14. 高级面试追问

1. 为什么短期记忆和长期记忆不能混成一个历史表？
2. hot path 写入和 background 写入如何取舍？
3. semantic/episodic/procedural memory 分别怎么存？
4. 为什么 memory schema 需要 confidence/sensitivity/source/version？
5. 如何防止 LLM extractor 过度写入？
6. 向量相似为什么不等于应该注入？
7. HNSW 的 M、efConstruction、ef 如何影响召回和延迟？
8. 如何构造 memory retrieval 测试集？
9. 用户删除记忆后如何保证向量库也删了？
10. Prompt injection 如何影响 memory tool？
11. 如何防止跨用户串记忆？
12. 如果记忆和用户当前表达冲突，谁优先？

## 15. 工程实践任务

1. 定义 memory schema，包含 version/status/sensitivity/source。
2. 构造 100 条对话样本，人工标注 expected memories。
3. 写 extractor prompt，输出严格 JSON。
4. 写 policy filter，拒绝敏感/低置信/低重要性记忆。
5. 实现 dedup/merge/supersede。
6. 接入 Milvus HNSW，构造 recall@k 测试。
7. 调 ef，画 recall vs p95 latency 曲线。
8. 加 metadata filter，做跨用户泄漏测试。
9. 构造用户删除记忆测试。
10. 做 prompt injection 测试：诱导模型泄露记忆。
11. 实现 memory control UI 的 view/edit/delete API。
12. 每周抽样评估 write precision 和 stale usage rate。

## 16. 资料入口

- LangChain Memory Overview：https://docs.langchain.com/oss/python/concepts/memory
- LangChain Short-term Memory：https://docs.langchain.com/oss/python/langchain/short-term-memory
- Milvus HNSW：https://milvus.io/docs/hnsw.md
- OWASP LLM Top 10：https://owasp.org/www-project-top-10-for-large-language-model-applications/
