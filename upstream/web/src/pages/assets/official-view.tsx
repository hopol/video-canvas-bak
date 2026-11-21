import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  listAllOfficialVoices,
  peekOfficialVoices,
  type OfficialVoicePageDto,
} from "@/api/official-voice";
import type { AssetDto } from "@/api/asset/type";
import { AssetCover } from "@/components/assets/asset-card";
import { AssetPreview, type AssetPreviewEntry } from "@/components/assets/asset-preview";
import { AssetSearch } from "@/components/assets/asset-search";
import { AssetsToolbar } from "@/components/assets/assets-toolbar";
import { FilterMenu } from "@/components/assets/filter-menu";
import { VirtualGrid } from "@/components/assets/virtual-grid";
import { EmptyMark } from "@/components/home/empty-mark";
import { TAP_CARD } from "@/lib/motion";
import {
  filterOfficialVoices,
  VOICE_GROUP_OPTIONS,
  VOICE_LANG_OPTIONS,
  voiceGroupLabel,
  voiceDisplayName,
  type VoiceGroupFilter,
  type VoiceLangFilter,
} from "@/utils/assets/official-voices";

/** 音色缩略图是 144px 头像，用网格一行多列，名字常显在下方；每列最小 116px、间距 12px，窄屏至少 3 列。 */
const VOICE_GRID_SPEC = { minCell: 116, gap: 12, minColumns: 3 };

/** 一行的估高：卡片 = 边框 2 + 内边距 12 + 方形头像（比单元格窄 14）+ 头像到名字 6 + 名字一行 15，再加行距。挂载后以量到的为准。 */
const estimateVoiceRow = (cellWidth: number) => cellWidth + 21 + VOICE_GRID_SPEC.gap;

function OfficialVoiceCard({ asset, onPreview }: { asset: AssetDto; onPreview: () => void }) {
  const name = voiceDisplayName(asset);
  // 角标是子类别（男孩/女生…）；没有性别信息的音色不显示角标
  const badge = voiceGroupLabel(asset);
  return (
    <motion.button
      type="button"
      data-slot="official-voice-card"
      aria-label={name}
      whileTap={TAP_CARD}
      onClick={onPreview}
      className="bg-card hover:bg-accent flex w-full min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors"
    >
      <span className="bg-muted relative block aspect-square w-full overflow-hidden rounded-md">
        <AssetCover asset={asset} />
        {badge && (
          <span className="bg-cover-scrim text-cover-foreground pointer-events-none absolute top-1 right-1 rounded-full px-1.5 text-[9px] leading-4">
            {badge}
          </span>
        )}
      </span>
      <span className="block truncate px-0.5 text-center text-xs leading-tight">{name}</span>
    </motion.button>
  );
}

/**
 * 资产页「音色库」：seedance 官方参考音色，系统公共素材，所有人可见。
 * 卡片显示缩略图，点开用 <audio> 试听；在画布视频节点里可作为参考音频选中。
 * 音色就是一条带公网地址的素材，所有模型都按这个地址取用。
 * 分类两个层级：大类别是语言（中文 = 方舟国内，English = BytePlus），子类别是人群（男孩/女孩/男生/女生）。
 * 搜索和个人资产库同款：素材一次取全量，筛选与搜索都在本地做，点选即时生效。
 */
export function OfficialView() {
  // 有上次的缓存就直接出卡片，后台再刷新一次；首次进入才从空白加载
  const [page, setPage] = useState<OfficialVoicePageDto | null>(() => {
    const cached = peekOfficialVoices();
    return cached && { items: cached, total: cached.length };
  });
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<VoiceLangFilter>("all");
  const [group, setGroup] = useState<VoiceGroupFilter>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listAllOfficialVoices()
      .then((items) => {
        if (alive) setPage({ items, total: items.length });
      })
      .catch(() => {
        if (alive) toast.error("音色库加载失败，请稍后重试");
      });
    return () => {
      alive = false;
    };
  }, []);

  const query = input.trim();
  const filtering = query !== "" || lang !== "all" || group !== "all";
  const items = useMemo(
    () => filterOfficialVoices(page?.items ?? [], { query, lang, group }),
    [page, query, lang, group],
  );

  const entries = useMemo<AssetPreviewEntry[]>(
    () =>
      items.map((asset) => ({
        id: asset.id,
        asset,
        label: voiceDisplayName(asset),
      })),
    [items],
  );

  return (
    <div className="pt-2">
      <AssetsToolbar className="mt-4 mb-7">
        <FilterMenu
          label="语言"
          value={lang}
          defaultValue="all"
          groups={[{ options: VOICE_LANG_OPTIONS }]}
          onChange={(value) => setLang(value as VoiceLangFilter)}
        />
        <FilterMenu
          label="人群"
          value={group}
          defaultValue="all"
          groups={[{ options: VOICE_GROUP_OPTIONS }]}
          onChange={(value) => setGroup(value as VoiceGroupFilter)}
        />
        <div className="ml-auto">
          <AssetSearch value={input} onChange={setInput} placeholder="搜索音色名称" />
        </div>
      </AssetsToolbar>

      {items.length === 0 && page !== null ? (
        filtering ? (
          <EmptyMark
            title={query ? `没有找到“${query}”` : "这个分类下还没有音色"}
            hint="换个关键词，或换成「全部」再看看"
          />
        ) : (
          <EmptyMark title="暂无音色" hint="音色由管理员导入，稍后再来看" />
        )
      ) : (
        <VirtualGrid
          data-slot="official-voice-grid"
          items={items}
          getKey={(asset) => asset.id}
          columns={VOICE_GRID_SPEC}
          estimateRowHeight={estimateVoiceRow}
          renderItem={(asset) => (
            <OfficialVoiceCard asset={asset} onPreview={() => setPreviewId(asset.id)} />
          )}
        />
      )}

      <AssetPreview
        entries={entries}
        targetId={previewId}
        onTargetChange={setPreviewId}
        onClose={() => setPreviewId(null)}
      />
    </div>
  );
}
