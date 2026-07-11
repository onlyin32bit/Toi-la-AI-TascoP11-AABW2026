package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrEmailTaken         = errors.New("db: email already registered")
	ErrInvalidCredentials = errors.New("db: invalid email or password")
	ErrSessionExpired     = errors.New("db: session expired or invalid")
)

const sessionTTL = 30 * 24 * time.Hour

// User is an end-user account (Tasco Maps app) or a UGC contributor.
type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

// SignUp creates a new account. Password is bcrypt-hashed, never stored raw.
func (d *DB) SignUp(ctx context.Context, email, password, displayName string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	u := &User{}
	row := d.sql.QueryRowContext(ctx,
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3)
		 RETURNING id, email, display_name, role, created_at`,
		email, string(hash), displayName)
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.CreatedAt); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		return nil, err
	}
	return u, nil
}

// Login verifies credentials and mints a new opaque bearer token. Only the
// token's SHA-256 hash is persisted (sessions.token_hash) — the raw token is
// returned once and never stored, same principle as a password hash.
func (d *DB) Login(ctx context.Context, email, password string) (token string, user *User, err error) {
	var hash string
	u := &User{}
	row := d.sql.QueryRowContext(ctx,
		`SELECT id, email, password_hash, display_name, role, created_at FROM users WHERE email=$1`, email)
	if err := row.Scan(&u.ID, &u.Email, &hash, &u.DisplayName, &u.Role, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil, ErrInvalidCredentials
		}
		return "", nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", nil, ErrInvalidCredentials
	}

	tok, tokHash := newToken()
	if _, err := d.sql.ExecContext(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		u.ID, tokHash, time.Now().Add(sessionTTL)); err != nil {
		return "", nil, err
	}
	return tok, u, nil
}

// Logout revokes a session token.
func (d *DB) Logout(ctx context.Context, token string) error {
	_, err := d.sql.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=$1`, hashToken(token))
	return err
}

// UserByToken resolves a bearer token to its (non-expired) user, or
// ErrSessionExpired. httpserver's auth middleware calls this per-request.
func (d *DB) UserByToken(ctx context.Context, token string) (*User, error) {
	u := &User{}
	row := d.sql.QueryRowContext(ctx,
		`SELECT u.id, u.email, u.display_name, u.role, u.created_at
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash=$1 AND s.expires_at > now()`, hashToken(token))
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSessionExpired
		}
		return nil, err
	}
	return u, nil
}

func newToken() (token, hash string) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token = hex.EncodeToString(b)
	return token, hashToken(token)
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
