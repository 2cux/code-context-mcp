/**
 * Fail-open wrapper: if an operation fails, return a safe fallback
 * instead of throwing. Core principle from PRD §7.6:
 *
 *   "宁可不压缩，也不能影响 Agent 正常工作。"
 */

export interface FailOpenResult<T> {
  success: boolean;
  value: T;
  error?: string;
}

export async function failOpen<T>(
  fn: () => Promise<T>,
  fallback: T,
  label?: string,
): Promise<FailOpenResult<T>> {
  try {
    const value = await fn();
    return { success: true, value };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      success: false,
      value: fallback,
      error: label ? `${label}: ${message}` : message,
    };
  }
}
