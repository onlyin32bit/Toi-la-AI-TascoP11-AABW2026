// Verifies field extraction from a hand-crafted Google Places item matches
// the Result shape the UI consumes. Doesn't touch Apify — pure mapping.
package enrich

import (
	"testing"
)

func TestMapGooglePlaceHappyPath(t *testing.T) {
	place := map[string]any{
		"title":        "Phở Bếp Nhà",
		"address":      "2 Trần Phú, Hoàn Kiếm, Hà Nội",
		"price":        "50-150 N ₫",
		"totalScore":   4.5,
		"categoryName": "Quán chay",
		"categories":   []any{"Quán ăn Việt Nam", "Món chay"},
		"url":          "https://maps.google.com/?cid=123",
		"openingHours": []any{
			map[string]any{"day": "Monday", "hours": "09:00 to 22:00"},
			map[string]any{"day": "Tuesday", "hours": "09:00 to 22:00"},
			map[string]any{"day": "Wednesday", "hours": "closed"},
			map[string]any{"day": "Thursday", "hours": "09:00 to 22:00"},
		},
		"menu": []any{"Phở bò tái", "Bún chả", "Gỏi cuốn"},
	}

	r := mapGooglePlace(place, "poi:res001", "2026-07-12T00:00:00Z")

	if r.POIID != "poi:res001" {
		t.Errorf("POIID = %q, want poi:res001", r.POIID)
	}
	if r.HoursOpen != "09:00 to 22:00" {
		t.Errorf("HoursOpen = %q, want 09:00 to 22:00", r.HoursOpen)
	}
	if r.PriceRange != "50k – 150k VND" {
		t.Errorf("PriceRange = %q, want 50k – 150k VND", r.PriceRange)
	}
	if r.Rating == nil || *r.Rating != 4.5 {
		t.Errorf("Rating = %v, want 4.5", r.Rating)
	}
	if got := len(r.MenuItems); got != 3 {
		t.Errorf("MenuItems len = %d, want 3", got)
	}
	if got := r.DietTags; len(got) != 1 || got[0] != "vegetarian" {
		t.Errorf("DietTags = %v, want [vegetarian]", got)
	}
	if r.SourceURL == "" {
		t.Errorf("SourceURL should be populated")
	}
	// Every populated field should have provenance
	for _, key := range []string{"hours", "priceRange", "menu", "dietTags", "address"} {
		if _, ok := r.Provenance[key]; !ok {
			t.Errorf("Provenance[%q] missing", key)
		}
	}
}

func TestMapGooglePlaceEmptyFieldsHaveNoProvenance(t *testing.T) {
	// Only title + address. No hours, price, menu, diet.
	r := mapGooglePlace(map[string]any{
		"title":   "Bún Ơi",
		"address": "10 Lê Lợi, Q1, TP.HCM",
	}, "poi:x", "2026-07-12T00:00:00Z")

	if r.HoursOpen != "" || r.PriceRange != "" || len(r.MenuItems) != 0 || len(r.DietTags) != 0 {
		t.Errorf("empty fields should stay empty, got %+v", r)
	}
	// Only address provenance
	if len(r.Provenance) != 1 {
		t.Errorf("Provenance = %d entries, want 1 (address only): %+v", len(r.Provenance), r.Provenance)
	}
	if _, ok := r.Provenance["address"]; !ok {
		t.Errorf("expected address provenance, got %+v", r.Provenance)
	}
}

func TestComputeQualityAfterWithBefore(t *testing.T) {
	r := &Result{}
	if got := computeQualityAfter(0.88, r); got != 0.98 {
		t.Errorf("computeQualityAfter(0.88) = %v, want 0.98", got)
	}
	got := computeQualityAfter(0.75, r)
	if got < 0.849 || got > 0.851 {
		t.Errorf("computeQualityAfter(0.75) = %v, want ~0.85", got)
	}
	if got := computeQualityAfter(0.95, r); got != 0.98 {
		t.Errorf("computeQualityAfter(0.95) = %v, want 0.98", got)
	}
}

func TestComputeQualityAfterNoBeforeCountsFields(t *testing.T) {
	full := &Result{
		MenuItems:  []string{"a"},
		HoursOpen:  "x",
		PriceRange: "y",
		DietTags:   []string{"z"},
	}
	rating := 4.5
	full.Rating = &rating
	// 0.5 + 5*0.1 = 1.0
	if got := computeQualityAfter(0, full); got != 1.0 {
		t.Errorf("computeQualityAfter(0, full) = %v, want 1.0", got)
	}
	empty := &Result{}
	if got := computeQualityAfter(0, empty); got != 0.5 {
		t.Errorf("computeQualityAfter(0, empty) = %v, want 0.5", got)
	}
}

func TestPickBestMatchLongestOverlap(t *testing.T) {
	items := []map[string]any{
		{"title": "Trung Nguyen Coffee"},
		{"title": "Phở Bếp Nhà - Hà Nội"},
		{"title": "Highlands Coffee"},
	}
	best := pickBestMatch(items, "Phở Bếp Nhà")
	if best == nil {
		t.Fatal("expected a match, got nil")
	}
	if title, _ := best["title"].(string); title != "Phở Bếp Nhà - Hà Nội" {
		t.Errorf("best.title = %q, want Phở Bếp Nhà - Hà Nội", title)
	}
}
