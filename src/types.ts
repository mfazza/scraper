import { z } from "zod";

/**
 * Schema version for the raw scraped message format, used by cleaning and migration scripts.
 */
export const RAW_MESSAGE_SCHEMA_VERSION = 2;

export const FileRefSchema = z.object({
  filename: z.string(),
  url: z.string(),
});

export type FileRef = z.infer<typeof FileRefSchema>;

/**
 * Zod schema and type for a raw scraped message.
 * Parent messages have threadId === ts, while reply messages carry the parent's ts as threadId.
 */
export const RawMessageSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  ts: z.string(),
  threadId: z.string(),
  author: z.string(),
  authorId: z.string().default(""),
  text: z.string(),
  permalink: z.string(),
  edited: z.boolean(),
  files: z.array(FileRefSchema).default([]),
});

export type RawMessage = z.infer<typeof RawMessageSchema>;
