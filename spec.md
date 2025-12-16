# Media Service Specification & Data Flow

## Overview
The Media Service (`02.Media`) is a dedicated microservice responsible for handling media asset lifecycles. It provides capabilities for secure file uploads, metadata management, and serving media content. The service is designed to be cloud-agnostic (supporting S3-compatible storage) and event-driven.

## System Architecture

The following diagram illustrates the high-level architecture and the interaction between the Media Service and its dependencies:

```mermaid
graph TD
    User[Client / Frontend]
    Gateway[API Gateway / Nginx]
    Auth[Auth Service]
    
    subgraph "Media Service Scope"
        API[Express API]
        Processor["Image Processor (Sharp)"]
        Pub[Event Publisher]
    end

    DB[("PostgreSQL")]
    Storage[("S3 / MinIO")]
    MsgBroker(("Redis Pub/Sub"))

    User -->|HTTPS| Gateway
    Gateway -->|HTTP| API
    
    API -->|Auth Check| Auth
    API -->|Metadata| DB
    API -->|File Stream| Storage
    API -->|Extract Metadata| Processor
    
    API -->|Notify| Pub
    Pub -->|Publish Event| MsgBroker
```

## Data Flow Workflows

### 1. Direct File Upload (`POST /media/upload`)
This flow handles small to medium-sized file uploads directly through the service.

```mermaid
sequenceDiagram
    participant Client
    participant API as Media Service API
    participant Auth as Auth Middleware
    participant S3 as "Object Storage (S3)"
    participant DB as PostgreSQL
    participant Redis as "Redis Pub/Sub"

    Client->>API: POST /media/upload (multipart/form-data)
    activate API
    
    API->>Auth: Validate Token / Headers
    alt Invalid Auth
        Auth-->>API: 401 Unauthorized
        API-->>Client: 401 Error
    end

    Note over API: Multer receives file stream
    
    API->>API: Validate MIME Type & Size
    API->>API: Generate Unique Key (UUID)
    API->>API: Extract Metadata (Width, Height) via Sharp

    par Parallel Execution
        API->>S3: Upload File Buffer
        S3-->>API: Success (ETag)
    and
        API->>DB: INSERT INTO media_objects (id...)
        DB-->>API: Success
    end

    API->>Redis: PUBLISH 'photo:uploaded'
    
    API-->>Client: 201 Created (Media Object JSON)
    deactivate API
```

### 2. Presigned URL Upload (`POST /media/presign`)
This flow is optimized for large files, allowing clients to upload directly to S3.

```mermaid
sequenceDiagram
    participant Client
    participant API as Media Service API
    participant S3 as "Object Storage (S3)"

    Client->>API: POST /media/presign (filename, fileType)
    activate API
    
    API->>API: Authorize Request
    API->>S3: Generate Presigned PUT URL
    S3-->>API: Signed URL
    
    API-->>Client: 200 OK (uploadUrl, key, publicUrl)
    deactivate API

    Note right of Client: Client uploads directly to Storage
    Client->>S3: PUT {uploadUrl} (File Content)
    S3-->>Client: 200 OK

    Note over Client, API: Client usually notifies API to sync DB
```

### 3. Media Retrieval (`GET /media/:id`)

```mermaid
sequenceDiagram
    participant Client
    participant API as Media Service API
    participant DB as PostgreSQL
    participant S3 as "Object Storage (S3)"

    Client->>API: GET /media/:id
    activate API
    
    API->>DB: SELECT * FROM media_objects WHERE id = :id
    
    alt Not Found / Deleted
        DB-->>API: null
        API-->>Client: 404 Not Found
    end

    DB-->>API: Media Metadata
    
    API->>S3: Generate Presigned GET URL (signedUrl)
    S3-->>API: signedUrl
    
    API-->>Client: 200 OK (JSON with signedUrl)
    deactivate API
```

## Database Schema

The service uses a single table `media_objects` in PostgreSQL.

```mermaid
erDiagram
    MEDIA_OBJECTS {
        uuid id PK "Primary Key"
        uuid user_id "Owner ID"
        varchar original_name "Original Filename"
        varchar mime_type "e.g., image/jpeg"
        bigint size_bytes "File Size"
        varchar storage_key "S3 Object Key"
        jsonb metadata "Ex: { width: 1024, height: 768 }"
        timestamp created_at "Creation Time"
        varchar status "active | deleted"
    }
```

## Event Driven Integration

The Media Service acts as a producer in the system's event-driven architecture using Redis.

| Event Channel | Trigger | Payload Structure | Purpose |
| :--- | :--- | :--- | :--- |
| `photo:uploaded` | Successful upload via `/media/upload` | `{ id, userId, url, ... }` | Triggers downstream tasks like AI analysis, thumbnail generation, or feed updates. |
| `photo:deleted` | API Call to `DELETE /media/:id` | `{ id }` | Notifies other services to remove references to this media. |

## Technical Implementation Details
- **Storage Service (`storage.ts`)**: Wraps AWS SDK `PutObjectCommand` and `GetObjectCommand`. Handles bucket initialization.
- **Processing**: Uses `sharp` to analyze image dimensions before storage.
- **Resilience**: Database records use "Soft Delete" (status='deleted') to prevent immediate data loss.