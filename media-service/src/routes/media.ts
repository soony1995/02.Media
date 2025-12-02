import { Router, type Request } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { config } from '../config.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  buildPublicUrl,
  deleteObject,
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
  uploadObject,
} from '../services/storage.js'
import { db } from '../services/database.js'
import { rateLimitMiddleware } from '../middleware/rateLimit.js'
import { publishMediaEvent } from '../services/publisher.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
  },
})

const presignSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  scope: z.enum(['self', 'all']).default('self'),
})

function ensureUser(req: Request): asserts req is Request & { user: { id: string; role: string } } {
  if (!req.user) {
    const error = new Error('Unauthorized')
    ;(error as any).statusCode = 401
    throw error
  }
}

const allowedMimeTypes = new Set(config.allowedMimeTypes)

function assertMimeType(mimeType: string) {
  if (!allowedMimeTypes.has(mimeType)) {
    const message = `Unsupported mime type. Allowed: ${Array.from(allowedMimeTypes).join(', ')}`
    const error = new Error(message)
    ;(error as any).statusCode = 400
    throw error
  }
}

function buildObjectKey(userId: string, fileName: string): string {
  const sanitized = fileName.replace(/[^\w.\-]/g, '_')
  return `uploads/${userId}/${Date.now()}-${sanitized}`
}

async function buildDownloadUrl(key: string): Promise<string> {
  if (config.publicRead && config.cdnBaseUrl) {
    return buildPublicUrl(key)
  }
  return generatePresignedDownloadUrl({
    key,
    expiresIn: config.presignExpirationSeconds,
  })
}

router.post(
  '/media/upload',
  rateLimitMiddleware,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    ensureUser(req)
    if (!req.file) {
      return res.status(400).json({ message: 'file field is required' })
    }
    assertMimeType(req.file.mimetype)

    const metadata = await sharp(req.file.buffer).metadata()
    const id = uuid()
    const key = buildObjectKey(req.user!.id, req.file.originalname || id)

    await uploadObject({
      key,
      body: req.file.buffer,
      contentType: req.file.mimetype,
      metadata: {
        owner: req.user!.id,
        originalName: req.file.originalname ?? 'unknown',
      },
    })

    const record = await db.createMediaObject({
      id,
      ownerId: req.user!.id,
      originalName: req.file.originalname ?? 'unknown',
      storedKey: key,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    })

    await publishMediaEvent({
      id: record.id,
      ownerId: record.ownerId,
      storedKey: record.storedKey,
      action: 'uploaded',
      timestamp: new Date().toISOString(),
    })

    const downloadUrl = await buildDownloadUrl(record.storedKey)

    return res.status(201).json({
      ...record,
      url: downloadUrl,
    })
  }),
)

router.post(
  '/media/presign',
  rateLimitMiddleware,
  asyncHandler(async (req, res) => {
    ensureUser(req)
    const payload = presignSchema.safeParse(req.body)
    if (!payload.success) {
      return res.status(400).json({ message: payload.error.message })
    }

    assertMimeType(payload.data.mimeType)
    if (payload.data.sizeBytes > config.maxUploadBytes) {
      return res.status(400).json({ message: 'File exceeds size limit' })
    }

    const key = buildObjectKey(req.user!.id, payload.data.fileName)
    const uploadUrl = await generatePresignedUploadUrl({
      key,
      contentType: payload.data.mimeType,
      expiresIn: config.presignExpirationSeconds,
    })

    return res.status(201).json({
      uploadUrl,
      key,
      expiresIn: config.presignExpirationSeconds,
      metadata: {
        ownerId: req.user!.id,
        mimeType: payload.data.mimeType,
        sizeBytes: payload.data.sizeBytes,
      },
    })
  }),
)

router.get(
  '/media',
  asyncHandler(async (req, res) => {
    ensureUser(req)
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message })
    }
    const scope = parsed.data.scope
    const limit = parsed.data.limit
    const cursor = parsed.data.cursor

    const ownerId = scope === 'self' ? req.user!.id : req.user!.role === 'ADMIN' ? undefined : req.user!.id
    const includeDeleted = scope === 'all' && req.user!.role === 'ADMIN'

    const result = await db.listMediaObjects({
      ownerId,
      limit,
      cursor,
      includeDeleted,
    })

    const itemsWithUrls = await Promise.all(
      result.items.map(async (item) => {
        const url = item.status === 'ACTIVE' ? await buildDownloadUrl(item.storedKey) : null
        return { ...item, url }
      }),
    )

    return res.json({
      items: itemsWithUrls,
      nextCursor: result.nextCursor,
    })
  }),
)

router.get(
  '/media/:id',
  asyncHandler(async (req, res) => {
    ensureUser(req)
    const media = await db.getMediaObjectById(req.params.id)
    if (!media) {
      return res.status(404).json({ message: 'Not found' })
    }
    if (media.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const includePresign = String(req.query.presign).toLowerCase() === 'true'
    let presignedUrl: string | undefined
    if (includePresign) {
      presignedUrl = await generatePresignedDownloadUrl({
        key: media.storedKey,
        expiresIn: config.presignExpirationSeconds,
      })
    }

    return res.json({
      ...media,
      url: media.status === 'ACTIVE' ? buildPublicUrl(media.storedKey) : null,
      presignedUrl,
    })
  }),
)

router.delete(
  '/media/:id',
  rateLimitMiddleware,
  asyncHandler(async (req, res) => {
    ensureUser(req)
    const target = await db.getMediaObjectById(req.params.id)
    if (!target) {
      return res.status(404).json({ message: 'Not found' })
    }
    if (target.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const deleted = await db.softDeleteMediaObject(target.id)
    if (deleted) {
      await publishMediaEvent({
        id: deleted.id,
        ownerId: deleted.ownerId,
        storedKey: deleted.storedKey,
        action: 'deleted',
        timestamp: new Date().toISOString(),
      })
    }

    // Soft delete keeps object until async purge. Provide flag for immediate removal via query.
    if (String(req.query.purge).toLowerCase() === 'true') {
      await deleteObject(target.storedKey)
    }

    return res.json({ message: 'Deleted' })
  }),
)

export default router
