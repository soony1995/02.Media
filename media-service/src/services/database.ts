import { Pool } from 'pg'
import { config } from '../config.js'

export type MediaStatus = 'ACTIVE' | 'DELETED'

export interface MediaObject {
  id: string
  ownerId: string
  originalName: string
  storedKey: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  status: MediaStatus
  uploadedAt: Date
  deletedAt: Date | null
}

export interface CreateMediaObjectInput {
  id: string
  ownerId: string
  originalName: string
  storedKey: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
}

const pool = new Pool({
  connectionString: config.databaseUrl,
})

export const db = {
  async createMediaObject(input: CreateMediaObjectInput): Promise<MediaObject> {
    const query = `
      INSERT INTO media_objects (
        id, owner_id, original_name, stored_key,
        mime_type, size_bytes, width, height, status
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, 'ACTIVE'
      )
      RETURNING *
    `
    const values = [
      input.id,
      input.ownerId,
      input.originalName,
      input.storedKey,
      input.mimeType,
      input.sizeBytes,
      input.width,
      input.height,
    ]
    const result = await pool.query(query, values)
    return mapRow(result.rows[0])
  },

  async listMediaObjects(params: {
    ownerId?: string
    limit: number
    cursor?: string
    includeDeleted?: boolean
  }): Promise<{ items: MediaObject[]; nextCursor?: string }> {
    const conditions: string[] = []
    const values: Array<string | number | boolean | Date> = []
    if (!params.includeDeleted) {
      conditions.push(`status = 'ACTIVE'`)
    }
    if (params.ownerId) {
      values.push(params.ownerId)
      conditions.push(`owner_id = $${values.length}`)
    }
    if (params.cursor) {
      const cursorDate = new Date(params.cursor)
      if (Number.isNaN(cursorDate.getTime())) {
        throw new Error('Invalid cursor')
      }
      values.push(cursorDate)
      conditions.push(`uploaded_at < $${values.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    values.push(params.limit + 1)
    const limitPlaceholder = `$${values.length}`

    const query = `
      SELECT * FROM media_objects
      ${whereClause}
      ORDER BY uploaded_at DESC
      LIMIT ${limitPlaceholder}
    `

    const result = await pool.query(query, values)
    const rows = result.rows.map(mapRow)
    if (rows.length > params.limit) {
      const nextCursor = rows[params.limit].uploadedAt.toISOString()
      return { items: rows.slice(0, params.limit), nextCursor }
    }
    return { items: rows }
  },

  async getMediaObjectById(id: string): Promise<MediaObject | null> {
    const result = await pool.query(`SELECT * FROM media_objects WHERE id = $1`, [id])
    if (result.rowCount === 0) {
      return null
    }
    return mapRow(result.rows[0])
  },

  async softDeleteMediaObject(id: string): Promise<MediaObject | null> {
    const result = await pool.query(
      `
      UPDATE media_objects
      SET status = 'DELETED', deleted_at = NOW()
      WHERE id = $1 AND status != 'DELETED'
      RETURNING *
    `,
      [id],
    )
    if (result.rowCount === 0) {
      return null
    }
    return mapRow(result.rows[0])
  },
}

function mapRow(row: any): MediaObject {
  return {
    id: row.id,
    ownerId: row.owner_id,
    originalName: row.original_name,
    storedKey: row.stored_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width !== null ? Number(row.width) : null,
    height: row.height !== null ? Number(row.height) : null,
    status: row.status,
    uploadedAt: row.uploaded_at,
    deletedAt: row.deleted_at,
  }
}
