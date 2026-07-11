// Response DTOs for resources/data/tasco_maps_hackathon_api_documentation.md's
// map-service surface: /v1/search, /v1/autocomplete, /v1/poi/{id},
// /v1/reverse-geocoding, /v1/nearby-search, /v1/geocoding, /v1/route. These
// are envelope shapes distinct from the restaurant-domain RecommendResponse/
// PlaceResult (types.go) — PlaceResult itself is already field-compatible
// with the doc's PlaceResult (id/type/name/label/address/category/
// coordinates/distanceMeters/score/source/tags), so it's reused directly
// here rather than duplicated.
package model

// SearchMeta / SearchResponse — GET /v1/search.
type SearchMeta struct {
	Limit int    `json:"limit"`
	Lang  string `json:"lang"`
}

type SearchResponse struct {
	Query   string        `json:"query"`
	Results []PlaceResult `json:"results"`
	Meta    SearchMeta    `json:"meta"`
}

// AutocompleteMeta / AutocompleteResponse — GET /v1/autocomplete.
type AutocompleteMeta struct {
	Limit     int    `json:"limit"`
	SessionID string `json:"sessionId,omitempty"`
}

type AutocompleteResponse struct {
	Query       string           `json:"query"`
	Suggestions []PlaceResult    `json:"suggestions"`
	Meta        AutocompleteMeta `json:"meta"`
}

// POIDetail / POIDetailResponse — GET /v1/poi/{id}. A leaner, doc-shaped
// subset of the full kb.POI record (which the existing GET /v1/poi?id=...
// route still returns unabridged for internal/richer use).
type POIDetail struct {
	ID           string      `json:"id"`
	Type         string      `json:"type"`
	Name         string      `json:"name"`
	Label        string      `json:"label"`
	Address      string      `json:"address"`
	Category     string      `json:"category"`
	Coordinates  Coordinates `json:"coordinates"`
	Rating       float64     `json:"rating,omitempty"`
	OpeningHours string      `json:"openingHours,omitempty"`
	AISummary    string      `json:"aiSummary,omitempty"`
	Source       string      `json:"source"`
}

type POIDetailResponse struct {
	POI POIDetail `json:"poi"`
}

// ReverseGeocodingResponse — GET /v1/reverse-geocoding.
type ReverseGeocodingResponse struct {
	Results []PlaceResult `json:"results"`
}

// NearbySearchMeta / NearbySearchResponse — GET /v1/nearby-search.
type NearbySearchMeta struct {
	RadiusMeters float64 `json:"radiusMeters"`
	Limit        int     `json:"limit"`
}

type NearbySearchResponse struct {
	Center  Coordinates      `json:"center"`
	Results []PlaceResult    `json:"results"`
	Meta    NearbySearchMeta `json:"meta"`
}

// GeocodingResponse — GET /v1/geocoding.
type GeocodingResponse struct {
	Query   string        `json:"query"`
	Results []PlaceResult `json:"results"`
}

// Route DTOs — POST /v1/route. RouteRequest mirrors the doc's request body
// exactly; the response is an honest straight-line/haversine approximation
// (no road-network routing engine backs this API — see
// internal/httpserver/mapsapi.go's handleRoute doc comment), never fabricated
// turn-by-turn maneuvers.
type RouteLocation struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type RouteRequest struct {
	Locations     []RouteLocation `json:"locations"`
	Mode          string          `json:"mode"`
	Alternates    int             `json:"alternates"`
	Language      string          `json:"language"`
	Units         string          `json:"units"`
	AvoidTolls    bool            `json:"avoidTolls"`
	AvoidHighways bool            `json:"avoidHighways"`
}

type RouteSummary struct {
	DistanceMeters  float64 `json:"distanceMeters"`
	DurationSeconds float64 `json:"durationSeconds"`
}

// RouteGeometry.Coordinates is GeoJSON LineString order: [lon, lat] pairs.
type RouteGeometry struct {
	Type        string       `json:"type"`
	Coordinates [][2]float64 `json:"coordinates"`
}

type Maneuver struct {
	Instruction     string   `json:"instruction"`
	DistanceMeters  float64  `json:"distanceMeters"`
	DurationSeconds float64  `json:"durationSeconds"`
	BeginShapeIndex int      `json:"beginShapeIndex"`
	EndShapeIndex   int      `json:"endShapeIndex"`
	StreetNames     []string `json:"streetNames"`
}

type Route struct {
	RouteID     string        `json:"routeId"`
	SourceIndex int           `json:"sourceIndex"`
	Summary     RouteSummary  `json:"summary"`
	Geometry    RouteGeometry `json:"geometry"`
	Maneuvers   []Maneuver    `json:"maneuvers"`
	// Approximate flags this as a straight-line estimate, not a doc-required
	// field — additive, JSON-safe for any client parsing the standard shape.
	Approximate bool `json:"approximate"`
}

type RouteMeta struct {
	Mode       string `json:"mode"`
	Alternates int    `json:"alternates"`
}

type RouteResponse struct {
	Routes []Route   `json:"routes"`
	Meta   RouteMeta `json:"meta"`
}
