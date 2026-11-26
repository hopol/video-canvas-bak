import service from "@/utils/requests/service";

/** 授权页展示的设备信息；此时还没绑定用户，发起方只能靠自报名称和来源 IP 辨认 */
export interface CLIDeviceInfo {
  /** 用户码（ABCD-EFGH），与命令行上显示的一致 */
  user_code: string;
  /** 命令行自报的客户端名称，可能为空 */
  client_name: string;
  /** 发起申请的来源 IP；老后端没有这个字段，界面按未知处理 */
  client_ip?: string;
  /** pending / approved / denied / consumed / expired */
  status: string;
  created_at: string;
  expires_at: string;
}

/**
 * 读取一次设备授权申请。
 * @param code 用户在命令行上看到的用户码，大小写与连字符都不敏感
 */
export const getCLIDevice = (code: string) =>
  // silent：失败原因（401 / 码错 / 网络）由授权页自己区分着显示，不弹统一 toast
  service.get<CLIDeviceInfo>("/auth/cli/device", { code }, { silent: true });

/**
 * 同意授权：把这次申请绑定到当前登录用户，命令行下一次轮询就能拿到令牌。
 * @param userCode 用户码
 */
export const approveCLIDevice = (userCode: string) =>
  service.post<void>("/auth/cli/device/approve", { user_code: userCode });

/**
 * 拒绝授权：命令行会立刻收到 denied，不会再发令牌。
 * @param userCode 用户码
 */
export const denyCLIDevice = (userCode: string) =>
  service.post<void>("/auth/cli/device/deny", { user_code: userCode });
