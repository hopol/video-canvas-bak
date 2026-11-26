package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"video-canvas/internal/cliinstall"
)

// CLIInstallHandler 下发命令行的一键安装脚本（免登录：装 CLI 时还没有任何凭据）。
//
// 脚本是内嵌的固定字节，不读请求头、不拼地址，所以可以设公共缓存；
// 安装包从 GitHub Release 下载并校验 sha256，后端不托管安装包。
type CLIInstallHandler struct{}

// NewCLIInstallHandler 构造安装脚本处理器：没有依赖，内容来自 cliinstall 的内嵌文件。
func NewCLIInstallHandler() *CLIInstallHandler {
	return &CLIInstallHandler{}
}

// Unix 下发 macOS / Linux 脚本（GET /cli/install.sh）。
func (h *CLIInstallHandler) Unix(c *gin.Context) {
	serveScript(c, cliinstall.UnixScript)
}

// Windows 下发 PowerShell 脚本（GET /cli/install.ps1）。
func (h *CLIInstallHandler) Windows(c *gin.Context) {
	serveScript(c, cliinstall.WindowsScript)
}

// serveScript 按纯文本下发：PowerShell 的 irm 拿到 text/plain 才会得到字符串，二进制类型会让 iex 失败。
// 脚本不是 JSON 信封，直接写字节，不走 response 包。
func serveScript(c *gin.Context, body []byte) {
	c.Header("Cache-Control", "public, max-age=300")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", body)
}
