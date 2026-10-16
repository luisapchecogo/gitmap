import * as assert from 'assert';
import { relativeDate } from '../../shared/format';

suite('relativeDate', () => {
  const now = Date.UTC(2026, 0, 31, 12, 0, 0);
  const ago = (seconds: number): string => relativeDate(now / 1000 - seconds, now);

  test('formats past dates', () => {
    assert.strictEqual(ago(10), 'just now');
    assert.strictEqual(ago(60), '1 minute ago');
    assert.strictEqual(ago(5 * 60), '5 minutes ago');
    assert.strictEqual(ago(2 * 3600), '2 hours ago');
    assert.strictEqual(ago(86400), '1 day ago');
    assert.strictEqual(ago(3 * 86400), '3 days ago');
    assert.strictEqual(ago(14 * 86400), '2 weeks ago');
    assert.strictEqual(ago(90 * 86400), '3 months ago');
    assert.strictEqual(ago(2 * 365.25 * 86400), '2 years ago');
  });

  test('formats future dates from clock skew', () => {
    assert.strictEqual(ago(-5 * 60), 'in 5 minutes');
  });
});
