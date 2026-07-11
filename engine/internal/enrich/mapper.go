// mapper.go: transforms one raw Apify Google Places item into an enrichment
// Result, attaching a Google provenance field to each populated slot.
// Field extraction rules follow preprocess/apify_poi_mapper.py so
// batch-scraped and on-demand-enriched POIs converge on the same schema.
package enrich

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	sourceGoogle    = "google"
	confidenceGoogle = 0.87
)

// Google returns price bands like "200-800 N ₫" (N = nghìn/thousand).
var priceRangeRE = regexp.MustCompile(`(\d[\d.,]*)\s*[-\x{2013}]\s*(\d[\d.,]*)\s*N`)

// mapGooglePlace converts a raw Apify item into a Result. Provenance is
// attached ONLY for fields we actually populate — absent keys mean "unknown",
// never "verified empty" (never fabricate).
func mapGooglePlace(place map[string]any, poiID string, fetchedAt string) *Result {
	r := &Result{
		POIID:      poiID,
		Provenance: map[string]ProvenanceField{},
	}
	prov := ProvenanceField{
		Source:     sourceGoogle,
		Confidence: confidenceGoogle,
		FetchedAt:  fetchedAt,
	}

	if raw := mostCommonHours(getMapList(place, "openingHours")); raw != "" {
		r.HoursOpen = raw
		r.Provenance["hours"] = prov
	}

	if price, _ := place["price"].(string); price != "" {
		if pr := formatPriceRange(price); pr != "" {
			r.PriceRange = pr
			r.Provenance["priceRange"] = prov
		}
	}

	if rf, ok := place["totalScore"].(float64); ok && rf > 0 {
		rating := rf
		r.Rating = &rating
	}

	// Google Places may expose a `menu` field (rare) or dish names inside
	// categories/tags — we take the strongest signal first.
	if menu := extractMenuItems(place); len(menu) > 0 {
		r.MenuItems = menu
		r.Provenance["menu"] = prov
	}

	if tags := extractDietTags(place); len(tags) > 0 {
		r.DietTags = tags
		r.Provenance["dietTags"] = prov
	}

	if addr, _ := place["address"].(string); addr != "" {
		r.Provenance["address"] = prov
	}

	if url, _ := place["url"].(string); url != "" {
		r.SourceURL = url
	}
	return r
}

// getMapList narrows an untyped JSON array into []map[string]any.
func getMapList(m map[string]any, key string) []map[string]any {
	raw, _ := m[key].([]any)
	if raw == nil {
		return nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, v := range raw {
		if item, ok := v.(map[string]any); ok {
			out = append(out, item)
		}
	}
	return out
}

func getStringList(m map[string]any, key string) []string {
	raw, _ := m[key].([]any)
	if raw == nil {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// mostCommonHours mirrors _most_common_hours in apify_poi_mapper.py.
// Google returns per-day rows; a restaurant usually has the same hours on
// most days, so we take the mode. Skips "closed" days.
func mostCommonHours(openingHours []map[string]any) string {
	counts := map[string]int{}
	for _, row := range openingHours {
		h, _ := row["hours"].(string)
		h = strings.TrimSpace(h)
		if h == "" || strings.EqualFold(h, "closed") {
			continue
		}
		counts[h]++
	}
	best := ""
	max := 0
	for k, v := range counts {
		if v > max {
			best = k
			max = v
		}
	}
	return best
}

// formatPriceRange turns Google's "200-800 N ₫" into a UI-friendly
// "200k – 800k VND" string. Falls back to the raw text when parsing fails.
func formatPriceRange(raw string) string {
	m := priceRangeRE.FindStringSubmatch(raw)
	if len(m) < 3 {
		return strings.TrimSpace(raw)
	}
	return fmt.Sprintf("%sk – %sk VND", cleanNum(m[1]), cleanNum(m[2]))
}

func cleanNum(s string) string {
	return strings.NewReplacer(".", "", ",", "").Replace(s)
}

// extractMenuItems tries `menu` first (some Google Places rows carry a
// bulleted array), then dishes-in-categories as a fallback. Names are
// deduplicated and capped at 8 to keep the UI card readable.
func extractMenuItems(place map[string]any) []string {
	items := getStringList(place, "menu")
	if len(items) == 0 {
		// some actor variants embed menu inside `menuItems` or `dishes`
		items = getStringList(place, "menuItems")
	}
	if len(items) == 0 {
		items = getStringList(place, "dishes")
	}
	return dedupeCap(items, 8)
}

// extractDietTags sniffs Vietnamese diet keywords from category strings.
// Never invents: no hit means "unknown" (empty slice), never "not vegetarian".
func extractDietTags(place map[string]any) []string {
	seen := map[string]bool{}
	var out []string
	inspect := func(s string) {
		lower := strings.ToLower(s)
		if strings.Contains(lower, "chay") && !seen["vegetarian"] {
			out = append(out, "vegetarian")
			seen["vegetarian"] = true
		}
		if (strings.Contains(lower, "halal") || strings.Contains(lower, "hồi giáo")) && !seen["halal"] {
			out = append(out, "halal")
			seen["halal"] = true
		}
	}
	if s, _ := place["categoryName"].(string); s != "" {
		inspect(s)
	}
	for _, s := range getStringList(place, "categories") {
		inspect(s)
	}
	return out
}

func dedupeCap(items []string, cap int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, s := range items {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
		if len(out) >= cap {
			break
		}
	}
	return out
}
