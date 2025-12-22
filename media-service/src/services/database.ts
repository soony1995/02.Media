import { Kysely, PostgresDialect, type Selectable } from 'kysely'
import { Pool } from 'pg'
import { config } from '../config.js'
import { type Database, type MediaObjectsTable, type MediaStatus } from './database/schema.js'

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

const kysely = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool,
  }),
})

export const db = {
  async createMediaObject(input: CreateMediaObjectInput): Promise<MediaObject> {
    const record = await kysely
      .insertInto('media_objects')
      .values({
        id: input.id,
        owner_id: input.ownerId,
        original_name: input.originalName,
        stored_key: input.storedKey,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        status: 'ACTIVE',
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapRow(record)
  },

  async listMediaObjects(params: {
    ownerId?: string
    limit: number
    cursor?: string
    includeDeleted?: boolean
  }): Promise<{ items: MediaObject[]; nextCursor?: string }> {
    let query = kysely.selectFrom('media_objects').selectAll()
    if (!params.includeDeleted) {
      query = query.where('status', '=', 'ACTIVE')
    }
    if (params.ownerId) {
      query = query.where('owner_id', '=', params.ownerId)
    }
    if (params.cursor) {
      const cursorDate = new Date(params.cursor)
      if (Number.isNaN(cursorDate.getTime())) {
        throw new Error('Invalid cursor')
      }
      query = query.where('uploaded_at', '<', cursorDate)
    }

    const records = await query
      .orderBy('uploaded_at', 'desc')
      .limit(params.limit + 1)
      .execute()

    const items = records.map(mapRow)
    if (items.length > params.limit) {
      const nextCursor = items[params.limit].uploadedAt.toISOString()
      return { items: items.slice(0, params.limit), nextCursor }
    }
    return { items }
  },

  async getMediaObjectById(id: string): Promise<MediaObject | null> {
    const record = await kysely
      .selectFrom('media_objects')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    if (!record) {
      return null
    }
    return mapRow(record)
  },

  async softDeleteMediaObject(id: string): Promise<MediaObject | null> {
    const record = await kysely
      .updateTable('media_objects')
      .set({
        status: 'DELETED',
        deleted_at: new Date(),
      })
      .where('id', '=', id)
      .where('status', '!=', 'DELETED')
      .returningAll()
      .executeTakeFirst()
    if (!record) {
      return null
    }
    return mapRow(record)
  },
}

function mapRow(row: Selectable<MediaObjectsTable>): MediaObject {
  return {
    id: row.id,
    ownerId: row.owner_id,
    originalName: row.original_name,
    storedKey: row.stored_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width !== null ? Number(row.width) : null,
    height: row.height !== null ? Number(row.height) : null,
    status: row.status as MediaStatus,
    uploadedAt: row.uploaded_at,
    deletedAt: row.deleted_at,
  }
}
