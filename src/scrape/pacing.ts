/**
 * Computes a human-paced, jittered delay to bypass anti-bot rate limits and behavior detection.
 */
export async function humanPacedDelay(minMs = 600, maxMs = 1800): Promise<void> {
  const jitter = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, jitter));
}
