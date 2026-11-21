package service_test

import (
	"context"
	"strings"
	"testing"

	"video-canvas/internal/model"
)

// 分集规划是两次模型调用：创作段写完后要上报进度，不能等整批结束才从 0% 跳到完成。
func TestDramaPlanReportsProgressBetweenCalls(t *testing.T) {
	r := newDramaMemory()
	source := "第1章 开始\n" + strings.Repeat("必须保留全文。", 2000) + "\n第2章 结尾\n最后一段原文。"
	seedDramaDraft(r, source)
	e := &dramaTextStreamer{outputs: []string{
		`{"source_kind":"script","summary":"梗概","characters_md":"人物","outline_md":"后文为抽样推断"}`,
		"分集目录草稿",
		`{"episodes":[{"title":"开始","synopsis":"梗概","hook":"钩子","cliffhanger":"悬念","unit_from":1,"unit_to":3}]}`,
	}}
	s, _ := dramaTestService(r, e, nil)
	v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", Ratio: "9:16", StyleKey: "custom", StyleCustom: "写实"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(context.Background(), 7, uint64(v.ID), r.jobs[0].ID); err != nil {
		t.Fatal(err)
	}
	if len(r.jobs) != 2 || r.jobs[1].Step != "plan" {
		t.Fatalf("%+v", r.jobs)
	}
	var seen []int
	e.onCall = func() { seen = append(seen, r.jobs[1].Progress) }
	if err = s.HandleDrama(context.Background(), 7, uint64(v.ID), r.jobs[1].ID); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 2 || seen[1] < 50 {
		t.Fatalf("格式段开始前应已上报至少 50%%，实际每次调用前进度：%v", seen)
	}
	if r.jobs[1].Status != "succeeded" {
		t.Fatalf("job=%+v", r.jobs[1])
	}
}
