/**
 * Executes an async operation with exponential backoff and jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelayMs = 1000
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt >= maxAttempts) {
        throw err;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.warn(`[Retry] Attempt ${attempt} failed: ${err.message}. Retrying in ${Math.round(delay)}ms...`);
      await new Promise((res) => setTimeout(res, delay));
      attempt++;
    }
  }
}
