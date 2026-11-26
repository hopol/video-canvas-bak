import { createContext, useContext } from "react";
import type { SharedWorkspace } from "@/api/drama/shared-workspace";

export const SharedWorkspaceContext = createContext<SharedWorkspace | null>(null);
export const useSharedWorkspace = () => useContext(SharedWorkspaceContext);
