// Package db is the optional Postgres layer: end-user accounts, sessions,
// UGC contributor attribution, and saved trip contexts (SYSTEM_FLOW.md §2
// stated/ctx/learned). It follows the same optional/additive pattern as
// internal/vectordb: Enabled() gates every call site, and an absent/down
// Postgres must never break the core recommend/contribute paths, which stay
// on the existing flat-file storage regardless of DATABASE_URL.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

//go:embed seed.sql
var seedSQL string

// DB wraps a Postgres connection pool.
type DB struct {
	sql *sql.DB
}

// Enabled reports whether Postgres is configured at all.
func Enabled() bool {
	return os.Getenv("DATABASE_URL") != ""
}

// Connect opens and pings a Postgres connection. Callers should treat any
// error as "run without the DB layer" (log and continue), not a fatal boot
// error — see Enabled()'s doc comment.
func Connect(databaseURL string) (*DB, error) {
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return &DB{sql: sqlDB}, nil
}

func (d *DB) Close() error { return d.sql.Close() }

// Migrate applies every migrations/*.sql file in order. Idempotent
// (CREATE ... IF NOT EXISTS everywhere) — safe to call on every boot.
func (d *DB) Migrate(ctx context.Context) error {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, e := range entries {
		b, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return err
		}
		if _, err := d.sql.ExecContext(ctx, string(b)); err != nil {
			return fmt.Errorf("db: migrate %s: %w", e.Name(), err)
		}
	}
	return nil
}

// Seed inserts demo/test accounts + a sample saved context (seed.sql). Not
// called by Migrate/server boot — explicit opt-in via `go run ./cmd/seed`,
// since auto-creating test accounts on every server start would be surprising
// for anyone pointing DATABASE_URL at a real deployment. Requires Migrate to
// have run first (schema + pgcrypto). Idempotent (fixed ids, ON CONFLICT DO NOTHING).
func (d *DB) Seed(ctx context.Context) error {
	if _, err := d.sql.ExecContext(ctx, seedSQL); err != nil {
		return fmt.Errorf("db: seed: %w", err)
	}
	return nil
}
