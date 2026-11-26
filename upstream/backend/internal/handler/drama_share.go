package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"video-canvas/internal/middleware"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/response"
	"video-canvas/internal/pkg/utils"
	"video-canvas/internal/service"
	"video-canvas/pkg/pagination"
)

// DramaShareHandler exposes short-drama sharing endpoints.
type DramaShareHandler struct{ service *service.DramaShareService }

// NewDramaShareHandler wires the sharing service into HTTP handlers.
func NewDramaShareHandler(s *service.DramaShareService) *DramaShareHandler {
	return &DramaShareHandler{service: s}
}

// Share grants view access, creates a copy, or transfers a drama.
func (h *DramaShareHandler) Share(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	var req model.DramaShareReq
	if !BindJSON(c, &req) {
		return
	}
	ctx := c.Request.Context()
	if req.Mode != "view" {
		deadline := relaxTransferDeadlines(c)
		// 给失败后的素材回收和 HTTP 响应留出时间。
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, deadline.Add(-30*time.Second))
		defer cancel()
	}
	if err := h.service.Share(ctx, currentUserID(c), id, req); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			err = errcode.ErrInternal.WithMsg("短剧交付超时，请重试")
		}
		response.Fail(c, err)
		return
	}
	response.NoContent(c)
}

// Members lists viewers for a drama owned by the current user.
func (h *DramaShareHandler) Members(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	items, err := h.service.Members(c.Request.Context(), currentUserID(c), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, items)
}

// Remove revokes a viewer's access or lets the viewer leave.
func (h *DramaShareHandler) Remove(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	member := currentUserID(c)
	if raw := c.Param("member"); raw != "me" {
		member, ok = idcodec.Decode(raw)
		if !ok {
			response.Fail(c, errcode.ErrInvalidParams)
			return
		}
	}
	if err := h.service.Remove(c.Request.Context(), currentUserID(c), id, member); err != nil {
		response.Fail(c, err)
		return
	}
	response.NoContent(c)
}

// Shared lists dramas shared with the current user.
func (h *DramaShareHandler) Shared(c *gin.Context) {
	var req struct {
		pagination.Query
		Keyword string `form:"keyword" binding:"max=255"`
	}
	if !BindQuery(c, &req) {
		return
	}
	req.Normalize()
	items, total, err := h.service.Shared(c.Request.Context(), currentUserID(c), req.Keyword, req.Page, req.PageSize)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OKPage(c, items, total, req.Page, req.PageSize)
}

// Read returns the non-editable projection of a shared drama.
func (h *DramaShareHandler) Read(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	view, err := h.service.Read(c.Request.Context(), currentUserID(c), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	response.OK(c, view)
}

// Workspace opens the shared project and issues its scoped media cookie.
func (h *DramaShareHandler) Workspace(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := CanvasPathID(c)
		if !ok {
			return
		}
		work, err := h.service.Workspace(c.Request.Context(), currentUserID(c), id)
		if err != nil {
			response.Fail(c, err)
			return
		}
		ticket, _, err := utils.GenerateToken(middleware.GetUserID(c), "", middleware.GetTokenVersion(c), secret+":"+c.Param("id"), "drama-media", 1)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.SetSameSite(http.SameSiteStrictMode)
		c.SetCookie("drama_media", ticket, 3600, "/api/v1/drama-media/"+c.Param("id")+"/", "", c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", true)
		c.Header("Cache-Control", "private, no-store")
		response.OK(c, work)
	}
}

// Media streams one asset after checking its current project grant.
func (h *DramaShareHandler) Media(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	asset, ok := idcodec.Decode(c.Param("asset"))
	if !ok {
		response.Fail(c, errcode.ErrAssetNotFound)
		return
	}
	file, err := h.service.Media(c.Request.Context(), currentUserID(c), id, asset)
	if err != nil {
		response.Fail(c, err)
		return
	}
	defer file.Body.Close()
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	if body, ok := file.Body.(io.ReadSeeker); ok {
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Type", file.Asset.MimeType)
		http.ServeContent(c.Writer, c.Request, "media", file.Asset.CreatedAt, body)
		return
	}
	c.DataFromReader(200, file.Asset.ByteSize, file.Asset.MimeType, file.Body, map[string]string{"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
}
