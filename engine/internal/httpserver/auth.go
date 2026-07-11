package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"tascop11/engine/internal/db"
)

// dbUnavailable renders a consistent "feature not configured" response for
// every DB-backed route when DATABASE_URL is unset — same pattern as
// internal/vectordb's optional-layer degrade, applied to auth/contexts.
func (s *Server) dbUnavailable(w http.ResponseWriter, r *http.Request) bool {
	if s.db != nil {
		return false
	}
	writeError(w, r, http.StatusServiceUnavailable, "feature_disabled", "Tài khoản người dùng chưa được cấu hình (DATABASE_URL trống)", nil)
	return true
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if strings.HasPrefix(h, prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}

// currentUser resolves the caller's user from the Authorization header.
// Returns (nil, nil) for "no/invalid token" (anonymous) — every route using
// this treats that as anonymous, not an error, since auth is optional
// everywhere except the /v1/me and /v1/contexts routes that require it.
func (s *Server) currentUser(r *http.Request) (*db.User, error) {
	if s.db == nil {
		return nil, nil
	}
	tok := bearerToken(r)
	if tok == "" {
		return nil, nil
	}
	u, err := s.db.UserByToken(r.Context(), tok)
	if err != nil {
		if errors.Is(err, db.ErrSessionExpired) {
			return nil, nil
		}
		return nil, err
	}
	return u, nil
}

type signupReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	if s.dbUnavailable(w, r) {
		return
	}
	var req signupReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || req.Password == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu email hoặc password", nil)
		return
	}
	user, err := s.db.SignUp(r.Context(), req.Email, req.Password, req.DisplayName)
	if err != nil {
		if errors.Is(err, db.ErrEmailTaken) {
			writeError(w, r, http.StatusBadRequest, "invalid_request", "Email đã được đăng ký", nil)
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal", "Không tạo được tài khoản", err.Error())
		return
	}
	writeJSON(w, r, http.StatusCreated, user)
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.dbUnavailable(w, r) {
		return
	}
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Body JSON không hợp lệ", nil)
		return
	}
	token, user, err := s.db.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, db.ErrInvalidCredentials) {
			writeError(w, r, http.StatusUnauthorized, "unauthorized", "Email hoặc mật khẩu không đúng", nil)
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal", "Không đăng nhập được", err.Error())
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if s.dbUnavailable(w, r) {
		return
	}
	tok := bearerToken(r)
	if tok == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu Authorization: Bearer <token>", nil)
		return
	}
	if err := s.db.Logout(r.Context(), tok); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal", "Không đăng xuất được", err.Error())
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if s.dbUnavailable(w, r) {
		return
	}
	user, err := s.requireUser(w, r)
	if err != nil {
		return // requireUser already wrote the error response
	}
	writeJSON(w, r, http.StatusOK, user)
}

// requireUser resolves the caller's user or writes a 401 and returns an
// error the caller should treat as "response already sent, stop handling".
func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (*db.User, error) {
	user, err := s.currentUser(r)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal", "Không xác thực được", err.Error())
		return nil, err
	}
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "Cần đăng nhập (Authorization: Bearer <token>)", nil)
		return nil, errors.New("unauthorized")
	}
	return user, nil
}
