/// <reference types="vite/client" />

declare const __ATLASSIAN_CLIENT_ID__: string;

interface ImportMetaEnv {
  readonly VITE_WS_URL: string;
  readonly VITE_HTTP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
