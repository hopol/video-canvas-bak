package router_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"video-canvas/internal/handler"
	"video-canvas/internal/router"
)

// 装 CLI 时还没有凭据：两个安装脚本必须免登录可取，并按纯文本下发。
func TestRouter_CLIInstallScriptsArePublic(t *testing.T) {
	r := router.New("test", proxyJWTSecret, router.Handlers{
		Health:     &handler.HealthHandler{},
		CLIInstall: handler.NewCLIInstallHandler(),
	})
	for _, path := range []string{"/api/v1/cli/install.sh", "/api/v1/cli/install.ps1"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s 未登录应可访问，实际 %d", path, w.Code)
		}
		if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
			t.Fatalf("%s Content-Type = %q", path, ct)
		}
	}
}
