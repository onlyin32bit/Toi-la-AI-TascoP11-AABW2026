// Command seed inserts demo/test accounts into Postgres for local testing
// and demos (internal/db/seed.sql). Requires DATABASE_URL. Safe to rerun —
// every insert is idempotent. Run: `go run ./cmd/seed` (or `make seed-db`).
package main

import (
	"context"
	"log"
	"os"
	"time"

	"tascop11/engine/internal/config"
	"tascop11/engine/internal/db"
)

func main() {
	config.LoadDotEnv(".env")
	config.LoadDotEnv("../.env")

	if !db.Enabled() {
		log.Fatal("DATABASE_URL not set — nothing to seed (see .env.example)")
	}

	database, err := db.Connect(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := database.Migrate(ctx); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if err := database.Seed(ctx); err != nil {
		log.Fatalf("seed: %v", err)
	}

	log.Println("seeded demo accounts (password for all: demo1234):")
	log.Println("  demo.family@tascomaps.vn       — has a saved context (§5.3 S_behavior demo)")
	log.Println("  demo.contributor@tascomaps.vn  — owns the seeded UGC contributions")
	log.Println("  demo.admin@tascomaps.vn")
	log.Println("login: POST /v1/auth/login {\"email\":\"...\",\"password\":\"demo1234\"}")
}
