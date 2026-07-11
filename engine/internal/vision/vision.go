// Package vision implements dish recognition and menu OCR via
// llmclient.ChatVision, both cached by image-content hash so the curated
// demo photos always resolve instantly offline. OCRMenuImpl's signature
// matches internal/contribute's OCRMenu seam var — cmd/server wires them
// together explicitly at startup (`contribute.OCRMenu = vision.OCRMenuImpl`),
// keeping this package free of any storage/HTTP-handler concerns.
package vision

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"tascop11/engine/internal/config"
	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/llmclient"
)

type RecognizedDish struct {
	DishName     string   `json:"dish_name"`
	Cuisine      string   `json:"cuisine"`
	Confidence   float64  `json:"confidence"`
	Alternatives []string `json:"alternatives"`
}

type DishMatch struct {
	RestaurantID   string `json:"restaurant_id"`
	Dish           string `json:"dish"`
	PriceVND       int    `json:"price_vnd"`
	DistanceMeters *int   `json:"distanceMeters,omitempty"`
}

type RecognizeResponse struct {
	Recognized RecognizedDish `json:"recognized"`
	Matches    []DishMatch    `json:"matches"`
}

const dishRecognitionPrompt = `Đây là ảnh một món ăn Việt Nam. Hãy nhận diện tên món (tiếng Việt có dấu, dùng tên phổ biến như "Phở bò", "Bún chả", "Cơm tấm"...), loại ẩm thực, và độ tin cậy (0.0-1.0). Trả lời DUY NHẤT một JSON object, không thêm giải thích:
{"dish_name": "...", "cuisine": "...", "confidence": 0.0, "alternatives": ["...", "..."]}`

// RecognizeDish calls the vision LLM to identify a dish photo, cached by
// sha256(image bytes) under <KB_DIR>/cache/vision/<hash>.recognize.json.
var RecognizeDish = func(img []byte, mime string) (RecognizedDish, error) {
	cacheDir := filepath.Join(config.Or("KB_DIR", "build"), "cache", "vision")
	cachePath := filepath.Join(cacheDir, llmclient.Sha256Hex(img)+".recognize.json")
	if data, err := os.ReadFile(cachePath); err == nil {
		var cached RecognizedDish
		if json.Unmarshal(data, &cached) == nil {
			return cached, nil
		}
	}

	raw, err := llmclient.ChatVision([]llmclient.ChatMessage{
		llmclient.VisionMessage("user", dishRecognitionPrompt, base64.StdEncoding.EncodeToString(img), mime),
	})
	if err != nil {
		return RecognizedDish{}, err
	}

	var result RecognizedDish
	if err := json.Unmarshal([]byte(llmclient.ExtractJSON(raw)), &result); err != nil {
		return RecognizedDish{}, fmt.Errorf("vision: parse dish recognition: %w", err)
	}

	if err := os.MkdirAll(cacheDir, 0o755); err == nil {
		if data, err := json.Marshal(result); err == nil {
			_ = os.WriteFile(cachePath, data, 0o644)
		}
	}
	return result, nil
}

// MatchDishToPOIs fuzzy-matches a recognized dish name against every POI's
// menu, sorting by distance when the caller's location is known.
func MatchDishToPOIs(k *kb.KB, dishName string, lat, lon float64, haveLoc bool) []DishMatch {
	if dishName == "" || k == nil {
		return nil
	}
	target := kb.Norm(dishName)
	var matches []DishMatch
	for _, p := range k.POIs {
		for _, d := range p.Dishes {
			if !fuzzyDishMatch(kb.Norm(d.Name), target) {
				continue
			}
			m := DishMatch{RestaurantID: p.RestaurantID, Dish: d.Name, PriceVND: d.PriceVND}
			if haveLoc {
				meters := int(kb.Haversine(lat, lon, p.Lat, p.Lon))
				m.DistanceMeters = &meters
			}
			matches = append(matches, m)
			break // one match per POI
		}
	}
	if haveLoc {
		sort.Slice(matches, func(i, j int) bool {
			return *matches[i].DistanceMeters < *matches[j].DistanceMeters
		})
	}
	return matches
}

func fuzzyDishMatch(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return a == b || strings.Contains(a, b) || strings.Contains(b, a)
}

// --- menu OCR (internal/contribute's OCRMenu seam, wired by cmd/server) ---

const menuOCRPrompt = `Đây là ảnh chụp thực đơn (menu) quán ăn Việt Nam. Hãy trích xuất danh sách món ăn và giá tiền (VND). Trả lời DUY NHẤT một JSON array, không thêm giải thích:
[{"dish_name": "...", "price_vnd": 0}, ...]`

// OCRMenuImpl matches internal/contribute.OCRMenu's signature:
// func([]byte) ([]kb.Dish, error).
func OCRMenuImpl(img []byte) ([]kb.Dish, error) {
	cacheDir := filepath.Join(config.Or("KB_DIR", "build"), "cache", "vision")
	cachePath := filepath.Join(cacheDir, llmclient.Sha256Hex(img)+".ocr.json")
	if data, err := os.ReadFile(cachePath); err == nil {
		var cached []kb.Dish
		if json.Unmarshal(data, &cached) == nil {
			return cached, nil
		}
	}

	raw, err := llmclient.ChatVision([]llmclient.ChatMessage{
		llmclient.VisionMessage("user", menuOCRPrompt, base64.StdEncoding.EncodeToString(img), sniffMime(img)),
	})
	if err != nil {
		return nil, err
	}

	var items []struct {
		DishName string `json:"dish_name"`
		PriceVND int    `json:"price_vnd"`
	}
	if err := json.Unmarshal([]byte(llmclient.ExtractJSON(raw)), &items); err != nil {
		return nil, fmt.Errorf("vision: parse menu OCR: %w", err)
	}
	dishes := make([]kb.Dish, 0, len(items))
	for _, it := range items {
		if it.DishName == "" {
			continue
		}
		dishes = append(dishes, kb.Dish{Name: it.DishName, PriceVND: it.PriceVND, Tags: []string{}})
	}

	if err := os.MkdirAll(cacheDir, 0o755); err == nil {
		if data, err := json.Marshal(dishes); err == nil {
			_ = os.WriteFile(cachePath, data, 0o644)
		}
	}
	return dishes, nil
}

// SniffMime detects an image's MIME type from its bytes.
func SniffMime(img []byte) string { return sniffMime(img) }

func sniffMime(img []byte) string {
	return http.DetectContentType(img)
}
