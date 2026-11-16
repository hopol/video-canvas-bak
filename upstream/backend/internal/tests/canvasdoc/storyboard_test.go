package canvasdoc_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"video-canvas/internal/canvasdoc"
)

// storyboardShots 是分镜表节点里的镜头，导出、导入后要逐字不变。
const storyboardShots = `[
  {"id":"a","scene":"推门进屋","shot":"全景","camera":"推","action":"从门口走到窗边","dialogue":"","duration":4.5},
  {"id":"b","scene":"看向窗外","shot":"特写","camera":"固定","action":"","dialogue":"OS：又是雨天。","duration":2}
]`

// storyboardPayload 是一张剧本连分镜表的画布，没有素材。
const storyboardPayload = `{
  "nodes":[
    {"id":"n1","type":"canvas","position":{"x":0,"y":0},"data":{"kind":"script","label":"剧本","text":"雨夜。"}},
    {"id":"n2","type":"canvas","position":{"x":700,"y":0},"data":{"kind":"storyboard","label":"分镜表","storyboard":{"shots":` + storyboardShots + `}}}
  ],
  "edges":[{"id":"e1","source":"n1","target":"n2"}],
  "viewport":{"x":0,"y":0,"zoom":1}
}`

// TestStoryboard_ExportRestoreRoundTrip 分镜表的镜头、节点 id 和剧本连线在导出再导入后都不丢。
func TestStoryboard_ExportRestoreRoundTrip(t *testing.T) {
	doc, _ := mustBuild(t, canvasdoc.ExportInput{
		Title:      "分镜",
		Payload:    []byte(storyboardPayload),
		Assets:     map[string]canvasdoc.AssetEntry{},
		AppVersion: "0.6.12",
		Now:        time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC),
	})
	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	p, _, rep := mustRestore(t, canvasdoc.RestoreInput{Doc: mustParseDoc(t, string(encoded)), Assets: map[string]canvasdoc.RestoredAsset{}})
	if len(rep.MissingAssets) != 0 || rep.EdgesDropped != 0 {
		t.Errorf("报告应为空，实际 %+v", rep)
	}

	data := restoredData(t, p, "n2")
	if data["kind"] != "storyboard" || data["label"] != "分镜表" {
		t.Errorf("分镜表节点的种类或标题变了：%v", data)
	}
	got, _ := json.Marshal(data["storyboard"])
	var want, have any
	_ = json.Unmarshal([]byte(`{"shots":`+storyboardShots+`}`), &want)
	_ = json.Unmarshal(got, &have)
	if !reflect.DeepEqual(have, want) {
		t.Errorf("镜头变了：\n得到 %s", got)
	}
	if len(p.Edges) != 1 || p.Edges[0]["source"] != "n1" || p.Edges[0]["target"] != "n2" {
		t.Errorf("剧本到分镜表的连线丢了：%v", p.Edges)
	}
}

// storyboardImagePayload 是一张带手传分镜图的画布：分镜表第 1 行传了图，第 2 行关联着图片节点，第 3 行没有来源。
const storyboardImagePayload = `{
  "nodes":[
    {"id":"n1","type":"canvas","position":{"x":0,"y":0},"data":{"kind":"script","label":"剧本","text":"雨夜。"}},
    {"id":"n2","type":"canvas","position":{"x":700,"y":0},"data":{"kind":"storyboard","label":"分镜表","storyboard":{"shots":[
      {"id":"a","scene":"推门进屋","shot":"全景","camera":"推","action":"","dialogue":"","duration":4.5,"image":{"assetId":"90451","src":"/files/u1/a.png"}},
      {"id":"b","scene":"看向窗外","shot":"特写","camera":"固定","action":"","dialogue":"","duration":2,"imageNodeId":"n3","videoNodeId":"n4"},
      {"id":"c","scene":"雨打玻璃","shot":"中景","camera":"固定","action":"","dialogue":"","duration":3}
    ]}}},
    {"id":"n3","type":"canvas","position":{"x":1356,"y":0},"data":{"kind":"image","label":"镜头 02"}},
    {"id":"n4","type":"canvas","position":{"x":1356,"y":400},"data":{"kind":"video","label":"镜头 02 视频"}}
  ],
  "edges":[{"id":"e1","source":"n1","target":"n2"},{"id":"e2","source":"n2","target":"n3"},{"id":"e3","source":"n2","target":"n4"}],
  "viewport":{"x":0,"y":0,"zoom":1}
}`

func sbImageInput(drop ...string) canvasdoc.ExportInput {
	in := exportInput(drop...)
	in.Payload = []byte(storyboardImagePayload)
	return in
}

// firstShotImage 取导出文档里分镜表第 1 行的 image。
func shotsOfDoc(t *testing.T, doc *canvasdoc.Document) []map[string]any {
	t.Helper()
	sb, _ := nodeData(t, doc, "n2")["storyboard"].(map[string]any)
	list, _ := sb["shots"].([]any)
	out := make([]map[string]any, 0, len(list))
	for _, v := range list {
		m, _ := v.(map[string]any)
		out = append(out, m)
	}
	return out
}

// TestCollectRefs_StoryboardShotImages 手传分镜图的素材要收集，否则导出会漏文件；关联节点的 id 不是素材。
func TestCollectRefs_StoryboardShotImages(t *testing.T) {
	refs, err := canvasdoc.CollectRefs([]byte(storyboardImagePayload))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(refs.AssetIDs, []string{"90451"}) {
		t.Errorf("AssetIDs = %v，期望只有手传分镜图 [90451]", refs.AssetIDs)
	}
}

// TestBuild_RewritesStoryboardShotImages 手传分镜图只留哈希，不带原环境的 assetId / src；关联的节点 id 是画布内部的，原样保留。
func TestBuild_RewritesStoryboardShotImages(t *testing.T) {
	doc, report := mustBuild(t, sbImageInput())
	if report.SkippedAssets != 0 {
		t.Errorf("SkippedAssets = %d", report.SkippedAssets)
	}
	shots := shotsOfDoc(t, doc)
	if !reflect.DeepEqual(shots[0]["image"], map[string]any{"assetHash": hashOf["90451"]}) {
		t.Errorf("第 1 行 image = %#v", shots[0]["image"])
	}
	if shots[1]["imageNodeId"] != "n3" || shots[1]["videoNodeId"] != "n4" {
		t.Errorf("关联的节点 id 应原样保留：%#v", shots[1])
	}
	if _, ok := shots[2]["image"]; ok {
		t.Errorf("没有图的行不该多出 image：%#v", shots[2])
	}
	if _, ok := doc.Assets[hashOf["90451"]]; !ok {
		t.Error("手传分镜图的素材应进 Assets")
	}
}

// TestBuild_StoryboardShotImageUnreadable 手传的图读不到：这一行去掉图，其余字段、关联和别的行都保留，导出不失败。
func TestBuild_StoryboardShotImageUnreadable(t *testing.T) {
	doc, report := mustBuild(t, sbImageInput("90451"))
	if report.SkippedAssets != 1 {
		t.Errorf("SkippedAssets = %d，期望 1", report.SkippedAssets)
	}
	shots := shotsOfDoc(t, doc)
	if _, ok := shots[0]["image"]; ok {
		t.Errorf("读不到的图应去掉：%#v", shots[0])
	}
	if shots[0]["scene"] != "推门进屋" || shots[1]["imageNodeId"] != "n3" || len(shots) != 3 {
		t.Errorf("其余内容应保留：%#v", shots)
	}
}

// TestBuild_StoryboardMalformedImageDoesNotPanic 行里的 image 字段类型错乱时不 panic，也不把脏数据导出去。
func TestBuild_StoryboardMalformedImageDoesNotPanic(t *testing.T) {
	in := exportInput()
	in.Payload = []byte(`{"nodes":[{"id":"n2","type":"canvas","position":{"x":0,"y":0},"data":{"kind":"storyboard","label":"x","storyboard":{"shots":[
	  {"id":"a","scene":"x","image":"oops"},{"id":"b","scene":"y","image":{"src":"/leak.png"}},"坏行",{"id":"c","scene":"z","image":{"assetId":"nope"}}
	]}}}],"edges":[]}`)
	doc, _ := mustBuild(t, in)
	for _, s := range shotsOfDoc(t, doc) {
		if s == nil {
			continue
		}
		if _, ok := s["image"]; ok {
			t.Errorf("无效的 image 不该导出：%#v", s)
		}
	}
}

// TestStoryboard_ExportRestoreRoundTripWithImages 导出再导入：手传的图换成新环境的素材，关联的节点 id 仍然有效（AC11）。
func TestStoryboard_ExportRestoreRoundTripWithImages(t *testing.T) {
	doc, _ := mustBuild(t, sbImageInput())
	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	parsed := mustParseDoc(t, string(encoded))
	assets := newAssets(parsed)
	p, _, rep := mustRestore(t, canvasdoc.RestoreInput{Doc: parsed, Assets: assets})
	if len(rep.MissingAssets) != 0 || rep.EdgesDropped != 0 {
		t.Errorf("报告应为空：%+v", rep)
	}
	sb, _ := restoredData(t, p, "n2")["storyboard"].(map[string]any)
	shots, _ := sb["shots"].([]any)
	first, _ := shots[0].(map[string]any)
	img, _ := first["image"].(map[string]any)
	newAsset := assets[hashOf["90451"]]
	if img["assetId"] != newAsset.ID || img["src"] != newAsset.URL {
		t.Errorf("第 1 行 image = %#v，期望新素材 %+v", img, newAsset)
	}
	second, _ := shots[1].(map[string]any)
	if second["imageNodeId"] != "n3" || second["videoNodeId"] != "n4" {
		t.Errorf("关联的节点 id 在导入后应仍然有效：%#v", second)
	}
	ids := map[string]bool{}
	for _, n := range p.Nodes {
		ids[n["id"].(string)] = true
	}
	if !ids["n3"] || !ids["n4"] {
		t.Errorf("被关联的节点导入后应还在：%v", ids)
	}
}

// TestRestore_StoryboardShotImageMissingAsset 导入时手传分镜图的素材复制失败：这一行回到没有图，别的内容保留。
func TestRestore_StoryboardShotImageMissingAsset(t *testing.T) {
	doc, _ := mustBuild(t, sbImageInput())
	encoded, _ := json.Marshal(doc)
	parsed := mustParseDoc(t, string(encoded))
	p, _, rep := mustRestore(t, canvasdoc.RestoreInput{Doc: parsed, Assets: newAssets(parsed, hashOf["90451"])})
	if len(rep.MissingAssets) != 1 {
		t.Errorf("应记 1 个缺失素材：%+v", rep)
	}
	sb, _ := restoredData(t, p, "n2")["storyboard"].(map[string]any)
	shots, _ := sb["shots"].([]any)
	first, _ := shots[0].(map[string]any)
	if _, ok := first["image"]; ok {
		t.Errorf("缺失的图应去掉：%#v", first)
	}
	if first["scene"] != "推门进屋" {
		t.Errorf("其余字段应保留：%#v", first)
	}
}

// TestValidate_StoryboardShotImageHashMustExist 文档里分镜图引用的哈希必须在素材表里，悬空的拒绝导入。
func TestValidate_StoryboardShotImageHashMustExist(t *testing.T) {
	dangling := strings.Repeat("e", 64)
	doc := docJSON(nodeWithData(`{"kind":"storyboard","label":"x","storyboard":{"shots":[{"id":"a","scene":"x","image":{"assetHash":"` + dangling + `"}}]}}`))
	d, err := canvasdoc.Parse([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Validate(canvasdoc.DefaultLimits()); !errors.Is(err, canvasdoc.ErrInvalid) {
		t.Errorf("悬空的分镜图哈希应拒绝导入，实际 %v", err)
	}
	ok := docJSON(nodeWithData(`{"kind":"storyboard","label":"x","storyboard":{"shots":[{"id":"a","scene":"x","image":{"assetHash":"` + h1 + `"}}]}}`))
	d, err = canvasdoc.Parse([]byte(ok))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Validate(canvasdoc.DefaultLimits()); err != nil {
		t.Errorf("素材表里有的哈希应通过：%v", err)
	}
}

// TestCheckDocumentClean_RejectsStoryboardLeaks 手改文件把原环境的素材 id 或地址藏进分镜表的镜头里要拒绝。
func TestCheckDocumentClean_RejectsStoryboardLeaks(t *testing.T) {
	doc := docJSON(nodeWithData(`{"kind":"storyboard","label":"x","storyboard":{"shots":[{"id":"a","scene":"x","image":{"assetHash":"` + h1 + `","assetId":"123"}}]}}`))
	d, err := canvasdoc.Parse([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if err := canvasdoc.CheckDocumentClean(d); !errors.Is(err, canvasdoc.ErrInvalid) {
		t.Errorf("镜头里夹带 assetId 应拒绝，实际 %v", err)
	}
}
