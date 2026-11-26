package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"video-canvas/internal/model"
)

// DramaSnapshot is the data required to clone or render a drama.
type DramaSnapshot struct {
	Project  model.DramaProject
	Canvas   model.CanvasProject
	Units    []model.DramaUnit
	Episodes []model.DramaEpisode
	Segments []model.DramaSegment
	Tasks    []model.GenerationTask
	Jobs     []model.DramaJob
}

// LockSnapshot locks drama-owned rows so delivery cannot race concurrent edits.
func (r *DramaShareRepository) LockSnapshot(ctx context.Context, user, id uint64) error {
	if err := r.lockOwner(ctx, user, id); err != nil {
		return err
	}
	var project model.DramaProject
	if err := r.owned(ctx, user, id).Take(&project).Error; err != nil {
		return translate(err)
	}
	var canvas model.CanvasProject
	if err := r.db.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND drama_id = ? AND id = ?", user, id, project.CanvasID).Take(&canvas).Error; err != nil {
		return translate(err)
	}
	var episodes []model.DramaEpisode
	if err := r.db.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND drama_id = ?", user, id).Order("id").Find(&episodes).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND episode_id IN (?)", user, r.db.Model(&model.DramaEpisode{}).Select("id").Where("user_id = ? AND drama_id = ?", user, id)).Order("id").Find(&[]model.DramaSegment{}).Error
}

// SelectCopiedTake selects the cloned generation task for a segment.
func (r *DramaShareRepository) SelectCopiedTake(ctx context.Context, user, id, task uint64) error {
	return r.db.WithContext(ctx).Model(&model.DramaSegment{}).Where("user_id = ? AND id = ?", user, id).Update("chosen_task_id", task).Error
}

// Snapshot reads a user's drama and related canvas, episodes, segments, and takes.
func (r *DramaShareRepository) Snapshot(ctx context.Context, user, id uint64, delivery bool) (*DramaSnapshot, error) {
	var snapshot DramaSnapshot
	if err := r.owned(ctx, user, id).Take(&snapshot.Project).Error; err != nil {
		return nil, translate(err)
	}
	db := r.db.WithContext(ctx)
	if err := db.Where("user_id = ? AND drama_id = ? AND id = ?", user, id, snapshot.Project.CanvasID).Take(&snapshot.Canvas).Error; err != nil {
		return nil, translate(err)
	}
	belongs := db.Where("user_id = ? AND drama_id = ?", user, id)
	if delivery {
		if err := r.deliveryReady(ctx, &snapshot.Project); err != nil {
			return nil, err
		}
	}
	if err := belongs.Session(&gorm.Session{}).Order("no").Find(&snapshot.Units).Error; err != nil {
		return nil, err
	}
	if err := belongs.Session(&gorm.Session{}).Order("no").Find(&snapshot.Episodes).Error; err != nil {
		return nil, err
	}
	episodes := belongs.Session(&gorm.Session{}).Model(&model.DramaEpisode{}).Select("id")
	if err := db.Where("user_id = ? AND episode_id IN (?)", user, episodes).Order("episode_id,seq,id").Find(&snapshot.Segments).Error; err != nil {
		return nil, err
	}
	tasks := db.Select("id,node_id,kind,model_id,status,output_json,error_message,created_at").Where("user_id = ? AND canvas_project_id = ? AND is_test = false AND node_id LIKE 'seg:%'", user, snapshot.Canvas.ID)
	if delivery {
		tasks = tasks.Where("status = ?", model.TaskSucceeded)
	} else if err := belongs.Session(&gorm.Session{}).Where("status IN ?", []string{"queued", "running"}).Find(&snapshot.Jobs).Error; err != nil {
		return nil, err
	}
	err := tasks.Order("created_at,id").Find(&snapshot.Tasks).Error
	return &snapshot, err
}

func (r *DramaShareRepository) deliveryReady(ctx context.Context, p *model.DramaProject) error {
	db := r.db.WithContext(ctx)
	queries := []*gorm.DB{
		db.Model(&model.DramaJob{}).Where("user_id = ? AND drama_id = ? AND status IN ?", p.UserID, p.ID, []string{"queued", "running"}),
		db.Model(&model.GenerationTask{}).Where("user_id = ? AND canvas_project_id = ? AND status IN ?", p.UserID, p.CanvasID, model.ActiveTaskStatuses),
		db.Model(&model.StoryboardSplitJob{}).Where("user_id = ? AND canvas_id = ? AND status IN ?", p.UserID, p.CanvasID, []string{"pending", "running"}),
	}
	for _, query := range queries {
		var count int64
		if err := query.Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrInUse
		}
	}
	return nil
}

// Receipt reports whether an identical delivery has completed.
func (r *DramaShareRepository) Receipt(ctx context.Context, request model.DramaDelivery) (bool, error) {
	var saved model.DramaDelivery
	err := r.db.WithContext(ctx).Where("user_id = ? AND request_key = ?", request.UserID, request.RequestKey).Take(&saved).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if saved.DramaID != request.DramaID || saved.Mode != request.Mode || saved.Recipient != request.Recipient {
		return false, ErrRevisionConflict
	}
	return saved.Status == "complete", nil
}

// Claim serializes requests with the same idempotency key.
func (r *DramaShareRepository) Claim(ctx context.Context, request model.DramaDelivery) (bool, error) {
	claimed := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing model.DramaDelivery
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND request_key = ?", request.UserID, request.RequestKey).Take(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			request.Status = "running"
			if err := tx.Create(&request).Error; err != nil {
				return err
			}
			claimed = true
			return nil
		}
		if err != nil {
			return err
		}
		if existing.DramaID != request.DramaID || existing.Mode != request.Mode || existing.Recipient != request.Recipient {
			return ErrRevisionConflict
		}
		if existing.Status == "complete" {
			return nil
		}
		return ErrInUse
	})
	if errors.Is(err, ErrDuplicate) {
		return false, ErrInUse
	}
	return claimed, translate(err)
}

// Complete marks a claimed delivery as committed.
func (r *DramaShareRepository) Complete(ctx context.Context, request model.DramaDelivery) error {
	return r.db.WithContext(ctx).Model(&model.DramaDelivery{}).Where("user_id = ? AND request_key = ? AND status = ?", request.UserID, request.RequestKey, "running").Updates(map[string]any{"status": "complete", "result_id": request.ResultID}).Error
}

// Release removes a failed delivery claim so it can be retried.
func (r *DramaShareRepository) Release(ctx context.Context, request model.DramaDelivery) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND request_key = ? AND status = ?", request.UserID, request.RequestKey, "running").Delete(&model.DramaDelivery{}).Error
}

// SaveNew creates a row in the current repository transaction.
func (r *DramaShareRepository) SaveNew(ctx context.Context, row any) error {
	return r.db.WithContext(ctx).Create(row).Error
}

// LinkCanvas updates the cloned canvas payload and its drama association.
func (r *DramaShareRepository) LinkCanvas(ctx context.Context, canvas *model.CanvasProject) error {
	return r.db.WithContext(ctx).Model(canvas).Where("user_id = ?", canvas.UserID).Updates(map[string]any{"drama_id": canvas.DramaID, "payload_json": canvas.PayloadJSON, "cover_asset_id": canvas.CoverAssetID}).Error
}

// Retire removes the source drama and all viewer grants after a transfer.
func (r *DramaShareRepository) Retire(ctx context.Context, user, id uint64) error {
	if err := r.lockOwner(ctx, user, id); err != nil {
		return err
	}
	if err := r.db.WithContext(ctx).Where("drama_id = ?", id).Delete(&model.DramaViewer{}).Error; err != nil {
		return err
	}
	return NewDramaRepository(r.db).DeleteProject(ctx, user, id)
}
