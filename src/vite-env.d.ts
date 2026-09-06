/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AVINOR_ICAO_EXPORT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
