import { useCallback, useEffect, useRef, useState } from "react";

import { listSkills } from "@/api/admin/agent-skill";
import type { SkillItem, SkillPage } from "@/api/admin/agent-skill/type.d";

import { useAdminList } from "../use-admin-list";

/** 筛选取值（按使用场景） */
const SKILL_FILTERS = ["status"] as const;

/** 新导入的行高亮多久后清掉（毫秒），免得筛选切换重挂载行时又闪一次 */
const FRESH_MS = 1500;

/**
 * 技能列表（服务端分页 + 搜索 + 使用场景筛选）：按 URL 里的 q / status / page 请求当前页，
 * 刷新时保留旧数据，失败时保留上一次的数据。列表只读，改使用场景、版本都在详情页；
 * 导入完成后重新拉取当前页并高亮新行。请求错误的全局提示由拦截器弹。
 * @returns 列表状态与操作
 */
export function useAgentSkills() {
  const list = useAdminList<SkillItem, SkillPage>(SKILL_FILTERS, (query) => listSkills(query));
  /** 刚导入的技能名，对应行一次性高亮 */
  const [freshName, setFreshName] = useState<string | null>(null);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (freshTimer.current) clearTimeout(freshTimer.current);
    },
    [],
  );

  const markFresh = useCallback((name: string) => {
    setFreshName(name);
    if (freshTimer.current) clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFreshName(null), FRESH_MS);
  }, []);

  return { ...list, status: list.state, freshName, markFresh };
}
