import { mapCanvasProject } from "@/api/canvas";
import type { BackendCanvasProjectDto } from "@/api/canvas/type";
import { mapDrama, mapEpisode, mapSegment } from "@/api/drama";
import type { BackendDramaView, BackendEpisodeView, BackendSegmentView, DramaUnit } from "./type";
import service from "@/utils/requests/service";

export type SharedWorkspaceResponse = {
  project: BackendDramaView;
  canvas: BackendCanvasProjectDto;
  episodes: Record<number, BackendEpisodeView>;
  segments: Record<number, BackendSegmentView[]>;
  units: DramaUnit[];
};
export function mapSharedWorkspace(data: SharedWorkspaceResponse) {
  return {
    project: mapDrama(data.project),
    canvas: mapCanvasProject(data.canvas),
    episodes: Object.fromEntries(
      Object.entries(data.episodes).map(([no, ep]) => [no, mapEpisode(ep)]),
    ),
    segments: Object.fromEntries(
      Object.entries(data.segments).map(([no, rows]) => [no, rows.map(mapSegment)]),
    ),
    units: data.units ?? [],
  };
}
export type SharedWorkspace = ReturnType<typeof mapSharedWorkspace>;
export async function getSharedWorkspace(id: string) {
  return mapSharedWorkspace(
    await service.get<SharedWorkspaceResponse>(`/dramas/${id}/reader/workspace`, undefined, {
      silent: true,
    }),
  );
}
