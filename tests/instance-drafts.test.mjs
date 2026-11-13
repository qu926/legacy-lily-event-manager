import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { getInstanceAssignment, upsertInstanceAssignment } from '../js/core.js';
const source = await fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const tail = source.slice(start);
  return (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + tail.slice(0, tail.search(/\n(?:async )?function /));
}
function setup() {
  const state = { event_dates: [{ id: 'e' }], users: [{ id: 'h' }, { id: 'j' }], staff_members: [], instance_assignments: [], histories: [], meta: {} };
  const c = vm.createContext({ state, view: { eventId: 'e' }, instanceDrafts: new Map(), instanceSaving: false,
    structuredClone, getInstanceAssignment, upsertInstanceAssignment, render() {}, showToast() {},
    isSharedStorageConfigured: () => true, migrateState: s => s, cacheConfirmedSharedState: () => false,
    shortSyncError: e => e.message, syncStatus: {}, writes: 0,
  });
  c.loadSharedRecord = async () => ({ state: structuredClone(c.remote), updatedAt: 'version' });
  c.saveSharedState = async (s) => { c.writes++; c.remote = s; };
  c.remote = structuredClone(state);
  for (const name of ['instanceDraftKey', 'instancePreviewState', 'saveInstanceAssignmentFromButton', 'saveInstanceDrafts']) vm.runInContext(extract(name), c);
  c.assign = (id, key) => c.saveInstanceAssignmentFromButton({ dataset: { personType: 'host', personId: id, instanceKey: key } });
  return c;
}
test('clicks are drafts; batch save preserves unrelated latest data', async () => {
  const c = setup(); c.assign('h', 'a'); c.assign('j', 'b');
  assert.equal(c.writes, 0); assert.equal(c.state.instance_assignments.length, 0);
  assert.equal(c.instancePreviewState().instance_assignments.length, 2);
  c.remote.reservations = [{ id: 'new-reservation' }];
  await c.saveInstanceDrafts();
  assert.equal(c.writes, 1); assert.equal(c.instanceDrafts.size, 0);
  assert.equal(c.remote.reservations[0].id, 'new-reservation');
  assert.equal(c.remote.instance_assignments.length, 2);
});
test('failure and competing assignment retain drafts without overwrite', async () => {
  const c = setup(); c.assign('h', 'a');
  c.saveSharedState = async () => { throw new Error('offline'); };
  await c.saveInstanceDrafts(); assert.equal(c.instanceDrafts.size, 1);
  c.remote = upsertInstanceAssignment(c.remote, { event_date_id: 'e', person_type: 'host', person_id: 'h', instance_key: 'b' }).state;
  await c.saveInstanceDrafts(); assert.equal(c.instanceDrafts.size, 1); assert.equal(c.writes, 0);
});
test('returning to initial placement removes draft', () => {
  const c = setup(); c.assign('h', 'a'); c.assign('h', 'unassigned');
  assert.equal(c.instanceDrafts.size, 0);
});
