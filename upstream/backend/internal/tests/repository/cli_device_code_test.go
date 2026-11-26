package repository_test

import (
	"context"
	"testing"
	"time"

	"video-canvas/internal/model"
	. "video-canvas/internal/repository"
)

// 发起方 IP 要随记录落库、能读回来（授权页展示它）；过期清理只删过期早于截止时间的记录。
func TestCLIDeviceRepo_CreatedIPAndDeleteExpired(t *testing.T) {
	ctx := context.Background()
	repo := NewCLIDeviceRepository(userDB(t))
	now := time.Now().Truncate(time.Millisecond)

	mk := func(hash, userCode, ip string, expires time.Time) {
		t.Helper()
		err := repo.Create(ctx, &model.CLIDeviceCode{
			DeviceCodeHash: hash, UserCode: userCode, CreatedIP: ip, Status: model.CLIDevicePending,
			IntervalSeconds: 5, ExpiresAt: expires, CreatedAt: now, UpdatedAt: now,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	mk("h-old", "OLDOLDOL", "203.0.113.1", now.Add(-48*time.Hour))
	mk("h-new", "NEWNEWNE", "2001:db8::1", now.Add(10*time.Minute))

	got, err := repo.GetByUserCode(ctx, "NEWNEWNE")
	if err != nil || got.CreatedIP != "2001:db8::1" {
		t.Fatalf("created_ip 应落库并读回（含 IPv6）：%+v %v", got, err)
	}

	n, err := repo.DeleteExpired(ctx, now.Add(-24*time.Hour))
	if err != nil || n != 1 {
		t.Fatalf("应只删过期 48 小时的那条：n=%d err=%v", n, err)
	}
	if _, err := repo.GetByUserCode(ctx, "OLDOLDOL"); err == nil {
		t.Fatal("过期记录应已删除")
	}
	if _, err := repo.GetByUserCode(ctx, "NEWNEWNE"); err != nil {
		t.Fatalf("未过期记录应保留：%v", err)
	}
}
