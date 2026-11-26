package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/provider"
	"video-canvas/internal/repository"
)

type sharedWorkspace struct {
	Project  *model.DramaView                 `json:"project"`
	Canvas   *model.CanvasProjectView         `json:"canvas"`
	Episodes map[int]model.DramaEpisodeView   `json:"episodes"`
	Segments map[int][]model.DramaSegmentView `json:"segments"`
	Units    []model.DramaUnit                `json:"units"`
}

type sharedMediaViews map[uint64]*model.AssetView

func (views sharedMediaViews) View(_ context.Context, _, id uint64) (*model.AssetView, error) {
	return views[id], nil
}

func (s *DramaShareService) sharedSnapshot(ctx context.Context, user, id uint64) (*repository.DramaSnapshot, error) {
	owner, err := s.repo.ViewOwner(ctx, user, id)
	if err != nil {
		return nil, shareError(err)
	}
	snapshot, err := s.repo.Snapshot(ctx, owner, id, false)
	return snapshot, shareError(err)
}

// Workspace projects the shared project without running author-side task reconciliation.
func (s *DramaShareService) Workspace(ctx context.Context, user, id uint64) (*sharedWorkspace, error) {
	snapshot, err := s.sharedSnapshot(ctx, user, id)
	if err != nil {
		return nil, err
	}
	graph := shareGraph{assets: map[uint64]*sharedAsset{}}
	if err := graph.collect(snapshot); err != nil {
		return nil, err
	}
	views := sharedMediaViews{}
	for assetID, ref := range graph.assets {
		row, err := s.assets.Get(ctx, snapshot.Project.UserID, assetID)
		if err != nil {
			if errors.Is(err, provider.ErrAssetNotFound) {
				continue
			}
			return nil, err
		}
		ref.asset = row
		ref.url = "/api/v1/drama-media/" + idcodec.Encode(id) + "/" + idcodec.Encode(assetID)
		views[assetID] = assetView(row, ref.url)
	}
	canvas := snapshot.Canvas.View()
	canvas.PayloadJSON, err = graph.payload(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	canvas.PayloadJSON, err = sanitizeSharedGraph(canvas.PayloadJSON, id)
	if err != nil {
		return nil, err
	}
	work := &sharedWorkspace{Project: dramaProjectView(&snapshot.Project), Canvas: canvas, Episodes: map[int]model.DramaEpisodeView{}, Segments: map[int][]model.DramaSegmentView{}, Units: snapshot.Units}
	for _, job := range snapshot.Jobs {
		view := jobView(job)
		view.Result = nil
		work.Project.ActiveJobs = append(work.Project.ActiveJobs, view)
	}
	return work, work.addEpisodes(ctx, snapshot, views)
}

func sanitizeSharedGraph(raw []byte, id uint64) ([]byte, error) {
	var data any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	if err := dec.Decode(&data); err != nil {
		return nil, err
	}
	cleanSharedURLs(data, "/api/v1/drama-media/"+idcodec.Encode(id)+"/")
	return json.Marshal(data)
}

func cleanSharedURLs(data any, prefix string) {
	switch item := data.(type) {
	case []any:
		for _, child := range item {
			cleanSharedURLs(child, prefix)
		}
	case map[string]any:
		for key, child := range item {
			if value, ok := child.(string); ok && (strings.HasSuffix(strings.ToLower(key), "url") || key == "src" || strings.Contains(value, "/files/")) && !strings.HasPrefix(value, prefix) {
				item[key] = ""
			} else {
				cleanSharedURLs(child, prefix)
			}
		}
	}
}

func (w *sharedWorkspace) addEpisodes(ctx context.Context, s *repository.DramaSnapshot, views sharedMediaViews) error {
	boards, err := drama.BoardHashes(s.Canvas.PayloadJSON)
	if err != nil {
		return err
	}
	tasks := map[string][]model.GenerationTask{}
	for _, task := range s.Tasks {
		tasks[task.NodeID] = append(tasks[task.NodeID], task)
	}
	rows := map[uint64][]model.DramaSegment{}
	for _, seg := range s.Segments {
		rows[seg.EpisodeID] = append(rows[seg.EpisodeID], seg)
	}
	reader := DramaSegmentService{assets: views}
	for _, row := range s.Episodes {
		ep := episodeView(row)
		if row.FinalAssetID != nil {
			ep.Final = views[*row.FinalAssetID]
			ep.FinalStale = row.SegmentVersion != row.FinalSegmentVersion
		}
		for _, seg := range rows[row.ID] {
			key := idcodec.Encode(seg.ID)
			v, err := reader.segmentView(ctx, &seg, ep.No, tasks["seg:"+key])
			if err != nil {
				return err
			}
			w.Segments[ep.No] = append(w.Segments[ep.No], *v)
			ep.SegmentCount++
			ep.SegmentSeconds += seg.Seconds
			if seg.ChosenTaskID != nil {
				ep.DoneSegmentCount++
			}
			if hash, ok := boards[key]; ok && hash == drama.SourceHash(seg.Prompt) {
				ep.DoneBoardCount++
			}
		}
		w.Episodes[ep.No] = ep
		w.Project.Episodes = append(w.Project.Episodes, ep.DramaEpisodeSummary)
	}
	return nil
}
