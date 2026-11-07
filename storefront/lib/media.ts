import "server-only";

// Media types the store accepts from agents (uploads, ingest, client tokens).
export const MEDIA_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export const safeName = (raw: string | null | undefined) =>
  (raw ?? "media").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "media";

export const mediaPath = (name: string, ext: string) =>
  `media/agents/${safeName(name)}-${Math.random().toString(36).slice(2, 12)}.${ext}`;
