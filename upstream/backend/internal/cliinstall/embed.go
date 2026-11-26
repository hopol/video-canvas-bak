// Package cliinstall 内嵌命令行（cli/）的一键安装脚本，由 GET /api/v1/cli/install.sh|.ps1 原样下发。
//
// 脚本是固定内容，编译时打进二进制：不读请求头、不拼站点地址，所以响应可以放心让代理缓存，
// 不会因为伪造的 Host / X-Forwarded-Host 被投毒。安装包本身来自 GitHub Release
// （video-canvas-cli.tgz 与它的 .sha256），脚本先校验再交给 npm 本地安装，最后 vc skill install。
//
// 改脚本时注意：提示文字里的变量一律写成 ${VAR}。中文 / UTF-8 locale 下 `$VAR）` 会被 sh
// 当成变量名的一部分，报 unbound variable（internal/tests/cliinstall 有三种 locale 的用例）。
package cliinstall

import _ "embed" // 安装脚本用 go:embed 打进二进制

// UnixScript 是 macOS / Linux 的安装脚本：curl -fsSL <接口根>/cli/install.sh | sh
//
//go:embed install.sh
var UnixScript []byte

// WindowsScript 是 Windows PowerShell 的安装脚本：irm <接口根>/cli/install.ps1 | iex
//
//go:embed install.ps1
var WindowsScript []byte
