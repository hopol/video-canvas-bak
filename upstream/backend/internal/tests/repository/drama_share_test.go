package repository_test

import (
	"context"
	"errors"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

func TestDramaSharingGrantRevoke(t *testing.T) {
	db := isolatedDB(t, &model.User{}, &model.DramaProject{}, &model.DramaViewer{})
	ctx := context.Background()
	viewer := model.User{Username: "viewer", Email: "viewer@example.test"}
	project := model.DramaProject{UserID: 42, CanvasID: 9, Title: "剧"}
	for _, row := range []any{&viewer, &project} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := repository.NewDramaShareRepository(db)
	if _, err := repo.ViewOwner(ctx, viewer.ID, project.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("授权前: %v", err)
	}
	for range 2 {
		if err := repo.Grant(ctx, 42, project.ID, viewer.ID); err != nil {
			t.Fatal(err)
		}
	}
	if owner, err := repo.ViewOwner(ctx, viewer.ID, project.ID); err != nil || owner != 42 {
		t.Fatalf("授权: %d %v", owner, err)
	}
	if err := repo.Remove(ctx, 42, project.ID, viewer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ViewOwner(ctx, viewer.ID, project.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("撤回后: %v", err)
	}
}

func TestDramaDeliveryClaimSerializesRetry(t *testing.T) {
	db := isolatedDB(t, &model.DramaDelivery{})
	repo := repository.NewDramaShareRepository(db)
	ctx := context.Background()
	request := model.DramaDelivery{UserID: 1, RequestKey: "key", DramaID: 2, Recipient: 3, Mode: "copy"}
	claimed, err := repo.Claim(ctx, request)
	if err != nil || !claimed {
		t.Fatalf("首次领取: %v %v", claimed, err)
	}
	claimed, err = repo.Claim(ctx, request)
	if claimed || !errors.Is(err, repository.ErrInUse) {
		t.Fatalf("进行中重试: %v %v", claimed, err)
	}
	request.ResultID = 7
	if err := repo.Complete(ctx, request); err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.Claim(ctx, request)
	if claimed || err != nil {
		t.Fatalf("完成后重试: %v %v", claimed, err)
	}
}
