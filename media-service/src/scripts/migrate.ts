import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import { config } from '../config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function runMigration() {
  const pool = new Pool({
    connectionString: config.databaseUrl,
  })

  const migrationPath = path.resolve(__dirname, '../../sql/001_init.sql')
  const sql = fs.readFileSync(migrationPath, 'utf-8')
  await pool.query(sql)
  await pool.end()
  // eslint-disable-next-line no-console
  console.log('Migration completed')
}

runMigration().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed', error)
  process.exit(1)
})
