package service

import (
	"context"
	"fmt"
	"strconv"

	"video-canvas/internal/agent/canvasgraph"
	"video-canvas/internal/canvasdoc"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/provider"
	"video-canvas/internal/repository"
)

type dramaReadView struct {
	Title      string             `json:"title"`
	Outline    string             `json:"outline"`
	Characters string             `json:"characters"`
	Episodes   []dramaReadEpisode `json:"episodes"`
	AssetIDs   []string           `json:"asset_ids"`
}

type dramaReadEpisode struct {
	No       int                `json:"no"`
	Title    string             `json:"title"`
	Script   string             `json:"script"`
	Final    string             `json:"final,omitempty"`
	Segments []dramaReadSegment `json:"segments"`
}

type dramaReadSegment struct {
	Prompt   string   `json:"prompt"`
	Board    string   `json:"board,omitempty"`
	Videos   []string `json:"videos"`
	Selected string   `json:"selected,omitempty"`
}

func readAssetID(id uint64) string {
	if id == 0 {
		return ""
	}
	return idcodec.Encode(id)
}

func sharedProjection(snapshot *repository.DramaSnapshot) (*dramaReadView, error) {
	graph, err := canvasgraph.Parse(snapshot.Canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	view := &dramaReadView{Title: snapshot.Project.Title, Outline: snapshot.Project.OutlineMD, Characters: snapshot.Project.CharactersMD, Episodes: []dramaReadEpisode{}}
	refs, err := canvasdoc.CollectRefs(snapshot.Canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	for _, asset := range refs.AssetIDs {
		id, _ := strconv.ParseUint(asset, 10, 64)
		if id > 0 {
			view.AssetIDs = append(view.AssetIDs, idcodec.Encode(id))
		}
	}
	indexes := map[uint64]int{}
	for _, ep := range snapshot.Episodes {
		item := readEpisode(ep)
		indexes[ep.ID] = len(view.Episodes)
		view.Episodes = append(view.Episodes, item)
	}
	if err := appendSharedSegments(snapshot, graph, indexes, view); err != nil {
		return nil, err
	}
	view.AssetIDs = sharedAssetIDs(view)
	return view, nil
}

func readEpisode(ep model.DramaEpisode) dramaReadEpisode {
	item := dramaReadEpisode{No: ep.No, Title: ep.Title, Script: ep.ScriptMD, Segments: []dramaReadSegment{}}
	if ep.FinalAssetID != nil {
		item.Final = readAssetID(*ep.FinalAssetID)
	}
	return item
}

func appendSharedSegments(snapshot *repository.DramaSnapshot, graph *canvasgraph.Graph, indexes map[uint64]int, view *dramaReadView) error {
	for _, seg := range snapshot.Segments {
		item, err := readSegment(snapshot, graph, &seg)
		if err != nil {
			return err
		}
		ep := &view.Episodes[indexes[seg.EpisodeID]]
		ep.Segments = append(ep.Segments, item)
	}
	return nil
}

func readSegment(snapshot *repository.DramaSnapshot, graph *canvasgraph.Graph, segment *model.DramaSegment) (dramaReadSegment, error) {
	item := dramaReadSegment{Prompt: segment.Prompt, Videos: []string{}}
	encoded := idcodec.Encode(segment.ID)
	if board := canvasgraph.FindBoard(graph, encoded); board != nil {
		asset, _ := strconv.ParseUint(fmt.Sprint(board.Data()["assetId"]), 10, 64)
		item.Board = readAssetID(asset)
	}
	for _, task := range snapshot.Tasks {
		if task.NodeID != "seg:"+encoded {
			continue
		}
		asset, err := segmentOutputAsset(&task, "video")
		if err != nil {
			return dramaReadSegment{}, err
		}
		if asset == 0 {
			continue
		}
		video := readAssetID(asset)
		item.Videos = append(item.Videos, video)
		if segment.ChosenTaskID != nil && *segment.ChosenTaskID == task.ID {
			item.Selected = video
		}
	}
	return item, nil
}

func sharedAssetIDs(view *dramaReadView) []string {
	allowed := map[string]bool{}
	for _, asset := range view.AssetIDs {
		allowed[asset] = true
	}
	for _, ep := range view.Episodes {
		if ep.Final != "" {
			allowed[ep.Final] = true
		}
		for _, seg := range ep.Segments {
			if seg.Board != "" {
				allowed[seg.Board] = true
			}
			for _, asset := range seg.Videos {
				allowed[asset] = true
			}
		}
	}
	assets := make([]string, 0, len(allowed))
	for asset := range allowed {
		assets = append(assets, asset)
	}
	return assets
}

// Read returns the shared, non-editable drama projection for an authorized viewer.
func (s *DramaShareService) Read(ctx context.Context, user, id uint64) (*dramaReadView, error) {
	v, _, err := s.readShared(ctx, user, id)
	return v, err
}

func (s *DramaShareService) readShared(ctx context.Context, user, id uint64) (*dramaReadView, uint64, error) {
	owner, err := s.repo.ViewOwner(ctx, user, id)
	if err != nil {
		return nil, 0, shareError(err)
	}
	snapshot, err := s.repo.Snapshot(ctx, owner, id, false)
	if err != nil {
		return nil, 0, shareError(err)
	}
	view, err := sharedProjection(snapshot)
	return view, owner, err
}

// Media opens a source-owned asset only when the active share includes it.
func (s *DramaShareService) Media(ctx context.Context, user, id, asset uint64) (*provider.AssetFile, error) {
	snapshot, err := s.sharedSnapshot(ctx, user, id)
	if err != nil {
		return nil, err
	}
	graph := shareGraph{assets: map[uint64]*sharedAsset{}}
	if err := graph.collect(snapshot); err != nil {
		return nil, err
	}
	if graph.assets[asset] == nil {
		return nil, errcode.ErrAssetNotFound
	}
	file, err := s.assets.Open(ctx, snapshot.Project.UserID, asset)
	return file, shareError(err)
}
