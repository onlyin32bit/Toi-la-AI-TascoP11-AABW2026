import { describe, expect, it } from "vitest";
import {
  choosePreferredClaim,
  resolutionScore,
} from "../../src/claims/resolution";
import { satisfiesRequiredDietaryStatus } from "../../src/menus/dietary";
import { parseVietnamesePrice } from "../../src/menus/price";
import { scoreEntityMatch } from "../../src/restaurants/entity-resolution";
import { evaluateOpeningHours } from "../../src/restaurants/opening-hours";
import { calculateQualityScore } from "../../src/restaurants/quality";
import { mergeSearchFilters } from "../../src/search/filter-merge";
import { haversineDistanceMeters } from "../../src/search/geo";
import { rankCandidate } from "../../src/search/ranking";
import { sha256 } from "../../src/shared/crypto";
import {
  normalizeAddress,
  normalizePhone,
  normalizeRestaurantName,
} from "../../src/shared/normalization";
import { assertSafePublicUrl } from "../../src/sources/url-policy";

describe("Vietnamese normalization", () => {
  it("normalizes names, addresses, and phones", () => {
    expect(normalizeRestaurantName("Bếp Nhà Xứ Quảng")).toBe(
      "bep nha xu quang",
    );
    expect(normalizeAddress("123 Nguyễn Huệ, TP. Hồ Chí Minh")).toContain(
      "123 nguyen hue",
    );
    expect(normalizePhone("090 123 4567")).toBe("+84901234567");
  });
});

describe("price parsing", () => {
  it.each([
    ["65K", 65_000, "exact"],
    ["65.000 VND", 65_000, "exact"],
    ["65 nghìn", 65_000, "exact"],
    ["65", 65_000, "ambiguous"],
    ["theo thời giá", null, "market_price"],
    ["S / M / L", null, "variant"],
  ] as const)("parses %s", (raw, amount, kind) => {
    expect(parseVietnamesePrice(raw)).toMatchObject({
      amountVnd: amount,
      kind,
    });
  });
});

describe("location and opening hours", () => {
  it("calculates Haversine distance", () => {
    expect(
      haversineDistanceMeters(
        { latitude: 10.7769, longitude: 106.7009 },
        { latitude: 10.7869, longitude: 106.7009 },
      ),
    ).toBeGreaterThan(1_000);
  });

  it("handles overnight ranges and unknown hours", () => {
    const hours = JSON.stringify({ sat: [["18:00", "02:00"]] });
    expect(evaluateOpeningHours(hours, "2026-07-11T23:00:00+07:00")).toBe(
      "open",
    );
    expect(evaluateOpeningHours(hours, "2026-07-12T01:00:00+07:00")).toBe(
      "open",
    );
    expect(evaluateOpeningHours(null, "2026-07-11T23:00:00+07:00")).toBe(
      "unknown",
    );
  });
});

describe("resolution, quality, and ranking", () => {
  it("scores entity matches without merging on name alone", () => {
    expect(
      scoreEntityMatch({
        nameSimilarity: 1,
        addressSimilarity: 0,
        geographicProximity: 0,
        phoneEqual: false,
        websiteDomainEqual: false,
      }).decision,
    ).toBe("separate");
  });

  it("prefers accepted claims and computes resolution score", () => {
    const candidate = {
      id: "candidate",
      status: "candidate" as const,
      confidence: 1,
      trustWeight: 1,
      freshnessFactor: 1,
      evidenceQualityFactor: 1,
      createdAt: "2026-01-02",
    };
    const accepted = {
      ...candidate,
      id: "accepted",
      status: "accepted" as const,
      confidence: 0.7,
    };
    expect(resolutionScore(candidate)).toBe(1);
    expect(choosePreferredClaim([candidate, accepted])?.id).toBe("accepted");
  });

  it("calculates a bounded quality and final score", () => {
    const quality = calculateQualityScore({
      hasIdentityAndCoordinates: true,
      hasBranchInformation: true,
      hasContactAndHours: false,
      hasCuisine: true,
      activeMenuItemCount: 5,
      pricedMenuItemRatio: 0.8,
      hasImageEvidence: false,
      hasExplicitDietaryInformation: false,
      hasOccasionOrAmenities: true,
      freshnessDays: 20,
      verificationLevel: "tasco_verified",
      unresolvedConflictCount: 0,
    });
    expect(quality.score).toBeGreaterThan(50);
    expect(
      rankCandidate({
        semantic: 1,
        preference: 1,
        distance: 1,
        quality: 1,
        review: 1,
        freshness: 1,
      }),
    ).toBe(1);
  });
});

describe("filters, dietary safety, hashing, and SSRF policy", () => {
  it("lets explicit filters override parsed filters", () => {
    expect(
      mergeSearchFilters(
        { maxPricePerPersonVnd: 200_000, vegetarianRequired: false },
        { maxPricePerPersonVnd: 150_000, vegetarianRequired: true },
      ),
    ).toMatchObject({
      maxPricePerPersonVnd: 150_000,
      vegetarianRequired: true,
    });
  });

  it("never treats inference as a strict dietary match", () => {
    expect(satisfiesRequiredDietaryStatus("explicit")).toBe(true);
    expect(satisfiesRequiredDietaryStatus("inferred")).toBe(false);
  });

  it("keeps embedding hashes stable", async () => {
    expect(await sha256("model\nmenu_item\npho bo")).toBe(
      await sha256("model\nmenu_item\npho bo"),
    );
  });

  it("rejects private and unsupported source URLs", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1/menu")).toThrow();
    expect(() => assertSafePublicUrl("file:///etc/passwd")).toThrow();
    expect(
      assertSafePublicUrl("https://restaurant.example/menu").hostname,
    ).toBe("restaurant.example");
  });
});
