// Package kbfixture provides the small, hermetic in-memory KB used across
// every package's tests (kb, retrieve, rerank, compare, httpserver, eval) so
// the four benchmark POIs are defined exactly once instead of duplicated
// per-package.
package kbfixture

import "tascop11/engine/internal/kb"

// New builds an in-memory KB (no kb.json needed) so tests are hermetic.
func New() *kb.KB {
	store := kb.New()

	// A: Phở Bếp Nhà — Hà Nội, budget, normal hours 09:00-23:00.
	store.Add(&kb.POI{
		ID: "poi:resa", RestaurantID: "RESA", Name: "Phở Bếp Nhà",
		Category: "Nhà hàng", CuisineType: "Việt Nam", City: "Hà Nội",
		Lat: 21.040388, Lon: 105.844615, PriceLevel: "budget", AvgPriceVND: 68289,
		Rating: 3.8, Popularity: 55, Quality: 0.88,
		Opening:       kb.Opening{OpenMin: 540, CloseMin: 1380, Overnight: false, Raw: "09:00-23:00"},
		Segments:      []string{"family"},
		Dishes:        []kb.Dish{{Name: "Phở bò tái", PriceVND: 68289}},
		KnownEntities: kb.KnownEntities{Names: []string{"pho bep nha"}, Dishes: []string{"pho bo tai"}},
	})

	// B: Bún Chả Phố Cổ — HCM, budget, overnight 10:00-02:00, rating 4.8.
	store.Add(&kb.POI{
		ID: "poi:resb", RestaurantID: "RESB", Name: "Bún Chả Phố Cổ",
		Category: "Nhà hàng", CuisineType: "Việt Nam", City: "TP. Hồ Chí Minh",
		Lat: 10.763578, Lon: 106.709041, PriceLevel: "budget", AvgPriceVND: 99797,
		Rating: 4.8, Popularity: 46, Quality: 0.97,
		Opening:       kb.Opening{OpenMin: 600, CloseMin: 120, Overnight: true, Raw: "10:00-02:00"},
		Segments:      []string{"family", "fastfood"},
		Dishes:        []kb.Dish{{Name: "Bún chả", PriceVND: 99797}},
		KnownEntities: kb.KnownEntities{Names: []string{"bun cha pho co"}, Dishes: []string{"bun cha"}},
	})

	// C: Mộc Vegan Bistro — Hạ Long, vegetarian, daytime 06:00-14:00.
	store.Add(&kb.POI{
		ID: "poi:resc", RestaurantID: "RESC", Name: "Mộc Vegan Bistro",
		Category: "Nhà hàng chay", CuisineType: "Chay", City: "Hạ Long",
		Lat: 20.97621, Lon: 107.085937, PriceLevel: "budget", AvgPriceVND: 65014,
		Rating: 4.3, Popularity: 95, Quality: 0.90, Diet: []string{"vegetarian"},
		Opening:       kb.Opening{OpenMin: 360, CloseMin: 840, Overnight: false, Raw: "06:00-14:00"},
		Segments:      []string{"family"},
		Dishes:        []kb.Dish{{Name: "Đậu hũ sốt nấm", PriceVND: 65014, Tags: []string{"vegetarian"}}},
		KnownEntities: kb.KnownEntities{Names: []string{"moc vegan bistro"}, Dishes: []string{"dau hu sot nam"}},
	})

	// D: premium place — Hà Nội, to exercise the luxury penalty.
	store.Add(&kb.POI{
		ID: "poi:resd", RestaurantID: "RESD", Name: "Nhà Hàng Hoàng Gia",
		Category: "Nhà hàng", CuisineType: "Âu", City: "Hà Nội",
		Lat: 21.05, Lon: 105.85, PriceLevel: "premium", AvgPriceVND: 850000,
		Rating: 4.6, Popularity: 40, Quality: 0.86,
		Opening:       kb.Opening{OpenMin: 660, CloseMin: 1410, Overnight: false, Raw: "11:00-23:30"},
		Segments:      []string{"business", "romantic"},
		Dishes:        []kb.Dish{{Name: "Bít tết bò Wagyu", PriceVND: 850000}},
		KnownEntities: kb.KnownEntities{Names: []string{"nha hang hoang gia"}, Dishes: []string{"bit tet bo wagyu"}},
	})

	// Mirror LoadKB: benchmark POIs carry tasco_csv provenance (health counts by source).
	for _, p := range store.POIs {
		p.Source = "tasco_csv"
		p.Verified = true
	}
	return store
}
