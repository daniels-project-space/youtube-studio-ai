// Poll a Trigger run. Usage: node scripts/val/status.mjs <runId>
import { config } from 'dotenv'; config({ path: '.env.local' });
if (process.env.TRIGGER_SECRET_KEY_PROD) process.env.TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY_PROD;
const { runs } = await import('@trigger.dev/sdk');
const r = await runs.retrieve(process.argv[2]);
console.log(JSON.stringify({ status: r.status, output: r.output ?? null, error: r.error ?? null, durationMs: r.durationMs }, null, 1).slice(0, 3000));
