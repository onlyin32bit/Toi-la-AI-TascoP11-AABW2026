import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-07-11",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          ADMIN_API_KEY: "test-admin-key",
          APP_ENV: "test",
          EMBEDDING_MODEL: "@cf/baai/bge-m3",
          GENERATION_MODEL: "test-generation-model",
          VISION_MODEL: "test-vision-model",
          RERANKER_MODEL: "",
          TRANSCRIPTION_MODEL: "test-transcription-model",
          ENABLE_AI_SEARCH: "false",
          MAX_UPLOAD_BYTES: "1048576",
          ALLOWED_SOURCE_DOMAINS: "",
          AI: {},
          RESTAURANT_SEARCH: {},
          TEST_MIGRATIONS: await readD1Migrations("migrations"),
        },
        d1Databases: ["DB"],
        r2Buckets: ["ARTIFACTS"],
        queueProducers: [
          "SOURCE_INGESTION_QUEUE",
          "INDEXING_QUEUE",
          "DEAD_LETTER_QUEUE",
        ],
      },
    })),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
