import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { APIError } from "../src/client.ts";
import { askYes } from "../src/commands/index.ts";
import type { Ctx } from "../src/types.ts";
import {
  hasPty,
  ok,
  runCli,
  runInPty,
  startSite,
  tempConfig,
  type Handler,
} from "./helpers/site.ts";

const GRAPH = {
  nodes: [
    { id: "n_a", type: "canvas", data: { kind: "script", label: "旁白" } },
    { id: "n_b", type: "canvas", data: { kind: "video", label: "镜头1" } },
  ],
  edges: [{ id: "e1", source: "n_b", target: "n_a" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const canvasHandler: Handler = (req) => {
  if (req.method === "GET" && req.path === "/api/v1/canvas/c1") {
    return ok({ id: "c1", title: "测试画布", revision: 7, payload_json: GRAPH });
  }
  if (req.method === "PUT" && req.path === "/api/v1/canvas/c1") {
    return ok({ id: "c1", title: "测试画布", revision: 8 });
  }
  if (req.method === "POST" && req.path === "/api/v1/canvas/c1/ops") {
    return ok({ revision: 8, changes: [] });
  }
  return undefined;
};

const writePayload = (nodes: unknown[]): string => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-pl-")), "graph.json");
  fs.writeFileSync(file, JSON.stringify({ ...GRAPH, nodes }));
  return file;
};

const puts = (site: { requests: Array<{ method: string }> }): number =>
  site.requests.filter((r) => r.method === "PUT").length;

test("canvas save：必须显式 --revision，缺了就报错并指路 canvas graph，且不发请求", async () => {
  const site = await startSite(canvasHandler);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const res = await runCli(["canvas", "save", "c1", "--payload", writePayload(GRAPH.nodes)], env);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--revision/);
    assert.match(res.stderr, /canvas graph/);
    assert.equal(site.requests.length, 0);
  } finally {
    await site.close();
  }
});

test("canvas save：不删节点时无需终端确认，带上给定的 revision 保存", async () => {
  const site = await startSite(canvasHandler);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const extra = [...GRAPH.nodes, { id: "n_c", type: "canvas", data: { kind: "image" } }];
    const res = await runCli(
      ["canvas", "save", "c1", "--payload", writePayload(extra), "--revision", "7"],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const put = site.requests.find((r) => r.method === "PUT");
    assert.equal(put?.body.revision, 7);
    assert.equal(put?.body.payload_json.nodes.length, 3);
  } finally {
    await site.close();
  }
});

test("canvas save：新图会删除节点时，非交互终端与 --json 都拒绝，且不保存", async () => {
  const site = await startSite(canvasHandler);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const file = writePayload([GRAPH.nodes[0]]);
    const plain = await runCli(["canvas", "save", "c1", "--payload", file, "--revision", "7"], env);
    assert.equal(plain.code, 2);
    assert.match(plain.stderr, /需要交互确认/);
    const json = await runCli(
      ["canvas", "save", "c1", "--payload", file, "--revision", "7", "--json"],
      env,
    );
    assert.equal(json.code, 2);
    assert.match(json.stdout, /不能与 --json 一起用/);
    assert.equal(puts(site), 0);
  } finally {
    await site.close();
  }
});

test(
  "canvas save：删节点的整图保存，终端里输入 yes 才提交；别的输入取消",
  { skip: !hasPty },
  async () => {
    const site = await startSite(canvasHandler);
    try {
      const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
      const argv = [
        "canvas",
        "save",
        "c1",
        "--payload",
        writePayload([GRAPH.nodes[0]]),
        "--revision",
        "7",
      ];
      const no = await runInPty(argv, env, "no");
      assert.equal(no.code, 4);
      assert.equal(puts(site), 0, "取消时不能保存");
      const yes = await runInPty(argv, env, "yes");
      assert.equal(yes.code, 0, yes.stdout);
      assert.match(yes.stdout, /n_b/, "确认前要把将被删除的节点列出来");
      assert.equal(puts(site), 1);
    } finally {
      await site.close();
    }
  },
);

test("canvas graph：任何输出方式都带上 revision（stdout 只放图时写到 stderr）", async () => {
  const site = await startSite(canvasHandler);
  try {
    const root = tempConfig({ base: site.base, token: "t" });
    const env = { XDG_CONFIG_HOME: root };
    const piped = await runCli(["canvas", "graph", "c1", "-o", "-"], env);
    assert.equal(piped.code, 0);
    assert.equal(JSON.parse(piped.stdout).nodes.length, 2, "stdout 只能是图本身");
    assert.match(piped.stderr, /版本：?\s*7/);

    const plain = await runCli(["canvas", "graph", "c1"], env);
    assert.equal(JSON.parse(plain.stdout).nodes.length, 2);
    assert.match(plain.stderr, /7/);

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-g-")), "g.json");
    const json = await runCli(["canvas", "graph", "c1", "-o", file, "--json"], env);
    const body = JSON.parse(json.stdout) as {
      ok: boolean;
      data: { revision: number; file: string };
    };
    assert.equal(body.data.revision, 7);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).nodes.length, 2);
    const human = await runCli(["canvas", "graph", "c1", "-o", file], env);
    assert.match(human.stdout, /--revision 7/, "给出下一步 save 要用的 revision");
  } finally {
    await site.close();
  }
});

test("canvas export：已有同名文件不覆盖，加 --force 才覆盖", async () => {
  const site = await startSite((req) =>
    req.path === "/api/v1/canvas/c1/export"
      ? ok({ document: { format: "x", canvas: {} } })
      : undefined,
  );
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ex-"));
    const target = path.join(dir, "out.json");
    fs.writeFileSync(target, "ORIGINAL");

    const refused = await runCli(["canvas", "export", "c1", "-o", target], env);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /--force/);
    assert.equal(fs.readFileSync(target, "utf8"), "ORIGINAL");

    const forced = await runCli(["canvas", "export", "c1", "-o", target, "--force"], env);
    assert.equal(forced.code, 0, forced.stderr);
    assert.match(fs.readFileSync(target, "utf8"), /"format"/);

    // 默认文件名 canvas-<code>.json 也受同样保护
    fs.writeFileSync(path.join(dir, "canvas-c1.json"), "KEEP");
    const byDefault = await runCli(["canvas", "export", "c1"], env, { cwd: dir });
    assert.equal(byDefault.code, 2);
    assert.equal(fs.readFileSync(path.join(dir, "canvas-c1.json"), "utf8"), "KEEP");
  } finally {
    await site.close();
  }
});

test("canvas node rm：重复的节点 id 只提交一次", { skip: !hasPty }, async () => {
  const site = await startSite(canvasHandler);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const res = await runInPty(["canvas", "node", "rm", "c1", "n_b", "n_b"], env, "yes");
    assert.equal(res.code, 0, res.stdout);
    const ops = site.requests.find((r) => r.path.endsWith("/ops"));
    assert.deepEqual(ops?.body.deleteNodeIds, ["n_b"]);
  } finally {
    await site.close();
  }
});

test("generate --input @文件：文件内容必须是 JSON 对象，数组直接报用法错误且不发请求", async () => {
  const site = await startSite(() => undefined);
  try {
    const env = { XDG_CONFIG_HOME: tempConfig({ base: site.base, token: "t" }) };
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-in-")), "in.json");
    fs.writeFileSync(file, "[1,2]");
    const res = await runCli(["generate", "image", "--model", "m", "--input", `@${file}`], env);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /JSON 对象/);
    assert.equal(site.requests.length, 0);
  } finally {
    await site.close();
  }
});

test("askYes：输入流在没答案前就结束（Ctrl-D）时明确取消，退出码 4，而不是悬空", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const ctx = { stderr: () => {} } as unknown as Ctx;
  const pending = askYes(ctx, "确认？", "已取消", { input, output });
  input.end();
  await assert.rejects(
    pending,
    (err: unknown) =>
      err instanceof APIError && err.exitCode === 4 && /输入已结束/.test(err.message),
  );
});

test("askYes：输入 yes 通过，其它输入取消", async () => {
  const feed = async (line: string): Promise<void> => {
    const input = new PassThrough();
    const pending = askYes({} as Ctx, "确认？", "已取消", {
      input,
      output: new PassThrough(),
    });
    input.write(`${line}\n`);
    await pending;
  };
  await feed("yes");
  await assert.rejects(feed("no"), (err: unknown) => err instanceof APIError && err.exitCode === 4);
});
