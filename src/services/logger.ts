/**
 * Conditional logger - only logs in development mode.
 * Use this instead of console.log directly.
 */

const isDev = import.meta.env.DEV;

export const logger = {
    log: (...args: unknown[]) => {
        if (isDev) console.log(...args);
    },
    warn: (...args: unknown[]) => {
        if (isDev) console.warn(...args);
    },
    error: (...args: unknown[]) => {
        // Always log errors, even in production
        console.error(...args);
    },
    debug: (tag: string, ...args: unknown[]) => {
        if (isDev) console.log(`[${tag}]`, ...args);
    },
};
