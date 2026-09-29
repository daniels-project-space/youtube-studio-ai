import assert from "node:assert/strict";
import { shouldShowOperationsTrigger } from "./operationsAccessRoutes";

for (const pathname of [
  "/settings",
  "/casefile",
  "/editorial-evidence",
]) {
  assert.equal(
    shouldShowOperationsTrigger(pathname),
    true,
    `${pathname} has an owner action and keeps the contextual trigger`,
  );
}

for (const pathname of [
  "/",
  "/studio",
  "/production",
  "/schedule",
  "/library",
  "/analytics",
  "/render-engine",
  "/seo",
  "/tools",
  "/channels",
  "/channels/new",
  "/channels/inked-histories",
  "/channels-old",
]) {
  assert.equal(
    shouldShowOperationsTrigger(pathname),
    false,
    `${pathname} is a read-only or unrelated surface and stays uncluttered`,
  );
}

assert.equal(shouldShowOperationsTrigger(null), false);
console.log("Operations trigger route contract passed");
