// Package storyboard 是画布分镜表的领域规则：镜头字段的枚举和限制，以及「从剧本拆分镜」环节。
// 不依赖数据库和模型调用；Agent 写分镜表（canvasgraph）和拆分镜接口（service）共用这里的规则。
package storyboard

import "math"

// ShotSizes 是景别的可选值，和前端 web/src/constants/storyboard.ts 的 SHOT_SIZES 是同一份（测试比对）。
var ShotSizes = []string{"大远景", "远景", "全景", "中景", "中近景", "近景", "特写", "大特写"}

// CameraMoves 是运镜的可选值，和前端 CAMERA_MOVES 是同一份（测试比对）。
var CameraMoves = []string{"固定", "推", "拉", "摇", "移", "跟", "升", "降", "环绕", "变焦", "甩镜", "手持", "航拍"}

// 新镜头的默认值和镜头字段的限制，和前端 constants/storyboard.ts 一致。
const (
	DefaultShotSize   = "中景"
	DefaultCameraMove = "固定"
	DefaultDuration   = 3.0
	MinDuration       = 1.0
	MaxDuration       = 60.0
	ShotTextMax       = 1000 // 画面、动作、对白各自的字数上限
	MaxShots          = 200  // 一张分镜表最多几镜
)

// ClampDuration 把时长修正到 1–60 秒、保留 1 位小数；不是有限数字时取默认值。
func ClampDuration(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return DefaultDuration
	}
	return math.Round(math.Min(MaxDuration, math.Max(MinDuration, v))*10) / 10
}
