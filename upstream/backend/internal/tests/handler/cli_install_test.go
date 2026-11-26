package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"video-canvas/internal/cliinstall"
	. "video-canvas/internal/handler"
)

func newCLIInstallRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewCLIInstallHandler()
	r.GET("/api/v1/cli/install.sh", h.Unix)
	r.GET("/api/v1/cli/install.ps1", h.Windows)
	return r
}

func getInstallScript(r *gin.Engine, path string, header map[string]string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(w, req)
	return w
}

// 安装脚本按纯文本下发（PowerShell 的 irm 要拿到字符串），内容就是内嵌的那份文件。
func TestCLIInstall_ServesEmbeddedScriptsAsPlainText(t *testing.T) {
	r := newCLIInstallRouter()
	cases := []struct {
		path string
		want []byte
	}{
		{"/api/v1/cli/install.sh", cliinstall.UnixScript},
		{"/api/v1/cli/install.ps1", cliinstall.WindowsScript},
	}
	for _, tc := range cases {
		w := getInstallScript(r, tc.path, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s 状态码 = %d", tc.path, w.Code)
		}
		if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
			t.Fatalf("%s Content-Type = %q，要 text/plain", tc.path, ct)
		}
		if len(tc.want) == 0 || w.Body.String() != string(tc.want) {
			t.Fatalf("%s 正文与内嵌脚本不一致", tc.path)
		}
	}
}

// 内容与请求无关：伪造 Host / X-Forwarded-Host 拿到的仍是同一份字节，所以可以放心让代理缓存。
func TestCLIInstall_IgnoresRequestHeaders(t *testing.T) {
	r := newCLIInstallRouter()
	plain := getInstallScript(r, "/api/v1/cli/install.sh", nil).Body.String()
	forged := getInstallScript(r, "/api/v1/cli/install.sh", map[string]string{
		"Host":              "evil.example.com",
		"X-Forwarded-Host":  "evil.example.com",
		"X-Forwarded-Proto": "http",
	}).Body.String()
	if plain != forged {
		t.Fatal("脚本内容随请求头变化了")
	}
	if strings.Contains(forged, "evil.example.com") {
		t.Fatal("脚本里出现了请求头里的主机名")
	}
}
