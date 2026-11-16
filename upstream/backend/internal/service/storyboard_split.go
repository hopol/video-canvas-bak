package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"go.uber.org/zap"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/logger"
	"video-canvas/internal/pkg/ws"
	"video-canvas/internal/provider"
	"video-canvas/internal/provider/modelcfg"
	"video-canvas/internal/repository"
	"video-canvas/internal/stepkit"
	"video-canvas/internal/storyboard"
)

// StoryboardRepo 是拆分镜要的存储：画布归属、积分原语、异步任务。
type StoryboardRepo interface {
	CanvasOwned(ctx context.Context, userID, canvasID uint64) error
	WithTx(ctx context.Context, fn func(repository.StoryboardTx) error) error
	SplitJobByID(ctx context.Context, userID, jobID uint64) (*model.StoryboardSplitJob, error)
	ActiveSplitJob(ctx context.Context, userID, canvasID uint64, nodeID string) (*model.StoryboardSplitJob, error)
}

// StoryboardDeps 是拆分镜服务的依赖。
type StoryboardDeps struct {
	Repo        StoryboardRepo
	Models      provider.Registry
	Caller      stepkit.Caller   // 文本模型调用（和营销环节共用一个）
	Credits     StepCreditPolicy // 新账户初始积分
	Broadcaster ws.Broadcaster   // 为 nil 时不推送
}

// StoryboardService 是画布分镜表的「从剧本拆分镜」：异步任务，worker 调 Agent 模型，按实际用量扣费，失败不扣。
type StoryboardService struct {
	repo    StoryboardRepo
	models  provider.Registry
	runner  *stepkit.Runner
	credits StepCreditPolicy
	bc      ws.Broadcaster
}

// NewStoryboardService 创建拆分镜服务。
func NewStoryboardService(d StoryboardDeps) *StoryboardService {
	bc := d.Broadcaster
	if bc == nil {
		bc = ws.NopBroadcaster{}
	}
	return &StoryboardService{repo: d.Repo, models: d.Models, runner: stepkit.NewRunner(d.Caller), credits: d.Credits, bc: bc}
}

// Split 提交一次拆分镜：校验剧本和画布归属、预估余额够不够，然后在同一个事务里插任务行并入队，立刻返回任务摘要。
// worker（HandleStoryboardSplit）在后台执行 → 按实际用量扣费 → 推 WebSocket。结果不写画布：前端收到后按用户选的覆盖 / 追加写进分镜表。
func (s *StoryboardService) Split(ctx context.Context, userID, canvasID uint64, req *model.StoryboardSplitReq) (*model.StoryboardSplitResp, error) {
	// 1. 剧本：去掉首尾空白后不能为空、不能太长
	script := strings.TrimSpace(req.Script)
	if script == "" {
		return nil, errcode.ErrStoryboardScriptEmpty
	}
	if utf8.RuneCountInString(script) > storyboard.ScriptMax {
		return nil, errcode.ErrStoryboardScriptTooLong
	}
	// 2. 画布必须是自己的：流水关联这张画布
	if err := s.repo.CanvasOwned(ctx, userID, canvasID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, errcode.ErrCanvasNotFound
		}
		return nil, err
	}
	snap, err := s.pickModel(ctx, req.Model)
	if err != nil {
		return nil, err
	}
	step := storyboard.SplitStep()
	method := stepkit.BuiltinMethod(step)
	in := storyboard.SplitInput(script)
	// 3. 调模型前按预估（含重写一次）查可用积分：不够就不调，免得做完了扣不到钱
	if err := s.checkBalance(ctx, userID, snap, step, method, in); err != nil {
		return nil, err
	}
	// 4. 建任务行，同一事务里入队。同画布同节点已有非终态任务时唯一索引会拦住（返回正在拆分镜）
	job := &model.StoryboardSplitJob{UserID: userID, CanvasID: canvasID, NodeID: req.NodeID, ModelKey: snap.Model.Key, Script: script, Status: model.SplitJobPending, PromptChars: utf8.RuneCountInString(script)}
	if err := s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error { return tx.CreateSplitJob(ctx, job) }); err != nil {
		if errors.Is(err, repository.ErrSplitJobBusy) {
			return nil, errcode.ErrStoryboardSplitBusy
		}
		return nil, err
	}
	return splitJobView(job), nil
}

// HandleStoryboardSplit 是队列 worker 的入口：执行任务 → 落结果 → 推送。基础设施错误返回 error 让队列重试；
// 业务失败（模型超时、不合格、积分耗尽）落成任务失败并返回 nil。同一任务并发时靠 SplitJobForUpdate 的行锁去重。
func (s *StoryboardService) HandleStoryboardSplit(ctx context.Context, jobID uint64) error {
	var start *model.StoryboardSplitJob
	if err := s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error {
		job, err := tx.SplitJobForUpdate(ctx, jobID)
		if err != nil {
			return err
		}
		if job.Status != model.SplitJobPending {
			return nil // 终态或已被另一个实例接走
		}
		start = job
		// 本地快照也改成 running：下面推送用的就是它，别把刚读到的 pending 推出去
		start.Status = model.SplitJobRunning
		start.Attempts = job.Attempts + 1
		return tx.UpdateSplitJob(ctx, jobID, map[string]any{"status": model.SplitJobRunning, "attempts": start.Attempts})
	}); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil // 任务被删了
		}
		return err
	}
	if start == nil {
		return nil
	}
	s.publish(ctx, start)

	ctx, run := logger.BeginRun(ctx, logger.RunRef{Kind: "storyboard_split", ID: idcodec.Encode(jobID), UserID: start.UserID})
	run.Start(zap.String("node_id", start.NodeID), zap.String("model_key", start.ModelKey), zap.Int("script_chars", start.PromptChars), zap.Uint64("canvas_id", start.CanvasID))

	snap, err := s.models.Snapshot(ctx, start.ModelKey)
	if err != nil {
		if errors.Is(err, provider.ErrModelUnavailable) {
			return s.failJob(ctx, run, start, errcode.ErrStoryboardNoModel)
		}
		return err
	}
	step := storyboard.SplitStep()
	method := stepkit.BuiltinMethod(step)
	in := storyboard.SplitInput(start.Script)

	// 超时按后台给这个模型配的来：截止时间（deadline）限制整次运行，上游多久没出字（idle_timeout）由网关按模型配置判断；
	// 没配（0）时只由 job 自己的超时兜底（见 queue.storyboardSplitJobTimeout）
	callCtx := ctx
	if d := snap.Model.Deadline.D(); d > 0 {
		var cancel context.CancelFunc
		callCtx, cancel = context.WithTimeout(ctx, d)
		defer cancel()
	}
	res, err := s.runner.Run(callCtx, step, method, snap, in)
	if err != nil {
		if ctx.Err() == nil && errors.Is(callCtx.Err(), context.DeadlineExceeded) {
			err = context.DeadlineExceeded
		}
		return s.failJob(ctx, run, start, splitError(err))
	}
	shots, err := storyboard.DecodeShots(res.Output)
	if err != nil {
		return s.failJob(ctx, run, start, errcode.ErrStoryboardSplitFailed)
	}
	// 成功才扣费；扣费和写任务终态在同一个事务里
	if err := s.finishJob(ctx, start, shots, snap, res); err != nil {
		return err
	}
	run.End(logger.StatusSucceeded, zap.Int("shots", len(shots)), zap.Int("attempts", res.Attempts))
	return nil
}

// finishJob 成功时落任务终态：扣费 + 写 shots / usage / credits；然后推送。
func (s *StoryboardService) finishJob(ctx context.Context, job *model.StoryboardSplitJob, shots []storyboard.Shot, snap *provider.Snapshot, res *stepkit.Result) error {
	credits := max(stepkit.Cost(snap, res), 0)
	shotsJSON, err := json.Marshal(toModelShots(shots))
	if err != nil {
		return err
	}
	var charged int
	if err := s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error {
		got, cerr := chargeSplitTx(ctx, tx, job.UserID, job.CanvasID, credits)
		if cerr != nil {
			return cerr
		}
		charged = got
		return tx.UpdateSplitJob(ctx, job.ID, map[string]any{
			"status":        model.SplitJobSucceeded,
			"shots":         shotsJSON,
			"credits":       charged,
			"input_tokens":  max(0, res.Usage.InputTokens),
			"output_tokens": max(0, res.Usage.OutputTokens),
			"script":        "", // 结束后清掉剧本原文，少占空间
		})
	}); err != nil {
		return err
	}
	job.Status = model.SplitJobSucceeded
	job.Shots = shotsJSON
	job.Credits = charged
	s.publish(ctx, job)
	return nil
}

// failJob 业务失败：落错误、不扣费、推送；总是返回 nil（不交给队列重试，同样的输入重试结果一样）。
func (s *StoryboardService) failJob(ctx context.Context, run *logger.Run, job *model.StoryboardSplitJob, bizErr error) error {
	msg := bizErr.Error()
	if err := s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error {
		return tx.UpdateSplitJob(ctx, job.ID, map[string]any{"status": model.SplitJobFailed, "error": msg, "script": ""})
	}); err != nil {
		return err
	}
	job.Status = model.SplitJobFailed
	job.Error = msg
	run.End(logger.StatusFailed, zap.String("error", msg))
	s.publish(ctx, job)
	return nil
}

// ActiveJob 读某个节点上进行中的任务（弹窗打开或刷新页面时按 nodeId 补查）；没有返回 (nil, nil)。
func (s *StoryboardService) ActiveJob(ctx context.Context, userID, canvasID uint64, nodeID string) (*model.StoryboardSplitResp, error) {
	job, err := s.repo.ActiveSplitJob(ctx, userID, canvasID, nodeID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return splitJobView(job), nil
}

// Job 按 id 读任务摘要（断线对账用）；别人的任务按不存在处理。
func (s *StoryboardService) Job(ctx context.Context, userID, jobID uint64) (*model.StoryboardSplitResp, error) {
	job, err := s.repo.SplitJobByID(ctx, userID, jobID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, errcode.ErrStoryboardJobNotFound
		}
		return nil, err
	}
	return splitJobView(job), nil
}

// pickModel 取用户选的 Agent 模型；没选、已下架或不是 Agent 模型时回落到第一个可用的。
func (s *StoryboardService) pickModel(ctx context.Context, want string) (*provider.Snapshot, error) {
	list, err := s.models.ListModels(ctx, modelcfg.KindAgent)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(list)+1)
	if want != "" {
		keys = append(keys, want)
	}
	for _, m := range list {
		if m.Key != want {
			keys = append(keys, m.Key)
		}
	}
	for _, k := range keys {
		snap, err := s.models.Snapshot(ctx, k)
		if errors.Is(err, provider.ErrModelUnavailable) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if snap != nil && snap.Model.Kind == modelcfg.KindAgent {
			return snap, nil
		}
	}
	return nil, errcode.ErrStoryboardNoModel
}

// checkBalance 按预估费用检查可用积分（余额减冻结）；没有账户时按新账户初始积分惰性建立。只读一眼，不冻结。
func (s *StoryboardService) checkBalance(ctx context.Context, userID uint64, snap *provider.Snapshot, step stepkit.Step, method stepkit.Method, in stepkit.Input) error {
	need, err := stepkit.Estimate(snap, step, method, in)
	if err != nil {
		return err
	}
	if need <= 0 {
		return nil
	}
	initial, err := s.credits.InitialCredits(ctx)
	if err != nil {
		return err
	}
	return s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error {
		if err := tx.EnsureCredit(ctx, userID, initial); err != nil {
			return err
		}
		credit, err := tx.LockCredit(ctx, userID)
		if err != nil {
			return err
		}
		if credit.Balance-credit.Frozen < need {
			return errcode.ErrInsufficientCredits
		}
		return nil
	})
}

// chargeSplitTx 在账户锁内扣拆分镜费：实扣封顶在可用积分，不扣成负数、不动进行中任务冻结的积分；
// 和其他同步文本调用一样成对写一条冻结流水和一条结算流水（金额相同），后台对账等式保持成立。返回实扣积分。
// 必须在业务事务里调用：扣费和任务终态在同一个事务里。
func chargeSplitTx(ctx context.Context, tx repository.StoryboardTx, userID, canvasID uint64, credits int) (int, error) {
	if credits <= 0 {
		return 0, nil
	}
	credit, err := tx.LockCredit(ctx, userID)
	if errors.Is(err, repository.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	charged := min(credits, max(credit.Balance-credit.Frozen, 0))
	if charged == 0 {
		return 0, nil
	}
	for _, typ := range []string{model.LedgerFreeze, model.LedgerSettle} {
		if _, err := tx.InsertLedger(ctx, &model.CreditLedger{UserID: userID, CanvasID: &canvasID, Type: typ, Amount: charged, Note: "分镜表拆分镜"}); err != nil {
			return 0, err
		}
	}
	if err := tx.AddCredit(ctx, userID, -charged, 0); err != nil {
		return 0, err
	}
	return charged, nil
}

// splitError 把环节运行的错误换成业务错误：上游报错带出原文，两次都不合格、超时各有说法。
func splitError(err error) error {
	switch {
	case errors.Is(err, stepkit.ErrOutputInvalid):
		return errcode.ErrStoryboardSplitFailed
	case errors.Is(err, context.DeadlineExceeded):
		return errcode.ErrStoryboardModelCall.WithMsg("文本模型响应超时，请稍后重试")
	case errors.Is(err, stepkit.ErrCallFailed):
		if up := upstreamText(err); up != "" {
			return errcode.ErrStoryboardModelCall.WithMsg("文本模型调用失败：" + up)
		}
		return errcode.ErrStoryboardModelCall
	}
	return err
}

// toModelShots 把领域镜头换成接口返回的结构。
func toModelShots(in []storyboard.Shot) []model.StoryboardShot {
	out := make([]model.StoryboardShot, len(in))
	for i, s := range in {
		out[i] = model.StoryboardShot{Scene: s.Scene, Shot: s.Shot, Camera: s.Camera, Action: s.Action, Dialogue: s.Dialogue, Duration: s.Duration}
	}
	return out
}

// splitJobView 把任务行转成接口 / 推送用的结构：结果字段只在终态时有。
func splitJobView(job *model.StoryboardSplitJob) *model.StoryboardSplitResp {
	v := &model.StoryboardSplitResp{
		ID: idcodec.Encode(job.ID), CanvasID: idcodec.Encode(job.CanvasID), NodeID: job.NodeID,
		Status: job.Status, Model: job.ModelKey, Credits: job.Credits, Error: job.Error,
	}
	if len(job.Shots) > 0 {
		var shots []model.StoryboardShot
		if err := json.Unmarshal(job.Shots, &shots); err == nil {
			v.Shots = shots
		}
	}
	return v
}

// publish 向用户频道推一条拆分镜状态变化消息：数据就是接口返回的那份任务快照，前端不用分两套解析。
func (s *StoryboardService) publish(ctx context.Context, job *model.StoryboardSplitJob) {
	channel := ws.UserChannel(job.UserID)
	s.bc.Publish(ctx, channel, ws.Message{Type: ws.TypeStoryboardSplit, Channel: channel, Data: splitJobView(job)})
}
