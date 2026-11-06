import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteVacation, upsertVacation, isOnVacation, mergeSharedState } from '../js/core.js';

test('vacation deletion is audited, immutable, and wins against stale edits in both directions', () => {
  const state = { meta: {}, histories: [], long_vacations: [{ id: 'v', user_id: 'h', is_active: true,
    start_date: '2026-01-01', end_date: '2026-12-31', updated_at: '2026-01-01T00:00:00Z' }] };
  const result = deleteVacation(state, 'v', '2026-11-06T00:00:00Z');
  assert.equal(result.ok, true);
  assert.equal(isOnVacation(state, 'h', '2026-11-06'), true);
  assert.equal(isOnVacation(result.state, 'h', '2026-11-06'), false);
  assert.equal(result.state.histories[0].change_note, '長期休暇を削除');
  assert.equal(upsertVacation(result.state, { id: 'v' }).ok, false);
  assert.equal(deleteVacation(result.state, 'v').ok, false);
  const stale = structuredClone(state);
  stale.long_vacations[0].updated_at = '2027-01-01T00:00:00Z';
  for (const merged of [mergeSharedState(result.state, stale), mergeSharedState(stale, result.state)]) {
    assert.equal(merged.long_vacations[0].is_deleted, true);
    assert.equal(isOnVacation(merged, 'h', '2026-11-06'), false);
  }
});
