package service_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	. "video-canvas/internal/service"

	"video-canvas/internal/config"
	"video-canvas/internal/model"
	"video-canvas/internal/provider"
)

// 官方音色是系统公共素材（user_id=0, source=official）：任意登录用户都要能
// 1) 通过 Get 读到它（试听 / 参考音频预检），2) 通过 Open 生成上游可拉的签名 URL。
// 但普通用户素材仍严格隔离，不能被别人读到。
func TestAssetService_GetOfficialVoice(t *testing.T) {
	repo := newFakeAssetRepo()
	store := newFakeAssetStore()
	// 手动插入一条系统公共音色和一条普通用户素材
	repo.rows[10] = &model.Asset{ID: 10, UserID: 0, Kind: "audio", Source: model.AssetSourceOfficial,
		StorageID: 1, StorageKey: "o0/202611/voice.wav", MimeType: "audio/wav", FileName: "Big Boogie"}
	repo.rows[11] = &model.Asset{ID: 11, UserID: 7, Kind: "audio", Source: model.AssetSourceUpload,
		StorageID: 1, StorageKey: "u7/202611/private.wav", MimeType: "audio/wav"}

	reg := newFakeRegistry(1, objectHandle(1, store, time.Hour))
	svc := NewAssetService(repo, reg, config.Storage{SignedTTL: time.Hour})

	// 用户 99 能读到系统公共音色
	got, err := svc.Get(context.Background(), 99, 10)
	if err != nil {
		t.Fatalf("系统公共音色应对所有用户可读，却报错：%v", err)
	}
	if got.ID != 10 || got.Source != model.AssetSourceOfficial {
		t.Fatalf("读到的不是期望的官方音色：%+v", got)
	}

	// 用户 99 读不到别人私有素材
	if _, err := svc.Get(context.Background(), 99, 11); err == nil {
		t.Fatal("别人的私有素材不应被读到")
	}
}

// Open 是生成链路读取参考音频的入口：必须给官方音色产出 Remote 签名 URL，
// 这样 doubao-video.js 才能把平台地址当 audio_url 传给方舟。
func TestAssetService_OpenOfficialVoice(t *testing.T) {
	repo := newFakeAssetRepo()
	store := newFakeAssetStore()
	store.objects["o0/202611/voice.wav"] = []byte("wav")
	repo.rows[10] = &model.Asset{ID: 10, UserID: 0, Kind: "audio", Source: model.AssetSourceOfficial,
		StorageID: 1, StorageKey: "o0/202611/voice.wav", MimeType: "audio/wav"}

	reg := newFakeRegistry(1, objectHandle(1, store, time.Hour))
	svc := NewAssetService(repo, reg, config.Storage{SignedTTL: time.Hour})

	f, err := svc.Open(context.Background(), 42, 10)
	if err != nil {
		t.Fatalf("生成链路应能打开官方音色：%v", err)
	}
	if f.URL == "" {
		t.Fatal("官方音色必须有可被上游拉取的 URL")
	}
	if !f.Remote {
		t.Fatal("官方音色必须标记为远端可拉取，否则上游拿到的是 /files 内网地址")
	}
	_ = f.Body.Close()
}

// ViewOf 要把官方溯源 ID 透出给前端卡片；音频与缩略图都直接给公网地址，不绕 /files。
func TestAssetService_ViewOfOfficialVoice(t *testing.T) {
	repo := newFakeAssetRepo()
	svc := NewAssetService(repo, newFakeRegistry(1, objectHandle(1, newFakeAssetStore(), time.Hour)),
		config.Storage{Local: config.LocalStorage{BaseURL: "https://api.example.com"}})

	view, err := svc.ViewOf(context.Background(), &model.Asset{
		ID: 10, Kind: "audio", StorageKey: "o0/202611/voice.wav",
		PublicURL:    "https://pub.example.r2.dev/o0/202611/voice.wav",
		ThumbnailURL: "https://pub.example.r2.dev/o0/202611/thumb.png",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ThumbnailURL != "https://pub.example.r2.dev/o0/202611/thumb.png" {
		t.Fatalf("缩略图 URL 不对：%q", view.ThumbnailURL)
	}
	if view.URL != "https://pub.example.r2.dev/o0/202611/voice.wav" {
		t.Fatalf("音频 URL 不对：%q", view.URL)
	}
}

// 普通素材（没有公网地址）仍然走 /files 稳定地址，不受官方音色改动影响。
func TestAssetService_ViewOfPlainAssetStillUsesFilesURL(t *testing.T) {
	svc := NewAssetService(newFakeAssetRepo(), newFakeRegistry(1, objectHandle(1, newFakeAssetStore(), time.Hour)),
		config.Storage{Local: config.LocalStorage{BaseURL: "https://api.example.com"}})
	view, err := svc.ViewOf(context.Background(), &model.Asset{ID: 1, Kind: "audio", StorageKey: "u7/202611/a.wav"})
	if err != nil {
		t.Fatal(err)
	}
	if view.URL != "https://api.example.com/files/u7/202611/a.wav" || view.ThumbnailURL != "" {
		t.Fatalf("普通素材视图不对：%+v", view)
	}
}

// 官方音色带公网地址：Open 直接按 URL 取内容，不查存储配置（registry 里没有任何存储也能打开），
// 给上游的 URL 就是这个公网地址。
func TestAssetService_OpenOfficialVoiceByPublicURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/o0/202611/voice.wav" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write([]byte("wav-bytes"))
	}))
	defer srv.Close()

	repo := newFakeAssetRepo()
	repo.rows[10] = &model.Asset{ID: 10, UserID: 0, Kind: "audio", Source: model.AssetSourceOfficial,
		StorageKey: "o0/202611/voice.wav", PublicURL: srv.URL + "/o0/202611/voice.wav", MimeType: "audio/wav"}
	svc := NewAssetService(repo, newFakeRegistry(0), config.Storage{})

	f, err := svc.Open(context.Background(), 42, 10)
	if err != nil {
		t.Fatalf("官方音色应能按公网地址打开：%v", err)
	}
	defer f.Body.Close()
	body, _ := io.ReadAll(f.Body)
	if string(body) != "wav-bytes" {
		t.Fatalf("内容不对：%q", body)
	}
	if f.URL != srv.URL+"/o0/202611/voice.wav" || !f.Remote {
		t.Fatalf("应直接给上游公网地址并标记远端：%+v", f)
	}
}

// 公网地址取不到（对象被删、桶下线）：按“素材不存在”处理，不把上游错误细节透给调用方。
func TestAssetService_OpenOfficialVoiceByPublicURLMissing(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	repo := newFakeAssetRepo()
	repo.rows[10] = &model.Asset{ID: 10, UserID: 0, Kind: "audio", Source: model.AssetSourceOfficial,
		StorageKey: "o0/202611/gone.wav", PublicURL: srv.URL + "/o0/202611/gone.wav"}
	svc := NewAssetService(repo, newFakeRegistry(0), config.Storage{})

	if _, err := svc.Open(context.Background(), 42, 10); !errors.Is(err, provider.ErrAssetNotFound) {
		t.Fatalf("期望 ErrAssetNotFound，得到 %v", err)
	}
}

// provider.AssetStore 接口约束：Get 的语义变化不能破坏原有一致性（找不到就是 ErrAssetNotFound）。
func TestAssetService_GetOfficialMissingStillFails(t *testing.T) {
	svc := NewAssetService(newFakeAssetRepo(), newFakeRegistry(1, objectHandle(1, newFakeAssetStore(), time.Hour)), config.Storage{})
	if _, err := svc.Get(context.Background(), 1, 999); err == nil {
		t.Fatal("不存在的素材必须报错")
	}
	_ = provider.ErrAssetNotFound // 保持 import，错误类型由 service 内部翻译
}
