// Fire a Trigger task with a JSON payload; prints the run id. Usage:
//   node scripts/val/trigger.mjs <taskId> '<json payload>' [concurrencyKey]
import { config } from 'dotenv'; config({ path: '.env.local' });
if (process.env.TRIGGER_SECRET_KEY_PROD) process.env.TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY_PROD;
const { tasks } = await import('@trigger.dev/sdk');
const [taskId, payloadRaw, ck] = process.argv.slice(2);
const handle = await tasks.trigger(taskId, JSON.parse(payloadRaw), ck ? { concurrencyKey: ck } : undefined);
console.log(handle.id);
