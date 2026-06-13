---
name: commerce-video-methodology-extractor
zh_name: "带货视频方法论提取器"
en_name: "Commerce Video Methodology Extractor"
description: |
  Use when Codex needs to turn a coherent batch of ecommerce, viral, commerce-video, or quality-video assets into reusable methodology skills for short-video creation. Use for n:1 clustering, Chinese child-skill generation, shot grammar extraction, script/storyboard contracts, and downstream generation templates backed by asset-library evidence.
zh_description: |
  当需要把一组同类带货视频、爆款短视频、优质视频素材沉淀为可复用的中文方法论技能时使用。适用于 n:1 聚类、中文 child skill 生成、镜头语法提炼、脚本/分镜/生成合约输出，以及基于素材库证据的创作模板。
triggers:
  - "方法论提炼"
  - "生成中文技能"
  - "爆款视频结构提炼"
  - "带货视频聚类"
  - "灵感模板"
  - "commerce video methodology extractor"
od:
  mode: video
  category: video-generation
  surface: video
  provenance:
    kind: "human-generated"
    generatedBy: "human"
    source: "open-design-built-in-skill"
  asset_library:
    sections:
      - commerce-videos
      - quality-videos
    consumes:
      - video_summary
      - methodology
      - slice_features
      - embedding_summary
    outputs:
      - inspiration_template
      - methodology_skill
      - downstream_generation_contract
---

# 带货视频方法论提取器

把一批同结构短视频提炼成可以被下一位 agent 直接使用的中文技能。目标不是写一份分析报告，而是产出一个“拿到新商品后怎么拍、怎么写脚本、怎么检索参考、怎么验收”的可执行方法论。

## 核心原则

- 先证据，后方法。每条创作规则都要能追到素材库里的视频、切片、字幕、口播、画面动作或明确标注的推断。
- 聚类看结构，不看表面品类。优先按开场钩子、镜头顺序、商品证明、字幕/口播、节奏、CTA、视觉情绪分组。
- 方法论要能迁移。只描述某条视频发生了什么是不够的；必须说明换成新商品、新场景、新人设时如何复用。
- 生成的 child skill 用户可见信息必须中文。内部 `name` 受 daemon slug 约束，保留稳定英文 id；同时写 `zh_name`/`displayName.zh-CN`、中文标题、中文正文和中文触发词。
- Evidence Ledger 放在末尾。技能主体先教会 agent 怎么做，证据只用于校验和回溯。

## 工作流

1. **锁定任务边界。** 明确商品类目、平台、比例、目标时长、是否需要口播、是否要生成脚本/分镜/视频提示词。
2. **读取素材库证据。** 先运行 `od assets status --json`。电商素材用 `od assets commerce-videos methodology-summary --query "<类目/风格>" --json`，优质视频库用 `od assets quality-videos methodology-summary --query "<类目/风格>" --json`。
3. **检查样本置信度。** 3 条以上同结构视频可标 high；2 条为 medium；1 条只能写 candidate，不能包装成成熟模板。
4. **按创作机制聚类。** 对比每条视频的 hook、shot order、商品露出、证明方式、字幕/口播、音乐节奏、人物/场景占比、CTA。不要把“都是女装”当成同一方法论。
5. **提炼“迁移规则”。** 每个聚类都要写出：适配条件、反适配条件、输入变量、镜头语法、脚本语法、可替换槽位、生成提示词、质量门槛。
6. **生成中文 child skill。** 结构必须像内置设计/模板 skill：短介绍、使用场景、操作步骤、输出合约、验收清单、反模式。不要只输出 Strategy + Factor Table。
7. **导入 Skills 库。** 通过 `/api/skills/import` 或 Settings -> Skills import。保留 `od.provenance.kind: human-generated`，显式 provenance 可用：

```json
{
  "kind": "human-generated",
  "generatedBy": "human",
  "source": "open-design-skill-library",
  "sourceSkillId": "commerce-video-methodology-extractor"
}
```

## Child Skill 生成规范

内部 id 用英文 slug，展示名和内容用中文：

```yaml
name: "commerce-video-template-<strategy-slug>"
zh_name: "<中文方法论名>"
en_name: "<English display name>"
description: |
  Use when Codex needs to create or adapt ...
zh_description: |
  当需要为 <类目/场景> 生成 <平台/比例/时长> 的 <中文方法论名> 短视频时使用。
triggers:
  - "<中文方法论名>"
  - "<中文检索词>"
```

正文必须使用中文 H1，例如 `# 镜前/换装 OOTD 氛围型`。不要让 H1、章节标题或核心流程停留在英文。

## Child Skill 正文结构

每个生成的 child skill 至少包含这些章节：

1. `## 使用场景`：写清楚适配类目、平台、比例、时长、样本置信度和不适配情况。
2. `## 方法论核心`：用 2-4 条原则说明这套视频为什么成立，强调可迁移机制。
3. `## 输入变量`：列出新任务必须提供或可推断的变量，例如商品、卖点、人设、场景、BGM、镜头数量、CTA。
4. `## 操作流程`：给 agent 的步骤，不是给人看的摘要。包含参考检索、脚本生成、分镜生成、素材替换、生成提示词拼装。
5. `## 镜头语法`：按秒级节奏写 5-8 个镜头，包含画面、动作、商品证明、字幕/口播、生成提示词要点。
6. `## 文案与提示词脚手架`：给可直接替换变量的脚本模板、字幕模板、视频生成 prompt 模板。
7. `## 变体规则`：同一方法在不同商品、场景、风格下怎么换，不要重新发明。
8. `## 质量门槛`：P0/P1 验收清单，覆盖事实、画面、节奏、平台安全和复用性。
9. `## 反模式`：明确什么做法会破坏方法论。
10. `## 证据账本`：来源视频、slice 数、可检索关键词和证据等级。证据放最后。

## 方法论判断标准

合格的方法论回答“下次怎么做”：

| 不合格输出 | 合格输出 |
|---|---|
| “视频展示多套穿搭，氛围感强。” | “先用人脸/镜前对视建立人物吸引力，再用 2-3 个全身动作证明整体搭配，字幕保持极少，BGM 用换装节拍做留存。” |
| “卖点是材质、版型、百搭。” | “每 1.5-3s 用一个手部特写证明一个卖点：揉搓证明面料、拉链/走线证明做工、口袋动作证明功能，最后用上身镜头收束。” |
| “适合女装。” | “适合上身效果强、动态有形变的女装；不适合需要参数解释的工具品和 3C。” |

## 输出 Schema

```yaml
strategy:
  id: "commerce-video-template-<strategy-slug>"
  zhName: ""
  enName: ""
  confidence: high|medium|low
  fit:
    categories: []
    platform: "抖音 / 9:16"
    durationRange: ""
    badFit: []
methodology:
  corePrinciples: []
  inputVariables: []
  workflow: []
  shotGrammar: []
  scriptGrammar: []
  promptScaffold: []
  variantRules: []
quality:
  p0Gates: []
  p1Gates: []
  antiPatterns: []
evidence:
  sourceAssetIds: []
  sourceSliceIds: []
  observed: []
  inferred: []
  missing: []
childSkillPayload:
  name: ""
  displayName:
    zh-CN: ""
    en: ""
  descriptionI18n:
    zh-CN: ""
    en: ""
  triggers: []
  body: ""
```

## Import Payload 模板

```json
{
  "name": "commerce-video-template-<strategy-slug>",
  "displayName": {
    "zh-CN": "<中文方法论名>",
    "en": "<English method name>"
  },
  "description": "Use when Codex needs to create or adapt ecommerce short videos with this methodology.",
  "descriptionI18n": {
    "zh-CN": "当需要为指定商品生成或改写这套中文带货视频方法论时使用。",
    "en": "Use when Codex needs to create or adapt ecommerce short videos with this methodology."
  },
  "triggers": ["<中文方法论名>", "带货视频模板", "爆款视频方法论"],
  "provenance": {
    "kind": "human-generated",
    "generatedBy": "human",
    "source": "open-design-skill-library",
    "sourceSkillId": "commerce-video-methodology-extractor"
  },
  "body": "# <中文方法论名>\n\n..."
}
```

## 常见错误

- 不要把 child skill 写成英文标题加中文表格。用户可见名称、H1、章节和正文优先中文。
- 不要只列 Factor Table。Factor Table 是素材观察，不是操作流程。
- 不要把来源证据放在最前面压过方法论主体。
- 不要平均无关视频。不同 hook 或不同成交机制要拆成多个 child skill。
- 不要伪造材质、功效、价格、品牌、折扣、平台数据；无法确认的内容放入 `missing` 或 QA 风险。
- 不要省略反适配场景。一个好方法论必须知道什么时候不用它。
- 不要只停留在聊天回复。最终要入库为 Skills，后续 agent 才能复用。
