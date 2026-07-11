export interface OcrInput {
  bytes: ArrayBuffer;
  mimeType: string;
  sourceId: string;
}

export interface OcrResult {
  fullText: string;
  blocks: Array<{
    id: string;
    text: string;
    confidence: number;
    boundingBox: [number, number, number, number];
    page: number;
  }>;
  languageHints: string[];
}

export interface OcrProvider {
  extract(input: OcrInput): Promise<OcrResult>;
}
