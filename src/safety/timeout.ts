/**
 * Promise-based timeout wrapper.
 * Used to enforce timeoutMs on compress_context and other tools.
 */

export interface TimeoutOpts {
  timeoutMs: number;
  /** Human-readable label for error messages */
  label?: string;
}

export class TimeoutError extends Error {
  constructor(label: string) {
    super(`Operation timed out: ${label}`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  opts: TimeoutOpts,
): Promise<T> {
  if (opts.timeoutMs <= 0) return promise;

  const label = opts.label ?? "unknown";

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label));
    }, opts.timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
