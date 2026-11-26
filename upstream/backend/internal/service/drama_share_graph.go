package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
)

type sharedAsset struct {
	original uint64
	asset    *model.Asset
	url      string
}
type shareGraph struct {
	assets   map[uint64]*sharedAsset
	segments map[string]string
}

func (g *shareGraph) ref(value any) *sharedAsset {
	id, _ := strconv.ParseUint(fmt.Sprint(value), 10, 64)
	if id == 0 {
		return nil
	}
	if g.assets[id] == nil {
		g.assets[id] = &sharedAsset{original: id}
	}
	return g.assets[id]
}

func (g *shareGraph) rewriteObject(obj map[string]any) {
	for _, key := range []string{"pendingTaskIds", "taskId", "errorTaskRef", "voiceTaskId", "voiceAfterImage"} {
		delete(obj, key)
	}
	for _, key := range []string{"assetId", "coverAssetId", "activeOutputId"} {
		ref := g.ref(obj[key])
		if ref == nil || ref.asset == nil {
			continue
		}
		next := strconv.FormatUint(ref.asset.ID, 10)
		obj[key] = next
		if key != "assetId" {
			continue
		}
		if fmt.Sprint(obj["id"]) == strconv.FormatUint(ref.original, 10) {
			obj["id"] = next
		}
		for _, field := range []string{"url", "src"} {
			if _, ok := obj[field]; ok {
				obj[field] = ref.url
			}
		}
	}
	g.rewriteOutputRefs(obj)
	if next, ok := g.segments[fmt.Sprint(obj["segmentId"])]; ok {
		obj["segmentId"] = next
	}
	g.rewriteParams(obj)
	for _, value := range obj {
		g.walk(value)
	}
}

func (g *shareGraph) rewriteOutputRefs(obj map[string]any) {
	outputs, _ := obj["outputs"].([]any)
	for _, value := range outputs {
		output, _ := value.(map[string]any)
		if output == nil {
			continue
		}
		ref := g.ref(output["assetId"])
		if ref == nil {
			continue
		}
		if ref.asset != nil {
			output["id"] = strconv.FormatUint(ref.asset.ID, 10)
		}
	}
}

func (g *shareGraph) rewriteParams(obj map[string]any) {
	params, _ := obj["params"].(map[string]any)
	for _, key := range []string{"images", "videos", "audios"} {
		items, _ := params[key].([]any)
		for index, value := range items {
			if ref := g.ref(value); ref != nil && ref.asset != nil {
				items[index] = strconv.FormatUint(ref.asset.ID, 10)
			}
		}
	}
	entries, ok := obj["paramAssets"].(map[string]any)
	if !ok {
		return
	}
	mapped := map[string]any{}
	for key, value := range entries {
		ref := g.ref(key)
		if ref != nil && ref.asset != nil {
			key = strconv.FormatUint(ref.asset.ID, 10)
			if meta, ok := value.(map[string]any); ok {
				meta["url"] = ref.url
			}
		}
		mapped[key] = value
	}
	obj["paramAssets"] = mapped
}

func (g *shareGraph) walk(value any) {
	switch typed := value.(type) {
	case map[string]any:
		g.rewriteObject(typed)
	case []any:
		for _, child := range typed {
			g.walk(child)
		}
	}
}

func (g *shareGraph) payload(raw []byte) ([]byte, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var graph map[string]any
	if err := dec.Decode(&graph); err != nil {
		return nil, err
	}
	g.walk(graph)
	return json.Marshal(graph)
}

func (g *shareGraph) collect(s *repository.DramaSnapshot) error {
	if _, err := g.payload(s.Canvas.PayloadJSON); err != nil {
		return err
	}
	g.ref(s.Canvas.CoverAssetID)
	if s.Project.SourceAssetID != nil {
		g.ref(*s.Project.SourceAssetID)
	}
	for _, ep := range s.Episodes {
		if ep.FinalAssetID != nil {
			g.ref(*ep.FinalAssetID)
		}
	}
	for _, task := range s.Tasks {
		outputs, err := shareOutputs(task)
		if err != nil {
			return err
		}
		for _, out := range outputs {
			g.ref(out.AssetID)
			g.ref(out.CoverAssetID)
		}
	}
	return nil
}

func shareOutputs(task model.GenerationTask) ([]model.TaskOutput, error) {
	var outputs []model.TaskOutput
	if len(task.OutputJSON) == 0 {
		return nil, nil
	}
	err := json.Unmarshal(task.OutputJSON, &outputs)
	return outputs, err
}

type shareClone struct {
	graph      shareGraph
	episodeIDs map[uint64]uint64
	taskIDs    map[uint64]uint64
	user       uint64
	canvas     uint64
	drama      uint64
}

func (c *shareClone) assetID(id *uint64) *uint64 {
	if id == nil || *id == 0 {
		return nil
	}
	return &c.graph.assets[*id].asset.ID
}

func (c *shareClone) segmentNode(old string) string {
	if len(old) < 5 {
		return ""
	}
	next := c.graph.segments[old[4:]]
	if next == "" {
		return ""
	}
	return "seg:" + next
}

func (c *shareClone) newSegment(old uint64, next uint64) {
	c.graph.segments[idcodec.Encode(old)] = idcodec.Encode(next)
}
