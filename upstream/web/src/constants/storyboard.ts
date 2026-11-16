/** 景别下拉的选项，按从远到近排 */
export const SHOT_SIZES = [
  "大远景",
  "远景",
  "全景",
  "中景",
  "中近景",
  "近景",
  "特写",
  "大特写",
] as const;

/** 运镜下拉的选项 */
export const CAMERA_MOVES = [
  "固定",
  "推",
  "拉",
  "摇",
  "移",
  "跟",
  "升",
  "降",
  "环绕",
  "变焦",
  "甩镜",
  "手持",
  "航拍",
] as const;

/** 景别的英文缩写，下拉选项右侧小字；近景是 CU，特写用 BCU 区分开 */
export const SHOT_SIZE_ABBR: Record<(typeof SHOT_SIZES)[number], string> = {
  大远景: "ELS",
  远景: "LS",
  全景: "FS",
  中景: "MS",
  中近景: "MCU",
  近景: "CU",
  特写: "BCU",
  大特写: "ECU",
};

/** 新镜头的默认景别 */
export const DEFAULT_SHOT_SIZE = "中景";

/** 新镜头的默认运镜 */
export const DEFAULT_CAMERA_MOVE = "固定";

/** 新镜头的默认时长（秒） */
export const DEFAULT_SHOT_DURATION = 3;

/** 单个镜头时长的下限（秒） */
export const MIN_SHOT_DURATION = 1;

/** 单个镜头时长的上限（秒） */
export const MAX_SHOT_DURATION = 60;
