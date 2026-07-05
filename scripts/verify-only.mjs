import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { fetchGeoScene3D, DEFAULT_ART, clampArt, verifyGeoRender } from "../src/lib/geoCinema.ts";
const log = (m) => console.error(`[v] ${m}`);
await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });
const RUN = "/home/ubuntu/geo-antwerp";
const scene = await fetchGeoScene3D("Hoveniersstraat, Antwerp, Belgium", join(RUN, "geo"), 620, log);
const v = await verifyGeoRender({ scene, art: clampArt(DEFAULT_ART), runDir: join(RUN, "verifyonly"), round: 1, log });
console.log(JSON.stringify(v, null, 2));
