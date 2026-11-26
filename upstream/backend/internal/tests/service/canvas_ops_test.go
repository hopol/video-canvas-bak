package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/datatypes"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/ws"
	"video-canvas/internal/repository"
	. "video-canvas/internal/service"
)

// fakeOpsCanvasRepo 是节点级编辑用的内存画布仓储：Update 按 revision 做乐观锁。
type fakeOpsCanvasRepo struct {
	cv      *model.CanvasProject
	updates int
}

func (r *fakeOpsCanvasRepo) Create(context.Context, *model.CanvasProject) error { return nil }

func (r *fakeOpsCanvasRepo) GetByID(_ context.Context, userID, id uint64) (*model.CanvasProject, error) {
	if r.cv == nil || r.cv.ID != id || r.cv.UserID != userID {
		return nil, repository.ErrNotFound
	}
	cp := *r.cv
	return &cp, nil
}

func (r *fakeOpsCanvasRepo) List(context.Context, uint64, string, int, int) ([]model.CanvasProjectItem, int64, error) {
	return nil, 0, nil
}

func (r *fakeOpsCanvasRepo) Update(_ context.Context, userID, id, revision uint64, fields map[string]any) (*model.CanvasProject, error) {
	if r.cv == nil || r.cv.ID != id || r.cv.UserID != userID {
		return nil, repository.ErrNotFound
	}
	if r.cv.Revision != revision {
		return nil, repository.ErrRevisionConflict
	}
	if p, ok := fields["payload_json"].(datatypes.JSON); ok {
		r.cv.PayloadJSON = p
	}
	r.cv.Revision++
	r.updates++
	cp := *r.cv
	return &cp, nil
}

func (r *fakeOpsCanvasRepo) Delete(context.Context, uint64, uint64) error { return nil }

func newOpsCanvasRepo(revision uint64, dramaID *uint64) *fakeOpsCanvasRepo {
	return &fakeOpsCanvasRepo{cv: &model.CanvasProject{
		BaseModel: model.BaseModel{ID: 5}, UserID: 9, Title: "画布", DramaID: dramaID,
		PayloadJSON: datatypes.JSON(`{"nodes":[],"edges":[]}`), Revision: revision,
	}}
}

func opsModelSource(context.Context) (map[string][]string, error) {
	return map[string][]string{"veo": {"t2v", "i2v", "omni"}, "kling": {"t2v"}}, nil
}

const opsCreateScript = `[{"op":"create_node","tempId":"a","kind":"script","label":"旁白","prompt":"第一句"}]`

func TestApplyOps_PublishesCanvasPatch(t *testing.T) {
	repo := newOpsCanvasRepo(3, nil)
	bc := &recordingBroadcaster{}
	svc := NewCanvasProjectService(repo, WithCanvasBroadcaster(bc))

	res, err := svc.ApplyOps(context.Background(), 9, 5, &CanvasOpsReq{Revision: 3, Ops: json.RawMessage(opsCreateScript)})
	if err != nil {
		t.Fatal(err)
	}
	if res.Revision != 4 {
		t.Fatalf("revision 应 +1，实际 %d", res.Revision)
	}
	if bc.count(ws.TypeCanvasPatch) != 1 {
		t.Fatalf("写库成功后应推一条 canvas.patch，实际 %d", bc.count(ws.TypeCanvasPatch))
	}
	m := bc.msgs[0]
	if m.channel != ws.UserChannel(9) {
		t.Fatalf("只能推给画布所有者的频道，实际 %s", m.channel)
	}
	data := m.msg.Data.(map[string]any)
	if data["kind"] != "cli_ops" || data["revision_before"] != uint64(3) || data["revision_after"] != uint64(4) {
		t.Fatalf("patch 字段不对：%v", data)
	}
}

func TestApplyOps_NoPatchWhenNothingWritten(t *testing.T) {
	cases := []struct {
		name string
		req  *CanvasOpsReq
	}{
		{"版本冲突", &CanvasOpsReq{Revision: 2, Ops: json.RawMessage(opsCreateScript)}},
		{"空操作没有改动", &CanvasOpsReq{Revision: 3, DeleteNodeIDs: []string{"not-exist"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newOpsCanvasRepo(3, nil)
			bc := &recordingBroadcaster{}
			svc := NewCanvasProjectService(repo, WithCanvasBroadcaster(bc))
			_, _ = svc.ApplyOps(context.Background(), 9, 5, tc.req)
			if repo.updates != 0 || bc.count(ws.TypeCanvasPatch) != 0 {
				t.Fatalf("没写库就不能推 patch：updates=%d patches=%d", repo.updates, bc.count(ws.TypeCanvasPatch))
			}
		})
	}
}

func TestApplyOps_RevisionConflictIs409(t *testing.T) {
	repo := newOpsCanvasRepo(3, nil)
	svc := NewCanvasProjectService(repo)
	_, err := svc.ApplyOps(context.Background(), 9, 5, &CanvasOpsReq{Revision: 2, Ops: json.RawMessage(opsCreateScript)})
	if err == nil || err.Error() != errcode.ErrCanvasConflict.Error() {
		t.Fatalf("旧 revision 应报 ErrCanvasConflict，得到 %v", err)
	}
}

func TestApplyOps_RejectsDramaCanvas(t *testing.T) {
	dramaID := uint64(77)
	repo := newOpsCanvasRepo(3, &dramaID)
	svc := NewCanvasProjectService(repo)
	_, err := svc.ApplyOps(context.Background(), 9, 5, &CanvasOpsReq{Revision: 3, Ops: json.RawMessage(opsCreateScript)})
	if err == nil || !strings.Contains(err.Error(), "短剧") {
		t.Fatalf("短剧画布的节点由短剧服务维护，应拒绝并说明原因，得到 %v", err)
	}
	if repo.updates != 0 {
		t.Fatal("被拒绝时不能写库")
	}
}

func TestApplyOps_ValidatesModeAgainstModelOps(t *testing.T) {
	cases := []struct {
		name    string
		ops     string
		wantErr string
	}{
		{"模型支持的 mode 放行", `[{"op":"create_node","tempId":"v","kind":"video","model":"veo","mode":"i2v"}]`, ""},
		{"模型不支持的 mode 被拒", `[{"op":"create_node","tempId":"v","kind":"video","model":"kling","mode":"i2v"}]`, "kling"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := NewCanvasProjectService(newOpsCanvasRepo(3, nil), WithCanvasModelOps(opsModelSource))
			_, err := svc.ApplyOps(context.Background(), 9, 5, &CanvasOpsReq{Revision: 3, Ops: json.RawMessage(tc.ops)})
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("不该报错：%v", err)
			case tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)):
				t.Fatalf("应按模型能力拒绝并点名模型 %q，得到 %v", tc.wantErr, err)
			}
		})
	}
}

func TestApplyOps_ModelOpsSourceFailureDoesNotBlock(t *testing.T) {
	// 与 Agent 一致：读不到模型能力时不校验（生成时再兜底），不能让编辑整体失败
	src := func(context.Context) (map[string][]string, error) { return nil, errcode.ErrInternal }
	svc := NewCanvasProjectService(newOpsCanvasRepo(3, nil), WithCanvasModelOps(src))
	ops := `[{"op":"create_node","tempId":"v","kind":"video","model":"kling","mode":"i2v"}]`
	if _, err := svc.ApplyOps(context.Background(), 9, 5, &CanvasOpsReq{Revision: 3, Ops: json.RawMessage(ops)}); err != nil {
		t.Fatalf("模型能力读取失败时应放行：%v", err)
	}
}
