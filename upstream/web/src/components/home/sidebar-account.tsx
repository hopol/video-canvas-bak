import { useState, type ReactNode } from "react";
import { Terminal, User } from "lucide-react";
import { useNavigate } from "react-router";

import { NavUser } from "@/components/admin-ui/nav-user";
import { CLIAgentDialog } from "@/components/cli/cli-agent-dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useCanEnterAdmin, useUsername } from "@/pages/canvas/chrome/top-right-bar";
import { useMeStore } from "@/store/me";
import { avatarInitial, displayName } from "@/utils/profile/profile-rules";

/**
 * 侧栏底部的账号菜单，首页侧栏和后台侧栏共用，保证两边的头像、名称、菜单项一致：
 * 头像和名称读当前用户资料（资料没拉到时用令牌里的用户名兜底），菜单里固定有「个人中心」和「连镜 CLI」。
 * 「连镜 CLI」打开 CLI 弹窗；弹窗挂在下拉菜单外面，菜单收起时不会把它一起卸掉。
 * @param children 「个人中心」下面的额外菜单项，比如首页的「管理后台」；「连镜 CLI」排在它们后面
 */
export function SidebarAccount({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  /** 管理员标记读登录时存在本机的角色，原因见首页侧栏：刷新后 store/admin 会回到未加载 */
  const isAdmin = useCanEnterAdmin();
  const tokenUsername = useUsername();
  const me = useMeStore((state) => state.me);
  /** 显示名优先用资料里的昵称；资料还没拉到时先用令牌里的用户名兜底 */
  const name = displayName(me) || tokenUsername;
  const [cliOpen, setCLIOpen] = useState(false);

  return (
    <>
      <NavUser
        name={name ?? "我的账户"}
        description={isAdmin ? "管理员" : me?.nickname ? `@${me.username}` : undefined}
        initials={name ? avatarInitial(name) : "我"}
        avatarSrc={me?.avatarUrl}
      >
        <DropdownMenuItem onClick={() => navigate("/profile")}>
          <User />
          个人中心
        </DropdownMenuItem>
        {children}
        <DropdownMenuItem onClick={() => setCLIOpen(true)}>
          <Terminal />
          连镜 CLI
        </DropdownMenuItem>
      </NavUser>
      <CLIAgentDialog open={cliOpen} onOpenChange={setCLIOpen} />
    </>
  );
}
