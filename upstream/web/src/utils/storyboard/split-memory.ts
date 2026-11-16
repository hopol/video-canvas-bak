/**
 * 本机记着「这个节点有一条拆分镜任务在跑」：刷新页面、关掉标签再回来时，
 * 靠这里的任务 id 去后端补查结果（进行中列表查不到已经跑完的任务）。
 * 存在 localStorage，不进画布数据，免得进撤销栈和导出文件。
 */

const KEY = "storyboard-split-jobs";

/** 一条记着的任务：mode 是用户点的覆盖 / 追加，刷新后据此写回 */
export interface RememberedSplit {
  jobId: string;
  mode: "replace" | "append";
}

type Book = Record<string, RememberedSplit>;

const slot = (canvasId: string, nodeId: string) => `${canvasId}:${nodeId}`;

function read(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    const book = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof book === "object" && book !== null ? (book as Book) : {};
  } catch {
    return {};
  }
}

function write(book: Book) {
  try {
    if (Object.keys(book).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // 存不下（隐私模式、配额）就只在本次会话里靠推送拿结果
  }
}

/** 记下节点上刚提交的任务 */
export function rememberSplit(canvasId: string, nodeId: string, entry: RememberedSplit) {
  write({ ...read(), [slot(canvasId, nodeId)]: entry });
}

/** 读节点记着的任务；没有、或本机存的内容不认识，都返回 null */
export function recallSplit(canvasId: string, nodeId: string): RememberedSplit | null {
  const entry = read()[slot(canvasId, nodeId)];
  if (!entry || typeof entry.jobId !== "string") return null;
  return { jobId: entry.jobId, mode: entry.mode === "replace" ? "replace" : "append" };
}

/** 任务有了结果（写回或失败）、或节点没了之后，忘掉它 */
export function forgetSplit(canvasId: string, nodeId: string) {
  const { [slot(canvasId, nodeId)]: _removed, ...rest } = read();
  write(rest);
}
