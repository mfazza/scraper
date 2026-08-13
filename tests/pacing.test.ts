import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { humanPacedDelay } from "../src/scrape/pacing.ts";
import { parseChannelIdFromUrl } from "../src/scrape/resolver/channel.ts";

describe("humanPacedDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Test 1: schedules delay matching jitter bounds when Math.random is mocked", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    // Mock Math.random to return 0 -> should yield exactly minMs (600)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const p1 = humanPacedDelay(600, 1800);
    await vi.runAllTimersAsync();
    await p1;
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 600);

    // Mock Math.random to return 0.999 -> should yield close to 1800
    randomSpy.mockReturnValue(0.999);
    const p2 = humanPacedDelay(600, 1800);
    await vi.runAllTimersAsync();
    await p2;
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 600 + 0.999 * 1200);
  });

  it("Test 2: falls back to default 600-1800 bounds when no arguments are provided", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    vi.spyOn(Math, "random").mockReturnValue(0.5); // (600 + 1800)/2 = 1200

    const p = humanPacedDelay();
    await vi.runAllTimersAsync();
    await p;
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1200);
  });
});

describe("parseChannelIdFromUrl", () => {
  it("Test 3: parses a valid channel ID and returns null on invalid shapes", () => {
    expect(parseChannelIdFromUrl("https://app.slack.com/client/T0123ABCD/C0456EFGH")).toBe("C0456EFGH");
    expect(parseChannelIdFromUrl("https://app.slack.com/client/T0123ABCD")).toBe(null);
    expect(parseChannelIdFromUrl("https://example.slack.com/client/TEAM/CHANNEL_ID/extra")).toBe("CHANNEL_ID");
  });
});
