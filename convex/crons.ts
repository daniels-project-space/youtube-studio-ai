import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Cheap indexed maintenance belongs with the durable records. No Trigger
// machine, provider call, or AI token is involved.
crons.interval(
  "reap expired run leases",
  { minutes: 10 },
  internal.runs.reapExpiredRunLeases,
  {},
);

export default crons;
