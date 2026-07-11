// Package config centralizes env-var and .env-file handling, previously
// duplicated across llm.go, cmd/enrich, and cmd/embed (they couldn't import
// each other when everything was package main). Now that the engine is
// split into internal packages, every consumer imports this once.
package config

import (
	"bufio"
	"os"
	"strings"
)

// LoadDotEnv populates os.Setenv for KEY=VALUE lines not already set in the
// environment. A missing file is not an error. Call once per candidate path;
// existing env vars always win (never overwritten).
func LoadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, val)
		}
	}
}

// Or returns the env var's value, or def if unset/empty.
func Or(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
