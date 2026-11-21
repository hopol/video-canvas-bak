package llmgateway

import (
	"encoding/json"
	"fmt"
	"strings"
)

// chatEndpoint 是 OpenAI 格式请求路径里版本段之后的部分；版本段默认 /v1（渠道的 base_url 不含 /v1），可由 Target.PathPrefix 改。
const chatEndpoint = "/chat/completions"

// defaultPathPrefix 是没配路径前缀时的版本段。
const defaultPathPrefix = "/v1"

// normalizePathPrefix 整理路径前缀：空白等于默认 /v1；"/" 表示不加前缀（返回空串）；缺前导斜杠补上，末尾斜杠去掉。
func normalizePathPrefix(prefix string) string {
	p := strings.TrimSpace(prefix)
	if p == "" {
		return defaultPathPrefix
	}
	p = strings.TrimRight(p, "/")
	if p != "" && !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

// BuildBody 生成翻译前的请求体：流式并带用量；用于网关出站和媒体脱敏留存。
// 视频用宿主内部分段表示，仅 Gemini 翻译支持，不能发给 OpenAI 渠道。
func BuildBody(tg Target, req Request) ([]byte, error) {
	msgs := make([]any, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, map[string]any{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		for _, p := range m.Parts {
			if p.Video != nil && tg.Format != FormatGemini {
				return nil, fmt.Errorf("%w: 当前接口格式不支持视频输入", ErrInvalidRequest)
			}
		}
		msgs = append(msgs, messageJSON(m))
	}
	body := map[string]any{
		"model":          tg.UpstreamModel,
		"messages":       msgs,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
	}
	if len(req.Tools) > 0 {
		tools := make([]any, len(req.Tools))
		for i, t := range req.Tools {
			params := t.Parameters
			if len(params) == 0 {
				params = json.RawMessage(`{"type":"object","properties":{}}`)
			}
			tools[i] = map[string]any{"type": "function", "function": map[string]any{
				"name": t.Name, "description": t.Description, "parameters": params,
			}}
		}
		body["tools"] = tools
	}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	return json.Marshal(body)
}

// messageJSON 把一条消息转成请求体里的形状。
func messageJSON(m Message) map[string]any {
	out := map[string]any{"role": m.Role}
	switch {
	case len(m.Parts) > 0:
		parts := make([]any, 0, len(m.Parts))
		for _, p := range m.Parts {
			if p.Video != nil {
				parts = append(parts, map[string]any{"type": "video", "video": p.Video})
			} else if p.ImageURL != "" {
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": p.ImageURL}})
			} else {
				parts = append(parts, map[string]any{"type": "text", "text": p.Text})
			}
		}
		out["content"] = parts
	case m.Role == RoleAssistant && len(m.ToolCalls) > 0 && m.Text == "":
		out["content"] = nil // 只有工具调用没有文字时，部分上游要求 content 为 null
	default:
		out["content"] = m.Text
	}
	if len(m.ToolCalls) > 0 {
		calls := make([]any, len(m.ToolCalls))
		for i, c := range m.ToolCalls {
			calls[i] = map[string]any{"id": c.ID, "type": "function", "function": map[string]any{"name": c.Name, "arguments": c.Arguments}}
		}
		out["tool_calls"] = calls
	}
	if m.ToolCallID != "" {
		out["tool_call_id"] = m.ToolCallID
	}
	return out
}
