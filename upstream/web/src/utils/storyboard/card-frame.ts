import { DEFAULT_NODE_ASPECT, nodeFrameSize } from "@/utils/canvas/node-frame";

/**
 * 分镜表节点卡片的固定框：和 16:9 的图片节点同一个来源（短边 324，即 576 × 324），
 * 也就是新建节点、自动排版预留的默认尺寸；框里放不下的镜头少显示几行，不撑大卡片。
 */
export const STORYBOARD_FRAME = nodeFrameSize(DEFAULT_NODE_ASPECT);
