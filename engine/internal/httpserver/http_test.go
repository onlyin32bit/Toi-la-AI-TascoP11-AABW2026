package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"tascop11/engine/internal/assistant"
	"tascop11/engine/internal/contribute"
	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/kb/kbfixture"
	"tascop11/engine/internal/llmclient"
	"tascop11/engine/internal/model"
)

// newTestServer builds a *Server with a hermetic in-memory KB and a
// throwaway contributions dir per test (no Postgres — db stays nil).
func newTestServer(t *testing.T) *Server {
	t.Helper()
	store := kbfixture.New()
	return &Server{
		kb:      store,
		contrib: contribute.New(t.TempDir(), store),
		hcmLoc:  time.UTC,
	}
}

func (s *Server) doGET(path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	switch {
	case path == "/health" || strings.HasPrefix(path, "/health?"):
		s.handleHealth(rec, req)
	case strings.HasPrefix(path, "/v1/recommend"):
		s.handleRecommend(rec, req)
	case strings.HasPrefix(path, "/v1/poi"):
		s.handlePOI(rec, req)
	case strings.HasPrefix(path, "/v1/compare"):
		s.handleCompare(rec, req)
	case strings.HasPrefix(path, "/v1/assistant"):
		s.handleAssistant(rec, req)
	}
	return rec
}

// --- /health ---------------------------------------------------------------

func TestHTTPHealth(t *testing.T) {
	s := newTestServer(t)
	rec := s.doGET("/health")
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

// --- /v1/recommend -----------------------------------------------------------

func TestHTTPRecommendOK(t *testing.T) {
	s := newTestServer(t)
	q := url.Values{}
	q.Set("q", "quán chay")
	q.Set("lat", "20.97")
	q.Set("lon", "107.08")
	rec := s.doGET("/v1/recommend?" + q.Encode())
	if rec.Code != http.StatusOK {
		t.Fatalf("recommend status = %d, want 200", rec.Code)
	}
	var resp model.RecommendResponse
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
	s := newTestServer(t)
	rec := s.doGET("/v1/recommend?" + url.Values{"q": {"Crystal BBQ có gì ngon"}}.Encode())
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

// --- /v1/poi -----------------------------------------------------------------

func TestHTTPPOIFoundAndMissing(t *testing.T) {
	s := newTestServer(t)
	if rec := s.doGET("/v1/poi?id=RESA"); rec.Code != http.StatusOK {
		t.Errorf("poi RESA status = %d, want 200", rec.Code)
	}
	rec := s.doGET("/v1/poi?id=ZZZ")
	if rec.Code != http.StatusNotFound {
		t.Errorf("poi ZZZ status = %d, want 404", rec.Code)
	}
	var er model.ErrorResponse
	json.Unmarshal(rec.Body.Bytes(), &er)
	if er.Error.Code != "not_found" {
		t.Errorf("error code = %q, want not_found", er.Error.Code)
	}
}

// --- /v1/compare ---------------------------------------------------------------

func TestHTTPCompare(t *testing.T) {
	s := newTestServer(t)
	rec := s.doGET("/v1/compare?ids=RESA,RESB,NOPE")
	if rec.Code != http.StatusOK {
		t.Fatalf("compare status = %d, want 200", rec.Code)
	}
	var resp model.CompareResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Items) != 2 {
		t.Errorf("compare items = %d, want 2", len(resp.Items))
	}
	if len(resp.NotFound) != 1 || resp.NotFound[0] != "NOPE" {
		t.Errorf("compare not_found = %v, want [NOPE]", resp.NotFound)
	}
}

func TestHTTPCompareMissingIDs(t *testing.T) {
	s := newTestServer(t)
	if rec := s.doGET("/v1/compare"); rec.Code != http.StatusBadRequest {
		t.Errorf("compare without ids = %d, want 400", rec.Code)
	}
}

// --- /v1/contribute ------------------------------------------------------------

func TestHTTPContributeAddsUGC(t *testing.T) {
	s := newTestServer(t)

	body := `{"name":"Quán Cơm Tấm Thử","lat":21.02,"lon":105.84,"city":"Hà Nội","price_level":"budget"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.handleContribute(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("contribute status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var pr model.PlaceResult
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
	hrec := s.doGET("/health")
	var h map[string]any
	json.Unmarshal(hrec.Body.Bytes(), &h)
	if h["ugc"].(float64) != 1 {
		t.Errorf("health ugc = %v, want 1 after contribute", h["ugc"])
	}
}

func TestHTTPContributeRejectsOutOfVN(t *testing.T) {
	s := newTestServer(t)
	body := `{"name":"Somewhere","lat":48.85,"lon":2.35}` // Paris
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	s.handleContribute(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("out-of-VN coords status = %d, want 400", rec.Code)
	}
}

func TestHTTPContributeMissingFields(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute", bytes.NewBufferString(`{"name":"No coords"}`))
	rec := httptest.NewRecorder()
	s.handleContribute(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("missing lat/lon status = %d, want 400", rec.Code)
	}
}

// --- /v1/contribute/menu (OCR seam not wired -> graceful degrade) ------------

func TestHTTPContributeMenuGracefulSeam(t *testing.T) {
	s := newTestServer(t)

	addReq := httptest.NewRequest(http.MethodPost, "/v1/contribute",
		bytes.NewBufferString(`{"name":"Quán Menu Thử","lat":21.02,"lon":105.84}`))
	addRec := httptest.NewRecorder()
	s.handleContribute(addRec, addReq)
	var created model.PlaceResult
	json.Unmarshal(addRec.Body.Bytes(), &created)

	var buf bytes.Buffer
	boundary := "TESTBOUNDARY"
	buf.WriteString("--" + boundary + "\r\n")
	buf.WriteString("Content-Disposition: form-data; name=\"poi_id\"\r\n\r\n")
	buf.WriteString(created.ID + "\r\n")
	buf.WriteString("--" + boundary + "\r\n")
	buf.WriteString("Content-Disposition: form-data; name=\"image\"; filename=\"menu.jpg\"\r\n")
	buf.WriteString("Content-Type: image/jpeg\r\n\r\n")
	buf.WriteString("fakebytes\r\n")
	buf.WriteString("--" + boundary + "--\r\n")

	req := httptest.NewRequest(http.MethodPost, "/v1/contribute/menu", &buf)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	rec := httptest.NewRecorder()
	s.handleContributeMenu(rec, req)

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
	s := newTestServer(t)
	orig := contribute.OCRMenu
	contribute.OCRMenu = func(img []byte) ([]kb.Dish, error) {
		return []kb.Dish{{Name: "Phở bò", PriceVND: 50000}}, nil
	}
	defer func() { contribute.OCRMenu = orig }()

	addRec := httptest.NewRecorder()
	s.handleContribute(addRec,
		httptest.NewRequest(http.MethodPost, "/v1/contribute",
			bytes.NewBufferString(`{"name":"Quán OCR Thử","lat":21.02,"lon":105.84}`)))
	var created model.PlaceResult
	json.Unmarshal(addRec.Body.Bytes(), &created)

	var buf bytes.Buffer
	b := "B2"
	buf.WriteString("--" + b + "\r\nContent-Disposition: form-data; name=\"poi_id\"\r\n\r\n" + created.ID + "\r\n")
	buf.WriteString("--" + b + "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"m.jpg\"\r\nContent-Type: image/jpeg\r\n\r\nX\r\n")
	buf.WriteString("--" + b + "--\r\n")
	req := httptest.NewRequest(http.MethodPost, "/v1/contribute/menu", &buf)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+b)
	rec := httptest.NewRecorder()
	s.handleContributeMenu(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("wired OCR status = %d, want 200", rec.Code)
	}
	var body struct {
		Dishes []kb.Dish `json:"dishes"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Dishes) != 1 || body.Dishes[0].Name != "Phở bò" {
		t.Errorf("wired OCR dishes = %+v, want [Phở bò]", body.Dishes)
	}
}

// --- /v1/assistant -------------------------------------------------------------

func TestHTTPAssistantCrystalBBQNotFound(t *testing.T) {
	s := newTestServer(t)
	rec := s.doGET("/v1/assistant?" + url.Values{"q": {"Crystal BBQ có gì ngon"}}.Encode())
	if rec.Code != http.StatusOK {
		t.Fatalf("assistant status = %d, want 200 (honest not_found, not error)", rec.Code)
	}
	var body assistant.NotFound
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("assistant body not assistant.NotFound: %v", err)
	}
	if body.Answer != "not_found" {
		t.Errorf("answer = %q, want not_found", body.Answer)
	}
	if !strings.Contains(body.Message, "Crystal BBQ") {
		t.Errorf("message = %q, want it to mention Crystal BBQ", body.Message)
	}
}

func TestHTTPAssistantMissingQuery(t *testing.T) {
	s := newTestServer(t)
	rec := s.doGET("/v1/assistant")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("assistant without q status = %d, want 400", rec.Code)
	}
}

func TestHTTPAssistantWired(t *testing.T) {
	s := newTestServer(t)
	orig := llmclient.ChatText
	llmclient.ChatText = func(messages []llmclient.ChatMessage) (string, error) {
		return "Phở Bếp Nhà nổi bật với món Phở bò tái, phù hợp gia đình.", nil
	}
	defer func() { llmclient.ChatText = orig }()

	rec := s.doGET("/v1/assistant?" + url.Values{"q": {"Phở Bếp Nhà có món gì ngon?"}}.Encode())
	if rec.Code != http.StatusOK {
		t.Fatalf("assistant status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body assistant.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("assistant body not assistant.Response: %v", err)
	}
	if body.Answer == "" {
		t.Errorf("answer is empty")
	}
	if body.POIID != "poi:resa" {
		t.Errorf("poi_id = %q, want poi:resa", body.POIID)
	}
	if len(body.Sources) == 0 {
		t.Errorf("sources is empty, want at least one citation")
	}
}

// --- auth/contexts: DB not configured -> feature_disabled, never a panic -----

func TestHTTPAuthFeatureDisabledWithoutDB(t *testing.T) {
	s := newTestServer(t) // db is nil
	for _, path := range []string{"/v1/auth/signup", "/v1/auth/login", "/v1/auth/logout"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
		rec := httptest.NewRecorder()
		switch path {
		case "/v1/auth/signup":
			s.handleSignup(rec, req)
		case "/v1/auth/login":
			s.handleLogin(rec, req)
		case "/v1/auth/logout":
			s.handleLogout(rec, req)
		}
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s without DB status = %d, want 503", path, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	s.handleMe(rec, httptest.NewRequest(http.MethodGet, "/v1/me", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("/v1/me without DB status = %d, want 503", rec.Code)
	}
	rec2 := httptest.NewRecorder()
	s.handleContexts(rec2, httptest.NewRequest(http.MethodGet, "/v1/contexts", nil))
	if rec2.Code != http.StatusServiceUnavailable {
		t.Errorf("/v1/contexts without DB status = %d, want 503", rec2.Code)
	}
}
