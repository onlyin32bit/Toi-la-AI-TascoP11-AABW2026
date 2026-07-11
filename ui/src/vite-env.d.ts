/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the Tasco Maps AI Hackathon API. Overrides the default
   *  `http://localhost:8787` mock server. Trailing slashes are trimmed. */
  readonly VITE_TASCO_MAPS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
