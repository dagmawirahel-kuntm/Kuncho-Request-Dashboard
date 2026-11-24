// Download every file in every Supabase Storage bucket into a folder, keeping
// the bucket/path layout. Database dumps hold only the files' metadata, so the
// weekly backup (.github/workflows/weekly-backup.yml) runs this beside them.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/backup-storage.ts <out-dir>
//
// Exits non-zero if any file could not be downloaded, so a half backup is
// never mistaken for a whole one.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const outDir = process.argv[2]
if (!url || !key || !outDir) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/backup-storage.ts <out-dir>')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })
const PAGE = 1000

/** Every object path under `prefix` in `bucket`, walking folders. */
async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const paths: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      // Folders come back without an id; files have one.
      if (item.id === null) paths.push(...await listAll(bucket, path))
      else paths.push(path)
    }
    if (data.length < PAGE) break
  }
  return paths
}

const { data: buckets, error } = await db.storage.listBuckets()
if (error) { console.error(`listBuckets: ${error.message}`); process.exit(1) }

let files = 0, bytes = 0, failed = 0
for (const bucket of buckets) {
  const paths = await listAll(bucket.name)
  for (const path of paths) {
    const { data, error: dlError } = await db.storage.from(bucket.name).download(path)
    if (dlError || !data) { console.error(`  failed ${bucket.name}/${path}: ${dlError?.message ?? 'no data'}`); failed++; continue }
    const buf = Buffer.from(await data.arrayBuffer())
    const target = join(outDir, bucket.name, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buf)
    files++; bytes += buf.length
  }
  console.log(`${bucket.name}: ${paths.length} files`)
}

console.log(`\n${files} files, ${(bytes / 1048576).toFixed(1)} MB${failed ? `, ${failed} FAILED` : ''}`)
if (failed) process.exit(1)
