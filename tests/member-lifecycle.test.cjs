const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const appPath = path.resolve(__dirname, "..", "js", "app.js");
const tombstoneKey = "person_tombstones";

let appSourcePromise;

function readAppSource() {
  appSourcePromise ||= fs.readFile(appPath, "utf8");
  return appSourcePromise;
}

function functionSource(source, name) {
  const startPattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const startMatch = startPattern.exec(source);
  assert.ok(startMatch, `function ${name} must exist`);

  const nextPattern = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
  nextPattern.lastIndex = startMatch.index + startMatch[0].length;
  const nextMatch = nextPattern.exec(source);
  return source.slice(startMatch.index, nextMatch?.index ?? source.length);
}

function loadFunctions(source, names, globals = {}) {
  const uniqueNames = [...new Set(names)];
  const sandbox = {
    console,
    Date,
    Error,
    JSON,
    Map,
    Number,
    Set,
    String,
    ...globals,
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "member-lifecycle",
  });
  const declarations = uniqueNames.map((name) => functionSource(source, name)).join("\n");
  const exports = uniqueNames.map((name) => `${JSON.stringify(name)}: ${name}`).join(",");
  const script = new vm.Script(`${declarations}\nthis.__functions = {${exports}};`, { filename: appPath });

  script.runInContext(context, { timeout: 1_000 });
  return { context, functions: context.__functions };
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
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
    meta: { [tombstoneKey]: [] },
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeLikeOldDevice(remoteState, localState) {
  const collections = [
    "users",
    "roles",
    "staff_members",
    "long_vacations",
    "event_dates",
    "attendance_entries",
    "staff_attendance_entries",
    "reservations",
    "reservation_settings",
    "reservation_requests",
    "drink_plans",
    "instance_assignments",
    "histories",
  ];
  const merged = {
    ...remoteState,
    ...localState,
    meta: { ...(remoteState.meta || {}), ...(localState.meta || {}) },
  };
  for (const collection of collections) {
    merged[collection] = [...(remoteState[collection] || []), ...(localState[collection] || [])];
  }
  return merged;
}

const tombstoneFunctions = [
  "normalizePersonTombstones",
  "mergePersonTombstones",
  "mergeSharedStateWithPersonTombstones",
  "applyPersonTombstones",
  "removeTombstonedPersonReferences",
  "removeManagedPersonRecord",
  "sanitizeManagedPersonHistory",
  "removeHostPhotoData",
];

const migrationFunctions = [
  ...tombstoneFunctions,
  "migrateState",
];

function migrationGlobals(overrides = {}) {
  return {
    PERSON_TOMBSTONES_META_KEY: tombstoneKey,
    mergeSharedState: mergeLikeOldDevice,
    buildDefaultState: () => createState(),
    migrateEventDates: (value) => value,
    migrateReservations: (value) => value,
    migrateDrinkPlans: (value) => value,
    ...overrides,
  };
}

test("host and staff management render active and inactive members separately", async () => {
  const source = await readAppSource();
  const hostCalls = [];
  const hostHarness = loadFunctions(source, ["renderHostManagement"], {
    view: { editingUserId: "" },
    state: createState({
      users: [
        { id: "host-active", display_name: "Active", is_active: true },
        { id: "host-inactive", display_name: "Inactive", is_active: false },
      ],
    }),
    sortedUsers: (users) => users,
    getRoles: () => [],
    renderHostManagementTable: (users) => {
      hostCalls.push(users.map((user) => user.id));
      return `<table>${users.map((user) => user.id).join(",")}</table>`;
    },
    escapeAttr: (value) => String(value),
    option: () => "",
  });
  const hostHtml = hostHarness.functions.renderHostManagement();

  assert.deepEqual(hostCalls, [["host-active"], ["host-inactive"]]);
  assert.match(hostHtml, /<details\b/);
  assert.ok(hostHtml.includes("無効化済みホスト"));

  const staffCalls = [];
  const staffHarness = loadFunctions(source, ["renderStaffManagement"], {
    view: { editingStaffMemberId: "" },
    state: createState({
      staff_members: [
        { id: "staff-active", display_name: "Active", is_active: true },
        { id: "staff-inactive", display_name: "Inactive", is_active: false },
      ],
    }),
    sortedStaffMembers: (members) => members,
    renderStaffManagementTable: (members) => {
      staffCalls.push(members.map((member) => member.id));
      return `<table>${members.map((member) => member.id).join(",")}</table>`;
    },
    escapeAttr: (value) => String(value),
  });
  const staffHtml = staffHarness.functions.renderStaffManagement();

  assert.deepEqual(staffCalls, [["staff-active"], ["staff-inactive"]]);
  assert.match(staffHtml, /<details\b/);
  assert.ok(staffHtml.includes("無効化済み内勤"));
});

test("delete controls are rendered only for inactive hosts and staff", async () => {
  const source = await readAppSource();
  const { functions } = loadFunctions(source, ["renderHostManagementTable", "renderStaffManagementTable"], {
    escapeHtml: (value) => String(value ?? ""),
    renderHostPhotoUploader: () => "",
    renderManagedPersonStatus: () => "",
  });
  const activeHostHtml = functions.renderHostManagementTable([
    { id: "host-active", display_name: "Active", is_active: true },
  ], "empty");
  const inactiveHostHtml = functions.renderHostManagementTable([
    { id: "host-inactive", display_name: "Inactive", is_active: false },
  ], "empty");
  const activeStaffHtml = functions.renderStaffManagementTable([
    { id: "staff-active", display_name: "Active", is_active: true },
  ], "empty");
  const inactiveStaffHtml = functions.renderStaffManagementTable([
    { id: "staff-inactive", display_name: "Inactive", is_active: false },
  ], "empty");

  assert.equal(activeHostHtml.includes('data-action="delete-user"'), false);
  assert.equal(inactiveHostHtml.includes('data-action="delete-user"'), true);
  assert.equal(activeStaffHtml.includes('data-action="delete-staff-member"'), false);
  assert.equal(inactiveStaffHtml.includes('data-action="delete-staff-member"'), true);
});

test("hard deletion rejects active and referenced members and records successful deletions", async () => {
  const source = await readAppSource();
  const { functions } = loadFunctions(source, [
    ...tombstoneFunctions,
    "getManagedPersonVersion",
    "getManagedPersonReferences",
    "applyHardDeleteOperations",
    "removeFailedHardDeleteArtifacts",
    "deleteManagedPerson",
  ], {
    PERSON_TOMBSTONES_META_KEY: tombstoneKey,
    MANAGED_PERSON_TYPES: {
      host: { collection: "users", label: "ホスト", historyTargetType: "user", missingMessage: "missing host" },
      staff: { collection: "staff_members", label: "内勤", historyTargetType: "staff_member", missingMessage: "missing staff" },
    },
    clone,
    createId: () => "history-id",
    mergeSharedState: mergeLikeOldDevice,
  });

  for (const [personType, collection] of [["host", "users"], ["staff", "staff_members"]]) {
    const activeState = createState({
      [collection]: [{ id: `${personType}-1`, display_name: "Active", is_active: true }],
    });
    const result = functions.deleteManagedPerson(activeState, personType, `${personType}-1`);
    assert.equal(result.ok, false);
    assert.equal(result.state, activeState);
    assert.equal(activeState[collection].length, 1);
  }

  const referenceCases = [
    ["host", "users", "attendance_entries", { user_id: "host-1" }],
    ["host", "users", "long_vacations", { user_id: "host-1" }],
    ["host", "users", "reservations", { host_user_id: "host-1" }],
    ["host", "users", "reservation_requests", { host_user_id: "host-1" }],
    ["host", "users", "drink_plans", { host_user_id: "host-1" }],
    ["host", "users", "instance_assignments", { person_type: "host", person_id: "host-1" }],
    ["staff", "staff_members", "staff_attendance_entries", { staff_member_id: "staff-1" }],
    ["staff", "staff_members", "instance_assignments", { person_type: "staff", person_id: "staff-1" }],
  ];
  for (const [personType, collection, referenceCollection, reference] of referenceCases) {
    const id = `${personType}-1`;
    const state = createState({
      [collection]: [{ id, display_name: "Inactive", is_active: false }],
      [referenceCollection]: [reference],
    });
    const result = functions.deleteManagedPerson(state, personType, id);
    assert.equal(result.ok, false, `${personType} must be guarded by ${referenceCollection}`);
    assert.equal(state[collection].some((person) => person.id === id), true);
  }

  const deletedAt = new Date("2026-07-13T12:00:00.000Z");
  for (const [personType, collection] of [["host", "users"], ["staff", "staff_members"]]) {
    const id = `${personType}-deleted`;
    const state = createState({
      [collection]: [{ id, display_name: "Inactive", is_active: false }],
    });
    const result = functions.deleteManagedPerson(state, personType, id, deletedAt);
    assert.equal(result.ok, true);
    assert.equal(result.state[collection].some((person) => person.id === id), false);
    const tombstone = result.state.meta[tombstoneKey].find((item) => item.person_id === id);
    assert.equal(tombstone?.person_type, personType);
    assert.equal(tombstone?.deleted_at, deletedAt.toISOString());
  }
});

test("tombstones win when either side of a merge is an old device", async () => {
  const source = await readAppSource();
  const { functions } = loadFunctions(source, tombstoneFunctions, migrationGlobals());
  const deletedAt = "2026-07-13T12:00:00.000Z";

  for (const [personType, collection] of [["host", "users"], ["staff", "staff_members"]]) {
    const id = `${personType}-deleted`;
    const staleState = createState({
      [collection]: [{ id, display_name: "Stale", is_active: false }],
    });
    const deletedState = createState({
      meta: { [tombstoneKey]: [{ person_type: personType, person_id: id, deleted_at: deletedAt }] },
    });

    for (const [remoteState, localState] of [[deletedState, staleState], [staleState, deletedState]]) {
      const merged = functions.mergeSharedStateWithPersonTombstones(clone(remoteState), clone(localState));
      assert.equal(merged[collection].some((person) => person.id === id), false);
      assert.equal(merged.meta[tombstoneKey].some((item) => item.person_id === id), true);
    }
  }
});

test("initial sync applies remote tombstones before accepting pending data from an old device", async () => {
  const source = await readAppSource();
  const remoteState = createState({
    meta: {
      [tombstoneKey]: [{ person_type: "host", person_id: "host-deleted", deleted_at: "2026-07-13T12:00:00.000Z" }],
    },
  });
  const localState = createState({
    users: [{ id: "host-deleted", display_name: "Stale host", is_active: false }],
  });
  const localStorage = createMemoryStorage({ pending: "1" });
  const globals = migrationGlobals({
    syncStatus: { mode: "supabase", text: "" },
    localStorage,
    PENDING_LOCAL_CHANGES_KEY: "pending",
    STORAGE_KEY: "state",
    hasStoredLocalState: true,
    state: localState,
    loadSharedRecord: async () => ({ state: clone(remoteState), updatedAt: "remote-v1" }),
    hasPersistableMigration: () => false,
    hasPersistableMerge: () => false,
    archiveFinishedEvents: (state) => ({ state, changed: false }),
    saveSharedStateWithRetry: async () => {},
    saveSharedState: async () => {},
    render: () => {},
    shortSyncError: () => "error",
  });
  const { context, functions } = loadFunctions(source, [
    ...migrationFunctions,
    "initializeSharedState",
  ], globals);

  await functions.initializeSharedState();

  assert.equal(context.state.users.some((user) => user.id === "host-deleted"), false);
  assert.equal(context.state.meta[tombstoneKey][0].person_id, "host-deleted");
  assert.equal(localStorage.getItem("pending"), null);
});

test("normal shared saves apply tombstones after merging stale remote data", async () => {
  const source = await readAppSource();
  const staleRemote = createState({
    users: [{ id: "host-deleted", display_name: "Stale host", is_active: false }],
  });
  const localState = createState({
    meta: {
      [tombstoneKey]: [{ person_type: "host", person_id: "host-deleted", deleted_at: "2026-07-13T12:00:00.000Z" }],
    },
  });
  let savedState;
  const globals = migrationGlobals({
    state: localState,
    localStorage: createMemoryStorage(),
    STORAGE_KEY: "state",
    loadSharedRecord: async () => ({ state: clone(staleRemote), updatedAt: "remote-v1" }),
    saveSharedState: async (nextState) => {
      savedState = clone(nextState);
    },
    applyHardDeleteOperations: (state) => state,
  });
  const { functions } = loadFunctions(source, [
    ...migrationFunctions,
    "saveMergedSharedState",
  ], globals);

  await functions.saveMergedSharedState(localState);

  assert.equal(savedState.users.some((user) => user.id === "host-deleted"), false);
  assert.equal(savedState.meta[tombstoneKey][0].person_id, "host-deleted");
});

test("conflict retries keep tombstones and cannot revive deleted members", async () => {
  const source = await readAppSource();
  const localState = createState({
    meta: {
      [tombstoneKey]: [{ person_type: "staff", person_id: "staff-deleted", deleted_at: "2026-07-13T12:00:00.000Z" }],
    },
  });
  const staleRemote = createState({
    staff_members: [{ id: "staff-deleted", display_name: "Stale staff", is_active: false }],
  });
  let attempts = 0;
  let savedState;
  const globals = migrationGlobals({
    saveSharedState: async (nextState) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("STALE_SHARED_STATE");
        error.code = "STALE_SHARED_STATE";
        throw error;
      }
      savedState = clone(nextState);
    },
    loadSharedRecord: async () => ({ state: clone(staleRemote), updatedAt: "remote-v2" }),
  });
  const { functions } = loadFunctions(source, [
    ...migrationFunctions,
    "saveSharedStateWithRetry",
  ], globals);

  const result = await functions.saveSharedStateWithRetry(localState, "remote-v1");

  assert.equal(attempts, 2);
  assert.equal(savedState.staff_members.some((member) => member.id === "staff-deleted"), false);
  assert.equal(savedState.meta[tombstoneKey][0].person_id, "staff-deleted");
  assert.equal(result.staff_members.some((member) => member.id === "staff-deleted"), false);
});

test("exhausted normal-save conflicts keep the tombstoned recovery state", async () => {
  const source = await readAppSource();
  const localState = createState({
    meta: {
      [tombstoneKey]: [{ person_type: "staff", person_id: "staff-deleted", deleted_at: "2026-07-13T12:00:00.000Z" }],
    },
  });
  const staleRemote = createState({
    staff_members: [{ id: "staff-deleted", display_name: "Stale staff", is_active: false }],
  });
  const localStorage = createMemoryStorage();
  const globals = migrationGlobals({
    state: localState,
    localStorage,
    STORAGE_KEY: "state",
    loadSharedRecord: async () => ({ state: clone(staleRemote), updatedAt: "remote-v2" }),
    saveSharedState: async () => {
      const error = new Error("STALE_SHARED_STATE");
      error.code = "STALE_SHARED_STATE";
      throw error;
    },
    applyHardDeleteOperations: (state) => state,
  });
  const { context, functions } = loadFunctions(source, [
    ...migrationFunctions,
    "saveMergedSharedState",
  ], globals);

  await assert.rejects(functions.saveMergedSharedState(localState), /STALE_SHARED_STATE/);

  assert.equal(context.state.staff_members.some((member) => member.id === "staff-deleted"), false);
  assert.equal(context.state.meta[tombstoneKey][0].person_id, "staff-deleted");
  const storedState = JSON.parse(localStorage.getItem("state"));
  assert.equal(storedState.staff_members.some((member) => member.id === "staff-deleted"), false);
});

test("old-device references to tombstoned hosts and staff are removed before shared save", async () => {
  const source = await readAppSource();
  const hostId = "host-deleted";
  const staffId = "staff-deleted";
  const staleRemote = createState({
    users: [
      { id: hostId, display_name: "Stale host", is_active: false },
      { id: "host-current", display_name: "Current host", is_active: true },
    ],
    staff_members: [
      { id: staffId, display_name: "Stale staff", is_active: false },
      { id: "staff-current", display_name: "Current staff", is_active: true },
    ],
    attendance_entries: [
      { id: "deleted-host-attendance", user_id: hostId },
      { id: "keep-attendance", user_id: "host-current" },
    ],
    long_vacations: [
      { id: "deleted-host-vacation", user_id: hostId },
      { id: "keep-vacation", user_id: "host-current" },
    ],
    staff_attendance_entries: [
      { id: "deleted-staff-attendance", staff_member_id: staffId },
      { id: "keep-staff-attendance", staff_member_id: "staff-current" },
    ],
    reservations: [
      { id: "deleted-host-reservation", host_user_id: hostId },
      { id: "deleted-staff-misreference-reservation", host_user_id: staffId },
      { id: "keep-reservation", host_user_id: "host-current" },
    ],
    reservation_requests: [
      { id: "deleted-host-request", host_user_id: hostId },
      { id: "deleted-staff-misreference-request", host_user_id: staffId },
      { id: "keep-request", host_user_id: "host-current" },
    ],
    drink_plans: [
      { id: "deleted-host-drink", host_user_id: hostId },
      { id: "deleted-staff-misreference-drink", host_user_id: staffId },
      { id: "keep-drink", host_user_id: "host-current" },
    ],
    instance_assignments: [
      { id: "deleted-host-assignment", person_type: "host", person_id: hostId },
      { id: "deleted-staff-assignment", person_type: "staff", person_id: staffId },
      { id: "keep-assignment", person_type: "host", person_id: "host-current" },
    ],
  });
  const localState = createState({
    meta: {
      [tombstoneKey]: [
        { person_type: "host", person_id: hostId, deleted_at: "2026-07-13T12:00:00.000Z" },
        { person_type: "staff", person_id: staffId, deleted_at: "2026-07-13T12:01:00.000Z" },
      ],
    },
  });
  let savedState;
  const globals = migrationGlobals({
    state: localState,
    localStorage: createMemoryStorage(),
    STORAGE_KEY: "state",
    loadSharedRecord: async () => ({ state: clone(staleRemote), updatedAt: "remote-v1" }),
    saveSharedState: async (nextState) => {
      savedState = clone(nextState);
    },
    applyHardDeleteOperations: (state) => state,
  });
  const { functions } = loadFunctions(source, [
    ...migrationFunctions,
    "getManagedPersonReferences",
    "assertNoTombstonedPersonReferences",
    "saveMergedSharedState",
  ], globals);

  await functions.saveMergedSharedState(localState);

  const expectedIds = {
    attendance_entries: ["keep-attendance"],
    long_vacations: ["keep-vacation"],
    staff_attendance_entries: ["keep-staff-attendance"],
    reservations: ["keep-reservation"],
    reservation_requests: ["keep-request"],
    drink_plans: ["keep-drink"],
    instance_assignments: ["keep-assignment"],
  };
  for (const [collection, ids] of Object.entries(expectedIds)) {
    assert.deepEqual(savedState[collection].map((item) => item.id), ids, `${collection} must not retain tombstoned references`);
  }
  assert.deepEqual(savedState.users.map((user) => user.id), ["host-current"]);
  assert.deepEqual(savedState.staff_members.map((member) => member.id), ["staff-current"]);
});

test("pending hard deletion survives reload and rechecks the latest database references", async () => {
  const source = await readAppSource();
  const pendingKey = "pending-hard-deletes";
  const storage = createMemoryStorage();
  const person = {
    id: "host-pending",
    display_name: "Pending host",
    is_active: false,
    updated_at: "2026-07-13T11:00:00.000Z",
    photo_data_url: "data:image/png;base64,secret",
    photo_name: "secret.png",
  };
  const managedTypes = {
    host: { collection: "users", label: "ホスト", historyTargetType: "user", missingMessage: "missing host" },
    staff: { collection: "staff_members", label: "内勤", historyTargetType: "staff_member", missingMessage: "missing staff" },
  };
  const sourceState = createState({ users: [clone(person)] });
  const creator = loadFunctions(source, [
    ...tombstoneFunctions,
    "getManagedPersonVersion",
    "normalizePendingHardDeleteOperation",
    "loadPendingHardDeletes",
    "persistPendingHardDeletes",
    "getManagedPersonReferences",
    "assertNoTombstonedPersonReferences",
    "applyHardDeleteOperations",
    "removeFailedHardDeleteArtifacts",
    "deleteManagedPerson",
    "saveState",
  ], {
    PERSON_TOMBSTONES_META_KEY: tombstoneKey,
    PENDING_HARD_DELETES_KEY: pendingKey,
    PENDING_LOCAL_CHANGES_KEY: "pending-local",
    STORAGE_KEY: "state",
    MANAGED_PERSON_TYPES: managedTypes,
    localStorage: storage,
    syncStatus: { mode: "supabase", text: "" },
    state: sourceState,
    clone,
    createId: () => "history-pending",
    mergeSharedState: mergeLikeOldDevice,
    saveMergedSharedState: () => new Promise(() => {}),
    showToast: () => {},
    render: () => {},
  });
  const deletion = creator.functions.deleteManagedPerson(
    sourceState,
    "host",
    person.id,
    new Date("2026-07-13T12:00:00.000Z"),
  );
  assert.equal(deletion.ok, true);
  creator.functions.saveState(deletion.state, "delete", { hardDeletes: deletion.hardDeletes });

  const serializedPending = JSON.parse(storage.getItem(pendingKey));
  assert.equal(serializedPending.length, 1);
  assert.equal(serializedPending[0].expectedVersion, deletion.hardDeletes[0].expectedVersion);
  assert.equal("photo_data_url" in serializedPending[0].personSnapshot, false);
  assert.equal("photo_name" in serializedPending[0].personSnapshot, false);

  const latestState = createState({
    users: [clone(person)],
    attendance_entries: [{ id: "new-reference", user_id: person.id }],
  });
  let saveCalls = 0;
  const toasts = [];
  const reloaded = loadFunctions(source, [
    ...migrationFunctions,
    "getHardDeleteOperationKey",
    "normalizePendingHardDeleteOperation",
    "loadPendingHardDeletes",
    "removePendingHardDeletes",
    "getManagedPersonVersion",
    "getManagedPersonReferences",
    "findManagedPersonByType",
    "hasManagedPersonTombstone",
    "createHardDeleteConflict",
    "validateHardDeletePreconditions",
    "assertNoTombstonedPersonReferences",
    "applyHardDeleteOperations",
    "removeFailedHardDeleteArtifacts",
    "materializePendingHardDelete",
    "reconcilePendingHardDeletes",
  ], migrationGlobals({
    PENDING_HARD_DELETES_KEY: pendingKey,
    PENDING_LOCAL_CHANGES_KEY: "pending-local",
    STORAGE_KEY: "state",
    localStorage: storage,
    state: deletion.state,
    clone,
    createId: () => "history-reloaded",
    loadSharedRecord: async () => ({ state: clone(latestState), updatedAt: "remote-latest" }),
    saveSharedState: async () => {
      saveCalls += 1;
    },
    showToast: (message, type) => toasts.push({ message, type }),
  }));

  const restored = reloaded.functions.loadPendingHardDeletes();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, person.id);
  assert.equal(restored[0].expectedVersion, deletion.hardDeletes[0].expectedVersion);

  await reloaded.functions.reconcilePendingHardDeletes(restored);

  assert.equal(saveCalls, 0, "a newly referenced person must not be deleted after reload");
  assert.equal(reloaded.context.state.users.some((user) => user.id === person.id), true);
  assert.equal(reloaded.context.state.attendance_entries.some((entry) => entry.user_id === person.id), true);
  assert.equal(reloaded.context.state.meta[tombstoneKey].length, 0);
  assert.equal(storage.getItem(pendingKey), null);
  assert.equal(toasts.some((toast) => toast.type === "error" && toast.message.includes("参照")), true);
});

test("concurrent reactivation or editing cancels a pending person deletion", async () => {
  const source = await readAppSource();
  const cases = [
    {
      label: "reactivated host",
      personType: "host",
      collection: "users",
      original: { id: "host-concurrent", display_name: "Host", is_active: false, updated_at: "2026-07-13T11:00:00.000Z" },
      latest: { id: "host-concurrent", display_name: "Host", is_active: true, updated_at: "2026-07-13T11:00:00.000Z" },
      message: "有効化",
    },
    {
      label: "edited staff",
      personType: "staff",
      collection: "staff_members",
      original: { id: "staff-concurrent", display_name: "Staff", is_active: false, note: "before", updated_at: "2026-07-13T11:00:00.000Z" },
      latest: { id: "staff-concurrent", display_name: "Staff edited", is_active: false, note: "after", updated_at: "2026-07-13T11:05:00.000Z" },
      message: "更新",
    },
  ];

  for (const item of cases) {
    let saveCalls = 0;
    const localState = createState({
      meta: {
        [tombstoneKey]: [{
          person_type: item.personType,
          person_id: item.original.id,
          deleted_at: "2026-07-13T12:00:00.000Z",
        }],
      },
    });
    const latestState = createState({ [item.collection]: [clone(item.latest)] });
    const { functions } = loadFunctions(source, [
      ...migrationFunctions,
      "getManagedPersonVersion",
      "getManagedPersonReferences",
      "findManagedPersonByType",
      "hasManagedPersonTombstone",
      "createHardDeleteConflict",
      "validateHardDeletePreconditions",
      "assertNoTombstonedPersonReferences",
      "applyHardDeleteOperations",
      "removeFailedHardDeleteArtifacts",
      "saveMergedSharedState",
    ], migrationGlobals({
      state: localState,
      localStorage: createMemoryStorage(),
      STORAGE_KEY: "state",
      clone,
      loadSharedRecord: async () => ({ state: clone(latestState), updatedAt: "remote-latest" }),
      saveSharedState: async () => {
        saveCalls += 1;
      },
    }));
    const operation = {
      personType: item.personType,
      id: item.original.id,
      collection: item.collection,
      historyTargetType: item.personType === "host" ? "user" : "staff_member",
      deletedAt: "2026-07-13T12:00:00.000Z",
      expectedVersion: functions.getManagedPersonVersion(item.original),
      personSnapshot: clone(item.original),
    };
    let conflict;
    try {
      await functions.saveMergedSharedState(localState, { hardDeletes: [operation] });
    } catch (error) {
      conflict = error;
    }

    assert.ok(conflict, `${item.label} must cancel deletion`);
    assert.equal(saveCalls, 0, `${item.label} must be stopped before shared save`);
    assert.equal(conflict.code, "HARD_DELETE_CONFLICT");
    assert.ok(conflict.userMessage.includes(item.message));
    assert.equal(conflict.recoveryState[item.collection].some((person) => person.id === item.original.id), true);
    assert.equal(conflict.recoveryState.meta[tombstoneKey].length, 0);
  }
});

test("reservation-only shared saves reject tombstoned and missing host IDs", async () => {
  const source = await readAppSource();
  const cases = [
    {
      label: "tombstoned",
      hostId: "host-deleted",
      latestState: createState({
        users: [{ id: "host-deleted", display_name: "Stale host", is_active: false }],
        meta: {
          [tombstoneKey]: [{ person_type: "host", person_id: "host-deleted", deleted_at: "2026-07-13T12:00:00.000Z" }],
        },
      }),
      errorPattern: /削除済み/,
    },
    {
      label: "missing",
      hostId: "host-missing",
      latestState: createState(),
      errorPattern: /存在しない/,
    },
  ];

  for (const item of cases) {
    let upsertCalls = 0;
    let saveCalls = 0;
    const globals = migrationGlobals({
      state: createState(),
      localStorage: createMemoryStorage(),
      STORAGE_KEY: "state",
      loadSharedRecord: async () => ({ state: clone(item.latestState), updatedAt: "remote-v1" }),
      findUser: (state, id) => (state.users || []).find((user) => String(user.id) === String(id)) || null,
      getReservationSaveConflict: () => null,
      upsertReservation: () => {
        upsertCalls += 1;
        return { ok: true, state: createState() };
      },
      saveSharedState: async () => {
        saveCalls += 1;
      },
      render: () => {},
    });
    const { functions } = loadFunctions(source, [
      ...migrationFunctions,
      "hasManagedPersonTombstone",
      "getReservationHostReferenceError",
      "saveReservationToSharedState",
    ], globals);

    const result = await functions.saveReservationToSharedState({ host_user_id: item.hostId }, false);

    assert.equal(result.ok, false, `${item.label} host must be rejected`);
    assert.match(result.errors[0], item.errorPattern);
    assert.equal(upsertCalls, 0);
    assert.equal(saveCalls, 0);
  }
});

test("hard deletion strips host photo data from histories and pending snapshots", async () => {
  const source = await readAppSource();
  const { functions } = loadFunctions(source, [
    ...tombstoneFunctions,
    "getManagedPersonVersion",
    "getManagedPersonReferences",
    "applyHardDeleteOperations",
    "removeFailedHardDeleteArtifacts",
    "deleteManagedPerson",
  ], {
    PERSON_TOMBSTONES_META_KEY: tombstoneKey,
    MANAGED_PERSON_TYPES: {
      host: { collection: "users", label: "ホスト", historyTargetType: "user", missingMessage: "missing host" },
      staff: { collection: "staff_members", label: "内勤", historyTargetType: "staff_member", missingMessage: "missing staff" },
    },
    clone,
    createId: () => "new-history",
    mergeSharedState: mergeLikeOldDevice,
  });
  const host = {
    id: "host-photo",
    display_name: "Photo host",
    is_active: false,
    photo_data_url: "data:image/png;base64,secret",
    photo_name: "secret.png",
  };
  const state = createState({
    users: [clone(host)],
    histories: [{
      id: "old-history",
      target_type: "user",
      target_id: host.id,
      before_payload: clone(host),
      after_payload: { ...clone(host), display_name: "Photo host edited" },
    }],
  });

  const sanitized = functions.removeHostPhotoData(host);
  assert.equal("photo_data_url" in sanitized, false);
  assert.equal("photo_name" in sanitized, false);
  assert.equal(host.photo_data_url.startsWith("data:image/"), true, "sanitizing must not mutate the source object");

  const result = functions.deleteManagedPerson(state, "host", host.id, new Date("2026-07-13T12:00:00.000Z"));

  assert.equal(result.ok, true);
  assert.equal("photo_data_url" in result.hardDeletes[0].personSnapshot, false);
  assert.equal("photo_name" in result.hardDeletes[0].personSnapshot, false);
  for (const history of result.state.histories.filter((item) => item.target_type === "user" && item.target_id === host.id)) {
    assert.equal("photo_data_url" in (history.before_payload || {}), false);
    assert.equal("photo_name" in (history.before_payload || {}), false);
    assert.equal("photo_data_url" in (history.after_payload || {}), false);
    assert.equal("photo_name" in (history.after_payload || {}), false);
  }
});
