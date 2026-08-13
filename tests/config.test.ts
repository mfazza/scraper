import { describe, it, expect } from "vitest";
import { ConversationEntrySchema, ConfigSchema } from "../src/config/schema.ts";
import { RawMessageSchema } from "../src/types.ts";

describe("ConversationEntrySchema", () => {
  it("derives a filesystem-safe slug from a channel name", () => {
    const result = ConversationEntrySchema.parse({
      type: "channel",
      name: "General Chat!",
    });
    expect(result).toEqual({
      type: "channel",
      name: "General Chat!",
      slug: "general-chat-",
    });
  });

  it("throws for a traversal-shaped name", () => {
    expect(() =>
      ConversationEntrySchema.parse({ type: "channel", name: "../etc" }),
    ).toThrow();
  });
});

describe("ConfigSchema", () => {
  it("throws when conversations list is empty", () => {
    expect(() => ConfigSchema.parse({ conversations: [] })).toThrow();
  });
});

describe("RawMessageSchema", () => {
  it("parses a valid raw message and exposes all eight fields", () => {
    const input = {
      schemaVersion: 1,
      ts: "1700000000.000100",
      threadId: "1700000000.000100",
      author: "Alice",
      text: "hi",
      permalink: "https://example.slack.com/archives/C1/p1700000000000100",
      edited: false,
      files: [],
    };
    const result = RawMessageSchema.parse(input);
    expect(result).toEqual({ ...input, authorId: "" });
    expect(Object.keys(result).sort()).toEqual(
      [
        "schemaVersion",
        "ts",
        "threadId",
        "author",
        "authorId",
        "text",
        "permalink",
        "edited",
        "files",
      ].sort(),
    );
  });
});
