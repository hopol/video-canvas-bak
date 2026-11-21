import type { DramaJob } from "@/api/drama/type";
import { Button } from "@/components/ui/button";
import { episodesLabel, isActiveJob } from "@/utils/drama/jobs";

import { useWorkspace } from "./context";
import { JobProgressBar, ProgressRing, useCancelJob } from "./job-bar";

/** 一条拆解任务：圆环、集数、细进度条、百分比（排队时写「排队中」）和取消 */
function Row({ job }: { job: DramaJob }) {
  const { busy, cancel } = useCancelJob(job);
  const queued = job.status === "queued";
  return (
    <div
      role="status"
      className="bg-chrome ring-chrome-border flex h-8 items-center gap-2 rounded-full pr-1 pl-2.5 text-[13px] ring-1"
    >
      <ProgressRing progress={job.progress} queued={queued} />
      <span className="whitespace-nowrap">拆解{episodesLabel(job.episodes)}</span>
      {!queued && <JobProgressBar progress={job.progress} className="w-20" />}
      <span className="text-muted-foreground min-w-8 text-xs tabular-nums">
        {queued ? "排队中" : `${job.progress}%`}
      </span>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void cancel()}>
        取消
      </Button>
    </div>
  );
}

/** 资产管理顶栏的拆解进度：每条进行中的拆解任务一行；没有就不显示 */
export function BreakdownProgress() {
  const { jobs } = useWorkspace();
  const active = jobs.filter((job) => job.step === "breakdown" && isActiveJob(job));
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map((job) => (
        <Row key={job.id} job={job} />
      ))}
    </div>
  );
}
