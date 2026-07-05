import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(()=>{});
const keys = Object.keys(process.env).filter(k=>/FAL|HIGGS|RUNWAY|LUMA|MINIMAX|HAILUO|KLING|PIKA|VEO|REPLICATE|STABILITY|VIDEO/i.test(k));
console.log("VIDEO_KEYS:", keys.join(", ")||"none");
