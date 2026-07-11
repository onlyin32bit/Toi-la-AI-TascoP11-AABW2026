package compare

import (
	"testing"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/kb/kbfixture"
	"tascop11/engine/internal/model"
)

func TestCompare(t *testing.T) {
	store := kbfixture.New()
	resp := Compare(store, []string{"RESA", "RESB", "NOPE"}, model.UserCtx{TimeMin: -1})
	if len(resp.Items) != 2 {
		t.Errorf("Compare items = %d, want 2", len(resp.Items))
	}
	if !kb.ContainsStr(resp.NotFound, "NOPE") {
		t.Errorf("Compare not_found = %v, want to contain NOPE", resp.NotFound)
	}
}
