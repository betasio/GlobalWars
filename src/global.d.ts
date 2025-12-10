// Global declarations used by the application runtime.
// Asset module declarations live in tests/global.d.ts and src/types/assets.d.ts.

declare global {
  interface Window {
    websocketBaseUrl?: string;
  }
}

export {};
