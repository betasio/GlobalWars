// Global declarations used by the application runtime.
// Asset module declarations live in tests/global.d.ts to avoid duplication.

declare global {
  interface Window {
    websocketBaseUrl?: string;
  }
}

export {};
