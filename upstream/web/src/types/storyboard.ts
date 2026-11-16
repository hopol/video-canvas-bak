import type { CAMERA_MOVES, SHOT_SIZES } from "@/constants/storyboard";

/** 景别，取值见 SHOT_SIZES */
export type ShotSize = (typeof SHOT_SIZES)[number];

/** 运镜，取值见 CAMERA_MOVES */
export type CameraMove = (typeof CAMERA_MOVES)[number];

/** 旧数据里手动上传的分镜图：只存素材 id 和地址，不复制文件。现在上传会落成图片节点，不再写它 */
export type ShotImage = {
  /** 素材 id（字符串） */
  assetId: string;
  /** 素材地址，展示用 */
  src: string;
};

/**
 * 分镜表的一行镜头（PRD 分镜表节点 §6.2）。镜号不存，按行序现算，排序后不会和行错位。
 * 景别 shot、运镜 camera、画面 scene 和营销模块的 ScriptShot 同名，以后打通只需一层映射。
 */
export type StoryboardShot = {
  /** 行 id，拖拽排序和关联生成节点都靠它，复制行时换新的 */
  id: string;
  /** 画面描述：这个镜头里发生了什么 */
  scene: string;
  /** 景别，空串表示未选 */
  shot: ShotSize | "";
  /** 运镜，空串表示未选 */
  camera: CameraMove | "";
  /** 动作 / 走位：角色动作、移动路线、朝向 */
  action: string;
  /** 对白，旁白 OS / VO 也写在这里 */
  dialogue: string;
  /** 时长（秒），1–60，最多 1 位小数 */
  duration: number;
  /**
   * 这一行按行生成时建的图片节点 id。分镜图格实时显示该节点的状态和结果，状态不在行上另存一份；
   * 节点被删后这个 id 不再指向任何东西，分镜图格回到空，读档或写回时清掉。和 image 二选一。
   */
  imageNodeId?: string;
  /** 这一行按行生成时建的视频节点 id，行上的视频状态实时读它 */
  videoNodeId?: string;
  /** 旧数据里手动上传的分镜图，只读、可移除；和 imageNodeId 二选一，重新上传后换成关联的图片节点 */
  image?: ShotImage;
};

/** 分镜表节点自带的数据，只有 kind 为 storyboard 时才有 */
export type NodeStoryboard = {
  /** 镜头，按镜号顺序 */
  shots: StoryboardShot[];
};
