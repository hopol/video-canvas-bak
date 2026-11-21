package plugin_test

import (
	"context"
	"maps"
	"testing"

	"video-canvas/internal/provider"
	"video-canvas/internal/provider/pluginmeta"
)

// 三个 OpenAI 协议插件（文本 / 图片 / 对话生图）都声明协议设置 pathPrefix：接口路径里的版本段，默认 /v1。
func TestOpenAIPluginsDeclarePathPrefix(t *testing.T) {
	schemas := map[string]pluginmeta.SettingSchema{
		"openai":            newOpenAIEnv(t, nil).meta.ChannelSettings,
		"openai-image":      newOpenAIImageEnv(t).meta.ChannelSettings,
		"openai-chat-image": newOpenAIChatImageEnv(t).meta.ChannelSettings,
	}
	for key, schema := range schemas {
		s, ok := schema.Get("pathPrefix")
		if !ok || s.Type != pluginmeta.SettingString || s.Default != "/v1" {
			t.Fatalf("%s 应声明 string 类型、默认 /v1 的 pathPrefix：%+v（已声明=%v）", key, s, ok)
		}
	}
}

// 路径前缀的各种写法都归一成同一个形状：没填 / 空白是 /v1，"/" 是不加前缀，缺前导斜杠补上，末尾斜杠去掉。
func TestOpenAIPathPrefixNormalize(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]any
		want     string
	}{
		{"没有设置项", nil, "/v1/chat/completions"},
		{"空串按默认", map[string]any{"pathPrefix": ""}, "/v1/chat/completions"},
		{"纯空白按默认", map[string]any{"pathPrefix": "  "}, "/v1/chat/completions"},
		{"显式 /v1", map[string]any{"pathPrefix": "/v1"}, "/v1/chat/completions"},
		{"换成 /v4", map[string]any{"pathPrefix": "/v4"}, "/v4/chat/completions"},
		{"缺前导斜杠", map[string]any{"pathPrefix": "v4"}, "/v4/chat/completions"},
		{"带末尾斜杠", map[string]any{"pathPrefix": "/v4/"}, "/v4/chat/completions"},
		{"多段前缀", map[string]any{"pathPrefix": "/compatible-mode/v1"}, "/compatible-mode/v1/chat/completions"},
		{"斜杠表示不加前缀", map[string]any{"pathPrefix": "/"}, "/chat/completions"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			up, srv := openaiUpstream(0, `{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}]}`)
			defer srv.Close()
			env := newOpenAIEnv(t, nil)
			snap := env.snapshot(srv.URL, "chat_completions", promptCaps)
			maps.Copy(snap.Channel.Settings, tc.settings)
			if _, err := openaiSubmit(t, env, snap, map[string]any{"prompt": "hi"}); err != nil {
				t.Fatal(err)
			}
			if got := up.last().Path; got != tc.want {
				t.Fatalf("路径应为 %s，实际 %s", tc.want, got)
			}
		})
	}
}

// 文本插件：Responses、Chat、连通检查、导入都按前缀走；base_url 自带的路径前缀会保留在最前面。
func TestOpenAITextPathPrefix(t *testing.T) {
	env := newOpenAIEnv(t, nil)
	with := func(srvURL, api string, settings map[string]any) *provider.Snapshot {
		snap := env.snapshot(srvURL, api, promptCaps)
		if snap.Channel.Settings == nil {
			snap.Channel.Settings = map[string]any{}
		}
		maps.Copy(snap.Channel.Settings, settings)
		return snap
	}

	up, srv := openaiUpstream(0, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}`)
	defer srv.Close()
	if _, err := openaiSubmit(t, env, with(srv.URL, "", map[string]any{"pathPrefix": "/v4"}), map[string]any{"prompt": "x"}); err != nil {
		t.Fatal(err)
	}
	if got := up.last().Path; got != "/v4/responses" {
		t.Fatalf("Responses 应走 /v4/responses：%s", got)
	}

	// base_url 自带 /api/paas，再加前缀 /v4
	chatUp, chatSrv := openaiUpstream(0, `{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}]}`)
	defer chatSrv.Close()
	if _, err := openaiSubmit(t, env, with(chatSrv.URL+"/api/paas", "chat_completions", map[string]any{"pathPrefix": "/v4"}), map[string]any{"prompt": "x"}); err != nil {
		t.Fatal(err)
	}
	if got := chatUp.last().Path; got != "/api/paas/v4/chat/completions" {
		t.Fatalf("应保留 base_url 路径并拼前缀：%s", got)
	}

	// 连通检查与导入同样按前缀
	listUp, listSrv := openaiUpstream(0, `{"object":"list","data":[{"id":"gpt-4o"}]}`)
	defer listSrv.Close()
	snap := with(listSrv.URL, "", map[string]any{"pathPrefix": "/v4"})
	if res, err := env.exec.Check(context.Background(), snap.Runtime()); err != nil || res == nil || !res.OK {
		t.Fatalf("检查应成功：%+v %v", res, err)
	}
	if got := listUp.last().Path; got != "/v4/models" {
		t.Fatalf("连通检查应走 /v4/models：%s", got)
	}
	if _, err := env.exec.Import(context.Background(), snap.Runtime(), map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if got := listUp.last().Path; got != "/v4/models" {
		t.Fatalf("导入应走 /v4/models：%s", got)
	}
}

// 图片插件：文生图、编辑（multipart）、连通检查、导入都按前缀走。
func TestOpenAIImagePathPrefix(t *testing.T) {
	srv, up := openaiimageServer(t, 0, openaiimageOK)
	env := newOpenAIImageEnv(t)
	submit := func(prefix string, input map[string]any) {
		t.Helper()
		snap := env.snapshot(srv.URL, "gpt-image-1")
		snap.Channel.Settings = map[string]any{"pathPrefix": prefix}
		if _, err := env.exec.Submit(context.Background(), snap, provider.SubmitInput{Task: provider.TaskRef{ID: 2, UserID: 9}, Input: input}); err != nil {
			t.Fatal(err)
		}
	}
	submit("/v3", map[string]any{"prompt": "猫"})
	if got := up.last().Path; got != "/v3/images/generations" {
		t.Fatalf("文生图应走 /v3/images/generations：%s", got)
	}
	submit("/v3", map[string]any{"prompt": "夜景", "op": "i2i", "images": []uint64{1}})
	if got := up.last().Path; got != "/v3/images/edits" {
		t.Fatalf("编辑应走 /v3/images/edits：%s", got)
	}
	submit("/", map[string]any{"prompt": "猫"})
	if got := up.last().Path; got != "/images/generations" {
		t.Fatalf("斜杠应不加前缀：%s", got)
	}

	listSrv, listUp := openaiimageServer(t, 0, `{"object":"list","data":[{"id":"gpt-image-1"}]}`)
	snap := env.snapshot(listSrv.URL, "gpt-image-1")
	snap.Channel.Settings = map[string]any{"pathPrefix": "/v3"}
	if res, err := env.exec.Check(context.Background(), snap.Runtime()); err != nil || res == nil || !res.OK {
		t.Fatalf("检查应成功：%+v %v", res, err)
	}
	if got := listUp.last().Path; got != "/v3/models" {
		t.Fatalf("连通检查应走 /v3/models：%s", got)
	}
	if _, err := env.exec.Import(context.Background(), snap.Runtime(), map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if got := listUp.last().Path; got != "/v3/models" {
		t.Fatalf("导入应走 /v3/models：%s", got)
	}
}

// 对话生图插件：提交、连通检查、导入都按前缀走。
func TestOpenAIChatImagePathPrefix(t *testing.T) {
	srv, up := openaichatimageServer(t, 0, chatBody(`{"content":"![i](https://cdn.example.com/a.png)"}`))
	env := newOpenAIChatImageEnv(t)
	snap := env.snapshot(srv.URL, "nano-banana-2.1")
	snap.Channel.Settings = map[string]any{"pathPrefix": "/v1beta/openai"}
	if _, err := env.exec.Submit(context.Background(), snap, provider.SubmitInput{Task: provider.TaskRef{ID: 2, UserID: 9}, Input: map[string]any{"prompt": "猫"}}); err != nil {
		t.Fatal(err)
	}
	if got := up.last().Path; got != "/v1beta/openai/chat/completions" {
		t.Fatalf("提交应走 /v1beta/openai/chat/completions：%s", got)
	}

	listSrv, listUp := openaichatimageServer(t, 0, `{"object":"list","data":[{"id":"nano-banana-2.1"}]}`)
	snap = env.snapshot(listSrv.URL, "nano-banana-2.1")
	snap.Channel.Settings = map[string]any{"pathPrefix": "/v1beta/openai"}
	if res, err := env.exec.Check(context.Background(), snap.Runtime()); err != nil || res == nil || !res.OK {
		t.Fatalf("检查应成功：%+v %v", res, err)
	}
	if got := listUp.last().Path; got != "/v1beta/openai/models" {
		t.Fatalf("连通检查应走 /v1beta/openai/models：%s", got)
	}
	if _, err := env.exec.Import(context.Background(), snap.Runtime(), map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if got := listUp.last().Path; got != "/v1beta/openai/models" {
		t.Fatalf("导入应走 /v1beta/openai/models：%s", got)
	}
}
