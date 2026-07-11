package main

import "math"

// Compare builds a side-by-side comparison of the given POI ids (§5.8).
// Unknown ids are collected into NotFound. Distance is filled when the user
// location is known.
func Compare(kb *KB, ids []string, u UserCtx) CompareResponse {
	resp := CompareResponse{Items: []CompareItem{}, NotFound: []string{}}
	for _, id := range ids {
		p := kb.Get(id)
		if p == nil {
			resp.NotFound = append(resp.NotFound, id)
			continue
		}
		var distPtr *int
		if u.Lat != nil && u.Lon != nil {
			d := int(math.Round(haversine(*u.Lat, *u.Lon, p.Lat, p.Lon)))
			distPtr = &d
		}
		resp.Items = append(resp.Items, CompareItem{
			ID:             p.ID,
			Name:           p.Name,
			PriceLevel:     p.PriceLevel,
			AvgPriceVND:    p.AvgPriceVND,
			Rating:         p.Rating,
			Quality:        p.Quality,
			Segments:       p.Segments,
			Diet:           p.Diet,
			DistanceMeters: distPtr,
			TopDishes:      topDishes(p, 3),
			Source:         p.Source,
			Verified:       p.Verified,
		})
	}
	return resp
}

// topDishes returns up to n dishes for the comparison table.
func topDishes(p *POI, n int) []MatchedDish {
	out := []MatchedDish{}
	for _, d := range p.Dishes {
		if len(out) >= n {
			break
		}
		out = append(out, MatchedDish{Dish: d.Name, PriceVND: d.PriceVND})
	}
	return out
}
