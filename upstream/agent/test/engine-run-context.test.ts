import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeRunContext } from "../src/platform-client.ts";
import { withEngine, type Env } from "./engine-helpers.ts";

/** 等到条件成立，超时就失败 */
async function until(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const runIdOf = (headers: Record<string, unknown>) => {
  const raw = headers["x-agent-context"];
  return raw ? decodeRunContext(String(raw)).run_id : undefined;
};

test("上一轮已结束、还在收尾（命名）时用户发下一条：旧一轮释放不能删掉新一轮的运行上下文", () => {
  let env: Env | undefined;
  let second: Promise<{ id: string }> | undefined;
  return withEngine(
    {
      turns: [
        { text: "第一轮的回答" },
        // 第二轮：先调一次工具（回答晚到，等第一轮释放完），再给文字；第二次模型请求发生在第一轮释放之后
        { tools: [{ id: "call_0", name: "canvas_get_state" }], delayMs: 300 },
        { text: "第二轮的回答" },
      ],
      // 第一轮已标记结束、正在请求命名的这一刻，用户发了下一条；等第二轮的首个模型请求发出后才回标题
      title: async () => {
        const e = env!;
        second = e.start({ message: "接着来" });
        const run2 = await second;
        await until(
          () => e.go.modelRequests.some((r) => runIdOf(r.headers) === run2.id),
          "第二轮发出首个模型请求",
        );
        return "会话标题";
      },
    },
    async (e) => {
      env = e;
      const run1 = await e.start({ message: "第一条" });
      await until(() => second !== undefined, "第一轮进入命名");
      const run2 = await second!;
      await e.engine.idle();

      assert.equal(e.run(run1.id).status, "succeeded");
      const reqs = e.go.modelRequests.filter((r) =>
        r.body.messages?.some?.((m: any) => JSON.stringify(m).includes("接着来")),
      );
      assert.equal(reqs.length, 2, "第二轮发了两次模型请求");
      for (const r of reqs) {
        assert.equal(runIdOf(r.headers), run2.id, "第二轮的每次模型请求都带着自己的运行上下文");
      }
      assert.equal(e.run(run2.id).status, "succeeded");
    },
    { autoTitle: true },
  );
});
