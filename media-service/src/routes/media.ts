import path from 'node:path'
import { Router, type Request, type RequestHandler } from 'express'
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

const uploadMultipleFiles: RequestHandler = (req, res, next) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 10 },
  ])(req, res, (error) => {
    if (!error) {
      return next()
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: `File exceeds size limit (${config.maxUploadBytes} bytes)`,
        })
      }
      return res.status(400).json({ message: error.message })
    }

    return next(error)
  })
}

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

function normalizeUploadFilename(originalName: string): string {
  const hasOnlyLatin1 = Array.from(originalName).every((char) => char.charCodeAt(0) <= 0xff)
  if (!hasOnlyLatin1) {
    return originalName
  }

  const decoded = Buffer.from(originalName, 'latin1').toString('utf8')
  if (decoded.includes('\uFFFD')) {
    return originalName
  }
  return decoded
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  })
}

function buildContentDisposition(originalName: string, fallbackName: string): string {
  const encoded = encodeRFC5987Value(originalName)
  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encoded}`
}

function extensionFrom(mimeType: string, fileName?: string): string {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  }

  const mapped = byMime[mimeType]
  if (mapped) {
    return mapped
  }

  const rawExt = fileName ? path.extname(fileName).toLowerCase().slice(1) : ''
  const safeExt = rawExt.replace(/[^a-z0-9]+/g, '')
  return safeExt
}

function buildObjectKey(userId: string, id: string, extension: string): string {
  const suffix = extension ? `.${extension}` : ''
  return `uploads/${userId}/${id}${suffix}`
}

function buildAsciiFallbackFilename(originalName: string, extension: string): string {
  const base = path.basename(originalName, path.extname(originalName))
  const normalizedBase = base
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const fileBase = normalizedBase && /[a-z0-9]/i.test(normalizedBase) ? normalizedBase : 'file'
  const safeExt = extension ? `.${extension}` : ''
  return `${fileBase}${safeExt}`.slice(0, 180)
}

async function buildDownloadUrl(key: string, originalName?: string): Promise<string> {
  if (config.publicRead && config.cdnBaseUrl) {
    return buildPublicUrl(key)
  }

  const responseContentDisposition = originalName
    ? buildContentDisposition(
        originalName,
        buildAsciiFallbackFilename(originalName, extensionFrom('application/octet-stream', originalName)),
      )
    : undefined

  return generatePresignedDownloadUrl({
    key,
    expiresIn: config.presignExpirationSeconds,
    responseContentDisposition,
  })
}

router.post(
  '/media/upload',
  rateLimitMiddleware,
  uploadMultipleFiles,
  asyncHandler(async (req, res) => {
    ensureUser(req)
    const files: Array<Express.Multer.File> = []
    const uploadedFiles = req.files as Record<string, Express.Multer.File[]> | undefined
    if (uploadedFiles?.file?.[0]) {
      files.push(uploadedFiles.file[0])
    }
    if (uploadedFiles?.files?.length) {
      files.push(...uploadedFiles.files)
    }
    if ((req as any).file) {
      files.push((req as any).file)
    }

    if (files.length === 0) {
      return res.status(400).json({ message: 'file field is required' })
    }

    const items = []
    const failed = []

    for (const file of files) {
      try {
        assertMimeType(file.mimetype)

        let metadata: sharp.Metadata
        try {
          metadata = await sharp(file.buffer).metadata()
        } catch (error) {
          const details = error instanceof Error ? error.message : 'Unknown error'
          const message =
            config.nodeEnv === 'production' ? 'Invalid image file' : `Invalid image file: ${details}`
          throw new Error(message)
        }

        const id = uuid()
        const originalNameRaw = file.originalname ?? 'unknown'
        const originalName = normalizeUploadFilename(originalNameRaw)
        const extension = extensionFrom(file.mimetype, originalName)
        const key = buildObjectKey(req.user!.id, id, extension)
        const fallbackFilename = buildAsciiFallbackFilename(originalName, extension)

        await uploadObject({
          key,
          body: file.buffer,
          contentType: file.mimetype,
          contentDisposition: buildContentDisposition(originalName, fallbackFilename),
          metadata: {
            owner: req.user!.id,
          },
        })

        const record = await db.createMediaObject({
          id,
          ownerId: req.user!.id,
          originalName,
          storedKey: key,
          mimeType: file.mimetype,
          sizeBytes: file.size,
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

        const downloadUrl = await buildDownloadUrl(record.storedKey, record.originalName)
        items.push({ ...record, url: downloadUrl })
      } catch (error) {
        failed.push({
          fileName: file.originalname,
          message: error instanceof Error ? error.message : 'Upload failed',
        })
      }
    }

    if (items.length === 0) {
      return res.status(400).json({
        message: failed[0]?.message || 'Upload failed',
        failed,
      })
    }

    if (items.length === 1 && failed.length === 0) {
      return res.status(201).json(items[0])
    }

    return res.status(201).json({ items, failed })
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

    const uploadId = uuid()
    const extension = extensionFrom(payload.data.mimeType, payload.data.fileName)
    const key = buildObjectKey(req.user!.id, uploadId, extension)
    const uploadUrl = await generatePresignedUploadUrl({
      key,
      contentType: payload.data.mimeType,
      expiresIn: config.presignExpirationSeconds,
    })

    return res.status(201).json({
      id: uploadId,
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
        const url =
          item.status === 'ACTIVE' ? await buildDownloadUrl(item.storedKey, item.originalName) : null
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
      const responseContentDisposition = buildContentDisposition(
        media.originalName,
        buildAsciiFallbackFilename(
          media.originalName,
          extensionFrom('application/octet-stream', media.originalName),
        ),
      )

      presignedUrl = await generatePresignedDownloadUrl({
        key: media.storedKey,
        expiresIn: config.presignExpirationSeconds,
        responseContentDisposition,
      })
    }

    return res.json({
      ...media,
      url: media.status === 'ACTIVE' ? await buildDownloadUrl(media.storedKey, media.originalName) : null,
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
