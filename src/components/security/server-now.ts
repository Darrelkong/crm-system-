/**
 * Server wall-clock for watermark calibration.
 * Isolated so layout render purity lint can target a deliberate dynamic read.
 */
export function readServerNowMs(): number {
  return Date.now();
}
