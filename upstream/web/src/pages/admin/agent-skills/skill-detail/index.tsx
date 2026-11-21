import { Download, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";

import type { SkillFile, SkillFileContent, SkillVersionView } from "@/api/admin/agent-skill/type.d";
import { getSkillFile } from "@/api/admin/agent-skill";
import { Dialog, DialogContent } from "@/components/admin-ui/dialog";
import { EmptyState, EmptyStateTitle } from "@/components/admin-ui/empty-state";
import { Segmented, SegmentedItem } from "@/components/admin-ui/segmented";
import { UnderlineTab, UnderlineTabs } from "@/components/admin-ui/underline-tabs";
import { Button } from "@/components/ui/button";
import { useRetained } from "@/hooks/use-retained";
import { cn } from "@/lib/utils";

import { FileWorkbench } from "../file-workbench";
import { SkillLoading } from "../skill-loading";
import { VersionTimeline } from "../version-timeline";
import { DetailHeader } from "./detail-header";
import { InfoCard } from "./info-card";
import { ScopeCard } from "./scope-card";
import { useSkillDetail, type SkillDetailApi } from "./use-skill-detail";

/** 弹窗里的区块外观：弹窗本身已是清透浮层，里面用描边分区，不再叠一层模糊 */
const SKILL_PANEL = "ring-chrome-border rounded-2xl ring-1";

/** 内置技能没有包：用详情里的正文拼成只有一个 SKILL.md 的清单，复用文件工作台 */
function builtinFiles(body: string): SkillFile[] {
  return [
    { path: "SKILL.md", size: new TextEncoder().encode(body).length, kind: "skill", text: true },
  ];
}

/** 列表页的弹窗地址：/admin/agent/skills?skill=名称 */
export const skillDialogPath = (name: string) =>
  `/admin/agent/skills?skill=${encodeURIComponent(name)}`;

/** 旧的详情页链接 /admin/agent/skills/:name 跳到列表页并打开弹窗 */
export default function SkillDetailRedirect() {
  const { name = "" } = useParams();
  return <Navigate to={skillDialogPath(name)} replace />;
}

/**
 * 技能详情弹窗（常驻挂载，name 为空时关闭；关闭动画期间保留上一个技能的内容）。
 * 当前页签和“文件”里查看的版本记在地址的 ?tab= 与 ?v=，和 ?skill= 一起刷新不丢。
 * @param name 打开的技能；null 表示关闭
 * @param onClose 请求关闭（页面负责清掉地址里的 skill / tab / v，并刷新列表）
 * @param onDeleted 技能被删除后
 */
export function SkillDetailDialog({
  name,
  onClose,
  onDeleted,
}: {
  name: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const shown = useRetained(name);
  return (
    <Dialog open={!!name} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[min(92svh,920px)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        {shown && <SkillDetail key={shown} name={shown} onDeleted={onDeleted} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 弹窗内容：页头 + 待生效横幅 + 左「文件 / 版本」+ 右「用在哪里 / 信息」；窄于 lg 时右栏移到页签上方。
 */
function SkillDetail({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const api = useSkillDetail(name, onDeleted);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "versions" ? "versions" : "files";
  const viewVersion = Number(params.get("v")) || null;

  const setQuery = (next: { tab?: string; v?: number | null }) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next.tab !== undefined) {
          if (next.tab === "files") out.delete("tab");
          else out.set("tab", next.tab);
        }
        if (next.v !== undefined) {
          if (next.v == null) out.delete("v");
          else out.set("v", String(next.v));
        }
        return out;
      },
      { replace: true },
    );

  if (api.status === "missing" || api.status === "error") {
    return (
      <EmptyState className="m-auto">
        <EmptyStateTitle className={cn(api.status === "error" && "text-destructive")}>
          {api.status === "missing" ? "技能不存在或已删除" : "技能加载失败"}
        </EmptyStateTitle>
        {api.status === "error" && (
          <Button variant="outline" size="sm" onClick={() => void api.reload()}>
            重试
          </Button>
        )}
      </EmptyState>
    );
  }

  const item = api.detail;
  if (!item) {
    return <SkillLoading />;
  }

  const filesVersion = viewVersion ?? item.active_version ?? item.versions[0]?.version ?? null;
  const pending = item.pending_version && item.active_version != null;

  return (
    <>
      <div className="grid shrink-0 gap-3 px-5 pt-5 pr-14 pb-4">
        <DetailHeader
          item={item}
          onRenamed={api.replaceItem}
          onDownload={() => item.active_version != null && void api.download(item.active_version)}
          onDelete={() => void api.removeSkill()}
        />
        {pending && (
          <div
            data-slot="pending-banner"
            className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm ring-1 ring-amber-500/25"
          >
            <Sparkles className="size-4 text-amber-600 dark:text-amber-400" />
            <span>
              <span className="font-mono font-medium">v{item.latest_version}</span> 已导入，尚未生效
            </span>
            <span className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuery({ tab: "files", v: item.latest_version })}
              >
                对比文件
              </Button>
              <Button
                size="sm"
                disabled={api.busyVersion != null}
                onClick={() => void api.activateVersion(item.latest_version)}
              >
                设为生效
              </Button>
            </span>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-4 overflow-y-auto px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:overflow-hidden">
        <aside className="grid content-start gap-4 lg:order-last lg:min-h-0 lg:overflow-y-auto">
          <ScopeCard
            item={item}
            busy={api.busy}
            onToggle={(scope, next) => api.toggleScope(scope, next)}
          />
          <InfoCard item={item} />
        </aside>

        <section
          className={cn(
            SKILL_PANEL,
            "flex min-h-[480px] min-w-0 flex-col overflow-hidden lg:min-h-0",
          )}
          aria-label="技能内容"
        >
          <UnderlineTabs className="border-chrome-border shrink-0">
            <UnderlineTab selected={tab === "files"} onClick={() => setQuery({ tab: "files" })}>
              文件
            </UnderlineTab>
            <UnderlineTab
              selected={tab === "versions"}
              onClick={() => setQuery({ tab: "versions" })}
            >
              版本
              {item.versions.length > 0 && (
                <span className="text-muted-foreground tabular-nums">{item.versions.length}</span>
              )}
            </UnderlineTab>
          </UnderlineTabs>

          {tab === "files" ? (
            <FilesTab
              key={filesVersion ?? "none"}
              api={api}
              version={filesVersion}
              onPickVersion={(v) => setQuery({ v })}
            />
          ) : item.readonly ? (
            <EmptyState className="flex-1">
              <EmptyStateTitle>内置技能没有版本历史</EmptyStateTitle>
            </EmptyState>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <VersionTimeline
                versions={item.versions}
                activeVersion={item.active_version}
                busyVersion={api.busyVersion}
                actions={{
                  onActivate: (head) => void api.activateVersion(head.version),
                  onViewFiles: (head) => setQuery({ tab: "files", v: head.version }),
                  onDownload: (head) => void api.download(head.version),
                  onDelete: api.removeVersion,
                }}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * “文件”页签：导入技能上方是版本切换 + 下载整包，下面是文件工作台；内置技能只有一个 SKILL.md。
 * 预检问题只在导入时看，详情里不显示（不传给工作台，也就没有「问题」页签和文件旁的标记）。
 * @param version 查看的版本；没有版本为 null
 */
function FilesTab({
  api,
  version,
  onPickVersion,
}: {
  api: SkillDetailApi;
  version: number | null;
  onPickVersion: (version: number) => void;
}) {
  const item = api.detail!;
  const [view, setView] = useState<SkillVersionView | null>(null);
  const [failed, setFailed] = useState(false);
  const { loadVersion } = api;

  useEffect(() => {
    if (item.readonly || version == null) return;
    let stale = false;
    loadVersion(version).then(
      (next) => !stale && setView(next),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [item.readonly, version, loadVersion]);

  const readVersionFile = useCallback(
    (path: string): Promise<SkillFileContent> =>
      version == null
        ? Promise.reject(new Error("没有版本"))
        : getSkillFile(item.name, version, path),
    [item.name, version],
  );
  const body = item.body ?? "";
  const builtinList = useMemo(() => builtinFiles(body), [body]);
  const readBuiltinFile = useCallback(
    async (path: string): Promise<SkillFileContent> => ({
      path,
      size: new TextEncoder().encode(body).length,
      binary: false,
      text: body,
    }),
    [body],
  );

  if (item.readonly) {
    return (
      <FileWorkbench
        files={builtinList}
        issues={[]}
        readFile={readBuiltinFile}
        frontmatter={{ name: item.name, description: item.description }}
        unsupported={[]}
      />
    );
  }

  return (
    <>
      <div className="border-chrome-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Segmented aria-label="查看版本">
          {item.versions.map((head) => (
            <SegmentedItem
              key={head.version}
              slideId="files-version"
              active={head.version === version}
              className="px-2.5 py-1 font-mono tabular-nums"
              onClick={() => onPickVersion(head.version)}
            >
              v{head.version}
            </SegmentedItem>
          ))}
        </Segmented>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={version == null}
          onClick={() => version != null && void api.download(version)}
        >
          <Download />
          下载整包
        </Button>
      </div>
      {failed ? (
        <EmptyState className="flex-1">
          <EmptyStateTitle className="text-destructive">文件清单加载失败</EmptyStateTitle>
        </EmptyState>
      ) : view ? (
        <FileWorkbench
          files={view.files}
          issues={[]}
          readFile={readVersionFile}
          frontmatter={view.frontmatter}
          unsupported={view.unsupported_fields}
        />
      ) : (
        <SkillLoading />
      )}
    </>
  );
}
