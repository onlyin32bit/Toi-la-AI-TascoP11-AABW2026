package retrieve

import (
	"testing"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/kb/kbfixture"
	"tascop11/engine/internal/model"
)

// --- ParseQuery ------------------------------------------------------------

func TestParseQueryCityDietPrice(t *testing.T) {
	f := ParseQuery("quán chay ở Hà Nội dưới 100k")
	if f.City != "Hà Nội" {
		t.Errorf("City = %q, want Hà Nội", f.City)
	}
	if !kb.ContainsStr(f.Diet, "vegetarian") {
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
	if !kb.ContainsStr(f.Segments, "family") {
		t.Errorf("Segments = %v, want family", f.Segments)
	}
	if !kb.ContainsStr(f.Amenities, "parking") {
		t.Errorf("Amenities = %v, want parking", f.Amenities)
	}
}

// --- DetectDish --------------------------------------------------------------

func TestDetectDish(t *testing.T) {
	store := kbfixture.New()
	got := DetectDish(store, "cho tôi bún chả ở HCM")
	if !kb.ContainsStr(got, "bun cha") {
		t.Errorf("DetectDish = %v, want to contain 'bun cha'", got)
	}
	// Sub-tokens of a matched phrase must be dropped.
	if kb.ContainsStr(got, "bun") || kb.ContainsStr(got, "cha") {
		t.Errorf("DetectDish = %v, sub-tokens of 'bun cha' must be dropped", got)
	}
	// A dish not in the vocab yields nothing.
	if d := DetectDish(store, "cho tôi sushi"); len(d) != 0 {
		t.Errorf("DetectDish(sushi) = %v, want empty", d)
	}
}

// --- NamedEntities (anti-hallucination) --------------------------------------

func TestNamedEntitiesCrystalBBQTrap(t *testing.T) {
	store := kbfixture.New()
	_, missing := NamedEntities(store, "Crystal BBQ có món gì ngon")
	if !kb.ContainsStr(missing, "Crystal BBQ") {
		t.Errorf("missing = %v, want to flag 'Crystal BBQ'", missing)
	}
}

func TestNamedEntitiesKnownRestaurant(t *testing.T) {
	store := kbfixture.New()
	found, missing := NamedEntities(store, "Phở Bếp Nhà có gì")
	if len(missing) != 0 {
		t.Errorf("missing = %v, want empty for a known restaurant", missing)
	}
	if len(found) == 0 {
		t.Errorf("found = empty, want to match Phở Bếp Nhà")
	}
}

func TestNamedEntitiesNoFalsePositiveOnCity(t *testing.T) {
	store := kbfixture.New()
	// "Hà Nội" is a city, must not be flagged as an unknown restaurant.
	_, missing := NamedEntities(store, "tìm quán ăn ở Hà Nội")
	if len(missing) != 0 {
		t.Errorf("missing = %v, want empty (city must not false-positive)", missing)
	}
}

// --- HARD gate / Recall -------------------------------------------------------

func TestRecallCityFilter(t *testing.T) {
	store := kbfixture.New()
	f := ParseQuery("quán ăn ở HCM")
	survivors, nf := Recall(store, f, "quán ăn ở HCM")
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
	store := kbfixture.New()
	f := model.FilterSpec{OpenAfter: -1, Dish: []string{"bun cha"}}
	survivors, nf := RecallPool(store.POIs, f)
	if nf != nil {
		t.Fatalf("unexpected not_found: %+v", nf)
	}
	if len(survivors) != 1 || survivors[0].RestaurantID != "RESB" {
		t.Errorf("dish gate = %v, want only RESB", survivors)
	}
}

func TestRecallHalalHCMNotFound(t *testing.T) {
	store := kbfixture.New()
	f := model.FilterSpec{OpenAfter: -1, City: "TP. Hồ Chí Minh", Diet: []string{"halal"}}
	survivors, nf := RecallPool(store.POIs, f)
	if survivors != nil || nf == nil {
		t.Fatalf("want not_found, got survivors=%v nf=%v", survivors, nf)
	}
	if nf.Reason == "" || len(nf.Suggestions) == 0 {
		t.Errorf("Halal-HCM not_found must carry a reason + suggestions, got %+v", nf)
	}
}

// --- Autocomplete ------------------------------------------------------------

func TestAutocompletePrefixMatch(t *testing.T) {
	store := kbfixture.New()
	got := Autocomplete(store, "pho", 5)
	if len(got) == 0 {
		t.Fatal("Autocomplete(pho) returned nothing, want Phở Bếp Nhà")
	}
	if got[0].RestaurantID != "RESA" {
		t.Errorf("Autocomplete(pho)[0] = %s, want RESA (Phở Bếp Nhà)", got[0].RestaurantID)
	}
}

func TestAutocompleteEmptyPrefix(t *testing.T) {
	store := kbfixture.New()
	if got := Autocomplete(store, "", 5); got != nil {
		t.Errorf("Autocomplete(\"\") = %v, want nil", got)
	}
}

func TestAutocompleteRespectsLimit(t *testing.T) {
	store := kbfixture.New()
	// "b" prefix-matches multiple fixture POIs (Bún Chả Phố Cổ, and others).
	got := Autocomplete(store, "b", 1)
	if len(got) > 1 {
		t.Errorf("Autocomplete limit=1 returned %d results", len(got))
	}
}

func TestRecallDietVegetarian(t *testing.T) {
	store := kbfixture.New()
	f := model.FilterSpec{OpenAfter: -1, Diet: []string{"vegetarian"}}
	survivors, _ := RecallPool(store.POIs, f)
	for _, p := range survivors {
		if !kb.DietMatch(p, "vegetarian") {
			t.Errorf("survivor %s does not satisfy vegetarian", p.Name)
		}
	}
	if len(survivors) == 0 {
		t.Errorf("expected at least the vegetarian POI")
	}
}
