import type { AppBindings } from "../env";
import { AppError } from "../shared/errors";

export async function generateEmbeddings(
  env: AppBindings,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await env.AI.run(env.EMBEDDING_MODEL, {
    text: texts,
    truncate_inputs: true,
  });
  if (!("data" in response) || !Array.isArray(response.data)) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "The embedding model returned an invalid response.",
      502,
    );
  }
  const vectors = response.data;
  if (
    vectors.length !== texts.length ||
    vectors.some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length === 0 ||
        vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "The embedding vector count or dimensions are invalid.",
      502,
    );
  }
  const dimensions = vectors[0]!.length;
  if (vectors.some((vector) => vector.length !== dimensions)) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "Embedding dimensions are inconsistent.",
      502,
    );
  }
  return vectors;
}
