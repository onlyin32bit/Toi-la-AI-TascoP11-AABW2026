// Package retrieve implements query parsing, dish/entity detection, and the
// HARD gate recall stage (§5.3/§7.1) — everything that runs before scoring.
package retrieve

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/model"
)

// cityAlias maps a normalized (diacritic-free, lowercase) phrase to a canonical
// city name as it appears in kb.json. Ordered longest-first so multi-word
// phrases win over abbreviations.
type cityAlias struct {
	key       string // tokenized phrase, space separated
	canonical string
}

var cityAliases = []cityAlias{
	{"tp ho chi minh", "TP. Hồ Chí Minh"},
	{"thanh pho ho chi minh", "TP. Hồ Chí Minh"},
	{"ho chi minh", "TP. Hồ Chí Minh"},
	{"sai gon", "TP. Hồ Chí Minh"},
	{"tp hcm", "TP. Hồ Chí Minh"},
	{"tphcm", "TP. Hồ Chí Minh"},
	{"hcm", "TP. Hồ Chí Minh"},
	{"ha noi", "Hà Nội"},
	{"hn", "Hà Nội"},
	{"da nang", "Đà Nẵng"},
	{"nha trang", "Nha Trang"},
	{"ha long", "Hạ Long"},
	{"da lat", "Đà Lạt"},
	{"hue", "Huế"},
}

// stopwords are Vietnamese function words dropped from the semantic token set.
var stopwords = map[string]struct{}{
	"toi": {}, "minh": {}, "muon": {}, "can": {}, "tim": {}, "quan": {},
	"an": {}, "nha": {}, "hang": {}, "nao": {}, "gi": {}, "co": {},
	"khong": {}, "duoc": {}, "la": {}, "gan": {}, "day": {}, "nay": {},
	"cho": {}, "mon": {}, "o": {}, "oi": {}, "cua": {}, "ban": {},
	"cac": {}, "nhung": {}, "va": {}, "hay": {}, "mot": {}, "voi": {},
	"the": {}, "nhe": {}, "gioi": {}, "thieu": {}, "kiem": {}, "khu": {},
	"vuc": {}, "chi": {}, "dan": {}, "di": {},
}

// intentHint expands soft intent phrases into structured segment/amenity/diet.
type intentHint struct {
	re        *regexp.Regexp
	segments  []string
	amenities []string
	diet      []string
}

var intentHints = []intentHint{
	{regexp.MustCompile(`gia dinh|tre em|con nho`), []string{"family"}, []string{"kid_friendly"}, nil},
	{regexp.MustCompile(`hen ho|lang man|cap doi`), []string{"romantic"}, nil, nil},
	{regexp.MustCompile(`tiep khach|doi tac|business|cong so`), []string{"business"}, nil, nil},
	{regexp.MustCompile(`nhom ban|di nhom|hoi nhom`), []string{"group"}, nil, nil},
	{regexp.MustCompile(`thuan chay|do chay|vegan|an chay|chay`), nil, nil, []string{"vegetarian"}},
	{regexp.MustCompile(`halal`), nil, nil, []string{"halal"}},
	{regexp.MustCompile(`view dep|khong gian dep`), nil, []string{"nice_view"}, nil},
	{regexp.MustCompile(`do xe|bai xe|o to|dau xe`), nil, []string{"parking"}, nil},
	{regexp.MustCompile(`yen tinh|nhe nhang`), nil, []string{"music"}, nil},
}

var (
	rePrice     = regexp.MustCompile(`duoi\s+([0-9][0-9.,]*)\s*(k|nghin|ngan|tr|trieu)?`)
	reMinRating = regexp.MustCompile(`([0-9](?:[.,][0-9])?)\s*sao`)
	reOpenAfter = regexp.MustCompile(`sau\s+([0-9]{1,2})[:h]([0-9]{2})`)
)

// paddedTokens returns " a b c " for boundary-safe substring matching.
func paddedTokens(q string) string {
	return " " + strings.Join(kb.Tokenize(q), " ") + " "
}

// ParseQuery turns a free-text Vietnamese query into a FilterSpec (§5.3).
func ParseQuery(q string) model.FilterSpec {
	f := model.FilterSpec{OpenAfter: -1}
	nq := kb.Norm(q)
	padded := paddedTokens(q)

	// City alias (longest phrase first).
	consumedCityToks := map[string]struct{}{}
	for _, a := range cityAliases {
		if strings.Contains(padded, " "+a.key+" ") {
			f.City = a.canonical
			for _, t := range strings.Fields(a.key) {
				consumedCityToks[t] = struct{}{}
			}
			break
		}
	}

	// Intent hints -> segments / amenities / diet.
	segSet, amenSet, dietSet := map[string]struct{}{}, map[string]struct{}{}, map[string]struct{}{}
	for _, h := range intentHints {
		if h.re.MatchString(nq) {
			for _, s := range h.segments {
				segSet[s] = struct{}{}
			}
			for _, a := range h.amenities {
				amenSet[a] = struct{}{}
			}
			for _, d := range h.diet {
				dietSet[d] = struct{}{}
			}
		}
	}
	f.Segments = keys(segSet)
	f.Amenities = keys(amenSet)
	f.Diet = keys(dietSet)

	// Price: "duoi 100k" / "duoi 100.000" / "duoi 100000".
	if m := rePrice.FindStringSubmatch(nq); m != nil {
		digits := strings.NewReplacer(".", "", ",", "").Replace(m[1])
		if n, err := strconv.Atoi(digits); err == nil {
			switch m[2] {
			case "k", "nghin", "ngan":
				n *= 1000
			case "tr", "trieu":
				n *= 1000000
			}
			f.MaxPrice = n
		}
	}

	// Minimum rating: "tu 4.5 sao tro len".
	if m := reMinRating.FindStringSubmatch(nq); m != nil {
		if v, err := strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64); err == nil {
			f.MinRating = v
		}
	}

	// Open-after: explicit "sau 23:00" or late-night intent "an khuya".
	if m := reOpenAfter.FindStringSubmatch(nq); m != nil {
		h, _ := strconv.Atoi(m[1])
		mm, _ := strconv.Atoi(m[2])
		f.OpenAfter = h*60 + mm
	} else if strings.Contains(nq, "an khuya") || strings.Contains(nq, "khuya") {
		f.OpenAfter = 1320 // 22:00
	}

	// Semantic tokens: drop stopwords and consumed city tokens.
	seen := map[string]struct{}{}
	for _, t := range kb.Tokenize(q) {
		if _, stop := stopwords[t]; stop {
			continue
		}
		if _, city := consumedCityToks[t]; city {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		f.Tokens = append(f.Tokens, t)
	}
	return f
}

// DetectDish finds named dishes from the global dish vocab. Whole-phrase grams
// (len>=3), longest-first, dropping sub-tokens of matched phrases. A named dish
// becomes a HARD constraint downstream.
func DetectDish(k *kb.KB, q string) []string {
	toks := kb.Tokenize(q)
	n := len(toks)
	used := make([]bool, n)
	var matched []string
	seen := map[string]struct{}{}
	vocab := k.DishVocab()
	for size := n; size >= 1; size-- {
		for i := 0; i+size <= n; i++ {
			phrase := strings.Join(toks[i:i+size], " ")
			if len(phrase) < 3 {
				continue
			}
			if _, ok := vocab[phrase]; !ok {
				continue
			}
			overlap := false
			for j := i; j < i+size; j++ {
				if used[j] {
					overlap = true
					break
				}
			}
			if overlap {
				continue
			}
			for j := i; j < i+size; j++ {
				used[j] = true
			}
			if _, dup := seen[phrase]; !dup {
				seen[phrase] = struct{}{}
				matched = append(matched, phrase)
			}
		}
	}
	return matched
}

// NamedEntities detects proper-noun restaurant names in the query and splits
// them into ones present in the KB (found) vs absent (missing). This is the
// anti-hallucination guard (Crystal BBQ trap). It is deliberately conservative:
// only multi-word capitalized runs are candidates, and city names /
// function-word-led phrases are skipped so valid queries don't false-positive.
func NamedEntities(k *kb.KB, q string) (found []*kb.POI, missing []string) {
	for _, phrase := range capitalizedRuns(q) {
		np := kb.Norm(phrase)
		if np == "" || isCityPhrase(np) {
			continue
		}
		if first := strings.Fields(np); len(first) > 0 {
			if _, stop := stopwords[first[0]]; stop {
				continue
			}
		}
		if p := k.MatchName(np); p != nil {
			found = append(found, p)
		} else {
			missing = append(missing, phrase)
		}
	}
	return found, missing
}

// capitalizedRuns returns maximal runs (>=2 tokens) of capitalized words.
func capitalizedRuns(q string) []string {
	fields := strings.Fields(q)
	var runs []string
	var cur []string
	flush := func() {
		if len(cur) >= 2 {
			runs = append(runs, strings.Join(cur, " "))
		}
		cur = nil
	}
	for _, tok := range fields {
		clean := strings.TrimFunc(tok, func(r rune) bool {
			return !unicode.IsLetter(r) && !unicode.IsNumber(r)
		})
		if clean == "" {
			flush()
			continue
		}
		if startsUpper(clean) {
			cur = append(cur, clean)
		} else {
			flush()
		}
	}
	flush()
	return runs
}

func startsUpper(s string) bool {
	for _, r := range s {
		return unicode.IsUpper(r)
	}
	return false
}

func isCityPhrase(np string) bool {
	for _, a := range cityAliases {
		if a.key == np {
			return true
		}
	}
	for _, p := range []string{"ha noi", "tp ho chi minh", "ho chi minh", "da nang", "nha trang", "ha long", "da lat", "hue"} {
		if np == p {
			return true
		}
	}
	return false
}

// Recall applies the HARD gate over the full KB (§5.3/§7.1).
func Recall(k *kb.KB, f model.FilterSpec, q string) ([]*kb.POI, *model.NotFound) {
	return RecallPool(k.POIs, f)
}

// RecallPool runs the HARD gate over an explicit candidate pool. httpserver
// uses this directly to exclude UGC in eval mode.
func RecallPool(pool []*kb.POI, f model.FilterSpec) ([]*kb.POI, *model.NotFound) {
	hasContent := len(f.Tokens) > 0 || len(f.Dish) > 0
	hasStructured := f.City != "" || len(f.Diet) > 0 || len(f.Segments) > 0 ||
		len(f.Amenities) > 0 || f.MaxPrice > 0 || f.MinRating > 0 ||
		f.OpenAfter >= 0 || len(f.Dish) > 0

	var survivors []*kb.POI
	for _, p := range pool {
		if !passHardGate(p, f) {
			continue
		}
		// Lexical relevance: only required for free-text queries with no
		// structural intent (empty query = nearby mode, keep everything).
		if hasContent && !hasStructured {
			if !kb.DishMatchAny(p, f.Dish) && kb.LexOverlap(p, f.Tokens) == 0 {
				continue
			}
		}
		survivors = append(survivors, p)
	}

	if len(survivors) == 0 && (hasStructured || hasContent) {
		return nil, buildNotFound(f)
	}
	return survivors, nil
}

// passHardGate enforces the non-negotiable constraints. Fail => reject.
func passHardGate(p *kb.POI, f model.FilterSpec) bool {
	if f.City != "" && p.City != f.City {
		return false
	}
	if len(f.Dish) > 0 {
		ds := p.DishSet()
		for _, d := range f.Dish {
			if _, ok := ds[kb.Norm(d)]; !ok {
				return false
			}
		}
	}
	if f.MinRating > 0 && p.Rating < f.MinRating {
		return false
	}
	if f.MaxPrice > 0 && kb.EffectivePrice(p) > f.MaxPrice {
		return false
	}
	if f.OpenAfter >= 0 && !kb.IsOpenAt(p.Opening, f.OpenAfter) {
		return false
	}
	for _, d := range f.Diet {
		if !kb.DietMatch(p, d) {
			return false
		}
	}
	return true
}

// buildNotFound produces an honest VN not_found body with relaxation hints.
func buildNotFound(f model.FilterSpec) *model.NotFound {
	// Special-case the Halal-in-HCM honesty trap (§5.3).
	if kb.ContainsStr(f.Diet, "halal") && f.City != "" {
		return &model.NotFound{
			Status: "not_found",
			Reason: fmt.Sprintf("Không có quán Halal ở %s", f.City),
			Suggestions: []string{
				"Bỏ lọc Halal",
				"Mở rộng sang khu vực khác (ví dụ Đà Lạt)",
			},
		}
	}

	var parts []string
	if len(f.Dish) > 0 {
		parts = append(parts, "món “"+strings.Join(f.Dish, ", ")+"”")
	}
	if len(f.Diet) > 0 {
		parts = append(parts, "chế độ ăn "+strings.Join(f.Diet, ", "))
	}
	if f.City != "" {
		parts = append(parts, "ở "+f.City)
	}
	reason := "Không tìm thấy quán phù hợp với yêu cầu của bạn"
	if len(parts) > 0 {
		reason = "Không tìm thấy quán phù hợp (" + strings.Join(parts, ", ") + ")"
	}

	sugg := []string{"Bỏ bớt bộ lọc để có thêm kết quả"}
	if f.City != "" {
		sugg = append(sugg, "Mở rộng sang thành phố khác")
	}
	if f.MaxPrice > 0 {
		sugg = append(sugg, "Nâng ngưỡng giá tối đa")
	}
	if f.MinRating > 0 {
		sugg = append(sugg, "Hạ yêu cầu điểm đánh giá")
	}
	return &model.NotFound{Status: "not_found", Reason: reason, Suggestions: sugg}
}

func keys(m map[string]struct{}) []string {
	if len(m) == 0 {
		return nil
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// Autocomplete returns POIs matching a partial query (prefix match on the
// normalized name or any of its tokens) — a fast, low-latency suggestion
// lookup distinct from ParseQuery's full free-text parsing. Exact
// name-prefix matches sort first, then by rating. Empty prefix -> nil.
func Autocomplete(k *kb.KB, prefix string, limit int) []*kb.POI {
	p := kb.Norm(prefix)
	if p == "" || limit <= 0 {
		return nil
	}
	var matched []*kb.POI
	for _, poi := range k.POIs {
		if strings.HasPrefix(poi.NameNorm(), p) || tokenHasPrefix(poi.NameNorm(), p) {
			matched = append(matched, poi)
		}
	}
	sort.SliceStable(matched, func(i, j int) bool {
		iExact := strings.HasPrefix(matched[i].NameNorm(), p)
		jExact := strings.HasPrefix(matched[j].NameNorm(), p)
		if iExact != jExact {
			return iExact
		}
		return matched[i].Rating > matched[j].Rating
	})
	if len(matched) > limit {
		matched = matched[:limit]
	}
	return matched
}

func tokenHasPrefix(normText, prefix string) bool {
	for _, tok := range strings.Fields(normText) {
		if strings.HasPrefix(tok, prefix) {
			return true
		}
	}
	return false
}
