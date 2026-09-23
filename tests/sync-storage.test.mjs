import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8');
function extract(name) {
  const tail = source.slice(source.indexOf(`function ${name}(`));
  return tail.slice(0, tail.search(/\n(?:async )?function /));
}

test('confirmed shared cache quota failures preserve old cache and never write remote data', () => {
  for (const name of ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED', 'SecurityError']) {
    let oldCache = 'pending local data';
    const context = vm.createContext({ STORAGE_KEY: 'state', console: { warn() {} }, localStorage: {
      setItem() { throw Object.assign(new Error('storage restricted'), { name }); },
      removeItem() { oldCache = ''; },
    } });
    vm.runInContext(extract('cacheConfirmedSharedState') + '\n' + extract('shortSyncError'), context);
    assert.equal(context.cacheConfirmedSharedState({ users: [] }), false);
    assert.equal(oldCache, 'pending local data');
    assert.doesNotMatch(context.shortSyncError({ name }, '共有DBに接続できません'), /共有DBに接続できません/);
  }
});

test('cache persistence succeeds normally and unknown failures are not hidden', () => {
  let stored;
  const context = vm.createContext({ STORAGE_KEY: 'state', localStorage: { setItem(key, value) { stored = value; } } });
  vm.runInContext(extract('cacheConfirmedSharedState'), context);
  assert.equal(context.cacheConfirmedSharedState({ users: [] }), true);
  assert.deepEqual(JSON.parse(stored), { users: [] });
  context.localStorage.setItem = () => { throw new Error('unexpected'); };
  assert.throws(() => context.cacheConfirmedSharedState({}), /unexpected/);
});

test('loadState keeps existing data when a migration cannot update the cache', () => {
  const context = vm.createContext({ STORAGE_KEY: 'state', hasStoredLocalState: false,
    console: { warn() {} }, localStorage: {
      getItem: () => JSON.stringify({ meta: {}, users: [{ id: 'existing' }] }),
      setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); },
    }, migrateState: value => ({ ...value, migrated: true }),
    buildDefaultState: () => { throw new Error('Must not replace existing data'); },
  });
  vm.runInContext(extract('loadState'), context);
  assert.equal(context.loadState().users[0].id, 'existing');
});
