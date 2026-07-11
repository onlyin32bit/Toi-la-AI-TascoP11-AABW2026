// Package enrich powers the /v1/enrich endpoint: given a POI hint (name +
// address), it runs the Apify Google Places actor, picks the closest match,
// and maps the raw place into a UI-facing EnrichmentResult (menu items,
// hours, price range, diet tags, provenance per field).
//
// Kept transport-agnostic: internal/httpserver owns request decoding and
// HTTP status mapping. Tier 3 (Google Places via Apify, confidence 0.87)
// per resources/engine/SYSTEM_FLOW.md.
package enrich

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"tascop11/engine/internal/apify"
)

// Sentinel errors — internal/httpserver maps these to HTTP status codes.
var (
	ErrNoName  = errors.New("name is required")
	ErrNoMatch = errors.New("no matching place found on google places")
)

// ProvenanceField mirrors the UI's ProvenanceField shape (ui/src/types.ts).
// snake_case JSON keys stay consistent with the rest of the engine surface.
type ProvenanceField struct {
	Source     string  `json:"source"`
	Confidence float64 `json:"confidence"`
	FetchedAt  string  `json:"fetched_at"`
}

// Request is the /v1/enrich request body. Only Name is strictly required.
// QualityBefore is optional — when > 0 we bump it by a fixed delta so the UI
// sees a smooth count-up on the badge; when 0 we compute from field coverage.
type Request struct {
	POIID         string  `json:"poi_id"`
	Name          string  `json:"name"`
	Address       string  `json:"address,omitempty"`
	City          string  `json:"city,omitempty"`
	QualityBefore float64 `json:"quality_before,omitempty"`
}

// Result is the /v1/enrich response body. Field names match the UI's
// EnrichmentResult 1:1 — only Provenance keys deviate ("menu"/"hours"/…).
type Result struct {
	POIID         string                     `json:"poi_id"`
	QualityBefore float64                    `json:"quality_before"`
	QualityAfter  float64                    `json:"quality_after"`
	Provenance    map[string]ProvenanceField `json:"provenance"`
	MenuItems     []string                   `json:"menu_items,omitempty"`
	HoursOpen     string                     `json:"hours_open,omitempty"`
	PriceRange    string                     `json:"price_range,omitempty"`
	DietTags      []string                   `json:"diet_tags,omitempty"`
	Rating        *float64                   `json:"rating,omitempty"`
	SourceURL     string                     `json:"source_url,omitempty"`
}

// Engine orchestrates one enrichment call. Safe for concurrent use — the
// underlying *apify.Client is stateless.
type Engine struct {
	apify              *apify.Client
	upstreamTimeoutSec int
}

// NewEngine constructs an Engine or returns apify.ErrMissingToken. cmd/server
// treats that as "enrich disabled" (route degrades to 503, boot continues).
func NewEngine() (*Engine, error) {
	client, err := apify.New()
	if err != nil {
		return nil, err
	}
	return &Engine{apify: client, upstreamTimeoutSec: 90}, nil
}

// Enrich runs the Google Places actor for one POI hint and returns a mapped
// Result. Cancellation of ctx propagates to the upstream HTTP request.
func (e *Engine) Enrich(ctx context.Context, req Request) (*Result, error) {
	if strings.TrimSpace(req.Name) == "" {
		return nil, ErrNoName
	}

	searchTerm := req.Name
	if req.Address != "" {
		searchTerm = fmt.Sprintf("%s, %s", req.Name, req.Address)
	}
	locationQuery := strings.TrimSpace(req.City)
	if locationQuery == "" {
		locationQuery = "Vietnam"
	}

	items, err := e.apify.RunGooglePlaces(
		ctx,
		[]string{searchTerm},
		apify.GooglePlacesOptions{
			LocationQuery: locationQuery,
			MaxPerSearch:  3,
			MaxReviews:    5,
		},
		e.upstreamTimeoutSec,
	)
	if err != nil {
		return nil, fmt.Errorf("apify google places: %w", err)
	}
	if len(items) == 0 {
		return nil, ErrNoMatch
	}

	best := pickBestMatch(items, req.Name)
	if best == nil {
		return nil, ErrNoMatch
	}

	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	result := mapGooglePlace(best, req.POIID, fetchedAt)
	result.QualityBefore = req.QualityBefore
	result.QualityAfter = computeQualityAfter(req.QualityBefore, result)
	return result, nil
}

// pickBestMatch returns the place whose title shares the longest contiguous
// substring with queryName, or the first candidate as a last-resort fallback.
// Cheap O(n^2 * len) — the candidate list is capped at 3 by the caller.
func pickBestMatch(items apify.RunActorResult, queryName string) map[string]any {
	qn := strings.ToLower(strings.TrimSpace(queryName))
	var best map[string]any
	bestScore := 0
	for _, it := range items {
		title, _ := it["title"].(string)
		score := longestCommonSubstringLen(qn, strings.ToLower(title))
		if score > bestScore {
			bestScore = score
			best = it
		}
	}
	if best == nil && len(items) > 0 {
		return items[0]
	}
	return best
}

// computeQualityAfter maintains the UI's expected shape:
//   - When qualityBefore > 0 (caller-provided): +0.10 capped at 0.98.
//   - Otherwise: baseline 0.50 + 0.10 per populated enrichment field.
func computeQualityAfter(before float64, r *Result) float64 {
	if before > 0 {
		after := before + 0.10
		if after > 0.98 {
			after = 0.98
		}
		return after
	}
	filled := 0
	if len(r.MenuItems) > 0 {
		filled++
	}
	if r.HoursOpen != "" {
		filled++
	}
	if r.PriceRange != "" {
		filled++
	}
	if len(r.DietTags) > 0 {
		filled++
	}
	if r.Rating != nil {
		filled++
	}
	return 0.5 + 0.1*float64(filled)
}

// longestCommonSubstringLen returns the length of the longest run of
// consecutive matching characters between a and b. Naive O(len(a)*len(b))
// which is fine for the ~50-char restaurant names we compare here.
func longestCommonSubstringLen(a, b string) int {
	if a == "" || b == "" {
		return 0
	}
	m := 0
	for i := 0; i < len(a); i++ {
		for j := 0; j < len(b); j++ {
			k := 0
			for i+k < len(a) && j+k < len(b) && a[i+k] == b[j+k] {
				k++
			}
			if k > m {
				m = k
			}
		}
	}
	return m
}
