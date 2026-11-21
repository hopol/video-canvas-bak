package drama_test

import (
	"errors"
	"regexp"
	"strings"
	"testing"

	"video-canvas/internal/drama"
)

// 创作段的正文只写创作方法：不出现变量名、字段名或反引号包住的标识符。
// 变量名留在系统固定的「输入变量」段，界面只显示正文。
var fieldName = regexp.MustCompile(`\b[a-z]+(?:_[a-z]+)+\b|` + "`")

func TestCreativeBodiesNameNoFields(t *testing.T) {
	for _, step := range []string{"plan", "scripts", "breakdown", "asset_prompts", "storyboard"} {
		t.Run(step, func(t *testing.T) {
			body := drama.PromptBody(step)
			if body == "" {
				t.Fatal("内置创作正文为空")
			}
			if m := fieldName.FindString(body); m != "" {
				t.Fatalf("创作正文不该出现字段名或反引号：%q", m)
			}
		})
	}
}

// 分集规划的格式段负责字段与单元区间，创作段只输出纯文本分集目录。
func TestPlanSplitsIntoDraftAndFormat(t *testing.T) {
	draft, err := drama.Prompt("plan", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(draft, "## 输出约定") || strings.Contains(draft, "## 输出 JSON Schema") {
		t.Fatal("分集规划创作段应是纯文本输出约定")
	}
	format, err := drama.Prompt("plan_format", map[string]any{"draft_md": "草稿", "batch_from": 1, "batch_to": 3})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"required":["episodes"]`, "unit_from", "草稿", "## 校验规则"} {
		if !strings.Contains(format, want) {
			t.Fatalf("分集规划格式段缺少 %s", want)
		}
	}
}

func TestPlanDraftOutputIsText(t *testing.T) {
	got, err := drama.DecodeOutput("plan", []byte("第一集：标题，梗概。"))
	if err != nil {
		t.Fatal(err)
	}
	if text, ok := got.(string); !ok || text != "第一集：标题，梗概。" {
		t.Fatalf("分集目录应原样返回字符串，got %#v", got)
	}
	if _, err := drama.DecodeOutput("plan", []byte("")); !errors.Is(err, drama.ErrOutputInvalid) {
		t.Fatalf("空分集目录应判无效，got %v", err)
	}
}

func TestDraftOutputDropsThinkBlock(t *testing.T) {
	got, err := drama.DecodeOutput("plan", []byte("<think>先排一下集数</think>\n\n第一集：标题，梗概。"))
	if err != nil {
		t.Fatal(err)
	}
	if got != "第一集：标题，梗概。" {
		t.Fatalf("创作稿应去掉思考块，got %#v", got)
	}
	if _, err := drama.DecodeOutput("plan", []byte("<think>只想不写</think>")); !errors.Is(err, drama.ErrOutputInvalid) {
		t.Fatalf("只有思考块的创作稿应判无效，got %v", err)
	}
}
