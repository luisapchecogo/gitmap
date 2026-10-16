// Shared by the extension host and the webview: no Node or vscode imports.

const UNITS: [limit: number, seconds: number, name: string][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [604800, 86400, 'day'],
  [2629800, 604800, 'week'],
  [31557600, 2629800, 'month'],
  [Number.POSITIVE_INFINITY, 31557600, 'year'],
];

/**
 * "just now", "5 minutes ago", "3 days ago", "2 years ago"; dates in the
 * future (clock skew) read "in 5 minutes".
 */
export function relativeDate(epochSeconds: number, nowMs: number = Date.now()): string {
  const delta = Math.round(nowMs / 1000 - epochSeconds);
  const abs = Math.abs(delta);
  if (abs < 45) {
    return 'just now';
  }
  for (const [limit, seconds, name] of UNITS) {
    if (abs < limit) {
      const count = Math.max(1, Math.round(abs / seconds));
      const text = `${count} ${name}${count === 1 ? '' : 's'}`;
      return delta >= 0 ? `${text} ago` : `in ${text}`;
    }
  }
  return 'just now';
}

/** 1234567 → "1,234,567". */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
