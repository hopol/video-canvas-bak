package storyboard

import (
	"embed"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"video-canvas/internal/stepkit"
)

// StepSplit 是「从剧本拆分镜」环节的 key。不登记到后台「环节技能」页的注册表，只用内置方法运行。
const StepSplit = "canvas.storyboard_split"

// ScriptMax 是一次拆分镜接受的剧本字数上限：再长就该分场拆，免得一次输出几百镜被截断。
const ScriptMax = 20000

//go:embed methods/split.md
var splitMethod string

//go:embed samples/*.md
var sampleFiles embed.FS

// Shot 是拆分镜输出的一镜，字段和画布分镜表的镜头一致（没有 id，写进表格时由前端分配）。
type Shot struct {
	Scene    string  `json:"scene"`
	Shot     string  `json:"shot"`
	Camera   string  `json:"camera"`
	Action   string  `json:"action"`
	Dialogue string  `json:"dialogue"`
	Duration float64 `json:"duration"`
}

// splitSchema 是拆分镜的输出 Schema；景别、运镜用枚举约束，时长只要求是数字，越界在解码时截断。
var splitSchema = func() json.RawMessage {
	enum := func(list []string) string {
		b, _ := json.Marshal(list)
		return string(b)
	}
	return json.RawMessage(fmt.Sprintf(`{
  "type": "object",
  "required": ["shots"],
  "properties": {
    "shots": {"type": "array", "minItems": 1, "maxItems": %d, "description": "镜头，按剧本顺序排列",
      "items": {"type": "object", "required": ["scene", "shot", "camera", "action", "dialogue", "duration"], "properties": {
        "scene": {"type": "string", "minLength": 1, "maxLength": %d, "description": "画面描述：这个镜头里看得见什么、发生了什么"},
        "shot": {"type": "string", "enum": %s, "description": "景别"},
        "camera": {"type": "string", "enum": %s, "description": "运镜"},
        "action": {"type": "string", "maxLength": %d, "description": "角色动作、移动路线、朝向；没有就空串"},
        "dialogue": {"type": "string", "maxLength": %d, "description": "台词原文；旁白写成「OS：……」；没有就空串"},
        "duration": {"type": "number", "description": "时长（秒），1 到 60，最多 1 位小数"}
      }}}
  }
}`, MaxShots, ShotTextMax, enum(ShotSizes), enum(CameraMoves), ShotTextMax, ShotTextMax))
}()

// SplitStep 返回拆分镜环节的定义。
func SplitStep() stepkit.Step {
	return stepkit.Step{
		Key:    StepSplit,
		Title:  "从剧本拆分镜",
		Studio: "canvas",
		Duty:   "把一段剧本按叙事顺序拆成镜头，每镜写清画面、景别、运镜、动作走位、对白和时长，交给分镜表逐镜出图出视频。不增删剧情，不编造剧本里没有的人物和台词。",
		Inputs: []stepkit.Var{{Name: "script", Type: "string", Desc: "剧本正文（连了多个剧本节点时按连线顺序拼接）"}},
		Media:  stepkit.MediaNone,
		Schema: splitSchema,
		Rules: stepkit.Rules{Hard: []string{
			"必须是合法 JSON，shots 至少 1 镜、字段齐全",
			"景别、运镜只能取输出格式里列出的值",
			"画面描述不能为空",
		}},
		Validate: validateSplit,
		Builtin:  splitMethod,
	}
}

// SplitInput 组装拆分镜的输入。
func SplitInput(script string) stepkit.Input {
	return stepkit.Input{Vars: map[string]any{"script": script}}
}

// validateSplit 在 Schema 之外再查一遍：画面不能只有空白。
func validateSplit(out json.RawMessage, _ stepkit.Input) (stepkit.Flags, error) {
	var o struct {
		Shots []Shot `json:"shots"`
	}
	if err := json.Unmarshal(out, &o); err != nil {
		return nil, stepkit.Hard("输出结构不对：" + err.Error())
	}
	var reasons []string
	for i, s := range o.Shots {
		if strings.TrimSpace(s.Scene) == "" {
			reasons = append(reasons, fmt.Sprintf("第 %d 镜的画面描述是空的", i+1))
		}
		if !slices.Contains(ShotSizes, s.Shot) {
			reasons = append(reasons, fmt.Sprintf("第 %d 镜的景别 %q 不在可选值里", i+1, s.Shot))
		}
		if !slices.Contains(CameraMoves, s.Camera) {
			reasons = append(reasons, fmt.Sprintf("第 %d 镜的运镜 %q 不在可选值里", i+1, s.Camera))
		}
	}
	return nil, stepkit.Hard(reasons...)
}

// DecodeShots 解码已通过校验的输出并规整：文字去首尾空白、截到上限，时长截断到 1–60 秒、保留 1 位小数。
func DecodeShots(raw json.RawMessage) ([]Shot, error) {
	var o struct {
		Shots []Shot `json:"shots"`
	}
	if err := json.Unmarshal(raw, &o); err != nil {
		return nil, fmt.Errorf("解码拆分镜输出：%w", err)
	}
	for i := range o.Shots {
		s := &o.Shots[i]
		s.Scene, s.Action, s.Dialogue = clip(s.Scene), clip(s.Action), clip(s.Dialogue)
		s.Duration = ClampDuration(s.Duration)
	}
	return o.Shots, nil
}

// clip 去首尾空白并截到 ShotTextMax 字。
func clip(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= ShotTextMax {
		return s
	}
	return string([]rune(s)[:ShotTextMax])
}

// Sample 是调提示词用的样例剧本。
type Sample struct {
	Key    string // 文件名（不含扩展名）
	Name   string // 样例名，取文件第一行的标题
	Script string // 剧本正文
}

// SplitSamples 返回随代码发布的样例剧本：对白戏、动作戏、旁白蒙太奇各一个，按文件名排序。
func SplitSamples() []Sample {
	entries, _ := sampleFiles.ReadDir("samples")
	out := make([]Sample, 0, len(entries))
	for _, e := range entries {
		raw, err := sampleFiles.ReadFile("samples/" + e.Name())
		if err != nil {
			continue
		}
		title, body, _ := strings.Cut(string(raw), "\n")
		out = append(out, Sample{
			Key:    strings.TrimSuffix(e.Name(), ".md"),
			Name:   strings.TrimSpace(strings.TrimPrefix(title, "#")),
			Script: strings.TrimSpace(body),
		})
	}
	return out
}
