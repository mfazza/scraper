import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeRawMessages } from "../src/scrape/raw-writer.ts";
import { type RawMessage } from "../src/types.ts";
import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TEST_SLUG = "test-writer-slug";
const TEST_DIR = path.join(process.cwd(), ".raw", TEST_SLUG);

describe("writeRawMessages Deduplication & Merge", () => {
  beforeEach(async () => {
    // Clean up test directory before each run
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up test directory after each run
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("Task 2.1: Initial Write creates the file correctly", async () => {
    // Create some messages for a specific day
    const baseTs = 1700000000;
    const msg1: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U123",
      authorId: "",
      text: "Hello world 1",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };
    
    const msg2: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs + 5}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U456",
      authorId: "",
      text: "Hello world 2",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    const writtenPaths = await writeRawMessages(TEST_SLUG, [msg1, msg2]);
    expect(writtenPaths.length).toBeGreaterThan(0);

    // Read the file and verify content
    const content = await readFile(writtenPaths[0], "utf8");
    const parsed = JSON.parse(content) as RawMessage[];
    
    expect(parsed).toHaveLength(2);
    expect(parsed[0].ts).toBe(msg1.ts);
    expect(parsed[1].ts).toBe(msg2.ts);
  });

  it("Task 2.2: Overlapping Merge Write merges and deduplicates by ts, sorts chronologically, and updates fields", async () => {
    const baseTs = 1700000000;
    const msg1: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U123",
      authorId: "",
      text: "Original message 1",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    const msg2: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs + 10}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U456",
      authorId: "",
      text: "Original message 2",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    // First write
    const paths1 = await writeRawMessages(TEST_SLUG, [msg1, msg2]);
    expect(paths1).toHaveLength(1);

    // Second write has an overlap message (msg2, updated/edited) and a new chronological message (msg3) and an earlier message (msg0) to test sorting
    const msg0: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs - 5}.000000`,
      threadId: `${baseTs - 5}.000000`,
      author: "U999",
      authorId: "",
      text: "Earlier message 0",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    const msg2Updated: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs + 10}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U456",
      authorId: "",
      text: "Updated message 2 text",
      permalink: "https://foo.bar",
      edited: true,
      files: [],
    };

    const msg3: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs + 20}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U789",
      authorId: "",
      text: "New message 3",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    // Second write
    const paths2 = await writeRawMessages(TEST_SLUG, [msg0, msg2Updated, msg3]);
    expect(paths2).toHaveLength(1);
    expect(paths2[0]).toBe(paths1[0]);

    // Read back and assert
    const content = await readFile(paths2[0], "utf8");
    const parsed = JSON.parse(content) as RawMessage[];

    // Expecting: msg0, msg1, msg2Updated, msg3
    expect(parsed).toHaveLength(4);
    
    // Assert correct chronological sorting
    expect(parsed[0].ts).toBe(msg0.ts);
    expect(parsed[1].ts).toBe(msg1.ts);
    expect(parsed[2].ts).toBe(msg2Updated.ts);
    expect(parsed[3].ts).toBe(msg3.ts);

    // Assert update was applied (deduplicated correctly, text updated, edited flag is true)
    expect(parsed[2].text).toBe("Updated message 2 text");
    expect(parsed[2].edited).toBe(true);
  });

  it("Task 2.3: Malformed/empty existing file override skips and overrides malformed JSON gracefully", async () => {
    const baseTs = 1700000000;
    const dummyMsg: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U123",
      authorId: "",
      text: "Dummy",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    const paths = await writeRawMessages(TEST_SLUG, [dummyMsg]);
    expect(paths).toHaveLength(1);
    const targetFile = paths[0];

    // Corrupt the file manually
    await writeFile(targetFile, "{ corrupted json: null, ", "utf8");

    // Spy on console.warn to verify warning is logged
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Now write a valid message again
    const validMsg: RawMessage = {
      schemaVersion: 1,
      ts: `${baseTs + 10}.000000`,
      threadId: `${baseTs}.000000`,
      author: "U456",
      authorId: "",
      text: "Valid after corruption",
      permalink: "https://foo.bar",
      edited: false,
      files: [],
    };

    const paths2 = await writeRawMessages(TEST_SLUG, [validMsg]);
    expect(paths2).toHaveLength(1);
    expect(paths2[0]).toBe(targetFile);

    // Verify warning was logged
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    // Read back and assert: the file should have ONLY validMsg (corruption discarded, not crashed)
    const content = await readFile(targetFile, "utf8");
    const parsed = JSON.parse(content) as RawMessage[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].ts).toBe(validMsg.ts);
    expect(parsed[0].text).toBe("Valid after corruption");
  });

  it("Task 2.4: writeRawMessages dynamically compiles and updates user-cache.json", async () => {
    const cachePath = path.join(process.cwd(), ".raw", "user-cache-writer-test.json");
    await rm(cachePath, { force: true });
    process.env.USER_CACHE_PATH = cachePath;

    const baseTs = 1700000000;
    const msg1: RawMessage = {
      schemaVersion: 2,
      ts: `${baseTs}.000000`,
      threadId: `${baseTs}.000000`,
      author: "Em Fazza",
      authorId: "U12345",
      text: "Text 1",
      permalink: "https://slack",
      edited: false,
      files: [],
    };

    const msg2: RawMessage = {
      schemaVersion: 2,
      ts: `${baseTs + 5}.000000`,
      threadId: `${baseTs}.000000`,
      author: "Em Fazza",
      authorId: "U67890",
      text: "Text 2",
      permalink: "https://slack",
      edited: false,
      files: [],
    };

    await writeRawMessages(TEST_SLUG, [msg1, msg2]);

    // Read cache and assert
    const cacheContent = await readFile(cachePath, "utf8");
    const cache = JSON.parse(cacheContent);

    expect(cache).toEqual({
      "U12345": "Em Fazza",
      "U67890": "Em Fazza"
    });

    // Test merge mapping (subsequent run with new/updated users)
    const msg3: RawMessage = {
      schemaVersion: 2,
      ts: `${baseTs + 10}.000000`,
      threadId: `${baseTs}.000000`,
      author: "Em Fazza Updated",
      authorId: "U67890",
      text: "Text 3",
      permalink: "https://slack",
      edited: false,
      files: [],
    };

    const msg4: RawMessage = {
      schemaVersion: 2,
      ts: `${baseTs + 15}.000000`,
      threadId: `${baseTs}.000000`,
      author: "Em Fazza",
      authorId: "U99999",
      text: "Text 4",
      permalink: "https://slack",
      edited: false,
      files: [],
    };

    await writeRawMessages(TEST_SLUG, [msg3, msg4]);

    const updatedCacheContent = await readFile(cachePath, "utf8");
    const updatedCache = JSON.parse(updatedCacheContent);

    expect(updatedCache).toEqual({
      "U12345": "Em Fazza",
      "U67890": "Em Fazza Updated",
      "U99999": "Em Fazza"
    });

    // Clean up
    await rm(cachePath, { force: true });
    delete process.env.USER_CACHE_PATH;
  });
});
