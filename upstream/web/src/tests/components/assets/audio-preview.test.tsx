import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { useState } from "react";

import type { AssetDto } from "@/api/asset/type";
import { AssetPreview, type AssetPreviewEntry } from "@/components/assets/asset-preview";

import { holdExitAnimations, installDom, type DomEnv } from "../../helpers/dom";

let dom: DomEnv;
let realFetch: typeof fetch;
beforeAll(async () => {
  dom = await installDom();
  // 波形解码会 fetch 音频；测试里不发真实请求，直接失败，播放器退回圆点
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  dom.restore();
});

const voice: AssetDto = {
  id: "10",
  kind: "audio",
  url: "https://cdn.example.com/official-voices/a.mp3",
  mimeType: "audio/mpeg",
  byteSize: 1,
  width: null,
  height: null,
  durationMs: 3000,
  fileName: "Teen - Male - Zayne 2.0",
  thumbnailUrl: "https://cdn.example.com/official-voices/a.png",
  voiceAge: "young",
  voiceGender: "male",
  voiceLang: "en",
};
const plain: AssetDto = {
  ...voice,
  id: "11",
  fileName: "旁白.wav",
  thumbnailUrl: undefined,
  voiceAge: undefined,
  voiceGender: undefined,
  voiceLang: undefined,
};
const entries: AssetPreviewEntry[] = [
  { id: "10", asset: voice, label: "Zayne 2.0" },
  { id: "11", asset: plain, label: "旁白" },
];

function Harness({ initial }: { initial: string | null }) {
  const [target, setTarget] = useState<string | null>(initial);
  return (
    <>
      <button type="button" data-testid="close" onClick={() => setTarget(null)} />
      <button type="button" data-testid="open-plain" onClick={() => setTarget("11")} />
      <AssetPreview
        entries={entries}
        targetId={target}
        onTargetChange={setTarget}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

const doc = () => dom.win.document;
const q = (selector: string) => doc().querySelector(selector);

describe("音频预览弹窗：带人物头像的播放卡", () => {
  test("显示头像、名字和分类标签，用画布同款的波形播放器，不再是浏览器自带的 audio 控件", async () => {
    const m = await dom.mount(<Harness initial="10" />);
    await dom.flush();

    const avatar = q('[data-slot="audio-preview-avatar"] img') as HTMLImageElement | null;
    expect(avatar?.src).toBe("https://cdn.example.com/official-voices/a.png");
    const title = q('[data-slot="dialog-title"]');
    expect(title?.textContent).toBe("Zayne 2.0");
    const text = q('[data-slot="audio-preview"]')?.textContent ?? "";
    expect(text).toContain("男生");
    expect(text).toContain("English");

    // 音频缓冲好之前按钮转圈，缓冲好后才是播放
    expect(q('button[aria-label="加载中"]')).not.toBeNull();
    await dom.act(async () => {
      (q("audio") as HTMLAudioElement).dispatchEvent(new dom.win.Event("canplay"));
    });
    expect(q('button[aria-label="播放"]')).not.toBeNull();
    expect(q('[role="slider"][aria-label="播放进度"]')).not.toBeNull();
    expect(q("audio[controls]")).toBeNull();
    await m.unmount();
  });

  test("打开就自动播放", async () => {
    const m = await dom.mount(<Harness initial="10" />);
    await dom.flush();
    const audio = q("audio") as HTMLAudioElement | null;
    expect(audio?.autoplay).toBe(true);
    expect(audio?.getAttribute("src")).toBe("https://cdn.example.com/official-voices/a.mp3");
    await m.unmount();
  });

  test("播放时头像进入播放态，暂停后恢复", async () => {
    const m = await dom.mount(<Harness initial="10" />);
    await dom.flush();
    const avatar = () => q('[data-slot="audio-preview-avatar"]');
    expect(avatar()?.getAttribute("data-playing")).toBe("false");

    const audio = q("audio") as HTMLAudioElement;
    await dom.act(async () => {
      audio.dispatchEvent(new dom.win.Event("play"));
    });
    expect(avatar()?.getAttribute("data-playing")).toBe("true");
    await dom.act(async () => {
      audio.dispatchEvent(new dom.win.Event("pause"));
    });
    expect(avatar()?.getAttribute("data-playing")).toBe("false");
    await m.unmount();
  });

  test("没有头像的普通音频（生成的音频、上传的音频）用图标占位，标题用传入的名字", async () => {
    const m = await dom.mount(<Harness initial="11" />);
    await dom.flush();
    expect(q('[data-slot="audio-preview-avatar"] img')).toBeNull();
    expect(q('[data-slot="audio-preview-avatar"] svg')).not.toBeNull();
    expect(q('[data-slot="dialog-title"]')?.textContent).toBe("旁白");
    await m.unmount();
  });

  test("关闭途中内容还在（退出动画有东西可放），不会一下子只剩空壳", async () => {
    const release = holdExitAnimations(dom);
    const m = await dom.mount(<Harness initial="10" />);
    await dom.flush();
    expect(q('[data-slot="dialog-title"]')?.textContent).toBe("Zayne 2.0");

    await dom.click(q('[data-testid="close"]'));
    // 目标已经清空，但弹窗正文仍是刚才那条音色
    expect(q('[data-slot="dialog-title"]')?.textContent).toBe("Zayne 2.0");
    expect(q('[data-slot="audio-preview-avatar"] img')).not.toBeNull();
    expect(q('[data-slot="dialog-content"]')?.getAttribute("data-closed")).not.toBeNull();
    release();
    await m.unmount();
  });

  test("关掉再开另一条：从头开始，不带上一条的播放状态", async () => {
    const m = await dom.mount(<Harness initial="10" />);
    await dom.flush();
    await dom.click(q('[data-testid="close"]'));
    await dom.flush();
    await dom.click(q('[data-testid="open-plain"]'));
    await dom.flush();
    expect(q('[data-slot="dialog-title"]')?.textContent).toBe("旁白");
    expect(q('[data-slot="audio-preview-avatar"]')?.getAttribute("data-playing")).toBe("false");
    await m.unmount();
  });
});
