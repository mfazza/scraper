import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { getLatestSyncPointer } from "../src/scrape/resolver/sync.ts";

const TEST_SLUG = "test-sync-slug";
const TEST_DIR = path.join(process.cwd(), ".raw", TEST_SLUG);

describe("getLatestSyncPointer", () => {
  beforeEach(async () => {
    // Ensure clean test directory
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeMessage(ts: string) {
    return {
      schemaVersion: 1,
      ts,
      threadId: ts,
      author: "user-abc",
      text: "hello world",
      permalink: `https://workspace.slack.com/archives/C123/p${ts.replace(".", "")}`,
      edited: false,
      files: [],
    };
  }

  it("returns null for non-existent slug", async () => {
    const result = await getLatestSyncPointer("non-existent-slug");
    expect(result).toBeNull();
  });

  it("returns null for empty directory", async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    const result = await getLatestSyncPointer(TEST_SLUG);
    expect(result).toBeNull();
  });

  it("throws an error for invalid slug (directory traversal protection)", async () => {
    await expect(getLatestSyncPointer("../unsafe-slug")).rejects.toThrow();
    await expect(getLatestSyncPointer("unsafe_slug_with_underscore")).rejects.toThrow();
    await expect(getLatestSyncPointer("unsafeSlugWithCamelCase")).rejects.toThrow();
  });

  it("extracts max ts from healthy latest file", async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });

    const messagesDay1 = [makeMessage("1700000000.000100"), makeMessage("1700000000.000200")];
    const messagesDay2 = [makeMessage("1700000100.000500"), makeMessage("1700000100.000300")];

    await fs.writeFile(path.join(TEST_DIR, "2026-07-15.json"), JSON.stringify(messagesDay1), "utf-8");
    await fs.writeFile(path.join(TEST_DIR, "2026-07-16.json"), JSON.stringify(messagesDay2), "utf-8");

    const result = await getLatestSyncPointer(TEST_SLUG);
    expect(result).toBe("1700000100.000500");
  });

  it("skips malformed/empty JSON and falls back to previous healthy file", async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });

    const messagesDay1 = [makeMessage("1700000000.000100"), makeMessage("1700000000.000200")];

    await fs.writeFile(path.join(TEST_DIR, "2026-07-15.json"), JSON.stringify(messagesDay1), "utf-8");
    await fs.writeFile(path.join(TEST_DIR, "2026-07-16.json"), "{ corrupt json ...", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getLatestSyncPointer(TEST_SLUG);
    expect(result).toBe("1700000000.000200");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("skips empty JSON array and falls back to previous healthy file", async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });

    const messagesDay1 = [makeMessage("1700000000.000100"), makeMessage("1700000000.000200")];

    await fs.writeFile(path.join(TEST_DIR, "2026-07-15.json"), JSON.stringify(messagesDay1), "utf-8");
    await fs.writeFile(path.join(TEST_DIR, "2026-07-16.json"), "[]", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getLatestSyncPointer(TEST_SLUG);
    expect(result).toBe("1700000000.000200");
    expect(warnSpy).toHaveBeenCalled();
  });
});
