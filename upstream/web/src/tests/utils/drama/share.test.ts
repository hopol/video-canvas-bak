import { describe, expect, spyOn, test } from "bun:test";
import { dramaSharing } from "@/api/drama/share";
import { ApiError } from "@/utils/requests/request";
import service from "@/utils/requests/service";

describe("短剧交付重试", () => {
  test("断线后复用请求键，收到成功响应后下次发送使用新键", async () => {
    const post = spyOn(service, "post")
      .mockRejectedValueOnce(new ApiError("网络错误", "NETWORK_ERROR", 0))
      .mockResolvedValue(undefined);
    try {
      await expect(dramaSharing.submit("copy-test", "copy", "Viewer@example.test")).rejects.toThrow(
        "交付结果暂时无法确认",
      );
      await dramaSharing.submit("copy-test", "copy", "viewer@example.test");
      await dramaSharing.submit("copy-test", "copy", "viewer@example.test");

      const [first, retry, next] = post.mock.calls.map(
        ([, body]) => body as { request_key: string },
      );
      expect(first.request_key).toMatch(/^[0-9a-f]{32}$/);
      expect(retry.request_key).toBe(first.request_key);
      expect(next.request_key).not.toBe(first.request_key);
    } finally {
      post.mockRestore();
    }
  });

  test("仅查看授权沿用普通请求", async () => {
    const post = spyOn(service, "post").mockResolvedValue(undefined);
    try {
      await dramaSharing.submit("view-test", "view", "viewer@example.test");
      expect(post).toHaveBeenCalledWith(
        "/dramas/view-test/shares",
        { mode: "view", email: "viewer@example.test" },
        { silent: true },
      );
    } finally {
      post.mockRestore();
    }
  });
});
