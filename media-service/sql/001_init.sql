CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS media_objects (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL,
    original_name TEXT NOT NULL,
    stored_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_owner ON media_objects(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_status ON media_objects(status);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at ON media_objects(uploaded_at DESC);
