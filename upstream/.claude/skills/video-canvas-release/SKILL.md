---
name: video-canvas-release
description: 发布 video-canvas 新版本；根据上个版本以来合并的 PR 和提交起草面向用户的版本日志，确认后写入 CHANGELOG，再更新 VERSION、创建并推送 Git 标签。
metadata:
  short-description: 发布 video-canvas 版本
---

# video-canvas 发版

用于用户要求发布 video-canvas 新版本时。项目目录固定为 `/Users/Zhuanz/Desktop/video-canvas`，版本文件为 `/Users/Zhuanz/Desktop/video-canvas/VERSION`。

## 版本判定

先读取 `VERSION`，要求内容是 `MAJOR.MINOR.PATCH` 三段数字：

- 用户没有提供版本号：`PATCH + 1`，例如 `0.1.6 → 0.1.7`。
- 用户说“需求版本”或明确要求中间版本，但没有给出完整三段：`MINOR + 1` 且 `PATCH = 0`，例如 `0.1.6 → 0.2.0`。
- 用户提供两段版本（例如 `0.2`、`0.2.x`）：视为需求版本，生成 `0.2.0`。
- 用户提供完整三段版本（例如 `0.1.7`）：使用该版本，不自动改写。
- 大版本只在用户明确提供时改变；版本号必须是非负整数，目标版本必须大于当前版本。

如果用户同时给出互相冲突的版本表达，以明确的完整三段版本为准；无法判断时停下并询问。

## 版本日志规则

版本日志面向使用 video-canvas 的用户，不是 Git 提交的复制品。开发时不写日志（见 `CONTRIBUTING.md`「版本日志」），发版时由本技能根据上个版本以来合并的 PR（标题、描述里的「用户能感受到的变化」、代码差异）和直接推到 `master` 的提交起草，用户确认后才写入。

只保留用户可感知或需要采取行动的变化：

- `新增`：用户可以完成的新功能。
- `改进`：性能、稳定性、体验或兼容性改善。
- `修复`：用户遇到的问题及修复结果。
- `废弃`：将要移除的功能或接口，以及替代方案。
- `破坏性变更`：升级时必须修改配置、调用方式或数据的变化。
- `文档`：影响使用、部署或迁移的重要文档变化。

过滤以下内容，不写入用户版本日志：更新 CHANGELOG、版本号或发布 skill；合并分支；格式化和内部代码整理；没有用户影响的测试、依赖和 CI 维护；只描述实现细节、函数名、文件名或内部重命名的提交。

每条日志使用简体中文，描述用户结果，尽量一条只写一件事。用用户口吻说大白话，让不懂技术的人也能看懂，不用技术术语（细则见 `CONTRIBUTING.md`「版本日志」）；PR 标题和提交信息多是开发视角，起草时要改写成这种口吻。无法从提交、代码差异、测试或 PR 描述确认的内容标记为“待确认”，不得猜测。

## 发版流程

1. 进入项目目录，读取 `git status --short --branch`、`VERSION`、远端标签和当前提交。不要覆盖用户已有的未提交改动；工作区不干净时先说明并停止。
2. 根据上面的规则计算目标版本。确认本地和远端不存在同名 `v<version>` 标签。
3. 收集素材：找到最近的发布标签 `v<previous-version>`，对 `v<previous-version>..HEAD`：
   - 用 `git log --first-parent --format='%h %s' v<previous-version>..HEAD` 列出 `master` 上的提交。`Merge pull request #N` 对应的 PR 用 `gh pr view N --json title,body,labels,files` 读取标题、描述（重点是「用户能感受到的变化」）和改动文件；其余是直接推到 `master` 的提交，读提交信息。
   - `CHANGELOG.md` 的 `## [Unreleased]` 如果已有条目（早期开发时写的），一并纳入。
   - 没有任何待发布改动时停下告诉用户。
4. 判断用户影响：`feat` / `fix` / `perf` 和破坏性变更逐条确认用户能感受到什么；PR 描述写了「无」或只是内部改动的，按「版本日志规则」过滤。标题和描述说不清时读代码差异，不要只根据标题猜测；仍无法确认的标“待确认”。
5. 起草：按“版本日志规则”写成面向用户的条目，合并同一功能的多个 PR，按 `新增`、`改进`、`修复`、`废弃`、`破坏性变更`、`文档` 排序。每条后面先附上来源 PR 编号或提交号方便核对（写入时去掉）。把草稿连同“待确认”和被过滤掉的 PR 清单展示给用户，等待确认或修改；确认前不得改写 `CHANGELOG.md`、提交、创建标签或推送。
6. 用户确认后写入 `CHANGELOG.md`：在 `## [Unreleased]` 下方插入 `## [<version>] - YYYY-MM-DD` 和确认后的条目，清空 `[Unreleased]` 里原有的条目（已并入新版本）；不写 `Update changelog` 等维护记录；保留已有历史版本，不改写历史事实；更新底部版本比较链接（如果文件使用比较链接）。
7. 检查 `CHANGELOG.md` 中目标版本存在且至少有一条用户可见变更、小节名只用上面六种、条目以 `- ` 开头、顶部 `[Unreleased]` 为空。同时把 `VERSION` 改为目标版本，与 `CHANGELOG.md` 一起提交：`docs: update changelog for v<version>`。CI 不再回写 `VERSION`，只会校验它与标签一致，所以必须在打标签前提交。
8. 创建带说明的标签：`git tag -a v<version> -m "Release v<version>"`，然后推送：`git push origin v<version>`。
9. 通过 `gh run list` 等待并核对 `Release Docker images`（其中 `validate` 作业先校验标签、`VERSION` 与 CHANGELOG，`release` 作业在镜像推送成功后才创建 Release）：发布说明应来自已确认的 `CHANGELOG.md`，`VERSION` 校验、质量检查和镜像发布都成功后才算完成。若任务只要求创建标签，可在标签推送成功后返回标签地址，并说明工作流状态。
10. 最终报告目标版本、标签、Release 地址、工作流地址和每项验证结果。不要把密钥、令牌或运行时数据写入仓库。

## 本仓库发布约定

推送 `v*` 标签会触发：

- `.github/workflows/release-docker.yml` 的 `release` 作业：镜像推送成功后，校验 `VERSION` 与标签一致，并生成 GitHub Release；不会再向 `master` 推送提交，因此本地不会因发版而分叉。
- `.github/workflows/release-docker.yml`：执行质量检查并构建、推送 backend/web 镜像。

标签格式必须是 `vMAJOR.MINOR.PATCH`，例如 `v0.1.7`。
