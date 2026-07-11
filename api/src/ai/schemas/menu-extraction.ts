import { z } from "zod";

export const menuExtractionSchema = z.object({
  menuTitle: z.string().nullable(),
  currency: z.literal("VND"),
  sections: z.array(
    z.object({
      name: z.string().min(1),
      items: z.array(
        z.object({
          name: z.string().min(1),
          description: z.string().nullable(),
          priceText: z.string().nullable(),
          priceAmountVnd: z.number().int().positive().nullable(),
          category: z.string().nullable(),
          dietaryClaims: z.array(
            z.object({
              type: z.enum(["vegetarian", "vegan", "halal"]),
              basis: z.literal("explicit_text"),
            }),
          ),
          evidence: z.object({
            page: z.number().int().positive(),
            blockIds: z.array(z.string()),
          }),
          confidence: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
});

export type MenuExtraction = z.infer<typeof menuExtractionSchema>;
