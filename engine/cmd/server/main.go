// Command server is the engine's HTTP entrypoint. It only wires
// dependencies together — all logic lives in the internal/ packages.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"tascop11/engine/internal/config"
	"tascop11/engine/internal/contribute"
	"tascop11/engine/internal/db"
	"tascop11/engine/internal/enrich"
	"tascop11/engine/internal/httpserver"
	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/vision"
)

func main() {
	config.LoadDotEnv(".env")
	config.LoadDotEnv("../.env")

	port := config.Or("PORT", "8000")
	kbDir := config.Or("KB_DIR", "build")
	uiDist := os.Getenv("UI_DIST")

	hcmLoc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		hcmLoc = time.FixedZone("ICT", 7*3600)
	}

	store, err := kb.LoadKB(kbDir, true)
	if err != nil {
		log.Fatalf("load kb: %v", err)
	}
	contribStore := contribute.New(kbDir, store)
	log.Printf("loaded %d POIs (%d benchmark, %d ugc) from %s",
		len(store.POIs), countSource(store, "tasco_csv"), countSource(store, "user_contributed"), kbDir)

	// internal/vision -> internal/contribute wiring: explicit here (not an
	// init()-side-effect import cycle) so the dependency is visible in one place.
	contribute.OCRMenu = vision.OCRMenuImpl

	// Optional Postgres layer (internal/db). Absent/down => log and continue;
	// every DB-backed route degrades to a clear "feature_disabled" response
	// (internal/httpserver/auth.go's dbUnavailable) instead of failing boot.
	var database *db.DB
	if db.Enabled() {
		database, err = db.Connect(os.Getenv("DATABASE_URL"))
		if err != nil {
			log.Printf("postgres unavailable, running without user/auth/context features: %v", err)
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			migrateErr := database.Migrate(ctx)
			cancel()
			if migrateErr != nil {
				log.Printf("postgres migrate failed, running without user/auth/context features: %v", migrateErr)
				database.Close()
				database = nil
			} else {
				log.Printf("postgres connected + migrated")
				defer database.Close()
			}
		}
	}

	// Optional Apify-backed enrichment layer. Absent APIFY_TOKEN => route
	// serves 503 feature_disabled, boot continues (mirrors the DB path).
	var enrichEngine *enrich.Engine
	if e, err := enrich.NewEngine(); err != nil {
		log.Printf("enrich disabled (%v)", err)
	} else {
		enrichEngine = e
		log.Printf("enrich enabled (apify google places)")
	}

	handler := httpserver.New(httpserver.Deps{
		KB:      store,
		Contrib: contribStore,
		DB:      database,
		Enrich:  enrichEngine,
		HCMLoc:  hcmLoc,
		UIDist:  uiDist,
	})

	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

func countSource(k *kb.KB, src string) int {
	n := 0
	for _, p := range k.POIs {
		if p.Source == src {
			n++
		}
	}
	return n
}
