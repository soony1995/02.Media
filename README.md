# Media Module

이 디렉터리는 MinIO 기반의 오브젝트 스토리지를 사용하여 이미지 업로드/조회/Presigned URL 발급을 제공하는 Node.js(TypeScript) 서비스를 포함한다. `docs/DEV_SPECS.md`에 설계가 정리되어 있으며, 여기서는 빠른 실행 방법을 다룬다.

## 구성 요소

- `media-service/` – Express + Multer + AWS SDK 기반 API 서버.
- `docker-compose.yml` – Postgres, Redis, MinIO, media-service 컨테이너를 한 번에 띄우는 개발용 스택.
- `docs/DEV_SPECS.md` – 기능/아키텍처 명세.

## 빠른 시작

```bash
cd 2.Media
# 최초 1회 env 파일 작성
cp media-service/.env.example media-service/.env

# 의존성 설치
cd media-service
npm install
cd ..

# 인프라 + 서비스 기동
docker compose up --build
```

서비스는 기본적으로 `http://localhost:4001`에서 노출된다. MinIO 콘솔은 `http://localhost:9001` (ID/PW: `minio`/`minio123`), 버킷 이름은 `media-uploads`.
미디어 서비스는 부팅 시 버킷이 없으면 자동으로 생성한다.

## 주요 엔드포인트

| Method | Path | 설명 |
| --- | --- | --- |
| `POST /media/upload` | 멀티파트 업로드. `x-user-id` 헤더 필수. |
| `POST /media/presign` | Presigned URL 생성. JSON Body: `{ fileName, mimeType, sizeBytes }`. |
| `GET /media` | 자신의 업로드 목록 조회. `?scope=all`은 관리자(`x-user-role: ADMIN`) 전용. |
| `GET /media/:id` | 단일 메타데이터, `?presign=true`로 다운로드 URL 포함. |
| `DELETE /media/:id` | Soft delete. |

## 마이그레이션

```bash
cd media-service
npm run migrate
```

`sql/001_init.sql`이 DB에 적용되어 `media_objects` 테이블을 생성한다.

## 기타

- Presigned URL을 사용하는 경우 MinIO/S3 endpoint가 공개로 접근 가능해야 한다.
- 실제 JWT 검증 키(`JWT_PUBLIC_KEY`)를 `.env`에 설정하면 `Authorization: Bearer` 헤더 검증이 활성화된다. 키가 없으면 `x-user-id` 헤더만 체크한다.
