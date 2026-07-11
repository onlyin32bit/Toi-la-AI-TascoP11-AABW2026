import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const adminHeaders = {
  Authorization: "Bearer test-admin-key",
  "Content-Type": "application/json",
};

describe("API integration", () => {
  it("reports binding health without running AI inference", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/health");
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: { status: string; services: { d1: string } };
    }>();
    expect(body.data.status).toBe("ok");
    expect(body.data.services.d1).toBe("ok");
  });

  it("requires admin authentication and idempotency", async () => {
    const unauthorized = await SELF.fetch(
      "https://example.com/api/v1/admin/imports/tasco-pois",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [] }),
      },
    );
    expect(unauthorized.status).toBe(401);
  });

  it("imports a Tasco POI repeatedly without duplication and hydrates its profile", async () => {
    const payload = {
      records: [
        {
          tascoPoiId: "RES_TEST_001",
          name: "Bếp Nhà Xứ Quảng",
          address: "123 Nguyễn Văn Linh",
          district: "Hải Châu",
          city: "Đà Nẵng",
          latitude: 16.0544,
          longitude: 108.2022,
          category: "restaurant",
          cuisine: "Việt Nam",
          averagePriceVnd: 120000,
          openingHours: "09:00-23:00",
          amenities: ["Phù hợp trẻ em"],
          recommendedSegments: ["Gia đình"],
        },
      ],
    };
    const first = await SELF.fetch(
      "https://example.com/api/v1/admin/imports/tasco-pois",
      {
        method: "POST",
        headers: { ...adminHeaders, "Idempotency-Key": "poi-import-test-1" },
        body: JSON.stringify(payload),
      },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json<{
      data: { imported: number; restaurantIds: string[] };
    }>();
    expect(firstBody.data.imported).toBe(1);
    const restaurantId = firstBody.data.restaurantIds[0]!;

    const second = await SELF.fetch(
      "https://example.com/api/v1/admin/imports/tasco-pois",
      {
        method: "POST",
        headers: { ...adminHeaders, "Idempotency-Key": "poi-import-test-2" },
        body: JSON.stringify(payload),
      },
    );
    const secondBody = await second.json<{
      data: { updated: number; restaurantIds: string[] };
    }>();
    expect(secondBody.data.updated).toBe(1);
    expect(secondBody.data.restaurantIds).toEqual([restaurantId]);

    const detail = await SELF.fetch(
      `https://example.com/api/v1/restaurants/${restaurantId}`,
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json<{
      data: {
        canonicalName: string;
        branches: unknown[];
        qualityScore: number;
      };
    }>();
    expect(detailBody.data.canonicalName).toBe("Bếp Nhà Xứ Quảng");
    expect(detailBody.data.branches).toHaveLength(1);
    expect(detailBody.data.qualityScore).toBeGreaterThan(0);
  });
});
