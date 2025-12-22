import { ColumnType } from 'kysely'

export type MediaStatus = 'ACTIVE' | 'DELETED'

export interface MediaObjectsTable {
  id: string
  owner_id: string
  original_name: string
  stored_key: string
  mime_type: string
  size_bytes: ColumnType<string, number, number>
  width: number | null
  height: number | null
  status: string
  uploaded_at: ColumnType<Date, Date | undefined, Date | undefined>
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>
}

export interface Database {
  media_objects: MediaObjectsTable
}
