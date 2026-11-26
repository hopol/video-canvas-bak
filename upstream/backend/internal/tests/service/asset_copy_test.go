package service_test

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	. "video-canvas/internal/service"

	"video-canvas/internal/config"
	"video-canvas/internal/storage"
)

// copierAssetStore 在 fakeAssetStore 上加服务端复制，记录调用并可注入失败。
type copierAssetStore struct {
	*fakeAssetStore
	copyErr   error
	copyCalls []string
}

func (c *copierAssetStore) Copy(_ context.Context, src, dst string) error {
	c.copyCalls = append(c.copyCalls, src)
	if c.copyErr != nil {
		return c.copyErr
	}
	b, ok := c.objects[src]
	if !ok {
		return storage.ErrNotFound
	}
	c.objects[dst] = append([]byte(nil), b...)
	c.types[dst] = c.types[src]
	return nil
}

// rebindAssetStore 用同一个仓储重新组装服务，把默认存储换成支持复制的 store。
func rebindAssetStore(_ *AssetService, repo *fakeAssetRepo, store storage.Storage) *AssetService {
	svc := NewAssetService(repo, newFakeRegistry(1, objectHandle(1, store, 0)), config.Storage{})
	svc.SetNow(func() time.Time { return time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC) })
	return svc
}

// 源和目标在同一个存储且存储支持复制时，走服务端复制，不把文件读到后端。
func TestAssetService_CopyBySha256_UsesServerSideCopy(t *testing.T) {
	svc, repo, base := newAssetTestService(config.Storage{})
	store := &copierAssetStore{fakeAssetStore: base}
	svc = rebindAssetStore(svc, repo, store)
	data := []byte("png-bytes-for-copy")
	seedHashedAsset(repo, base, 5, 1, "u1/src.png", data, true)

	got, err := svc.CopyBySha256(context.Background(), 2, assetSha(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if len(store.copyCalls) != 1 || store.copyCalls[0] != "u1/src.png" || base.openCalls != 0 {
		t.Fatalf("应只走一次服务端复制、不读源文件：copy=%v open=%d", store.copyCalls, base.openCalls)
	}
	if !bytes.Equal(base.objects[got.StorageKey], data) || got.StorageKey == "u1/src.png" {
		t.Fatalf("副本应写到新 key：%q", got.StorageKey)
	}
}

// 服务端复制发现源对象丢了：换下一个候选，和读写方式的行为一致。
func TestAssetService_CopyBySha256_ServerCopySkipsMissingCandidate(t *testing.T) {
	svc, repo, base := newAssetTestService(config.Storage{})
	store := &copierAssetStore{fakeAssetStore: base}
	svc = rebindAssetStore(svc, repo, store)
	data := []byte("png-bytes-for-copy")
	seedHashedAsset(repo, base, 5, 1, "u1/lost.png", data, false)
	seedHashedAsset(repo, base, 6, 3, "u3/ok.png", data, true)

	got, err := svc.CopyBySha256(context.Background(), 2, assetSha(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(base.objects[got.StorageKey], data) || len(store.copyCalls) != 2 {
		t.Fatalf("应从第二个候选复制成功：copy=%v", store.copyCalls)
	}
}

// 服务端复制因其它原因失败（比如服务商不支持、文件超过 5GB）：退回读出再写入，不让发送失败。
func TestAssetService_CopyBySha256_ServerCopyFailureFallsBackToStream(t *testing.T) {
	svc, repo, base := newAssetTestService(config.Storage{})
	store := &copierAssetStore{fakeAssetStore: base, copyErr: errors.New("NotImplemented")}
	svc = rebindAssetStore(svc, repo, store)
	data := []byte("png-bytes-for-copy")
	seedHashedAsset(repo, base, 5, 1, "u1/src.png", data, true)

	got, err := svc.CopyBySha256(context.Background(), 2, assetSha(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(base.objects[got.StorageKey], data) || base.openCalls != 1 {
		t.Fatalf("应退回读写复制：open=%d", base.openCalls)
	}
}
