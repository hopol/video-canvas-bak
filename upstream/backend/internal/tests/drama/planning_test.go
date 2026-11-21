package drama_test

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"video-canvas/internal/drama"
)

func TestPlanCoverageRejectsGapsAndBacktracking(t *testing.T) {
	for _, tc := range []struct {
		ranges [][2]int
		valid  bool
	}{
		{[][2]int{{1, 2}, {2, 3}}, true},
		{[][2]int{{1, 1}, {3, 3}}, false},
		{[][2]int{{1, 2}, {1, 3}}, false},
		{[][2]int{{1, 2}}, false},
		{[][2]int{{1, 4}}, false},
	} {
		out := drama.PlanOutput{}
		for _, r := range tc.ranges {
			out.Episodes = append(out.Episodes, drama.PlanEpisode{Title: "题", Synopsis: "梗概", Hook: "钩", Cliffhanger: "悬念", UnitFrom: r[0], UnitTo: r[1]})
		}
		if err := out.ValidateCoverage(1, 3); (err == nil) != tc.valid {
			t.Fatalf("%v: %v", tc.ranges, err)
		}
	}
}

func TestKnownCastTruncationAndCharacterPriority(t *testing.T) {
	nodes := []any{}
	for i := 0; i < 1000; i++ {
		nodes = append(nodes, map[string]any{"data": map[string]any{"drama": map[string]any{"type": "scene", "name": strings.Repeat("景", 64), "episodes": []int{1}}, "description": strings.Repeat("描", 200)}})
	}
	nodes = append(nodes, map[string]any{"data": map[string]any{"drama": map[string]any{"type": "character", "name": "主角", "aliases": []string{"小名"}, "episodes": []int{2}}, "character": map[string]any{"description": strings.Repeat("字", 200)}}})
	raw, _ := json.Marshal(map[string]any{"nodes": nodes})
	entries, err := drama.KnownCast(raw, 2)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(entries)
	if utf8.RuneCount(encoded) > 12000 || !strings.Contains(string(encoded), "主角") {
		t.Fatalf("预算或优先级错误: %d", utf8.RuneCount(encoded))
	}
	for _, e := range entries {
		if utf8.RuneCountInString(e.Desc) > 80 {
			t.Fatal("描述超过80字")
		}
	}
}

func TestKnownCastKeepsGlobalAssetDescription(t *testing.T) {
	entries, err := drama.KnownCast([]byte(`{"nodes":[{"data":{"drama":{"type":"scene","name":"街道","episodes":[],"description":"全剧使用的石板街道"}}}]}`), 100)
	if err != nil || len(entries) != 1 || entries[0].Desc == "" {
		t.Fatalf("全集资产属于近期范围: %+v %v", entries, err)
	}
}

func TestScriptBatchesKeepOversizeEpisodeWhole(t *testing.T) {
	units := []drama.Unit{}
	for i := 0; i < 25; i++ {
		units = append(units, drama.Unit{No: i + 1, Chars: 1000, Text: strings.Repeat("字", 1000)})
	}
	units[1].Text = strings.Repeat("长", 40001)
	units[1].Chars = 40001
	batches := drama.ScriptBatches(units, 30000)
	if len(batches) < 4 || len(batches[1]) != 1 || batches[1][0].Chars != 40001 {
		t.Fatalf("长集不得拆开: %v", len(batches))
	}
	count := 0
	for _, batch := range batches {
		if len(batch) > 12 {
			t.Fatal("批次超过12集")
		}
		count += len(batch)
	}
	if count != 25 {
		t.Fatal("丢集")
	}
}

func TestScriptBatchesFollowBudget(t *testing.T) {
	units := []drama.Unit{}
	for i := 0; i < 10; i++ {
		units = append(units, drama.Unit{No: i + 1, Chars: 2000})
	}
	units[4].Chars = 9000
	batches := drama.ScriptBatches(units, 5000)
	for _, batch := range batches {
		total := 0
		for _, u := range batch {
			total += u.Chars
		}
		if total > 5000 && len(batch) > 1 {
			t.Fatalf("多集的一批超过预算: %d", total)
		}
	}
	if len(batches) != 6 {
		t.Fatalf("预算 5000 时应分 6 批，实际 %d", len(batches))
	}
}

func TestLongestUnitCountsTitle(t *testing.T) {
	units := []drama.Unit{{No: 1, Title: "第1章", Chars: 100}, {No: 2, Title: "第2章 长", Chars: 5000}, {No: 3, Title: "第3章", Chars: 300}}
	u, n := drama.LongestUnit(units)
	if u.No != 2 || n != 5000+len([]rune("## [2] 第2章 长\n\n")) {
		t.Fatalf("最长一章算错: %d %d", u.No, n)
	}
	if _, n = drama.LongestUnit(nil); n != 0 {
		t.Fatal("空列表应为 0")
	}
}
