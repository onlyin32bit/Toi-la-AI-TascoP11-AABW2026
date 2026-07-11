PRAGMA foreign_keys = ON;

CREATE TABLE restaurants (
  id TEXT PRIMARY KEY,
  tasco_poi_id TEXT UNIQUE,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'temporarily_closed', 'permanently_closed', 'archived')),
  primary_cuisine TEXT,
  cuisine_tags_json TEXT NOT NULL DEFAULT '[]',
  price_min_vnd INTEGER,
  price_max_vnd INTEGER,
  average_price_per_person_vnd INTEGER,
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  verification_level TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_level IN ('unverified', 'source_supported', 'merchant_verified', 'tasco_verified')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_enriched_at TEXT
);

CREATE TABLE restaurant_branches (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT,
  address_text TEXT NOT NULL,
  ward TEXT,
  district TEXT,
  city TEXT,
  country_code TEXT NOT NULL DEFAULT 'VN' CHECK (country_code = 'VN'),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  phone TEXT,
  website_url TEXT,
  opening_hours_json TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (restaurant_id, address_text)
);

CREATE TABLE restaurant_external_ids (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  original_url TEXT,
  r2_object_key TEXT,
  content_hash TEXT,
  mime_type TEXT,
  publisher_name TEXT,
  is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1)),
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'queued', 'processing', 'processed', 'needs_review', 'failed', 'rejected')),
  rights_status TEXT NOT NULL DEFAULT 'unknown' CHECK (rights_status IN ('provided_dataset', 'merchant_authorized', 'user_submitted', 'public_reference', 'unknown')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (restaurant_id, content_hash)
);

CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('poi_import', 'webpage', 'menu_image', 'menu_pdf', 'video', 'review_batch')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed_retryable', 'failed_permanent')),
  current_step TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, type)
);

CREATE TABLE canonical_dishes (
  id TEXT PRIMARY KEY,
  canonical_name_vi TEXT NOT NULL,
  canonical_name_en TEXT,
  normalized_name TEXT NOT NULL UNIQUE,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  cuisine TEXT,
  region TEXT,
  category TEXT,
  common_ingredients_json TEXT NOT NULL DEFAULT '[]',
  dietary_notes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dish_aliases (
  id TEXT PRIMARY KEY,
  canonical_dish_id TEXT NOT NULL REFERENCES canonical_dishes(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  language TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE menus (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  source_id TEXT NOT NULL REFERENCES sources(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (restaurant_id, source_id, version)
);

CREATE TABLE menu_sections (
  id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_id, normalized_name)
);

CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES menu_sections(id) ON DELETE SET NULL,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  canonical_dish_id TEXT REFERENCES canonical_dishes(id) ON DELETE SET NULL,
  price_amount_vnd INTEGER,
  price_text_raw TEXT,
  price_confidence REAL CHECK (price_confidence BETWEEN 0 AND 1),
  vegetarian_status TEXT NOT NULL DEFAULT 'unknown' CHECK (vegetarian_status IN ('verified', 'explicit', 'inferred', 'unknown', 'not_vegetarian')),
  vegan_status TEXT NOT NULL DEFAULT 'unknown' CHECK (vegan_status IN ('verified', 'explicit', 'inferred', 'unknown', 'not_vegan')),
  halal_status TEXT NOT NULL DEFAULT 'unknown' CHECK (halal_status IN ('verified', 'explicit', 'inferred', 'unknown', 'not_halal')),
  spicy_level INTEGER CHECK (spicy_level BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'unavailable', 'superseded')),
  extraction_confidence REAL NOT NULL CHECK (extraction_confidence BETWEEN 0 AND 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (menu_id, normalized_name, price_text_raw)
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE SET NULL,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('source_explicit', 'ocr_explicit', 'speech_explicit', 'review_aggregate', 'visual_inference', 'llm_inference', 'manual')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  trust_weight REAL NOT NULL CHECK (trust_weight BETWEEN 0 AND 1),
  evidence_json TEXT NOT NULL,
  extraction_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'accepted', 'rejected', 'superseded', 'expired')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, extraction_key)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_review_id TEXT,
  text TEXT NOT NULL,
  rating REAL,
  language TEXT,
  published_at TEXT,
  sentiment_score REAL,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, external_review_id)
);

CREATE TABLE review_aspect_aggregates (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  aspect TEXT NOT NULL CHECK (aspect IN ('food', 'service', 'price_value', 'cleanliness', 'ambience', 'parking', 'waiting_time', 'family_suitability')),
  sentiment_score REAL NOT NULL CHECK (sentiment_score BETWEEN -1 AND 1),
  mention_count INTEGER NOT NULL,
  summary TEXT,
  evidence_review_ids_json TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL,
  UNIQUE (restaurant_id, aspect)
);

CREATE TABLE restaurant_attributes (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL,
  evidence_claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'explicit', 'inferred')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  updated_at TEXT NOT NULL,
  UNIQUE (restaurant_id, predicate)
);

CREATE TABLE quality_score_components (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL,
  UNIQUE (restaurant_id, component)
);

CREATE TABLE assistant_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  note TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_artifacts (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  validation_outcome TEXT NOT NULL,
  r2_object_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
