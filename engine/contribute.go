package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// OCRMenu is the seam for DEV3's vision.go menu OCR. Until wired, it returns an
// error so contribute/menu degrades gracefully to a "needs confirm" response.
var OCRMenu = func(img []byte) ([]Dish, error) {
	return nil, errors.New("OCR chưa nối (DEV3 vision.go)")
}

// ContribStore is the only stateful write path: a flat contributions.json array
// guarded by a mutex. It also mirrors new POIs into the live KB so UGC appears
// in /v1/recommend (always flagged source=user_contributed, verified=false).
type ContribStore struct {
	mu   sync.Mutex
	path string
	kb   *KB
	list []*POI // UGC POIs only (for rewrite)
}

// NewContribStore loads existing UGC from <buildDir>/contributions.json. The
// records are already indexed in kb by LoadKB(includeUGC=true); here we only
// re-read the file to own the rewrite slice.
func NewContribStore(buildDir string, kb *KB) *ContribStore {
	s := &ContribStore{path: filepath.Join(buildDir, "contributions.json"), kb: kb, list: []*POI{}}
	if raw, err := os.ReadFile(s.path); err == nil {
		var existing []*POI
		if json.Unmarshal(raw, &existing) == nil {
			s.list = existing
		}
	}
	return s
}

// persist rewrites the whole contributions file (caller holds the lock).
func (s *ContribStore) persist() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

type contributeReq struct {
	Name        string   `json:"name"`
	Lat         *float64 `json:"lat"`
	Lon         *float64 `json:"lon"`
	City        string   `json:"city"`
	Category    string   `json:"category"`
	CuisineType string   `json:"cuisine_type"`
	PriceLevel  string   `json:"price_level"`
	Note        string   `json:"note"`
}

// HandleContribute adds a user-contributed POI (POST /v1/contribute, JSON).
func (s *ContribStore) HandleContribute(w http.ResponseWriter, r *http.Request) {
	var req contributeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Body JSON không hợp lệ", nil)
		return
	}
	if req.Name == "" || req.Lat == nil || req.Lon == nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu name hoặc lat/lon", nil)
		return
	}
	// Vietnam bounding box.
	if *req.Lat < 8 || *req.Lat > 24 || *req.Lon < 102 || *req.Lon > 110 {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "lat/lon ngoài phạm vi Việt Nam", nil)
		return
	}

	price := req.PriceLevel
	if price == "" {
		price = "mid"
	}
	category := req.Category
	if category == "" {
		category = "Nhà hàng"
	}
	id := "ugc:" + randHex(8)
	p := &POI{
		ID:           id,
		RestaurantID: id,
		Name:         req.Name,
		Category:     category,
		CuisineType:  req.CuisineType,
		City:         req.City,
		Address:      req.Note,
		Lat:          *req.Lat,
		Lon:          *req.Lon,
		PriceLevel:   price,
		Opening:      Opening{OpenMin: 0, CloseMin: 1440, Overnight: false, Raw: "00:00-24:00"},
		Quality:      0.5,
		Source:       "user_contributed",
		Verified:     false,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		KnownEntities: KnownEntities{
			Names:  []string{norm(req.Name)},
			Dishes: []string{},
		},
	}

	s.mu.Lock()
	s.kb.Add(p) // indexes + ensures non-nil slices + builds search set
	s.list = append(s.list, p)
	err := s.persist()
	s.mu.Unlock()
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal", "Không lưu được đóng góp", err.Error())
		return
	}

	writeJSON(w, r, http.StatusCreated, toPlaceResult(p))
}

// HandleContributeMenu attaches OCR'd menu dishes to a POI
// (POST /v1/contribute/menu, multipart: poi_id + image).
func (s *ContribStore) HandleContributeMenu(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Form multipart không hợp lệ", nil)
		return
	}
	poiID := r.FormValue("poi_id")
	if poiID == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu poi_id", nil)
		return
	}
	p := s.kb.Get(poiID)
	if p == nil {
		writeError(w, r, http.StatusNotFound, "not_found", "Không tìm thấy poi_id", nil)
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

	dishes, err := OCRMenu(imgBytes)
	if err != nil {
		// Seam not wired yet: honest degraded response, no fabrication.
		writeJSON(w, r, http.StatusOK, map[string]any{
			"poi_id":       poiID,
			"dishes":       []Dish{},
			"needs_confirm": true,
			"note":         "OCR chưa nối",
		})
		return
	}

	s.mu.Lock()
	p.Dishes = append(p.Dishes, dishes...)
	p.buildIndex()
	// Persist only if this POI is user-contributed (benchmark stays immutable).
	if p.Source == "user_contributed" {
		_ = s.persist()
	}
	s.mu.Unlock()

	writeJSON(w, r, http.StatusOK, map[string]any{
		"poi_id":        poiID,
		"dishes":        dishes,
		"needs_confirm": true,
	})
}

// toPlaceResult renders a POI as a PlaceResult without scoring (score 0).
func toPlaceResult(p *POI) PlaceResult {
	return PlaceResult{
		ID:          p.ID,
		Type:        "poi",
		Name:        p.Name,
		Label:       p.Category,
		Address:     p.Address,
		Category:    p.CuisineType,
		Coordinates: Coordinates{Lat: p.Lat, Lon: p.Lon},
		Score:       0,
		Source:      p.Source,
		Tags:        buildTags(p),
		Meta: PlaceMeta{
			Why:           Why{},
			Reasoning:     "",
			Quality:       p.Quality,
			MatchedDishes: []MatchedDish{},
			Verified:      p.Verified,
		},
	}
}

// randHex returns n random bytes as a hex string (crypto/rand).
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}
