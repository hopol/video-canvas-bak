# 连镜（video-canvas）命令行一键安装（Windows）：装 CLI 并把配套技能装进终端助手。
# PowerShell：irm <站点>/api/v1/cli/install.ps1 | iex
# CMD：powershell -NoProfile -ExecutionPolicy Bypass -Command "irm <站点>/api/v1/cli/install.ps1 | iex"
#
# 安装包来自 GitHub Release（每次发版附带 video-canvas-cli.tgz 与它的 .sha256），
# 先校验 sha256 再交给 npm 本地安装。脚本是静态文件，不含任何站点地址。
# 可选：$env:VC_CLI_VERSION（Release tag，如 v0.7.3）、$env:VC_DOWNLOAD_BASE（镜像地址）。
# 一律调用 npm.cmd / vc.cmd：直接写 npm 会命中 npm.ps1，被执行策略拦下。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # 进度条会让 Invoke-WebRequest 慢一个数量级
$Repo = 'https://github.com/zaylora/video-canvas/releases'
$Asset = 'video-canvas-cli.tgz'

function Fail($message) { throw "错误：$message" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail '需要 Node.js 22.18 或更高版本，见 https://nodejs.org/zh-cn/download'
}
$nodeVersion = & node -v 2>$null
& node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if ($LASTEXITCODE -ne 0) { Fail "Node.js 版本过低（当前 $($nodeVersion)），需要 22.18 或更高" }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail '找不到 npm，它通常随 Node.js 一起安装' }

if ($env:VC_DOWNLOAD_BASE) { $Base = $env:VC_DOWNLOAD_BASE.TrimEnd('/') }
elseif ($env:VC_CLI_VERSION) { $Base = "$Repo/download/$($env:VC_CLI_VERSION)" }
else { $Base = "$Repo/latest/download" }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('vc-cli-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
try {
  $Pkg = Join-Path $Tmp $Asset
  $Sum = Join-Path $Tmp 'sum'
  Write-Host "下载 video-canvas-cli：$($Base)/$($Asset)"
  try {
    Invoke-WebRequest -Uri "$Base/$Asset" -OutFile $Pkg -UseBasicParsing
    Invoke-WebRequest -Uri "$Base/$Asset.sha256" -OutFile $Sum -UseBasicParsing
  }
  catch { Fail "下载失败：$($Base)/$($Asset)（GitHub 访问不畅时可设 `$env:VC_DOWNLOAD_BASE 指向镜像）" }

  $expected = ((Get-Content $Sum -Raw).Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $Pkg).Hash.ToLower()
  if (-not $expected -or $expected -ne $actual) {
    Fail "安装包校验失败（期望 $($expected)，实际 $($actual)），可能下载不完整或被篡改，已中止"
  }

  & npm.cmd install -g $Pkg
  if ($LASTEXITCODE -ne 0) { Fail 'npm 安装失败，见上面的输出' }
}
finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$prefix = (& npm.cmd prefix -g).Trim()
$vc = Join-Path $prefix 'vc.cmd'
if (-not (Test-Path $vc)) { Fail "安装完成但找不到 $($vc)" }
Write-Host ('已装好：' + (& $vc --version))

Write-Host ''
& $vc skill install
if ($LASTEXITCODE -ne 0) { Write-Host '提示：技能没装上，稍后可以手动执行 vc skill install' }

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($env:Path -split ';') -notcontains $prefix -and ($userPath -split ';') -notcontains $prefix) {
  Write-Host ''
  Write-Host "提示：$($prefix) 不在 PATH 里，加进去之后才能直接敲 vc"
}
Write-Host ''
Write-Host '下一步：vc login --base <站点接口地址>（网页「命令行（CLI）」页可复制完整命令）'
