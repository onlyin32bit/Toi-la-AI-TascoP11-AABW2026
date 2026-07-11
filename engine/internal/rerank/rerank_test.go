package rerank

import (
	"math"
	"testing"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/kb/kbfixture"
	"tascop11/engine/internal/model"
)

func ptr(f float64) *float64 { return &f }

func TestScoreGeoDecayCloserWins(t *testing.T) {
	store := kbfixture.New()
	a := store.Get("RESA")                                             // Hà Nội
	b := store.Get("RESB")                                             // HCM
	u := model.UserCtx{Lat: ptr(21.03), Lon: ptr(105.85), TimeMin: -1} // near A
	f := model.FilterSpec{OpenAfter: -1}

	ra := scorePOI(a, f, u)
	rb := scorePOI(b, f, u)
	if ra.Meta.Why.GeoDecay <= rb.Meta.Why.GeoDecay {
		t.Errorf("geo_decay: near POI %.3f must exceed far POI %.3f",
			ra.Meta.Why.GeoDecay, rb.Meta.Why.GeoDecay)
	}
	if ra.DistanceMeters == nil {
		t.Errorf("distanceMeters must be set when user location is known")
	}
}

func TestScoreRenormalizeNoGeoNoQuery(t *testing.T) {
	store := kbfixture.New()
	a := store.Get("RESA")
	// No location, no query, no persona: only quality/rating_pop/localness apply.
	res := scorePOI(a, model.FilterSpec{OpenAfter: -1}, model.UserCtx{TimeMin: -1})
	if res.Meta.Why.GeoDecay != 0 {
		t.Errorf("geo_decay must be 0 when no location, got %.3f", res.Meta.Why.GeoDecay)
	}
	if res.Score <= 0 || res.Score > 1.0001 {
		t.Errorf("renormalized score out of range: %.3f", res.Score)
	}
	if res.DistanceMeters != nil {
		t.Errorf("distanceMeters must be nil when location unknown")
	}
}

func TestScoreLuxuryPenalty(t *testing.T) {
	store := kbfixture.New()
	d := store.Get("RESD") // premium
	res := scorePOI(d, model.FilterSpec{OpenAfter: -1}, model.UserCtx{TimeMin: -1})
	if res.Meta.Why.LuxuryPenalty != 1 {
		t.Errorf("premium POI must incur luxury_penalty=1, got %.3f", res.Meta.Why.LuxuryPenalty)
	}
	if res.Meta.Why.Localness != 0 {
		t.Errorf("premium POI localness must be 0, got %.3f", res.Meta.Why.Localness)
	}
}

func TestLocalness(t *testing.T) {
	budgetHi := &kb.POI{PriceLevel: "budget", Quality: 0.95}
	mid := &kb.POI{PriceLevel: "mid", Quality: 0.7}
	premium := &kb.POI{PriceLevel: "premium", Quality: 0.95}
	if localness(budgetHi) != 1.0 {
		t.Errorf("budget+quality>=0.9 localness must be 1.0")
	}
	if localness(mid) != 0.5 {
		t.Errorf("mid localness must be 0.5")
	}
	if localness(premium) != 0.0 {
		t.Errorf("premium localness must be 0.0")
	}
}

func TestPersonaScore(t *testing.T) {
	store := kbfixture.New()
	a := store.Get("RESA") // segments [family], budget
	score, b := personaScore(a, model.UserCtx{Segment: "family", Price: "budget"})
	if score != 1.0 || !b.segmentOK || !b.priceOK {
		t.Errorf("persona full match = %.2f %+v, want 1.0 both ok", score, b)
	}
	half, _ := personaScore(a, model.UserCtx{Segment: "family", Price: "premium"})
	if half != 0.5 {
		t.Errorf("persona half match = %.2f, want 0.5", half)
	}
}

func TestRerankSortedDescending(t *testing.T) {
	store := kbfixture.New()
	f := model.FilterSpec{OpenAfter: -1}
	res := Rerank(store.POIs, f, model.UserCtx{Lat: ptr(21.03), Lon: ptr(105.85), TimeMin: -1}, 12)
	if len(res) == 0 {
		t.Fatal("Rerank returned no results")
	}
	for i := 1; i < len(res); i++ {
		if res[i-1].Score < res[i].Score {
			t.Errorf("results not sorted desc at %d: %.3f < %.3f", i, res[i-1].Score, res[i].Score)
		}
	}
}

// guard against accidental float formatting regressions in round3
func TestRound3(t *testing.T) {
	if got := round3(0.123456); math.Abs(got-0.123) > 1e-9 {
		t.Errorf("round3 = %v, want 0.123", got)
	}
}

// --- §5.3 additions: vector-score blend + route/crowd/behavior/buzz ---------

func TestScorePOIBlendsVectorScore(t *testing.T) {
	store := kbfixture.New()
	p := store.Get("RESA")
	if p == nil {
		t.Fatal("fixture POI RESA not found")
	}
	u := model.UserCtx{TimeMin: -1}

	// No tokens, only a vector score -> semantic factor comes entirely from
	// the vector similarity (this is the value-add: catches queries with
	// zero lexical overlap).
	fVectorOnly := model.FilterSpec{OpenAfter: -1, VectorScores: map[string]float64{p.ID: 0.8}}
	resVectorOnly := scorePOI(p, fVectorOnly, u)
	if resVectorOnly.Meta.Why.Semantic != 0.8 {
		t.Errorf("vector-only semantic = %v, want 0.8", resVectorOnly.Meta.Why.Semantic)
	}

	// Both lexical tokens and a vector score -> averaged, not replaced.
	fBoth := model.FilterSpec{OpenAfter: -1, Tokens: []string{"pho"}, VectorScores: map[string]float64{p.ID: 0.6}}
	resBoth := scorePOI(p, fBoth, u)
	lexOnly := float64(kb.LexOverlap(p, fBoth.Tokens)) / float64(len(fBoth.Tokens))
	want := round3((lexOnly + 0.6) / 2)
	if resBoth.Meta.Why.Semantic != want {
		t.Errorf("blended semantic = %v, want %v (lex=%v, vec=0.6)", resBoth.Meta.Why.Semantic, want, lexOnly)
	}

	// No VectorScores at all -> identical to pre-vectordb behavior.
	fNone := model.FilterSpec{OpenAfter: -1, Tokens: []string{"pho"}}
	resNone := scorePOI(p, fNone, u)
	if resNone.Meta.Why.Semantic != round3(lexOnly) {
		t.Errorf("no-vector semantic = %v, want %v (unchanged lexical-only)", resNone.Meta.Why.Semantic, round3(lexOnly))
	}
}

func TestScorePOIRouteCrowdBehaviorBuzzAbsentByDefault(t *testing.T) {
	store := kbfixture.New()
	p := store.Get("RESA")
	res := scorePOI(p, model.FilterSpec{OpenAfter: -1}, model.UserCtx{TimeMin: -1})
	if res.Meta.Why.Route != 0 || res.Meta.Why.Crowd != 0 || res.Meta.Why.Behavior != 0 || res.Meta.Why.Buzz != 0 {
		t.Errorf("§5.3 factors must be 0 when their data is absent, got %+v", res.Meta.Why)
	}
}

func TestScorePOIRouteAndBehaviorWhenPresent(t *testing.T) {
	store := kbfixture.New()
	p := store.Get("RESA")

	detour := 0.0 // 0 min detour -> exp(0) = 1.0
	f := model.FilterSpec{OpenAfter: -1, DetourMin: &detour}
	res := scorePOI(p, f, model.UserCtx{TimeMin: -1})
	if res.Meta.Why.Route != 1.0 {
		t.Errorf("route with 0-min detour = %v, want 1.0", res.Meta.Why.Route)
	}

	u := model.UserCtx{TimeMin: -1, Behavior: &model.BehaviorSignal{RepeatPOIIDs: []string{p.ID}}}
	res2 := scorePOI(p, model.FilterSpec{OpenAfter: -1}, u)
	if res2.Meta.Why.Behavior != 1.0 {
		t.Errorf("behavior for a repeat POI = %v, want 1.0", res2.Meta.Why.Behavior)
	}
}
