-- Demo/test data — NOT run by Migrate() on server boot; run explicitly via
-- `go run ./cmd/seed` (or `make seed-db`). Clearly-marked test accounts, safe
-- to point at a shared demo Postgres. All ids are fixed (not gen_random_uuid())
-- and every insert is ON CONFLICT DO NOTHING, so reruns are no-ops.
--
-- Passwords are bcrypt-hashed here via pgcrypto's crypt(..., gen_salt('bf')) —
-- the same $2a$ format golang.org/x/crypto/bcrypt.CompareHashAndPassword
-- verifies (internal/db.Login), so no Go-side hashing step is needed.
-- All three demo accounts use the password: demo1234

INSERT INTO users (id, email, password_hash, display_name, role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'demo.family@tascomaps.vn',
     crypt('demo1234', gen_salt('bf')), 'Gia đình Demo', 'user'),
    ('22222222-2222-2222-2222-222222222222', 'demo.contributor@tascomaps.vn',
     crypt('demo1234', gen_salt('bf')), 'Người đóng góp Demo', 'contributor'),
    ('33333333-3333-3333-3333-333333333333', 'demo.admin@tascomaps.vn',
     crypt('demo1234', gen_salt('bf')), 'Admin Demo', 'admin')
ON CONFLICT (id) DO NOTHING;

-- Saved context for demo.family: a weekend Hà Nội trip with real benchmark
-- POI ids in "learned" so §5.3's S_behavior factor (internal/rerank) has
-- genuine data to score against the moment this account logs in — select it
-- via GET /v1/recommend?context_id=aaaaaaaa-...&... after logging in.
INSERT INTO saved_contexts (id, user_id, name, stated, ctx, learned) VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'Chuyến Hà Nội cuối tuần',
    '{"diet":[],"allergens":[],"party":{"kids":2,"elderly":0,"size":4}}',
    '{"vehicle":"car","mode":"explore"}',
    '{"repeat_pois":["poi:res001","poi:res022"],"cuisine_affinity":{"Việt Nam":0.8,"Chay":0.6}}'
) ON CONFLICT (id) DO NOTHING;

-- Attributes the demo UGC contributions (preprocess/seed_demo_contributions.py
-- -> engine/build/contributions.json, ids fixed to match) to demo.contributor,
-- so /v1/contribute's contributor-identity story has something to show.
INSERT INTO contribution_owners (contribution_id, user_id) VALUES
    ('ugc:demo0001', '22222222-2222-2222-2222-222222222222'),
    ('ugc:demo0002', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (contribution_id) DO NOTHING;
