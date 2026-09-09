import { test } from 'node:test';
import assert from 'node:assert/strict';
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
