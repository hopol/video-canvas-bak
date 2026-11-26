import { expect, test } from "bun:test";
import { mapSharedWorkspace, type SharedWorkspaceResponse } from "@/api/drama/shared-workspace";

test("共享工作台保留画布节点、分集剧本和候选选用状态", () => {
  const data = {
    project: { id: "p", canvas_id: "c", episodes: [] },
    canvas: { id: "c", payload_json: { nodes: [{ id: "role" }], edges: [] } },
    episodes: { 1: { no: 1, script_md: "第一幕" } },
    segments: { 1: [{ id: "s", chosen_task_id: "t", takes: [{ task_id: "t" }] }] },
    units: [],
  } as unknown as SharedWorkspaceResponse;
  const work = mapSharedWorkspace(data);
  expect(work.canvas.graph.nodes[0]?.id).toBe("role");
  expect(work.episodes[1]?.scriptMd).toBe("第一幕");
  expect(work.segments[1]?.[0]?.chosenTaskId).toBe("t");
});
