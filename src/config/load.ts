import { readFile } from "node:fs/promises";
import { ConfigSchema, type Config } from "./schema.ts";

/**
 * Reads and validates the conversations config file, throwing on malformed config.
 */
export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}
