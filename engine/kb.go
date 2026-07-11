package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// --- POI schema (mirrors preprocess/build_kb.py build_poi() exactly) ---

type Opening struct {
	OpenMin   int    `json:"open_min"`
	CloseMin  int    `json:"close_min"`
	Overnight bool   `json:"overnight"`
	Raw       string `json:"raw"`
}

type Dish struct {
	Name     string   `json:"name"`
	PriceVND int      `json:"price_vnd"`
	Tags     []string `json:"tags"`
}

type Review struct {
	Text      string   `json:"text"`
	Sentiment string   `json:"sentiment"`
	Aspects   []string `json:"aspects"`
}

type KnownEntities struct {
	Names  []string `json:"names"`
	Dishes []string `json:"dishes"`
}

// POI is one restaurant record. Sentiment is passed through opaque (DEV3 owns
// its shape). Non-JSON fields (search, nameNorm) are built at load time.
type POI struct {
	ID                    string          `json:"id"`
	RestaurantID          string          `json:"restaurant_id"`
	Name                  string          `json:"name"`
	Category              string          `json:"category"`
	CuisineType           string          `json:"cuisine_type"`
	City                  string          `json:"city"`
	District              string          `json:"district"`
	Address               string          `json:"address"`
	Lat                   float64         `json:"lat"`
	Lon                   float64         `json:"lon"`
	PriceLevel            string          `json:"price_level"`
	AvgPriceVND           int             `json:"avg_price_vnd"`
	Rating                float64         `json:"rating"`
	ReviewCount           int             `json:"review_count"`
	Popularity            int             `json:"popularity"`
	Opening               Opening         `json:"opening"`
	Segments              []string        `json:"segments"`
	Amenities             []string        `json:"amenities"`
	Diet                  []string        `json:"diet"`
	Dishes                []Dish          `json:"dishes"`
	Strengths             []string        `json:"strengths"`
	Weaknesses            []string        `json:"weaknesses"`
	Quality               float64         `json:"quality"`
	QualityCompleteness   float64         `json:"quality_completeness"`
	AISummary             *string         `json:"ai_summary"`
	Sentiment             json.RawMessage `json:"sentiment"` // opaque pass-through (DEV3)
	CuisineClassification *string         `json:"cuisine_classification"`
	DiningOccasions       []string        `json:"dining_occasions"`
	Tokens                []string        `json:"tokens"`
	KnownEntities         KnownEntities   `json:"known_entities"`
	RawOCRText            *string         `json:"raw_ocr_text"`
	Reviews               []Review        `json:"reviews"`

	// Provenance — benchmark POIs => tasco_csv/true; UGC => user_contributed/false.
	Source    string `json:"source,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`

	// Unexported, built at load time (not serialized).
	search   map[string]struct{}
	nameNorm string
}

// KB is the in-memory knowledge base.
type KB struct {
	POIs      []*POI
	byID      map[string]*POI
	dishVocab map[string]struct{} // global normalized dish phrases (DetectDish)
}

// LoadKB reads <buildDir>/kb.json and, when includeUGC, appends
// <buildDir>/contributions.json (if present). It tags provenance, builds the
// per-POI search set + normalized name, and indexes by both restaurant_id and id.
func LoadKB(buildDir string, includeUGC bool) (*KB, error) {
	path := filepath.Join(buildDir, "kb.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read kb.json: %w", err)
	}
	var pois []*POI
	if err := json.Unmarshal(data, &pois); err != nil {
		return nil, fmt.Errorf("parse kb.json: %w", err)
	}
	for _, p := range pois {
		p.Source = "tasco_csv"
		p.Verified = true
	}

	if includeUGC {
		ugcPath := filepath.Join(buildDir, "contributions.json")
		if raw, err := os.ReadFile(ugcPath); err == nil {
			var extra []*POI
			if json.Unmarshal(raw, &extra) == nil {
				for _, p := range extra {
					p.Source = "user_contributed"
					p.Verified = false
					pois = append(pois, p)
				}
			}
		}
	}

	kb := &KB{
		byID:      make(map[string]*POI, len(pois)*2),
		dishVocab: map[string]struct{}{},
	}
	for _, p := range pois {
		kb.Add(p)
	}
	return kb, nil
}

// Add indexes a POI, building its search set / normalized name and dish vocab.
func (kb *KB) Add(p *POI) {
	ensureSlices(p)
	p.buildIndex()
	kb.POIs = append(kb.POIs, p)
	if p.RestaurantID != "" {
		kb.byID[p.RestaurantID] = p
	}
	if p.ID != "" {
		kb.byID[p.ID] = p
	}
	for _, d := range p.KnownEntities.Dishes {
		if d != "" {
			kb.dishVocab[norm(d)] = struct{}{}
		}
	}
}

// Get resolves a POI by restaurant_id or id (case-insensitive fallback).
func (kb *KB) Get(id string) *POI {
	if p, ok := kb.byID[id]; ok {
		return p
	}
	if p, ok := kb.byID[strings.ToUpper(id)]; ok {
		return p
	}
	if p, ok := kb.byID[strings.ToLower(id)]; ok {
		return p
	}
	return nil
}

func (p *POI) buildIndex() {
	p.nameNorm = norm(p.Name)
	set := make(map[string]struct{})
	add := func(toks []string) {
		for _, t := range toks {
			if t != "" {
				set[t] = struct{}{}
			}
		}
	}
	add(p.Tokens)
	add(tokenize(p.Name))
	add(tokenize(p.CuisineType))
	add(tokenize(p.Category))
	add(tokenize(p.City))
	add(tokenize(p.District))
	for _, d := range p.Dishes {
		add(tokenize(d.Name))
	}
	for _, r := range p.Reviews {
		for _, a := range r.Aspects {
			add(tokenize(a))
		}
	}
	p.search = set
}

// dishSet returns the POI's normalized dish phrases (from known_entities + menu).
func (p *POI) dishSet() map[string]struct{} {
	s := make(map[string]struct{})
	for _, d := range p.KnownEntities.Dishes {
		s[norm(d)] = struct{}{}
	}
	for _, d := range p.Dishes {
		s[norm(d.Name)] = struct{}{}
	}
	return s
}

// ensureSlices replaces nil slices with empty ones so JSON emits [] not null.
func ensureSlices(p *POI) {
	if p.Segments == nil {
		p.Segments = []string{}
	}
	if p.Amenities == nil {
		p.Amenities = []string{}
	}
	if p.Diet == nil {
		p.Diet = []string{}
	}
	if p.Dishes == nil {
		p.Dishes = []Dish{}
	}
	if p.Strengths == nil {
		p.Strengths = []string{}
	}
	if p.Weaknesses == nil {
		p.Weaknesses = []string{}
	}
	if p.DiningOccasions == nil {
		p.DiningOccasions = []string{}
	}
	if p.Tokens == nil {
		p.Tokens = []string{}
	}
	if p.Reviews == nil {
		p.Reviews = []Review{}
	}
	if p.KnownEntities.Names == nil {
		p.KnownEntities.Names = []string{}
	}
	if p.KnownEntities.Dishes == nil {
		p.KnownEntities.Dishes = []string{}
	}
}

// --- Vietnamese text normalization (must match preprocess/taxonomy.norm) ---

// diacriticMap lowercases + strips every Vietnamese diacritic to ASCII.
var diacriticMap = map[rune]rune{
	'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
	'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
	'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
	'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
	'ê': 'e', 'ề': 'e', 'ế': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
	'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
	'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
	'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
	'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
	'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
	'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
	'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
	'đ': 'd',
}

// norm lowercases, strips Vietnamese diacritics, and trims. Mirrors taxonomy.norm.
func norm(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if m, ok := diacriticMap[r]; ok {
			b.WriteRune(m)
		} else {
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

// tokenize normalizes, replaces every non [a-z0-9\s] rune with space, splits.
func tokenize(s string) []string {
	n := norm(s)
	var b strings.Builder
	b.Grow(len(n))
	for _, r := range n {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == ' ' {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.Fields(b.String())
}

// isOpenAt reports whether opening o covers the given minute-of-day. Overnight
// spans (close_min <= open_min, e.g. 10:00-02:00) are handled. minute < 0 = unset.
func isOpenAt(o Opening, minute int) bool {
	if minute < 0 {
		return true
	}
	if o.Overnight {
		return minute >= o.OpenMin || minute < o.CloseMin
	}
	return minute >= o.OpenMin && minute < o.CloseMin
}

// haversine returns the great-circle distance in meters between two coordinates.
func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000.0 // earth radius, meters
	rad := math.Pi / 180.0
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return r * c
}
