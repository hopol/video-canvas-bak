package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	. "video-canvas/internal/handler"
	"video-canvas/internal/middleware"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

// memCLIDeviceRepo 是只够 Start / Describe 用的内存设备码仓储。
type memCLIDeviceRepo struct{ rows []*model.CLIDeviceCode }

func (r *memCLIDeviceRepo) Create(_ context.Context, c *model.CLIDeviceCode) error {
	c.ID = uint64(len(r.rows) + 1)
	cp := *c
	r.rows = append(r.rows, &cp)
	return nil
}

func (r *memCLIDeviceRepo) GetByHash(context.Context, string) (*model.CLIDeviceCode, error) {
	return nil, repository.ErrNotFound
}

func (r *memCLIDeviceRepo) GetByUserCode(_ context.Context, code string) (*model.CLIDeviceCode, error) {
	for _, row := range r.rows {
		if row.UserCode == code {
			cp := *row
			return &cp, nil
		}
	}
	return nil, repository.ErrNotFound
}

func (r *memCLIDeviceRepo) Approve(context.Context, string, uint64, time.Time) (bool, error) {
	return false, nil
}
func (r *memCLIDeviceRepo) Deny(context.Context, string, time.Time) (bool, error) { return false, nil }
func (r *memCLIDeviceRepo) MarkPolled(context.Context, uint64, time.Time) error   { return nil }
func (r *memCLIDeviceRepo) Consume(context.Context, uint64, time.Time) (bool, error) {
	return false, nil
}

type allowAllLimiter struct{ allow bool }

func (l allowAllLimiter) Allow(context.Context, string, int, time.Duration) (bool, error) {
	return l.allow, nil
}

func newCLIDeviceRouter(allow bool) (*gin.Engine, *memCLIDeviceRepo) {
	repo := &memCLIDeviceRepo{}
	svc := service.NewCLIDeviceService(service.CLIDeviceDeps{Repo: repo, Limiter: allowAllLimiter{allow: allow}})
	h := NewCLIDeviceHandler(svc)
	r := gin.New()
	r.POST("/api/v1/auth/cli/device", h.Start)
	authed := r.Group("/api/v1", func(c *gin.Context) { c.Set(middleware.CtxUserIDKey, uint(1)); c.Next() })
	authed.GET("/auth/cli/device", h.Describe)
	return r, repo
}

func cliDeviceCall(t *testing.T, r *gin.Engine, method, path, body, remoteAddr string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("响应不是 JSON：%v %s", err, w.Body.String())
	}
	return w.Code, resp
}

func TestCLIDeviceHandler_StartRecordsIPAndDescribeShowsIt(t *testing.T) {
	r, repo := newCLIDeviceRouter(true)
	status, resp := cliDeviceCall(t, r, http.MethodPost, "/api/v1/auth/cli/device", `{"client_name":"macbook"}`, "198.51.100.7:5555")
	if status != http.StatusOK {
		t.Fatalf("申请失败：%d %v", status, resp)
	}
	if len(repo.rows) != 1 || repo.rows[0].CreatedIP != "198.51.100.7" {
		t.Fatalf("应记录请求来源 IP：%+v", repo.rows)
	}
	userCode := resp["data"].(map[string]any)["user_code"].(string)

	status, resp = cliDeviceCall(t, r, http.MethodGet, "/api/v1/auth/cli/device?code="+userCode, "", "")
	if status != http.StatusOK {
		t.Fatalf("授权页读取失败：%d %v", status, resp)
	}
	data := resp["data"].(map[string]any)
	if data["client_ip"] != "198.51.100.7" || data["client_name"] != "macbook" {
		t.Fatalf("授权页应展示发起方 IP 和名称：%v", data)
	}
}

func TestCLIDeviceHandler_StartValidation(t *testing.T) {
	r, _ := newCLIDeviceRouter(true)
	status, resp := cliDeviceCall(t, r, http.MethodPost, "/api/v1/auth/cli/device", `{"client_name":"`+strings.Repeat("长", 65)+`"}`, "")
	if status != http.StatusBadRequest || resp["code"] != float64(errcode.ErrInvalidParams.Code) {
		t.Fatalf("超长名称应 400 + 10001：%d %v", status, resp)
	}
	// 不带请求体也合法
	if status, resp = cliDeviceCall(t, r, http.MethodPost, "/api/v1/auth/cli/device", ``, ""); status != http.StatusOK {
		t.Fatalf("空请求体应放行：%d %v", status, resp)
	}
}

func TestCLIDeviceHandler_StartRateLimited(t *testing.T) {
	r, repo := newCLIDeviceRouter(false)
	status, resp := cliDeviceCall(t, r, http.MethodPost, "/api/v1/auth/cli/device", `{}`, "198.51.100.7:5555")
	if status != http.StatusTooManyRequests || resp["code"] != float64(errcode.ErrTooManyReqs.Code) {
		t.Fatalf("超限应 429 + 10005：%d %v", status, resp)
	}
	if len(repo.rows) != 0 {
		t.Fatal("被限流时不能落库")
	}
}
