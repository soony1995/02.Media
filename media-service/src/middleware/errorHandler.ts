import type { Request, Response, NextFunction } from 'express'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const status = (err as any).statusCode ?? 500
  // eslint-disable-next-line no-console
  console.error(err)
  res.status(status).json({ message: err.message || 'Internal server error' })
}
