# Media Service

TypeScript + Express 기반의 이미지 업로드 API. MinIO/S3 호환 오브젝트 스토리지를 사용하며 Presigned URL 발급, 업로드/조회/삭제 기능을 제공한다.

## 환경 변수

`.env.example`를 참고하여 `.env` 파일을 작성한다.

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | Postgres 연결 문자열 |
| `REDIS_URL` | Redis 연결 문자열 |
| `STORAGE_*` | MinIO/S3 버킷 설정(엔드포인트, 크레덴셜 등) |
| `STORAGE_PUBLIC_ENDPOINT` | (선택) Presigned URL에 사용할 외부 접근용 스토리지 엔드포인트(예: `http://localhost:9000`) |
| `CDN_BASE_URL` | 응답에 포함할 퍼블릭 URL prefix |
| `PRESIGN_EXPIRATION_SECONDS` | Presigned URL 만료 시간 |
| `MAX_UPLOAD_BYTES` | 업로드 허용 최대 용량 |
| `JWT_PUBLIC_KEY` | (선택) JWT 검증용 공개키. 없으면 `x-user-id` 헤더를 사용 |

## 명령어

```bash
npm install

# 개발 모드
npm run dev

# 빌드 & 실행
npm run build
npm start

# DB 마이그레이션
npm run migrate
```

## API 요약

| Method | Path | 설명 |
| --- | --- | --- |
| `POST /media/upload` | 멀티파트 업로드 (field: `file`) |
| `POST /media/presign` | `{ fileName, mimeType, sizeBytes }` 로 Presigned PUT URL 생성 |
| `GET /media` | 기본적으로 본인 업로드만, `?scope=all`은 관리자 전용 |
| `GET /media/:id` | 단일 메타데이터. `url`(ACTIVE일 때) 포함, `?presign=true` 시 `presignedUrl`도 함께 포함 |
| `DELETE /media/:id` | Soft delete. `?purge=true`로 즉시 객체 삭제 가능(테스트용) |

모든 보호된 엔드포인트는 `x-user-id` 헤더 혹은 `Authorization: Bearer` 토큰을 필요로 한다.

로컬 MinIO를 사용할 때 버킷이 public 설정이 아니면 `PUBLIC_READ=false`로 두고 presigned URL을 사용하는 편이 안전하다.
