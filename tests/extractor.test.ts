import { describe, it, expect, vi, beforeEach } from "vitest";
import { scrapeChannelHistory } from "../src/scrape/extractor.ts";
import type { Page } from "playwright";

// Mock the pacing module to avoid delays in tests
vi.mock("../src/scrape/pacing.ts", () => ({
  humanPacedDelay: vi.fn().mockResolvedValue(undefined),
}));

describe("scrapeChannelHistory - Mocked Scroll & Extraction", () => {
  let drainCallCount = 0;
  let mockMessages: any[] = [];
  let scrollTop = 1000;
  let beginningFound = false;

  const getMockMessagesForDrain = () => {
    drainCallCount++;
    if (drainCallCount === 1) {
      return mockMessages;
    }
    return [];
  };

  const getMockScrollTop = () => {
    if (scrollTop > 0) {
      scrollTop -= 400;
    }
    return scrollTop;
  };

  const getBeginningFound = () => {
    return beginningFound;
  };

  // Mock implementation of Page.evaluate
  const evaluateMock = vi.fn().mockImplementation(async (fn, ...args) => {
    const fnStr = fn.toString();

    if (fnStr.includes("visibleRows") || fnStr.includes("__scrapedMessages ?? []")) {
      return getMockMessagesForDrain();
    }

    if (fnStr.includes("foundList")) {
      return { foundList: true, foundRows: mockMessages.length, url: "https://app.slack.com/client/T1/C1" };
    }

    if (fnStr.includes("extractSingleRow")) {
      return undefined;
    }

    if (fnStr.includes("MutationObserver")) {
      return undefined;
    }

    if (fnStr.includes("scrollBy")) {
      return undefined;
    }

    if (fnStr.includes("scrollTop")) {
      return getMockScrollTop();
    }

    return undefined;
  });

  // Mock implementation of Page.locator
  const locatorMock = {
    first: () => locatorMock,
    locator: () => locatorMock,
    isVisible: vi.fn().mockImplementation(async () => {
      return getBeginningFound();
    }),
  };

  const pageMock = {
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    evaluate: evaluateMock,
    url: vi.fn().mockReturnValue("https://app.slack.com/client/T1/C1"),
    locator: vi.fn().mockReturnValue(locatorMock),
  } as unknown as Page;

  beforeEach(() => {
    vi.clearAllMocks();
    drainCallCount = 0;
    mockMessages = [];
    scrollTop = 1000;
    beginningFound = false;
  });

  it("Task 2.1: Full Scrape (no sinceTs provided) - scrolls fully to the beginning of history", async () => {
    // Set up mock messages
    mockMessages = [
      { ts: "1700000001.000000", author: "User1", authorId: "U1", text: "Msg 1", hasReplies: false, permalink: "https://slack.com/1", edited: false, files: [] },
      { ts: "1700000002.000000", author: "User2", authorId: "U2", text: "Msg 2", hasReplies: false, permalink: "https://slack.com/2", edited: true, files: [{ filename: "doc.txt", url: "https://file" }] },
    ];

    // We want the scroll top to eventually reach 0 and stop
    beginningFound = false;

    // Trigger scrape
    const result = await scrapeChannelHistory(pageMock);

    expect(result).toHaveLength(2);
    expect(result[0].ts).toBe("1700000001.000000");
    expect(result[0].authorId).toBe("U1");
    expect(result[0].permalink).toBe("https://slack.com/1");
    expect(result[0].edited).toBe(false);
    expect(result[0].files).toEqual([]);

    expect(result[1].ts).toBe("1700000002.000000");
    expect(result[1].authorId).toBe("U2");
    expect(result[1].permalink).toBe("https://slack.com/2");
    expect(result[1].edited).toBe(true);
    expect(result[1].files).toEqual([{ filename: "doc.txt", url: "https://file" }]);

    // Check that we hit the scroll top = 0 fallback (or beginning found fallback)
    expect(scrollTop).toBeLessThanOrEqual(0);
    expect(evaluateMock).toHaveBeenCalled();
  });

  it("Task 2.2: Early Exit (with sinceTs provided) - stops scrolling immediately on encountering sinceTs", async () => {
    // Set up mock messages: one newer, one older/equal to sinceTs
    mockMessages = [
      { ts: "1700000006.000000", author: "User3", authorId: "U3", text: "Msg 3", hasReplies: false },
      { ts: "1700000004.000000", author: "User4", authorId: "U4", text: "Msg 4", hasReplies: false },
    ];

    // sinceTs is 1700000005.000000
    // Msg 3 is newer, Msg 4 is older. So Msg 4 triggers the early exit!
    const result = await scrapeChannelHistory(pageMock, { sinceTs: "1700000005.000000" });

    // Result should only contain the message newer than sinceTs
    expect(result).toHaveLength(1);
    expect(result[0].ts).toBe("1700000006.000000");
    expect(result[0].authorId).toBe("U3");

    // Check that we exited early without scrolling fully up
    expect(scrollTop).toBe(1000); // scrollTop remains 1000 because it is never queried after early exit
    const scrollCalls = evaluateMock.mock.calls.filter(([fn]) => fn.toString().includes("scrollBy"));
    expect(scrollCalls).toHaveLength(1); // Exactly one scroll action was performed
    expect(drainCallCount).toBe(1); // Only drained once
  });

  it("Task 2.2b: Chronological order check - does not discard newer messages in the same batch when older message is at index 0", async () => {
    // Set up mock messages in chronological order oldest-first (as returned by Slack DOM/MutationObserver):
    mockMessages = [
      { ts: "1700000004.000000", author: "User4", authorId: "U4", text: "Msg 4 (older)", hasReplies: false },
      { ts: "1700000006.000000", author: "User3", authorId: "U3", text: "Msg 3 (newer)", hasReplies: false },
    ];

    // sinceTs is 1700000005.000000
    // Msg 4 is older and at index 0. Msg 3 is newer and at index 1.
    // The extractor should NOT exit early before processing Msg 3.
    const result = await scrapeChannelHistory(pageMock, { sinceTs: "1700000005.000000" });

    // Result should still contain the newer message Msg 3!
    expect(result).toHaveLength(1);
    expect(result[0].ts).toBe("1700000006.000000");
    expect(result[0].authorId).toBe("U3");
  });
});
