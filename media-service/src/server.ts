import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { config } from './config.js'
import mediaRouter from './routes/media.js'
import { authMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { ensureBucketExists } from './services/storage.js'

const app = express()

app.use(helmet())
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan('combined'))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

async function bootstrap() {
  await ensureBucketExists()
  app.use(authMiddleware)
  app.use(mediaRouter)
  app.use(errorHandler)

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Media service running on port ${config.port}`)
  })
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start media service', error)
  process.exit(1)
})
