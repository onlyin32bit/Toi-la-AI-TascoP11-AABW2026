// Package vnlang holds Vietnamese localization touches that don't belong to
// any single pipeline stage: teencode/slang normalization (applied before
// query parsing) and the meal-time-of-day dish prior (§1.5 L2/L4).
package vnlang

import (
	"regexp"

	"tascop11/engine/internal/kb"
)

// slangMap normalizes common Vietnamese teencode/slang tokens to their full
// diacritic-free form before ParseQuery runs. Keys/values are matched on
// already-lowercased, diacritic-stripped text (see kb.Norm).
var slangMap = map[string]string{
	"k":        "khong",
	"ko":       "khong",
	"hong":     "khong",
	"hok":      "khong",
	"dc":       "duoc",
	"j":        "gi",
	"bn":       "bao nhieu",
	"ntn":      "nhu the nao",
	"sml":      "",
	"vs":       "voi",
	"nch":      "noi chung",
	"nma":      "nhung ma",
	"mik":      "minh",
	"mn":       "moi nguoi",
	"ny":       "nay",
	"bik":      "biet",
	"bit":      "biet",
	"r":        "roi",
	"z":        "vay",
	"iu":       "yeu",
	"trc":      "truoc",
	"h":        "gio",
	"cx":       "cung",
	"cug":      "cung",
	"thik":     "thich",
	"ok":       "duoc",
	"oke":      "duoc",
	"okela":    "duoc",
	"pls":      "lam on",
	"plz":      "lam on",
	"bao nhiu": "bao nhieu",
}

// reWord matches a whole word token (ASCII letters/digits — the input to
// NormalizeSlang is expected pre-normalized-ish free text, still with spaces).
var reWord = regexp.MustCompile(`[a-zA-Z0-9À-ỹ]+`)

// NormalizeSlang rewrites teencode/slang tokens to their standard form,
// preserving surrounding punctuation/spacing. Applied to the raw query
// before ParseQuery so downstream matching (city/intent/dish detection)
// sees normalized Vietnamese.
func NormalizeSlang(q string) string {
	if q == "" {
		return q
	}
	return reWord.ReplaceAllStringFunc(q, func(tok string) string {
		key := kb.Norm(tok)
		if repl, ok := slangMap[key]; ok {
			return repl
		}
		return tok
	})
}

// mealTimeBucket is a time-of-day window mapped to Vietnamese dish/meal
// tokens reflecting local eating culture (§1.5 L4).
type mealTimeBucket struct {
	fromMin, toMin int // [fromMin, toMin), minutes since midnight; wraps if toMin < fromMin
	tokens         []string
}

var mealTimeBuckets = []mealTimeBucket{
	{300, 600, []string{"pho", "bun", "banh mi", "xoi", "ca phe"}}, // sáng 05:00–10:00
	{600, 840, []string{"com"}},                                    // trưa 10:00–14:00
	{840, 1320, []string{"lau", "nuong", "nhau"}},                  // tối 14:00–22:00
	{1320, 1620, []string{"chao", "pho dem", "oc"}},                // khuya 22:00–03:00 (wraps past midnight)
}

// MealTimeTokens returns the Vietnamese meal-time tokens for the given
// minute-of-day (0-1439), or nil if minute is unset (<0) or unmatched.
func MealTimeTokens(minute int) []string {
	if minute < 0 {
		return nil
	}
	m := minute % 1440
	for _, b := range mealTimeBuckets {
		if b.toMin < b.fromMin {
			// wraps midnight, e.g. 22:00 -> 03:00
			if m >= b.fromMin || m < b.toMin {
				return b.tokens
			}
			continue
		}
		if m >= b.fromMin && m < b.toMin {
			return b.tokens
		}
	}
	return nil
}
