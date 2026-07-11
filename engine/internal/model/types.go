// Package model holds the wire/domain types shared across the engine's
// packages (query specs, API response DTOs). It depends on nothing else in
// this module, so any package may import it without risk of a cycle.
package model

// FilterSpec is the structured constraint set produced by ParseQuery + DetectDish.
// It is consumed by the HARD gate (Recall) and the SOFT reranker (Rerank).
type FilterSpec struct {
	City      string   `json:"city"`
	Dish      []string `json:"dish"`
	Segments  []string `json:"segments"`
	Diet      []string `json:"diet"`
	Amenities []string `json:"amenities"`
	MaxPrice  int      `json:"max_price"`
	MinRating float64  `json:"min_rating"`
	OpenAfter int      `json:"open_after"` // minutes since midnight, -1 = unset
	Tokens    []string `json:"tokens"`

	// VectorScores is POI id -> cosine similarity from an optional Qdrant
	// search (internal/vectordb). Never populated when QDRANT_URL is unset;
	// omitted from the API response (internal to scoring only).
	VectorScores map[string]float64 `json:"-"`

	// DetourMin/Occupancy/Mode are optional §5.3 CTX/ranking inputs. Absent
	// (DetourMin==nil, Occupancy==nil, Mode=="") means the corresponding SOFT
	// factor has no data and is renormalized away — never defaulted/guessed.
	DetourMin *float64 `json:"-"`
	Occupancy *float64 `json:"-"` // 0..100, "% full at arrival"
	Mode      string   `json:"-"` // "repeat" | "explore" | "" (unset -> explore weights)
}

// UserCtx carries per-request personalization/localization context.
type UserCtx struct {
	Lat     *float64 // nil = unknown
	Lon     *float64 // nil = unknown
	Segment string   // family|romantic|business|group|fastfood ("" = unset)
	Diet    string   // vegetarian|halal ("" = unset)
	Price   string   // budget|mid|premium ("" = unset)
	TimeMin int      // minutes since midnight, -1 = unset

	// Behavior is an optional, authenticated-user-only §5.3 S_behavior input
	// (from a saved context's "learned" data in Postgres). Nil = no signal,
	// factor renormalizes away — the default, anonymous-user path.
	Behavior *BehaviorSignal
}

// BehaviorSignal is the subset of a saved context's "learned" data that
// feeds §5.3 S_behavior: repeat visits and cuisine affinity for this user.
type BehaviorSignal struct {
	RepeatPOIIDs    []string           `json:"repeat_pois"`
	CuisineAffinity map[string]float64 `json:"cuisine_affinity"`
}

// Why is the per-result score breakdown (§8, extended by §5.3). snake_case
// JSON keys. Fields beyond the original 7 are 0 when their factor had no
// data for this request (renormalized away, not faked).
type Why struct {
	Semantic      float64 `json:"semantic"`
	GeoDecay      float64 `json:"geo_decay"`
	Quality       float64 `json:"quality"`
	Persona       float64 `json:"persona"`
	RatingPop     float64 `json:"rating_pop"`
	Localness     float64 `json:"localness"`
	LuxuryPenalty float64 `json:"luxury_penalty"`
	Route         float64 `json:"route"`    // S_route (§5.3, needs DetourMin)
	Crowd         float64 `json:"crowd"`    // S_crowd (§5.3, needs Occupancy)
	Behavior      float64 `json:"behavior"` // S_behavior (§5.3, needs UserCtx.Behavior)
	Buzz          float64 `json:"buzz"`     // S_buzz (§5.3, needs POI.BuzzScore)
	Final         float64 `json:"final"`
}

// Coordinates is a WGS84 lat/lon pair.
type Coordinates struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// MatchedDish records a dish that satisfied a dish constraint (with its price).
type MatchedDish struct {
	Dish     string `json:"dish"`
	PriceVND int    `json:"price_vnd"`
}

// PlaceMeta is the nested meta object of a PlaceResult (§8).
type PlaceMeta struct {
	Why           Why           `json:"why"`
	Reasoning     string        `json:"reasoning"`
	Quality       float64       `json:"quality"`
	MatchedDishes []MatchedDish `json:"matched_dishes"`
	Verified      bool          `json:"verified"`
}

// PlaceResult is Tasco Maps PlaceResult-compatible (§8 checklist).
type PlaceResult struct {
	ID             string      `json:"id"`
	Type           string      `json:"type"` // always "poi"
	Name           string      `json:"name"`
	Label          string      `json:"label"` // = category
	Address        string      `json:"address"`
	Category       string      `json:"category"` // = cuisine_type
	Coordinates    Coordinates `json:"coordinates"`
	DistanceMeters *int        `json:"distanceMeters"` // nil if user location unknown
	Score          float64     `json:"score"`
	Source         string      `json:"source"`
	Tags           []string    `json:"tags"`
	Meta           PlaceMeta   `json:"meta"`
}

// RecommendMeta is the meta block of a RecommendResponse.
type RecommendMeta struct {
	Query   string `json:"query"`
	Filters any    `json:"filters"`
	Count   int    `json:"count"`
}

// RecommendResponse is the /v1/recommend success body (§8).
type RecommendResponse struct {
	Results   []PlaceResult `json:"results"`
	Meta      RecommendMeta `json:"meta"`
	RequestID string        `json:"requestId"`
}

// NotFound is the honest empty-result body (anti-hallucination, §5.3/§5.4).
type NotFound struct {
	Status      string   `json:"status"` // always "not_found"
	Reason      string   `json:"reason"`
	Suggestions []string `json:"suggestions"`
	QueryEntity string   `json:"query_entity,omitempty"`
}

// ErrorDetail / ErrorResponse follow the Tasco Maps error schema (§8).
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type ErrorResponse struct {
	Error     ErrorDetail `json:"error"`
	RequestID string      `json:"requestId"`
}

// CompareItem is one column of a side-by-side comparison (§5.8).
type CompareItem struct {
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	PriceLevel     string        `json:"price_level"`
	AvgPriceVND    int           `json:"avg_price_vnd"`
	Rating         float64       `json:"rating"`
	Quality        float64       `json:"quality"`
	Segments       []string      `json:"segments"`
	Diet           []string      `json:"diet"`
	DistanceMeters *int          `json:"distanceMeters"`
	TopDishes      []MatchedDish `json:"top_dishes"`
	Source         string        `json:"source"`
	Verified       bool          `json:"verified"`
}

// CompareResponse is the /v1/compare body (§8).
type CompareResponse struct {
	Items     []CompareItem `json:"items"`
	NotFound  []string      `json:"not_found"`
	RequestID string        `json:"requestId"`
}
