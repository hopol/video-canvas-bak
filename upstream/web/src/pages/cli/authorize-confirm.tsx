import { Loader2 } from "lucide-react";

import type { CLIDeviceInfo } from "@/api/auth/cli-device";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canApprove } from "@/utils/cli/authorize";

/** 把后端的 RFC3339 时间展示成本地时间；不依赖「现在」，避免渲染期读时钟。 */
export function formatTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 授权确认卡片：摆出这次授权的来龙去脉，用户亲手输入终端里的用户码后才能同意。
 * 页面刻意不显示用户码本身——带 code 的链接可以被别人转发给你，
 * 只有发起命令的那个人才在终端里看得到码，输不对就说明不是你自己发起的。
 * @param device 申请信息
 * @param account 当前登录账号：授权后命令行就是这个身份
 * @param typed 用户输入的码
 */
export function AuthorizeConfirm({
  device,
  account,
  typed,
  submitting,
  onTypedChange,
  onApprove,
  onDeny,
}: {
  device: CLIDeviceInfo;
  account: string;
  typed: string;
  submitting: boolean;
  onTypedChange: (value: string) => void;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const allowed = canApprove(typed, device.user_code);

  return (
    <>
      <dl className="bg-muted/50 grid gap-2 rounded-xl p-4 text-sm">
        <Row label="授权给账号" value={account || "未知"} />
        <Row label="发起时间" value={formatTime(device.created_at)} />
        <Row label="发起 IP" value={device.client_ip || "未知"} />
        <Row label="设备（自报）" value={device.client_name || "命令行工具"} />
        <Row label="到期时间" value={formatTime(device.expires_at)} />
      </dl>
      <p className="text-muted-foreground text-xs">
        如果不是你本人刚在终端里发起的，请点「拒绝」。授权后命令行会拿到和网页登录同等的权限。
      </p>
      <div className="flex flex-col gap-2">
        <label className="text-sm" htmlFor="cli-confirm-code">
          输入命令行上显示的用户码
        </label>
        <Input
          id="cli-confirm-code"
          value={typed}
          onChange={(event) => onTypedChange(event.target.value)}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          disabled={submitting}
        />
      </div>
      <div className="flex gap-3">
        <Button className="flex-1" disabled={submitting || !allowed} onClick={onApprove}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          同意授权
        </Button>
        <Button className="flex-1" variant="outline" disabled={submitting} onClick={onDeny}>
          拒绝
        </Button>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
