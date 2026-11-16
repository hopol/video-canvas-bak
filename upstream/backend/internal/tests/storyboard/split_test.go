package storyboard_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"video-canvas/internal/llmgateway"
	"video-canvas/internal/provider"
	"video-canvas/internal/stepkit"
	"video-canvas/internal/storyboard"
)

// fakeCaller 按顺序回放预设的模型输出，记下收到的提示词。
type fakeCaller struct {
	outputs []string
	prompts []string
}

func (f *fakeCaller) Complete(_ context.Context, _ *provider.Snapshot, msgs []llmgateway.Message) (*llmgateway.Result, error) {
	f.prompts = append(f.prompts, msgs[len(msgs)-1].Text)
	if len(f.outputs) == 0 {
		return nil, errors.New("没有更多预设输出")
	}
	out := f.outputs[0]
	f.outputs = f.outputs[1:]
	return &llmgateway.Result{Text: out, Usage: llmgateway.Usage{InputTokens: 100, OutputTokens: 50}}, nil
}

// snap 是一个只有文字能力的 Agent 模型快照。
func snap() *provider.Snapshot { return &provider.Snapshot{} }

// run 用内置方法跑一次拆分镜。
func run(t *testing.T, c *fakeCaller, script string) (*stepkit.Result, error) {
	t.Helper()
	step := storyboard.SplitStep()
	return stepkit.NewRunner(c).Run(context.Background(), step, stepkit.BuiltinMethod(step), snap(), storyboard.SplitInput(script))
}

const validOutput = `{"shots":[
  {"scene":"月夜瓜地，少年持叉守瓜","shot":"远景","camera":"摇","action":"少年猫腰前行","dialogue":"","duration":5},
  {"scene":"猹从瓜叶间窜出","shot":"特写","camera":"甩镜","action":"猹回头","dialogue":"OS：那猹却将身一扭","duration":2.5}
]}`

// TestSplitStepIsValid 拆分镜环节的定义能通过环节协议层的检查（Schema、职责、方法）。
func TestSplitStepIsValid(t *testing.T) {
	if err := stepkit.NewRegistry().Register(storyboard.SplitStep()); err != nil {
		t.Fatalf("环节定义不合格：%v", err)
	}
}

// TestSplitPromptCarriesScriptAndEnums 提示词里带着剧本原文，以及景别、运镜的全部可选值。
func TestSplitPromptCarriesScriptAndEnums(t *testing.T) {
	c := &fakeCaller{outputs: []string{validOutput}}
	if _, err := run(t, c, "雨夜，林晚推门进屋。"); err != nil {
		t.Fatalf("Run: %v", err)
	}
	p := c.prompts[0]
	for _, want := range append([]string{"雨夜，林晚推门进屋。"}, append(storyboard.ShotSizes, storyboard.CameraMoves...)...) {
		if !strings.Contains(p, want) {
			t.Errorf("提示词缺少 %q", want)
		}
	}
}

// TestSplitDecodesShots 合格输出解码成镜头，字段原样。
func TestSplitDecodesShots(t *testing.T) {
	res, err := run(t, &fakeCaller{outputs: []string{validOutput}}, "剧本")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	shots, err := storyboard.DecodeShots(res.Output)
	if err != nil {
		t.Fatalf("DecodeShots: %v", err)
	}
	if len(shots) != 2 || shots[1].Shot != "特写" || shots[1].Camera != "甩镜" || shots[1].Duration != 2.5 || shots[1].Dialogue != "OS：那猹却将身一扭" {
		t.Fatalf("镜头不对：%+v", shots)
	}
}

// TestSplitRewritesOnInvalidOutput 景别不在枚举里、画面为空时带原因重写一次；重写后合格就成功。
func TestSplitRewritesOnInvalidOutput(t *testing.T) {
	bad := `{"shots":[{"scene":"  ","shot":"超大特写","camera":"推","action":"","dialogue":"","duration":3}]}`
	c := &fakeCaller{outputs: []string{bad, validOutput}}
	res, err := run(t, c, "剧本")
	if err != nil {
		t.Fatalf("重写后应成功：%v", err)
	}
	if res.Attempts != 2 || len(c.prompts) != 2 {
		t.Fatalf("应调用两次，实际 %d", res.Attempts)
	}
	if !strings.Contains(c.prompts[1], "上次输出没有通过校验") {
		t.Error("第二次提示词要带上校验原因")
	}
}

// TestSplitFailsWhenStillInvalid 两次都不合格时报输出不合格。
func TestSplitFailsWhenStillInvalid(t *testing.T) {
	bad := `{"shots":[]}`
	_, err := run(t, &fakeCaller{outputs: []string{bad, bad}}, "剧本")
	if !errors.Is(err, stepkit.ErrOutputInvalid) {
		t.Fatalf("应是输出不合格，实际 %v", err)
	}
}

// TestDecodeShotsNormalizes 解码时时长截断到 1–60 秒、保留 1 位小数，文字去首尾空白并截到上限。
func TestDecodeShotsNormalizes(t *testing.T) {
	long := strings.Repeat("长", 1200)
	raw, _ := json.Marshal(map[string]any{"shots": []map[string]any{
		{"scene": "  开门  ", "shot": "中景", "camera": "固定", "action": long, "dialogue": "", "duration": 0.2},
		{"scene": "关门", "shot": "近景", "camera": "推", "action": "", "dialogue": "", "duration": 75},
		{"scene": "回头", "shot": "近景", "camera": "推", "action": "", "dialogue": "", "duration": 2.46},
	}})
	shots, err := storyboard.DecodeShots(raw)
	if err != nil {
		t.Fatalf("DecodeShots: %v", err)
	}
	if shots[0].Scene != "开门" || shots[0].Duration != 1 || utf8.RuneCountInString(shots[0].Action) != storyboard.ShotTextMax {
		t.Errorf("第 1 镜没规整：%+v", shots[0])
	}
	if shots[1].Duration != 60 || shots[2].Duration != 2.5 {
		t.Errorf("时长没截断：%v %v", shots[1].Duration, shots[2].Duration)
	}
}

// TestSplitSamples 三个样例剧本：对白戏、动作戏、旁白蒙太奇，各有足够的篇幅用来调提示词。
func TestSplitSamples(t *testing.T) {
	samples := storyboard.SplitSamples()
	if len(samples) != 3 {
		t.Fatalf("应有 3 个样例，实际 %d", len(samples))
	}
	for _, s := range samples {
		if s.Name == "" || utf8.RuneCountInString(s.Script) < 200 {
			t.Errorf("样例 %q 太短（%d 字）", s.Name, utf8.RuneCountInString(s.Script))
		}
		// 每个样例都能拼出提示词
		if _, err := stepkit.BuildPrompt(storyboard.SplitStep(), stepkit.BuiltinMethod(storyboard.SplitStep()), storyboard.SplitInput(s.Script), nil); err != nil {
			t.Errorf("样例 %q 拼提示词失败：%v", s.Name, err)
		}
	}
}
