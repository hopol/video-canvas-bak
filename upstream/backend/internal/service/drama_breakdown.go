package service

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/logger"

	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
)

// dramaBreakdownParallel 是一次拆解同时在途的批数上限，渠道自己的并发限制仍由网关把关。
const dramaBreakdownParallel = 4

// breakdownBatches 并行拆解各批：每批有效输出连同锁集一起写入画布，随后写这批新资产的提示词，用户边等边看到资产。
// 已写入画布的批次（检查点 Done）直接跳过，上次没来得及写提示词的资产先补上；一批失败就取消其余批次。
func (s *DramaService) breakdownBatches(ctx context.Context, run *dramaRun, vars map[string]any, selected []model.DramaEpisode) error {
	units := make([]drama.Unit, 0, len(selected))
	byNo := map[int]model.DramaEpisode{}
	for _, ep := range selected {
		units = append(units, drama.Unit{No: ep.No, Text: ep.ScriptMD, Chars: utf8.RuneCountInString(ep.ScriptMD)})
		byNo[ep.No] = ep
	}
	batches := drama.ScriptBatches(units, dramaBatchBudget(&run.snapshot))
	cp := readDramaCheckpoint(run.job.Output)
	models := dramaImageModels(run.project).ByType()
	params := dramaImageParams(run.project).ByType()
	var mu sync.Mutex // 保护 finished 与 run.job.Progress
	finished := 0
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(dramaBreakdownParallel)
	if pending := cp.unattemptedPrompts(); len(pending) > 0 {
		g.Go(func() error { return s.promptsDuringBreakdown(gctx, run, vars, pending) })
	}
	for _, batch := range batches {
		eps := make([]model.DramaEpisode, 0, len(batch))
		for _, u := range batch {
			eps = append(eps, byNo[u.No])
		}
		scope := dramaEpisodeNumbers(eps)
		if containsAll(cp.Done, scope) {
			finished++
			continue
		}
		g.Go(func() error {
			if err := s.breakdownScope(gctx, run, vars, eps, cp.Done, models, params); err != nil {
				return err
			}
			mu.Lock()
			finished++
			err := s.dramaProgress(gctx, run.job, finished*90/len(batches))
			mu.Unlock()
			return err
		})
	}
	return g.Wait()
}

// breakdownScope 拆解一组集：资产写入画布后接着写这组新资产的提示词。输出超过最大输出被截断时对半拆开重跑，
// 单集还被截断就失败；重跑时已写入画布的子组（检查点 Done）直接跳过。
func (s *DramaService) breakdownScope(ctx context.Context, run *dramaRun, vars map[string]any, eps []model.DramaEpisode, done []int,
	models map[string]string, params map[string]map[string]string) error {
	scope := dramaEpisodeNumbers(eps)
	if containsAll(done, scope) {
		return nil
	}
	v := maps.Clone(vars)
	v["episodes"] = dramaScriptInputs(eps)
	// 创作段写资产设定稿，格式段整理成标准资产清单；集号范围只在格式段校验
	call := "batch=" + episodeRange(scope)
	draft, draftCost, err := s.callDrama(ctx, run.job, &run.snapshot, "breakdown", call, v, nil)
	var out any
	if err == nil {
		var formatCost int
		out, formatCost, err = s.callDrama(ctx, run.job, &run.snapshot, "breakdown_format", call, map[string]any{"draft_md": draft, "episode_numbers": scope}, func(x any) error { return validateBreakdownScope(x.(drama.BreakdownOutput), scope) })
		draftCost += formatCost
	}
	if outputTruncated(err) && len(eps) > 1 {
		// 被截断的那次调用没有结果，不扣费；两半各自写画布、各自扣费
		half := len(eps) / 2
		if err = s.breakdownScope(ctx, run, vars, eps[:half], done, models, params); err != nil {
			return err
		}
		return s.breakdownScope(ctx, run, vars, eps[half:], done, models, params)
	}
	if err != nil {
		return err
	}
	created, err := s.canvas.ApplyBreakdown(ctx, run.job.UserID, run.job.DramaID, run.project.CanvasID, run.job.ID,
		DramaBreakdownBatch{Episodes: scope, Assets: out.(drama.BreakdownOutput).Assets, Cost: draftCost, Models: models, Params: params})
	if err != nil {
		return err
	}
	return s.promptsDuringBreakdown(ctx, run, vars, created)
}

// promptsDuringBreakdown 在拆解中为一批新资产写提示词。写不成（输出不合格、上游出错等）不影响拆解：
// 资产已在画布上，留给拆解收尾时接的提示词任务重试；只有任务被取消或中断才让拆解停下。
func (s *DramaService) promptsDuringBreakdown(ctx context.Context, run *dramaRun, vars map[string]any, assets []DramaCanvasAsset) error {
	err := s.promptAssets(ctx, run, vars, assets)
	if err == nil || ctx.Err() != nil || !promptDeferrable(err) {
		return err
	}
	logger.Ctx(ctx).Warn("拆解中写资产提示词失败，留给提示词任务重试", logger.Event(logger.EventRunStep),
		zap.Int("assets", len(assets)), zap.String("error_type", dramaErrorType(err)), zap.Error(err))
	return nil
}

// promptDeferrable 判断提示词失败能否留给后续任务：模型或上游的问题可以，任务已取消、已结束等状态问题不行。
func promptDeferrable(err error) bool {
	var business *errcode.Error
	if errors.As(err, &business) {
		return business.Code != errcode.ErrTaskNotCancelable.Code && business.Code != errcode.ErrDramaStepNotReady.Code
	}
	var call *dramaCallFailure
	return errors.As(err, &call)
}

// promptAssets 为一组资产写提示词并写入画布。整组被安全过滤时对半拆开重试，最后单个仍被过滤的资产记进检查点，
// 不让一个资产拖垮其余；正常情况一组只调用一次模型。
func (s *DramaService) promptAssets(ctx context.Context, run *dramaRun, vars map[string]any, assets []DramaCanvasAsset) error {
	if len(assets) == 0 {
		return nil
	}
	v := maps.Clone(vars)
	v["assets"] = assets
	// 创作段写画面描述，格式段按节点编号整理成提示词条目；安全过滤可能发生在任一段
	draft, cost, err := s.callDrama(ctx, run.job, &run.snapshot, "asset_prompts", "", v, nil)
	var out any
	if err == nil {
		var formatCost int
		out, formatCost, err = s.callDrama(ctx, run.job, &run.snapshot, "asset_prompts_format", "", map[string]any{"draft_md": draft, "assets": assets}, func(x any) error { return validatePromptCoverage(x.(drama.AssetPromptsOutput), assets) })
		cost += formatCost
	}
	// 整组被截断：对半拆开分别写；单个资产还被截断就交给调用方失败
	if outputTruncated(err) && len(assets) > 1 {
		half := len(assets) / 2
		if err = s.promptAssets(ctx, run, vars, assets[:half]); err != nil {
			return err
		}
		return s.promptAssets(ctx, run, vars, assets[half:])
	}
	if contentFiltered(err) {
		if len(assets) == 1 {
			return s.canvas.ApplyPrompts(ctx, run.job.UserID, run.project.CanvasID, run.job.ID, run.job.Step, nil, assets, 0)
		}
		half := len(assets) / 2
		if err = s.promptAssets(ctx, run, vars, assets[:half]); err != nil {
			return err
		}
		return s.promptAssets(ctx, run, vars, assets[half:])
	}
	if err != nil {
		return err
	}
	return s.canvas.ApplyPrompts(ctx, run.job.UserID, run.project.CanvasID, run.job.ID, run.job.Step, out.(drama.AssetPromptsOutput).Prompts, nil, cost)
}

// filteredMessage 点名被安全过滤、没写成提示词的资产，告诉用户换个说法再重试。
func filteredMessage(assets []DramaCanvasAsset) string {
	names := make([]string, 0, len(assets))
	for _, a := range assets {
		names = append(names, a.Asset.Name)
	}
	return "内容触发了模型的安全过滤，这些资产没生成提示词：" + strings.Join(names, "、")
}

// containsAll 判断 scope 的每一集都在 done 里。
func containsAll(done, scope []int) bool {
	for _, no := range scope {
		if !slices.Contains(done, no) {
			return false
		}
	}
	return true
}
