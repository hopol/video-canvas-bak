package service

import (
	"context"
	"encoding/json"
	"fmt"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
)

// AdaptSplitRepo 是启动修补「剧本改编」项目快照要用的仓储：还带 adapt 的项目、迁移 0041 留下的 id 对照、写回快照。
type AdaptSplitRepo interface {
	// AdaptPromptProjects 返回 prompt_settings 里还有 adapt 的项目（只需 ID 与 PromptSettings）。
	AdaptPromptProjects(context.Context) ([]model.DramaProject, error)
	// DramaPromptSplits 返回旧 id → 拆分后的 plan / scripts id。
	DramaPromptSplits(context.Context) (map[uint64]model.DramaPromptSplit, error)
	// SaveAdaptPromptSettings 写回修补后的快照；只改仍带 adapt 的行，并发重复执行无副作用。
	SaveAdaptPromptSettings(context.Context, uint64, []byte) error
}

// SplitAdaptPromptSettings 把项目快照里迁移前的 adapt 拆成 plan / scripts 并写回，返回修补的项目数。
// 幂等：修补过的项目不再带 adapt，第二次运行什么都不改。启动时调用一次。
func SplitAdaptPromptSettings(ctx context.Context, repo AdaptSplitRepo) (int, error) {
	projects, err := repo.AdaptPromptProjects(ctx)
	if err != nil || len(projects) == 0 {
		return 0, err
	}
	splits, err := repo.DramaPromptSplits(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, p := range projects {
		settings := map[string]model.DramaPromptSetting{}
		if err := json.Unmarshal(p.PromptSettings, &settings); err != nil {
			return n, fmt.Errorf("解析项目 %d 的提示词快照失败：%w", p.ID, err)
		}
		if !splitAdaptSetting(settings, splits) {
			continue
		}
		raw, err := json.Marshal(settings)
		if err != nil {
			return n, err
		}
		if err := repo.SaveAdaptPromptSettings(ctx, p.ID, raw); err != nil {
			return n, fmt.Errorf("写回项目 %d 的提示词快照失败：%w", p.ID, err)
		}
		n++
	}
	return n, nil
}

// splitAdaptSetting 把 settings 里的 adapt 原地拆成 plan / scripts（已有的不覆盖），返回是否拆过。
// 两个环节各留自己那一页正文；技能、内置照抄。我的提示词按 splits 换成拆分后的 id，
// 原提示词缺哪一页（对照里那一侧为 0），那个环节回到内置；splits 为空（读取时的兜底）时沿用旧 id。
func splitAdaptSetting(settings map[string]model.DramaPromptSetting, splits map[uint64]model.DramaPromptSplit) bool {
	adapt, ok := settings["adapt"]
	if !ok {
		return false
	}
	delete(settings, "adapt")
	split, mapped := splits[uint64(adapt.ID)]
	for _, step := range []string{"plan", "scripts"} {
		if _, exists := settings[step]; exists {
			continue
		}
		setting := adapt
		setting.Bodies = map[string]string{}
		if body, ok := adapt.Bodies[step]; ok {
			setting.Bodies[step] = body
		}
		if adapt.Source == "mine" && mapped {
			id := split.PlanID
			if step == "scripts" {
				id = split.ScriptsID
			}
			if id == 0 {
				setting = model.DramaPromptSetting{Source: "builtin", Label: "内置", Bodies: map[string]string{step: drama.PromptBody(step)}}
			} else {
				setting.ID = idcodec.ID(id)
			}
		}
		settings[step] = setting
	}
	return true
}
