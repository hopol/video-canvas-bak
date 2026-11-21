# 单集分镜格式化（片段 JSON）

## 输入变量

- `draft_md`：上一步写好的分镜稿，是本步唯一的内容来源。
- `assets`：本集或全集可用的画布资产，包含 `node_id`、`type`、`name`、`look`、`prompt_summary`。
- `max_seconds`：单个片段时长上限，取值4–60。
- `validation_error`：如有，为上次校验反馈，只用于修正结果。

## 本步职责

把分镜稿切成可以独立生成视频的连续片段，装进 `segments`。本步只切段、标时长、把资产名称换成引用，不改写文字，不增加剧情、动作、台词，也不删减稿里的内容。

## 提示词正文

- 切段：分镜稿里空行分开的部分各自成段；一段的时长不超过 `max_seconds`，放不下就拆成下一段，在两个镜头之间断开，不在一段里堆叠超出时长的镜头。
- `seconds`：本段时长，整数秒。稿里写了镜头起止秒时取最后一镜的终点；没写时按本段内容估算。
- `prompt`：本段的原文，写法、栏名和措辞都照稿保留。稿里的镜头起止秒统一写成 `起-止秒` 的形式（如 `0-3秒`），首尾相接，第一镜从0开始，最后一镜的终点等于 `seconds`；稿里没写起止秒的不补写。拆段后的下一段从0重新计时。
- 资产引用：角色、场景、道具在本段第一次出现的名称处写成 `@[名称](node_id)`，之后同一对象仍用同一引用。`node_id` 只能取输入的 `assets`，不编造；没有对应资产的名称保持纯文字。

## 输出 JSON Schema

只输出一个JSON对象，不带Markdown围栏、注释或解释。所有列出的字段都必须出现，不允许其他字段或null。

```json
{"type":"object","additionalProperties":false,"required":["segments"],"properties":{"segments":{"type":"array","minItems":1,"items":{"type":"object","additionalProperties":false,"required":["seconds","prompt"],"properties":{"seconds":{"type":"integer","minimum":1,"maximum":60},"prompt":{"type":"string","minLength":1}}}}}}
```

## 校验规则

1. segments非空；每段seconds为正整数且≤max_seconds。
2. 每段prompt不能为空；写了镜头起止秒的，首尾相接，终点不超过该段seconds。
3. 所有资产引用node_id来自assets；未知引用会降级为纯文字名称。
4. 遵守分镜稿的剧情顺序和内容，不增加未发生的动作或对白，也不遗漏稿里的台词。
