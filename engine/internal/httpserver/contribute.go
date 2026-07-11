package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"tascop11/engine/internal/contribute"
	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/model"
)

// toPlaceResult renders a POI as a PlaceResult without scoring (score 0) —
// used for the /v1/contribute creation response.
func toPlaceResult(p *kb.POI) model.PlaceResult {
	tags := append([]string{}, p.Segments...)
	tags = append(tags, p.Amenities...)
	return model.PlaceResult{
		ID:          p.ID,
		Type:        "poi",
		Name:        p.Name,
		Label:       p.Category,
		Address:     p.Address,
		Category:    p.CuisineType,
		Coordinates: model.Coordinates{Lat: p.Lat, Lon: p.Lon},
		Score:       0,
		Source:      p.Source,
		Tags:        tags,
		Meta: model.PlaceMeta{
			Why:           model.Why{},
			Reasoning:     "",
			Quality:       p.Quality,
			MatchedDishes: []model.MatchedDish{},
			Verified:      p.Verified,
		},
	}
}

func (s *Server) handleContribute(w http.ResponseWriter, r *http.Request) {
	var req contribute.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Body JSON không hợp lệ", nil)
		return
	}

	var userID *string
	if user, err := s.currentUser(r); err == nil && user != nil {
		userID = &user.ID
	}

	p, err := s.contrib.Add(req, userID)
	if err != nil {
		var inv contribute.ErrInvalid
		if errors.As(err, &inv) {
			writeError(w, r, http.StatusBadRequest, "invalid_request", inv.Msg, nil)
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal", "Không lưu được đóng góp", err.Error())
		return
	}

	// Optional contributor-identity attribution (Postgres). Never blocks the
	// contribution itself — the POI is already saved by the time this runs.
	if s.db != nil {
		_ = s.db.SetContributionOwner(r.Context(), p.ID, userID)
	}

	writeJSON(w, r, http.StatusCreated, toPlaceResult(p))
}

func (s *Server) handleContributeMenu(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Form multipart không hợp lệ", nil)
		return
	}
	poiID := r.FormValue("poi_id")
	if poiID == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu poi_id", nil)
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu ảnh menu (image)", nil)
		return
	}
	defer file.Close()
	imgBytes, err := io.ReadAll(file)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Không đọc được ảnh", nil)
		return
	}

	dishes, wired, err := s.contrib.AttachMenu(poiID, imgBytes)
	if err != nil {
		var inv contribute.ErrInvalid
		if errors.As(err, &inv) {
			writeError(w, r, http.StatusNotFound, "not_found", inv.Msg, nil)
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal", "Không gắn được menu", err.Error())
		return
	}
	if !wired {
		// Seam not wired yet: honest degraded response, no fabrication.
		writeJSON(w, r, http.StatusOK, map[string]any{
			"poi_id":        poiID,
			"dishes":        []kb.Dish{},
			"needs_confirm": true,
			"note":          "OCR chưa nối",
		})
		return
	}

	writeJSON(w, r, http.StatusOK, map[string]any{
		"poi_id":        poiID,
		"dishes":        dishes,
		"needs_confirm": true,
	})
}
