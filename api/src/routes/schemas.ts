import { z } from "zod";

const nullableString = z.string().trim().min(1).nullable().optional();
const dietaryStatus = z.enum([
  "verified",
  "explicit",
  "inferred",
  "unknown",
  "not_vegetarian",
  "not_vegan",
  "not_halal",
]);

export const tascoPoiRecordSchema = z.object({
  tascoPoiId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(300),
  address: z.string().trim().min(1).max(1000),
  ward: nullableString,
  district: nullableString,
  city: nullableString,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  category: z.string().trim().min(1).max(100).default("restaurant"),
  cuisine: nullableString,
  averagePriceVnd: z.number().int().positive().nullable().optional(),
  description: nullableString,
  openingHours: nullableString,
  phone: nullableString,
  websiteUrl: z.url().nullable().optional(),
  amenities: z.array(z.string().trim().min(1)).max(50).default([]),
  recommendedSegments: z.array(z.string().trim().min(1)).max(30).default([]),
});

export const tascoImportSchema = z.object({
  records: z.array(tascoPoiRecordSchema).min(1).max(500),
});

export const sourceUrlSchema = z.object({
  url: z.url(),
  sourceType: z.enum([
    "restaurant_website",
    "official_social_post",
    "public_social_post",
  ]),
  branchId: z.string().nullable().default(null),
  isOfficial: z.boolean().default(false),
});

export const reprocessSchema = z.object({
  fromStep: z.string().trim().min(1).max(80).default("preprocessing"),
  force: z.boolean().default(false),
});

export const reviewClaimSchema = z
  .object({
    decision: z.enum(["accept", "reject", "correct_and_accept"]),
    correctedValue: z.unknown().nullable().default(null),
    note: z.string().trim().max(1000).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (
      value.decision === "correct_and_accept" &&
      value.correctedValue === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["correctedValue"],
        message: "Required for correction.",
      });
    }
  });

export const menuItemClaimValueSchema = z.object({
  menuName: z.string().trim().min(1).default("Menu"),
  section: z.string().trim().min(1).nullable().default(null),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).nullable().default(null),
  priceAmountVnd: z.number().int().positive().nullable().default(null),
  priceTextRaw: z.string().trim().max(100).nullable().default(null),
  priceConfidence: z.number().min(0).max(1).nullable().default(null),
  vegetarianStatus: dietaryStatus.default("unknown"),
  veganStatus: dietaryStatus.default("unknown"),
  halalStatus: dietaryStatus.default("unknown"),
  spicyLevel: z.number().int().min(0).max(5).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.8),
});

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().positive().max(100_000).default(10_000),
});

export const searchFiltersSchema = z.object({
  city: nullableString,
  district: nullableString,
  cuisines: z.array(z.string()).max(20).default([]),
  maxPricePerPersonVnd: z.number().int().positive().nullable().optional(),
  maxDishPriceVnd: z.number().int().positive().nullable().optional(),
  vegetarianRequired: z.boolean().default(false),
  veganRequired: z.boolean().default(false),
  halalRequired: z.boolean().default(false),
  familyFriendlyRequired: z.boolean().default(false),
  openAt: z.iso.datetime({ offset: true }).nullable().optional(),
  minimumQualityScore: z.number().int().min(0).max(100).default(0),
});

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  location: locationSchema.nullable().optional(),
  filters: searchFiltersSchema.default({
    cuisines: [],
    vegetarianRequired: false,
    veganRequired: false,
    halalRequired: false,
    familyFriendlyRequired: false,
    minimumQualityScore: 0,
  }),
  limit: z.number().int().min(1).max(20).default(10),
  includeEvidence: z.boolean().default(true),
});

export const dishSearchSchema = searchSchema.extend({
  filters: searchFiltersSchema
    .omit({ maxPricePerPersonVnd: true })
    .extend({ maxPriceVnd: z.number().int().positive().nullable().optional() })
    .default({
      cuisines: [],
      vegetarianRequired: false,
      veganRequired: false,
      halalRequired: false,
      familyFriendlyRequired: false,
      minimumQualityScore: 0,
    }),
});

export const recommendationSchema = z.object({
  location: locationSchema,
  preferences: z.object({
    cuisines: z.array(z.string()).max(20).default([]),
    likedDishes: z.array(z.string()).max(20).default([]),
    dislikedIngredients: z.array(z.string()).max(20).default([]),
    vegetarian: z.boolean().default(false),
    budgetPerPersonVnd: z.number().int().positive().nullable().default(null),
    occasion: z.string().trim().max(100).nullable().default(null),
    ambience: z.array(z.string()).max(20).default([]),
  }),
  limit: z.number().int().min(1).max(20).default(10),
});

export const compareSchema = z.object({
  restaurantIds: z.array(z.string().min(1)).min(2).max(5),
});

export const assistantSchema = z.object({
  sessionId: z.string().nullable().default(null),
  message: z.string().trim().min(1).max(2000),
  location: locationSchema.omit({ radiusMeters: true }).nullable().optional(),
});

export const fixtureMenuImportSchema = z.object({
  records: z
    .array(
      z.object({
        externalRestaurantId: z.string().min(1),
        externalMenuItemId: z.string().min(1),
        name: z.string().min(1),
        category: z.string().nullable().default(null),
        priceAmountVnd: z.number().int().positive().nullable().default(null),
        description: z.string().nullable().default(null),
        ingredients: z.array(z.string()).default([]),
        dietaryTags: z.array(z.string()).default([]),
        spicyLevel: z.number().int().min(0).max(5).nullable().default(null),
        available: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(2000),
});

export const fixtureReviewImportSchema = z.object({
  records: z
    .array(
      z.object({
        externalRestaurantId: z.string().min(1),
        externalReviewId: z.string().min(1),
        text: z.string().min(1),
        rating: z.number().min(0).max(5).nullable().default(null),
        publishedAt: z.string().nullable().default(null),
        sentimentScore: z.number().min(-1).max(1).nullable().default(null),
      }),
    )
    .min(1)
    .max(2000),
});

export type TascoPoiRecord = z.infer<typeof tascoPoiRecordSchema>;
export type SearchRequest = z.infer<typeof searchSchema>;
