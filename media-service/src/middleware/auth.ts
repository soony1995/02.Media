import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'

function extractToken(authorizationHeader?: string | null): string | null {
  if (!authorizationHeader) {
    return null
  }
  const [scheme, token] = authorizationHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }
  return token
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const xUserId = req.header('x-user-id')
  const xUserRole = req.header('x-user-role') ?? 'USER'

  if (!xUserId && config.jwt.publicKey) {
    const token = extractToken(req.header('authorization'))
    if (!token) {
      return res.status(401).json({ message: 'Missing authorization' })
    }
    try {
      const payload = jwt.verify(token, config.jwt.publicKey, {
        audience: config.jwt.audience,
        issuer: config.jwt.issuer,
        algorithms: ['RS256', 'RS512', 'ES256', 'ES384'],
      }) as jwt.JwtPayload
      req.user = {
        id: payload.sub as string,
        role: (payload.role as string) ?? 'USER',
      }
      return next()
    } catch (error) {
      return res.status(401).json({ message: 'Invalid token' })
    }
  }

  if (!xUserId) {
    return res.status(401).json({ message: 'Missing x-user-id header' })
  }

  req.user = { id: xUserId, role: xUserRole.toUpperCase() }
  return next()
}
