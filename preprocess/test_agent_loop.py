"""Behavioral tests for the per-POI verification agent."""
import unittest

from agent_loop import Candidate, EnrichmentAgent, ToolResult, resolve_consensus, values_agree
from compile_thuduc_kb import compile_poi


def wrapped(value, source="seed", confidence=0.8):
    return {
        "value": value,
        "source": source,
        "confidence": confidence,
        "fetched_at": "2026-07-12T00:00:00+00:00",
    }


class FakeTool:
    def __init__(self, name, source, values, supported_fields=None, error=None):
        self.name = name
        self.source = source
        self.values = values
        self.supported_fields = frozenset(supported_fields or values.keys())
        self.error = error
        self.calls = []

    def fetch(self, poi, fields):
        self.calls.append(set(fields))
        candidates = [
            Candidate(field, value, self.source, 0.8, "2026-07-12T01:00:00+00:00")
            for field, value in self.values.items() if field in fields
        ]
        return ToolResult(self.name, self.source, bool(candidates), candidates, self.error)


class TestConsensus(unittest.TestCase):
    def test_equivalent_address_formatting_agrees(self):
        self.assertTrue(values_agree(
            "address",
            "123 Võ Văn Ngân, P. Bình Thọ, TP. Thủ Đức",
            "123 Võ Văn Ngân, Phường Bình Thọ, Thành phố Hồ Chí Minh",
        ))

    def test_different_street_numbers_do_not_agree(self):
        self.assertFalse(values_agree(
            "address", "123 Võ Văn Ngân, Thủ Đức", "321 Võ Văn Ngân, Thủ Đức",
        ))
    def test_two_independent_sources_verify(self):
        cands = [
            Candidate("opening", {"open_min": 480, "close_min": 1320, "raw": "08-22"},
                      "google", 0.8, "2026-01-01"),
            Candidate("opening", {"open_min": 480, "close_min": 1320, "raw": "08 to 22"},
                      "foody", 0.6, "2026-01-02"),
        ]
        winner = resolve_consensus(cands)
        self.assertIsNotNone(winner)
        self.assertEqual(winner["consensus_count"], 2)

    def test_duplicate_calls_to_same_source_are_one_vote(self):
        cands = [
            Candidate("address", "1 Main", "google", 0.8, "2026-01-01"),
            Candidate("address", "1 Main", "google", 0.8, "2026-01-02"),
        ]
        self.assertIsNone(resolve_consensus(cands))

    def test_disagreement_is_not_published(self):
        cands = [
            Candidate("car_parking", True, "google", 0.8, "2026-01-01"),
            Candidate("car_parking", False, "foody", 0.6, "2026-01-02"),
        ]
        self.assertIsNone(resolve_consensus(cands))


class TestAgentLoop(unittest.TestCase):
    def test_different_pois_get_different_plans(self):
        google = FakeTool("google", "google", {"address": "1 Main", "opening": "08-22"})
        foody = FakeTool("foody", "foody", {"address": "1 Main", "opening": "08-22"})
        agent = EnrichmentAgent([google, foody])
        missing_address = {"id": "a", "name": wrapped("A"), "opening": wrapped("08-22")}
        missing_opening = {"id": "b", "name": wrapped("B"), "address": wrapped("1 Main")}

        ledger_a = agent.inspect(missing_address)
        ledger_b = agent.inspect(missing_opening)
        # The non-missing fact is already verified by two prior sources. The
        # remaining gap therefore routes to a different field/tool request.
        ledger_a["opening"].append(Candidate("opening", "08-22", "prior-2", 0.8, "2026-07-12"))
        ledger_b["address"].append(Candidate("address", "1 Main", "prior-2", 0.8, "2026-07-12"))
        plan_a = agent.plan(missing_address, ledger_a)
        plan_b = agent.plan(missing_opening, ledger_b)

        self.assertIn("address", plan_a[0].fields)
        self.assertIn("opening", plan_b[0].fields)
        self.assertNotEqual(plan_a[0].fields, plan_b[0].fields)

    def test_retries_second_source_then_writes_only_consensus(self):
        first = FakeTool("google", "google", {"address": "1 Main", "opening": "08-22"})
        second = FakeTool("foody", "foody", {"address": "1 Main", "opening": "09-23"})
        poi = {"id": "a", "name": wrapped("A")}

        run = EnrichmentAgent([first, second]).run(poi)

        self.assertEqual(len(first.calls), 1)
        self.assertEqual(len(second.calls), 1)
        self.assertIn("address", run["verified_fields"])
        self.assertNotIn("opening", run["verified_fields"])
        self.assertEqual(run["refused_fields"]["opening"]["reason"], "no_consensus")
        self.assertTrue(run["refused_fields"]["opening"]["flagged_for_review"])
        self.assertEqual(len(run["refused_fields"]["opening"]["candidates"]), 2)
        self.assertIn("retry another independent source", run["plan"][1]["reason"])

    def test_unavailable_source_refuses_without_fabricating(self):
        missing = FakeTool("google", "google", {}, supported_fields={"address"})
        poi = {"id": "a", "name": wrapped("A")}

        run = EnrichmentAgent([missing]).run(poi)

        self.assertEqual(run["status"], "refused")
        self.assertEqual(run["verified_fields"], {})
        self.assertEqual(run["refused_fields"]["address"]["reason"], "missing")

    def test_compiler_drops_unverified_raw_fact(self):
        raw = {"id": "a", "name": wrapped("Unverified name"), "city": "HCM"}
        compiled = compile_poi(
            raw,
            {"name": {"value": "Verified name"}},
            {"address": {"reason": "no_consensus"}},
            None,
        )
        self.assertEqual(compiled["name"], "Verified name")
        self.assertIsNone(compiled["address"])
        self.assertNotEqual(compiled["name"], "Unverified name")


if __name__ == "__main__":
    unittest.main()
