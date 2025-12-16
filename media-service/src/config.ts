import { z } from 'zod'

const DEFAULT_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]

function envBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
        return true
      }
      if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) {
        return false
      }
    }
    return value
  }, z.boolean().default(defaultValue))
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_PUBLIC_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: envBoolean(true),
  CDN_BASE_URL: z.string().optional(),
  PRESIGN_EXPIRATION_SECONDS: z.coerce.number().default(900),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
  ALLOWED_MIME_TYPES: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
  JWT_ISSUER: z.string().optional(),
  PUBLIC_READ: envBoolean(false),
})

const rawConfig = envSchema.parse(process.env)

const allowedTypes =
  rawConfig.ALLOWED_MIME_TYPES?.split(',').map((item) => item.trim()).filter(Boolean) ??
  DEFAULT_ALLOWED_TYPES

export const config = {
  nodeEnv: rawConfig.NODE_ENV,
  port: rawConfig.PORT,
  logLevel: rawConfig.LOG_LEVEL,
  databaseUrl: rawConfig.DATABASE_URL,
  redisUrl: rawConfig.REDIS_URL,
  storage: {
    bucket: rawConfig.STORAGE_BUCKET,
    region: rawConfig.STORAGE_REGION,
    endpoint: rawConfig.STORAGE_ENDPOINT,
    publicEndpoint: rawConfig.STORAGE_PUBLIC_ENDPOINT,
    accessKey: rawConfig.STORAGE_ACCESS_KEY,
    secretKey: rawConfig.STORAGE_SECRET_KEY,
    forcePathStyle: rawConfig.STORAGE_FORCE_PATH_STYLE,
  },
  cdnBaseUrl: rawConfig.CDN_BASE_URL,
  publicRead: rawConfig.PUBLIC_READ,
  presignExpirationSeconds: rawConfig.PRESIGN_EXPIRATION_SECONDS,
  rateLimit: {
    windowSeconds: rawConfig.RATE_LIMIT_WINDOW_SECONDS,
    maxRequests: rawConfig.RATE_LIMIT_MAX_REQUESTS,
  },
  maxUploadBytes: rawConfig.MAX_UPLOAD_BYTES,
  allowedMimeTypes: allowedTypes,
  jwt: {
    publicKey: rawConfig.JWT_PUBLIC_KEY,
    audience: rawConfig.JWT_AUDIENCE,
    issuer: rawConfig.JWT_ISSUER,
  },
}
