// Package contribute is the UGC write path (§5.10): add a POI, attach an
// OCR'd menu. Storage is a mutex-guarded flat contributions.json file — no
// DB required for this path (Postgres, when configured, only adds optional
// contributor-identity metadata on top; see internal/db).
package contribute

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"tascop11/engine/internal/kb"
)

// OCRMenu is the seam for internal/vision's menu OCR. Until wired (by
// cmd/server: `contribute.OCRMenu = vision.OCRMenuImpl`), it returns an
// error so /v1/contribute/menu degrades gracefully to a "needs confirm" response.
var OCRMenu = func(img []byte) ([]kb.Dish, error) {
	return nil, errors.New("OCR chưa nối (internal/vision)")
}

// Store is the only stateful write path: a flat contributions.json array
// guarded by a mutex. It also mirrors new POIs into the live KB so UGC
// appears in /v1/recommend (always flagged source=user_contributed, verified=false).
type Store struct {
	mu   sync.Mutex
	path string
	kb   *kb.KB
	list []*kb.POI // UGC POIs only (for rewrite)

	// OwnerHook, if set, is called after a POI/menu is successfully added so
	// callers can attach optional Postgres contributor-identity metadata
	// (internal/db) without this package depending on internal/db.
	OwnerHook func(poiID string, userID *string)
}

// New loads existing UGC from <buildDir>/contributions.json. The records are
// already indexed in k by kb.LoadKB(includeUGC=true); here we only re-read
// the file to own the rewrite slice.
func New(buildDir string, k *kb.KB) *Store {
	s := &Store{path: filepath.Join(buildDir, "contributions.json"), kb: k, list: []*kb.POI{}}
	if raw, err := os.ReadFile(s.path); err == nil {
		var existing []*kb.POI
		if json.Unmarshal(raw, &existing) == nil {
			s.list = existing
		}
	}
	return s
}

// persist rewrites the whole contributions file (caller holds the lock).
func (s *Store) persist() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

type Request struct {
	Name        string   `json:"name"`
	Lat         *float64 `json:"lat"`
	Lon         *float64 `json:"lon"`
	City        string   `json:"city"`
	Category    string   `json:"category"`
	CuisineType string   `json:"cuisine_type"`
	PriceLevel  string   `json:"price_level"`
	Note        string   `json:"note"`
}

// ErrInvalid wraps a validation failure (caller maps it to 400 invalid_request).
type ErrInvalid struct{ Msg string }

func (e ErrInvalid) Error() string { return e.Msg }

// Add adds a user-contributed POI. userID is nil for anonymous contributions
// (the default — Postgres auth is optional, see internal/db).
func (s *Store) Add(req Request, userID *string) (*kb.POI, error) {
	if req.Name == "" || req.Lat == nil || req.Lon == nil {
		return nil, ErrInvalid{"Thiếu name hoặc lat/lon"}
	}
	// Vietnam bounding box.
	if *req.Lat < 8 || *req.Lat > 24 || *req.Lon < 102 || *req.Lon > 110 {
		return nil, ErrInvalid{"lat/lon ngoài phạm vi Việt Nam"}
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
	p := &kb.POI{
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
		Opening:      kb.Opening{OpenMin: 0, CloseMin: 1440, Overnight: false, Raw: "00:00-24:00"},
		Quality:      0.5,
		Source:       "user_contributed",
		Verified:     false,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		KnownEntities: kb.KnownEntities{
			Names:  []string{kb.Norm(req.Name)},
			Dishes: []string{},
		},
	}

	s.mu.Lock()
	s.kb.Add(p) // indexes + ensures non-nil slices + builds search set
	s.list = append(s.list, p)
	err := s.persist()
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if s.OwnerHook != nil {
		s.OwnerHook(p.ID, userID)
	}
	return p, nil
}

// AttachMenu OCRs an uploaded menu image and appends the dishes to poiID.
// Returns (dishes, wired, err): wired=false means OCRMenu isn't configured
// yet — caller renders the honest "OCR chưa nối" degrade, not an error.
func (s *Store) AttachMenu(poiID string, imgBytes []byte) (dishes []kb.Dish, wired bool, err error) {
	p := s.kb.Get(poiID)
	if p == nil {
		return nil, true, ErrInvalid{"Không tìm thấy poi_id"}
	}

	dishes, ocrErr := OCRMenu(imgBytes)
	if ocrErr != nil {
		return []kb.Dish{}, false, nil
	}

	s.mu.Lock()
	p.Dishes = append(p.Dishes, dishes...)
	p.BuildIndex()
	// Persist only if this POI is user-contributed (benchmark stays immutable).
	if p.Source == "user_contributed" {
		_ = s.persist()
	}
	s.mu.Unlock()

	return dishes, true, nil
}

// randHex returns n random bytes as a hex string (crypto/rand).
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}
