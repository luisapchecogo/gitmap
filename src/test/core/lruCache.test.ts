import * as assert from 'assert';
import { LruCache } from '../../core/lruCache';

suite('LruCache', () => {
  test('evicts the least recently used entries over budget', () => {
    const cache = new LruCache<string, string>(5, (value) => value.length);
    cache.set('a', 'aa');
    cache.set('b', 'bb');
    assert.strictEqual(cache.get('a'), 'aa'); // a is now the most recent
    cache.set('c', 'cc');
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('a'), 'aa');
    assert.strictEqual(cache.get('c'), 'cc');
  });

  test('replaces existing keys and skips values over budget', () => {
    const cache = new LruCache<string, string>(3, (value) => value.length);
    cache.set('a', 'a');
    cache.set('a', 'abc');
    assert.strictEqual(cache.size, 1);
    cache.set('big', 'abcd');
    assert.strictEqual(cache.get('big'), undefined);
    assert.strictEqual(cache.get('a'), 'abc');
  });
});
