declare const __APP_VERSION__: string | undefined;

/**
 * The game's version, shown on the main menu. It is injected at build time from the root
 * package.json (see vite.config.ts), the one place the version is written; a test keeps the
 * desktop installer's package.json in step with it.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
