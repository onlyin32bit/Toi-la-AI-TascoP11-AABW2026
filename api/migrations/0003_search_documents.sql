CREATE TABLE search_documents (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('restaurant_profile', 'menu_item', 'menu_summary', 'review_summary', 'social_evidence')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  embedding_text TEXT NOT NULL,
  embedding_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  vector_status TEXT NOT NULL DEFAULT 'pending' CHECK (vector_status IN ('pending', 'indexed', 'failed', 'stale', 'deleted')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  vector_mutation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  indexed_at TEXT
);

CREATE INDEX idx_search_documents_restaurant ON search_documents(restaurant_id);
CREATE INDEX idx_search_documents_vector_status ON search_documents(vector_status);
CREATE INDEX idx_search_documents_menu_item ON search_documents(menu_item_id);
