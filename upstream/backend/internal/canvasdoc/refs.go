package canvasdoc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

// 本文件集中登记画布内容（payload_json）里引用原环境素材的位置。
// 以后给节点新增引用素材的字段，必须同时改这里的 assetIDRefs 和 export.go 的改写，
// 否则原账号的素材 ID 会泄进导出文件（设计 §8.4）。

// Refs 是一张画布内容引用到的素材，去重并按首次出现的顺序排列。
// 角色数据内嵌在节点里（data.character），它引用的素材也算在这里。
type Refs struct {
	// AssetIDs 是素材 ID（十进制字符串）。
	AssetIDs []string
}

// payload 是画布内容里导出关心的部分；viewport 等其余顶层字段不读，也就不会进导出文件。
type payload struct {
	Nodes []map[string]any `json:"nodes"`
	Edges []map[string]any `json:"edges"`
}

// decodePayload 解析画布内容。用 UseNumber 让数字保持原样，createdAt 这类毫秒时间戳重新序列化后不变。
func decodePayload(raw []byte) (*payload, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var p payload
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("解析画布内容: %w", err)
	}
	return &p, nil
}

// CollectRefs 找出画布内容里所有会被导出的素材 ID，供调用方在 Build 之前查出素材哈希。
//
// 素材 ID 取自 data.assetId、选中那一版产物的 assetId（其余版本不导出，不收集）、
// data.params.images / videos / audios 的每一项、data.paramAssets 的键、data.scene.thumb.assetId，
// 角色节点内嵌的 data.character.extras[].assetId 和（mode=audio 的）data.character.voice.assetId，
// 以及分镜表手传的分镜图 data.storyboard.shots[].image.assetId。
func CollectRefs(raw []byte) (Refs, error) {
	p, err := decodePayload(raw)
	if err != nil {
		return Refs{}, err
	}
	var refs Refs
	seenAsset := map[string]bool{}
	for _, node := range p.Nodes {
		data, _ := node["data"].(map[string]any)
		for _, id := range assetIDRefs(data) {
			if !seenAsset[id] {
				seenAsset[id] = true
				refs.AssetIDs = append(refs.AssetIDs, id)
			}
		}
	}
	return refs, nil
}

// assetIDRefs 取出一个节点 data 里会被导出的素材 ID（含重复），顺序与 CollectRefs 的说明一致。
func assetIDRefs(data map[string]any) []string {
	if data == nil {
		return nil
	}
	var ids []string
	ids = appendAssetID(ids, data["assetId"])
	if out := keptOutput(data); out != nil {
		ids = appendAssetID(ids, out["assetId"])
	}
	params, _ := data["params"].(map[string]any)
	for _, key := range mediaParamKeys {
		list, _ := params[key].([]any)
		for _, v := range list {
			ids = appendAssetID(ids, v)
		}
	}
	paramAssets, _ := data["paramAssets"].(map[string]any)
	ids = append(ids, sortedKeys(paramAssets)...)
	scene, _ := data["scene"].(map[string]any)
	thumb, _ := scene["thumb"].(map[string]any)
	ids = appendAssetID(ids, thumb["assetId"])
	ids = append(ids, characterAssetIDs(data)...)
	return append(ids, storyboardAssetIDs(data)...)
}

// storyboardShots 取出分镜表节点的镜头列表（只认对象项）；字段类型错乱时返回 nil，调用方照常往下走而不是 panic。
func storyboardShots(data map[string]any) []map[string]any {
	storyboard, _ := data["storyboard"].(map[string]any)
	list, _ := storyboard["shots"].([]any)
	var shots []map[string]any
	for _, v := range list {
		if m, ok := v.(map[string]any); ok {
			shots = append(shots, m)
		}
	}
	return shots
}

// storyboardAssetIDs 取出分镜表节点里手动上传的分镜图 storyboard.shots[].image.assetId。
// 行上关联的 imageNodeId / videoNodeId 是画布内部的节点 id，不是素材，不在这里。
func storyboardAssetIDs(data map[string]any) []string {
	var ids []string
	for _, shot := range storyboardShots(data) {
		if image, ok := shot["image"].(map[string]any); ok {
			ids = appendAssetID(ids, image["assetId"])
		}
	}
	return ids
}

// characterAssetIDs 取出角色节点内嵌的素材 ID：补充图 character.extras[].assetId，
// 以及音频音色 character.voice.assetId（只有 mode=audio 才是素材引用，文本音色没有）。
// 主图沿用 data.assetId，不在这里。
func characterAssetIDs(data map[string]any) []string {
	character, _ := data["character"].(map[string]any)
	var ids []string
	extras, _ := character["extras"].([]any)
	for _, e := range extras {
		if m, ok := e.(map[string]any); ok {
			ids = appendAssetID(ids, m["assetId"])
		}
	}
	if voice, ok := character["voice"].(map[string]any); ok && voice["mode"] == voiceModeAudio {
		ids = appendAssetID(ids, voice["assetId"])
	}
	return ids
}

// voiceModeAudio 是 character.voice.mode 表示音频音色的取值。
const voiceModeAudio = "audio"

// mediaParamKeys 是 data.params 里存素材 ID 数组的参数名。
var mediaParamKeys = []string{"images", "videos", "audios"}

// keptOutput 返回导出时要保留的那一版产物：id 等于 activeOutputId 的那项；
// 找不到（选中版缺失或没记 activeOutputId）时保留最后一版，因为 outputs 旧的在前、最后一版最新。
// 没有产物返回 nil。
func keptOutput(data map[string]any) map[string]any {
	outputs, _ := data["outputs"].([]any)
	var last map[string]any
	for _, o := range outputs {
		m, ok := o.(map[string]any)
		if !ok {
			continue
		}
		if active, ok := data["activeOutputId"].(string); ok && m["id"] == active {
			return m
		}
		last = m
	}
	return last
}

// assetIDOf 把一个素材 ID 值规整成字符串：前端存的是十进制字符串，偶尔会是 JSON 数字。
func assetIDOf(v any) (string, bool) {
	switch id := v.(type) {
	case string:
		return id, id != ""
	case json.Number:
		return id.String(), true
	default:
		return "", false
	}
}

// appendAssetID 在 v 是素材 ID 时把它追加到 ids，否则原样返回。
func appendAssetID(ids []string, v any) []string {
	if id, ok := assetIDOf(v); ok {
		return append(ids, id)
	}
	return ids
}

// sortedKeys 返回 m 的键并排序，让结果不随 map 遍历顺序变化。
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
