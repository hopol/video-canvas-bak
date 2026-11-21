// scripts/changelog-check.mjs 的纯函数测试。CI 用 `node --test scripts/tests/`，本地也可 `bun test scripts/tests/`。
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  lintUnreleased,
  needsChangelog,
  newUnreleasedEntries,
} from "../changelog-check.mjs";

const changelog = (unreleased, released = "### 修复\n\n- 旧的修复。\n") =>
  `# Changelog\n\n所有重要变更都会记录在此文件中。\n\n## [Unreleased]\n${unreleased}\n## [0.6.16] - 2026-11-17\n\n${released}`;

describe("needsChangelog", () => {
  test("feat / fix / perf 需要写日志", () => {
    assert.equal(needsChangelog("feat(canvas): 支持节点分组"), true);
    assert.equal(needsChangelog("fix: 修复保存失败"), true);
    assert.equal(needsChangelog("perf(web): 画布首屏更快"), true);
  });

  test("破坏性变更不论类型都需要写日志", () => {
    assert.equal(needsChangelog("refactor(api)!: 去掉旧接口"), true);
    assert.equal(needsChangelog("chore: 升级依赖\n\nBREAKING CHANGE: 需要 Go 1.24"), true);
  });

  test("内部维护类提交不需要", () => {
    for (const msg of ["refactor: 拆函数", "test: 补用例", "chore: 升级依赖", "ci: 调整缓存", "docs: 改说明"]) {
      assert.equal(needsChangelog(msg), false, msg);
    }
  });

  test("Changelog: skip 尾注可豁免", () => {
    assert.equal(needsChangelog("feat(agent): 内部工具改名\n\nChangelog: skip"), false);
    assert.equal(needsChangelog("fix: 测试夹具\n\nchangelog:SKIP\n"), false);
  });

  test("合并、回滚、fixup 提交不检查", () => {
    assert.equal(needsChangelog("Merge branch 'develop'"), false);
    assert.equal(needsChangelog('Revert "feat: 支持节点分组"'), false);
    assert.equal(needsChangelog("fixup! feat: 支持节点分组"), false);
    assert.equal(needsChangelog("squash! fix: 修复保存失败"), false);
  });

  test("忽略 git 注释行", () => {
    assert.equal(needsChangelog("refactor: 拆函数\n# feat: 这是注释"), false);
  });
});

describe("newUnreleasedEntries", () => {
  test("返回 Unreleased 里新增的条目", () => {
    const before = changelog("\n### 新增\n\n- 已有条目。\n");
    const after = changelog("\n### 新增\n\n- 已有条目。\n- 新条目。\n");
    assert.deepEqual(newUnreleasedEntries(before, after), ["- 新条目。"]);
  });

  test("只改已发布版本的段落不算", () => {
    const before = changelog("\n");
    const after = changelog("\n", "### 修复\n\n- 旧的修复。\n- 补写到旧版本。\n");
    assert.deepEqual(newUnreleasedEntries(before, after), []);
  });

  test("旧文件不存在时视为空", () => {
    assert.deepEqual(newUnreleasedEntries("", changelog("\n### 修复\n\n- 一条。\n")), ["- 一条。"]);
  });
});

describe("lintUnreleased", () => {
  test("合法的小节和条目没有错误", () => {
    const text = changelog("\n### 新增\n\n- 一条。\n  续行说明。\n\n### 破坏性变更\n\n- 另一条。\n");
    assert.deepEqual(lintUnreleased(text), []);
  });

  test("缺少 Unreleased 标题", () => {
    assert.match(lintUnreleased("# Changelog\n\n## [0.1.0]\n")[0], /Unreleased/);
  });

  test("不认识的小节名", () => {
    const errors = lintUnreleased(changelog("\n### Added\n\n- 一条。\n"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Added/);
  });

  test("条目必须写在小节下面、以 - 开头", () => {
    assert.equal(lintUnreleased(changelog("\n- 没有小节。\n")).length, 1);
    assert.equal(lintUnreleased(changelog("\n### 修复\n\n随手写的一行\n")).length, 1);
  });
});
