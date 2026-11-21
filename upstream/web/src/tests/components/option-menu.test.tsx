import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { FilterMenu } from "@/components/assets/filter-menu";
import { OptionList, OptionRow } from "@/components/option-menu";

import { installDom, type DomEnv } from "../helpers/dom";

let dom: DomEnv;
beforeAll(async () => {
  dom = await installDom();
});
afterAll(() => dom.restore());

const rows = () =>
  [...dom.win.document.body.querySelectorAll("button")].filter((b) =>
    b.className.includes("min-h-10"),
  ) as HTMLButtonElement[];
const rowByText = (text: string) => rows().find((b) => (b.textContent ?? "").trim() === text);
const isActive = (el: HTMLElement | undefined) =>
  !!el && el.className.split(/\s+/).includes("bg-muted");

const groups = [
  { options: [{ value: "all", label: "全部来源" }] },
  {
    heading: "画布",
    options: [
      { value: "a", label: "Coca-Cola 玻璃瓶广告片" },
      { value: "b", label: "漫剧老李", note: "12 个素材" },
      { value: "c", label: "已下线", disabled: true, title: "该来源已不可用" },
    ],
  },
];

describe("OptionRow / OptionList：下拉里统一的一行", () => {
  test("行至少 40px 高、圆角整块高亮；选中行加粗并在右边打勾，其余没有对勾", async () => {
    const m = await dom.mount(<OptionList groups={groups} value="a" onPick={() => {}} />);
    const all = [...m.container.querySelectorAll("button")];
    expect(all).toHaveLength(4);
    for (const row of all) expect(row.className).toContain("min-h-10");

    const active = rowByText("Coca-Cola 玻璃瓶广告片");
    expect(isActive(active)).toBe(true);
    expect(active?.className).toContain("font-medium");
    expect(active?.querySelector("svg")).not.toBeNull();
    expect(isActive(rowByText("全部来源"))).toBe(false);
    expect(rowByText("全部来源")?.querySelector("svg")).toBeNull();
    await m.unmount();
  });

  test("组标题单独显示；副文案跟在名字下面；不可选的置灰、带原因、点了不触发", async () => {
    const picks: string[] = [];
    const m = await dom.mount(
      <OptionList groups={groups} value="all" onPick={(v) => picks.push(v)} />,
    );
    expect(m.container.textContent).toContain("画布");
    expect(rowByText("漫剧老李12 个素材")).toBeDefined();

    const off = rowByText("已下线") as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.title).toBe("该来源已不可用");
    await dom.click(off);
    expect(picks).toEqual([]);

    await dom.click(rowByText("全部来源"));
    expect(picks).toEqual(["all"]);
    await m.unmount();
  });

  test("OptionRow 可以放任意内容（图标、两行文字），选中态和对勾由它统一处理", async () => {
    const m = await dom.mount(
      <OptionRow active onClick={() => {}}>
        <span data-testid="logo" />
        自定义内容
      </OptionRow>,
    );
    const row = m.container.querySelector("button") as HTMLButtonElement;
    expect(row.querySelector("[data-testid=logo]")).not.toBeNull();
    expect(isActive(row)).toBe(true);
    expect(row.querySelector("svg")).not.toBeNull();
    await m.unmount();
  });
});

describe("FilterMenu：和项目设置里的模型下拉同一种外观", () => {
  test("点开后面板够宽（w-64），选项是 40px 高的整行；选完收起并回调", async () => {
    const onChange = mock((_value: string) => {});
    const m = await dom.mount(
      <FilterMenu
        label="来源"
        value="all"
        defaultValue="all"
        groups={groups}
        onChange={onChange}
      />,
    );
    const trigger = m.container.querySelector('button[aria-label="来源"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain("来源");

    await dom.click(trigger);
    await dom.flush();
    const panel = dom.win.document.body.querySelector('[data-slot="popover-content"]');
    expect(panel?.className).toContain("w-64");
    expect(rows().length).toBe(4);
    expect(isActive(rowByText("全部来源"))).toBe(true);

    await dom.click(rowByText("漫剧老李12 个素材"));
    await dom.flush();
    expect(onChange).toHaveBeenCalledWith("b");
    expect(dom.win.document.body.querySelector('[data-slot="popover-content"]')).toBeNull();
    await m.unmount();
  });

  test("偏离默认值时按钮文案换成当前选项并加深", async () => {
    const m = await dom.mount(
      <FilterMenu label="来源" value="a" defaultValue="all" groups={groups} onChange={() => {}} />,
    );
    const trigger = m.container.querySelector('button[aria-label="来源"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain("Coca-Cola 玻璃瓶广告片");
    expect(trigger.className).toContain("font-medium");
    await m.unmount();
  });
});
