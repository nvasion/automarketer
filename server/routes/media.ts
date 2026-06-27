import { Router, json } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mediaStore } from '../db/mediaTable.js';

const router = Router();

/** Maximum accepted image size (decoded bytes). */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Image types we accept and re-serve. */
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Build the absolute, publicly-fetchable URL for a media item.
 *
 * Prefers FRONTEND_URL (the app's own origin) because platforms such as
 * Instagram fetch the image server-side and need an absolute https URL. Falls
 * back to the request's host when FRONTEND_URL is not configured (local dev).
 */
function buildMediaUrl(req: Request, id: string): string {
  const base = process.env.FRONTEND_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;
  return `${base}/api/media/${id}`;
}

/**
 * POST /api/media — authenticated image upload.
 *
 * Body (JSON): { mimeType: string, dataBase64: string, filename?: string }
 * Returns: { id, url } where url is the public GET endpoint below.
 *
 * Uses a route-scoped JSON parser with a raised limit so base64 image payloads
 * are accepted (the global parser keeps its small default for every other route).
 */
router.post(
  '/',
  requireAuth,
  json({ limit: '15mb' }),
  async (req: Request, res: Response): Promise<void> => {
    const { mimeType, dataBase64 } = (req.body ?? {}) as {
      mimeType?: unknown;
      dataBase64?: unknown;
    };

    if (typeof mimeType !== 'string' || !ALLOWED_TYPES.has(mimeType)) {
      res.status(400).json({
        error: `Unsupported image type. Allowed: ${[...ALLOWED_TYPES].join(', ')}`,
        code: 'INVALID_MEDIA_TYPE',
      });
      return;
    }
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
      res.status(400).json({ error: 'Missing image data (dataBase64)', code: 'INVALID_MEDIA' });
      return;
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ error: 'Image data is empty or not valid base64', code: 'INVALID_MEDIA' });
      return;
    }
    if (buffer.length > MAX_BYTES) {
      res.status(413).json({
        error: `Image exceeds the ${Math.floor(MAX_BYTES / (1024 * 1024))} MB limit`,
        code: 'MEDIA_TOO_LARGE',
      });
      return;
    }

    const id = await mediaStore.create({ userId: req.user!.sub, mimeType, data: buffer });
    res.status(201).json({ id, url: buildMediaUrl(req, id) });
  },
);

/**
 * GET /api/media/:id — public image fetch.
 *
 * Intentionally unauthenticated: the random UUID acts as an unguessable token,
 * and external platforms (e.g. Instagram) must be able to fetch the image by
 * URL during publishing.
 */
router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const media = await mediaStore.get(req.params.id);
  if (!media) {
    res.status(404).json({ error: 'Media not found', code: 'MEDIA_NOT_FOUND' });
    return;
  }
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(media.data);
});

export default router;
