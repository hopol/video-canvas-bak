import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  deleteSkill,
  deleteSkillVersion,
  downloadSkillVersion,
  getSkill,
  getSkillDeleteCheck,
  getSkillVersion,
  setSkillActiveVersion,
  setSkillDramaSteps,
  setSkillEnabled,
} from "@/api/admin/agent-skill";
import type {
  SkillDetail,
  SkillItem,
  SkillVersionHead,
  SkillVersionView,
} from "@/api/admin/agent-skill/type.d";
import { confirm } from "@/components/admin-ui/confirm-dialog";
import { ApiError } from "@/utils/requests/request";
import { SKILL_SCOPES, withScope, type SkillScopeKey } from "@/utils/admin/agent-skill";

import { useAliveRef } from "../../use-admin";

/** “撤销”toast 停留多久（毫秒），与列表页原来的启停一致 */
const UNDO_MS = 5000;

/** 技能不存在的错误码（被删 / 链接错） */
const SKILL_NOT_FOUND = 61004;

/** 把 blob 存成文件：下载接口要带登录凭证，不能直接用链接 */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * 技能详情页的数据与操作：详情（含版本列表）、场景开关、生效版本、删版本、删技能、下载。
 * 场景开关是乐观更新：先翻转，再按技能串行提交（每次都带完整的目标状态，连点不会丢改动），失败翻回。
 * 请求错误的全局提示由拦截器弹，这里只记状态、回滚。
 * 页面要按 name 加 key：换技能时整体重挂，不在这里重置状态。
 * @param name 技能名
 * @param onDeleted 技能删掉之后（页面回到列表）
 */
export function useSkillDetail(name: string, onDeleted: () => void) {
  const aliveRef = useAliveRef();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  /** 正在提交的场景：对应开关禁用 */
  const [busy, setBusy] = useState<ReadonlySet<SkillScopeKey>>(new Set());
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  /** 当前技能视图：开关、改名、换版本都先改它 */
  const itemRef = useRef<SkillItem | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const versionCache = useRef(new Map<number, Promise<SkillVersionView>>());
  const loadVersion = useCallback(
    (version: number) => {
      let pending = versionCache.current.get(version);
      if (!pending) {
        pending = getSkillVersion(name, version);
        versionCache.current.set(version, pending);
        pending.catch(() => versionCache.current.delete(version));
      }
      return pending;
    },
    [name],
  );

  const reload = useCallback(async () => {
    try {
      const next = await getSkill(name);
      if (!aliveRef.current) return;
      itemRef.current = next;
      setDetail(next);
      setStatus("ready");
    } catch (error) {
      if (!aliveRef.current) return;
      setStatus(error instanceof ApiError && error.code === SKILL_NOT_FOUND ? "missing" : "error");
    }
  }, [aliveRef, name]);

  // 换技能时页面按 name 重挂，这里只管首次加载
  useEffect(() => {
    void reload();
  }, [reload]);

  /** 用接口返回的技能视图替换当前视图，版本列表保留 */
  const replaceItem = useCallback(
    (next: SkillItem) => {
      if (!aliveRef.current) return;
      itemRef.current = next;
      setDetail((prev) => (prev ? { ...prev, ...next } : prev));
    },
    [aliveRef],
  );

  const markBusy = useCallback((scope: SkillScopeKey, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }, []);

  /**
   * 打开 / 关闭一个场景：立即翻转，排队提交；成功 toast 带“撤销”（撤销不再弹新的撤销），失败翻回。
   * @param scope 场景
   * @param on 目标状态
   * @param undoable 成功后是否给“撤销”
   */
  const toggleScope = useCallback(
    function toggle(scope: SkillScopeKey, on: boolean, undoable = true) {
      const current = itemRef.current;
      if (!current) return;
      const optimistic = withScope(current, scope, on);
      replaceItem(optimistic);
      markBusy(scope, true);
      const label = SKILL_SCOPES.find((s) => s.key === scope)?.name ?? scope;
      queue.current = queue.current.then(async () => {
        // 排到时以最新视图为准：前面排着的改动已经落进 itemRef
        const target = itemRef.current ?? optimistic;
        try {
          const next =
            scope === "agent"
              ? await setSkillEnabled(name, target.enabled)
              : await setSkillDramaSteps(name, target.drama_steps);
          // 后面还有排队的改动时，保留本地乐观视图里的其他场景，只认这次提交的这一项
          replaceItem(withScope(itemRef.current ?? next, scope, on));
          if (undoable) {
            toast.success(`已在「${label}」${on ? "启用" : "停用"}「${next.title}」`, {
              duration: UNDO_MS,
              action: { label: "撤销", onClick: () => toggle(scope, !on, false) },
            });
          }
        } catch {
          // 失败的全局 toast 已弹，只把这一项翻回
          if (itemRef.current) replaceItem(withScope(itemRef.current, scope, !on));
        } finally {
          if (aliveRef.current) markBusy(scope, false);
        }
      });
    },
    [aliveRef, markBusy, name, replaceItem],
  );

  /** 设为生效的请求本体；失败为 null */
  const applyVersion = useCallback(
    async (version: number): Promise<SkillItem | null> => {
      setBusyVersion(version);
      try {
        const next = await setSkillActiveVersion(name, version);
        await reload();
        return next;
      } catch {
        return null;
      } finally {
        if (aliveRef.current) setBusyVersion(null);
      }
    },
    [aliveRef, name, reload],
  );

  /** 设为生效版本（回滚就是把旧版本设为生效）：成功 toast 带“撤销”，撤销即切回原来的版本 */
  const activateVersion = useCallback(
    async (version: number) => {
      const previous = itemRef.current?.active_version ?? null;
      const next = await applyVersion(version);
      if (!next) return;
      toast.success(`「${next.title}」已切换到 v${version}`, {
        duration: UNDO_MS,
        action:
          previous === null
            ? undefined
            : { label: "撤销", onClick: () => void applyVersion(previous) },
      });
    },
    [applyVersion],
  );

  const download = useCallback(
    async (version: number) => {
      try {
        saveBlob(await downloadSkillVersion(name, version), `${name}-v${version}.zip`);
      } catch {
        // 下载失败的全局 toast 已弹
      }
    },
    [name],
  );

  const removeVersion = useCallback(
    (head: SkillVersionHead) => {
      void confirm({
        title: `删除 v${head.version}？`,
        description: "删除后不能撤销",
        confirmLabel: "删除版本",
        destructive: true,
        onConfirm: async () => {
          setBusyVersion(head.version);
          try {
            await deleteSkillVersion(name, head.version);
          } finally {
            if (aliveRef.current) setBusyVersion(null);
          }
          versionCache.current.delete(head.version);
          toast.success(`已删除 v${head.version}`);
          await reload();
        },
      });
    },
    [aliveRef, name, reload],
  );

  /** 删除技能：先做删除预检，不能删就把原因留在确认框里 */
  const removeSkill = useCallback(async () => {
    const title = itemRef.current?.title ?? name;
    let check;
    try {
      check = await getSkillDeleteCheck(name);
    } catch {
      return;
    }
    void confirm({
      title: `删除技能「${title}」？`,
      description: `共 ${check.version_count} 个版本，删除后不能撤销`,
      confirmLabel: "删除技能",
      destructive: true,
      blockReason: check.can_delete ? null : (check.reason ?? "暂时不能删除"),
      onConfirm: async () => {
        await deleteSkill(name);
        toast.success(`已删除「${title}」`);
        onDeleted();
      },
    });
  }, [name, onDeleted]);

  return {
    detail,
    status,
    busy,
    busyVersion,
    reload,
    loadVersion,
    replaceItem,
    toggleScope,
    activateVersion,
    download,
    removeVersion,
    removeSkill,
  };
}

/** useSkillDetail 的返回值 */
export type SkillDetailApi = ReturnType<typeof useSkillDetail>;
