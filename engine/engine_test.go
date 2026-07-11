package main

import (
	"math"
	"testing"
)

// --- test fixtures ---------------------------------------------------------

// testKB builds an in-memory KB (no kb.json needed) so tests are hermetic.
func testKB() *KB {
	kb := &KB{byID: map[string]*POI{}, dishVocab: map[string]struct{}{}}

	// A: Phở Bếp Nhà — Hà Nội, budget, normal hours 09:00-23:00.
	kb.Add(&POI{
		ID: "poi:resa", RestaurantID: "RESA", Name: "Phở Bếp Nhà",
		Category: "Nhà hàng", CuisineType: "Việt Nam", City: "Hà Nội",
		Lat: 21.040388, Lon: 105.844615, PriceLevel: "budget", AvgPriceVND: 68289,
		Rating: 3.8, Popularity: 55, Quality: 0.88,
		Opening:  Opening{OpenMin: 540, CloseMin: 1380, Overnight: false, Raw: "09:00-23:00"},
		Segments: []string{"family"},
		Dishes:   []Dish{{Name: "Phở bò tái", PriceVND: 68289}},
		KnownEntities: KnownEntities{Names: []string{"pho bep nha"}, Dishes: []string{"pho bo tai"}},
	})

	// B: Bún Chả Phố Cổ — HCM, budget, overnight 10:00-02:00, rating 4.8.
	kb.Add(&POI{
		ID: "poi:resb", RestaurantID: "RESB", Name: "Bún Chả Phố Cổ",
		Category: "Nhà hàng", CuisineType: "Việt Nam", City: "TP. Hồ Chí Minh",
		Lat: 10.763578, Lon: 106.709041, PriceLevel: "budget", AvgPriceVND: 99797,
		Rating: 4.8, Popularity: 46, Quality: 0.97,
		Opening:  Opening{OpenMin: 600, CloseMin: 120, Overnight: true, Raw: "10:00-02:00"},
		Segments: []string{"family", "fastfood"},
		Dishes:   []Dish{{Name: "Bún chả", PriceVND: 99797}},
		KnownEntities: KnownEntities{Names: []string{"bun cha pho co"}, Dishes: []string{"bun cha"}},
	})

	// C: Mộc Vegan Bistro — Hạ Long, vegetarian, daytime 06:00-14:00.
	kb.Add(&POI{
		ID: "poi:resc", RestaurantID: "RESC", Name: "Mộc Vegan Bistro",
		Category: "Nhà hàng chay", CuisineType: "Chay", City: "Hạ Long",
		Lat: 20.97621, Lon: 107.085937, PriceLevel: "budget", AvgPriceVND: 65014,
		Rating: 4.3, Popularity: 95, Quality: 0.90, Diet: []string{"vegetarian"},
		Opening:  Opening{OpenMin: 360, CloseMin: 840, Overnight: false, Raw: "06:00-14:00"},
		Segments: []string{"family"},
		Dishes:   []Dish{{Name: "Đậu hũ sốt nấm", PriceVND: 65014, Tags: []string{"vegetarian"}}},
		KnownEntities: KnownEntities{Names: []string{"moc vegan bistro"}, Dishes: []string{"dau hu sot nam"}},
	})

	// D: premium place — Hà Nội, to exercise the luxury penalty.
	kb.Add(&POI{
		ID: "poi:resd", RestaurantID: "RESD", Name: "Nhà Hàng Hoàng Gia",
		Category: "Nhà hàng", CuisineType: "Âu", City: "Hà Nội",
		Lat: 21.05, Lon: 105.85, PriceLevel: "premium", AvgPriceVND: 850000,
		Rating: 4.6, Popularity: 40, Quality: 0.86,
		Opening:  Opening{OpenMin: 660, CloseMin: 1410, Overnight: false, Raw: "11:00-23:30"},
		Segments: []string{"business", "romantic"},
		Dishes:   []Dish{{Name: "Bít tết bò Wagyu", PriceVND: 850000}},
		KnownEntities: KnownEntities{Names: []string{"nha hang hoang gia"}, Dishes: []string{"bit tet bo wagyu"}},
	})

	// Mirror LoadKB: benchmark POIs carry tasco_csv provenance (health counts by source).
	for _, p := range kb.POIs {
		p.Source = "tasco_csv"
		p.Verified = true
	}
	return kb
}

func ptr(f float64) *float64 { return &f }

func contains(sl []string, s string) bool {
	for _, x := range sl {
		if x == s {
			return true
		}
	}
	return false
}

// --- norm / tokenize -------------------------------------------------------

func TestNorm(t *testing.T) {
	cases := map[string]string{
		"Phở Bò Tái": "pho bo tai",
		"Đà Nẵng":    "da nang",
		"BÚN CHẢ":    "bun cha",
		"  Huế  ":    "hue",
	}
	for in, want := range cases {
		if got := norm(in); got != want {
			t.Errorf("norm(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTokenize(t *testing.T) {
	got := tokenize("Bún chả, Phở!")
	want := []string{"bun", "cha", "pho"}
	if len(got) != len(want) {
		t.Fatalf("tokenize len = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("tokenize[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// --- isOpenAt --------------------------------------------------------------

func TestIsOpenAt(t *testing.T) {
	normal := Opening{OpenMin: 540, CloseMin: 1380} // 09:00-23:00
	over := Opening{OpenMin: 600, CloseMin: 120, Overnight: true} // 10:00-02:00

	tests := []struct {
		name string
		o    Opening
		min  int
		want bool
	}{
		{"normal open midday", normal, 720, true},
		{"normal before open", normal, 500, false},
		{"normal after close", normal, 1400, false},
		{"overnight late", over, 1300, true},
		{"overnight past midnight", over, 60, true},
		{"overnight closed afternoon", over, 300, false},
		{"unset minute", normal, -1, true},
	}
	for _, tc := range tests {
		if got := isOpenAt(tc.o, tc.min); got != tc.want {
			t.Errorf("%s: isOpenAt = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// --- haversine -------------------------------------------------------------

func TestHaversine(t *testing.T) {
	// Hà Nội -> TP.HCM is ~1150 km.
	d := haversine(21.0245, 105.8412, 10.7769, 106.7009)
	if d < 1_050_000 || d > 1_250_000 {
		t.Errorf("haversine HN-HCM = %.0f m, expected ~1.15e6", d)
	}
	if haversine(21.0, 105.0, 21.0, 105.0) != 0 {
		t.Errorf("haversine of identical points must be 0")
	}
}

// --- ParseQuery ------------------------------------------------------------

func TestParseQueryCityDietPrice(t *testing.T) {
	f := ParseQuery("quán chay ở Hà Nội dưới 100k")
	if f.City != "Hà Nội" {
		t.Errorf("City = %q, want Hà Nội", f.City)
	}
	if !contains(f.Diet, "vegetarian") {
		t.Errorf("Diet = %v, want vegetarian", f.Diet)
	}
	if f.MaxPrice != 100000 {
		t.Errorf("MaxPrice = %d, want 100000", f.MaxPrice)
	}
}

func TestParseQueryPriceDotted(t *testing.T) {
	if f := ParseQuery("bún chả dưới 100.000"); f.MaxPrice != 100000 {
		t.Errorf("MaxPrice(100.000) = %d, want 100000", f.MaxPrice)
	}
	if f := ParseQuery("cơm dưới 2 trieu"); f.MaxPrice != 2000000 {
		t.Errorf("MaxPrice(2 trieu) = %d, want 2000000", f.MaxPrice)
	}
}

func TestParseQueryRatingAndHours(t *testing.T) {
	if f := ParseQuery("quán từ 4.5 sao trở lên"); f.MinRating != 4.5 {
		t.Errorf("MinRating = %v, want 4.5", f.MinRating)
	}
	if f := ParseQuery("ăn gì đó sau 23:00"); f.OpenAfter != 1380 {
		t.Errorf("OpenAfter(sau 23:00) = %d, want 1380", f.OpenAfter)
	}
	if f := ParseQuery("tìm chỗ ăn khuya"); f.OpenAfter != 1320 {
		t.Errorf("OpenAfter(ăn khuya) = %d, want 1320", f.OpenAfter)
	}
}

func TestParseQueryIntentHints(t *testing.T) {
	f := ParseQuery("quán gia đình có chỗ đậu ô tô")
	if !contains(f.Segments, "family") {
		t.Errorf("Segments = %v, want family", f.Segments)
	}
	if !contains(f.Amenities, "parking") {
		t.Errorf("Amenities = %v, want parking", f.Amenities)
	}
}

// --- DetectDish ------------------------------------------------------------

func TestDetectDish(t *testing.T) {
	kb := testKB()
	got := DetectDish(kb, "cho tôi bún chả ở HCM")
	if !contains(got, "bun cha") {
		t.Errorf("DetectDish = %v, want to contain 'bun cha'", got)
	}
	// Sub-tokens of a matched phrase must be dropped.
	if contains(got, "bun") || contains(got, "cha") {
		t.Errorf("DetectDish = %v, sub-tokens of 'bun cha' must be dropped", got)
	}
	// A dish not in the vocab yields nothing.
	if d := DetectDish(kb, "cho tôi sushi"); len(d) != 0 {
		t.Errorf("DetectDish(sushi) = %v, want empty", d)
	}
}

// --- NamedEntities (anti-hallucination) ------------------------------------

func TestNamedEntitiesCrystalBBQTrap(t *testing.T) {
	kb := testKB()
	_, missing := NamedEntities(kb, "Crystal BBQ có món gì ngon")
	if !contains(missing, "Crystal BBQ") {
		t.Errorf("missing = %v, want to flag 'Crystal BBQ'", missing)
	}
}

func TestNamedEntitiesKnownRestaurant(t *testing.T) {
	kb := testKB()
	found, missing := NamedEntities(kb, "Phở Bếp Nhà có gì")
	if len(missing) != 0 {
		t.Errorf("missing = %v, want empty for a known restaurant", missing)
	}
	if len(found) == 0 {
		t.Errorf("found = empty, want to match Phở Bếp Nhà")
	}
}

func TestNamedEntitiesNoFalsePositiveOnCity(t *testing.T) {
	kb := testKB()
	// "Hà Nội" is a city, must not be flagged as an unknown restaurant.
	_, missing := NamedEntities(kb, "tìm quán ăn ở Hà Nội")
	if len(missing) != 0 {
		t.Errorf("missing = %v, want empty (city must not false-positive)", missing)
	}
}

// --- HARD gate / Recall ----------------------------------------------------

func TestRecallCityFilter(t *testing.T) {
	kb := testKB()
	f := ParseQuery("quán ăn ở HCM")
	survivors, nf := Recall(kb, f, "quán ăn ở HCM")
	if nf != nil {
		t.Fatalf("unexpected not_found: %+v", nf)
	}
	for _, p := range survivors {
		if p.City != "TP. Hồ Chí Minh" {
			t.Errorf("survivor %s in wrong city %q", p.Name, p.City)
		}
	}
}

func TestRecallDishHardConstraint(t *testing.T) {
	kb := testKB()
	f := FilterSpec{OpenAfter: -1, Dish: []string{"bun cha"}}
	survivors, nf := recallPool(kb.POIs, f)
	if nf != nil {
		t.Fatalf("unexpected not_found: %+v", nf)
	}
	if len(survivors) != 1 || survivors[0].RestaurantID != "RESB" {
		t.Errorf("dish gate = %v, want only RESB", survivors)
	}
}

func TestRecallHalalHCMNotFound(t *testing.T) {
	kb := testKB()
	f := FilterSpec{OpenAfter: -1, City: "TP. Hồ Chí Minh", Diet: []string{"halal"}}
	survivors, nf := recallPool(kb.POIs, f)
	if survivors != nil || nf == nil {
		t.Fatalf("want not_found, got survivors=%v nf=%v", survivors, nf)
	}
	if nf.Reason == "" || len(nf.Suggestions) == 0 {
		t.Errorf("Halal-HCM not_found must carry a reason + suggestions, got %+v", nf)
	}
}

func TestRecallDietVegetarian(t *testing.T) {
	kb := testKB()
	f := FilterSpec{OpenAfter: -1, Diet: []string{"vegetarian"}}
	survivors, _ := recallPool(kb.POIs, f)
	for _, p := range survivors {
		if !dietMatch(p, "vegetarian") {
			t.Errorf("survivor %s does not satisfy vegetarian", p.Name)
		}
	}
	if len(survivors) == 0 {
		t.Errorf("expected at least the vegetarian POI")
	}
}

func TestEffectivePrice(t *testing.T) {
	p := &POI{Dishes: []Dish{{PriceVND: 90000}, {PriceVND: 50000}}, AvgPriceVND: 120000}
	if got := effectivePrice(p); got != 50000 {
		t.Errorf("effectivePrice = %d, want 50000 (cheapest dish)", got)
	}
	empty := &POI{AvgPriceVND: 120000}
	if got := effectivePrice(empty); got != 120000 {
		t.Errorf("effectivePrice(no dishes) = %d, want avg 120000", got)
	}
}

// --- SOFT score ------------------------------------------------------------

func TestScoreGeoDecayCloserWins(t *testing.T) {
	kb := testKB()
	a := kb.Get("RESA") // Hà Nội
	b := kb.Get("RESB") // HCM
	u := UserCtx{Lat: ptr(21.03), Lon: ptr(105.85), TimeMin: -1} // near A
	f := FilterSpec{OpenAfter: -1}

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
	kb := testKB()
	a := kb.Get("RESA")
	// No location, no query, no persona: only quality/rating_pop/localness apply.
	res := scorePOI(a, FilterSpec{OpenAfter: -1}, UserCtx{TimeMin: -1})
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
	kb := testKB()
	d := kb.Get("RESD") // premium
	res := scorePOI(d, FilterSpec{OpenAfter: -1}, UserCtx{TimeMin: -1})
	if res.Meta.Why.LuxuryPenalty != 1 {
		t.Errorf("premium POI must incur luxury_penalty=1, got %.3f", res.Meta.Why.LuxuryPenalty)
	}
	if res.Meta.Why.Localness != 0 {
		t.Errorf("premium POI localness must be 0, got %.3f", res.Meta.Why.Localness)
	}
}

func TestLocalness(t *testing.T) {
	budgetHi := &POI{PriceLevel: "budget", Quality: 0.95}
	mid := &POI{PriceLevel: "mid", Quality: 0.7}
	premium := &POI{PriceLevel: "premium", Quality: 0.95}
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
	kb := testKB()
	a := kb.Get("RESA") // segments [family], budget
	score, b := personaScore(a, UserCtx{Segment: "family", Price: "budget"})
	if score != 1.0 || !b.segmentOK || !b.priceOK {
		t.Errorf("persona full match = %.2f %+v, want 1.0 both ok", score, b)
	}
	half, _ := personaScore(a, UserCtx{Segment: "family", Price: "premium"})
	if half != 0.5 {
		t.Errorf("persona half match = %.2f, want 0.5", half)
	}
}

func TestRerankSortedDescending(t *testing.T) {
	kb := testKB()
	f := FilterSpec{OpenAfter: -1}
	res := Rerank(kb.POIs, f, UserCtx{Lat: ptr(21.03), Lon: ptr(105.85), TimeMin: -1}, 12)
	if len(res) == 0 {
		t.Fatal("Rerank returned no results")
	}
	for i := 1; i < len(res); i++ {
		if res[i-1].Score < res[i].Score {
			t.Errorf("results not sorted desc at %d: %.3f < %.3f", i, res[i-1].Score, res[i].Score)
		}
	}
}

// --- Compare ---------------------------------------------------------------

func TestCompare(t *testing.T) {
	kb := testKB()
	resp := Compare(kb, []string{"RESA", "RESB", "NOPE"}, UserCtx{TimeMin: -1})
	if len(resp.Items) != 2 {
		t.Errorf("Compare items = %d, want 2", len(resp.Items))
	}
	if !contains(resp.NotFound, "NOPE") {
		t.Errorf("Compare not_found = %v, want to contain NOPE", resp.NotFound)
	}
}

// guard against accidental float formatting regressions in round3
func TestRound3(t *testing.T) {
	if got := round3(0.123456); math.Abs(got-0.123) > 1e-9 {
		t.Errorf("round3 = %v, want 0.123", got)
	}
}
