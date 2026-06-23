---
title: Agent / RAG / Memory
description: 情感陪伴 Agent、用户记忆、Embedding 检索、向量数据库和上下文组织。
---

# Agent / RAG / Memory

更新时间：2026-06-23

## 对应简历原句

> 参与情感陪伴场景下对话 Agent 记忆能力的方案设计与模块开发，围绕用户偏好、长期事实、历史对话摘要、情绪状态、关系状态和角色人设一致性等场景，设计记忆写入、记忆更新、记忆召回和上下文注入流程。

## 面试风险

这部分最容易被问穿，因为“Agent / RAG / Memory”是热门词。要避免把情感陪伴机器人说成文档问答 RAG。核心讲法应当是：这是**对话记忆检索增强**，不是以文档切分为核心的知识库问答。

同时要避免两个极端：

1. 把所有历史对话都塞进 prompt，误以为这就是 memory；
2. 只做向量 TopK 检索，误以为这就能稳定表达用户长期状态。

真正可落地的 memory system 需要处理：写什么、不写什么、何时更新、如何合并、如何召回、如何注入、如何评估、如何删除、如何避免隐私和记忆污染。

## 一句话解释

情感陪伴 Agent 的记忆系统，是把用户长期偏好、事实、历史事件、情绪状态和互动关系结构化保存，并在后续对话中按相关性、重要性、时间和安全规则召回，注入 Prompt 以提升连续性和个性化。

## Agent 和普通 ChatBot 的区别

普通 ChatBot 通常是单轮或短上下文响应；Agent 更强调状态、记忆、工具、计划和环境交互。对情感陪伴机器人来说，Agent 不一定要复杂规划，但需要稳定维护：

- 用户是谁；
- 用户喜欢什么；
- 之前发生过什么；
- 当前情绪如何；
- 用户和角色之间的关系状态；
- 角色应该以什么风格回应；
- 哪些信息不能误记或乱用。

## RAG 与 Memory 的边界

| 维度 | 文档 RAG | 对话 Memory |
|---|---|---|
| 数据来源 | 文档、网页、知识库 | 用户对话、偏好、事件、状态 |
| 核心动作 | chunk、embed、retrieve、answer | 抽取、写入、更新、召回、注入 |
| 主要目标 | 准确回答外部知识 | 保持长期陪伴连续性 |
| 数据结构 | chunk、source、metadata | fact、preference、event、summary、profile |
| 风险 | 检索错文档、上下文冲突 | 错误记忆、隐私、过度拟合用户状态 |
| 评估 | Recall@K、groundedness、faithfulness | 写入准确率、召回相关性、个性化一致性、污染率 |

面试时可以明确说：当前项目更接近 Memory-based conversational agent，而不是通用文档 RAG。

## 记忆类型设计

| 类型 | 示例 | 生命周期 | 是否适合长期保存 |
|---|---|---|---|
| 用户偏好 | 喜欢夜跑、喜欢猫、讨厌吵闹 | 长期，可更新 | 适合 |
| 长期事实 | 在北京工作、正在准备面试 | 长期，可纠错 | 适合 |
| 历史事件 | 上周面试不顺、生日快到了 | 中期，有时间衰减 | 适合 |
| 情绪状态 | 最近压力大、今天心情低落 | 短期/中期 | 适合，但要过期 |
| 关系状态 | 用户希望被怎样称呼、互动边界 | 长期，可更新 | 适合 |
| 角色偏好 | 喜欢温柔直接、不喜欢说教 | 长期 | 适合 |
| 对话摘要 | 最近三轮主要聊了找工作 | 短期/中期 | 适合 |
| 敏感信息 | 身份证、银行卡、隐私病史 | 默认不保存 | 谨慎或不写 |
| 闲聊噪声 | “哈哈”“今天天气不错” | 不保存 | 通常不写 |

## 短期记忆、长期记忆、工作记忆

| 类型 | 范围 | 典型载体 | 作用 |
|---|---|---|---|
| 工作记忆 | 当前一次推理 | prompt context | 当前回复所需信息 |
| 短期记忆 | 当前会话/thread | message history、rolling summary、checkpointer | 保持当前对话连续 |
| 长期记忆 | 跨会话、跨 thread | profile DB、memory table、vector DB | 保存用户稳定事实和偏好 |
| 程序性记忆 | 系统行为规则 | system prompt、policy、tool rules | 控制 Agent 行为方式 |

情感陪伴场景里，短期记忆解决“刚刚聊到哪”，长期记忆解决“这个用户长期是谁”。两者不能混在一起。

## 推荐总体架构

```text
User Message
  -> Safety / Privacy Filter
  -> Short-term Context Builder
  -> Memory Recall Query Builder
  -> Vector Recall + Metadata Filter
  -> Rerank / Conflict Resolution
  -> Prompt Memory Injection
  -> LLM Response
  -> Memory Write Candidate Extraction
  -> Importance / Sensitivity / Confidence Scoring
  -> Dedup / Merge / Update / Expire
  -> Memory Store + Vector Store
```

也可以拆成同步路径和异步路径：

```text
同步热路径：
用户输入 -> 召回少量相关记忆 -> 回复

异步冷路径：
对话结束或每 N 轮 -> 抽取候选记忆 -> 审核/合并 -> 写入长期记忆
```

热路径关注低延迟和稳定性，冷路径关注写入质量和去重合并。实际工程中，写入长期记忆通常不应该阻塞用户回复。

## 推荐 Memory Schema

```json
{
  "id": "memory_xxx",
  "user_id": "user_xxx",
  "namespace": "companion_app/user_profile",
  "type": "preference | fact | event | emotion | relationship | summary | rule",
  "content": "用户喜欢晚上跑步",
  "summary": "运动偏好：夜跑",
  "subject": "user",
  "predicate": "likes",
  "object": "night running",
  "importance": 0.8,
  "confidence": 0.9,
  "sensitivity": "low | medium | high",
  "source": "conversation",
  "source_message_ids": ["msg_1", "msg_2"],
  "created_at": "2026-06-23T10:00:00Z",
  "updated_at": "2026-06-23T10:00:00Z",
  "last_used_at": null,
  "expire_at": null,
  "status": "active | superseded | deleted",
  "embedding_text": "运动偏好：用户喜欢晚上跑步",
  "embedding": "vector"
}
```

关键字段解释：

| 字段 | 作用 |
|---|---|
| `namespace` | 隔离不同业务、用户、租户或记忆类型 |
| `type` | 支持类型过滤，不同类型有不同生命周期 |
| `importance` | 决定是否写入和召回优先级 |
| `confidence` | 区分用户明确表达和模型推断 |
| `sensitivity` | 控制隐私保护和注入边界 |
| `source_message_ids` | 支持追溯来源和用户纠错 |
| `expire_at` | 情绪、事件、短期状态必须能过期 |
| `status` | 支持软删除、版本化、被新记忆覆盖 |
| `embedding_text` | 不一定等于原文，要适合检索 |

## 记忆写入策略

写入不是“所有对话都存”。建议策略：

1. **事实抽取**：从对话中提取稳定事实和偏好。
2. **重要性评分**：判断是否值得长期保存。
3. **置信度判断**：用户明确表达高于模型推断。
4. **敏感信息过滤**：隐私、安全、账号、证件等默认不写。
5. **去重与合并**：同类偏好更新而不是新增多条冲突记忆。
6. **时间属性**：短期情绪和长期事实采用不同生命周期。
7. **用户可控**：用户纠正、删除、禁用记忆时必须生效。

## 写入判断规则

| 用户表达 | 是否写入 | 原因 |
|---|---|---|
| “我喜欢晚上跑步” | 写入 preference | 稳定偏好，后续有用 |
| “我今天有点累” | 可写短期 emotion，设置过期 | 当前状态有用，但不能长期套用 |
| “我下周三要面试” | 写入 event，设置时间 | 有明确时间的事件 |
| “哈哈随便啦” | 不写 | 信息价值低 |
| “我好像有点讨厌咖啡了” | 低置信候选 | 表达不稳定，需要后续确认 |
| “我的银行卡号是...” | 默认不写 | 敏感信息 |
| “以后别叫我小张” | 写入 relationship/rule | 明确互动边界 |

## 写入 Prompt 示例

用于异步抽取候选记忆：

```text
你是对话记忆抽取器。请从用户消息和助手消息中抽取值得长期或中期保存的记忆。

只输出 JSON 数组。每个元素包含：
- type: preference/fact/event/emotion/relationship/summary/rule
- content: 简洁中文事实
- importance: 0 到 1
- confidence: 0 到 1
- sensitivity: low/medium/high
- expire_at: ISO 时间或 null
- reason: 为什么值得保存

不要保存：
- 闲聊语气词
- 低置信推断
- 银行卡、证件号、密码、token
- 用户没有明确表达的心理诊断
- 可能伤害用户的标签化判断
```

## 更新、合并和删除

### 去重

同一用户可能多次表达相似偏好：

```text
旧：用户喜欢跑步
新：用户喜欢晚上跑步
```

不要新增两条互相竞争的记忆，可以更新为：

```text
用户喜欢晚上跑步。
confidence: 更高
updated_at: 当前时间
source_message_ids: 追加来源
```

### 冲突

```text
旧：用户喜欢咖啡
新：用户现在不喝咖啡了
```

处理方式：

- 新信息来自用户明确纠正，优先级更高；
- 旧记忆标记为 `superseded`，不要硬删除；
- 新记忆保留来源和时间；
- prompt 注入时只用 active 且最新可信版本。

### 删除

用户说“别记这个了”时：

```text
memory.status = deleted
memory.deleted_at = now
memory.delete_reason = user_request
```

如果系统有向量库和结构化库两份数据，必须两边都删除或标记不可召回。

## 记忆召回策略

仅靠向量 TopK 容易召回噪声。更稳的做法是组合多因子：

```text
召回分数 = 语义相似度
        + 类型匹配权重
        + 重要性权重
        + 时间衰减
        + 当前意图匹配
        - 敏感性惩罚
        - 冲突/过期惩罚
```

常见流程：

1. 根据当前用户输入生成 embedding；
2. 根据当前任务判断要召回哪些 memory type；
3. 向量库召回 TopK 候选记忆；
4. 使用 metadata filter 限制 user_id、namespace、status、sensitivity；
5. 根据 memory type、importance、recency 做 rerank；
6. 对冲突、过期、低置信记忆降权；
7. 将少量高置信记忆注入 Prompt。

## Query 构造

当前用户输入不一定适合直接做 embedding。例如：

```text
用户：你还记得我之前说过那个面试吗？
```

直接 embed 这句话，可能召回“记得”“之前”相关噪声。更好的做法是先构造 retrieval query：

```json
{
  "intent": "recall_user_event",
  "query_text": "用户之前提到的面试、求职、准备情况、面试时间和结果",
  "memory_types": ["event", "summary", "emotion"],
  "time_range": "recent_or_active"
}
```

## Milvus / 向量库建模

一个 memory collection 可以这样设计：

| 字段 | 类型 | 用途 |
|---|---|---|
| `id` | string/int64 primary key | memory id |
| `user_id` | scalar | 用户隔离和过滤 |
| `namespace` | scalar | 业务隔离 |
| `type` | scalar | preference/fact/event 等 |
| `status` | scalar | active/superseded/deleted |
| `importance` | float | 排序权重 |
| `confidence` | float | 排序权重 |
| `created_at` | int64/timestamp | 时间过滤 |
| `expire_at` | int64/timestamp/null | 过期过滤 |
| `embedding` | float vector | 语义召回 |
| `content` | string/json | 注入 prompt 的文本 |

查询时必须带过滤条件：

```text
user_id == current_user
AND namespace == target_namespace
AND status == active
AND (expire_at is null OR expire_at > now)
AND sensitivity != high
```

这样可以避免跨用户串记忆、召回已删除记忆、长期使用过期情绪。

## HNSW 参数理解

HNSW 是图索引，适合低延迟高召回，但内存开销较高。常见参数：

| 参数 | 含义 | 调大影响 |
|---|---|---|
| `M` | 每个节点最多连接的邻居数 | 召回可能提高，内存和构建时间增加 |
| `efConstruction` | 建图时搜索候选数量 | 图质量提高，构建更慢 |
| `ef` | 查询时探索候选数量 | 召回提高，查询延迟增加 |
| metric | L2/COSINE/IP | 必须匹配 embedding 模型输出和归一化方式 |

调参思路：

1. 先固定 embedding 模型和 metric；
2. 用标注集测 Recall@K；
3. 从较小 `ef` 开始，观察延迟和召回曲线；
4. 如果召回不足，再调大 `M` 和 `efConstruction` 重建索引；
5. 线上更常调 `ef`，因为它是查询侧参数。

## Prompt 上下文组织

Prompt 中不要把所有记忆平铺进去。推荐结构化注入：

```text
[角色设定]
你是一个情感陪伴机器人，保持温和、稳定、尊重边界。

[用户长期偏好]
- 用户喜欢晚上跑步。
- 用户希望被称呼为 ...

[近期状态]
- 用户最近在准备面试，压力较大。该状态记录于 2026-06-20，可能已变化。

[互动边界]
- 用户不希望被叫“小张”。

[当前对话]
用户：...

[回复要求]
结合相关记忆，但不要直接暴露“我查到了你的记忆”。
如果记忆与用户当前表达冲突，以用户当前表达为准。
```

注入原则：

- 最多注入少量高价值记忆；
- 情绪类记忆必须带时间；
- 低置信记忆不注入或弱化表达；
- 敏感记忆默认不注入；
- 不要让记忆覆盖用户当前明确表达。

## 记忆冲突处理

常见冲突：

- 用户以前说喜欢 A，现在说不喜欢 A；
- 系统把玩笑话写成事实；
- 情绪状态过期后仍被使用；
- 多条记忆描述同一事实但细节不同；
- 用户要求删除，但向量库仍能召回。

处理策略：

- 新信息优先，但保留历史版本；
- 用户明确纠正时提高新记忆置信度；
- 情绪类记忆设置过期时间；
- Prompt 注入时只放当前最可信版本；
- 对低置信推断加“可能”“似乎”等弱表达，或不写入；
- 删除请求必须让结构化库和向量库同步生效。

## 隐私与安全边界

情感陪伴场景必须重视隐私：

| 风险 | 示例 | 处理方式 |
|---|---|---|
| 过度记忆 | 用户随口说的信息被长期保存 | 写入前重要性和置信度判断 |
| 敏感信息保存 | 证件、银行卡、密码、token | 默认拒写或加密隔离 |
| 错误心理标签 | “用户有抑郁症” | 不基于闲聊做诊断性记忆 |
| 跨用户串记忆 | A 的偏好召回给 B | user_id/tenant filter 必须强约束 |
| Prompt injection | 用户诱导系统泄露记忆 | 记忆注入和工具权限隔离 |
| 删除不彻底 | DB 删除但 vector 仍能召回 | 删除链路做一致性检查 |

## 记忆评估指标

| 指标 | 解释 | 如何构造 |
|---|---|---|
| Write Precision | 写入的记忆有多少是真的该写 | 人工标注对话，检查写入候选 |
| Write Recall | 该写的记忆有多少被写入 | 人工标注 gold memories |
| Retrieval Recall@K | 应召回记忆是否在 TopK 中 | 构造 query-memory 测试集 |
| Injection Precision | 注入 prompt 的记忆是否相关 | 检查最终注入列表 |
| Conflict Rate | 召回/注入冲突记忆比例 | 构造偏好变更样例 |
| Staleness Rate | 过期记忆被使用比例 | 检查 expire_at 和 used_at |
| Privacy Violation Rate | 敏感信息误写/误注入比例 | 专门构造敏感测试集 |
| User Correction Success | 用户纠错后系统是否更新 | 回归测试纠错场景 |

## 测试集示例

```json
{
  "conversation": [
    {"role": "user", "content": "我最近在准备后端开发面试，有点紧张。"},
    {"role": "assistant", "content": "可以，我们可以一起拆准备计划。"},
    {"role": "user", "content": "我比较怕被问 C++ 多线程。"}
  ],
  "expected_memories": [
    {
      "type": "event",
      "content": "用户最近在准备后端开发面试",
      "expire_policy": "medium_term"
    },
    {
      "type": "emotion",
      "content": "用户对面试有紧张情绪",
      "expire_policy": "short_term"
    },
    {
      "type": "preference_or_focus",
      "content": "用户希望重点准备 C++ 多线程",
      "expire_policy": "medium_term"
    }
  ],
  "negative_memories": [
    "用户一定不会 C++ 多线程",
    "用户有焦虑症"
  ]
}
```

## 高频追问

### Q1：哪些信息应该写入长期记忆？

稳定、可复用、对未来对话有帮助的信息，例如长期偏好、身份事实、重要事件、互动边界。一次性闲聊、低置信推断、敏感信息通常不写或谨慎处理。情绪类信息可以写短期或中期记忆，但必须有时间和过期机制。

### Q2：如何避免记忆污染？

通过写入前分类、重要性评分、置信度判断、敏感信息过滤、去重合并、过期机制和用户纠错机制降低污染。不要把模型推断直接当事实写入；不要把玩笑话、临时情绪、单次表达长期化。

### Q3：RAG 和 Memory 有什么区别？

RAG 更偏外部知识检索，Memory 更偏用户状态和历史对话管理。情感陪伴场景中，核心不是文档 chunk，而是用户长期关系和上下文连续性。RAG 追求 answer groundedness，Memory 追求个性化、连续性和边界正确。

### Q4：召回错了怎么办？

需要 rerank、metadata filter、时间衰减、类型过滤和 Prompt 注入限制。低置信记忆不应直接影响回复。用户当前明确表达和最新纠错要优先于历史记忆。

### Q5：为什么不能每句话都 embedding 并长期保存？

因为会带来噪声、隐私风险、召回污染、存储成本和上下文干扰。Memory 的价值不在于“存得多”，而在于“存得准、用得对、能更新、能删除”。

### Q6：如何评价记忆系统好不好？

至少要分写入、召回、注入、回复效果四层评估。写入看 precision/recall，召回看 Recall@K 和过滤正确性，注入看相关性和安全性，最终回复看是否自然使用记忆、是否过度暴露记忆、是否尊重用户当前表达。

## 项目讲法模板

> 语音识别和合成链路主要由其他同事负责。我参与的重点是语音转文本之后的对话 Agent 相关能力，包括用户偏好、长期事实、历史摘要和情绪状态等信息的结构化管理，以及后续对话时的记忆召回和上下文组织。这个方向更接近对话记忆增强，不是传统文档 RAG。工程上我会把记忆拆成短期会话状态和长期用户记忆，写入时做重要性、置信度和敏感信息过滤，召回时结合向量相似度、类型过滤、时间衰减和 metadata 约束，最后只把少量高置信记忆注入 prompt。

## 最小实践任务

### 任务 1：Memory Schema

实现一个 memory 表或 JSON 存储，字段至少包括：

- id；
- user_id；
- type；
- content；
- importance；
- confidence；
- sensitivity；
- created_at；
- updated_at；
- expire_at；
- status。

### 任务 2：写入抽取器

输入一段对话，输出候选 memories。要求：

- 不保存闲聊噪声；
- 不保存敏感信息；
- 对情绪类记忆设置过期；
- 对用户明确表达给更高 confidence；
- 输出 JSON 可解析。

### 任务 3：召回排序器

实现一个 scoring function：

```text
score = 0.55 * semantic_similarity
      + 0.15 * importance
      + 0.10 * confidence
      + 0.10 * recency_score
      + 0.10 * type_match
      - sensitivity_penalty
      - staleness_penalty
```

要求：

- 只召回当前 user_id；
- status 必须 active；
- expire_at 过期不召回；
- 最多注入 5 条。

### 任务 4：纠错回归测试

构造：

```text
第 1 轮：用户说喜欢咖啡。
第 10 轮：用户说现在不喝咖啡了。
第 11 轮：问用户想喝什么。
```

期望：系统不能继续强行推荐咖啡，而应使用最新记忆。

## 资料入口

- LangChain Memory Overview：https://docs.langchain.com/oss/python/concepts/memory
- LangChain Short-term Memory：https://docs.langchain.com/oss/python/langchain/short-term-memory
- Milvus Overview：https://milvus.io/docs/overview.md
- Milvus HNSW：https://milvus.io/docs/hnsw.md
- RAG 原始论文：https://arxiv.org/abs/2005.11401
- ReAct：https://arxiv.org/abs/2210.03629
- MemGPT：https://arxiv.org/abs/2310.08560
- HNSW：https://arxiv.org/abs/1603.09320
- ANN-Benchmarks：https://ann-benchmarks.com/
- OWASP LLM Top 10：https://owasp.org/www-project-top-10-for-large-language-model-applications/
