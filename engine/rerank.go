package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Positive SOFT-score weights (§7.2). luxury_penalty is subtractive.
const (
	wSemantic  = 0.30
	wGeoDecay  = 0.20
	wQuality   = 0.15
	wPersona   = 0.15
	wRatingPop = 0.10
	wLocalness = 0.10
	luxuryCoef = 0.25
)

// segmentVN renders internal segment tags for Vietnamese reasoning text.
var segmentVN = map[string]string{
	"family":   "gia đình",
	"romantic": "hẹn hò",
	"business": "tiếp khách",
	"group":    "nhóm bạn",
	"fastfood": "ăn nhanh",
	"travel":   "du lịch",
	"budget":   "tiết kiệm",
	"premium":  "cao cấp",
}

var priceVN = map[string]string{
	"budget":  "bình dân",
	"mid":     "tầm trung",
	"premium": "cao cấp",
}

// Rerank scores survivors with the SOFT model and returns sorted PlaceResults.
func Rerank(survivors []*POI, f FilterSpec, u UserCtx, limit int) []PlaceResult {
	type scored struct {
		p   *POI
		res PlaceResult
	}
	items := make([]scored, 0, len(survivors))
	for _, p := range survivors {
		items = append(items, scored{p, scorePOI(p, f, u)})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].res.Score != items[j].res.Score {
			return items[i].res.Score > items[j].res.Score
		}
		return items[i].p.RestaurantID < items[j].p.RestaurantID
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	out := make([]PlaceResult, 0, len(items))
	for _, it := range items {
		out = append(out, it.res)
	}
	return out
}

// scorePOI computes the SOFT score with availability-based weight renormalization.
func scorePOI(p *POI, f FilterSpec, u UserCtx) PlaceResult {
	// Factor availability.
	hasSemantic := len(f.Tokens) > 0 || len(f.Dish) > 0
	hasGeo := u.Lat != nil && u.Lon != nil
	hasPersona := u.Segment != "" || u.Diet != "" || u.Price != ""

	// Factor values.
	dishMatched := dishMatchAny(p, f.Dish)
	sem := 0.0
	if hasSemantic {
		if len(f.Tokens) > 0 {
			sem = float64(lexOverlap(p, f.Tokens)) / float64(len(f.Tokens))
		}
		if dishMatched {
			sem = math.Min(1.0, sem+0.5)
		}
	}

	var dist float64
	var distPtr *int
	geo := 0.0
	if hasGeo {
		dist = haversine(*u.Lat, *u.Lon, p.Lat, p.Lon)
		geo = math.Exp(-dist / 2000.0)
		d := int(math.Round(dist))
		distPtr = &d
	}

	quality := p.Quality
	persona, personaBits := personaScore(p, u)
	ratingPop := (p.Rating/5.0 + float64(p.Popularity)/100.0) / 2.0
	if ratingPop > 1 {
		ratingPop = 1
	}
	local := localness(p)
	luxury := 0.0
	if p.PriceLevel == "premium" {
		luxury = 1.0
	}

	// Renormalize available positive weights to sum 1.
	sumW := wQuality + wRatingPop + wLocalness // always available
	if hasSemantic {
		sumW += wSemantic
	}
	if hasGeo {
		sumW += wGeoDecay
	}
	if hasPersona {
		sumW += wPersona
	}
	nw := func(w float64, avail bool) float64 {
		if !avail || sumW == 0 {
			return 0
		}
		return w / sumW
	}

	final := nw(wSemantic, hasSemantic)*sem +
		nw(wGeoDecay, hasGeo)*geo +
		nw(wQuality, true)*quality +
		nw(wPersona, hasPersona)*persona +
		nw(wRatingPop, true)*ratingPop +
		nw(wLocalness, true)*local -
		luxuryCoef*luxury
	if final < 0 {
		final = 0
	}

	why := Why{
		Semantic:      round3(sem),
		GeoDecay:      round3(geo),
		Quality:       round3(quality),
		Persona:       round3(persona),
		RatingPop:     round3(ratingPop),
		Localness:     round3(local),
		LuxuryPenalty: round3(luxury),
		Final:         round3(final),
	}

	return PlaceResult{
		ID:             p.ID,
		Type:           "poi",
		Name:           p.Name,
		Label:          p.Category,
		Address:        p.Address,
		Category:       p.CuisineType,
		Coordinates:    Coordinates{Lat: p.Lat, Lon: p.Lon},
		DistanceMeters: distPtr,
		Score:          round3(final),
		Source:         p.Source,
		Tags:           buildTags(p),
		Meta: PlaceMeta{
			Why:           why,
			Reasoning:     buildReasoning(p, f, u, distPtr, personaBits),
			Quality:       p.Quality,
			MatchedDishes: matchedDishes(p, f.Dish),
			Verified:      p.Verified,
		},
	}
}

type personaBreakdown struct {
	segmentOK bool
	dietOK    bool
	priceOK   bool
}

// personaScore is the average match over the persona dimensions the user provided.
func personaScore(p *POI, u UserCtx) (float64, personaBreakdown) {
	var sum float64
	var n int
	var b personaBreakdown
	if u.Segment != "" {
		n++
		if containsStr(p.Segments, u.Segment) {
			sum++
			b.segmentOK = true
		}
	}
	if u.Diet != "" {
		n++
		if dietMatch(p, u.Diet) {
			sum++
			b.dietOK = true
		}
	}
	if u.Price != "" {
		n++
		if p.PriceLevel == u.Price {
			sum++
			b.priceOK = true
		}
	}
	if n == 0 {
		return 0, b
	}
	return sum / float64(n), b
}

// localness favours affordable, high-quality local eateries (§7.2).
func localness(p *POI) float64 {
	switch {
	case p.PriceLevel == "budget" && p.Quality >= 0.9:
		return 1.0
	case p.PriceLevel == "budget" || p.PriceLevel == "mid":
		return 0.5
	default:
		return 0.0
	}
}

func buildTags(p *POI) []string {
	tags := make([]string, 0, len(p.Segments)+len(p.Amenities))
	tags = append(tags, p.Segments...)
	tags = append(tags, p.Amenities...)
	if len(tags) == 0 {
		return []string{}
	}
	return tags
}

func matchedDishes(p *POI, dishes []string) []MatchedDish {
	out := []MatchedDish{}
	for _, want := range dishes {
		nw := norm(want)
		for _, d := range p.Dishes {
			if norm(d.Name) == nw {
				out = append(out, MatchedDish{Dish: d.Name, PriceVND: d.PriceVND})
				break
			}
		}
	}
	return out
}

// buildReasoning renders a short Vietnamese explanation (distance/persona/price/open).
func buildReasoning(p *POI, f FilterSpec, u UserCtx, distPtr *int, pb personaBreakdown) string {
	var parts []string
	if distPtr != nil {
		km := float64(*distPtr) / 1000.0
		parts = append(parts, fmt.Sprintf("cách bạn %.1fkm", km))
	}
	if pb.segmentOK {
		if v, ok := segmentVN[u.Segment]; ok {
			parts = append(parts, "phù hợp "+v)
		}
	}
	if pb.dietOK && u.Diet == "vegetarian" {
		parts = append(parts, "có món chay")
	}
	if pb.dietOK && u.Diet == "halal" {
		parts = append(parts, "phục vụ Halal")
	}
	if v, ok := priceVN[p.PriceLevel]; ok {
		parts = append(parts, "giá "+v)
	}
	if len(matchedDishes(p, f.Dish)) > 0 {
		parts = append(parts, "có "+strings.Join(f.Dish, ", "))
	}
	// Opening context.
	if p.Opening.Overnight {
		parts = append(parts, "mở cửa khuya tới "+minToHHMM(p.Opening.CloseMin))
	} else if u.TimeMin >= 0 && isOpenAt(p.Opening, u.TimeMin) {
		parts = append(parts, "còn mở tới "+minToHHMM(p.Opening.CloseMin))
	}
	return strings.Join(parts, " · ")
}

func minToHHMM(m int) string {
	m = ((m % 1440) + 1440) % 1440
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}
