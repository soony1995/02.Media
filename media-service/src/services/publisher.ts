import Redis from 'ioredis'
import { config } from '../config.js'

const redis = new Redis(config.redisUrl)

// Redis Pub/Sub 채널명
const CHANNELS = {
  PHOTO_UPLOADED: 'photo:uploaded',
  PHOTO_DELETED: 'photo:deleted',
} as const

export interface MediaEventPayload {
  id: string
  ownerId: string
  storedKey: string
  action: 'uploaded' | 'deleted'
  timestamp: string
}

export async function publishMediaEvent(payload: MediaEventPayload): Promise<void> {
  const channel = payload.action === 'uploaded' 
    ? CHANNELS.PHOTO_UPLOADED 
    : CHANNELS.PHOTO_DELETED

  await redis.publish(channel, JSON.stringify(payload))
  
  // eslint-disable-next-line no-console
  console.log(`[media-event] Published to ${channel}:`, payload.id)
}
