import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type RawMessage, RawMessageSchema } from "../types.ts";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Capture local timezone once at module scope to keep daily partitions consistent.
 */
const LOCAL_TZ = dayjs.tz.guess();

/**
 * Validates, buckets by local day, and writes RawMessage arrays into the hidden `.raw` directory.
 * Performs robust read-merge-deduplicate write transaction per-day to prevent duplicates.
 */
export async function writeRawMessages(conversationSlug: string, messages: RawMessage[]): Promise<string[]> {
  const buckets: Map<string, RawMessage[]> = new Map();

  for (const m of messages) {
    const validated = RawMessageSchema.parse(m);

    const tsNumber = Number(validated.ts);
    const day = dayjs.unix(tsNumber).tz(LOCAL_TZ).format("YYYY-MM-DD");

    if (!buckets.has(day)) {
      buckets.set(day, []);
    }
    buckets.get(day)!.push(validated);
  }

  const writtenPaths: string[] = [];

  for (const [day, dayMessages] of buckets.entries()) {
    const dir = path.join(process.cwd(), ".raw", conversationSlug);
    const filePath = path.join(dir, `${day}.json`);

    await mkdir(dir, { recursive: true });

    let existingMessages: RawMessage[] = [];

    try {
      const content = await readFile(filePath, "utf8");
      try {
        existingMessages = JSON.parse(content) as RawMessage[];
        if (!Array.isArray(existingMessages)) {
          console.warn(`File at ${filePath} is not a valid RawMessage array. Overriding.`);
          existingMessages = [];
        }
      } catch (err) {
        console.warn(`Failed to parse existing JSON at ${filePath}:`, err);
        existingMessages = [];
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`Failed to read existing file at ${filePath}:`, err);
      }
    }

    const dedupedMap = new Map<string, RawMessage>();

    for (const msg of existingMessages) {
      try {
        const validated = RawMessageSchema.parse(msg);
        dedupedMap.set(validated.ts, validated);
      } catch (err) {
        console.warn(`Discarding malformed existing message with ts ${msg?.ts} in ${filePath}:`, err);
      }
    }

    for (const msg of dayMessages) {
      try {
        const validated = RawMessageSchema.parse(msg);
        dedupedMap.set(validated.ts, validated);
      } catch (err) {
        console.warn(`Discarding malformed new message with ts ${msg?.ts}:`, err);
      }
    }

    const merged = Array.from(dedupedMap.values());

    merged.sort((a, b) => Number(a.ts) - Number(b.ts));

    await writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
    writtenPaths.push(filePath);
  }

  await updateUserCache(messages);

  return writtenPaths;
}

/**
 * Updates the user-cache mapping (userId -> displayName) used for clean names across channels.
 */
async function updateUserCache(messages: RawMessage[]): Promise<void> {
  const userMap: Record<string, string> = {};
  for (const m of messages) {
    if (m.authorId && m.author && m.author !== "Unknown") {
      userMap[m.authorId] = m.author;
    }
  }

  if (Object.keys(userMap).length === 0) {
    return;
  }

  const cachePath = process.env.USER_CACHE_PATH || path.join(process.cwd(), ".raw", "user-cache.json");
  let cache: Record<string, string> = {};
  try {
    const content = await readFile(cachePath, "utf8");
    cache = JSON.parse(content);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.warn(`Cache read warning: ${err.message}`);
    }
  }

  let changed = false;
  for (const [uid, name] of Object.entries(userMap)) {
    if (cache[uid] !== name) {
      cache[uid] = name;
      changed = true;
    }
  }

  if (changed) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
  }
}
