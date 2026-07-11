package httpserver

import (
	"io"
	"net/http"

	"tascop11/engine/internal/vision"
)

func (s *Server) handleDishesRecognize(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Form multipart không hợp lệ", nil)
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu ảnh (image)", nil)
		return
	}
	defer file.Close()
	imgBytes, err := io.ReadAll(file)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Không đọc được ảnh", nil)
		return
	}

	recognized, err := vision.RecognizeDish(imgBytes, vision.SniffMime(imgBytes))
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "vision_unavailable", "Nhận diện món ăn tạm thời không khả dụng", err.Error())
		return
	}

	q := r.URL.Query()
	lat, latOK := parseFloat(q.Get("lat"))
	lon, lonOK := parseFloat(q.Get("lon"))
	haveLoc := latOK && lonOK

	writeJSON(w, r, http.StatusOK, vision.RecognizeResponse{
		Recognized: recognized,
		Matches:    vision.MatchDishToPOIs(s.kb, recognized.DishName, lat, lon, haveLoc),
	})
}
