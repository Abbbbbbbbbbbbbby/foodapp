// Injected by vite.config.ts's `define` (build-time only — absent in vitest
// unless a config also defines it). Consumers must guard with `typeof
// __APP_VERSION__ !== 'undefined'`.
declare const __APP_VERSION__: string;

// Test-only / early-boot hooks, set directly on window before React mounts.
interface Window {
  __earlyErrors?: Array<{ msg: string; stack?: string }>;
  __throwAtWizardStep?: number;
}
