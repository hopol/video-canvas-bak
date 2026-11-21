import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { listAllOfficialVoices, peekOfficialVoices } from "@/api/official-voice";
import { OfficialView } from "@/pages/assets/official-view";
import service from "@/utils/requests/service";

const voice = (id: number, name: string) => ({
  id,
  kind: "audio",
  url: `https://cdn.test/${id}.mp3`,
  file_name: name,
  thumbnail_url: `https://cdn.test/${id}.png`,
  voice_age: "young",
  voice_gender: "male",
  voice_lang: "zh",
});

describe("音色库列表缓存：切回音色库时先用上次的结果，不再从空白重新加载", () => {
  let get: Mock<typeof service.get>;

  beforeEach(() => {
    get = spyOn(service, "get") as unknown as Mock<typeof service.get>;
  });
  afterEach(() => get.mockRestore());

  test("取全量成功后，peekOfficialVoices 立刻返回同一份音色", async () => {
    get.mockResolvedValue({ items: [voice(1, "云舟"), voice(2, "佩奇猪")], total: 2 } as never);

    const loaded = await listAllOfficialVoices();

    expect(peekOfficialVoices()).toBe(loaded);
    expect(loaded.map((item) => item.fileName)).toEqual(["云舟", "佩奇猪"]);
  });

  test("再次取全量失败时，缓存里上次成功的结果还在", async () => {
    get.mockResolvedValueOnce({ items: [voice(1, "云舟")], total: 1 } as never);
    const first = await listAllOfficialVoices();

    get.mockRejectedValueOnce(new Error("network"));
    await expect(listAllOfficialVoices()).rejects.toThrow("network");

    expect(peekOfficialVoices()).toBe(first);
  });

  test("有缓存时音色库页首屏就带着卡片，不用等请求回来", async () => {
    get.mockResolvedValue({ items: [voice(1, "云舟"), voice(2, "佩奇猪")], total: 2 } as never);
    await listAllOfficialVoices();

    const html = renderToStaticMarkup(<OfficialView />);

    expect(html).toContain('aria-label="云舟"');
    expect(html).toContain('aria-label="佩奇猪"');
  });

  test("音色卡片自己撑满单元格宽度：虚拟网格里它不再是网格的直接子项，按钮不会自动拉宽", async () => {
    get.mockResolvedValue({ items: [voice(1, "云舟")], total: 1 } as never);
    await listAllOfficialVoices();

    const html = renderToStaticMarkup(<OfficialView />);
    const classes =
      html.match(/<button[^>]*data-slot="official-voice-card"[^>]*class="([^"]*)"/)?.[1] ??
      html.match(/<button[^>]*class="([^"]*)"[^>]*data-slot="official-voice-card"/)?.[1] ??
      "";

    expect(classes.split(" ")).toContain("w-full");
  });

  test("音色卡片每列最小 116px、间距 12px，窄屏也至少 3 列", async () => {
    get.mockResolvedValue({ items: [voice(1, "云舟"), voice(2, "佩奇猪")], total: 2 } as never);
    await listAllOfficialVoices();

    const html = renderToStaticMarkup(<OfficialView />);

    // 服务端渲染量不到宽度，按最少 3 列；行内列间距 12px
    expect(html).toContain("repeat(3, minmax(0, 1fr))");
    expect(html).toContain("column-gap:12px");
  });

  test("音色多达 181 条时，页面只挂载视口附近的卡片，不一次全挂", async () => {
    const items = Array.from({ length: 181 }, (_, i) => voice(i + 1, `音色${i + 1}`));
    get.mockResolvedValueOnce({ items: items.slice(0, 100), total: 181 } as never);
    get.mockResolvedValueOnce({ items: items.slice(100), total: 181 } as never);
    await listAllOfficialVoices();

    const html = renderToStaticMarkup(<OfficialView />);
    const cards = html.match(/data-slot="official-voice-card"/g) ?? [];

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(60);
    expect(html).toContain('aria-label="音色1"');
    expect(html).not.toContain('aria-label="音色181"');
  });
});
