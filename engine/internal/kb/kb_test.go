package kb

import "testing"

func TestNorm(t *testing.T) {
	cases := map[string]string{
		"Phở Bò Tái": "pho bo tai",
		"Đà Nẵng":    "da nang",
		"BÚN CHẢ":    "bun cha",
		"  Huế  ":    "hue",
	}
	for in, want := range cases {
		if got := Norm(in); got != want {
			t.Errorf("Norm(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTokenize(t *testing.T) {
	got := Tokenize("Bún chả, Phở!")
	want := []string{"bun", "cha", "pho"}
	if len(got) != len(want) {
		t.Fatalf("Tokenize len = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Tokenize[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestIsOpenAt(t *testing.T) {
	normal := Opening{OpenMin: 540, CloseMin: 1380}               // 09:00-23:00
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
		if got := IsOpenAt(tc.o, tc.min); got != tc.want {
			t.Errorf("%s: IsOpenAt = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestHaversine(t *testing.T) {
	// Hà Nội -> TP.HCM is ~1150 km.
	d := Haversine(21.0245, 105.8412, 10.7769, 106.7009)
	if d < 1_050_000 || d > 1_250_000 {
		t.Errorf("Haversine HN-HCM = %.0f m, expected ~1.15e6", d)
	}
	if Haversine(21.0, 105.0, 21.0, 105.0) != 0 {
		t.Errorf("Haversine of identical points must be 0")
	}
}

func TestEffectivePrice(t *testing.T) {
	p := &POI{Dishes: []Dish{{PriceVND: 90000}, {PriceVND: 50000}}, AvgPriceVND: 120000}
	if got := EffectivePrice(p); got != 50000 {
		t.Errorf("EffectivePrice = %d, want 50000 (cheapest dish)", got)
	}
	empty := &POI{AvgPriceVND: 120000}
	if got := EffectivePrice(empty); got != 120000 {
		t.Errorf("EffectivePrice(no dishes) = %d, want avg 120000", got)
	}
}
