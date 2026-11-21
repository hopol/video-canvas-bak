import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import type {
  MemoryRouter as MemoryRouterType,
  Route as RouteType,
  Routes as RoutesType,
} from "react-router";

import type { SkillItem } from "@/api/admin/agent-skill/type.d";
import type AgentSkillsPageType from "@/pages/admin/agent-skills";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

/**
 * 后台技能：点列表里的一行在当前页弹出详情弹窗（不跳页面）；地址带 ?skill=，刷新 / 分享链接时直接打开弹窗。
 */

const item: SkillItem = {
  name: "demo",
  title: "演示技能",
  description: "说明",
  source: "imported",
  readonly: false,
  enabled: true,
  active_version: 1,
  latest_version: 1,
  pending_version: false,
  version_count: 1,
  file_count: 1,
  total_bytes: 1,
  has_scripts: false,
  unsupported_fields: [],
  drama_steps: [],
  in_use: true,
  updated_at: "2026-01-01T00:00:00Z",
};

let dom: DomEnv;
let MemoryRouter: typeof MemoryRouterType;
let Routes: typeof RoutesType;
let Route: typeof RouteType;
let AgentSkillsPage: typeof AgentSkillsPageType;
let get: ReturnType<typeof spyOn>;

beforeAll(async () => {
  dom = await installDom();
  const router = await import("react-router");
  MemoryRouter = router.MemoryRouter;
  Routes = router.Routes;
  Route = router.Route;
  AgentSkillsPage = (await import("@/pages/admin/agent-skills")).default;
});
// 弹窗里的滑块动画在卸载后还有几帧回调：等它们跑完再还原 DOM，免得落到下一个测试文件里
afterAll(async () => {
  await dom.flush(500);
  dom.restore();
});

beforeEach(() => {
  get = spyOn(service, "get").mockImplementation((async (url: string) => {
    if (url === "/admin/agent/skills")
      return { list: [item], total: 1, page: 1, page_size: 20, has_imported: true };
    if (url === "/admin/agent/skills/demo") return { ...item, versions: [] };
    if (url === "/admin/agent/skills/demo/versions/1")
      return {
        ...item,
        version: 1,
        active: true,
        sha256: "x",
        created_by: 1,
        created_at: "t",
        frontmatter: { name: "demo" },
        body: "正文",
        files: [{ path: "SKILL.md", size: 2, kind: "skill", text: true }],
        issues: [
          { level: "warn", code: "LONG_SKILL", path: "SKILL.md", message: "SKILL.md 有 681 行" },
        ],
      };
    if (url === "/admin/agent/skills/demo/versions/1/files") return new Promise(() => {});
    return {};
  }) as never);
});
afterEach(() => get.mockRestore());

/** 记下当前地址，断言弹窗的开关写进了 ?skill= */
const seen = { location: "" };
async function mountAt(entry: string) {
  const { useLocation } = await import("react-router");
  const { useEffect } = await import("react");
  function Spy() {
    const loc = useLocation();
    useEffect(() => {
      seen.location = loc.pathname + loc.search;
    }, [loc]);
    return null;
  }
  return dom.mount(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/admin/agent/skills"
          element={
            <>
              <AgentSkillsPage />
              <Spy />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const dialog = () => dom.win.document.body.querySelector('[role="dialog"]');

describe("技能详情弹窗", () => {
  test("点行弹出详情弹窗，留在列表页，地址带 ?skill=", async () => {
    const m = await mountAt("/admin/agent/skills");
    await dom.flush(50);
    expect(dialog()).toBeNull();
    await dom.click(m.container.querySelector('[data-skill-name="demo"]'));
    await dom.flush(50);
    expect(dialog()?.textContent).toContain("演示技能");
    expect(dialog()?.textContent).toContain("用在哪里");
    expect(seen.location).toBe("/admin/agent/skills?skill=demo");
    await m.unmount();
  });

  test("弹窗里不显示预检提示和「问题」页签；加载中用转圈，不用骨架屏", async () => {
    const m = await mountAt("/admin/agent/skills?skill=demo");
    await dom.flush(50);
    const text = dialog()?.textContent ?? "";
    expect(text).toContain("SKILL.md");
    expect(text).not.toContain("681 行");
    expect(text).not.toContain("问题");
    // 文件正文的请求一直不回：正在加载
    expect(dialog()?.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(dialog()?.querySelector('[aria-label="加载中"]')).toBeTruthy();
    await m.unmount();
  });

  test("带 ?skill= 打开页面时直接弹出该技能", async () => {
    const m = await mountAt("/admin/agent/skills?skill=demo");
    await dom.flush(50);
    expect(dialog()?.textContent).toContain("演示技能");
    await m.unmount();
  });
});
