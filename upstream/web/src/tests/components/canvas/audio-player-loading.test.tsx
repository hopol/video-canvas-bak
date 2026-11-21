import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { AudioPlayer } from "@/components/canvas/audio-player";

import { installDom, type DomEnv } from "../../helpers/dom";

let dom: DomEnv;
let realFetch: typeof fetch;
/** 波形解码用的 fetch：测试里手动决定什么时候失败（波形取不到时播放器画圆点） */
let failFetch: () => void = () => {};
beforeAll(async () => {
  dom = await installDom();
  realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    new Promise((_, reject) => {
      failFetch = () => reject(new Error("offline"));
    })) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  dom.restore();
});
afterEach(() => {
  failFetch = () => {};
});

const doc = () => dom.win.document;
const q = (selector: string) => doc().querySelector(selector);
const audio = () => q("audio") as HTMLAudioElement;
const fire = (type: string) =>
  dom.act(async () => {
    audio().dispatchEvent(new dom.win.Event(type));
  });
const playButton = () => q("button[aria-label]") as HTMLButtonElement;

describe("AudioPlayer 加载中的效果", () => {
  test("波形还在解码：波形区有一道跑动的光；自动播放还没起播：播放按钮转圈", async () => {
    const m = await dom.mount(<AudioPlayer src="/loading-1.mp3" autoPlay />);
    await dom.flush();
    expect(q('[data-slot="audio-wave"]')?.getAttribute("data-loading")).toBe("true");
    expect(q('[data-slot="audio-wave-loading"]')).not.toBeNull();
    expect(playButton().getAttribute("aria-label")).toBe("加载中");
    expect(playButton().querySelector("svg.animate-spin")).not.toBeNull();
    await m.unmount();
  });

  test("没人要求播放时（画布里的音频节点）按钮不转圈，不会因为 preload=metadata 一直等", async () => {
    const m = await dom.mount(<AudioPlayer src="/loading-0.mp3" />);
    await dom.flush();
    expect(playButton().getAttribute("aria-label")).toBe("播放");
    expect(playButton().querySelector("svg.animate-spin")).toBeNull();
    await m.unmount();
  });

  test("音频缓冲好后按钮恢复成播放；波形没出来之前高光还在", async () => {
    const m = await dom.mount(<AudioPlayer src="/loading-2.mp3" autoPlay />);
    await dom.flush();
    await fire("canplay");
    expect(playButton().getAttribute("aria-label")).toBe("播放");
    expect(playButton().querySelector("svg.animate-spin")).toBeNull();
    expect(q('[data-slot="audio-wave-loading"]')).not.toBeNull();
    await m.unmount();
  });

  test("波形解码结束（成功或取不到）后高光消失", async () => {
    const m = await dom.mount(<AudioPlayer src="/loading-3.mp3" />);
    await dom.flush();
    await dom.act(async () => failFetch());
    await dom.flush();
    expect(q('[data-slot="audio-wave"]')?.getAttribute("data-loading")).toBe("false");
    expect(q('[data-slot="audio-wave-loading"]')).toBeNull();
    await m.unmount();
  });

  test("播放中又卡住等数据（waiting）：按钮再次转圈，数据来了（playing）恢复", async () => {
    const m = await dom.mount(<AudioPlayer src="/loading-4.mp3" />);
    await dom.flush();
    await fire("canplay");
    await fire("waiting");
    expect(playButton().getAttribute("aria-label")).toBe("加载中");
    await fire("playing");
    expect(playButton().getAttribute("aria-label")).toBe("播放");
    await m.unmount();
  });

  test("音频出错：不再显示加载效果，按钮禁用", async () => {
    const m = await dom.mount(<AudioPlayer src="/loading-5.mp3" />);
    await dom.flush();
    await fire("error");
    expect(q('[data-slot="audio-wave"]')?.getAttribute("data-loading")).toBe("false");
    expect(q('[data-slot="audio-wave-loading"]')).toBeNull();
    expect(playButton().querySelector("svg.animate-spin")).toBeNull();
    expect(playButton().disabled).toBe(true);
    await m.unmount();
  });
});
