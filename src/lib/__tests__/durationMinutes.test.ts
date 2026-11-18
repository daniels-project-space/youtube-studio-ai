import assert from "node:assert/strict";
import { durationMinutesToSeconds } from "@/lib/durationMinutes";

assert.equal(durationMinutesToSeconds("180"), 10800);
assert.equal(durationMinutesToSeconds("1.1"), 66);
assert.equal(durationMinutesToSeconds(".5"), 30);
assert.equal(durationMinutesToSeconds("0.05"), 3);
assert.equal(durationMinutesToSeconds("1.01"), null);
assert.equal(durationMinutesToSeconds("0"), null);
assert.equal(durationMinutesToSeconds("-1"), null);
assert.equal(durationMinutesToSeconds("150119987579017"), null);
assert.equal(durationMinutesToSeconds("1e2"), null);
console.log("Decimal minutes convert to exact whole seconds without rounding or overflow");
