import { z } from "zod";

/**
 * Derives a filesystem-safe slug by lowercasing and replacing non-alphanumeric characters with dashes.
 */
export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * Supports channels and DMs, with an optional ID to bypass sidebar resolution.
 */
export const ConversationEntrySchema = z
  .object({
    type: z.enum(["channel", "dm"]),
    name: z.string().min(1),
    id: z.string().optional(),
  })
  .transform((data) => ({ ...data, slug: toSlug(data.name) }))
  .refine(
    (data) => {
      // Guard against path-traversal payloads or empty slugs.
      if (data.slug.length === 0) return false;
      if (data.slug.startsWith(".") || data.slug.startsWith("/")) return false;
      if (data.name.startsWith(".") || data.name.startsWith("/")) return false;
      return true;
    },
    {
      message:
        "Invalid conversation name — would produce an unsafe or traversal-shaped filesystem slug",
    },
  );

export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;

/**
 * Configuration schema defining the array of target conversations.
 */
export const ConfigSchema = z.object({
  conversations: z.array(ConversationEntrySchema).min(1),
});

export type Config = z.infer<typeof ConfigSchema>;
