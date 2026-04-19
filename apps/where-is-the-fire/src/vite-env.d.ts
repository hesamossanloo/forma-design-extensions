/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORMA_CLIENT_ID?: string;
  readonly VITE_NASA_MAP_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
