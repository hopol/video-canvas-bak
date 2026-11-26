// Package cliinstall_test 测试内嵌的命令行一键安装脚本：
// 用假的 node / npm / curl / vc 顶替真实命令，只看 install.sh 按什么顺序调了什么。
package cliinstall_test

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"video-canvas/internal/cliinstall"
)

const latest = "https://github.com/zaylora/video-canvas/releases/latest/download"

// 假安装包的内容与它真实的 sha256
const packageBody = "fake video-canvas-cli package"

func packageSHA() string {
	sum := sha256.Sum256([]byte(packageBody))
	return hex.EncodeToString(sum[:])
}

type fakeOpts struct {
	nodeVersion    string // 默认 22.18.0
	npmGlobalFails bool   // 模拟全局目录没写权限
	badChecksum    bool   // 模拟包被篡改或下载不完整
}

type fakeEnv struct {
	root, bin, log, home string
}

func writeExec(t *testing.T, file, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}

func newFakeEnv(t *testing.T, opts fakeOpts) fakeEnv {
	t.Helper()
	root := t.TempDir()
	env := fakeEnv{root: root, bin: filepath.Join(root, "bin"), log: filepath.Join(root, "calls.log"), home: filepath.Join(root, "home")}
	if err := os.MkdirAll(env.home, 0o755); err != nil {
		t.Fatal(err)
	}
	globalPrefix := filepath.Join(root, "global")
	version := opts.nodeVersion
	if version == "" {
		version = "22.18.0"
	}
	var major, minor int
	_, _ = fmt.Sscanf(version, "%d.%d", &major, &minor)
	nodeOK := 1
	if major > 22 || (major == 22 && minor >= 18) {
		nodeOK = 0
	}
	writeExec(t, filepath.Join(env.bin, "node"),
		fmt.Sprintf("#!/bin/sh\nif [ \"$1\" = \"-v\" ]; then echo v%s; exit 0; fi\nexit %d\n", version, nodeOK))
	writeExec(t, filepath.Join(root, "vc-template"),
		fmt.Sprintf("#!/bin/sh\necho \"vc $*\" >> %q\necho \"video-canvas-cli 1.0.0\"\n", env.log))
	sha := packageSHA()
	if opts.badChecksum {
		sha = strings.Repeat("0", 64)
	}
	// curl -fsSL <url> -o <file>：按地址后缀写包或校验文件；含 missing 的地址模拟 404
	writeExec(t, filepath.Join(env.bin, "curl"), fmt.Sprintf(`#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "curl $url" >> %q
case "$url" in
  *missing*) exit 22 ;;
  *.tgz.sha256) printf '%%s  video-canvas-cli.tgz\n' %q > "$out" ;;
  *.tgz) printf '%%s' %q > "$out" ;;
  *) exit 22 ;;
esac
`, env.log, sha, packageBody))
	globalInstall := fmt.Sprintf(`mkdir -p %q && cp %q %q`, filepath.Join(globalPrefix, "bin"),
		filepath.Join(root, "vc-template"), filepath.Join(globalPrefix, "bin", "vc"))
	if opts.npmGlobalFails {
		globalInstall = `echo "EACCES: permission denied" >&2; exit 243`
	}
	writeExec(t, filepath.Join(env.bin, "npm"), fmt.Sprintf(`#!/bin/sh
echo "npm $*" >> %q
case "$*" in
  "prefix -g") echo %q ;;
  *"--prefix"*) mkdir -p "$HOME/.local/bin" && cp %q "$HOME/.local/bin/vc" ;;
  "install -g"*) %s ;;
esac
`, env.log, globalPrefix, filepath.Join(root, "vc-template"), globalInstall))
	return env
}

type runResult struct {
	code   int
	stdout string
	stderr string
	calls  []string
}

func runInstall(t *testing.T, env fakeEnv, extra ...string) runResult {
	t.Helper()
	script := filepath.Join(env.root, "install.sh")
	if err := os.WriteFile(script, cliinstall.UnixScript, 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", script)
	cmd.Env = append([]string{"PATH=" + env.bin + ":/usr/bin:/bin", "HOME=" + env.home}, extra...)
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	code := 0
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code = exitErr.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	var calls []string
	if raw, readErr := os.ReadFile(env.log); readErr == nil {
		calls = strings.Split(strings.TrimSpace(string(raw)), "\n")
	}
	return runResult{code: code, stdout: stdout.String(), stderr: stderr.String(), calls: calls}
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func npmInstalls(calls []string) []string {
	var out []string
	for _, c := range calls {
		if strings.HasPrefix(c, "npm install") {
			out = append(out, c)
		}
	}
	return out
}

func TestInstallSh_DownloadsVerifiesInstallsThenSkill(t *testing.T) {
	res := runInstall(t, newFakeEnv(t, fakeOpts{}))
	if res.code != 0 {
		t.Fatalf("退出码 %d：%s", res.code, res.stderr)
	}
	for _, want := range []string{"curl " + latest + "/video-canvas-cli.tgz", "curl " + latest + "/video-canvas-cli.tgz.sha256"} {
		if !contains(res.calls, want) {
			t.Fatalf("缺少调用 %q：%v", want, res.calls)
		}
	}
	installs := npmInstalls(res.calls)
	if len(installs) != 1 || !regexp.MustCompile(`^npm install -g /.+/video-canvas-cli\.tgz$`).MatchString(installs[0]) {
		t.Fatalf("npm 安装调用不对：%v", installs)
	}
	if res.calls[len(res.calls)-1] != "vc skill install" {
		t.Fatalf("最后一步应是 vc skill install：%v", res.calls)
	}
	if !strings.Contains(res.stdout, "vc login") {
		t.Fatal("结尾要提示下一步登录")
	}
}

// 中文 locale 下变量紧跟全角标点（`$ACTUAL）`）会被 sh 当成变量名的一部分，报 unbound variable，
// 用户看不到真正原因；所以三种 locale 下都要拿到完整提示。
func TestInstallSh_ChecksumMismatchAbortsInEveryLocale(t *testing.T) {
	for _, lang := range []string{"C", "en_US.UTF-8", "zh_CN.UTF-8"} {
		res := runInstall(t, newFakeEnv(t, fakeOpts{badChecksum: true}), "LANG="+lang, "LC_ALL="+lang)
		if res.code == 0 || !strings.Contains(res.stderr, "安装包校验失败") || strings.Contains(res.stderr, "unbound variable") {
			t.Fatalf("LANG=%s：退出码 %d，stderr=%s", lang, res.code, res.stderr)
		}
		if len(npmInstalls(res.calls)) != 0 {
			t.Fatalf("LANG=%s：校验失败后不能调用 npm 安装", lang)
		}
	}
}

func TestInstallSh_DownloadFailureMentionsMirrorInEveryLocale(t *testing.T) {
	for _, lang := range []string{"C", "en_US.UTF-8", "zh_CN.UTF-8"} {
		res := runInstall(t, newFakeEnv(t, fakeOpts{}), "LANG="+lang, "LC_ALL="+lang,
			"VC_DOWNLOAD_BASE=https://mirror.example.com/missing")
		if res.code == 0 || !strings.Contains(res.stderr, "VC_DOWNLOAD_BASE") || strings.Contains(res.stderr, "unbound variable") {
			t.Fatalf("LANG=%s：退出码 %d，stderr=%s", lang, res.code, res.stderr)
		}
	}
}

func TestInstallSh_VersionAndMirrorOverrides(t *testing.T) {
	res := runInstall(t, newFakeEnv(t, fakeOpts{}), "VC_CLI_VERSION=v0.7.3")
	if want := "curl https://github.com/zaylora/video-canvas/releases/download/v0.7.3/video-canvas-cli.tgz"; !contains(res.calls, want) {
		t.Fatalf("指定版本没走对应 tag：%v", res.calls)
	}
	res = runInstall(t, newFakeEnv(t, fakeOpts{}), "VC_DOWNLOAD_BASE=https://mirror.example.com/vc/")
	if want := "curl https://mirror.example.com/vc/video-canvas-cli.tgz"; !contains(res.calls, want) {
		t.Fatalf("镜像地址没生效：%v", res.calls)
	}
}

func TestInstallSh_FallsBackToHomeLocalWithoutGlobalPermission(t *testing.T) {
	res := runInstall(t, newFakeEnv(t, fakeOpts{npmGlobalFails: true}))
	if res.code != 0 {
		t.Fatalf("退出码 %d：%s", res.code, res.stderr)
	}
	installs := npmInstalls(res.calls)
	last := installs[len(installs)-1]
	if !regexp.MustCompile(`^npm install -g --prefix .+/\.local .+video-canvas-cli\.tgz$`).MatchString(last) {
		t.Fatalf("没有退到 ~/.local：%v", installs)
	}
	if !contains(res.calls, "vc skill install") || !strings.Contains(res.stdout, ".local/bin") {
		t.Fatalf("要装技能并提示 PATH：%v / %s", res.calls, res.stdout)
	}
}

func TestInstallSh_RejectsOldNodeBeforeDownloading(t *testing.T) {
	res := runInstall(t, newFakeEnv(t, fakeOpts{nodeVersion: "20.11.0"}))
	if res.code == 0 || !strings.Contains(res.stderr, "22.18") || len(res.calls) != 0 {
		t.Fatalf("退出码 %d，调用 %v，stderr=%s", res.code, res.calls, res.stderr)
	}
}

// 两份脚本都是静态内容：只认 GitHub Release，不含站点地址占位，也不走 npm 仓库。
func TestScripts_AreStaticAndPointAtGitHubRelease(t *testing.T) {
	for name, body := range map[string][]byte{"install.sh": cliinstall.UnixScript, "install.ps1": cliinstall.WindowsScript} {
		s := string(body)
		for _, want := range []string{"github.com/zaylora/video-canvas/releases", "video-canvas-cli.tgz", ".sha256", "skill install"} {
			if !strings.Contains(s, want) {
				t.Fatalf("%s 缺少 %q", name, want)
			}
		}
		for _, bad := range []string{"__BASE__", "@latest"} {
			if strings.Contains(s, bad) {
				t.Fatalf("%s 不该出现 %q", name, bad)
			}
		}
	}
}
