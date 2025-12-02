import type { Request, Response, NextFunction } from 'express'
import { rateLimiter } from '../services/rateLimiter.js'

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id ?? 'anonymous'
  try {
    await rateLimiter.consume(userId)
    next()
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') {
      return res.status(429).json({ message: 'Too many requests' })
    }
    next(error)
  }
}
