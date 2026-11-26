import type { ReactNode } from "react";
import { BookOpen, Terminal } from "lucide-react";
import { Link } from "react-router";

import {
  CopyBlock,
  CopyBlockCode,
  CopyBlockHeader,
  CopyBlockTitle,
} from "@/components/admin-ui/copy-block";
import { CopyButton } from "@/components/admin-ui/copy-button";
import { DataPage } from "@/components/admin-ui/data-panel";
import { GLASS_PANEL } from "@/components/admin-ui/glass";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@/components/admin-ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cliApiBase, cliSiteRoot } from "@/utils/cli/api-base";
import {
  CLI_INSTALL_COMMAND,
  CLI_NPM_PACKAGE,
  buildCLIAgentPrompt,
  cliInstallCommands,
} from "@/utils/cli/install";

/**
 * 命令行（CLI）说明页：/cli（用户菜单）与 /admin/cli（后台导航）共用。
 *
 * 刻意不复用 MCP 接入页：两者是平行的两种接入方式，凭据形态、授权动作、
 * 失效方式都不同，混在一页里会让人以为 CLI 要拿 MCP 令牌。
 * 页面里的命令与参数都对着 cli/src/cli.ts 的 USAGE 写，改 CLI 时这里要一起改。
 */
export default function CLIPage() {
  // 站点与接口地址都在运行时算：换域名、换端口、把 API 挂在别的域上都自动跟着变，
  // 不写死任何一个域名，也不假设页面地址就是接口地址。
  const apiBase = cliApiBase(import.meta.env.VITE_API_BASE_URL);
  const siteRoot = cliSiteRoot(import.meta.env.VITE_API_BASE_URL);

  // 一键脚本由后端下发，和登录一样按接口地址拼
  const oneKey = cliInstallCommands(apiBase);
  const agentPrompt = buildCLIAgentPrompt(apiBase);

  // 不跑脚本时：npm 直接装 GitHub Release 上的最新包（升级是同一条），再装技能
  const manual = `${CLI_INSTALL_COMMAND}
vc skill install`;
  const uninstall = `npm uninstall -g ${CLI_NPM_PACKAGE}`;

  const login = `# 打印用户码并自动打开浏览器，在网页上点「允许」
vc login --base ${apiBase}

# 站点地址随凭据一起保存，之后不用再带 --base
vc whoami`;

  const basics = `# 项目：找到 / 看结构 / 新建（新建需在终端输入 yes）
vc canvas list
vc canvas get <画布编号>
vc canvas graph <画布编号> -o 画布.json
vc canvas create --title "新项目"

# 素材：看模型与余额，提交生成并等结果
vc model list --kind image
vc credits
vc generate image --model <模型key> --prompt "…" --canvas <画布编号> --node <节点id> --wait

# 画布：改节点（需确认）/ 整图写回
vc canvas node add <画布编号> --kind script --label "旁白" --text "第一句"
vc canvas save <画布编号> --payload 画布.json --revision 3

# 复杂操作交给画布里的 Agent：它挑模型、接参考图，要花钱或不可逆时停下来等你确认
vc agent run <画布编号> --message "把 S03 重做成 10 秒视频" --watch
vc agent approve <审批编号> --items 0,1`;

  const tasks = `vc task get <任务ID>                  # 查一次生成任务
vc task wait <任务ID> --timeout 600   # 阻塞到出结果；超时是退出码 3，任务仍在跑`;

  const scripting = `vc canvas list --json    # 一行 JSON：{ok,data} / {ok:false,error}
# 退出码：0 成功 · 1 业务或网络错误 · 2 用法错误 · 3 等待超时 · 4 确认被取消`;

  // 技能随 npm 包一起装下来；一键脚本最后一步就是 vc skill install，手动装 npm 包时自己执行一次
  const skill = `# 装进 Claude Code；已装 Codex 的也一并装。升级 CLI 后再执行一次
vc skill install

# 其它助手：指定它的技能目录
vc skill install --to <技能目录>`;

  return (
    <DataPage>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>
            命令行（CLI）
            <Badge variant="outline" className="ml-2 align-middle font-normal">
              beta
            </Badge>
          </PageHeaderTitle>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            在终端或脚本里读写你名下的画布：登录、生成、导出。凭据是你自己的登录态，不涉及 MCP
            令牌。
          </p>
          <p className="text-muted-foreground mt-1 max-w-3xl text-xs">
            当前是 <strong>beta</strong>{" "}
            渠道：命令名与参数会尽量稳定，但相当一段时间内仍属测试状态，
            输出格式和提示语可能调整；有变化会写在升级提示旁边。
          </p>
        </PageHeaderHeading>
        <PageHeaderActions>
          {/* 完整参考单独一页：安装步骤保持短，契约与排障放到文档里 */}
          <Link to="/cli/docs" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <BookOpen />
            查看 CLI 文档
          </Link>
        </PageHeaderActions>
      </PageHeader>

      <Panel title="安装" className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            一键脚本从 GitHub Release 下载安装包，校验后装好 CLI 和配套技能，需要 Node 22.18
            及以上。
          </p>
          <CopyButton text={agentPrompt} label="复制命令给 Agent" variant="outline" />
        </div>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>macOS / Linux</CopyBlockTitle>
            <CopyButton text={oneKey.unix} />
          </CopyBlockHeader>
          <CopyBlockCode>{oneKey.unix}</CopyBlockCode>
        </CopyBlock>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>Windows PowerShell</CopyBlockTitle>
            <CopyButton text={oneKey.powershell} />
          </CopyBlockHeader>
          <CopyBlockCode>{oneKey.powershell}</CopyBlockCode>
        </CopyBlock>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>Windows CMD</CopyBlockTitle>
            <CopyButton text={oneKey.cmd} />
          </CopyBlockHeader>
          <CopyBlockCode>{oneKey.cmd}</CopyBlockCode>
        </CopyBlock>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>手动安装 / 升级</CopyBlockTitle>
            <CopyButton text={manual} />
          </CopyBlockHeader>
          <CopyBlockCode>{manual}</CopyBlockCode>
        </CopyBlock>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>卸载</CopyBlockTitle>
            <CopyButton text={uninstall} />
          </CopyBlockHeader>
          <CopyBlockCode>{uninstall}</CopyBlockCode>
        </CopyBlock>
        <p className="text-muted-foreground text-xs">
          装好后有两个等价的命令名：<code>vc</code> 和 <code>video-canvas-cli</code>。
        </p>
      </Panel>

      <Panel title="配套技能" className="mb-4">
        <p className="text-muted-foreground text-xs">
          npm 包附带一份技能文档，供终端里的 AI 助手（Claude Code、Codex、WorkBuddy
          等）查阅：适用场景、模型与参数的查询方式、节点 id 的选取方法、需要人工确认的操作。
        </p>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>把技能交给你的助手</CopyBlockTitle>
            <CopyButton text={skill} />
          </CopyBlockHeader>
          <CopyBlockCode>{skill}</CopyBlockCode>
        </CopyBlock>
      </Panel>

      <Panel title="登录" className="mb-4">
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>登录（当前站点 {siteRoot}）</CopyBlockTitle>
            <CopyButton text={login} />
          </CopyBlockHeader>
          <CopyBlockCode>{login}</CopyBlockCode>
        </CopyBlock>
        <p className="text-muted-foreground text-xs">
          上面的地址是按当前页面的接口配置实时算出来的，换域名或走内网地址访问，这里会自动跟着变，
          不用手改。 用户码 10
          分钟内有效；网页上要输入终端里显示的用户码才能同意，点「拒绝」命令会立刻退出，
          什么都不做则等超时。不想自动开浏览器就加 <code>--no-open</code>，手动打开打印出来的地址。
        </p>
      </Panel>

      <Panel title="常用命令" className="mb-4">
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>画布</CopyBlockTitle>
            <CopyButton text={basics} />
          </CopyBlockHeader>
          <CopyBlockCode>{basics}</CopyBlockCode>
        </CopyBlock>
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>生成任务</CopyBlockTitle>
            <CopyButton text={tasks} />
          </CopyBlockHeader>
          <CopyBlockCode>{tasks}</CopyBlockCode>
        </CopyBlock>
        <p className="text-muted-foreground text-xs">
          <code>canvas save</code> 带 <code>--revision</code> 时按乐观锁提交：
          画布在别处被改过会直接失败，不会覆盖别人的修改。 完整命令见 <code>vc --help</code>。
        </p>
      </Panel>

      <Panel title="脚本与 Agent 调用" className="mb-4">
        <CopyBlock>
          <CopyBlockHeader>
            <CopyBlockTitle>结构化输出与退出码</CopyBlockTitle>
            <CopyButton text={scripting} />
          </CopyBlockHeader>
          <CopyBlockCode>{scripting}</CopyBlockCode>
        </CopyBlock>
        <p className="text-muted-foreground text-xs">
          <code>--json</code> 下 stdout 只有一行 JSON，进度与提示都走 stderr，管道里可以直接解析。
        </p>
      </Panel>

      <Panel title="凭据与安全">
        <p className="text-muted-foreground text-xs">
          登录态保存在 <code>~/.config/video-canvas/credentials.json</code>
          （目录 0700、文件 0600，内有站点地址与令牌）。 它等同你的登录态，能做的事和网页里一样，
          不要提交进仓库、不要共享给他人。
        </p>
        <p className="text-muted-foreground text-xs">
          <code>vc logout</code>{" "}
          只删除本机凭据，服务端那枚令牌要等登录态到期或用网页改密码后才失效。
          令牌绑定登录时的站点：<code>--base</code> 指向别的站点会被拒绝，换站点就重新{" "}
          <code>vc login --base 新地址</code>，会覆盖旧凭据；非 https 且不是本机的地址会给出警告。
        </p>
      </Panel>
    </DataPage>
  );
}

/** 页面里的白板区块：标题 + 内容，间距与其他后台页一致。 */
function Panel({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${GLASS_PANEL} mb-4 grid gap-3 p-4 ${className ?? ""}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Terminal className="size-4" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}
