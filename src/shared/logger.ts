/**
 * Extension-wide console tagging. Logs appear in whichever DevTools owns the context:
 * page console (content scripts), popup (inspect popup), or service worker console.
 */

const PREFIX = "[CoursCheat]";

export function log(scope: string, ...args: unknown[]): void {
  console.log(`${PREFIX} [${scope}]`, ...args);
}

export function warn(scope: string, ...args: unknown[]): void {
  console.warn(`${PREFIX} [${scope}]`, ...args);
}

export function error(scope: string, ...args: unknown[]): void {
  console.error(`${PREFIX} [${scope}]`, ...args);
}
