import { afterEach, describe, expect, test } from "bun:test";

import { useModelSwitchStore } from "@/store/drama-model-switch";

afterEach(() => useModelSwitchStore.setState({ byDrama: {} }));

describe("项目设置 → 资产画布的换图片模型请求", () => {
  test("同一部剧多次保存：按类型合并，后保存的覆盖", () => {
    const { request } = useModelSwitchStore.getState();
    request("d1", { character: "a", scene: "b" });
    request("d1", { character: "c" });
    expect(useModelSwitchStore.getState().byDrama).toEqual({ d1: { character: "c", scene: "b" } });
  });

  test("一类换好就清掉这一类，都换好清掉整部剧", () => {
    const { request, done } = useModelSwitchStore.getState();
    request("d1", { character: "a", scene: "" });
    done("d1", "character");
    expect(useModelSwitchStore.getState().byDrama).toEqual({ d1: { scene: "" } });
    done("d1", "scene");
    expect(useModelSwitchStore.getState().byDrama).toEqual({});
  });
});
