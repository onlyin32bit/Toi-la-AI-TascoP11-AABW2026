/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the Tasco Maps AI Hackathon API. Overrides the default
   *  `http://localhost:8787` mock server. Trailing slashes are trimmed. */
  readonly VITE_TASCO_MAPS_BASE_URL?: string;
  /** Base URL for our own Go engine (cmd/server). When set, the
   *  EnrichmentTerminal switches from the fixed mock schedule to a live
   *  POST /v1/enrich call. Default: `http://localhost:8000`. */
  readonly VITE_ENGINE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
