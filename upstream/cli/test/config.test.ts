import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configDir, credentialsPath, saveCredentials } from "../src/config.ts";

const posix = process.platform !== "win32";

test("saveCredentials：目录已存在且权限过宽时收紧到 0700，文件为 0600", { skip: !posix }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vc-cfg-"));
  const env = { XDG_CONFIG_HOME: root } as NodeJS.ProcessEnv;
  fs.mkdirSync(configDir(env), { recursive: true, mode: 0o755 });
  fs.chmodSync(configDir(env), 0o755);

  saveCredentials({ base: "https://x/api/v1", token: "t" }, env);

  assert.equal(fs.statSync(configDir(env)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(credentialsPath(env)).mode & 0o777, 0o600);
});
