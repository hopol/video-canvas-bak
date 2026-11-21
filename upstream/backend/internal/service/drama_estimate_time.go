package service

import (
	"context"
	"slices"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
)

// dramaEtaMinSamples 是界面显示预计耗时所需的最少历史次数，不足时宁可不显示。
const dramaEtaMinSamples = 3

// CleanupDramaDrafts 由 River 周期任务回收过期正文，不影响有效草稿。
func (s *DramaService) CleanupDramaDrafts(ctx context.Context) error {
	// 1. 不持有用户事务，过期判定与草稿读取使用同一数据库时间口径。
	return s.settings.CleanupDrafts(ctx)
}

// dramaStepSeconds 采用最近五十次任务的中位数，无历史时按设计默认六十秒。
func (s *DramaService) dramaStepSeconds(ctx context.Context, modelID uint64, step string) (int, error) {
	if s.settings == nil {
		return 60, nil
	}
	values, err := s.settings.RecentDramaDurations(ctx, modelID, step)
	if err != nil {
		return 0, err
	}
	if len(values) == 0 {
		return 60, nil
	}
	return medianSeconds(values), nil
}

// medianSeconds 取中位数，偶数个取中间两个的平均，最少一秒。
func medianSeconds(values []int) int {
	slices.Sort(values)
	middle := len(values) / 2
	if len(values)%2 == 0 {
		return max(1, (values[middle-1]+values[middle])/2)
	}
	return max(1, values[middle])
}

// planningEta 给自动规划中的项目带上预计耗时原料：两个步骤的历史中位耗时（不足三次为 0）与剩余批次数。
func (s *DramaService) planningEta(ctx context.Context, p *model.DramaProject) (*model.DramaEta, error) {
	// 1. 只有规划进行中才需要；老项目没有记录文本模型时无从估算。
	if p.Phase != "running" || s.settings == nil || p.TextModelID == nil {
		return nil, nil
	}
	eta := &model.DramaEta{}
	for step, out := range map[string]*int{"analyze": &eta.AnalyzeSeconds, "plan": &eta.PlanSeconds} {
		values, err := s.settings.RecentDramaDurations(ctx, *p.TextModelID, step)
		if err != nil {
			return nil, err
		}
		if len(values) >= dramaEtaMinSamples {
			*out = medianSeconds(values)
		}
	}
	// 2. 剩余批次按单元字数估，口径同实际分批（大于 128k 的模型预算恒为三万字）。
	if p.PlanCursor < p.RangeEnd {
		units, err := s.settings.UnitSizes(ctx, p.UserID, p.ID, p.PlanCursor+1, p.RangeEnd)
		if err != nil {
			return nil, err
		}
		eta.PlanBatchesLeft = drama.CountBatches(sourceUnits(units), p.PlanCursor, p.RangeEnd, 30000)
	}
	return eta, nil
}
