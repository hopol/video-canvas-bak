import { useCallback, useEffect, useState } from "react";
import { CircleCheckBig, CircleSlash, Loader2, Terminal } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import {
  approveCLIDevice,
  denyCLIDevice,
  getCLIDevice,
  type CLIDeviceInfo,
} from "@/api/auth/cli-device";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUsername } from "@/pages/canvas/chrome/top-right-bar";
import { useMeStore } from "@/store/me";
import { classifyDescribeError, deviceView, type DeviceView } from "@/utils/cli/authorize";
import { ApiError } from "@/utils/requests/request";

import { AuthorizeConfirm } from "./authorize-confirm";

/** 页面阶段：输入码 / 读取中 / 读不到，以及申请本身的几种画面 */
type Phase = "input" | "loading" | "error" | DeviceView;

/** 终态画面的文案：图标之外只有一句标题和一句说明 */
const RESULT_COPY: Partial<Record<Phase, { title: string; hint: string; ok?: boolean }>> = {
  approved: { title: "已授权", hint: "可以关闭这个页面，回到命令行继续操作。", ok: true },
  consumed: {
    title: "已被命令行取走",
    hint: "这次申请的令牌已经发给命令行。不是你本人操作的话，请尽快在网页上修改密码。",
  },
  denied: { title: "已拒绝", hint: "命令行不会拿到令牌，可以关闭这个页面。" },
  expired: { title: "申请已失效", hint: "请在命令行重新执行登录。" },
};

/**
 * 命令行登录的授权页：CLI 申请一对码后把用户引到这里，用户确认后命令行才拿到令牌。
 *
 * 这一页不接收密码、也不签发令牌——令牌只在命令行轮询时下发，页面只做「同意 / 拒绝」。
 * 路由要求已登录：授权的就是当前账号。用户码可以从 URL 带进来读申请信息，
 * 但不论怎么进来，同意前都要手动输入终端里的码（见 AuthorizeConfirm）。
 */
export default function CLIAuthorize() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryCode = params.get("code") ?? "";
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [device, setDevice] = useState<CLIDeviceInfo | null>(null);
  const [phase, setPhase] = useState<Phase>(queryCode ? "loading" : "input");
  const [errorText, setErrorText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const tokenUsername = useUsername();
  const account = useMeStore((state) => state.me?.username) ?? tokenUsername ?? "";

  /** 登录态失效（令牌过期，请求层已清掉）：回登录页，登录后回到这一页并带着 code */
  const toLogin = useCallback(() => {
    const next = `${location.pathname}${location.search}${location.hash}`;
    navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
  }, [location.pathname, location.search, location.hash, navigate]);

  /**
   * 读申请信息。fromLink 时用户还没输过码，确认卡片里的输入框留空；
   * 手输进来的码就是用户亲手输的，直接带进确认框。
   */
  const load = useCallback(
    async (raw: string, fromLink: boolean) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setPhase("input");
        return;
      }
      setPhase("loading");
      try {
        const info = await getCLIDevice(trimmed);
        setDevice(info);
        setTyped(fromLink ? "" : trimmed);
        setPhase(deviceView(info.status));
      } catch (error) {
        const failure = classifyDescribeError(error);
        if (failure.kind === "login") {
          toLogin();
          return;
        }
        setDevice(null);
        setErrorText(failure.message);
        setPhase("error");
      }
    },
    [toLogin],
  );

  useEffect(() => {
    if (queryCode) void load(queryCode, true);
  }, [queryCode, load]);

  const decide = async (allow: boolean) => {
    if (!device) return;
    setSubmitting(true);
    try {
      if (allow) {
        await approveCLIDevice(device.user_code);
        setPhase("approved");
      } else {
        await denyCLIDevice(device.user_code);
        setPhase("denied");
      }
    } catch (error) {
      // 失败原因已由请求层弹出；只有登录态失效需要页面自己带用户去登录
      if (error instanceof ApiError && error.status === 401) toLogin();
    } finally {
      setSubmitting(false);
    }
  };

  const result = RESULT_COPY[phase];

  return (
    <main className="bg-background grid min-h-svh place-items-center p-6">
      <section className="bg-card flex w-full max-w-md flex-col gap-4 rounded-2xl border p-8">
        <div className="flex items-center gap-3">
          <div className="bg-muted grid size-10 place-items-center rounded-full">
            <Terminal className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">授权命令行登录</h1>
            <p className="text-muted-foreground text-xs">
              确认后，命令行会以你的身份访问画布与生成任务
            </p>
          </div>
        </div>

        {phase === "input" || phase === "loading" || phase === "error" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void load(code, false);
            }}
          >
            <label className="text-sm" htmlFor="cli-user-code">
              命令行上显示的用户码
            </label>
            <Input
              id="cli-user-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoFocus
              spellCheck={false}
            />
            {phase === "error" ? <p className="text-destructive text-xs">{errorText}</p> : null}
            <Button type="submit" disabled={phase === "loading" || !code.trim()}>
              {phase === "loading" ? <Loader2 className="size-4 animate-spin" /> : null}
              继续
            </Button>
          </form>
        ) : null}

        {phase === "confirm" && device ? (
          <AuthorizeConfirm
            device={device}
            account={account}
            typed={typed}
            submitting={submitting}
            onTypedChange={setTyped}
            onApprove={() => void decide(true)}
            onDeny={() => void decide(false)}
          />
        ) : null}

        {result ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {result.ok ? (
              <CircleCheckBig className="text-status-success size-10" />
            ) : (
              <CircleSlash className="text-muted-foreground size-10" />
            )}
            <p className="text-sm font-medium">{result.title}</p>
            <p className="text-muted-foreground text-xs">{result.hint}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
