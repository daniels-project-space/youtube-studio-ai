// Convex query helper. Usage: node scripts/val/convexq.mjs <path> '<argsJson>'
import { config } from 'dotenv'; config({ path: '.env.local' });
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const res = await fetch(url + '/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: process.argv[2], args: JSON.parse(process.argv[3] ?? '{}'), format: 'json' }) });
console.log(JSON.stringify(await res.json()));
