// Package rerank implements the SOFT score (§7.2, upgraded per
// SYSTEM_FLOW.md §5.3): a weighted sum over factors that are individually
// optional. Any factor without data for a given request is dropped and the
// remaining weights renormalized to sum to 1 — never zero-filled, never
// guessed. This is what lets the same formula serve both the hackathon
// (mostly anonymous, no route/crowd/behavior/buzz data) and a future
// production deployment (all of it populated) without a code branch.
package rerank

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/model"
)

// Positive SOFT-score weights. luxury_penalty is subtractive. Route/Crowd/
// Behavior/Buzz are §5.3 additions layered onto the original 6; they only
// enter sumW (and thus the final score) when their data is present, so
// existing anonymous/no-context requests score exactly as before.
const (
	wSemantic  = 0.30
	wGeoDecay  = 0.20
	wQuality   = 0.15
	wPersona   = 0.15
	wRatingPop = 0.10
	wLocalness = 0.10
	wRoute     = 0.15 // S_route (§5.3) — needs FilterSpec.DetourMin
	wCrowd     = 0.05 // S_crowd (§5.3) — needs FilterSpec.Occupancy
	wBehavior  = 0.15 // S_behavior (§5.3) — needs UserCtx.Behavior
	wBuzz      = 0.05 // S_buzz (§5.3) — needs POI.BuzzScore
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
func Rerank(survivors []*kb.POI, f model.FilterSpec, u model.UserCtx, limit int) []model.PlaceResult {
	type scored struct {
		p   *kb.POI
		res model.PlaceResult
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
	out := make([]model.PlaceResult, 0, len(items))
	for _, it := range items {
		out = append(out, it.res)
	}
	return out
}

// scorePOI computes the SOFT score with availability-based weight renormalization.
func scorePOI(p *kb.POI, f model.FilterSpec, u model.UserCtx) model.PlaceResult {
	// Factor availability.
	hasSemantic := len(f.Tokens) > 0 || len(f.Dish) > 0 || len(f.VectorScores) > 0
	hasGeo := u.Lat != nil && u.Lon != nil
	hasPersona := u.Segment != "" || u.Diet != "" || u.Price != ""
	hasRoute := f.DetourMin != nil
	hasCrowd := f.Occupancy != nil
	hasBehavior := u.Behavior != nil && (len(u.Behavior.RepeatPOIIDs) > 0 || len(u.Behavior.CuisineAffinity) > 0)
	hasBuzz := p.BuzzScore != nil

	// Factor values.
	dishMatched := kb.DishMatchAny(p, f.Dish)
	sem := 0.0
	if hasSemantic {
		lexSem := 0.0
		if len(f.Tokens) > 0 {
			lexSem = float64(kb.LexOverlap(p, f.Tokens)) / float64(len(f.Tokens))
		}
		sem = lexSem
		// Optional Qdrant layer (internal/vectordb): catches paraphrases/
		// synonyms lexical overlap misses. Blended, not replacing, so a
		// down/disabled vector DB never changes lexical-only behavior.
		if vs, ok := f.VectorScores[p.ID]; ok {
			if lexSem == 0 {
				sem = vs
			} else {
				sem = (lexSem + vs) / 2
			}
		}
		if dishMatched {
			sem = math.Min(1.0, sem+0.5)
		}
	}

	var dist float64
	var distPtr *int
	geo := 0.0
	if hasGeo {
		dist = kb.Haversine(*u.Lat, *u.Lon, p.Lat, p.Lon)
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

	// §5.3 additions — each 0 unless its data is present (hasX above).
	route := 0.0
	if hasRoute {
		route = math.Exp(-*f.DetourMin / 5.0)
	}
	crowd := 0.0
	if hasCrowd {
		crowd = 1 - *f.Occupancy/100.0
		if crowd < 0 {
			crowd = 0
		}
	}
	behavior := 0.0
	if hasBehavior {
		if kb.ContainsStr(u.Behavior.RepeatPOIIDs, p.ID) {
			behavior = 1.0
		}
		if aff, ok := u.Behavior.CuisineAffinity[p.CuisineType]; ok && aff > behavior {
			behavior = aff
		}
		if behavior > 1 {
			behavior = 1
		}
	}
	buzz := 0.0
	if hasBuzz {
		buzz = *p.BuzzScore
		if buzz > 1 {
			buzz = 1
		} else if buzz < 0 {
			buzz = 0
		}
	}

	// Mode switch (§5.3): repeat trips weight behavior over discovery;
	// explore trips weight semantic + buzz over behavior. Mode unset (the
	// common case — no trip-repeat signal available) keeps the base weights.
	modeSemantic, modeBehavior, modeBuzz := wSemantic, wBehavior, wBuzz
	switch f.Mode {
	case "repeat":
		modeSemantic, modeBehavior, modeBuzz = 0.25, 0.25, 0.00
	case "explore":
		modeSemantic, modeBehavior, modeBuzz = 0.35, 0.05, 0.10
	}

	// Renormalize available positive weights to sum 1.
	sumW := wQuality + wRatingPop + wLocalness // always available
	if hasSemantic {
		sumW += modeSemantic
	}
	if hasGeo {
		sumW += wGeoDecay
	}
	if hasPersona {
		sumW += wPersona
	}
	if hasRoute {
		sumW += wRoute
	}
	if hasCrowd {
		sumW += wCrowd
	}
	if hasBehavior {
		sumW += modeBehavior
	}
	if hasBuzz {
		sumW += modeBuzz
	}
	nw := func(w float64, avail bool) float64 {
		if !avail || sumW == 0 {
			return 0
		}
		return w / sumW
	}

	final := nw(modeSemantic, hasSemantic)*sem +
		nw(wGeoDecay, hasGeo)*geo +
		nw(wQuality, true)*quality +
		nw(wPersona, hasPersona)*persona +
		nw(wRatingPop, true)*ratingPop +
		nw(wLocalness, true)*local +
		nw(wRoute, hasRoute)*route +
		nw(wCrowd, hasCrowd)*crowd +
		nw(modeBehavior, hasBehavior)*behavior +
		nw(modeBuzz, hasBuzz)*buzz -
		luxuryCoef*luxury
	if final < 0 {
		final = 0
	}

	why := model.Why{
		Semantic:      round3(sem),
		GeoDecay:      round3(geo),
		Quality:       round3(quality),
		Persona:       round3(persona),
		RatingPop:     round3(ratingPop),
		Localness:     round3(local),
		LuxuryPenalty: round3(luxury),
		Route:         round3(route),
		Crowd:         round3(crowd),
		Behavior:      round3(behavior),
		Buzz:          round3(buzz),
		Final:         round3(final),
	}

	return model.PlaceResult{
		ID:             p.ID,
		Type:           "poi",
		Name:           p.Name,
		Label:          p.Category,
		Address:        p.Address,
		Category:       p.CuisineType,
		Coordinates:    model.Coordinates{Lat: p.Lat, Lon: p.Lon},
		DistanceMeters: distPtr,
		Score:          round3(final),
		Source:         p.Source,
		Tags:           buildTags(p),
		Meta: model.PlaceMeta{
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
func personaScore(p *kb.POI, u model.UserCtx) (float64, personaBreakdown) {
	var sum float64
	var n int
	var b personaBreakdown
	if u.Segment != "" {
		n++
		if kb.ContainsStr(p.Segments, u.Segment) {
			sum++
			b.segmentOK = true
		}
	}
	if u.Diet != "" {
		n++
		if kb.DietMatch(p, u.Diet) {
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
func localness(p *kb.POI) float64 {
	switch {
	case p.PriceLevel == "budget" && p.Quality >= 0.9:
		return 1.0
	case p.PriceLevel == "budget" || p.PriceLevel == "mid":
		return 0.5
	default:
		return 0.0
	}
}

func buildTags(p *kb.POI) []string {
	tags := make([]string, 0, len(p.Segments)+len(p.Amenities))
	tags = append(tags, p.Segments...)
	tags = append(tags, p.Amenities...)
	if len(tags) == 0 {
		return []string{}
	}
	return tags
}

func matchedDishes(p *kb.POI, dishes []string) []model.MatchedDish {
	out := []model.MatchedDish{}
	for _, want := range dishes {
		nw := kb.Norm(want)
		for _, d := range p.Dishes {
			if kb.Norm(d.Name) == nw {
				out = append(out, model.MatchedDish{Dish: d.Name, PriceVND: d.PriceVND})
				break
			}
		}
	}
	return out
}

// buildReasoning renders a short Vietnamese explanation (distance/persona/price/open).
func buildReasoning(p *kb.POI, f model.FilterSpec, u model.UserCtx, distPtr *int, pb personaBreakdown) string {
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
	} else if u.TimeMin >= 0 && kb.IsOpenAt(p.Opening, u.TimeMin) {
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
