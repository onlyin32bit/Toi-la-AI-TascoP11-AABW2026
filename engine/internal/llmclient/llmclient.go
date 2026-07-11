// Package llmclient is the single Qwen/DashScope (or any OpenAI-compatible
// provider) chat+vision+embedding client. Swapping provider is a .env edit
// (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL/LLM_VL_MODEL), never a code change.
// Cache-first to disk so the demo never depends on network availability.
package llmclient

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"tascop11/engine/internal/config"
)

func init() {
	config.LoadDotEnv(".env")
	config.LoadDotEnv("../.env")
}

// --- OpenAI-compatible chat-completions wire types ---

type ImageURL struct {
	URL string `json:"url"`
}

// ContentPart is one part of a multimodal message (vision).
type ContentPart struct {
	Type     string    `json:"type"` // "text" | "image_url"
	Text     string    `json:"text,omitempty"`
	ImageURL *ImageURL `json:"image_url,omitempty"`
}

// ChatMessage.Content is either a plain string (text-only) or []ContentPart (vision).
type ChatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

func TextMessage(role, text string) ChatMessage {
	return ChatMessage{Role: role, Content: text}
}

func VisionMessage(role, text, imgB64, mime string) ChatMessage {
	return ChatMessage{
		Role: role,
		Content: []ContentPart{
			{Type: "text", Text: text},
			{Type: "image_url", ImageURL: &ImageURL{URL: "data:" + mime + ";base64," + imgB64}},
		},
	}
}

// --- config ---

type llmConfig struct {
	baseURL string
	apiKey  string
	model   string
	vlModel string
}

func loadLLMConfig() llmConfig {
	return llmConfig{
		baseURL: config.Or("LLM_BASE_URL", config.Or("DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")),
		apiKey:  config.FirstNonEmpty(os.Getenv("LLM_API_KEY"), os.Getenv("DASHSCOPE_API_KEY")),
		model:   config.Or("LLM_MODEL", config.Or("QWEN_MODEL", "qwen-plus")),
		vlModel: config.Or("LLM_VL_MODEL", config.Or("QWEN_VL_MODEL", "qwen-vl-plus")),
	}
}

// --- client (var seams so tests can override without touching HTTP) ---

var ChatText = func(messages []ChatMessage) (string, error) {
	cfg := loadLLMConfig()
	return chatComplete(cfg, cfg.model, messages)
}

var ChatVision = func(messages []ChatMessage) (string, error) {
	cfg := loadLLMConfig()
	return chatComplete(cfg, cfg.vlModel, messages)
}

var httpClient = &http.Client{Timeout: 45 * time.Second}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
}

type chatCompletionResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// chatComplete is cache-first: identical (model, messages) always resolves
// from disk once seen, so repeated demo queries are instant and offline-safe.
func chatComplete(cfg llmConfig, model string, messages []ChatMessage) (string, error) {
	cacheDir := filepath.Join(config.Or("KB_DIR", "build"), "cache", "llm")
	cachePath := filepath.Join(cacheDir, cacheKey(model, messages)+".txt")
	if data, err := os.ReadFile(cachePath); err == nil {
		return string(data), nil
	}

	if cfg.apiKey == "" {
		return "", fmt.Errorf("llm: no API key configured (set LLM_API_KEY or DASHSCOPE_API_KEY)")
	}

	reqBody, err := json.Marshal(chatRequest{Model: model, Messages: messages})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(cfg.baseURL, "/")+"/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm: request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("llm: %s: %s", resp.Status, string(body))
	}

	var parsed chatCompletionResp
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("llm: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("llm: empty choices in response")
	}
	content := parsed.Choices[0].Message.Content

	if err := os.MkdirAll(cacheDir, 0o755); err == nil {
		_ = os.WriteFile(cachePath, []byte(content), 0o644)
	}
	return content, nil
}

func cacheKey(model string, messages []ChatMessage) string {
	h := sha256.New()
	h.Write([]byte(model))
	h.Write([]byte{'\n'})
	b, _ := json.Marshal(messages)
	h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}

// --- embeddings (internal/vectordb query-time search, cmd/embed offline indexing) ---

var Embed = func(text string) ([]float32, error) {
	cfg := loadLLMConfig()
	return embedText(cfg, text)
}

type embedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type embedResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

// embedText is cache-first like chatComplete, keyed on (embed model, text).
func embedText(cfg llmConfig, text string) ([]float32, error) {
	model := config.Or("QWEN_EMBED_MODEL", "text-embedding-v3")
	cacheDir := filepath.Join(config.Or("KB_DIR", "build"), "cache", "embed")
	cachePath := filepath.Join(cacheDir, Sha256Hex([]byte(model+"\n"+text))+".json")
	if data, err := os.ReadFile(cachePath); err == nil {
		var vec []float32
		if json.Unmarshal(data, &vec) == nil {
			return vec, nil
		}
	}

	if cfg.apiKey == "" {
		return nil, fmt.Errorf("llm: no API key configured (set LLM_API_KEY or DASHSCOPE_API_KEY)")
	}

	reqBody, err := json.Marshal(embedRequest{Model: model, Input: text})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(cfg.baseURL, "/")+"/embeddings", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llm: embed request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("llm: embed %s: %s", resp.Status, string(body))
	}

	var parsed embedResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("llm: parse embed response: %w", err)
	}
	if len(parsed.Data) == 0 {
		return nil, fmt.Errorf("llm: empty embedding data in response")
	}
	vec := parsed.Data[0].Embedding

	if err := os.MkdirAll(cacheDir, 0o755); err == nil {
		if data, err := json.Marshal(vec); err == nil {
			_ = os.WriteFile(cachePath, data, 0o644)
		}
	}
	return vec, nil
}

// Sha256Hex hex-encodes the SHA-256 of b. Shared content-addressed cache key
// helper (internal/vision reuses it for image-hash caching).
func Sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// --- shared LLM-output parsing helper (internal/assistant, internal/vision) ---

var reJSONFence = regexp.MustCompile("(?s)```(?:json)?\\s*(.*?)\\s*```")

// ExtractJSON strips a ```json fence if present, then returns the first
// balanced {...} or [...] substring. Defensive against chatty LLM output
// that wraps JSON in prose or code fences; not a general parser.
func ExtractJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	if m := reJSONFence.FindStringSubmatch(raw); m != nil {
		raw = strings.TrimSpace(m[1])
	}
	start := strings.IndexAny(raw, "{[")
	if start == -1 {
		return raw
	}
	depth := 0
	for i := start; i < len(raw); i++ {
		switch raw[i] {
		case '{', '[':
			depth++
		case '}', ']':
			depth--
			if depth == 0 {
				return raw[start : i+1]
			}
		}
	}
	return raw[start:]
}
