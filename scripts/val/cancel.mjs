import { config } from "dotenv"; config({ path: ".env.local" });
if (process.env.TRIGGER_SECRET_KEY_PROD) process.env.TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY_PROD;
const { runs } = await import("@trigger.dev/sdk");
await runs.cancel(process.argv[2]);
console.log("cancelled", process.argv[2]);
