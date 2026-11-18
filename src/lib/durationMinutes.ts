/** Parse decimal minutes without rounding a requested duration to another second. */
export function durationMinutesToSeconds(value: string): number | null {
  if (value.length > 32 || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const [whole, fractional = ""] = value.split(".");
  const scale = BigInt(10) ** BigInt(fractional.length);
  const numerator = (BigInt(whole || "0") * scale + BigInt(fractional || "0")) * BigInt(60);
  if (numerator % scale !== BigInt(0)) return null;
  const seconds = numerator / scale;
  if (seconds <= BigInt(0) || seconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(seconds);
}
