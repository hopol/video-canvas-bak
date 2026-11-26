package model

import "time"

// DramaViewer grants one user read access to a drama.
type DramaViewer struct {
	// DramaID identifies the shared drama.
	DramaID uint64 `gorm:"primaryKey;autoIncrement:false;not null;index:idx_drama_viewers_user,priority:2"`
	// UserID identifies the viewer.
	UserID uint64 `gorm:"primaryKey;autoIncrement:false;not null;index:idx_drama_viewers_user,priority:1"`
	// Drama cascades the viewer relation when the drama is deleted.
	Drama DramaProject `gorm:"foreignKey:DramaID;references:ID;constraint:OnDelete:CASCADE" json:"-"`
	// User cascades the viewer relation when the account is deleted.
	User User `gorm:"foreignKey:UserID;references:ID;constraint:OnDelete:CASCADE" json:"-"`
}

// DramaDelivery records an idempotent copy or ownership transfer.
type DramaDelivery struct {
	// UserID identifies the source owner.
	UserID uint64 `gorm:"primaryKey;autoIncrement:false"`
	// RequestKey deduplicates retries from the source owner.
	RequestKey string `gorm:"primaryKey;size:64;not null"`
	// DramaID identifies the source drama.
	DramaID uint64 `gorm:"not null"`
	// Recipient identifies the destination account.
	Recipient uint64 `gorm:"not null"`
	// Mode is copy or transfer.
	Mode string `gorm:"size:12;not null"`
	// ResultID identifies the created destination drama.
	ResultID uint64 `gorm:"not null;default:0"`
	// Status is running until the delivery transaction commits.
	Status string `gorm:"size:16;not null;default:running"`
	// UpdatedAt supports idempotency status inspection.
	UpdatedAt time.Time `gorm:"not null;default:now();autoUpdateTime"`
}

// DramaShareReq describes an email-based sharing action.
type DramaShareReq struct {
	// Mode selects view access, a copy, or ownership transfer.
	Mode string `json:"mode" binding:"required,oneof=view copy transfer"`
	// Email identifies the recipient account.
	Email string `json:"email" binding:"required,email,max=128"`
	// RequestKey makes retried copy and transfer requests idempotent; view grants omit it.
	// The web client sends 32 hex chars; the column holds up to 64.
	RequestKey string `json:"request_key" binding:"required_unless=Mode view,max=64"`
}

// DramaSharedItem is one drama visible to the current user.
type DramaSharedItem struct {
	// ID is the opaque drama identifier.
	ID string `json:"id"`
	// Title is the drama title.
	Title string `json:"title"`
}

// DramaMember is one user allowed to view a drama.
type DramaMember struct {
	// ID is the opaque user identifier.
	ID string `json:"id"`
	// Email is the viewer's account email.
	Email string `json:"email"`
}
