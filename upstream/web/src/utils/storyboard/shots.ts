import {
  CAMERA_MOVES,
  DEFAULT_CAMERA_MOVE,
  DEFAULT_SHOT_DURATION,
  DEFAULT_SHOT_SIZE,
  MAX_SHOT_DURATION,
  MIN_SHOT_DURATION,
  SHOT_SIZES,
} from "@/constants/storyboard";
import type { CameraMove, NodeStoryboard, ShotImage, ShotSize, StoryboardShot } from "@/types";

/** 生成行 id 的函数，测试里换成可预测的 */
type NewId = () => string;

const defaultId: NewId = () => crypto.randomUUID();

/** 保留 1 位小数，顺带抹掉 0.1 + 0.2 这类浮点误差 */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 新建的分镜表：没有镜头 */
export function emptyStoryboard(): NodeStoryboard {
  return { shots: [] };
}

/** 一行新镜头：景别、运镜取默认值（中景、固定），文本空着，时长取默认值 */
function emptyShot(newId: NewId): StoryboardShot {
  return {
    id: newId(),
    scene: "",
    shot: DEFAULT_SHOT_SIZE,
    camera: DEFAULT_CAMERA_MOVE,
    action: "",
    dialogue: "",
    duration: DEFAULT_SHOT_DURATION,
  };
}

/** 时长规整到 1–60 秒、1 位小数；不是有限数字时取默认值 */
export function clampDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SHOT_DURATION;
  return round1(Math.min(MAX_SHOT_DURATION, Math.max(MIN_SHOT_DURATION, value)));
}

/** 末尾加一行新镜头 */
export function addShot(board: NodeStoryboard, newId: NewId = defaultId): NodeStoryboard {
  return { shots: [...board.shots, emptyShot(newId)] };
}

/** 在 anchorId 那行的上方或下方插一行新镜头；那行不存在时加到末尾 */
export function insertShot(
  board: NodeStoryboard,
  anchorId: string,
  side: "before" | "after",
  newId: NewId = defaultId,
): NodeStoryboard {
  const index = board.shots.findIndex((s) => s.id === anchorId);
  if (index < 0) return addShot(board, newId);
  const at = side === "before" ? index : index + 1;
  return { shots: [...board.shots.slice(0, at), emptyShot(newId), ...board.shots.slice(at)] };
}

/** 复制一行：关联的图片 / 视频节点属于原行，不跟着复制；手传的图没有归属，副本可以带着 */
export function duplicateShot(
  board: NodeStoryboard,
  id: string,
  newId: NewId = defaultId,
): NodeStoryboard {
  const index = board.shots.findIndex((s) => s.id === id);
  if (index < 0) return board;
  const { imageNodeId: _image, videoNodeId: _video, ...rest } = board.shots[index];
  const copy = { ...rest, id: newId() };
  return {
    shots: [...board.shots.slice(0, index + 1), copy, ...board.shots.slice(index + 1)],
  };
}

/** 删一行；那行不存在时原样返回 */
export function removeShot(board: NodeStoryboard, id: string): NodeStoryboard {
  if (!board.shots.some((s) => s.id === id)) return board;
  return { shots: board.shots.filter((s) => s.id !== id) };
}

/** 改一行的字段，时长顺带规整；其余行保持原引用，表格行可以按引用跳过重渲染 */
export function updateShot(
  board: NodeStoryboard,
  id: string,
  patch: Partial<Omit<StoryboardShot, "id">>,
): NodeStoryboard {
  return {
    shots: board.shots.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      return "duration" in patch ? { ...next, duration: clampDuration(next.duration) } : next;
    }),
  };
}

/** 把一行拖到第 toIndex 位（从 0 起），越界夹到两端；那行不存在时原样返回 */
export function moveShot(board: NodeStoryboard, id: string, toIndex: number): NodeStoryboard {
  const from = board.shots.findIndex((s) => s.id === id);
  if (from < 0) return board;
  const rest = board.shots.filter((s) => s.id !== id);
  const at = Math.min(rest.length, Math.max(0, toIndex));
  return { shots: [...rest.slice(0, at), board.shots[from], ...rest.slice(at)] };
}

/**
 * 拖拽松手后按拖出来的顺序重排：只认 id，行内容取当前的；
 * 拖动期间新加的行（不在 orderIds 里）按原来的先后放到末尾。
 */
export function applyOrder(board: NodeStoryboard, orderIds: readonly string[]): NodeStoryboard {
  const rank = new Map(orderIds.map((id, i) => [id, i]));
  const at = (s: StoryboardShot) => rank.get(s.id) ?? Number.POSITIVE_INFINITY;
  const shots = [...board.shots].sort((x, y) => at(x) - at(y));
  return shots.every((s, i) => s === board.shots[i]) ? board : { shots };
}

/** 一行的分镜图 / 视频来源要改成什么；imageNodeId 和 image 二选一，设一个会清掉另一个 */
export type ShotLinkPatch = {
  imageNodeId?: string;
  videoNodeId?: string;
  image?: ShotImage;
};

/** 记下一行关联的图片 / 视频节点或手传的分镜图（AC9：手传和节点出图二选一）；其余行保持原引用 */
export function linkShot(board: NodeStoryboard, id: string, patch: ShotLinkPatch): NodeStoryboard {
  return {
    shots: board.shots.map((s) => {
      if (s.id !== id) return s;
      const next: StoryboardShot = { ...s, ...patch };
      if (patch.imageNodeId !== undefined) delete next.image;
      if (patch.image !== undefined) delete next.imageNodeId;
      return next;
    }),
  };
}

/** 移除手传的分镜图，这一行回到空 */
export function removeShotImage(board: NodeStoryboard, id: string): NodeStoryboard {
  return {
    shots: board.shots.map((s) => {
      if (s.id !== id || !s.image) return s;
      const { image: _image, ...rest } = s;
      return rest;
    }),
  };
}

/**
 * 把关联的节点已经不在画布上的行解除关联（AC8：删掉图片节点后这一行恢复成未生成）。
 * 没有要解除的就原样返回，调用方靠引用判断要不要写回。
 * @param exists 节点还在不在画布上
 */
export function pruneShotLinks(
  board: NodeStoryboard,
  exists: (nodeId: string) => boolean,
): NodeStoryboard {
  let changed = false;
  const shots = board.shots.map((s) => {
    const staleImage = s.imageNodeId !== undefined && !exists(s.imageNodeId);
    const staleVideo = s.videoNodeId !== undefined && !exists(s.videoNodeId);
    if (!staleImage && !staleVideo) return s;
    changed = true;
    const next = { ...s };
    if (staleImage) delete next.imageNodeId;
    if (staleVideo) delete next.videoNodeId;
    return next;
  });
  return changed ? { shots } : board;
}

/** 行 id → 镜号：按行序从 1 起连续编号，镜号不存档，所以排序后不会错位 */
export function shotNumbers(board: NodeStoryboard): Record<string, number> {
  return Object.fromEntries(board.shots.map((s, i) => [s.id, i + 1]));
}

/** 总时长（秒），保留 1 位小数 */
export function totalDuration(board: NodeStoryboard): number {
  return round1(board.shots.reduce((sum, s) => sum + s.duration, 0));
}

/** 秒数显示成 mm:ss，按整秒四舍五入；精确值另放在 title 里 */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** 镜号补成两位：1 → 01 */
export function formatShotNumber(n: number): string {
  return String(n).padStart(2, "0");
}

/** 时长输入框提交的结果：corrected 表示和用户输入的数不一样（越界或小数位多了），要闪一下提示 */
export type DurationCommit = { value: number; corrected: boolean };

/**
 * 时长输入框失焦 / 回车时提交：越界的夹到 1–60 秒、保留 1 位小数；空或不是数字的恢复原值。
 * @param text 输入框里的文字
 * @param prev 原来的时长
 */
export function commitDuration(text: string, prev: number): DurationCommit {
  const trimmed = text.trim();
  const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(parsed)) return { value: prev, corrected: false };
  const value = clampDuration(parsed);
  return { value, corrected: value !== parsed };
}

/** 上下键调时长：每次 ±0.5 秒，不越界 */
export function stepDuration(value: number, direction: 1 | -1): number {
  return clampDuration(value + direction * 0.5);
}

/** 卡片上的一镜：带上镜号 */
export type NumberedShot = { number: number; shot: StoryboardShot };

/** 卡片上缩略图条和摘要用的数据：只取前几镜，卡片不随表格行数变重 */
export type StoryboardCardView = {
  /** 缩略图条，前 5 镜 */
  thumbs: NumberedShot[];
  /** 缩略图条放不下的镜头数，最后一格叠「+N」 */
  moreThumbs: number;
  /** 摘要，前 3 镜 */
  summary: NumberedShot[];
  /** 摘要之外还有几镜 */
  moreSummary: number;
};

/** 卡片缩略图条最多几格 */
const CARD_THUMBS = 5;

/** 卡片摘要最多几行：576 × 324 的固定框里放完缩略图条后还剩的高度，能放 5 行加「还有 N 镜」 */
const CARD_SUMMARY = 5;

/** 算节点卡片要展示的缩略图和摘要 */
export function storyboardCardView(board: NodeStoryboard): StoryboardCardView {
  const numbered = (limit: number) =>
    board.shots.slice(0, limit).map((shot, i) => ({ number: i + 1, shot }));
  return {
    thumbs: numbered(CARD_THUMBS),
    moreThumbs: Math.max(0, board.shots.length - CARD_THUMBS),
    summary: numbered(CARD_SUMMARY),
    moreSummary: Math.max(0, board.shots.length - CARD_SUMMARY),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 值有效就带上这个键，否则什么都不带 */
const optional = <K extends string, V>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** 非空字符串才算有效的节点 id；其余视为没有 */
const nodeIdOf = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** 手传分镜图：素材 id 和地址都得是非空字符串，否则当没有 */
function shotImageOf(v: unknown): ShotImage | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { assetId, src } = v as Record<string, unknown>;
  return typeof assetId === "string" && assetId && typeof src === "string" && src
    ? { assetId, src }
    : undefined;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | "" =>
  list.includes(v as T) ? (v as T) : "";

/**
 * 读档时规整分镜表：结构不对读成空表，坏行丢掉，不认识的景别 / 运镜清空，
 * 时长修正到 1–60 秒，缺字段补默认，缺 id 或 id 重复的换新 id。多余字段不保留。
 */
export function normalizeStoryboard(raw: unknown, newId: NewId = defaultId): NodeStoryboard {
  const list = (raw as { shots?: unknown } | null | undefined)?.shots;
  if (!Array.isArray(list)) return emptyStoryboard();
  const seen = new Set<string>();
  const shots: StoryboardShot[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    let id = str(s.id);
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    shots.push({
      id,
      scene: str(s.scene),
      shot: oneOf<ShotSize>(SHOT_SIZES, s.shot),
      camera: oneOf<CameraMove>(CAMERA_MOVES, s.camera),
      action: str(s.action),
      dialogue: str(s.dialogue),
      duration: clampDuration(s.duration),
      // 关联字段只在有效时才写，没有就不带这个键
      ...optional("imageNodeId", nodeIdOf(s.imageNodeId)),
      ...optional("videoNodeId", nodeIdOf(s.videoNodeId)),
      ...optional("image", shotImageOf(s.image)),
    });
  }
  return { shots };
}
