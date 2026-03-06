/**
 * Production-ready logging utility.
 *
 * Usage:
 *   const logger = createLogger('MyModule');
 *   logger.debug('Verbose trace info');  // dev only
 *   logger.info('User action occurred'); // dev only
 *   logger.warn('Non-critical issue');   // always shown
 *   logger.error('Something failed', err); // always shown
 *
 * In development (import.meta.env.DEV): all levels are output.
 * In production builds: only warn and error are output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const isDev = import.meta.env.DEV;

/**
 * Format current time as HH:MM:SS.mmm
 */
function formatTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const millis = String(now.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

/**
 * Creates a named logger for a module.
 * @param module - The module/component name used as a log prefix, e.g. 'PhotoboothContext'
 */
export function createLogger(module: string): Logger {
  const prefix = `[${formatTime()}] [${module}]`;

  return {
    debug(message: string, ...args: unknown[]): void {
      if (isDev) {
        console.log(prefix, message, ...args);
      }
    },

    info(message: string, ...args: unknown[]): void {
      if (isDev) {
        console.info(prefix, message, ...args);
      }
    },

    warn(message: string, ...args: unknown[]): void {
      console.warn(prefix, message, ...args);
    },

    error(message: string, ...args: unknown[]): void {
      console.error(prefix, message, ...args);
    },
  };
}
