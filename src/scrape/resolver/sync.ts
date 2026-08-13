import fs from "node:fs/promises";
import path from "node:path";
import { RawMessageSchema, type RawMessage } from "../../types.ts";

/**
 * Validates slug characters to prevent directory traversal.
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

/**
 * Scans the raw data directory for the given slug, finds the latest YYYY-MM-DD.json, and returns the maximum timestamp (ts).
 * Returns null if the directory does not exist, is empty, or contains no valid messages.
 */
export async function getLatestSyncPointer(conversationSlug: string): Promise<string | null> {
  if (!isValidSlug(conversationSlug)) {
    throw new Error(`Invalid conversation slug: ${conversationSlug}`);
  }

  const dirPath = path.join(process.cwd(), ".raw", conversationSlug);

  try {
    const files = await fs.readdir(dirPath);
    if (files.length === 0) {
      return null;
    }

    const dailyFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    if (dailyFiles.length === 0) {
      return null;
    }

    // Alphabetical sort matches chronological order.
    dailyFiles.sort();

    for (let i = dailyFiles.length - 1; i >= 0; i--) {
      const file = dailyFiles[i];
      const filePath = path.join(dirPath, file);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const messages = JSON.parse(content);

        if (!Array.isArray(messages) || messages.length === 0) {
          console.warn(`Warning: Invalid or empty JSON array in ${file}`);
          continue;
        }

        const validMessages = messages
          .map(m => {
            const parsed = RawMessageSchema.safeParse(m);
            return parsed.success ? parsed.data : null;
          })
          .filter((m): m is RawMessage => m !== null);

        if (validMessages.length === 0) {
          console.warn(`Warning: No valid messages in ${file}`);
          continue;
        }

        let maxMessage = validMessages[0];
        let maxTsVal = parseFloat(maxMessage.ts);

        for (let j = 1; j < validMessages.length; j++) {
          const tsVal = parseFloat(validMessages[j].ts);
          if (tsVal > maxTsVal) {
            maxTsVal = tsVal;
            maxMessage = validMessages[j];
          }
        }

        return maxMessage.ts;
      } catch (error: any) {
        console.warn(`Warning: Failed to parse/read file ${file}: ${error?.message || error}`);
        continue;
      }
    }

    return null;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
