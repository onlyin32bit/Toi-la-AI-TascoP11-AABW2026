// Package apify is a thin HTTP client for the Apify actor REST API.
// Mirrors preprocess/apify_actor_client.py — same auth (APIFY_TOKEN),
// same run-sync-get-dataset-items endpoint, same never-log-the-token
// discipline. Kept minimal on purpose: no SDK dependency, no retry
// bookkeeping — the caller decides timeouts and error handling.
package apify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ErrMissingToken is returned by New when APIFY_TOKEN is not set. Callers
// (cmd/server) treat this as "enrich disabled" rather than a hard failure.
var ErrMissingToken = errors.New("APIFY_TOKEN not set")

// GooglePlacesActorID is the actor slug for Apify's Google Maps Places
// crawler. Matches preprocess/apify_places_client.py exactly.
const GooglePlacesActorID = "compass~crawler-google-places"

// RunActorInput is the arbitrary JSON body the Apify actor expects.
type RunActorInput = map[string]any

// RunActorResult is the raw dataset items returned by an actor run.
// Kept as []map[string]any so mappers can decode fields on demand.
type RunActorResult = []map[string]any

// Client wraps *http.Client + the Apify bearer token. Safe for concurrent use.
type Client struct {
	token      string
	httpClient *http.Client
}

// New reads APIFY_TOKEN from env and returns a ready client. Returns
// ErrMissingToken (not a startup failure) so cmd/server can log-and-continue
// when the token is intentionally omitted.
func New() (*Client, error) {
	token := os.Getenv("APIFY_TOKEN")
	if token == "" {
		return nil, ErrMissingToken
	}
	return &Client{
		token:      token,
		httpClient: &http.Client{Timeout: 3 * time.Minute},
	}, nil
}

// RunActor calls run-sync-get-dataset-items and returns the raw items.
// The upstream timeout is passed as `?timeout=` (in seconds) on the URL;
// context.Context governs the outer request timeout on our side.
func (c *Client) RunActor(ctx context.Context, actorID string, input RunActorInput, upstreamTimeoutSec int) (RunActorResult, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("marshal input: %w", err)
	}
	url := fmt.Sprintf(
		"https://api.apify.com/v2/acts/%s/run-sync-get-dataset-items?timeout=%d",
		actorID, upstreamTimeoutSec,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apify request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		buf, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf(
			"apify actor %s HTTP %d: %s",
			actorID, resp.StatusCode, truncate(string(buf), 500),
		)
	}

	var items RunActorResult
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("decode apify response: %w", err)
	}
	return items, nil
}

// GooglePlacesOptions groups the tunable knobs of the Google Places actor.
// Zero values fall back to sensible defaults (vi language, 3 places, 5 reviews).
type GooglePlacesOptions struct {
	LocationQuery string
	Language      string
	MaxPerSearch  int
	MaxReviews    int
}

// RunGooglePlaces is a typed wrapper for the compass~crawler-google-places
// actor — matches the Python helper's payload 1:1.
func (c *Client) RunGooglePlaces(ctx context.Context, searchTerms []string, opts GooglePlacesOptions, upstreamTimeoutSec int) (RunActorResult, error) {
	if opts.Language == "" {
		opts.Language = "vi"
	}
	if opts.MaxPerSearch == 0 {
		opts.MaxPerSearch = 3
	}
	if opts.MaxReviews == 0 {
		opts.MaxReviews = 5
	}
	input := RunActorInput{
		"searchStringsArray":        searchTerms,
		"locationQuery":             opts.LocationQuery,
		"maxCrawledPlacesPerSearch": opts.MaxPerSearch,
		"language":                  opts.Language,
		"maxReviews":                opts.MaxReviews,
		"skipClosedPlaces":          true,
	}
	return c.RunActor(ctx, GooglePlacesActorID, input, upstreamTimeoutSec)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
