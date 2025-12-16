import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config as appConfig } from '../config.js'

const s3Config: S3ClientConfig = {
  region: appConfig.storage.region,
  credentials: {
    accessKeyId: appConfig.storage.accessKey,
    secretAccessKey: appConfig.storage.secretKey,
  },
  forcePathStyle: appConfig.storage.forcePathStyle,
}

if (appConfig.storage.endpoint) {
  s3Config.endpoint = appConfig.storage.endpoint
}

const s3 = new S3Client(s3Config)

const presignClientConfig: S3ClientConfig = {
  ...s3Config,
}

if (appConfig.storage.publicEndpoint) {
  presignClientConfig.endpoint = appConfig.storage.publicEndpoint
}

const s3Presign = new S3Client(presignClientConfig)

const bucket = appConfig.storage.bucket

export async function uploadObject(params: {
  key: string
  body: Buffer
  contentType: string
  contentDisposition?: string
  metadata?: Record<string, string>
}): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType,
    ContentDisposition: params.contentDisposition,
    Metadata: params.metadata,
  })
  await s3.send(command)
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  )
}

export async function generatePresignedUploadUrl(params: {
  key: string
  contentType: string
  expiresIn: number
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
  })
  return getSignedUrl(s3Presign, command, { expiresIn: params.expiresIn })
}

export async function generatePresignedDownloadUrl(params: {
  key: string
  expiresIn: number
  responseContentDisposition?: string
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ResponseContentDisposition: params.responseContentDisposition,
  })
  return getSignedUrl(s3Presign, command, { expiresIn: params.expiresIn })
}

export function buildPublicUrl(key: string): string {
  if (appConfig.cdnBaseUrl) {
    return `${appConfig.cdnBaseUrl.replace(/\/$/, '')}/${key}`
  }
  if (appConfig.storage.endpoint) {
    return `${appConfig.storage.endpoint.replace(/\/$/, '')}/${bucket}/${encodeURI(key)}`
  }
  return `https://${bucket}.s3.${appConfig.storage.region}.amazonaws.com/${key}`
}

export async function ensureBucketExists(): Promise<void> {
  try {
    await s3.send(
      new HeadBucketCommand({
        Bucket: bucket,
      }),
    )
  } catch {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
      }),
    )
  }
}
