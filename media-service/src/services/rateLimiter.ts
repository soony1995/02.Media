import Redis from 'ioredis'
import { config } from '../config.js'

const redis = new Redis(config.redisUrl)

export class RateLimiter {
  constructor(
    private readonly windowSeconds: number,
    private readonly maxRequests: number,
  ) {}

  async consume(key: string): Promise<void> {
    const redisKey = `rate:${key}`
    const pipeline = redis.multi()
    pipeline.incr(redisKey)
    pipeline.ttl(redisKey)
    const [incrResult, ttlResult] = (await pipeline.exec()) ?? []
    const current = Number(incrResult?.[1]) || 0
    const ttl = Number(ttlResult?.[1]) || -1
    if (current === 1 || ttl < 0) {
      await redis.expire(redisKey, this.windowSeconds)
    }
    if (current > this.maxRequests) {
      throw new Error('RATE_LIMITED')
    }
  }
}

export const rateLimiter = new RateLimiter(
  config.rateLimit.windowSeconds,
  config.rateLimit.maxRequests,
)
