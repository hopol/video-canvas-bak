package prompts_test

import (
	"strings"
	"testing"

	"video-canvas/internal/agent/prompts"
)

// TestSystem_KnowsStoryboard 系统提示词介绍分镜表节点和按镜号改镜头的写法，不再说「还没有分镜表节点」。
func TestSystem_KnowsStoryboard(t *testing.T) {
	sys := prompts.System("all")
	for _, word := range []string{"分镜表（storyboard）", "storyboard 字段", "edits 按镜号改", "不要用文本节点或分组代替"} {
		if !strings.Contains(sys, word) {
			t.Errorf("系统提示词缺少 %q", word)
		}
	}
	if strings.Contains(sys, "暂时不能连出去") {
		t.Error("分镜表已经能连到图片、视频节点，提示词不能再说不能连出去")
	}
	for _, line := range strings.Split(sys, "\n") {
		if strings.Contains(line, "还没有这些") && strings.Contains(line, "分镜表") {
			t.Errorf("不能再把分镜表列为没有的功能：%s", line)
		}
	}
}
