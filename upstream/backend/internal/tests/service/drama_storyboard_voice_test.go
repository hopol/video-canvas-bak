package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/provider"
	"video-canvas/internal/provider/modelcfg"
)

// 三个配了声音的角色、一个没配声音的角色和一个场景。
const voiceCanvas = `{"nodes":[
{"id":"n_a","data":{"drama":{"type":"character","name":"阿禾","look":"","episodes":[]},"character":{"voice":{"mode":"audio","assetId":"11","src":"a.mp3","origin":"upload"}}}},
{"id":"n_b","data":{"drama":{"type":"character","name":"陈主簿","look":"","episodes":[]},"character":{"voice":{"mode":"audio","assetId":"12","src":"b.mp3","origin":"upload"}}}},
{"id":"n_c","data":{"drama":{"type":"character","name":"百姓甲","look":"","episodes":[]},"character":{"voice":{"mode":"audio","assetId":"13","src":"c.mp3","origin":"upload"}}}},
{"id":"n_d","data":{"drama":{"type":"character","name":"百姓乙","look":"","episodes":[]},"character":{"voice":null}}},
{"id":"n_scene","data":{"drama":{"type":"scene","name":"村口","look":"","episodes":[]}}}]}`

// 登记参考音频上限不同的视频模型：vid 收 3 个，vid2 收 2 个，mute 不收音频。
func voiceRegistry(registry *dramaRegistry) {
	dramaModelRegistry(registry, nil)
	audio := func(key string, spec modelcfg.RefSpec) *provider.Snapshot {
		snap := &provider.Snapshot{ModelRevisionID: 30, Model: provider.ModelSnapshot{Key: key, Kind: "video"}}
		snap.Model.Capabilities.Refs.Audio = spec
		return snap
	}
	registry.snaps["vid"] = audio("vid", modelcfg.RefSpec{On: true, Max: 3})
	registry.snaps["vid2"] = audio("vid2", modelcfg.RefSpec{On: true, Max: 2})
	registry.snaps["mute"] = audio("mute", modelcfg.RefSpec{Max: 5})
}

func voiceStoryboardRequest(t *testing.T, videoModel string) *model.DramaJobReq {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"step": "storyboard", "episodes": []int{1}, "video_model": videoModel})
	var req model.DramaJobReq
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatal(err)
	}
	return &req
}

// 参考音频上限按片场当前选的视频模型取；没传时用项目视频模型；模型不收音频时不限。
func TestDramaStoryboardAudioLimitFromVideoModel(t *testing.T) {
	for _, tc := range []struct {
		name, project, request string
		want                   int
	}{
		{"项目视频模型", "vid", "", 3},
		{"请求的模型优先", "vid", "vid2", 2},
		{"模型不收音频不限", "vid", "mute", 0},
		{"没有视频模型不限", "", "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newDramaMemory()
			storyboardReady(r)
			r.project.VideoModel = tc.project
			s, registry := dramaTestService(r, &dramaTextStreamer{}, nil)
			voiceRegistry(registry)
			req := voiceStoryboardRequest(t, tc.request)
			if _, err := s.Estimate(context.Background(), 7, 1, req); err != nil {
				t.Fatal(err)
			}
			if _, err := s.CreateJob(context.Background(), 7, 1, req); err != nil {
				t.Fatal(err)
			}
			var input struct {
				MaxAudios int `json:"max_audios"`
			}
			if err := json.Unmarshal(r.jobs[0].InputJSON, &input); err != nil || input.MaxAudios != tc.want {
				t.Fatalf("input=%s err=%v want %d", r.jobs[0].InputJSON, err, tc.want)
			}
		})
	}
}

// 请求的视频模型同样决定时长上限；停用或不是视频模型时拒绝，不悄悄换成别的模型切段。
func TestDramaStoryboardRequestVideoModel(t *testing.T) {
	t.Run("时长跟随请求的模型", func(t *testing.T) {
		r := newDramaMemory()
		storyboardReady(r)
		s, registry := dramaTestService(r, &dramaTextStreamer{}, nil)
		voiceRegistry(registry)
		registry.snaps["vid2"].Model.Capabilities.Params = modelcfg.ParamSet{{Name: "duration", ParamField: modelcfg.ParamField{Type: modelcfg.ParamNumber, Max: intPtr(10)}}}
		if _, err := s.CreateJob(context.Background(), 7, 1, voiceStoryboardRequest(t, "vid2")); err != nil {
			t.Fatal(err)
		}
		var input struct {
			MaxSeconds int `json:"max_seconds"`
		}
		if err := json.Unmarshal(r.jobs[0].InputJSON, &input); err != nil || input.MaxSeconds != 10 {
			t.Fatalf("input=%s", r.jobs[0].InputJSON)
		}
	})
	for _, key := range []string{"off", "img"} {
		t.Run("拒绝"+key, func(t *testing.T) {
			r := newDramaMemory()
			storyboardReady(r)
			s, registry := dramaTestService(r, &dramaTextStreamer{}, nil)
			voiceRegistry(registry)
			req := voiceStoryboardRequest(t, key)
			_, err := s.Estimate(context.Background(), 7, 1, req)
			dramaCheckCode(t, err, 10001)
			_, err = s.CreateJob(context.Background(), 7, 1, req)
			dramaCheckCode(t, err, 10001)
			if len(r.jobs) != 0 {
				t.Fatalf("拒绝仍建了任务: %+v", r.jobs)
			}
		})
	}
}

// 格式段拿到参考音频上限和每个资产是否有声音；一段里有声角色超限时只重试格式段。
func TestDramaStoryboardSplitsByAudioLimit(t *testing.T) {
	over := `{"segments":[{"seconds":10,"prompt":"@[阿禾](n_a) @[陈主簿](n_b) @[百姓甲](n_c) @[百姓乙](n_d)"}]}`
	split := `{"segments":[{"seconds":5,"prompt":"@[阿禾](n_a) @[陈主簿](n_b) @[百姓乙](n_d)"},{"seconds":5,"prompt":"@[百姓甲](n_c) @[阿禾](n_a)"}]}`
	r := newDramaMemory()
	storyboardReady(r)
	r.canvas = []byte(voiceCanvas)
	e := &dramaTextStreamer{outputs: []string{storyboardDraft, over, split}}
	s, registry := dramaTestService(r, e, nil)
	voiceRegistry(registry)
	job, err := s.CreateJob(context.Background(), 7, 1, voiceStoryboardRequest(t, "vid2"))
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(context.Background(), 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if r.jobs[0].Status != "succeeded" || e.calls != 3 || len(r.segments) != 2 {
		t.Fatalf("job=%+v calls=%d segments=%+v", r.jobs[0], e.calls, r.segments)
	}
	for _, prompt := range e.prompts {
		if !strings.Contains(prompt, `"max_audios":2`) {
			t.Fatalf("提示词缺少参考音频上限: %s", prompt)
		}
		if !strings.Contains(prompt, `"node_id":"n_a","type":"character","name":"阿禾","look":"","prompt_summary":"","has_voice":true`) ||
			!strings.Contains(prompt, `"node_id":"n_d","type":"character","name":"百姓乙","look":"","prompt_summary":"","has_voice":false`) {
			t.Fatalf("资产缺少声音标记: %s", prompt)
		}
	}
	if !strings.Contains(e.prompts[2], "validation_error") {
		t.Fatalf("重试应带上校验反馈: %s", e.prompts[2])
	}
}
