package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// SavedContext mirrors SYSTEM_FLOW.md §2's driver preference schema
// (stated/ctx/learned) as a named, savable, re-selectable profile —
// "saved injected contexts": pick one later to inject as CTX for a query.
type SavedContext struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Name      string          `json:"name"`
	Stated    json.RawMessage `json:"stated"`
	CTX       json.RawMessage `json:"ctx"`
	Learned   json.RawMessage `json:"learned"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func (d *DB) SaveContext(ctx context.Context, userID, name string, stated, ctxData, learned json.RawMessage) (*SavedContext, error) {
	stated, ctxData, learned = defaultJSON(stated), defaultJSON(ctxData), defaultJSON(learned)
	sc := &SavedContext{}
	row := d.sql.QueryRowContext(ctx,
		`INSERT INTO saved_contexts (user_id, name, stated, ctx, learned) VALUES ($1,$2,$3,$4,$5)
		 RETURNING id, user_id, name, stated, ctx, learned, created_at, updated_at`,
		userID, name, stated, ctxData, learned)
	if err := row.Scan(&sc.ID, &sc.UserID, &sc.Name, &sc.Stated, &sc.CTX, &sc.Learned, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
		return nil, err
	}
	return sc, nil
}

func (d *DB) ListContexts(ctx context.Context, userID string) ([]SavedContext, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT id, user_id, name, stated, ctx, learned, created_at, updated_at
		 FROM saved_contexts WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SavedContext{}
	for rows.Next() {
		var sc SavedContext
		if err := rows.Scan(&sc.ID, &sc.UserID, &sc.Name, &sc.Stated, &sc.CTX, &sc.Learned, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

func (d *DB) GetContext(ctx context.Context, userID, contextID string) (*SavedContext, error) {
	sc := &SavedContext{}
	row := d.sql.QueryRowContext(ctx,
		`SELECT id, user_id, name, stated, ctx, learned, created_at, updated_at
		 FROM saved_contexts WHERE id=$1 AND user_id=$2`, contextID, userID)
	if err := row.Scan(&sc.ID, &sc.UserID, &sc.Name, &sc.Stated, &sc.CTX, &sc.Learned, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return sc, nil
}

// BehaviorSignal extracts the repeat-visit/cuisine-affinity subset of this
// context's "learned" JSON, for internal/rerank's S_behavior factor (§5.3).
func (sc *SavedContext) BehaviorSignal() (repeatPOIIDs []string, cuisineAffinity map[string]float64) {
	var learned struct {
		RepeatPOIs      []string           `json:"repeat_pois"`
		CuisineAffinity map[string]float64 `json:"cuisine_affinity"`
	}
	_ = json.Unmarshal(sc.Learned, &learned)
	return learned.RepeatPOIs, learned.CuisineAffinity
}

func defaultJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("{}")
	}
	return raw
}
