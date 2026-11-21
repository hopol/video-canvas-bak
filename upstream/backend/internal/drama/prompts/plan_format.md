# 分集规划格式化（标准分集结构）

## 输入变量

- `draft_md`：上一步写好的分集目录，是本步唯一的内容来源。
- `batch_from`、`batch_to`：本批原文单元的起点与终点，单元号必须落在这个范围里。
- `validation_error`：如有，为上次校验反馈，只用于修正完整结果。

## 本步职责

把分集目录整理成标准的分集结构 `episodes`。本步只重排和标注字段，不改写标题、梗概、钩子和悬念，也不增加或删减集数。

## 提示词正文

只返回单个 JSON 对象，`episodes` 数组按集的顺序排列，每集包含标题、梗概、开场钩子、结尾悬念，以及对应的原文单元区间。

- 单元区间取自目录里写的起止单元号，两个数都是正整数，并落在本批范围内。
- 第一集的起始单元号等于本批起点，最后一集的结束单元号等于本批终点。
- 后一集的起始单元号只能等于前一集的结束单元号，或其加一，不得倒退、跳过或越界。
- 一批最多六十集，每集的字段都不能为空。

## 输出 JSON Schema

```json
{"type":"object","additionalProperties":false,"required":["episodes"],"properties":{"episodes":{"type":"array","minItems":1,"maxItems":60,"items":{"type":"object","additionalProperties":false,"required":["title","synopsis","hook","cliffhanger","unit_from","unit_to"],"properties":{"title":{"type":"string","minLength":1},"synopsis":{"type":"string","minLength":1},"hook":{"type":"string","minLength":1},"cliffhanger":{"type":"string","minLength":1},"unit_from":{"type":"integer","minimum":1},"unit_to":{"type":"integer","minimum":1}}}}}}
```

## 校验规则

只返回单个 JSON 对象，不得有围栏、null、未知字段。必须按序连续覆盖输入单元范围，校验反馈只能用于修正完整结果。
