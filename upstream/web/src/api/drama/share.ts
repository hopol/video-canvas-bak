import { ApiError } from "@/utils/requests/request";
import service from "@/utils/requests/service";

export type SharingMode = "view" | "copy" | "transfer";
export type Viewer = { id: string; email: string };
export type SharedDrama = { id: string; title: string };
export type SharedEpisode = {
  no: number;
  title: string;
  script: string;
  final?: string;
  segments: { prompt: string; board?: string; videos: string[]; selected?: string }[];
};
export type SharedView = {
  title: string;
  outline: string;
  characters: string;
  asset_ids: string[];
  episodes: SharedEpisode[];
};

const pendingDeliveries = new Map<string, string>();

function readDeliveryKey(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeDeliveryKey(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // 禁用会话存储时，当前页面仍可通过内存记录重试。
  }
}

export const dramaSharing = {
  members: (id: string) => service.get<Viewer[]>(`/dramas/${id}/shares`),
  remove: (id: string, member: string) => service.delete<void>(`/dramas/${id}/shares/${member}`),
  submit: async (id: string, mode: SharingMode, email: string) => {
    if (mode === "view") {
      await service.post<void>(`/dramas/${id}/shares`, { mode, email }, { silent: true });
      return;
    }
    // 请求结果未确认时，重新打开弹窗也复用该次交付的请求键。
    const storageKey = JSON.stringify(["drama-delivery", id, mode, email.toLowerCase()]);
    const key =
      pendingDeliveries.get(storageKey) ??
      readDeliveryKey(storageKey) ??
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    pendingDeliveries.set(storageKey, key);
    storeDeliveryKey(storageKey, key);
    try {
      await service.post<void>(
        `/dramas/${id}/shares`,
        { mode, email, request_key: key },
        {
          timeout: 5 * 60_000 + 5_000,
          silent: true,
        },
      );
      pendingDeliveries.delete(storageKey);
      storeDeliveryKey(storageKey, null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
        throw new Error("交付结果暂时无法确认。请用相同邮箱和共享方式重试。");
      }
      throw error;
    }
  },
  list: (keyword: string, page: number) =>
    service.get<{ list: SharedDrama[]; total: number }>("/dramas/shared", {
      keyword,
      page,
      page_size: 24,
    }),
  read: (id: string) => service.get<SharedView>(`/dramas/${id}/reader`),
  media: (id: string, asset: string, signal: AbortSignal) =>
    service.get<Blob>(`/dramas/${id}/reader/media/${asset}`, undefined, {
      responseType: "blob",
      signal,
      timeout: 0,
    }),
};
