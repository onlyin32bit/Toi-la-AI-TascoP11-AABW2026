"""Unit tests for resolver.py (stdlib unittest, no extra dependency).
Run: python3 -m unittest test_resolver.py -v
"""
import unittest

import resolver


class TestHaversine(unittest.TestCase):
    def test_identical_points_zero(self):
        self.assertEqual(resolver.haversine(21.0, 105.0, 21.0, 105.0), 0.0)

    def test_hanoi_hcm_roughly_1150km(self):
        d = resolver.haversine(21.0245, 105.8412, 10.7769, 106.7009)
        self.assertTrue(1_050_000 < d < 1_250_000, d)


class TestNameSimilarity(unittest.TestCase):
    def test_identical_names_full_overlap(self):
        self.assertEqual(resolver.name_similarity("Phở Bếp Nhà", "Phở Bếp Nhà"), 1.0)

    def test_unrelated_names_low_overlap(self):
        self.assertLess(resolver.name_similarity("Phở Bếp Nhà", "Sushi Sakura"), 0.3)

    def test_empty_name_zero(self):
        self.assertEqual(resolver.name_similarity("", "Phở Bếp Nhà"), 0.0)


class TestResolveEntities(unittest.TestCase):
    def setUp(self):
        self.benchmark = [
            {"id": "poi:res001", "name": "Phở Bếp Nhà", "lat": 21.040388, "lon": 105.844615},
        ]

    def test_nearby_similar_name_matches(self):
        contributions = [
            {"id": "ugc:aaa", "name": "Phở Bếp Nhà 2", "lat": 21.040400, "lon": 105.844600},
        ]
        dups = resolver.resolve_entities(self.benchmark, contributions)
        self.assertEqual(len(dups), 1)
        self.assertEqual(dups[0]["canonical_id"], "poi:res001")
        self.assertEqual(dups[0]["contribution_id"], "ugc:aaa")

    def test_far_away_does_not_match(self):
        contributions = [
            {"id": "ugc:bbb", "name": "Phở Bếp Nhà", "lat": 10.776, "lon": 106.700},  # HCM
        ]
        dups = resolver.resolve_entities(self.benchmark, contributions)
        self.assertEqual(dups, [])

    def test_nearby_different_name_does_not_match(self):
        contributions = [
            {"id": "ugc:ccc", "name": "Sushi Sakura", "lat": 21.040400, "lon": 105.844600},
        ]
        dups = resolver.resolve_entities(self.benchmark, contributions)
        self.assertEqual(dups, [])


class TestResolveField(unittest.TestCase):
    def test_empty_candidates_none(self):
        self.assertIsNone(resolver.resolve_field([]))

    def test_single_candidate_wins(self):
        cands = [{"value": "budget", "source": "tasco_csv", "tier": 3, "confidence": 0.8, "fetched_at": "2026-01-01T00:00:00+00:00"}]
        winner = resolver.resolve_field(cands)
        self.assertEqual(winner["value"], "budget")
        self.assertEqual(winner["candidates"], 1)

    def test_higher_tier_wins_without_consensus(self):
        cands = [
            {"value": "budget", "source": "tasco_csv", "tier": 3, "confidence": 0.8, "fetched_at": "2026-01-01T00:00:00+00:00"},
            {"value": "premium", "source": "user_contributed", "tier": 1, "confidence": 0.55, "fetched_at": "2026-02-01T00:00:00+00:00"},
        ]
        winner = resolver.resolve_field(cands)
        # Only 1 lower-tier source, below CONSENSUS_MIN -> tier 3 still wins.
        self.assertEqual(winner["value"], "budget")

    def test_consensus_overrides_higher_tier(self):
        cands = [
            {"value": "budget", "source": "tasco_csv", "tier": 3, "confidence": 0.8, "fetched_at": "2026-01-01T00:00:00+00:00"},
        ] + [
            {"value": "premium", "source": "user_contributed", "tier": 1, "confidence": 0.55, "fetched_at": f"2026-02-0{i}T00:00:00+00:00"}
            for i in range(1, 4)  # 3 independent agreeing sources = CONSENSUS_MIN
        ]
        winner = resolver.resolve_field(cands)
        self.assertEqual(winner["value"], "premium")
        self.assertEqual(winner["candidates"], 4)

    def test_tie_breaks_on_most_recent(self):
        cands = [
            {"value": "old", "source": "tasco_csv", "tier": 3, "confidence": 0.8, "fetched_at": "2026-01-01T00:00:00+00:00"},
            {"value": "new", "source": "tasco_csv", "tier": 3, "confidence": 0.8, "fetched_at": "2026-06-01T00:00:00+00:00"},
        ]
        winner = resolver.resolve_field(cands)
        self.assertEqual(winner["value"], "new")


class TestSourceAgreementAndFreshness(unittest.TestCase):
    def test_source_agreement_full(self):
        winner = {"value": "budget"}
        cands = [{"value": "budget"}, {"value": "budget"}]
        self.assertEqual(resolver.source_agreement(cands, winner), 1.0)

    def test_source_agreement_partial(self):
        winner = {"value": "budget"}
        cands = [{"value": "budget"}, {"value": "premium"}]
        self.assertEqual(resolver.source_agreement(cands, winner), 0.5)

    def test_freshness_tasco_csv_always_one(self):
        self.assertEqual(resolver.freshness({"source": "tasco_csv", "fetched_at": "1970-01-01T00:00:00+00:00"}), 1.0)

    def test_freshness_decays_for_ugc(self):
        old = resolver.freshness({"source": "user_contributed", "fetched_at": "2020-01-01T00:00:00+00:00"})
        self.assertTrue(0.0 <= old < 0.5)


if __name__ == "__main__":
    unittest.main()
