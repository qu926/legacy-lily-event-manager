const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const appPath = path.resolve(__dirname, "..", "js", "app.js");
const corePath = path.resolve(__dirname, "..", "js", "core.js");
const eventTombstoneKey = "event_tombstones";
const pendingEventDeletesKey = "archive-deletion-test-pending-event-deletes";
const dependentCollections = [
  "attendance_entries",
  "staff_attendance_entries",
  "reservations",
  "reservation_settings",
  "reservation_requests",
  "drink_plans",
  "instance_assignments",
];

let sourcesPromise;

function readSources() {
  sourcesPromise ||= Promise.all([
    fs.readFile(appPath, "utf8"),
    fs.readFile(corePath, "utf8"),
  ]).then(([app, core]) => ({ app, core }));
  return sourcesPromise;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionNames(source) {
  const names = [];
  const pattern = /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) names.push(match[1]);
  return [...new Set(names)];
}

function functionSource(source, name) {
  const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`);
  const match = pattern.exec(source);
  assert.ok(match, `function ${name} must exist`);

  const start = match.index;
  let end = source.indexOf("}", start + match[0].length);
  while (end >= 0) {
    const candidate = source.slice(start, end + 1).replace(/^export\s+/, "");
    try {
      new vm.Script(`(${candidate})`);
      return candidate;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    end = source.indexOf("}", end + 1);
  }
  assert.fail(`function ${name} could not be parsed`);
}

function staticConstantGlobals(source, declarations, baseGlobals) {
  const referenced = new Set(declarations.join("\n").match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []);
  const pending = new Map();
  for (const name of referenced) {
    const pattern = new RegExp(`(?:^|\\n)const\\s+${escapeRegExp(name)}\\s*=\\s*([\\s\\S]*?);(?:\\r?\\n|$)`);
    const match = pattern.exec(source);
    if (match) pending.set(name, match[1]);
  }

  const resolved = {};
  for (let pass = 0; pass < pending.size + 1 && pending.size; pass += 1) {
    for (const [name, expression] of [...pending]) {
      try {
        resolved[name] = vm.runInNewContext(`(${expression})`, { ...baseGlobals, ...resolved }, { timeout: 100 });
        pending.delete(name);
      } catch {
        // Browser-only constants are not needed by the isolated functions under test.
      }
    }
  }
  return resolved;
}

function loadFunctionGraph(source, roots, globals = {}, filename = appPath) {
  const available = new Set(functionNames(source));
  const external = new Set(Object.keys(globals));
  const selected = new Set();
  const queue = [...new Set(roots)];

  for (const root of queue) assert.ok(available.has(root), `function ${root} must exist`);
  while (queue.length) {
    const name = queue.shift();
    if (selected.has(name)) continue;
    selected.add(name);
    const declaration = functionSource(source, name);
    for (const match of declaration.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const dependency = match[1];
      if (available.has(dependency) && !external.has(dependency) && !selected.has(dependency)) queue.push(dependency);
    }
  }

  const declarations = [...selected].map((name) => functionSource(source, name));
  const fallbackConstants = {
    EVENT_TOMBSTONES_META_KEY: eventTombstoneKey,
    ARCHIVED_EVENT_TOMBSTONES_META_KEY: eventTombstoneKey,
    DELETED_EVENT_TOMBSTONES_META_KEY: eventTombstoneKey,
    PENDING_EVENT_DELETES_KEY: pendingEventDeletesKey,
    EVENT_DEPENDENT_COLLECTIONS: dependentCollections,
    EVENT_REFERENCE_COLLECTIONS: dependentCollections,
  };
  const baseGlobals = {
    clone,
    console,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Set,
    String,
    ...fallbackConstants,
    ...globals,
  };
  const constants = staticConstantGlobals(source, declarations, baseGlobals);
  const context = vm.createContext({ ...baseGlobals, ...constants, ...globals }, {
    codeGeneration: { strings: false, wasm: false },
    name: "archive-deletion",
  });
  const exports = [...selected].map((name) => `${JSON.stringify(name)}: ${name}`).join(",");
  const script = new vm.Script(`${declarations.join("\n")}\nthis.__functions = {${exports}};`, { filename });

  script.runInContext(context, { timeout: 2_000 });
  return { context, functions: context.__functions };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    entries() {
      return [...values.entries()];
    },
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function findPendingEventDelete(storage, eventId) {
  for (const [key, raw] of storage.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const operations = Array.isArray(parsed) ? parsed : [parsed];
    const operation = operations.find((item) => {
      const candidate = item?.eventDelete || item?.operation || item;
      return candidate
        && typeof candidate === "object"
        && String(candidate.eventId ?? candidate.event_id ?? "") === String(eventId)
        && typeof candidate.fingerprint === "string"
        && (candidate.eventSnapshot || candidate.event_snapshot);
    });
    if (operation) return { key, operation };
  }
  return null;
}

function createInitialSyncHarness(source, options) {
  let sharedState = clone(options.remoteState);
  let sharedVersion = 1;
  const stats = {
    loadCalls: 0,
    saveCalls: 0,
    retrySaveCalls: 0,
    savedStates: [],
    toasts: [],
  };
  const recordSharedSave = (nextState, retry = false) => {
    const saved = clone(nextState);
    stats.saveCalls += 1;
    if (retry) stats.retrySaveCalls += 1;
    stats.savedStates.push(saved);
    sharedState = saved;
    sharedVersion += 1;
    return saved;
  };
  const harness = loadFunctionGraph(source, ["initializeSharedState"], {
    state: clone(options.localState),
    hasStoredLocalState: true,
    syncStatus: { mode: "supabase", text: "test" },
    localStorage: options.storage,
    STORAGE_KEY: options.storageKey,
    PENDING_LOCAL_CHANGES_KEY: options.pendingLocalChangesKey,
    PENDING_EVENT_DELETES_KEY: pendingEventDeletesKey,
    PENDING_HARD_DELETES_KEY: `${options.storageKey}:pending-hard-deletes`,
    loadSharedRecord: async () => {
      stats.loadCalls += 1;
      return { state: clone(sharedState), updatedAt: `remote-v${sharedVersion}` };
    },
    saveSharedState: async (nextState) => recordSharedSave(nextState),
    saveSharedStateWithRetry: async (nextState) => recordSharedSave(nextState, true),
    migrateState: (value) => clone(value),
    mergeSharedState: mergeLikeOldDevice,
    archiveFinishedEvents: (value) => ({ state: value, changed: false }),
    hasPersistableMigration: () => false,
    loadPendingHardDeletes: () => [],
    reconcilePendingHardDeletes: async () => {},
    removePendingHardDeletes: () => {},
    assertNoTombstonedPersonReferences: () => {},
    isEventArchived: options.isEventArchived,
    showToast: (message, type) => stats.toasts.push({ message, type }),
    render: () => {},
    console: { error: () => {}, warn: () => {}, log: () => {} },
  });
  return {
    ...harness,
    stats,
    getSharedState: () => clone(sharedState),
  };
}

function createState(overrides = {}) {
  return {
    users: [],
    roles: [],
    staff_members: [],
    long_vacations: [],
    event_dates: [],
    attendance_entries: [],
    staff_attendance_entries: [],
    reservations: [],
    reservation_settings: [],
    reservation_requests: [],
    drink_plans: [],
    instance_assignments: [],
    histories: [],
    settings: {},
    meta: { [eventTombstoneKey]: [] },
    ...overrides,
  };
}

function createCascadeState(targetId, survivorId, targetCount = 24, survivorCount = 5) {
  const state = createState({
    event_dates: [
      { id: targetId, event_date: "2026-06-01", label: "Archived Event", status: "終了", updated_at: "2026-06-02T00:00:00.000Z" },
      { id: survivorId, event_date: "2026-06-08", label: "Survivor Event", status: "終了", updated_at: "2026-06-09T00:00:00.000Z" },
    ],
    histories: Array.from({ length: 300 }, (_, index) => ({
      id: `history-${index}`,
      target_type: "reservation",
      target_id: `reservation-${index}`,
      changed_at: `2026-05-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    })),
  });

  for (const collection of dependentCollections) {
    state[collection] = [
      ...Array.from({ length: targetCount }, (_, index) => ({
        id: `${collection}-target-${index}`,
        event_date_id: targetId,
        is_deleted: index % 2 === 0,
      })),
      ...Array.from({ length: survivorCount }, (_, index) => ({
        id: `${collection}-survivor-${index}`,
        event_date_id: survivorId,
        is_deleted: index % 2 === 0,
      })),
    ];
  }
  return state;
}

function mergeLikeOldDevice(remoteState, localState) {
  const remote = clone(remoteState || {});
  const local = clone(localState || {});
  const merged = {
    ...remote,
    ...local,
    settings: { ...(remote.settings || {}), ...(local.settings || {}) },
    meta: { ...(remote.meta || {}), ...(local.meta || {}) },
  };
  const collections = [
    "users",
    "roles",
    "staff_members",
    "long_vacations",
    "event_dates",
    ...dependentCollections,
    "histories",
  ];
  for (const collection of collections) {
    const byId = new Map();
    for (const item of [...(remote[collection] || []), ...(local[collection] || [])]) {
      const key = item.id || `${item.event_date_id || ""}:${JSON.stringify(item)}`;
      byId.set(String(key), clone(item));
    }
    merged[collection] = [...byId.values()];
  }
  return merged;
}

function deletionDefinition(sources) {
  const candidates = ["deleteArchivedEvent", "hardDeleteArchivedEvent", "deleteEvent"];
  for (const name of candidates) {
    for (const [location, source] of [["app", sources.app], ["core", sources.core]]) {
      if (!functionNames(source).includes(name)) continue;
      const body = functionSource(source, name);
      if (body.includes("event_dates")) return { name, source, path: location === "app" ? appPath : corePath };
    }
  }
  assert.fail("an archived-event deletion function must exist (expected deleteArchivedEvent)");
}

function deletionGlobals(overrides = {}) {
  return {
    clone,
    structuredClone: clone,
    createId: () => "history-archive-delete",
    isEventArchived: (event) => event?.status === "終了",
    touch: (state, stamp) => {
      state.meta = { ...(state.meta || {}), updated_at: stamp };
      return state;
    },
    ...overrides,
  };
}

function runDeletion(sources, state, eventId, now = new Date("2026-07-13T12:00:00.000Z")) {
  const definition = deletionDefinition(sources);
  const { functions } = loadFunctionGraph(
    definition.source,
    [definition.name],
    deletionGlobals(),
    definition.path,
  );
  return functions[definition.name](state, eventId, now);
}

function createMergedSaveHarness(source, remoteStates, options = {}) {
  const records = remoteStates.map((item, index) => {
    if (item && Object.hasOwn(item, "state")) return item;
    return { state: item, updatedAt: `remote-v${index + 1}` };
  });
  const stats = { loadCalls: 0, saveCalls: 0, savedStates: [] };
  const localStorageValues = new Map();
  const loadSharedRecord = async () => {
    const record = records[Math.min(stats.loadCalls, records.length - 1)];
    stats.loadCalls += 1;
    return { state: clone(record?.state || null), updatedAt: record?.updatedAt || "" };
  };
  const saveSharedState = async (nextState, saveOptions) => {
    stats.saveCalls += 1;
    stats.savedStates.push(clone(nextState));
    if (options.onSave) return options.onSave(nextState, saveOptions, stats);
  };
  const { functions } = loadFunctionGraph(source, ["saveMergedSharedState"], {
    clone,
    isEventArchived: (event) => event?.status === "終了",
    migrateState: (value) => clone(value),
    loadSharedRecord,
    saveSharedState,
    mergeSharedState: mergeLikeOldDevice,
    applyHardDeleteOperations: (value) => value,
    applyPersonTombstones: (value) => value,
    assertNoTombstonedPersonReferences: (value) => value,
    validateHardDeletePreconditions: () => ({ completed: false }),
    localStorage: {
      setItem: (key, value) => localStorageValues.set(key, value),
      getItem: (key) => localStorageValues.get(key) || null,
      removeItem: (key) => localStorageValues.delete(key),
    },
    STORAGE_KEY: "archive-deletion-test-state",
    state: createState(),
  });
  return { saveMergedSharedState: functions.saveMergedSharedState, stats };
}

function eventTombstones(state, eventId) {
  const matches = [];
  for (const [key, value] of Object.entries(state.meta || {})) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const isObject = item && typeof item === "object";
      const hasEventShape = isObject && (
        "event_id" in item
        || "event_date_id" in item
        || item.target_type === "event"
        || item.type === "event"
      );
      if (!hasEventShape && !(/event/i.test(key) && /(?:tombstone|deleted)/i.test(key))) continue;
      const id = isObject ? item.event_id ?? item.event_date_id ?? item.target_id ?? item.id : item;
      if (String(id) === String(eventId)) matches.push(item);
    }
  }
  return matches;
}

function assertEventPurged(state, eventId, message = "deleted event data must stay purged") {
  assert.equal((state.event_dates || []).some((event) => String(event.id) === String(eventId)), false, message);
  for (const collection of dependentCollections) {
    assert.equal(
      (state[collection] || []).some((item) => String(item.event_date_id) === String(eventId)),
      false,
      `${collection}: ${message}`,
    );
  }
}

function assertSurvivors(state, survivorId, expectedCount = 5) {
  assert.equal(state.event_dates.some((event) => event.id === survivorId), true);
  for (const collection of dependentCollections) {
    assert.equal(
      state[collection].filter((item) => item.event_date_id === survivorId).length,
      expectedCount,
      `${collection} records for another event must not be removed`,
    );
  }
}

function findMergeFunction(source) {
  const retryBody = functionSource(source, "saveSharedStateWithRetry");
  const candidates = functionNames(source).filter((name) => name.startsWith("mergeSharedStateWith"));
  const name = candidates.find((candidate) => retryBody.includes(`${candidate}(`));
  assert.ok(name, "shared-state retry must use a tombstone-aware merge function");
  return name;
}

function deleteActionFromHtml(html) {
  const actions = [...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
  return actions.find((action) => {
    return /(?:delete|remove|purge).*(?:event|archive)|(?:event|archive).*(?:delete|remove|purge)/i.test(action);
  });
}

function renderDeletionUi(source) {
  const archivedEvent = { id: "event-archived", event_date: "2026-06-01", label: "Archived Event", status: "終了" };
  const activeEvent = { id: "event-active", event_date: "2099-06-01", label: "Active Event", status: "受付中" };
  const state = createState({ event_dates: [archivedEvent, activeEvent] });
  const view = { archiveEventId: archivedEvent.id, editingEventId: "" };
  const common = {
    state,
    view,
    EVENT_STATUSES: ["受付中", "終了"],
    findEvent: (input, id) => input.event_dates.find((event) => event.id === id) || null,
    isEventArchived: (event) => event.status === "終了",
    getArchivedEvents: (input) => input.event_dates.filter((event) => event.status === "終了"),
    getReservationsForEvent: () => [],
    getReservationRequestsForEvent: () => [],
    formatDateLabel: (value) => String(value),
    formatDateTime: (value) => String(value || ""),
    statusPill: (status) => `<span>${status}</span>`,
    option: () => "",
    escapeAttr: (value) => String(value ?? ""),
    escapeHtml: (value) => String(value ?? ""),
    toLocalDateTimeString: () => "2099-06-01T00:00",
    getReservationOpenAt: () => "2099-05-31T22:00",
    renderSeatStatusList: () => "",
    renderDrinkStatusList: () => "",
    renderArchiveAttendance: () => "",
    renderDrinkPlans: () => "",
    renderArchiveReservationRequests: () => "",
    renderReservationGrid: () => "",
    renderDeletedReservations: () => "",
    renderDeletedReservationRequests: () => "",
  };
  const archiveHarness = loadFunctionGraph(source, ["renderArchive", "renderArchiveItem"], common);
  const activeHarness = loadFunctionGraph(source, ["renderEventManagement"], common);
  return {
    archiveHtml: archiveHarness.functions.renderArchive(),
    activeHtml: activeHarness.functions.renderEventManagement(),
  };
}

function confirmationHandlerName(source) {
  const names = functionNames(source);
  for (const candidate of ["deleteArchivedEventFromButton", "deleteEventFromButton"]) {
    if (names.includes(candidate) && /(?:window\.)?confirm\s*\(/.test(functionSource(source, candidate))) return candidate;
  }
  return names.find((name) => {
    const body = functionSource(source, name);
    return /(?:window\.)?confirm\s*\(/.test(body)
      && /delete(?:Archived)?Event|hardDeleteArchivedEvent/.test(body);
  }) || "";
}

async function invokeButtonHandler(name, handler, button) {
  const argument = name === "handleClick"
    ? { target: { closest: () => button } }
    : button;
  return handler(argument);
}

test("unarchived events cannot be permanently deleted", async () => {
  const sources = await readSources();
  const eventId = "event-active";
  const state = createState({
    event_dates: [{ id: eventId, event_date: "2099-06-01", label: "Active Event", status: "受付中" }],
    reservations: [{ id: "reservation-active", event_date_id: eventId }],
  });
  const before = clone(state);

  const result = runDeletion(sources, state, eventId);

  assert.equal(result?.ok, false);
  assert.deepEqual(result?.state, before);
  assert.deepEqual(state, before, "a rejected deletion must not mutate its input state");
  assert.equal(eventTombstones(result?.state || {}, eventId).length, 0);
});

test("archived deletion removes every event_date_id dependency and records an audit tombstone", async () => {
  const sources = await readSources();
  const targetId = "event-delete";
  const survivorId = "event-keep";
  const state = createCascadeState(targetId, survivorId);
  const before = clone(state);
  const deletedAt = new Date("2026-07-13T12:34:56.000Z");

  const result = runDeletion(sources, state, targetId, deletedAt);

  assert.equal(result?.ok, true);
  assert.notEqual(result?.state, state, "successful deletion must return a new state");
  assert.deepEqual(state, before, "successful deletion must not mutate its input state");
  assertEventPurged(result.state, targetId);
  assertSurvivors(result.state, survivorId);

  const history = result.state.histories.find((item) => {
    return item.target_type === "event"
      && String(item.target_id) === targetId
      && item.after_payload?.deleted === true;
  });
  assert.ok(history, "permanent deletion must add an event audit history");
  assert.equal(history.changed_at, deletedAt.toISOString());
  assert.equal(history.before_payload?.id, targetId);

  const tombstones = eventTombstones(result.state, targetId);
  assert.ok(tombstones.length > 0, "permanent deletion must leave an event tombstone");
  const timestamped = tombstones.find((item) => item && typeof item === "object" && item.deleted_at);
  assert.ok(timestamped && Number.isFinite(Date.parse(timestamped.deleted_at)), "event tombstone must be timestamped");
});

test("event tombstones win against stale devices in either merge direction", async () => {
  const sources = await readSources();
  const targetId = "event-stale";
  const survivorId = "event-current";
  const staleState = createCascadeState(targetId, survivorId, 12, 3);
  const deletion = runDeletion(sources, staleState, targetId);
  assert.equal(deletion.ok, true);
  assert.ok(eventTombstones(deletion.state, targetId).length > 0);

  const mergeName = findMergeFunction(sources.app);
  const { functions } = loadFunctionGraph(sources.app, [mergeName], {
    clone,
    mergeSharedState: mergeLikeOldDevice,
  });

  for (const [remoteState, localState] of [
    [staleState, deletion.state],
    [deletion.state, staleState],
  ]) {
    const merged = functions[mergeName](clone(remoteState), clone(localState));
    assertEventPurged(merged, targetId, "a stale device must not revive a deleted event");
    assertSurvivors(merged, survivorId, 3);
    assert.ok(eventTombstones(merged, targetId).length > 0, "the winning event tombstone must be retained");
  }
});

test("missing event deletion audit is restored within the 300-history limit", async () => {
  const sources = await readSources();
  const targetId = "event-audit-restore";
  const deletedAt = new Date("2026-07-13T12:00:00.000Z");
  const event = clone(createCascadeState(targetId, "event-unused", 0, 0).event_dates[0]);
  event.note = "sensitive-event-note-must-not-survive";
  const deletion = runDeletion(sources, createState({ event_dates: [event] }), targetId, deletedAt);
  assert.equal(deletion.ok, true);

  const deletionSide = clone(deletion.state);
  deletionSide.histories = deletionSide.histories.filter((history) => {
    return !(history.target_type === "event"
      && String(history.target_id) === targetId
      && history.after_payload?.deleted === true);
  });
  assert.equal(deletionSide.histories.length, 0, "the deletion side must intentionally omit its audit row");
  assert.equal(eventTombstones(deletionSide, targetId).length, 1, "the deletion side must retain its event tombstone");

  const ordinaryHistories = Array.from({ length: 305 }, (_, index) => ({
    id: `newer-history-${index}`,
    target_type: "reservation",
    target_id: `newer-reservation-${index}`,
    before_payload: { id: `newer-reservation-${index}` },
    after_payload: { status: "updated" },
    changed_at: new Date(deletedAt.getTime() + ((index + 1) * 60_000)).toISOString(),
    change_note: "ordinary update",
  }));
  assert.ok(ordinaryHistories.length > 300, "the opposite side must contain more than 300 ordinary histories");
  assert.ok(
    ordinaryHistories.every((history) => Date.parse(history.changed_at) > deletedAt.getTime()),
    "every ordinary history on the opposite side must be newer than the deletion",
  );

  const oppositeSide = createState({ histories: ordinaryHistories });
  const { functions } = loadFunctionGraph(sources.core, ["mergeSharedState"], {}, corePath);
  const merged = functions.mergeSharedState(clone(deletionSide), clone(oppositeSide));
  const deletionHistories = merged.histories.filter((history) => {
    return history.target_type === "event"
      && String(history.target_id) === targetId
      && history.after_payload?.deleted === true;
  });

  assert.equal(deletionHistories.length, 1, "the event deletion audit must be restored exactly once");
  assert.equal(deletionHistories[0].changed_at, deletedAt.toISOString());
  assert.deepEqual(clone(deletionHistories[0].before_payload), {
    id: targetId,
    event_date: event.event_date,
    label: event.label,
    status: event.status,
  });
  assert.equal(JSON.stringify(merged.meta[eventTombstoneKey]).includes(event.note), false);
  assert.equal(JSON.stringify(merged.histories).includes(event.note), false);
  assert.equal(merged.histories.length, 300, "deletion audits must remain inside the normal history limit");
  assert.equal(
    merged.histories.filter((history) => history.target_type !== "event").length,
    299,
    "the retained deletion audit must consume one of the 300 history slots",
  );
});

test("app normalization and shared save retain the audited event snapshot but discard note", async () => {
  const { app } = await readSources();
  const eventId = "event-app-audit-snapshot";
  const sensitiveNote = "note-must-not-reach-the-event-tombstone";
  const expectedSnapshot = {
    id: eventId,
    event_date: "2026-06-01",
    label: "Audited Event",
    status: "archived",
  };
  const rawState = createState({
    meta: {
      [eventTombstoneKey]: [{
        event_id: eventId,
        deleted_at: "2026-07-13T12:00:00.000Z",
        event_snapshot: {
          ...expectedSnapshot,
          note: sensitiveNote,
          updated_at: "2026-07-12T09:00:00.000Z",
        },
      }],
    },
  });
  let request = null;
  const { functions } = loadFunctionGraph(app, ["normalizeEventTombstones", "saveSharedState"], {
    APP_CONFIG: {
      supabaseUrl: "https://example.invalid",
      supabaseAnonKey: "test-key",
    },
    STATE_ROW_ID: "archive-deletion-test",
    syncStatus: { mode: "supabase", text: "test" },
    getSupabaseHeaders: () => ({ apikey: "test-key" }),
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, text: async () => "" };
    },
  });

  const normalized = functions.normalizeEventTombstones(rawState.meta[eventTombstoneKey]);
  assert.deepEqual(clone(normalized[0].event_snapshot), expectedSnapshot);
  assert.equal(JSON.stringify(normalized).includes(sensitiveNote), false);

  await functions.saveSharedState(clone(rawState));

  assert.ok(request, "shared save must issue a request");
  const savedPayload = JSON.parse(request.options.body).payload;
  assert.deepEqual(clone(savedPayload.meta[eventTombstoneKey][0].event_snapshot), expectedSnapshot);
  assert.equal(JSON.stringify(savedPayload.meta[eventTombstoneKey]).includes(sensitiveNote), false);
});

test("stale shared-save retries cannot reintroduce a deleted event or its dependencies", async () => {
  const sources = await readSources();
  const targetId = "event-conflict";
  const survivorId = "event-survivor";
  const staleRemote = createCascadeState(targetId, survivorId, 18, 4);
  const deletion = runDeletion(sources, staleRemote, targetId);
  assert.equal(deletion.ok, true);

  let attempts = 0;
  let savedState;
  const { functions } = loadFunctionGraph(sources.app, ["saveSharedStateWithRetry"], {
    clone,
    mergeSharedState: mergeLikeOldDevice,
    migrateState: (value) => clone(value),
    loadSharedRecord: async () => ({ state: clone(staleRemote), updatedAt: "remote-v2" }),
    saveSharedState: async (nextState) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("STALE_SHARED_STATE");
        error.code = "STALE_SHARED_STATE";
        throw error;
      }
      savedState = clone(nextState);
    },
  });

  const retriedState = await functions.saveSharedStateWithRetry(deletion.state, "remote-v1");

  assert.equal(attempts, 2);
  assertEventPurged(savedState, targetId, "retry payload must keep deleted event data purged");
  assertEventPurged(retriedState, targetId, "retry result must keep deleted event data purged");
  assertSurvivors(savedState, survivorId, 4);
  assert.ok(eventTombstones(savedState, targetId).length > 0);
});

test("event deletion is saved when the latest shared event and dependencies still match confirmation", async () => {
  const sources = await readSources();
  const targetId = "event-unchanged";
  const survivorId = "event-unchanged-survivor";
  const remoteState = createCascadeState(targetId, survivorId, 3, 2);
  const deletion = runDeletion(sources, remoteState, targetId);
  assert.equal(deletion.ok, true);

  const harness = createMergedSaveHarness(sources.app, [remoteState]);
  await harness.saveMergedSharedState(deletion.state, { eventDelete: deletion.eventDelete });

  assert.equal(harness.stats.loadCalls, 1);
  assert.equal(harness.stats.saveCalls, 1);
  assertEventPurged(harness.stats.savedStates[0], targetId);
  assertSurvivors(harness.stats.savedStates[0], survivorId, 2);
});

test("event deletion rejects shared event and dependency conflicts before applying the local tombstone", async (t) => {
  const sources = await readSources();
  const targetId = "event-precondition-conflict";
  const survivorId = "event-precondition-survivor";
  const confirmedState = createCascadeState(targetId, survivorId, 3, 1);
  const deletion = runDeletion(sources, confirmedState, targetId);
  assert.equal(deletion.ok, true);

  const cases = [
    {
      name: "event returned from archive",
      code: "EVENT_DELETE_NOT_ARCHIVED",
      mutate(remote) {
        Object.assign(remote.event_dates.find((event) => event.id === targetId), {
          event_date: "2099-07-01",
          status: "受付中",
          updated_at: "2026-07-13T12:01:00.000Z",
        });
      },
    },
    {
      name: "event changed",
      code: "EVENT_DELETE_EVENT_CHANGED",
      mutate(remote) {
        Object.assign(remote.event_dates.find((event) => event.id === targetId), {
          label: "Updated after confirmation",
          updated_at: "2026-07-13T12:02:00.000Z",
        });
      },
    },
    {
      name: "related record changed",
      code: "EVENT_DELETE_RELATED_CHANGED",
      mutate(remote) {
        remote.reservations.find((item) => item.event_date_id === targetId).note = "updated after confirmation";
      },
    },
    {
      name: "related record added",
      code: "EVENT_DELETE_RELATED_CHANGED",
      mutate(remote) {
        remote.reservations.push({ id: "reservation-added-after-confirmation", event_date_id: targetId });
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const latestRemote = clone(confirmedState);
      scenario.mutate(latestRemote);
      const harness = createMergedSaveHarness(sources.app, [latestRemote]);

      await assert.rejects(
        harness.saveMergedSharedState(deletion.state, { eventDelete: deletion.eventDelete }),
        (error) => {
          assert.equal(error.code, scenario.code);
          assert.equal(error.eventDeleteConflict?.eventId, targetId);
          assert.equal(error.eventDeleteConflict?.reason, scenario.code);
          assert.match(error.userMessage, /完全削除を中止しました/);
          assert.match(error.userMessage, /最新の共有状態を読み込み直しました/);
          assert.deepEqual(clone(error.recoveryState), latestRemote);
          assert.equal(error.recoveryState.event_dates.some((event) => event.id === targetId), true);
          return true;
        },
      );
      assert.equal(harness.stats.saveCalls, 0, "conflicting remote state must be rejected before save");
    });
  }
});

test("CAS retry revalidates event deletion against the newly loaded shared state", async () => {
  const sources = await readSources();
  const targetId = "event-cas-revalidate";
  const survivorId = "event-cas-survivor";
  const confirmedState = createCascadeState(targetId, survivorId, 2, 1);
  const deletion = runDeletion(sources, confirmedState, targetId);
  const changedRemote = clone(confirmedState);
  changedRemote.reservation_requests.push({
    id: "request-added-during-cas-retry",
    event_date_id: targetId,
  });
  const harness = createMergedSaveHarness(sources.app, [
    { state: confirmedState, updatedAt: "remote-v1" },
    { state: changedRemote, updatedAt: "remote-v2" },
  ], {
    onSave: async () => {
      const error = new Error("STALE_SHARED_STATE");
      error.code = "STALE_SHARED_STATE";
      throw error;
    },
  });

  await assert.rejects(
    harness.saveMergedSharedState(deletion.state, { eventDelete: deletion.eventDelete }),
    (error) => {
      assert.equal(error.code, "EVENT_DELETE_RELATED_CHANGED");
      assert.deepEqual(clone(error.recoveryState), changedRemote);
      return true;
    },
  );
  assert.equal(harness.stats.loadCalls, 2, "the stale CAS must reload shared state");
  assert.equal(harness.stats.saveCalls, 1, "the second payload must be rejected before another CAS write");
});

test("an already absent shared event completes idempotently", async () => {
  const sources = await readSources();
  const targetId = "event-already-absent";
  const survivorId = "event-absent-survivor";
  const confirmedState = createCascadeState(targetId, survivorId, 2, 1);
  const deletion = runDeletion(sources, confirmedState, targetId);
  const latestRemote = clone(confirmedState);
  latestRemote.event_dates = latestRemote.event_dates.filter((event) => event.id !== targetId);
  const harness = createMergedSaveHarness(sources.app, [latestRemote]);

  await harness.saveMergedSharedState(deletion.state, { eventDelete: deletion.eventDelete });

  assert.equal(harness.stats.saveCalls, 1);
  assertEventPurged(harness.stats.savedStates[0], targetId, "an idempotent completion must retain the event purge");
  assert.ok(eventTombstones(harness.stats.savedStates[0], targetId).length > 0);
});

test("invalid event deletion metadata restores the latest shared state", async () => {
  const sources = await readSources();
  const targetId = "event-invalid-operation";
  const survivorId = "event-invalid-survivor";
  const remoteState = createCascadeState(targetId, survivorId, 1, 1);
  const deletion = runDeletion(sources, remoteState, targetId);
  const invalidOperation = { ...deletion.eventDelete, relatedRecordIds: { reservations: [] } };
  const harness = createMergedSaveHarness(sources.app, [remoteState]);

  await assert.rejects(
    harness.saveMergedSharedState(deletion.state, { eventDelete: invalidOperation }),
    (error) => {
      assert.ok(
        ["EVENT_DELETE_INVALID", "EVENT_DELETE_PENDING_MISSING"].includes(error.code),
        `unexpected invalid deletion error: ${error.code}`,
      );
      assert.equal(error.eventDeleteConflict?.reason, error.code);
      assert.deepEqual(clone(error.recoveryState), remoteState);
      assert.match(error.userMessage, /削除確認情報が不正|保留情報を確認できない/);
      return true;
    },
  );
  assert.equal(harness.stats.saveCalls, 0);
});

test("the permanent-delete control is rendered for archived events only", async () => {
  const { app } = await readSources();
  const { archiveHtml, activeHtml } = renderDeletionUi(app);
  const action = deleteActionFromHtml(archiveHtml);

  assert.ok(action, "archive UI must render a permanent event-delete action");
  assert.equal(activeHtml.includes(`data-action="${action}"`), false, "active event management must not render permanent deletion");
  assert.match(archiveHtml, new RegExp(`<button[^>]+data-action="${escapeRegExp(action)}"[^>]+type="button"`));
});

test("archive deletion requires explicit confirmation and the UI action is routed", async () => {
  const { app } = await readSources();
  const { archiveHtml } = renderDeletionUi(app);
  const action = deleteActionFromHtml(archiveHtml);
  assert.ok(action, "archive delete action must exist before its interaction can be tested");

  const handlerName = confirmationHandlerName(app);
  assert.ok(handlerName, "archive event deletion must have a confirmation handler");
  const handleClickSource = functionSource(app, "handleClick");
  if (handlerName !== "handleClick") {
    assert.ok(handleClickSource.includes(`"${action}"`), "the archive delete action must be routed by handleClick");
    assert.ok(handleClickSource.includes(`${handlerName}(`), "handleClick must invoke the confirmation handler");
  }

  async function exercise(confirmed) {
    let confirmCalls = 0;
    let deleteCalls = 0;
    let persistCalls = 0;
    const event = { id: "event-confirm", event_date: "2026-06-01", label: "Archived Event", status: "終了" };
    const deletedState = createState({ meta: { [eventTombstoneKey]: [{ event_id: event.id, deleted_at: "2026-07-13T12:00:00.000Z" }] } });
    const deleteStub = () => {
      deleteCalls += 1;
      return { ok: true, state: deletedState, event, hardDeletes: [], errors: [] };
    };
    const globals = {
      state: createState({ event_dates: [event] }),
      view: { archiveEventId: event.id, editingEventId: "", eventId: event.id },
      window: {
        confirm: (message) => {
          confirmCalls += 1;
          assert.ok(String(message).trim(), "confirmation must explain the destructive action");
          return confirmed;
        },
      },
      findEvent: (input, id) => input.event_dates.find((item) => item.id === id) || null,
      isEventArchived: (item) => item.status === "終了",
      formatDateLabel: (value) => String(value),
      deleteArchivedEvent: deleteStub,
      hardDeleteArchivedEvent: deleteStub,
      deleteEvent: deleteStub,
      saveState: () => {
        persistCalls += 1;
      },
      applyResult: (result) => {
        if (result?.ok) persistCalls += 1;
      },
      showToast: () => {},
      render: () => {},
    };
    const { functions } = loadFunctionGraph(app, [handlerName], globals);
    const button = { dataset: { action, eventId: event.id } };

    await invokeButtonHandler(handlerName, functions[handlerName], button);
    return { confirmCalls, deleteCalls, persistCalls };
  }

  const cancelled = await exercise(false);
  assert.equal(cancelled.confirmCalls, 1);
  assert.equal(cancelled.persistCalls, 0, "cancelling confirmation must not save deletion");

  const accepted = await exercise(true);
  assert.equal(accepted.confirmCalls, 1);
  assert.equal(accepted.deleteCalls, 1);
  assert.equal(accepted.persistCalls, 1, "confirmed deletion must be saved exactly once");
});

test("event deletion success toast waits for the shared save to finish", async () => {
  const sources = await readSources();
  const eventId = "event-toast-after-shared-save";
  const initialState = createCascadeState(eventId, "event-toast-survivor", 1, 1);
  const deletion = runDeletion(sources, initialState, eventId);
  assert.equal(deletion.ok, true);

  const storage = createMemoryStorage();
  const toasts = [];
  let saveCalls = 0;
  let resolveSharedSave;
  const sharedSave = new Promise((resolve) => {
    resolveSharedSave = resolve;
  });
  const { functions } = loadFunctionGraph(sources.app, ["saveState"], {
    state: clone(initialState),
    syncStatus: { mode: "supabase", text: "test" },
    localStorage: storage,
    STORAGE_KEY: "archive-deletion-toast-state",
    PENDING_LOCAL_CHANGES_KEY: "archive-deletion-toast-pending",
    PENDING_HARD_DELETES_KEY: "archive-deletion-toast-hard-deletes",
    applyEventTombstones: (value) => value,
    assertNoTombstonedPersonReferences: () => {},
    loadPendingHardDeletes: () => [],
    normalizePendingHardDeleteOperation: () => null,
    persistPendingHardDeletes: () => {},
    removePendingHardDeletes: () => {},
    saveMergedSharedState: () => {
      saveCalls += 1;
      return sharedSave;
    },
    showToast: (message, type) => toasts.push({ message, type }),
    render: () => {},
    console: { error: () => {}, warn: () => {}, log: () => {} },
  });
  const successMessage = "event deletion saved";

  functions.saveState(deletion.state, successMessage, { eventDelete: deletion.eventDelete });
  const toastsBeforeSaveCompletion = clone(toasts);
  resolveSharedSave();
  await waitFor(
    () => toasts.some((toast) => toast.message === successMessage),
    "the success toast must appear after the shared save resolves",
  );

  assert.equal(saveCalls, 1);
  assert.equal(
    toastsBeforeSaveCompletion.some((toast) => toast.message === successMessage),
    false,
    "the success toast must not be shown while the shared save is pending",
  );
  assert.equal(toasts.filter((toast) => toast.message === successMessage).length, 1);
});

test("failed event deletion is persisted, then cancelled on reload when shared data changed", async () => {
  const sources = await readSources();
  const eventId = "event-pending-delete-conflict";
  const survivorId = "event-pending-delete-survivor";
  const initialState = createCascadeState(eventId, survivorId, 2, 1);
  initialState.event_dates.find((event) => event.id === eventId).note = "private event note";
  const deletion = runDeletion(sources, initialState, eventId);
  assert.equal(deletion.ok, true);

  const storageKey = "archive-deletion-reload-state";
  const pendingLocalChangesKey = "archive-deletion-reload-pending";
  const storage = createMemoryStorage();
  const firstToasts = [];
  let confirmCalls = 0;
  let failedSaveCalls = 0;
  const handlerName = confirmationHandlerName(sources.app);
  assert.ok(handlerName, "the archived event must have a confirmation handler");
  const firstLoad = loadFunctionGraph(sources.app, [handlerName], {
    state: clone(initialState),
    view: { archiveEventId: eventId, editingEventId: "", eventId },
    syncStatus: { mode: "supabase", text: "test" },
    localStorage: storage,
    STORAGE_KEY: storageKey,
    PENDING_LOCAL_CHANGES_KEY: pendingLocalChangesKey,
    PENDING_HARD_DELETES_KEY: "archive-deletion-reload-hard-deletes",
    window: {
      confirm: () => {
        confirmCalls += 1;
        return true;
      },
    },
    findEvent: (input, id) => input.event_dates.find((event) => String(event.id) === String(id)) || null,
    formatDateLabel: (value) => String(value),
    deleteArchivedEvent: () => clone(deletion),
    applyEventTombstones: (value) => value,
    assertNoTombstonedPersonReferences: () => {},
    loadPendingHardDeletes: () => [],
    normalizePendingHardDeleteOperation: () => null,
    persistPendingHardDeletes: () => {},
    removePendingHardDeletes: () => {},
    saveMergedSharedState: async () => {
      failedSaveCalls += 1;
      throw new Error("Supabase save failed: 503 temporary outage");
    },
    showToast: (message, type) => firstToasts.push({ message, type }),
    render: () => {},
    console: { error: () => {}, warn: () => {}, log: () => {} },
  });

  await invokeButtonHandler(handlerName, firstLoad.functions[handlerName], {
    dataset: { eventId, action: "delete-archived-event" },
  });
  await waitFor(
    () => firstLoad.context.syncStatus.mode === "error",
    "the rejected shared save must finish before reload",
  );

  assert.equal(confirmCalls, 1);
  assert.equal(failedSaveCalls, 1);
  assertEventPurged(JSON.parse(storage.getItem(storageKey)), eventId, "the local deletion is retained for retry");
  const pendingDelete = findPendingEventDelete(storage, eventId);
  assert.ok(pendingDelete, "a failed shared save must durably retain its pending eventDelete operation");
  assert.equal(
    firstToasts.some((toast) => toast.type !== "error"),
    false,
    "a failed shared save must not emit a deletion success toast",
  );

  const latestRemote = clone(initialState);
  Object.assign(latestRemote.event_dates.find((event) => event.id === eventId), {
    label: "Updated on another device",
    updated_at: "2026-07-13T13:00:00.000Z",
  });
  Object.assign(latestRemote.reservations.find((item) => item.event_date_id === eventId), {
    note: "reservation updated on another device",
    updated_at: "2026-07-13T13:01:00.000Z",
  });
  Object.assign(latestRemote.attendance_entries.find((item) => item.event_date_id === eventId), {
    status: "present-on-another-device",
    updated_at: "2026-07-13T13:02:00.000Z",
  });
  Object.assign(latestRemote.staff_attendance_entries.find((item) => item.event_date_id === eventId), {
    memo: "staff attendance updated on another device",
    updated_at: "2026-07-13T13:03:00.000Z",
  });
  latestRemote.reservation_requests.push({
    id: "request-added-after-delete-confirmation",
    event_date_id: eventId,
    updated_at: "2026-07-13T13:04:00.000Z",
  });
  latestRemote.meta.updated_at = "2026-07-13T13:04:00.000Z";

  const reloadToasts = [];
  let sharedLoadCalls = 0;
  let sharedSaveCalls = 0;
  const reload = loadFunctionGraph(sources.app, ["initializeSharedState"], {
    state: JSON.parse(storage.getItem(storageKey)),
    hasStoredLocalState: true,
    syncStatus: { mode: "supabase", text: "test" },
    localStorage: storage,
    STORAGE_KEY: storageKey,
    PENDING_LOCAL_CHANGES_KEY: pendingLocalChangesKey,
    PENDING_HARD_DELETES_KEY: "archive-deletion-reload-hard-deletes",
    loadSharedRecord: async () => {
      sharedLoadCalls += 1;
      return { state: clone(latestRemote), updatedAt: "remote-v2" };
    },
    saveSharedState: async () => {
      sharedSaveCalls += 1;
    },
    saveSharedStateWithRetry: async () => {
      sharedSaveCalls += 1;
    },
    migrateState: (value) => clone(value),
    mergeSharedStateWithPersonTombstones: mergeLikeOldDevice,
    archiveFinishedEvents: (value) => ({ state: value, changed: false }),
    hasPersistableMigration: () => false,
    hasPersistableMerge: () => false,
    loadPendingHardDeletes: () => [],
    reconcilePendingHardDeletes: async () => {},
    removePendingHardDeletes: () => {},
    assertNoTombstonedPersonReferences: () => {},
    isEventArchived: (event) => String(event?.id) === eventId,
    showToast: (message, type) => reloadToasts.push({ message, type }),
    render: () => {},
    console: { error: () => {}, warn: () => {}, log: () => {} },
  });

  await reload.functions.initializeSharedState();

  assert.ok(sharedLoadCalls >= 2, "initial sync must reload shared state around pending deletion reconciliation");
  assert.equal(sharedSaveCalls, 0, "a conflicting pending deletion must be cancelled without another shared write");
  assert.deepEqual(clone(reload.context.state), latestRemote, "reload must restore the complete latest shared state");
  assert.deepEqual(JSON.parse(storage.getItem(storageKey)), latestRemote);
  assert.equal(storage.getItem(pendingDelete.key), null, "the cancelled pending eventDelete must be removed");
  assert.equal(storage.getItem(pendingLocalChangesKey), null, "the cancelled local deletion must not remain mergeable");
  assert.equal(
    [...firstToasts, ...reloadToasts].some((toast) => toast.type !== "error"),
    false,
    "a deletion cancelled by reload conflict must never emit a success toast",
  );
});

test("initial sync restores shared event data when pending eventDelete storage is missing or invalid", async (t) => {
  const sources = await readSources();
  const eventId = "event-untrusted-local-tombstone";
  const survivorId = "event-untrusted-local-survivor";
  const confirmedState = createCascadeState(eventId, survivorId, 2, 1);
  const archivedStatus = confirmedState.event_dates.find((event) => event.id === eventId).status;
  const deletion = runDeletion(sources, confirmedState, eventId);
  assert.equal(deletion.ok, true);
  assertEventPurged(deletion.state, eventId);
  assert.ok(eventTombstones(deletion.state, eventId).length > 0);

  const latestRemote = clone(confirmedState);
  Object.assign(latestRemote.event_dates.find((event) => event.id === eventId), {
    label: "Latest shared event",
    updated_at: "2026-07-13T14:00:00.000Z",
  });
  Object.assign(latestRemote.reservations.find((item) => item.event_date_id === eventId), {
    note: "latest shared reservation",
    updated_at: "2026-07-13T14:01:00.000Z",
  });
  Object.assign(latestRemote.attendance_entries.find((item) => item.event_date_id === eventId), {
    status: "latest shared attendance",
    updated_at: "2026-07-13T14:02:00.000Z",
  });
  latestRemote.meta.updated_at = "2026-07-13T14:02:00.000Z";

  const cases = [
    { name: "missing", pendingValue: undefined },
    { name: "corrupt JSON", pendingValue: "{not-json" },
    {
      name: "invalid operation",
      pendingValue: JSON.stringify([{ ...deletion.eventDelete, fingerprint: "not-a-valid-fingerprint" }]),
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const storageKey = `archive-deletion-untrusted-${scenario.name}-state`;
      const pendingLocalChangesKey = `archive-deletion-untrusted-${scenario.name}-pending`;
      const initialStorage = {
        [storageKey]: JSON.stringify(deletion.state),
        [pendingLocalChangesKey]: "1",
      };
      if (scenario.pendingValue !== undefined) initialStorage[pendingEventDeletesKey] = scenario.pendingValue;
      const storage = createMemoryStorage(initialStorage);
      const harness = createInitialSyncHarness(sources.app, {
        storage,
        storageKey,
        pendingLocalChangesKey,
        localState: deletion.state,
        remoteState: latestRemote,
        isEventArchived: (event) => event?.status === archivedStatus,
      });

      await harness.functions.initializeSharedState();

      assert.deepEqual(
        clone(harness.context.state),
        latestRemote,
        "an unverifiable local event deletion must be replaced by the latest shared state",
      );
      assert.deepEqual(JSON.parse(storage.getItem(storageKey)), latestRemote);
      assert.equal(storage.getItem(pendingLocalChangesKey), null);
      assert.equal(storage.getItem(pendingEventDeletesKey), null, "unusable pending deletion metadata must be cleared");
      assert.equal(eventTombstones(harness.context.state, eventId).length, 0);
      assertSurvivors(harness.context.state, eventId, 2);
      assert.equal(
        harness.stats.savedStates.some((saved) => {
          return !(saved.event_dates || []).some((event) => String(event.id) === eventId);
        }),
        false,
        "initial sync must never write the unverified local purge back to shared storage",
      );
    });
  }
});

test("initial sync preserves an older verified shared deletion over a newer unverified local tombstone", async (t) => {
  const sources = await readSources();
  const eventId = "event-verified-shared-deletion";
  const survivorId = "event-verified-shared-survivor";
  const confirmedState = createCascadeState(eventId, survivorId, 2, 1);
  const archivedStatus = confirmedState.event_dates.find((event) => event.id === eventId).status;

  const sharedDeletion = runDeletion(
    sources,
    confirmedState,
    eventId,
    new Date("2026-07-13T10:00:00.000Z"),
  );
  assert.equal(sharedDeletion.ok, true);
  const sharedTombstone = clone(eventTombstones(sharedDeletion.state, eventId)[0]);
  const sharedAudit = clone(sharedDeletion.state.histories.find((history) => {
    return history.target_type === "event"
      && String(history.target_id) === eventId
      && history.after_payload?.deleted === true;
  }));
  assert.ok(sharedTombstone?.event_snapshot);
  assert.ok(sharedAudit);

  const unverifiedLocalSource = clone(confirmedState);
  Object.assign(unverifiedLocalSource.event_dates.find((event) => event.id === eventId), {
    event_date: "2026-06-02",
    label: "Unverified newer local snapshot",
    updated_at: "2026-07-13T11:59:00.000Z",
  });
  const localDeletion = runDeletion(
    sources,
    unverifiedLocalSource,
    eventId,
    new Date("2026-07-13T12:00:00.000Z"),
  );
  assert.equal(localDeletion.ok, true);
  const localTombstone = clone(eventTombstones(localDeletion.state, eventId)[0]);
  const localAudit = clone(localDeletion.state.histories.find((history) => {
    return history.target_type === "event"
      && String(history.target_id) === eventId
      && history.after_payload?.deleted === true;
  }));
  assert.ok(Date.parse(localTombstone.deleted_at) > Date.parse(sharedTombstone.deleted_at));
  assert.notDeepEqual(localTombstone.event_snapshot, sharedTombstone.event_snapshot);
  assert.notDeepEqual(localAudit.before_payload, sharedAudit.before_payload);
  const hasUnverifiedDeletionMetadata = (value) => {
    const tombstoneWasCopied = eventTombstones(value, eventId).some((tombstone) => {
      return tombstone?.deleted_at === localTombstone.deleted_at
        || JSON.stringify(tombstone?.event_snapshot) === JSON.stringify(localTombstone.event_snapshot);
    });
    const auditWasCopied = (value.histories || []).some((history) => {
      return history.target_type === "event"
        && String(history.target_id) === eventId
        && history.after_payload?.deleted === true
        && (
          history.changed_at === localAudit.changed_at
          || JSON.stringify(history.before_payload) === JSON.stringify(localAudit.before_payload)
        );
    });
    return tombstoneWasCopied || auditWasCopied;
  };

  const cases = [
    { name: "missing", pendingValue: undefined },
    { name: "corrupt JSON", pendingValue: "{not-json" },
    {
      name: "invalid operation",
      pendingValue: JSON.stringify([{ ...localDeletion.eventDelete, fingerprint: "invalid" }]),
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const storageKey = `archive-deletion-verified-shared-${scenario.name}-state`;
      const pendingLocalChangesKey = `archive-deletion-verified-shared-${scenario.name}-pending`;
      const initialStorage = {
        [storageKey]: JSON.stringify(localDeletion.state),
        [pendingLocalChangesKey]: "1",
      };
      if (scenario.pendingValue !== undefined) initialStorage[pendingEventDeletesKey] = scenario.pendingValue;
      const storage = createMemoryStorage(initialStorage);
      const harness = createInitialSyncHarness(sources.app, {
        storage,
        storageKey,
        pendingLocalChangesKey,
        localState: localDeletion.state,
        remoteState: sharedDeletion.state,
        isEventArchived: (event) => event?.status === archivedStatus,
      });

      await harness.functions.initializeSharedState();

      const finalState = clone(harness.context.state);
      const finalTombstones = eventTombstones(finalState, eventId);
      const finalAudits = finalState.histories.filter((history) => {
        return history.target_type === "event"
          && String(history.target_id) === eventId
          && history.after_payload?.deleted === true;
      });
      assertEventPurged(finalState, eventId);
      assertSurvivors(finalState, survivorId, 1);
      assert.equal(finalTombstones.length, 1);
      assert.deepEqual(clone(finalTombstones[0]), sharedTombstone, "shared tombstone metadata must remain authoritative");
      assert.equal(finalAudits.length, 1);
      assert.equal(finalAudits[0].changed_at, sharedAudit.changed_at);
      assert.deepEqual(clone(finalAudits[0].before_payload), sharedAudit.before_payload);
      assert.equal(hasUnverifiedDeletionMetadata(finalState), false);

      const sharedAfterSync = harness.getSharedState();
      assert.deepEqual(clone(eventTombstones(sharedAfterSync, eventId)[0]), sharedTombstone);
      const savedAudits = sharedAfterSync.histories.filter((history) => {
        return history.target_type === "event"
          && String(history.target_id) === eventId
          && history.after_payload?.deleted === true;
      });
      assert.equal(savedAudits.length, 1);
      assert.equal(savedAudits[0].changed_at, sharedAudit.changed_at);
      assert.deepEqual(clone(savedAudits[0].before_payload), sharedAudit.before_payload);
      assert.equal(
        harness.stats.savedStates.some(hasUnverifiedDeletionMetadata),
        false,
        "the unverified local tombstone must never be written over the shared deletion",
      );
      assert.deepEqual(JSON.parse(storage.getItem(storageKey)), finalState);
      assert.equal(storage.getItem(pendingLocalChangesKey), null);
      assert.equal(storage.getItem(pendingEventDeletesKey), null);
    });
  }
});

test("one conflicting pending event deletion does not discard another valid deletion", async () => {
  const sources = await readSources();
  const conflictingId = "event-multi-delete-conflict";
  const validId = "event-multi-delete-valid";
  const survivorId = "event-multi-delete-survivor";
  const confirmedState = createCascadeState(conflictingId, survivorId, 2, 1);
  const conflictingEvent = confirmedState.event_dates.find((event) => event.id === conflictingId);
  const archivedStatus = conflictingEvent.status;
  confirmedState.event_dates.splice(1, 0, {
    ...clone(conflictingEvent),
    id: validId,
    event_date: "2026-06-15",
    label: "Valid Pending Delete",
    updated_at: "2026-06-16T00:00:00.000Z",
  });
  for (const collection of dependentCollections) {
    confirmedState[collection].push({
      id: `${collection}-valid-pending-delete`,
      event_date_id: validId,
      is_deleted: false,
      updated_at: "2026-06-16T00:01:00.000Z",
    });
  }

  const firstDeletion = runDeletion(
    sources,
    confirmedState,
    conflictingId,
    new Date("2026-07-13T12:00:00.000Z"),
  );
  assert.equal(firstDeletion.ok, true);
  const secondDeletion = runDeletion(
    sources,
    firstDeletion.state,
    validId,
    new Date("2026-07-13T12:01:00.000Z"),
  );
  assert.equal(secondDeletion.ok, true);

  const latestRemote = clone(confirmedState);
  Object.assign(latestRemote.event_dates.find((event) => event.id === conflictingId), {
    label: "Conflicting event updated elsewhere",
    updated_at: "2026-07-13T15:00:00.000Z",
  });
  Object.assign(latestRemote.reservations.find((item) => item.event_date_id === conflictingId), {
    note: "conflicting reservation update",
    updated_at: "2026-07-13T15:01:00.000Z",
  });
  Object.assign(latestRemote.attendance_entries.find((item) => item.event_date_id === conflictingId), {
    status: "conflicting attendance update",
    updated_at: "2026-07-13T15:02:00.000Z",
  });
  latestRemote.meta.updated_at = "2026-07-13T15:02:00.000Z";

  const storageKey = "archive-deletion-multiple-pending-state";
  const pendingLocalChangesKey = "archive-deletion-multiple-pending-local";
  const storage = createMemoryStorage({
    [storageKey]: JSON.stringify(secondDeletion.state),
    [pendingLocalChangesKey]: "1",
    [pendingEventDeletesKey]: JSON.stringify([
      firstDeletion.eventDelete,
      secondDeletion.eventDelete,
    ]),
  });
  const harness = createInitialSyncHarness(sources.app, {
    storage,
    storageKey,
    pendingLocalChangesKey,
    localState: secondDeletion.state,
    remoteState: latestRemote,
    isEventArchived: (event) => event?.status === archivedStatus,
  });

  await harness.functions.initializeSharedState();

  const restoredConflict = harness.context.state.event_dates.find((event) => event.id === conflictingId);
  assert.ok(restoredConflict, "only the conflicting deletion must be cancelled");
  assert.equal(restoredConflict.label, "Conflicting event updated elsewhere");
  assert.equal(
    harness.context.state.reservations.find((item) => item.event_date_id === conflictingId)?.note,
    "conflicting reservation update",
  );
  assert.equal(
    harness.context.state.attendance_entries.find((item) => item.event_date_id === conflictingId)?.status,
    "conflicting attendance update",
  );
  assertSurvivors(harness.context.state, conflictingId, 2);
  assertSurvivors(harness.context.state, survivorId, 1);
  assert.equal(eventTombstones(harness.context.state, conflictingId).length, 0);
  assert.equal(findPendingEventDelete(storage, conflictingId), null, "the conflicting intent must be released");
  const sharedAfterSync = harness.getSharedState();
  const validDeleteWasSaved = !(sharedAfterSync.event_dates || []).some((event) => event.id === validId);
  const validDeleteStillPending = findPendingEventDelete(storage, validId);
  assert.ok(
    validDeleteWasSaved || validDeleteStillPending,
    "the non-conflicting deletion must either be saved or remain pending for retry",
  );

  if (validDeleteWasSaved) {
    assertEventPurged(sharedAfterSync, validId, "the non-conflicting pending deletion must complete in shared storage");
    assertEventPurged(harness.context.state, validId, "local state must reflect the completed shared deletion");
    assert.ok(eventTombstones(sharedAfterSync, validId).length > 0);
    assert.equal(validDeleteStillPending, null, "a successfully saved intent must be cleared");
    assert.equal(storage.getItem(pendingLocalChangesKey), null);
    assert.ok(
      harness.stats.savedStates.some((saved) => {
        const conflictSurvives = (saved.event_dates || []).some((event) => event.id === conflictingId);
        const validWasDeleted = !(saved.event_dates || []).some((event) => event.id === validId);
        return conflictSurvives && validWasDeleted;
      }),
      "shared storage must receive the valid deletion without the conflicting purge",
    );
    assert.deepEqual(clone(harness.context.state), sharedAfterSync);
  } else {
    assert.equal(storage.getItem(pendingLocalChangesKey), "1", "a deferred valid deletion must remain retryable");
  }
});
