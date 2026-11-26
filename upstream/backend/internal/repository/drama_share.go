package repository

import (
	"context"
	"database/sql"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
)

// DramaShareRepository persists drama sharing and delivery state.
type DramaShareRepository struct{ db *gorm.DB }

// NewDramaShareRepository creates a sharing repository.
func NewDramaShareRepository(db *gorm.DB) *DramaShareRepository { return &DramaShareRepository{db: db} }

// WithTx runs sharing changes in a serializable database transaction.
func (r *DramaShareRepository) WithTx(ctx context.Context, fn func(*DramaShareRepository) error) error {
	return translate(r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return fn(NewDramaShareRepository(tx)) }, &sql.TxOptions{Isolation: sql.LevelSerializable}))
}

func (r *DramaShareRepository) owned(ctx context.Context, user, id uint64) *gorm.DB {
	return r.db.WithContext(ctx).Model(&model.DramaProject{}).Where("drama_projects.user_id = ? AND drama_projects.id = ?", user, id)
}

func (r *DramaShareRepository) shared(ctx context.Context, user uint64) *gorm.DB {
	return r.db.WithContext(ctx).Model(&model.DramaProject{}).Joins("JOIN drama_viewers v ON v.drama_id = drama_projects.id AND v.user_id = ?", user)
}

// ViewOwner returns the owner when the user has an active viewer grant.
func (r *DramaShareRepository) ViewOwner(ctx context.Context, user, id uint64) (uint64, error) {
	var project model.DramaProject
	err := r.shared(ctx, user).Select("drama_projects.user_id").Where("drama_projects.id = ?", id).Take(&project).Error
	return project.UserID, translate(err)
}

// Shared lists dramas visible to the viewer.
func (r *DramaShareRepository) Shared(ctx context.Context, user uint64, keyword string, page, size int) ([]model.DramaSharedItem, int64, error) {
	query := r.shared(ctx, user)
	if keyword != "" {
		query = query.Where("title ILIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.DramaProject
	err := query.Select("drama_projects.id,title").Order("drama_projects.updated_at DESC, drama_projects.id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error
	items := make([]model.DramaSharedItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, model.DramaSharedItem{ID: idcodec.Encode(row.ID), Title: row.Title})
	}
	return items, total, err
}

// Recipient resolves an active account by normalized email.
func (r *DramaShareRepository) Recipient(ctx context.Context, email string) (uint64, error) {
	var user model.User
	err := r.db.WithContext(ctx).Select("id").Where("lower(email) = ? AND status = ?", email, model.UserStatusActive).Take(&user).Error
	return user.ID, translate(err)
}

func (r *DramaShareRepository) lockOwner(ctx context.Context, user, id uint64) error {
	return translate(r.owned(ctx, user, id).Select("id").Clauses(clause.Locking{Strength: "UPDATE"}).Take(&model.DramaProject{}).Error)
}

// Grant creates a viewer grant for a drama owned by the user.
func (r *DramaShareRepository) Grant(ctx context.Context, user, id, viewer uint64) error {
	return r.WithTx(ctx, func(tx *DramaShareRepository) error {
		if err := tx.lockOwner(ctx, user, id); err != nil {
			return err
		}
		return tx.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.DramaViewer{DramaID: id, UserID: viewer}).Error
	})
}

// Remove revokes a viewer grant or removes the viewer's own grant.
func (r *DramaShareRepository) Remove(ctx context.Context, user, id, viewer uint64) error {
	return r.WithTx(ctx, func(tx *DramaShareRepository) error {
		if user != viewer {
			if err := tx.lockOwner(ctx, user, id); err != nil {
				return err
			}
		}
		return tx.db.Where("drama_id = ? AND user_id = ?", id, viewer).Delete(&model.DramaViewer{}).Error
	})
}

// Members lists the users allowed to view a drama owned by the caller.
func (r *DramaShareRepository) Members(ctx context.Context, user, id uint64) ([]model.DramaMember, error) {
	var rows []model.User
	var project model.DramaProject
	if err := r.owned(ctx, user, id).Select("id").Take(&project).Error; err != nil {
		return nil, translate(err)
	}
	err := r.db.WithContext(ctx).Select("users.id,users.email").Joins("JOIN drama_viewers v ON v.user_id = users.id").Where("v.drama_id IN (?)", r.owned(ctx, user, id).Select("id")).Order("users.email").Find(&rows).Error
	items := make([]model.DramaMember, 0, len(rows))
	for _, row := range rows {
		items = append(items, model.DramaMember{ID: idcodec.Encode(row.ID), Email: row.Email})
	}
	return items, err
}
