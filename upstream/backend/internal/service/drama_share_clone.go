package service

import (
	"context"
	"encoding/json"
	"time"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

func (c *shareClone) write(ctx context.Context, tx *repository.DramaShareRepository, s *repository.DramaSnapshot) error {
	canvas := model.CanvasProject{UserID: c.user, Title: s.Canvas.Title, PayloadJSON: []byte(`{}`)}
	if err := tx.SaveNew(ctx, &canvas); err != nil {
		return err
	}
	c.canvas = canvas.ID
	project := s.Project
	project.BaseModel = model.BaseModel{}
	project.UpdatedAt = time.Time{}
	project.UserID = c.user
	project.CanvasID = c.canvas
	project.Revision = 1
	project.SourceAssetID = c.assetID(project.SourceAssetID)
	if err := tx.SaveNew(ctx, &project); err != nil {
		return err
	}
	c.drama = project.ID
	for _, unit := range s.Units {
		unit.ID, unit.UserID, unit.DramaID = 0, c.user, c.drama
		if err := tx.SaveNew(ctx, &unit); err != nil {
			return err
		}
	}
	for _, episode := range s.Episodes {
		original := episode.ID
		episode.BaseModel = model.BaseModel{}
		episode.UserID, episode.DramaID = c.user, c.drama
		episode.FinalAssetID = c.assetID(episode.FinalAssetID)
		if err := tx.SaveNew(ctx, &episode); err != nil {
			return err
		}
		c.episodeIDs[original] = episode.ID
	}
	if err := c.writeTakes(ctx, tx, s); err != nil {
		return err
	}
	raw, err := c.graph.payload(s.Canvas.PayloadJSON)
	if err != nil {
		return err
	}
	canvas.PayloadJSON = raw
	canvas.DramaID = &c.drama
	if id := c.assetID(&s.Canvas.CoverAssetID); id != nil {
		canvas.CoverAssetID = *id
	}
	return tx.LinkCanvas(ctx, &canvas)
}

func (c *shareClone) writeTakes(ctx context.Context, tx *repository.DramaShareRepository, s *repository.DramaSnapshot) error {
	segments := make([]model.DramaSegment, 0, len(s.Segments))
	for _, segment := range s.Segments {
		original := segment.ID
		chosen := segment.ChosenTaskID
		segment.BaseModel = model.BaseModel{}
		segment.UserID = c.user
		segment.EpisodeID = c.episodeIDs[segment.EpisodeID]
		segment.ChosenTaskID = nil
		if err := tx.SaveNew(ctx, &segment); err != nil {
			return err
		}
		c.newSegment(original, segment.ID)
		segment.ChosenTaskID = chosen
		segments = append(segments, segment)
	}
	for _, source := range s.Tasks {
		node := c.segmentNode(source.NodeID)
		if node == "" {
			continue
		}
		outputs, err := c.remapOutputs(source)
		if err != nil {
			return err
		}
		task := model.GenerationTask{UserID: c.user, CanvasProjectID: &c.canvas, NodeID: node, Kind: source.Kind, ModelKey: source.ModelKey, Provider: "shared", Status: model.TaskSucceeded, InputJSON: []byte(`{}`), ConfigSnapshot: []byte(`{}`), OutputJSON: outputs, CreatedAt: source.CreatedAt, NextPollAt: source.CreatedAt, DeadlineAt: source.CreatedAt}
		if err := tx.SaveNew(ctx, &task); err != nil {
			return err
		}
		c.taskIDs[source.ID] = task.ID
	}
	for _, segment := range segments {
		if segment.ChosenTaskID == nil {
			continue
		}
		chosen := c.taskIDs[*segment.ChosenTaskID]
		if chosen == 0 {
			return repository.ErrRevisionConflict
		}
		if err := tx.SelectCopiedTake(ctx, c.user, segment.ID, chosen); err != nil {
			return err
		}
	}
	return nil
}

func (c *shareClone) remapOutputs(source model.GenerationTask) ([]byte, error) {
	outputs, err := shareOutputs(source)
	if err != nil {
		return nil, err
	}
	for index := range outputs {
		out := &outputs[index]
		if ref := c.graph.assets[out.AssetID]; ref != nil {
			out.AssetID, out.URL = ref.asset.ID, ref.url
		}
		if ref := c.graph.assets[out.CoverAssetID]; ref != nil {
			out.CoverAssetID = ref.asset.ID
		}
	}
	return json.Marshal(outputs)
}
