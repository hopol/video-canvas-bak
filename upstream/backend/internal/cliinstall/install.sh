#!/bin/sh
# 连镜（video-canvas）命令行一键安装：装 CLI 并把配套技能装进终端助手。
# 用法：curl -fsSL <站点>/api/v1/cli/install.sh | sh
#
# 安装包来自 GitHub Release（每次发版附带 video-canvas-cli.tgz 与它的 .sha256），
# 先校验 sha256 再交给 npm 本地安装。脚本是静态文件，不含任何站点地址。
#
# 可选环境变量：
#   VC_CLI_VERSION    指定版本对应的 Release tag（如 v0.7.3），默认最新
#   VC_DOWNLOAD_BASE  换成镜像地址（GitHub 访问不畅时），目录下要有同名的 .tgz 与 .tgz.sha256
set -eu

REPO="https://github.com/zaylora/video-canvas/releases"
ASSET="video-canvas-cli.tgz"

say() { printf '%s\n' "$*"; }
die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || die "需要 Node.js 22.18 或更高版本，见 https://nodejs.org/zh-cn/download"
NODE_VERSION=$(node -v 2>/dev/null) || die "找到了 node（$(command -v node)）但无法执行，请换一个能在本机运行的 Node 22.18+"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || die "Node.js 版本过低（当前 ${NODE_VERSION}），需要 22.18 或更高"
command -v npm >/dev/null 2>&1 || die "找不到 npm，它通常随 Node.js 一起安装"
command -v curl >/dev/null 2>&1 || die "需要 curl 下载安装包"

if [ -n "${VC_DOWNLOAD_BASE:-}" ]; then
  BASE="${VC_DOWNLOAD_BASE%/}"
elif [ -n "${VC_CLI_VERSION:-}" ]; then
  BASE="${REPO}/download/${VC_CLI_VERSION}"
else
  BASE="${REPO}/latest/download"
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "找不到 sha256sum 或 shasum，无法校验安装包"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT INT TERM
PKG="${TMP}/${ASSET}"

say "下载 video-canvas-cli：${BASE}/${ASSET}"
curl -fsSL "${BASE}/${ASSET}" -o "${PKG}" || die "下载失败：${BASE}/${ASSET}（GitHub 访问不畅时可设 VC_DOWNLOAD_BASE 指向镜像）"
curl -fsSL "${BASE}/${ASSET}.sha256" -o "${TMP}/sum" || die "下载校验文件失败：${BASE}/${ASSET}.sha256"

EXPECTED=$(awk '{print $1; exit}' "${TMP}/sum" | tr 'A-F' 'a-f')
ACTUAL=$(sha256_of "${PKG}")
[ -n "${EXPECTED}" ] && [ "${EXPECTED}" = "${ACTUAL}" ] \
  || die "安装包校验失败（期望 ${EXPECTED:-空}，实际 ${ACTUAL}），可能下载不完整或被篡改，已中止"

if npm install -g "${PKG}"; then
  BIN="$(npm prefix -g)/bin"
else
  # 常见原因是全局目录要 root 权限：不用 sudo，改装到用户自己的目录
  say ""
  say "全局目录没有写权限，改装到 ${HOME}/.local"
  npm install -g --prefix "${HOME}/.local" "${PKG}" || die "npm 安装失败，见上面的输出"
  BIN="${HOME}/.local/bin"
fi

[ -x "${BIN}/vc" ] || die "安装完成但找不到 ${BIN}/vc"
say "已装好：$("${BIN}/vc" --version 2>/dev/null || echo video-canvas-cli)"

say ""
"${BIN}/vc" skill install || say "提示：技能没装上，稍后可以手动执行 vc skill install"

case ":${PATH}:" in
  *":${BIN}:"*) ;;
  *)
    say ""
    say "把 ${BIN} 加进 PATH 才能直接敲 vc，例如："
    say "  echo 'export PATH=\"${BIN}:\${PATH}\"' >> ~/.zshrc && . ~/.zshrc"
    ;;
esac
say ""
say "下一步：vc login --base <站点接口地址>（网页「命令行（CLI）」页可复制完整命令）"
