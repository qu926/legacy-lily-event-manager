import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { buildDefaultState, upsertAttendance, upsertReservationRequest, getReservationRequestBuckets, getRequestAttendanceHoldReason, mergeSharedState } from '../js/core.js';

test('attendance wait preserves requests and joins behind ready hosts after sync and reload', () => {
  let state = buildDefaultState(new Date('2026-09-10T00:00:00Z'));
  const event = state.event_dates[0];
  event.event_date = '2026-09-11';
  event.status = '受付中';
  event.reservation_open_at = '2020-01-01T00:00:00Z';
  const hostA = state.users[1].id;
  const hostB = state.users[2].id;
  const reserve = (host, now) => {
    const result = upsertReservationRequest(state, { event_date_id: event.id, host_user_id: host, desired_time_slot: '前半', princess_name: 'Test guest' }, { now });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    state = result.state;
    return result.request;
  };
  const attend = (host, status, now) => {
    const result = upsertAttendance(state, { event_date_id: event.id, user_id: host, status, memo: 'memo' }, now);
    assert.equal(result.ok, true);
    state = result.state;
  };
  const a = reserve(hostA, '2026-09-10T01:00:00Z');
  assert.match(getRequestAttendanceHoldReason(state, a), /未入力/);
  assert.equal(getReservationRequestBuckets(state, event.id)['前半'].reserved.length, 0);
  const stale = structuredClone(state);
  attend(hostB, '出勤', '2026-09-10T02:00:00Z');
  const b = reserve(hostB, '2026-09-10T03:00:00Z');
  attend(hostA, '体入', '2026-09-10T04:00:00Z');
  const ordered = () => getReservationRequestBuckets(state, event.id)['前半'].reserved.map(r => r.id);
  assert.deepEqual(ordered(), [b.id, a.id]);
  attend(hostB, '出勤', '2026-09-10T05:00:00Z');
  assert.deepEqual(ordered(), [b.id, a.id]);
  state = JSON.parse(JSON.stringify(mergeSharedState(stale, state)));
  assert.deepEqual(ordered(), [b.id, a.id]);
  assert.equal(state.reservation_requests.length, 2);
  attend(hostA, '欠席', '2026-09-10T06:00:00Z');
  assert.deepEqual(ordered(), [b.id]);
  assert.match(getRequestAttendanceHoldReason(state, a), /欠席/);
});

test('actual reservation and attendance save retries retain concurrent records without overwriting', async () => {
  const source = await fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const extract = (name) => {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0);
    const tail = source.slice(start);
    return tail.slice(0, tail.search(/\n(?:async )?function /));
  };
  for (const savingAttendance of [false, true]) {
    let shared = buildDefaultState(new Date('2026-09-10T00:00:00Z'));
    shared.event_dates[0].status = '受付中';
    shared.event_dates[0].event_date = '2026-09-11';
    const eventId = shared.event_dates[0].id;
    const initial = structuredClone(shared);
    const hostId = shared.users[1].id;
    let version = 'v1';
    let attempts = 0;
    const save = async (next, expected) => {
      attempts++;
      if (attempts === 1) {
        shared = upsertAttendance(shared, { event_date_id: eventId, user_id: shared.users[2].id, status: '出勤', memo: 'concurrent attendance' }).state;
        shared = upsertReservationRequest(shared, { event_date_id: eventId, host_user_id: shared.users[3].id, desired_time_slot: '前半', princess_name: 'Concurrent guest' }, { admin: true }).state;
        version = 'v2';
      }
      if (expected !== version) throw Object.assign(new Error('conflict'), { code: 'STALE_SHARED_STATE' });
      shared = JSON.parse(JSON.stringify(next));
      version = 'v3';
    };
    const context = vm.createContext({
      state: initial, clone: structuredClone, migrateState: structuredClone,
      loadSharedRecord: async () => ({ state: structuredClone(shared), updatedAt: version }),
      upsertAttendance,
      upsertReservationRequest: (current, input, options) => upsertReservationRequest(current, input, { ...options, now: '2026-09-10T01:00:00Z' }),
      assertAttendanceUserGuard: () => {}, assertNoTombstonedPersonReferences: () => {},
      saveSharedState: (next, options) => save(next, options.expectedUpdatedAt),
      saveSharedStateIfUnchanged: save,
    });
    vm.runInContext(extract('saveAttendanceEntriesToSharedState') + '\n' + extract('saveReservationRequestToSharedState'), context);
    const result = savingAttendance
      ? await context.saveAttendanceEntriesToSharedState([{ event_date_id: eventId, user_id: hostId, status: '体入' }], {})
      : await context.saveReservationRequestToSharedState({ event_date_id: eventId, host_user_id: hostId, desired_time_slot: '前半', princess_name: 'Pending guest' }, false);
    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
    assert.ok(shared.attendance_entries.some(e => e.memo === 'concurrent attendance'));
    assert.ok(shared.reservation_requests.some(r => r.princess_name === 'Concurrent guest'));
    assert.equal(shared.reservation_requests.length, savingAttendance ? 1 : 2);
    assert.equal(shared.attendance_entries.length, savingAttendance ? 2 : 1);
    if (!savingAttendance) assert.match(getRequestAttendanceHoldReason(shared, result.request), /未入力/);
  }
});

test('conditional database save treats a concurrent update as conflict without an unconditional write', async () => {
  const source = await fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function saveSharedStateIfUnchanged(');
  const end = source.indexOf('\nasync function ', start + 1);
  const submitted = { reservation_requests: [{ id: 'pending' }], attendance_entries: [] };
  for (const mode of ['conflict', 'network', 'success']) {
    let calls = 0;
    const context = vm.createContext({
      STATE_ROW_ID: 'test', APP_CONFIG: { supabaseUrl: 'https://example.invalid' }, getSupabaseHeaders: () => ({}),
      fetch: async (url, options) => {
        calls++;
        assert.equal(options.method, 'PATCH');
        assert.ok(url.includes('updated_at=eq.version-one'));
        assert.deepEqual(JSON.parse(options.body).payload, submitted);
        if (mode === 'network') throw new Error('network unavailable');
        return { ok: true, json: async () => mode === 'conflict' ? [] : [{ id: 'test' }] };
      },
    });
    vm.runInContext(source.slice(start, end), context);
    const saving = context.saveSharedStateIfUnchanged(submitted, 'version-one');
    if (mode === 'success') await saving;
    else await assert.rejects(saving, error => mode === 'conflict' ? error.code === 'STALE_SHARED_STATE' : /network/.test(error.message));
    assert.equal(calls, 1);
    assert.equal(submitted.reservation_requests.length, 1);
  }
});
