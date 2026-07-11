package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// setupServer initializes the package-level globals the HTTP handlers rely on,
// with a hermetic in-memory KB and a throwaway contributions dir per test.
func setupServer(t *testing.T) {
	t.Helper()
	kb = testKB()
	hcmLoc = time.UTC
	contrib = NewContribStore(t.TempDir(), kb)
}

func doGET(path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	// route manually (mirror main.go mux wiring)
	switch {
	case path == "/health" || strings.HasPrefix(path, "/health?"):
		handleHealth(rec, req)
	case strings.HasPrefix(path, "/v1/recommend"):
		handleRecommend(rec, req)
	case strings.HasPrefix(path, "/v1/poi"):
		handlePOI(rec, req)
	case strings.HasPrefix(path, "/v1/compare"):
		handleCompare(rec, req)
	case strings.HasPrefix(path, "/v1/assistant"):
		handleNotImplemented(rec, req)
	}
	return rec
}

// --- /health ---------------------------------------------------------------

func TestHTTPHealth(t *testing.T) {
	setupServer(t)
	rec := doGET("/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("health body not JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("health status field = %v, want ok", body["status"])
	}
	if body["pois"].(float64) != 4 {
		t.Errorf("health pois = %v, want 4", body["pois"])
	}
}

// --- /v1/recommend ---------------------------------------------------------

func TestHTTPRecommendOK(t *testing.T) {
	setupServer(t)
	q := url.Values{}
	q.Set("q", "quán chay")
	q.Set("lat", "20.97")
	q.Set("lon", "107.08")
	rec := doGET("/v1/recommend?" + q.Encode())
	if rec.Code != http.StatusOK {
		t.Fatalf("recommend status = %d, want 200", rec.Code)
	}
	var resp RecommendResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("recommend body not RecommendResponse: %v", err)
	}
	if len(resp.Results) == 0 {
		t.Fatalf("recommend returned no results for 'quán chay'")
	}
	// Vegetarian POI (RESC) must be present and carry a why breakdown + distance.
	var found bool
	for _, r := range resp.Results {
		if r.ID == "poi:resc" {
			found = true
			if r.DistanceMeters == nil {
				t.Errorf("distanceMeters must be set when lat/lon given")
			}
			if r.Meta.Why.Final <= 0 {
				t.Errorf("why.final must be > 0, got %v", r.Meta.Why.Final)
			}
		}
	}
	if !found {
		t.Errorf("vegetarian POI RESC not in results")
	}
}

func TestHTTPRecommendCrystalBBQNotFound(t *testing.T) {
	setupServer(t)
	rec := doGET("/v1/recommend?" + url.Values{"q": {"Crystal BBQ có gì ngon"}}.Encode())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (honest not_found, not error)", rec.Code)
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body["status"] != "not_found" {
		t.Errorf("status field = %v, want not_found", body["status"])
	}
	if body["query_entity"] != "Crystal BBQ" {
		t.Errorf("query_entity = %v, want 'Crystal BBQ'", body["query_entity"])
	}
}

// --- /v1/poi ---------------------------------------------------------------

func TestHTTPPOIFoundAndMissing(t *testing.T) {
	setupServer(t)
	if rec := doGET("/v1/poi?id=RESA"); rec.Code != http.StatusOK {
		t.Errorf("poi RESA status = %d, want 200", rec.Code)
	}
	rec := doGET("/v1/poi?id=ZZZ")
	if rec.Code != http.StatusNotFound {
		t.Errorf("poi ZZZ status = %d, want 404", rec.Code)
	}
	var er ErrorResponse
	json.Unmarshal(rec.Body.Bytes(), &er)
	if er.Error.Code != "not_found" {
		t.Errorf("error code = %q, want not_found", er.Error.Code)
	}
}

// --- /v1/compare -----------------------------------------------------------

func TestHTTPCompare(t *testing.T) {
	setupServer(t)
	rec := doGET("/v1/compare?ids=RESA,RESB,NOPE")
	if rec.Code != http.StatusOK {
		t.Fatalf("compare status = %d, want 200", rec.Code)
	}
	var resp CompareResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Items) != 2 {
		t.Errorf("compare items = %d, want 2", len(resp.Items))
	}
	if len(resp.NotFound) != 1 || resp.NotFound[0] != "NOPE" {
		t.Errorf("compare not_found = %v, want [NOPE]", resp.NotFound)
	}
}

func TestHTTPCompareMissingIDs(t *testing.T) {
	setupServer(t)
	if rec := doGET("/v1/compare"); rec.Code != http.StatusBadRequest {
		t.Errorf("compare without ids = %d, want 400", rec.Code)
	}
}

// --- /v1/contribute --------------------------------------------------------

func TestHTTPContributeAddsUGC(t *testing.T) {
	setupServer(t)

	body := `{"name":"Quán Cơm Tấm Thử","lat":21.02,"lon":105.84,"city":"Hà Nội","price_level":"budget"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	contrib.HandleContribute(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("contribute status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var pr PlaceResult
	if err := json.Unmarshal(rec.Body.Bytes(), &pr); err != nil {
		t.Fatalf("contribute body not PlaceResult: %v", err)
	}
	if pr.Source != "user_contributed" || pr.Meta.Verified {
		t.Errorf("UGC POI must be source=user_contributed, verified=false; got %q / %v", pr.Source, pr.Meta.Verified)
	}
	if !strings.HasPrefix(pr.ID, "ugc:") {
		t.Errorf("UGC id = %q, want ugc: prefix", pr.ID)
	}

	// Now it should appear in the KB (health ugc count = 1).
	hrec := doGET("/health")
	var h map[string]any
	json.Unmarshal(hrec.Body.Bytes(), &h)
	if h["ugc"].(float64) != 1 {
		t.Errorf("health ugc = %v, want 1 after contribute", h["ugc"])
	}
}

func TestHTTPContributeRejectsOutOfVN(t *testing.T) {
	setupServer(t)
	body := `{"name":"Somewhere","lat":48.85,"lon":2.35}` // Paris
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	contrib.HandleContribute(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("out-of-VN coords status = %d, want 400", rec.Code)
	}
}

func TestHTTPContributeMissingFields(t *testing.T) {
	setupServer(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute", bytes.NewBufferString(`{"name":"No coords"}`))
	rec := httptest.NewRecorder()
	contrib.HandleContribute(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("missing lat/lon status = %d, want 400", rec.Code)
	}
}

// --- /v1/contribute/menu (OCR seam not wired -> graceful degrade) ----------

func TestHTTPContributeMenuGracefulSeam(t *testing.T) {
	setupServer(t)

	// First add a UGC POI to attach a menu to.
	addReq := httptest.NewRequest(http.MethodPost, "/v1/contribute",
		bytes.NewBufferString(`{"name":"Quán Menu Thử","lat":21.02,"lon":105.84}`))
	addRec := httptest.NewRecorder()
	contrib.HandleContribute(addRec, addReq)
	var created PlaceResult
	json.Unmarshal(addRec.Body.Bytes(), &created)

	// Build a multipart form with poi_id + a dummy image.
	var buf bytes.Buffer
	boundary := "TESTBOUNDARY"
	w := &buf
	w.WriteString("--" + boundary + "\r\n")
	w.WriteString("Content-Disposition: form-data; name=\"poi_id\"\r\n\r\n")
	w.WriteString(created.ID + "\r\n")
	w.WriteString("--" + boundary + "\r\n")
	w.WriteString("Content-Disposition: form-data; name=\"image\"; filename=\"menu.jpg\"\r\n")
	w.WriteString("Content-Type: image/jpeg\r\n\r\n")
	w.WriteString("fakebytes\r\n")
	w.WriteString("--" + boundary + "--\r\n")

	req := httptest.NewRequest(http.MethodPost, "/v1/contribute/menu", &buf)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	rec := httptest.NewRecorder()
	contrib.HandleContributeMenu(rec, req)

	// OCRMenu seam returns an error by default -> graceful 200 with note.
	if rec.Code != http.StatusOK {
		t.Fatalf("contribute/menu status = %d, want 200 (graceful seam); body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body["needs_confirm"] != true {
		t.Errorf("needs_confirm = %v, want true", body["needs_confirm"])
	}
	if body["note"] != "OCR chưa nối" {
		t.Errorf("note = %v, want 'OCR chưa nối'", body["note"])
	}
}

func TestHTTPContributeMenuWiredOCR(t *testing.T) {
	setupServer(t)
	// Temporarily wire the OCRMenu seam (simulate DEV3's vision.go).
	orig := OCRMenu
	OCRMenu = func(img []byte) ([]Dish, error) {
		return []Dish{{Name: "Phở bò", PriceVND: 50000}}, nil
	}
	defer func() { OCRMenu = orig }()

	addRec := httptest.NewRecorder()
	contrib.HandleContribute(addRec,
		httptest.NewRequest(http.MethodPost, "/v1/contribute",
			bytes.NewBufferString(`{"name":"Quán OCR Thử","lat":21.02,"lon":105.84}`)))
	var created PlaceResult
	json.Unmarshal(addRec.Body.Bytes(), &created)

	var buf bytes.Buffer
	b := "B2"
	buf.WriteString("--" + b + "\r\nContent-Disposition: form-data; name=\"poi_id\"\r\n\r\n" + created.ID + "\r\n")
	buf.WriteString("--" + b + "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"m.jpg\"\r\nContent-Type: image/jpeg\r\n\r\nX\r\n")
	buf.WriteString("--" + b + "--\r\n")
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute/menu", &buf)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+b)
	rec := httptest.NewRecorder()
	contrib.HandleContributeMenu(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("wired OCR status = %d, want 200", rec.Code)
	}
	var body struct {
		Dishes []Dish `json:"dishes"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Dishes) != 1 || body.Dishes[0].Name != "Phở bò" {
		t.Errorf("wired OCR dishes = %+v, want [Phở bò]", body.Dishes)
	}
}

// --- /v1/assistant stub ----------------------------------------------------

func TestHTTPAssistantStub501(t *testing.T) {
	setupServer(t)
	rec := doGET("/v1/assistant?q=hi")
	if rec.Code != http.StatusNotImplemented {
		t.Errorf("assistant status = %d, want 501", rec.Code)
	}
}
