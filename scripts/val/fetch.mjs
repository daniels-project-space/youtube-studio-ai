// Download an R2 object to a local path using the repo's storage lib.
// Usage: npx tsx scripts/val/fetch.mjs <r2key> <outPath>
import { config } from 'dotenv'; config({ path: '.env.local' });
const { bootstrapSecrets } = await import('../../src/lib/bootstrap.ts');
await bootstrapSecrets(() => {});
const { getObjectBytes } = await import('../../src/lib/storage.ts');
const { writeFile } = await import('node:fs/promises');
const bytes = await getObjectBytes(process.argv[2]);
await writeFile(process.argv[3], Buffer.from(bytes));
console.log('saved', process.argv[3], bytes.length, 'bytes');
