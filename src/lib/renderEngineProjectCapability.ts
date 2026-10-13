import { createHmac } from "node:crypto";

const PROJECT_NAME = /^[a-z][a-z0-9-]{2,63}$/;

export function deriveRenderEngineProjectCapability(secret: string, projectName: string): string {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 64) {
    throw new Error("Render Engine management project secret is invalid");
  }
  if (!PROJECT_NAME.test(projectName)) throw new Error("Render Engine project name is invalid");
  return createHmac("sha256", secret).update(`render-management-v1:${projectName}`).digest("hex");
}
