import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { useEffect, useState } from "react";

import type {
  StoryboardSplitJob,
  StoryboardSplitRequest,
  StoryboardSplitStatus,
} from "@/api/storyboard/type";
import type { useModelsStore as UseModelsStore } from "@/store/models";
import type { useStoryboardSplit as UseSplitStore } from "@/store/storyboard-split";
import type { ApiError as ApiErrorClass } from "@/utils/requests/request";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { CanvasEdge, CanvasNode, StoryboardShot } from "@/types";

/**
 * 分镜表「从剧本拆分镜」的界面：用 jsdom 挂载真实的弹窗、覆盖确认框、拆分状态和画布里的同步组件，
 * 只把后端接口换成可控的假实现。拆分是异步任务：提交只拿到 pending 快照，结果靠 WebSocket 推送，
 * 测试里用 handleStoryboardSplitEvent 模拟推送。
 * 检查入口是否可点、剧本按连线顺序拼接、覆盖 / 追加 / 取消、进行中锁表、失败横幅与重试，
 * 以及关弹窗、刷新页面、断线重连后任务结果能不能找回来。
 */

const calls: StoryboardSplitRequest[] = [];
let seq = 0;
let submitImpl: (body: StoryboardSplitRequest) => Promise<StoryboardSplitJob>;
let getJobImpl: (jobId: string) => Promise<StoryboardSplitJob>;
let activeImpl: (nodeId: string) => Promise<StoryboardSplitJob | null>;
const jobLookups: string[] = [];
const activeLookups: string[] = [];
mock.module("@/api/storyboard", () => ({
  splitStoryboard: (_canvasId: string, body: StoryboardSplitRequest) => {
    calls.push(body);
    return submitImpl(body);
  },
  getStoryboardSplitJob: (_canvasId: string, jobId: string) => {
    jobLookups.push(jobId);
    return getJobImpl(jobId);
  },
  getActiveStoryboardSplit: (_canvasId: string, nodeId: string) => {
    activeLookups.push(nodeId);
    return activeImpl(nodeId);
  },
}));

let dom: DomEnv;
let useSplit: typeof UseSplitStore;
let useModels: typeof UseModelsStore;
let ApiErrorCtor: typeof ApiErrorClass;
let handleEvent: (job: StoryboardSplitJob) => void;
let reconcile: () => Promise<void>;
let Harness: (props: {
  shots?: StoryboardShot[];
  scripts?: string[];
  script?: string;
}) => React.ReactElement;
let latest: () => StoryboardShot[];
/** 测试里手动关弹窗、删节点用的开关 */
const ctl: { closeDialog: () => void; removeNode: () => void } = {
  closeDialog: () => {},
  removeNode: () => {},
};

const apiShot = (scene: string) => ({
  scene,
  shot: "近景",
  camera: "推",
  action: "",
  dialogue: "",
  duration: 4,
});
const job = (
  id: string,
  status: StoryboardSplitStatus,
  extra: Partial<StoryboardSplitJob> = {},
): StoryboardSplitJob => ({
  id,
  canvas_id: "c1",
  node_id: "sb",
  status,
  model: "agent-a",
  credits: 0,
  ...extra,
});
/** 跑完的任务：带镜头和实扣积分 */
const done = (id: string, ...scenes: string[]) =>
  job(id, "succeeded", { shots: scenes.map(apiShot), credits: 5 });
/** 最近一次提交拿到的任务 id */
const lastId = () => `j${seq}`;

beforeAll(async () => {
  dom = await installDom();
  const { ReactFlowProvider, useNodes, useReactFlow, useStoreApi } = await import("@xyflow/react");
  const { StoryboardDialog } = await import("@/components/storyboard/storyboard-dialog");
  const { SplitOverwriteDialog } = await import("@/components/storyboard/split-ui");
  const { StoryboardSplitSync } = await import("@/components/storyboard/split-sync");
  const { CanvasIdContext } = await import("@/utils/canvas/canvas-id");
  const sync = await import("@/utils/storyboard/split-sync");
  handleEvent = sync.handleStoryboardSplitEvent;
  reconcile = sync.reconcileStoryboardSplit;
  useSplit = (await import("@/store/storyboard-split")).useStoryboardSplit;
  useModels = (await import("@/store/models")).useModelsStore;
  ApiErrorCtor = (await import("@/utils/requests/request")).ApiError;
  const seen: { shots: StoryboardShot[] } = { shots: [] };
  latest = () => seen.shots;

  function Body() {
    // 只有 Provider 没有 <ReactFlow> 时，store 默认不收节点改动；按画布里非受控的方式打开
    const store = useStoreApi<CanvasNode>();
    if (!store.getState().hasDefaultNodes) store.setState({ hasDefaultNodes: true });
    const { deleteElements } = useReactFlow<CanvasNode, CanvasEdge>();
    const [open, setOpen] = useState(true);
    const node = useNodes<CanvasNode>().find((n) => n.id === "sb");
    const board = node?.data.storyboard ?? { shots: [] };
    useEffect(() => {
      seen.shots = board.shots;
      ctl.closeDialog = () => setOpen(false);
      ctl.removeNode = () => void deleteElements({ nodes: [{ id: "sb" }] });
    });
    return (
      <>
        <StoryboardSplitSync />
        {node && (
          <StoryboardDialog
            id="sb"
            label={node.data.label}
            board={board}
            open={open}
            focusShotId={null}
            onOpenChange={() => {}}
          />
        )}
        <SplitOverwriteDialog id="sb" />
      </>
    );
  }
  Harness = ({ shots = [], scripts = ["第一段剧本"], script }) => {
    const scriptNode = (i: number, text: string): CanvasNode => ({
      id: `s${i}`,
      type: "canvas",
      position: { x: 0, y: i * 100 },
      data: { kind: "script", label: `剧本${i}`, text },
    });
    const texts = script === undefined ? scripts : [script];
    const edges: CanvasEdge[] = texts.map((_, i) => ({
      id: `xy-edge__s${i}-sb`,
      source: `s${i}`,
      target: "sb",
    }));
    return (
      <CanvasIdContext.Provider value="c1">
        <ReactFlowProvider
          initialNodes={[
            {
              id: "sb",
              type: "canvas",
              position: { x: 700, y: 0 },
              data: { kind: "storyboard", label: "分镜表", storyboard: { shots } },
            },
            ...texts.map((t, i) => scriptNode(i, t)),
          ]}
          initialEdges={edges}
        >
          <Body />
        </ReactFlowProvider>
      </CanvasIdContext.Provider>
    );
  };
});
afterAll(() => {
  useModels.setState({ byKind: {} });
  dom.restore();
});

beforeEach(() => {
  calls.length = 0;
  jobLookups.length = 0;
  activeLookups.length = 0;
  dom.win.localStorage.clear();
  submitImpl = async () => job(`j${++seq}`, "pending");
  getJobImpl = async (id) => job(id, "running");
  activeImpl = async () => null;
  useSplit.setState({ states: {}, overwrite: null, highlights: {}, model: "" });
  useModels.setState({
    byKind: {
      agent: {
        status: "ready",
        loadedAt: Date.now(),
        models: [{ key: "agent-a", label: "Agent A", vendor: "x" }],
      },
    } as never,
  });
});

const shot = (id: string, scene: string): StoryboardShot => ({
  id,
  scene,
  shot: "中景",
  camera: "固定",
  action: "",
  dialogue: "",
  duration: 3,
});

/** 挂载并登记：用例中途断言失败也会在 afterEach 里卸载，免得残留的 DOM 让后面的查询命中旧弹窗 */
const mounted: Array<() => Promise<void>> = [];
async function mount(element: React.ReactElement) {
  const m = await dom.mount(element);
  let done = false;
  const unmount = async () => {
    if (done) return;
    done = true;
    await m.unmount();
  };
  mounted.push(unmount);
  return { ...m, unmount };
}
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
});

const body = () => dom.win.document.body;
const buttons = () => Array.from(body().querySelectorAll<HTMLButtonElement>("button"));
const buttonByText = (text: string) =>
  buttons().find((b) => b.textContent?.replace(/\s+/g, "").includes(text)) ?? null;
const splitButton = () => buttonByText("从剧本拆分镜");

/** 模拟后端推送一份任务快照 */
const push = async (j: StoryboardSplitJob) => {
  await dom.act(async () => {
    handleEvent(j);
  });
  await dom.flush();
};

/** 点按钮提交一次拆分镜并等提交返回 */
const submit = async () => {
  await dom.click(splitButton());
  await dom.flush();
};

describe("拆分镜入口", () => {
  test("没连剧本时按钮禁用，悬停提示「请先连接剧本节点」（AC4）", async () => {
    const m = await mount(<Harness scripts={[]} />);
    await dom.flush();
    const btn = splitButton();
    expect(btn?.disabled).toBe(true);
    expect(btn?.closest("[title]")?.getAttribute("title")).toBe("请先连接剧本节点");
    await m.unmount();
  });

  test("连了剧本但没内容：禁用并提示「剧本节点还没有内容」", async () => {
    const m = await mount(<Harness scripts={["  "]} />);
    await dom.flush();
    expect(splitButton()?.disabled).toBe(true);
    expect(splitButton()?.closest("[title]")?.getAttribute("title")).toBe("剧本节点还没有内容");
    await m.unmount();
  });

  test("空表：标题栏和空状态各有一个拆分镜入口，点任一个都直接开拆", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    expect(
      buttons().filter((b) => b.textContent?.includes("从剧本拆分镜")).length,
    ).toBeGreaterThanOrEqual(2);
    await submit();
    expect(calls).toHaveLength(1);
    await push(done(lastId(), "月夜瓜地", "闰土举叉"));
    expect(latest().map((s) => s.scene)).toEqual(["月夜瓜地", "闰土举叉"]);
    await m.unmount();
  });
});

describe("拆分镜按钮的样子", () => {
  test("弹窗标题栏里有模型下拉，「从剧本拆分镜」按钮只有文字、没有图标", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    expect(body().textContent).toContain("Agent A");
    const title = buttons().find((b) => b.getAttribute("aria-label") === "从剧本拆分镜");
    expect(title).toBeTruthy();
    expect(title!.querySelector("svg")).toBeNull();
    // 空状态里的主按钮同样不带图标
    const empty = buttons().find(
      (b) =>
        b !== title && b.textContent?.includes("从剧本拆分镜") && !b.getAttribute("aria-label"),
    );
    expect(empty).toBeTruthy();
    expect(empty!.querySelector("svg")).toBeNull();
    await m.unmount();
  });

  test("拆分中按钮换成转圈的图标，给出进行中的反馈", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    const busy = buttons().find((b) => b.getAttribute("aria-label") === "拆分中");
    expect(busy?.querySelector("svg")).not.toBeNull();
    await push(done(lastId(), "甲"));
    await m.unmount();
  });
});

describe("双击不能冒泡到画布（否则会弹出「添加节点」菜单）", () => {
  /** 在画布外层放一个双击监听，等同画布的 onDoubleClick；点中弹窗里的东西后它不该收到 */
  const withCanvasListener = async (shots: StoryboardShot[]) => {
    const spy = mock(() => {});
    const m = await mount(
      <div onDoubleClick={spy}>
        <Harness shots={shots} />
      </div>,
    );
    await dom.flush();
    return { spy, m };
  };
  const dblclick = (el: Element | null) =>
    dom.act(async () => {
      el?.dispatchEvent(new dom.win.MouseEvent("dblclick", { bubbles: true }));
    });

  test("双击弹窗里的文本框、表头、标题栏都不触发画布的双击", async () => {
    const { spy, m } = await withCanvasListener([shot("a", "旧一")]);
    await dblclick(body().querySelector('[aria-label="第 1 镜的画面描述"]'));
    await dblclick(body().querySelector('[data-slot="dialog-content"]'));
    await dblclick(buttons().find((b) => b.getAttribute("aria-label") === "从剧本拆分镜") ?? null);
    expect(spy).not.toHaveBeenCalled();
    await m.unmount();
  });

  test("双击覆盖确认框也不触发画布的双击", async () => {
    const { spy, m } = await withCanvasListener([shot("a", "旧一")]);
    await dom.click(splitButton());
    await dom.flush();
    await dblclick(body().querySelector('[data-slot="alert-dialog-content"]'));
    expect(spy).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe("拆分结果写回", () => {
  test("多个剧本按连线先后拼接成一份正文，选的模型一起带上", async () => {
    useSplit.getState().setModel("agent-a");
    const m = await mount(<Harness scripts={["第一段", "第二段"]} />);
    await dom.flush();
    await submit();
    expect(calls[0]).toEqual({ node_id: "sb", script: "第一段\n\n第二段", model: "agent-a" });
    await m.unmount();
  });

  test("3000 字以上的剧本整份提交，不在前端截断", async () => {
    const long = "月夜，瓜地。闰土手捏钢叉，向一匹猹尽力刺去。".repeat(150);
    expect(long.length).toBeGreaterThan(3000);
    const m = await mount(<Harness script={long} />);
    await dom.flush();
    await submit();
    expect(calls[0].script).toBe(long);
    await m.unmount();
  });

  test("提交只拿到 pending：表格不变、进入进行中，结果推送到了才写回", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    expect(latest()).toEqual([]);
    expect(useSplit.getState().stateOf("sb").phase).toBe("running");
    await push(job(lastId(), "running"));
    expect(latest()).toEqual([]);
    expect(useSplit.getState().stateOf("sb").phase).toBe("running");
    await push(done(lastId(), "甲", "乙"));
    expect(latest().map((s) => s.scene)).toEqual(["甲", "乙"]);
    await m.unmount();
  });

  test("镜头在前端分配 id，字段原样；新行被标记高亮，状态回到空闲", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    await push(done(lastId(), "甲", "乙"));
    const shots = latest();
    expect(shots).toHaveLength(2);
    expect(new Set(shots.map((s) => s.id)).size).toBe(2);
    expect(shots[0]).toMatchObject({ scene: "甲", shot: "近景", camera: "推", duration: 4 });
    expect(useSplit.getState().stateOf("sb").phase).toBe("idle");
    expect(useSplit.getState().highlights["sb"]?.size).toBe(2);
    await m.unmount();
  });

  test("同一个结果推送了两遍（推送加补查）只写一次", async () => {
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    await submit();
    await dom.click(buttonByText("追加到末尾"));
    await dom.flush();
    const finished = done(lastId(), "新一");
    await push(finished);
    await push(finished);
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "新一"]);
    await m.unmount();
  });

  test("推送比提交的响应先到：结果照样写回，不会卡在进行中", async () => {
    let release!: (j: StoryboardSplitJob) => void;
    submitImpl = () => new Promise((res) => (release = res));
    const m = await mount(<Harness />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    await push(done("j-early-13", "甲"));
    await dom.act(async () => release(job("j-early-13", "pending")));
    await dom.flush();
    expect(latest().map((s) => s.scene)).toEqual(["甲"]);
    expect(useSplit.getState().stateOf("sb").phase).toBe("idle");
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });

  test("别的画布的推送不处理", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    await push({ ...done(lastId(), "甲"), canvas_id: "other" });
    expect(latest()).toEqual([]);
    expect(useSplit.getState().stateOf("sb").phase).toBe("running");
    await m.unmount();
  });
});

describe("覆盖 / 追加 / 取消（AC3）", () => {
  const open = async () => {
    const m = await mount(<Harness shots={[shot("a", "旧一"), shot("b", "旧二")]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    return m;
  };

  test("表里已有镜头：先弹确认框，标题给出现状数字，此时不调模型", async () => {
    const m = await open();
    expect(body().textContent).toContain("分镜表里已有 2 个镜头");
    expect(calls).toHaveLength(0);
    await m.unmount();
  });

  test("追加到末尾：旧镜头原样在前，新镜头接在后面", async () => {
    const m = await open();
    await dom.click(buttonByText("追加到末尾"));
    await dom.flush();
    await push(done(lastId(), "新一", "新二", "新三"));
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "旧二", "新一", "新二", "新三"]);
    expect(latest()[0].id).toBe("a");
    await m.unmount();
  });

  test("覆盖：整表换成新镜头", async () => {
    const m = await open();
    await dom.click(buttonByText("覆盖"));
    await dom.flush();
    await push(done(lastId(), "新一"));
    expect(latest().map((s) => s.scene)).toEqual(["新一"]);
    await m.unmount();
  });

  test("取消：不调模型，表格不变", async () => {
    const m = await open();
    await dom.click(buttonByText("取消"));
    await dom.flush();
    expect(calls).toHaveLength(0);
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "旧二"]);
    expect(useSplit.getState().overwrite).toBeNull();
    await m.unmount();
  });
});

describe("拆分中", () => {
  test("显示进度条、表格锁住不能编辑、按钮变成「拆分中」且不可再点（追加模式末尾出骨架）", async () => {
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.click(buttonByText("追加到末尾"));
    await dom.flush();
    expect(body().querySelector('[role="progressbar"]')).not.toBeNull();
    expect(body().querySelector("[inert]")).not.toBeNull();
    expect(body().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    const busy = buttonByText("拆分中");
    expect(busy?.disabled).toBe(true);
    await push(done(lastId(), "新一"));
    expect(body().querySelector('[role="progressbar"]')).toBeNull();
    expect(body().querySelector("[inert]")).toBeNull();
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "新一"]);
    await m.unmount();
  });

  test("空表拆分中：显示「正在拆分镜」和骨架行", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    expect(body().textContent).toContain("正在拆分镜");
    expect(body().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await push(done(lastId(), "甲"));
    await m.unmount();
  });

  test("同一张表已经在拆（后端回 30014）：不报失败，恢复成进行中", async () => {
    submitImpl = async () => {
      throw new ApiErrorCtor("这张分镜表正在拆分镜", 30014, 409);
    };
    const m = await mount(<Harness />);
    await dom.flush();
    activeImpl = async () => job("j-running-21", "running");
    activeLookups.length = 0;
    await submit();
    expect(activeLookups).toEqual(["sb"]);
    expect(body().querySelector('[role="alert"]')).toBeNull();
    expect(useSplit.getState().stateOf("sb").phase).toBe("running");
    await push(done("j-running-21", "甲"));
    expect(latest().map((s) => s.scene)).toEqual(["甲"]);
    await m.unmount();
  });
});

describe("关弹窗、刷新页面、断线重连后找回任务", () => {
  test("拆分中关掉弹窗：任务不受影响，结果推送到了照样写进分镜表", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    await dom.act(async () => ctl.closeDialog());
    await dom.flush();
    expect(useSplit.getState().stateOf("sb").phase).toBe("running");
    await push(done(lastId(), "甲", "乙"));
    expect(latest().map((s) => s.scene)).toEqual(["甲", "乙"]);
    await m.unmount();
  });

  test("提交后本机记下任务 id 和覆盖 / 追加，写回后忘掉", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    const remembered = JSON.parse(dom.win.localStorage.getItem("storyboard-split-jobs") ?? "{}");
    expect(remembered["c1:sb"]).toEqual({ jobId: lastId(), mode: "replace" });
    await push(done(lastId(), "甲"));
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });

  test("刷新页面：按本机记的任务 id 补查，还在跑就恢复进行中，之后收到推送照常写回（沿用当时选的覆盖）", async () => {
    dom.win.localStorage.setItem(
      "storyboard-split-jobs",
      JSON.stringify({ "c1:sb": { jobId: "j-old-24", mode: "replace" } }),
    );
    getJobImpl = async (id) => job(id, "running");
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    expect(jobLookups).toEqual(["j-old-24"]);
    expect(useSplit.getState().stateOf("sb")).toMatchObject({ phase: "running", mode: "replace" });
    expect(body().querySelector('[role="progressbar"]')).not.toBeNull();
    await push(done("j-old-24", "新一"));
    expect(latest().map((s) => s.scene)).toEqual(["新一"]);
    await m.unmount();
  });

  test("刷新页面时任务已经跑完：补查到结果直接写进分镜表", async () => {
    dom.win.localStorage.setItem(
      "storyboard-split-jobs",
      JSON.stringify({ "c1:sb": { jobId: "j-old-25", mode: "append" } }),
    );
    getJobImpl = async (id) => done(id, "新一", "新二");
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "新一", "新二"]);
    expect(useSplit.getState().stateOf("sb").phase).toBe("idle");
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });

  test("刷新页面时任务已经失败：显示失败横幅和原因", async () => {
    dom.win.localStorage.setItem(
      "storyboard-split-jobs",
      JSON.stringify({ "c1:sb": { jobId: "j-old-26", mode: "append" } }),
    );
    getJobImpl = async (id) => job(id, "failed", { error: "模型调用超时" });
    const m = await mount(<Harness />);
    await dom.flush();
    expect(body().querySelector('[role="alert"]')?.textContent).toContain("模型调用超时");
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });

  test("本机没有记录（换了浏览器、清了缓存）：按节点查进行中的任务恢复状态", async () => {
    activeImpl = async () => job("j-other-27", "running");
    const m = await mount(<Harness />);
    await dom.flush();
    expect(activeLookups).toEqual(["sb"]);
    expect(jobLookups).toEqual([]);
    expect(useSplit.getState().stateOf("sb").phase).toBe("running");
    await m.unmount();
  });

  test("记着的任务后端已查不到（30017）：忘掉它，不挂在进行中", async () => {
    dom.win.localStorage.setItem(
      "storyboard-split-jobs",
      JSON.stringify({ "c1:sb": { jobId: "j-gone-28", mode: "append" } }),
    );
    getJobImpl = async () => {
      throw new ApiErrorCtor("拆分镜任务不存在", 30017, 404);
    };
    const m = await mount(<Harness />);
    await dom.flush();
    expect(useSplit.getState().stateOf("sb").phase).toBe("idle");
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });

  test("补查失败（网络断了）：保留记录，不当成失败，下次对账再查", async () => {
    dom.win.localStorage.setItem(
      "storyboard-split-jobs",
      JSON.stringify({ "c1:sb": { jobId: "j-old-29", mode: "append" } }),
    );
    getJobImpl = async () => {
      throw new ApiErrorCtor("网络异常", 0, 0);
    };
    const m = await mount(<Harness />);
    await dom.flush();
    expect(body().querySelector('[role="alert"]')).toBeNull();
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).not.toBeNull();
    await m.unmount();
  });

  test("断线重连：推送期间漏了，重连后的对账能把结果补回来", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    getJobImpl = async (id) => done(id, "甲");
    await dom.act(async () => reconcile());
    await dom.flush();
    expect(jobLookups).toEqual([lastId()]);
    expect(latest().map((s) => s.scene)).toEqual(["甲"]);
    await m.unmount();
  });

  test("拆分期间节点被删了：结果没有地方可写，不留失败横幅，也不再挂着进行中", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    await dom.act(async () => ctl.removeNode());
    await dom.flush();
    await push(done(lastId(), "甲"));
    expect(useSplit.getState().stateOf("sb").phase).toBe("idle");
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });
});

describe("拆分失败（AC2 的失败路径）", () => {
  test("提交就被拒（积分不足等）：横幅说明原因，不留任务记录", async () => {
    submitImpl = async () => {
      throw new ApiErrorCtor("积分不足", 40001, 402);
    };
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    expect(body().querySelector('[role="alert"]')?.textContent).toContain("积分不足");
    expect(dom.win.localStorage.getItem("storyboard-split-jobs")).toBeNull();
    await m.unmount();
  });

  test("后台任务失败：表格保持原样，横幅说明原因；点重试沿用同样的模式再提交一次，成功后横幅消失", async () => {
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.click(buttonByText("覆盖"));
    await dom.flush();
    await push(job(lastId(), "failed", { error: "文本模型调用失败：rate limited" }));
    expect(body().querySelector('[role="alert"]')?.textContent).toContain(
      "拆分镜失败：文本模型调用失败：rate limited",
    );
    expect(latest().map((s) => s.scene)).toEqual(["旧一"]);

    await dom.click(buttonByText("重试"));
    await dom.flush();
    expect(calls).toHaveLength(2);
    expect(body().querySelector('[role="alert"]')).toBeNull();
    await push(done(lastId(), "重试成功"));
    // 第一次选的是覆盖，重试也是覆盖
    expect(latest().map((s) => s.scene)).toEqual(["重试成功"]);
    await m.unmount();
  });

  test("横幅可以手动关掉", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    await submit();
    await push(job(lastId(), "failed", { error: "积分不足" }));
    expect(body().querySelector('[role="alert"]')).not.toBeNull();
    await dom.click(body().querySelector<HTMLButtonElement>('[role="alert"] [aria-label="关闭"]'));
    expect(body().querySelector('[role="alert"]')).toBeNull();
    await m.unmount();
  });
});
