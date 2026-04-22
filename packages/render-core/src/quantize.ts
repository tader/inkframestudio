export function quantizeNumber(value: number, step = 1): number {
  if (!Number.isFinite(value) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

export function formatQuantizedNumber(value: unknown, step = 1, digits?: number): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const quantized = quantizeNumber(numeric, step);
  if (typeof digits === "number") {
    return quantized.toFixed(digits);
  }
  if (Math.abs(step) < 1) {
    const inferredDigits = `${step}`.split(".")[1]?.length ?? 0;
    return quantized.toFixed(inferredDigits);
  }
  return `${quantized}`;
}
