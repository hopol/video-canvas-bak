package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/logger"
	"video-canvas/internal/pkg/outbound"
	"video-canvas/internal/provider"
)

// publicAssetTimeout 是按公网地址取官方音色内容的整体超时；音色都是几百 KB 的短音频。
const publicAssetTimeout = 30 * time.Second

// 出站请求统一走 outbound.Client（记 ext.call 日志与调用计数）。
var publicAssetClient = outbound.Client("asset.public", &http.Client{Timeout: publicAssetTimeout})

// fetchPublicAsset 按素材的公网地址取内容，调用方负责关闭 Body。
// 地址来自库里的官方音色记录（不是用户输入）。取不到（对象被删、桶下线）按“素材不存在”处理并留日志，
// 不把上游错误细节透给调用方；网络类错误（超时、取消）原样包装返回，让调用方能区分重试。
func fetchPublicAsset(ctx context.Context, a *model.Asset) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.PublicURL, nil)
	if err != nil {
		return nil, fmt.Errorf("构造素材请求失败: %w", err)
	}
	resp, err := publicAssetClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("读取素材公网地址失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		logger.Error("素材公网地址不可用", zap.Uint64("asset_id", a.ID), zap.String("url", a.PublicURL), zap.Int("status", resp.StatusCode))
		return nil, provider.ErrAssetNotFound
	}
	return resp.Body, nil
}
