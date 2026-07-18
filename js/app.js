import {
  ATTENDANCE_STATUSES,
  DRINK_LIMITS,
  DRINK_PLAN_TYPES,
  EVENT_STATUSES,
  IVAN_ATTRIBUTE,
  IVAN_ATTRIBUTES,
  REQUEST_TIME_SLOT_LABELS,
  RESERVATION_ATTRIBUTE,
  RESERVATION_SEAT_ORDER,
  ROLES,
  SEAT_TYPES,
  SLOT_LIMITS,
  STAFF_ATTENDANCE_STATUSES,
  TIME_SLOTS,
  buildDefaultState,
  archiveFinishedEvents,
  clone,
  configureCore,
  createId,
  deleteArchivedEvent,
  deleteDrinkPlan,
  deleteReservation,
  deleteReservationRequest,
  deleteRole,
  findEvent,
  findReservationBySlot,
  findStaffMember,
  findUser,
  formatDateLabel,
  formatDateTime,
  generateAttendanceDiscordText,
  generateReservationDiscordText,
  getActiveEvents,
  getActiveUsers,
  getAcceptedReservationRequestsForEvent,
  getArchivedEvents,
  getAttendanceEntry,
  getAttendanceEntriesForEvent,
  getAttendanceSummary,
  getDashboardIssues,
  getDrinkLimitStatuses,
  getDrinkTotals,
  getDrinkPlanTotals,
  getDrinkPlansForEvent,
  getGroupLabels,
  getInstanceAssignment,
  getLimitStatus,
  getMissingUsers,
  getReservationOpenAt,
  getReservationRequestOpenAt,
  getReservationRequestBuckets,
  getReservationRequestAcceptanceStatus,
  getReservationRequestsForEvent,
  getReservationSetting,
  getReservationSaveConflict,
  getReservationWarnings,
  getReservationsForEvent,
  getRoles,
  getSeatLimitStatuses,
  getActiveStaffMembers,
  getTimeSlotLabel,
  getMissingStaffMembers,
  getStaffAttendanceEntry,
  getStaffAttendanceEntriesForEvent,
  getStaffAttendanceSummary,
  getVacationExemptUsers,
  isEventArchived,
  isReservationFilled,
  isOnVacation,
  isReservationOpen,
  isReservationRequestOpen,
  isReservationRequestIvan,
  mergeSharedState,
  normalizeReservation,
  setReservationRequestPlacement,
  setStaffMemberActive,
  setUserActive,
  sortedStaffMembers,
  sortedUsers,
  toLocalDateTimeString,
  upsertAttendance,
  upsertDrinkPlan,
  upsertEvent,
  upsertInstanceAssignment,
  upsertReservation,
  upsertReservationRequest,
  upsertReservationSetting,
  upsertRole,
  upsertStaffAttendance,
  upsertStaffMember,
  upsertUser,
  upsertVacation,
  wasReservationChangedAfterEventCutoff,
} from "./core.js?v=champagne-labels-20260717";

function loadRequiredAppConfig() {
  const config = window.EVENT_MANAGER_CONFIG;
  const requiredValues = [
    ["appId", config?.appId],
    ["brandName", config?.brandName],
    ["title", config?.title],
    ["core.sitePassword", config?.core?.sitePassword],
    ["core.adminPassword", config?.core?.adminPassword],
  ];
  const missingKeys = requiredValues
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);

  if (!config || missingKeys.length) {
    const label = config?.brandName || "イベント管理";
    const detail = !config
      ? "window.EVENT_MANAGER_CONFIG が定義されていません。"
      : `必須設定が不足しています: ${missingKeys.join(", ")}`;
    const message = `${label} 設定エラー: ${detail}`;
    const errorRoot = document.querySelector("#app");
    if (errorRoot) {
      errorRoot.replaceChildren();
      const heading = document.createElement("h1");
      heading.textContent = `${label} 設定エラー`;
      const description = document.createElement("p");
      description.textContent = detail;
      errorRoot.append(heading, description);
    }
    console.error(message);
    throw new Error(message);
  }

  return config;
}

const APP_CONFIG = loadRequiredAppConfig();
const APP_ID = String(APP_CONFIG.appId).trim();
const LOCAL_STORAGE_VERSION = String(APP_CONFIG.localStorageVersion || "v1").trim() || "v1";
const STORAGE_KEY = `${APP_ID}:state:${LOCAL_STORAGE_VERSION}`;
const PENDING_LOCAL_CHANGES_KEY = `${APP_ID}:pending-local-changes`;
const PENDING_HARD_DELETES_KEY = `${APP_ID}:pending-hard-deletes`;
const PENDING_EVENT_DELETES_KEY = `${APP_ID}:pending-event-deletes`;
const PERSON_TOMBSTONES_META_KEY = "person_tombstones";
const EVENT_DELETE_RELATED_COLLECTIONS = [
  ["attendance_entries", "attendance"],
  ["staff_attendance_entries", "staff_attendance"],
  ["reservations", "reservation"],
  ["reservation_settings", "reservation_setting"],
  ["reservation_requests", "reservation_request"],
  ["drink_plans", "drink_plan"],
  ["instance_assignments", "instance_assignment"],
];
const SITE_SESSION_KEY = `${APP_ID}:site-unlocked`;
const ADMIN_SESSION_KEY = `${APP_ID}:admin-unlocked`;
const BRAND_NAME = String(APP_CONFIG.brandName);
const APP_TITLE = String(APP_CONFIG.title);
const APP_EYEBROW = String(APP_CONFIG.eyebrow || BRAND_NAME);
const LOGO_PATH = String(APP_CONFIG.logoPath || "").trim();
const WIDE_LOGO_PATH = String(APP_CONFIG.wideLogoPath || "").trim();
const LOGO_ALT = String(APP_CONFIG.logoAlt || `${BRAND_NAME} ロゴ`);
const STATE_ROW_ID = String(APP_CONFIG.stateRowId || APP_ID);
const STORE_THEMES = {
  lily: {
    key: "lily",
    label: "LILY",
    name: "Legacy Lily",
    title: BRAND_NAME,
    subLabel: "大阪・ミナミ",
    motif: "Lily",
    statusLabel: "active",
    logoPath: LOGO_PATH,
  },
  rose: {
    key: "rose",
    label: "ROSE",
    name: "Legacy Rose",
    title: "Legacy Rose",
    subLabel: "Coming Soon",
    motif: "Rose",
    statusLabel: "coming soon",
    logoPath: "",
  },
};
const requestedStoreTheme = String(APP_CONFIG.storeTheme || "lily").toLowerCase();
const STORE_THEME_KEY = STORE_THEMES[requestedStoreTheme] ? requestedStoreTheme : "lily";
const ACTIVE_STORE_THEME = STORE_THEMES[STORE_THEME_KEY];
const NAV_ICONS = {
  attendance: "◇",
  staffAttendance: "◈",
  attendanceList: "▤",
  reservation: "▣",
  admin: "◎",
};
const ADMIN_TAB_ICONS = {
  sales: "◇",
  attendanceGroup: "◈",
  dashboard: "◇",
  attendance: "◈",
  staffAttendance: "◎",
  missing: "△",
  hosts: "♙",
  staff: "♢",
  vacations: "□",
  events: "▧",
  reservations: "▣",
  instances: "▨",
  archive: "▥",
  totals: "◉",
  discord: "✧",
  histories: "≡",
  data: "▦",
};
const ADMIN_NAV_GROUPS = {
  sales: {
    label: "営業管理",
    detail: "4メニュー",
    defaultTab: "dashboard",
    items: [
      ["dashboard", "運営トップ"],
      ["instances", "インス振り分け"],
      ["reservations", "予約管理"],
      ["totals", "シャンパン集計"],
    ],
  },
  attendanceGroup: {
    label: "勤怠管理",
    detail: "2メニュー",
    defaultTab: "attendance",
    items: [
      ["attendance", "ホスト勤怠"],
      ["staffAttendance", "内勤勤怠"],
    ],
  },
};

configureCore(APP_CONFIG.core);
document.title = APP_TITLE;
document.documentElement.dataset.storeTheme = ACTIVE_STORE_THEME.key;

const root = document.querySelector("#app");
const toastRoot = document.querySelector("#toast");
const HOST_ATTENDANCE_LIST_STATUSES = ["出勤", "欠席", "未定", "体入", "未入力", "長期休暇"];
const VIEW_PAGES = new Set(["attendance", "staffAttendance", "attendanceList", "reservation", "admin"]);
const ADMIN_TABS = new Set([
  "dashboard",
  "attendance",
  "staffAttendance",
  "missing",
  "hosts",
  "staff",
  "vacations",
  "events",
  "reservations",
  "instances",
  "archive",
  "totals",
  "discord",
  "histories",
  "data",
]);
const RESERVATION_TABS = new Set(["requests", "towers"]);
const RESERVATION_DRINK_KEYS = ["purple", "red", "blue", "green"];
const RESERVATION_DRINK_TYPES = RESERVATION_DRINK_KEYS.map((key) => ({
  key,
  label: DRINK_LIMITS[key].label,
}));

let hasStoredLocalState = false;
let state = loadState();
let syncStatus = getInitialSyncStatus();
let sharedStateInitialized = syncStatus.mode !== "supabase";
let pendingAttendanceUserId = "";
const archiveResult = archiveFinishedEvents(state);
if (archiveResult.changed) {
  state = archiveResult.state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let siteUnlocked = sessionStorage.getItem(SITE_SESSION_KEY) === "1";
let adminUnlocked = sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
let view = {
  page: "attendance",
  adminTab: "dashboard",
  eventId: "",
  archiveEventId: "",
  attendanceRole: "",
  attendanceUserId: "",
  staffAttendanceMemberId: "",
  reservationTab: "requests",
  dashboardDetailType: "",
  dashboardDetailKey: "",
  editingUserId: "",
  editingStaffMemberId: "",
  editingVacationId: "",
  editingEventId: "",
  editingReservationRequestId: "",
  expandedInactivePersonType: "",
};

view.eventId = getDefaultEventId();
view.archiveEventId = getDefaultArchiveEventId();
view.staffAttendanceMemberId = getActiveStaffMembers(state)[0]?.id || "";
restoreViewFromLocation();

render();
initializeSharedState();

root.addEventListener("click", handleClick);
root.addEventListener("submit", handleSubmit);
root.addEventListener("change", handleChange);
window.addEventListener("hashchange", () => {
  restoreViewFromLocation();
  render();
});
window.setInterval(archiveEndedEvents, 60_000);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed?.meta || !Array.isArray(parsed.users)) return buildDefaultState();
    hasStoredLocalState = true;
    return migrateState(parsed);
  } catch (error) {
    console.warn(error);
    return buildDefaultState();
  }
}

function migrateState(saved) {
  const fresh = buildDefaultState();
  const migrated = {
    ...fresh,
    ...saved,
    event_dates: migrateEventDates(saved.event_dates || fresh.event_dates),
    reservations: migrateReservations(saved.reservations || [], saved.event_dates || fresh.event_dates),
    drink_plans: migrateDrinkPlans(saved.drink_plans || []),
    roles: saved.roles || fresh.roles,
    staff_members: saved.staff_members || [],
    staff_attendance_entries: saved.staff_attendance_entries || [],
    reservation_settings: saved.reservation_settings || [],
    reservation_requests: saved.reservation_requests || [],
    instance_assignments: saved.instance_assignments || [],
    settings: { ...fresh.settings, ...(saved.settings || {}) },
    meta: {
      ...fresh.meta,
      ...(saved.meta || {}),
      person_tombstones: typeof normalizePersonTombstones === "function"
        ? normalizePersonTombstones(saved.meta?.person_tombstones)
        : (saved.meta?.person_tombstones || []),
      event_tombstones: typeof normalizeEventTombstones === "function"
        ? normalizeEventTombstones(saved.meta?.event_tombstones)
        : (saved.meta?.event_tombstones || []),
    },
  };
  const personTombstonesApplied = typeof applyPersonTombstones === "function"
    ? applyPersonTombstones(migrated)
    : migrated;
  return typeof applyEventTombstones === "function"
    ? applyEventTombstones(personTombstonesApplied)
    : personTombstonesApplied;
}

function normalizePersonTombstones(tombstones) {
  const byPerson = new Map();
  for (const tombstone of Array.isArray(tombstones) ? tombstones : []) {
    const personType = tombstone?.person_type;
    const personId = String(tombstone?.person_id || "").trim();
    const deletedAt = typeof tombstone?.deleted_at === "string" ? tombstone.deleted_at : "";
    if (!["host", "staff"].includes(personType) || !personId || !Number.isFinite(Date.parse(deletedAt))) continue;
    const normalized = { person_type: personType, person_id: personId, deleted_at: deletedAt };
    const key = `${personType}:${personId}`;
    const current = byPerson.get(key);
    if (!current || Date.parse(normalized.deleted_at) >= Date.parse(current.deleted_at)) byPerson.set(key, normalized);
  }
  return [...byPerson.values()].sort((a, b) => {
    return `${a.person_type}:${a.person_id}`.localeCompare(`${b.person_type}:${b.person_id}`);
  });
}

function mergePersonTombstones(...states) {
  return normalizePersonTombstones(states.flatMap((item) => item?.meta?.[PERSON_TOMBSTONES_META_KEY] || []));
}

function normalizeEventTombstones(tombstones) {
  const byEvent = new Map();
  for (const tombstone of Array.isArray(tombstones) ? tombstones : []) {
    const eventId = String(tombstone?.event_id ?? "").trim();
    const deletedAt = typeof tombstone?.deleted_at === "string" ? tombstone.deleted_at : "";
    if (!eventId || !Number.isFinite(Date.parse(deletedAt))) continue;
    const normalized = { event_id: eventId, deleted_at: deletedAt };
    const eventSnapshot = createEventDeletionAuditSnapshot(tombstone?.event_snapshot, eventId);
    if (eventSnapshot) normalized.event_snapshot = eventSnapshot;
    const current = byEvent.get(eventId);
    if (!current || Date.parse(deletedAt) > Date.parse(current.deleted_at)) {
      byEvent.set(eventId, normalized);
      continue;
    }
    if (Date.parse(deletedAt) === Date.parse(current.deleted_at) && eventSnapshot) {
      const mergedSnapshot = createEventDeletionAuditSnapshot({
        ...(current.event_snapshot || {}),
        ...eventSnapshot,
      }, eventId);
      byEvent.set(eventId, { ...current, event_snapshot: mergedSnapshot });
    }
  }
  return [...byEvent.values()].sort((a, b) => a.event_id.localeCompare(b.event_id));
}

function createEventDeletionAuditSnapshot(event, eventId) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const snapshot = { id: String(eventId) };
  for (const field of ["event_date", "label", "status"]) {
    if (typeof event[field] === "string" && event[field].trim()) snapshot[field] = event[field];
  }
  return snapshot;
}

function mergeEventTombstones(...states) {
  return normalizeEventTombstones(states.flatMap((item) => item?.meta?.event_tombstones || []));
}

function canonicalizeEventDeleteValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeEventDeleteValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    return [key, canonicalizeEventDeleteValue(value[key])];
  }));
}

function createSharedEventDeleteFingerprint(event, relatedRecords) {
  // Keep this canonical form in sync with the fingerprint created by core.deleteArchivedEvent.
  const related = Object.fromEntries(EVENT_DELETE_RELATED_COLLECTIONS.map(([collection]) => {
    const normalized = (relatedRecords[collection] || []).map(canonicalizeEventDeleteValue);
    normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return [collection, normalized];
  }));
  const serialized = JSON.stringify(canonicalizeEventDeleteValue({ event, related }));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeEventDeleteRelatedRecordIds(relatedRecordIds) {
  if (!relatedRecordIds || typeof relatedRecordIds !== "object" || Array.isArray(relatedRecordIds)) return null;
  const normalized = {};
  for (const [collection] of EVENT_DELETE_RELATED_COLLECTIONS) {
    const ids = relatedRecordIds[collection];
    if (!Array.isArray(ids)) return null;
    const normalizedIds = [];
    for (const id of ids) {
      if (!["string", "number"].includes(typeof id) || (typeof id === "number" && !Number.isFinite(id))) return null;
      const normalizedId = String(id).trim();
      if (!normalizedId) return null;
      normalizedIds.push(normalizedId);
    }
    normalized[collection] = [...new Set(normalizedIds)].sort((a, b) => a.localeCompare(b));
  }
  return normalized;
}

function normalizeEventDeleteOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
  const eventId = String(operation.eventId ?? "").trim();
  const deletedAt = typeof operation.deletedAt === "string" ? operation.deletedAt : "";
  const expectedVersion = typeof operation.expectedVersion === "string" ? operation.expectedVersion : "";
  const fingerprint = typeof operation.fingerprint === "string" ? operation.fingerprint.trim().toLowerCase() : "";
  const eventSnapshot = operation.eventSnapshot && typeof operation.eventSnapshot === "object" && !Array.isArray(operation.eventSnapshot)
    ? JSON.parse(JSON.stringify(operation.eventSnapshot))
    : null;
  const relatedRecordIds = normalizeEventDeleteRelatedRecordIds(operation.relatedRecordIds);
  if (
    !eventId
    || !Number.isFinite(Date.parse(deletedAt))
    || !expectedVersion
    || !/^[0-9a-f]{8}$/.test(fingerprint)
    || !eventSnapshot
    || String(eventSnapshot.id) !== eventId
    || !relatedRecordIds
  ) return null;
  const snapshotVersion = eventSnapshot.updated_at || eventSnapshot.created_at || fingerprint;
  if (String(snapshotVersion) !== expectedVersion) return null;
  return { eventId, deletedAt, expectedVersion, fingerprint, eventSnapshot, relatedRecordIds };
}

function getEventDeleteOperationKey(operation) {
  return `${operation.eventId}:${operation.deletedAt}`;
}

function inspectPendingEventDeletes() {
  const raw = localStorage.getItem(PENDING_EVENT_DELETES_KEY);
  if (raw === null) {
    return { present: false, corrupted: false, operations: [], invalidOperations: [] };
  }
  try {
    const stored = JSON.parse(raw);
    const parsed = Array.isArray(stored) ? stored : [stored];
    const operations = [];
    const invalidOperations = [];
    for (const input of parsed) {
      const operation = normalizeEventDeleteOperation(input);
      if (operation) operations.push(operation);
      else invalidOperations.push(input);
    }
    return { present: true, corrupted: false, operations, invalidOperations };
  } catch (error) {
    console.warn(error);
    return { present: true, corrupted: true, operations: [], invalidOperations: [] };
  }
}

function loadPendingEventDeletes() {
  return inspectPendingEventDeletes().operations;
}

function writePendingEventDeletes(operations) {
  const pending = (operations || []).map(normalizeEventDeleteOperation).filter(Boolean);
  if (pending.length) localStorage.setItem(PENDING_EVENT_DELETES_KEY, JSON.stringify(pending));
  else localStorage.removeItem(PENDING_EVENT_DELETES_KEY);
}

function persistPendingEventDeletes(operations) {
  const byEvent = new Map(loadPendingEventDeletes().map((operation) => [operation.eventId, operation]));
  for (const input of operations || []) {
    const operation = normalizeEventDeleteOperation(input);
    if (operation) byEvent.set(operation.eventId, operation);
  }
  writePendingEventDeletes([...byEvent.values()]);
}

function removePendingEventDeletes(operations) {
  const keys = new Set((operations || []).map(getEventDeleteOperationKey));
  const pending = loadPendingEventDeletes().filter((operation) => !keys.has(getEventDeleteOperationKey(operation)));
  writePendingEventDeletes(pending);
}

function collectEventDeleteOperations(options = {}, includePending = false) {
  const inputs = [
    ...(includePending ? loadPendingEventDeletes() : []),
    ...(Array.isArray(options.eventDeletes) ? options.eventDeletes : []),
    ...(options.eventDelete !== undefined && options.eventDelete !== null ? [options.eventDelete] : []),
  ];
  const byEvent = new Map();
  for (const input of inputs) {
    const operation = normalizeEventDeleteOperation(input);
    if (operation) byEvent.set(operation.eventId, operation);
  }
  return [...byEvent.values()];
}

function getRequestedEventDeleteOperations(options = {}) {
  return [
    ...(Array.isArray(options.eventDeletes) ? options.eventDeletes : []),
    ...(options.eventDelete !== undefined && options.eventDelete !== null ? [options.eventDelete] : []),
  ];
}

function getEventDeletionTraceIds(nextState) {
  const eventIds = new Set(normalizeEventTombstones(nextState?.meta?.event_tombstones).map((tombstone) => {
    return String(tombstone.event_id);
  }));
  for (const history of nextState?.histories || []) {
    if (history.target_type !== "event" || history.after_payload?.deleted !== true) continue;
    const eventId = String(history.target_id ?? "").trim();
    if (eventId) eventIds.add(eventId);
  }
  return eventIds;
}

function hasCompletedSharedEventDeletion(sharedState, eventId) {
  if (normalizeEventTombstones(sharedState?.meta?.event_tombstones).some((tombstone) => {
    return String(tombstone.event_id) === String(eventId);
  })) return true;
  if ((sharedState?.event_dates || []).some((event) => String(event.id) === String(eventId))) return false;
  return !EVENT_DELETE_RELATED_COLLECTIONS.some(([collection]) => {
    return (sharedState?.[collection] || []).some((item) => String(item.event_date_id) === String(eventId));
  });
}

function findUnverifiedLocalEventDeletionIds(localState, sharedState, pendingOperations = []) {
  const authorizedEventIds = new Set((pendingOperations || []).map((operation) => String(operation.eventId)));
  return [...getEventDeletionTraceIds(localState)].filter((eventId) => {
    return !authorizedEventIds.has(eventId) && !hasCompletedSharedEventDeletion(sharedState, eventId);
  });
}

function findSharedAuthoritativeEventDeletionIds(localState, sharedState, pendingOperations = []) {
  const authorizedEventIds = new Set((pendingOperations || []).map((operation) => String(operation.eventId)));
  return [...getEventDeletionTraceIds(localState)].filter((eventId) => {
    return !authorizedEventIds.has(eventId) && hasCompletedSharedEventDeletion(sharedState, eventId);
  });
}

function restoreSharedEventDeletionAudit(localState, sharedState, eventIds) {
  const authoritativeIds = new Set((eventIds || []).map(String));
  if (!authoritativeIds.size) return localState;

  const restored = clone(localState);
  const localTombstones = normalizeEventTombstones(restored.meta?.event_tombstones).filter((tombstone) => {
    return !authoritativeIds.has(String(tombstone.event_id));
  });
  const sharedTombstones = normalizeEventTombstones(sharedState?.meta?.event_tombstones).filter((tombstone) => {
    return authoritativeIds.has(String(tombstone.event_id));
  });
  restored.meta = {
    ...(restored.meta || {}),
    updated_at: sharedState?.meta?.updated_at || restored.meta?.updated_at,
    event_tombstones: normalizeEventTombstones([...localTombstones, ...sharedTombstones]),
  };

  restored.histories = (restored.histories || []).filter((history) => {
    return !(
      history.target_type === "event"
      && authoritativeIds.has(String(history.target_id))
      && history.after_payload?.deleted === true
    );
  });
  const sharedDeletionHistories = (sharedState?.histories || []).filter((history) => {
    return history.target_type === "event"
      && authoritativeIds.has(String(history.target_id))
      && history.after_payload?.deleted === true;
  }).map((history) => clone(history));
  restored.histories.push(...sharedDeletionHistories);
  return applyEventTombstones(restored);
}

function getEventDeleteRelatedRecords(latestState, eventId) {
  return Object.fromEntries(EVENT_DELETE_RELATED_COLLECTIONS.map(([collection]) => {
    const records = (latestState?.[collection] || []).filter((item) => {
      return String(item.event_date_id) === String(eventId);
    });
    return [collection, records];
  }));
}

function getEventDeleteRelatedRecordIds(relatedRecords) {
  const ids = Object.fromEntries(EVENT_DELETE_RELATED_COLLECTIONS.map(([collection]) => {
    return [collection, (relatedRecords[collection] || [])
      .map((item) => item.id)
      .filter((id) => id !== undefined && id !== null && String(id).trim() !== "")];
  }));
  return normalizeEventDeleteRelatedRecordIds(ids);
}

function eventDeleteRelatedRecordIdsMatch(expectedIds, actualIds) {
  return EVENT_DELETE_RELATED_COLLECTIONS.every(([collection]) => {
    const expected = expectedIds[collection] || [];
    const actual = actualIds[collection] || [];
    return expected.length === actual.length && expected.every((id, index) => id === actual[index]);
  });
}

function createEventDeleteConflict(latestState, operation, message, code = "EVENT_DELETE_CONFLICT") {
  const error = new Error(code);
  error.code = code;
  error.userMessage = `${message} 最新の共有状態を読み込み直しました。`;
  error.recoveryState = clone(latestState);
  error.eventDeleteOperation = operation ? clone(operation) : null;
  error.eventDeleteOperations = operation ? [clone(operation)] : [];
  error.eventDeleteConflict = {
    eventId: operation?.eventId || "",
    reason: code,
  };
  return error;
}

function validateEventDeletePreconditions(latestState, operation) {
  const event = (latestState?.event_dates || []).find((item) => {
    return String(item.id) === String(operation.eventId);
  });
  if (!event) return { completed: true };

  const eventLabel = event.event_date ? `イベント日 ${event.event_date}` : `イベントID ${operation.eventId}`;
  if (!isEventArchived(event)) {
    throw createEventDeleteConflict(
      latestState,
      operation,
      `${eventLabel}が削除確認後にアーカイブから戻されたため、完全削除を中止しました。`,
      "EVENT_DELETE_NOT_ARCHIVED",
    );
  }
  if (JSON.stringify(canonicalizeEventDeleteValue(event)) !== JSON.stringify(canonicalizeEventDeleteValue(operation.eventSnapshot))) {
    throw createEventDeleteConflict(
      latestState,
      operation,
      `${eventLabel}が削除確認後に変更されたため、完全削除を中止しました。`,
      "EVENT_DELETE_EVENT_CHANGED",
    );
  }

  const relatedRecords = getEventDeleteRelatedRecords(latestState, operation.eventId);
  const relatedRecordIds = getEventDeleteRelatedRecordIds(relatedRecords);
  if (!relatedRecordIds || !eventDeleteRelatedRecordIdsMatch(operation.relatedRecordIds, relatedRecordIds)) {
    throw createEventDeleteConflict(
      latestState,
      operation,
      `${eventLabel}に紐づくデータが削除確認後に追加または削除されたため、完全削除を中止しました。`,
      "EVENT_DELETE_RELATED_CHANGED",
    );
  }

  const fingerprint = createSharedEventDeleteFingerprint(event, relatedRecords);
  if (fingerprint !== operation.fingerprint) {
    throw createEventDeleteConflict(
      latestState,
      operation,
      `${eventLabel}に紐づくデータが削除確認後に変更されたため、完全削除を中止しました。`,
      "EVENT_DELETE_RELATED_CHANGED",
    );
  }
  const currentVersion = event.updated_at || event.created_at || fingerprint;
  if (String(currentVersion) !== operation.expectedVersion) {
    throw createEventDeleteConflict(
      latestState,
      operation,
      `${eventLabel}のバージョンが削除確認後に変更されたため、完全削除を中止しました。`,
      "EVENT_DELETE_EVENT_CHANGED",
    );
  }
  return { completed: false, event };
}

function validateEventDeleteOperations(latestState, requestedOperations, operations) {
  const invalidOperation = (requestedOperations || []).find((operation) => !normalizeEventDeleteOperation(operation));
  if (invalidOperation) {
    throw createEventDeleteConflict(
      latestState,
      invalidOperation,
      "イベントの削除確認情報が不正なため、完全削除を中止しました。",
      "EVENT_DELETE_INVALID",
    );
  }
  for (const operation of operations || []) validateEventDeletePreconditions(latestState, operation);
}

function classifyEventDeleteOperations(latestState, requestedOperations, operations) {
  const conflicts = [];
  for (const input of requestedOperations || []) {
    if (normalizeEventDeleteOperation(input)) continue;
    conflicts.push({
      operation: input,
      error: createEventDeleteConflict(
        latestState,
        input,
        "イベントの削除確認情報が不正なため、完全削除を中止しました。",
        "EVENT_DELETE_INVALID",
      ),
    });
  }

  const applicable = [];
  for (const operation of operations || []) {
    try {
      const validation = validateEventDeletePreconditions(latestState, operation);
      applicable.push({ operation, validation });
    } catch (error) {
      if (!error.recoveryState) throw error;
      conflicts.push({ operation, error });
    }
  }
  return { applicable, conflicts };
}

function materializePendingEventDelete(nextState, operation) {
  const eventId = String(operation.eventId);
  const eventSnapshot = createEventDeletionAuditSnapshot(operation.eventSnapshot, eventId) || { id: eventId };
  const removedHistoryTargets = new Set();

  nextState.event_dates = (nextState.event_dates || []).filter((event) => String(event.id) !== eventId);
  for (const [collection, targetType] of EVENT_DELETE_RELATED_COLLECTIONS) {
    nextState[collection] = (nextState[collection] || []).filter((item) => {
      if (String(item.event_date_id) !== eventId) return true;
      if (item.id !== undefined && item.id !== null && String(item.id) !== "") {
        removedHistoryTargets.add(`${targetType}:${String(item.id)}`);
      }
      return false;
    });
  }

  const payloadReferencesEvent = (payload) => {
    return payload && typeof payload === "object" && String(payload.event_date_id) === eventId;
  };
  nextState.histories = (nextState.histories || []).filter((history) => {
    if (removedHistoryTargets.has(`${history.target_type}:${String(history.target_id)}`)) return false;
    if (history.target_type === "event" && String(history.target_id) === eventId) {
      return history.after_payload?.deleted === true && history.changed_at === operation.deletedAt;
    }
    return !payloadReferencesEvent(history.before_payload) && !payloadReferencesEvent(history.after_payload);
  });

  const deletionHistory = (nextState.histories || []).find((history) => {
    return history.target_type === "event"
      && String(history.target_id) === eventId
      && history.changed_at === operation.deletedAt
      && history.after_payload?.deleted === true;
  });
  if (deletionHistory) {
    deletionHistory.before_payload = eventSnapshot;
  } else {
    nextState.histories ||= [];
    nextState.histories.unshift({
      id: `hist_event_delete:${eventId}:${operation.deletedAt}`,
      target_type: "event",
      target_id: eventId,
      before_payload: eventSnapshot,
      after_payload: { deleted: true },
      changed_at: operation.deletedAt,
      change_note: "アーカイブを完全削除",
    });
  }

  const currentMetaUpdatedAt = nextState.meta?.updated_at || "";
  nextState.meta = {
    ...(nextState.meta || {}),
    updated_at: Date.parse(currentMetaUpdatedAt) > Date.parse(operation.deletedAt)
      ? currentMetaUpdatedAt
      : operation.deletedAt,
    event_tombstones: normalizeEventTombstones([
      ...(nextState.meta?.event_tombstones || []),
      { event_id: eventId, deleted_at: operation.deletedAt, event_snapshot: eventSnapshot },
    ]),
  };
  return applyEventTombstones(nextState);
}

function mergeSharedStateWithPersonTombstones(remoteState, localState, options = {}) {
  const tombstones = typeof mergePersonTombstones === "function"
    ? mergePersonTombstones(remoteState, localState)
    : [];
  const eventTombstones = typeof mergeEventTombstones === "function"
    ? mergeEventTombstones(remoteState, localState)
    : [];
  const mergedState = mergeSharedState(remoteState, localState);
  mergedState.meta = {
    ...(mergedState.meta || {}),
    ...(typeof mergePersonTombstones === "function" ? { person_tombstones: tombstones } : {}),
    ...(typeof mergeEventTombstones === "function" ? { event_tombstones: eventTombstones } : {}),
  };
  if (options.deferTombstones) return mergedState;
  const personTombstonesApplied = typeof applyPersonTombstones === "function"
    ? applyPersonTombstones(mergedState)
    : mergedState;
  return typeof applyEventTombstones === "function"
    ? applyEventTombstones(personTombstonesApplied)
    : personTombstonesApplied;
}

function applyPersonTombstones(nextState) {
  const tombstones = normalizePersonTombstones(nextState.meta?.[PERSON_TOMBSTONES_META_KEY]);
  nextState.meta = {
    ...(nextState.meta || {}),
    [PERSON_TOMBSTONES_META_KEY]: tombstones,
  };
  for (const tombstone of tombstones) {
    removeManagedPersonRecord(nextState, tombstone.person_type, tombstone.person_id);
    sanitizeManagedPersonHistory(nextState, tombstone.person_type, tombstone.person_id);
  }
  if (typeof removeTombstonedPersonReferences === "function") removeTombstonedPersonReferences(nextState);
  return nextState;
}

function applyEventTombstones(nextState) {
  const tombstones = normalizeEventTombstones(nextState.meta?.event_tombstones);
  nextState.meta = {
    ...(nextState.meta || {}),
    event_tombstones: tombstones,
  };

  const deletedAtByEventId = new Map(tombstones.map((tombstone) => [String(tombstone.event_id), tombstone.deleted_at]));
  if (!deletedAtByEventId.size) return nextState;
  const payloadReferencesDeletedEvent = (payload) => {
    return payload && typeof payload === "object"
      && deletedAtByEventId.has(String(payload.event_date_id));
  };

  nextState.event_dates = (nextState.event_dates || []).filter((event) => {
    return !deletedAtByEventId.has(String(event.id));
  });

  const historyTargets = new Set();
  for (const [collection, targetType] of EVENT_DELETE_RELATED_COLLECTIONS) {
    nextState[collection] = (nextState[collection] || []).filter((item) => {
      if (!deletedAtByEventId.has(String(item.event_date_id))) return true;
      if (item.id !== undefined && item.id !== null && String(item.id) !== "") {
        historyTargets.add(`${targetType}:${String(item.id)}`);
      }
      return false;
    });
  }

  nextState.histories = (nextState.histories || []).filter((history) => {
    const targetKey = `${history.target_type}:${String(history.target_id)}`;
    if (historyTargets.has(targetKey)) return false;
    if (history.target_type === "event" && deletedAtByEventId.has(String(history.target_id))) {
      return history.after_payload?.deleted === true
        && history.changed_at === deletedAtByEventId.get(String(history.target_id));
    }
    return !payloadReferencesDeletedEvent(history.before_payload)
      && !payloadReferencesDeletedEvent(history.after_payload);
  });
  return nextState;
}

function getManagedPersonVersion(person) {
  const entries = Object.keys(person || {}).sort().map((key) => [key, person[key]]);
  const serialized = JSON.stringify(entries);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${person?.updated_at || ""}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function getHardDeleteOperationKey(operation) {
  return `${operation.personType}:${operation.id}:${operation.deletedAt}`;
}

function normalizePendingHardDeleteOperation(operation) {
  const personType = operation?.personType;
  const id = String(operation?.id || "").trim();
  const deletedAt = typeof operation?.deletedAt === "string" ? operation.deletedAt : "";
  const expectedVersion = typeof operation?.expectedVersion === "string" ? operation.expectedVersion : "";
  if (!["host", "staff"].includes(personType) || !id || !expectedVersion || !Number.isFinite(Date.parse(deletedAt))) return null;
  const personSnapshot = operation.personSnapshot && typeof operation.personSnapshot === "object"
    ? removeHostPhotoData(clone(operation.personSnapshot))
    : null;
  return {
    personType,
    id,
    collection: personType === "host" ? "users" : "staff_members",
    historyTargetType: personType === "host" ? "user" : "staff_member",
    deletedAt,
    expectedVersion,
    personSnapshot,
  };
}

function loadPendingHardDeletes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_HARD_DELETES_KEY) || "[]");
    return (Array.isArray(parsed) ? parsed : []).map(normalizePendingHardDeleteOperation).filter(Boolean);
  } catch (error) {
    console.warn(error);
    return [];
  }
}

function persistPendingHardDeletes(operations) {
  const byPerson = new Map(loadPendingHardDeletes().map((operation) => [`${operation.personType}:${operation.id}`, operation]));
  for (const input of operations || []) {
    const operation = normalizePendingHardDeleteOperation(input);
    if (!operation) continue;
    byPerson.set(`${operation.personType}:${operation.id}`, operation);
  }
  const pending = [...byPerson.values()];
  if (pending.length) localStorage.setItem(PENDING_HARD_DELETES_KEY, JSON.stringify(pending));
  else localStorage.removeItem(PENDING_HARD_DELETES_KEY);
}

function removePendingHardDeletes(operations) {
  const keys = new Set((operations || []).map(getHardDeleteOperationKey));
  const pending = loadPendingHardDeletes().filter((operation) => !keys.has(getHardDeleteOperationKey(operation)));
  if (pending.length) localStorage.setItem(PENDING_HARD_DELETES_KEY, JSON.stringify(pending));
  else localStorage.removeItem(PENDING_HARD_DELETES_KEY);
}

function migrateReservations(reservations, events) {
  const stamp = new Date().toISOString();
  return reservations.map((reservation) => {
    const event = events.find((item) => String(item.id) === String(reservation.event_date_id));
    const migrated = {
      ...reservation,
      id: reservation.id || createId("res"),
      created_at: reservation.created_at || stamp,
      updated_at: reservation.updated_at || reservation.created_at || stamp,
      deleted_at: reservation.deleted_at || null,
      is_deleted: Boolean(reservation.is_deleted),
      attribute: RESERVATION_ATTRIBUTE,
      ivan_attribute: IVAN_ATTRIBUTES.includes(reservation.ivan_attribute) ? reservation.ivan_attribute : IVAN_ATTRIBUTE,
    };
    if (migrated.late_warning && !wasReservationChangedAfterEventCutoff(event, migrated)) {
      migrated.late_warning = false;
    }
    return migrated;
  });
}

function migrateEventDates(events) {
  return events.map((event) => {
    if (!event.event_date) return event;
    const autoOpenAt = getReservationOpenAt(event.event_date);
    const legacyOpenAt = getLegacyReservationOpenAt(event.event_date);
    const previousAutoOpenAt = getPreviousReservationOpenAt(event.event_date);
    const shouldUpdateOpenAt = !event.reservation_open_at || [legacyOpenAt, previousAutoOpenAt].includes(event.reservation_open_at);
    return {
      ...event,
      reservation_open_at: shouldUpdateOpenAt ? autoOpenAt : event.reservation_open_at,
    };
  });
}

function getLegacyReservationOpenAt(eventDate) {
  const date = new Date(`${eventDate}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(22, 0, 0, 0);
  return toLocalDateTimeString(date);
}

function getPreviousReservationOpenAt(eventDate) {
  const date = new Date(`${eventDate}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day - 7);
  date.setHours(22, 0, 0, 0);
  return toLocalDateTimeString(date);
}

function migrateDrinkPlans(plans) {
  const stamp = new Date().toISOString();
  return plans.map((plan) => ({
    ...plan,
    id: plan.id || createId("plan"),
    created_at: plan.created_at || stamp,
    updated_at: plan.updated_at || plan.created_at || stamp,
    deleted_at: plan.deleted_at || null,
    is_deleted: Boolean(plan.is_deleted),
  }));
}

function isPlaceholder(value) {
  return !value || String(value).startsWith("PASTE_");
}

function getStorageMode() {
  return APP_CONFIG.storageMode === "supabase" && !isPlaceholder(APP_CONFIG.supabaseUrl) && !isPlaceholder(APP_CONFIG.supabaseAnonKey)
    ? "supabase"
    : "local";
}

function getInitialSyncStatus() {
  if (APP_CONFIG.storageMode === "supabase" && getStorageMode() !== "supabase") {
    return { mode: "error", text: "Supabase未設定。URL/keyを入力してください" };
  }
  const mode = getStorageMode();
  return { mode, text: mode === "supabase" ? "共有DBに接続中" : "この端末に保存" };
}

async function initializeSharedState() {
  if (syncStatus.mode !== "supabase") return;
  const pendingEventDeleteInspection = typeof inspectPendingEventDeletes === "function"
    ? inspectPendingEventDeletes()
    : {
        present: false,
        corrupted: false,
        operations: typeof loadPendingEventDeletes === "function" ? loadPendingEventDeletes() : [],
        invalidOperations: [],
      };
  const pendingEventDeletes = pendingEventDeleteInspection.operations;
  const pendingHardDeletes = typeof loadPendingHardDeletes === "function" ? loadPendingHardDeletes() : [];
  try {
    let record = await loadSharedRecord();
    const hasPendingLocalChangesAtStart = localStorage.getItem(PENDING_LOCAL_CHANGES_KEY) === "1";
    if (record.state && hasStoredLocalState && hasPendingLocalChangesAtStart) {
      const latestSharedState = migrateState(record.state);
      const sharedAuthoritativeEventDeleteIds = typeof findSharedAuthoritativeEventDeletionIds === "function"
        ? findSharedAuthoritativeEventDeletionIds(state, latestSharedState, pendingEventDeletes)
        : [];
      if (sharedAuthoritativeEventDeleteIds.length && typeof restoreSharedEventDeletionAudit === "function") {
        state = restoreSharedEventDeletionAudit(state, latestSharedState, sharedAuthoritativeEventDeleteIds);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      const unverifiedEventDeleteIds = typeof findUnverifiedLocalEventDeletionIds === "function"
        ? findUnverifiedLocalEventDeletionIds(state, latestSharedState, pendingEventDeletes)
        : [];
      if (unverifiedEventDeleteIds.length) {
        state = latestSharedState;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (pendingEventDeletes.length || pendingHardDeletes.length) {
          localStorage.setItem(PENDING_LOCAL_CHANGES_KEY, "1");
        } else {
          localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
        }
        showToast(
          "イベント削除の保留情報を確認できなかったため、ローカルの削除を破棄して共有DBの最新状態へ復旧しました。",
          "error",
        );
      }
    }
    if (
      (pendingEventDeleteInspection.corrupted || pendingEventDeleteInspection.invalidOperations.length)
      && typeof writePendingEventDeletes === "function"
    ) {
      writePendingEventDeletes(pendingEventDeletes);
    }
    if (pendingEventDeletes.length) {
      await reconcilePendingEventDeletes(pendingEventDeletes);
      record = await loadSharedRecord();
    }
    if (record.state && pendingHardDeletes.length) {
      await reconcilePendingHardDeletes(pendingHardDeletes);
      record = await loadSharedRecord();
    }
    const hasPendingLocalChanges = localStorage.getItem(PENDING_LOCAL_CHANGES_KEY) === "1";
    const localState = hasStoredLocalState && hasPendingLocalChanges ? state : null;
    if (record.state) {
      const migratedRemoteState = migrateState(record.state);
      const mergedState = localState ? mergeSharedStateWithPersonTombstones(migratedRemoteState, localState) : migratedRemoteState;
      if (typeof assertNoTombstonedPersonReferences === "function") {
        assertNoTombstonedPersonReferences(mergedState, migratedRemoteState);
      }
      state = mergedState;
      let shouldSaveMigratedState = hasPersistableMigration(record.state, migratedRemoteState) || hasPersistableMerge(migratedRemoteState, mergedState);
      const result = archiveFinishedEvents(state);
      if (result.changed) {
        state = result.state;
        shouldSaveMigratedState = true;
      }
      if (shouldSaveMigratedState) await saveSharedStateWithRetry(state, record.updatedAt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
      syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
      sharedStateInitialized = true;
      if (typeof resolvePendingAttendanceUserSelection === "function") resolvePendingAttendanceUserSelection();
      render();
      return;
    }
    await saveSharedState(state);
    syncStatus = { mode: "supabase", text: "共有DBを初期化済み" };
    sharedStateInitialized = true;
    if (typeof resolvePendingAttendanceUserSelection === "function") resolvePendingAttendanceUserSelection();
    render();
  } catch (error) {
    console.error(error);
    if (error.recoveryState) {
      state = error.recoveryState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      removePendingHardDeletes(error.hardDeleteOperations || []);
      if (typeof removePendingEventDeletes === "function") {
        removePendingEventDeletes(error.eventDeleteOperations || pendingEventDeletes);
      }
      localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
      showToast(error.userMessage || "共有DBの最新状態を読み込みました。", "error");
      sharedStateInitialized = true;
      if (typeof resolvePendingAttendanceUserSelection === "function") resolvePendingAttendanceUserSelection();
    }
    syncStatus = { mode: "error", text: shortSyncError(error, "共有DBに接続できません") };
    render();
  }
}

async function reconcilePendingEventDeletes(operations) {
  const pending = (operations || []).map(normalizeEventDeleteOperation).filter(Boolean);
  if (!pending.length) return;
  const result = await saveMergedSharedState(state, {
    eventDeletes: pending,
    allowPartialEventDeletes: true,
  });
  removePendingEventDeletes(result?.processedEventDeletes || pending);
  const remainingEventDeletes = loadPendingEventDeletes();
  const remainingHardDeletes = typeof loadPendingHardDeletes === "function" ? loadPendingHardDeletes() : [];
  if (remainingEventDeletes.length || remainingHardDeletes.length) {
    localStorage.setItem(PENDING_LOCAL_CHANGES_KEY, "1");
  } else {
    localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
  }
  if (result?.eventDeleteConflicts?.length) {
    showToast(result.eventDeleteConflicts.map((conflict) => conflict.message).join(" / "), "error");
  }
}

async function reconcilePendingHardDeletes(operations) {
  const pending = (operations || []).map(normalizePendingHardDeleteOperation).filter(Boolean);
  if (!pending.length) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await loadSharedRecord();
    if (!record.state) throw new Error("PENDING_HARD_DELETE_WITHOUT_SHARED_STATE");
    const latestState = migrateState(record.state);
    const nextState = clone(latestState);
    const resumable = [];
    const completed = [];
    const cancelled = [];

    for (const operation of pending) {
      try {
        const validation = validateHardDeletePreconditions(latestState, operation);
        if (validation.completed) completed.push(operation);
        else {
          materializePendingHardDelete(nextState, operation, validation.person);
          resumable.push(operation);
        }
      } catch (error) {
        if (!error.recoveryState) throw error;
        cancelled.push({ operation, message: error.userMessage });
      }
    }

    assertNoTombstonedPersonReferences(nextState, latestState);
    if (resumable.length) {
      try {
        await saveSharedState(nextState, { expectedUpdatedAt: record.updatedAt });
      } catch (error) {
        if (error.code === "STALE_SHARED_STATE") continue;
        throw error;
      }
    }

    const processed = [...resumable, ...completed, ...cancelled.map((item) => item.operation)];
    removePendingHardDeletes(processed);
    localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
    state = resumable.length ? nextState : latestState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (cancelled.length) showToast(cancelled.map((item) => item.message).join(" / "), "error");
    return;
  }
  throw new Error("STALE_SHARED_STATE");
}

function materializePendingHardDelete(nextState, operation, latestPerson) {
  applyHardDeleteOperations(nextState, [operation]);
  const historyExists = (nextState.histories || []).some((history) => {
    return history.target_type === operation.historyTargetType
      && String(history.target_id) === String(operation.id)
      && history.changed_at === operation.deletedAt
      && history.after_payload?.deleted === true;
  });
  if (!historyExists) {
    nextState.histories ||= [];
    nextState.histories.unshift({
      id: createId("hist"),
      target_type: operation.historyTargetType,
      target_id: operation.id,
      before_payload: operation.personSnapshot || removeHostPhotoData(clone(latestPerson)),
      after_payload: { deleted: true },
      changed_at: operation.deletedAt,
      change_note: `${operation.personType === "host" ? "ホスト" : "内勤"}を完全削除`,
    });
    nextState.histories = nextState.histories.slice(0, 300);
  }
  const currentMetaUpdatedAt = nextState.meta?.updated_at || "";
  nextState.meta = {
    ...(nextState.meta || {}),
    updated_at: Date.parse(currentMetaUpdatedAt) > Date.parse(operation.deletedAt) ? currentMetaUpdatedAt : operation.deletedAt,
    [PERSON_TOMBSTONES_META_KEY]: normalizePersonTombstones([
      ...(nextState.meta?.[PERSON_TOMBSTONES_META_KEY] || []),
      { person_type: operation.personType, person_id: operation.id, deleted_at: operation.deletedAt },
    ]),
  };
  applyPersonTombstones(nextState);
  return nextState;
}

function hasPersistableMigration(before, after) {
  return [
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
    "meta",
  ].some((key) => {
    return JSON.stringify(before[key] || []) !== JSON.stringify(after[key] || []);
  });
}

function hasPersistableMerge(before, after) {
  return [
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
    "meta",
  ].some((key) => {
    return JSON.stringify(before[key] || []) !== JSON.stringify(after[key] || []);
  });
}

function shortSyncError(error, fallback) {
  const message = String(error?.message || error || fallback);
  const status = message.match(/Supabase (?:load|save) failed: (\d+)/)?.[1];
  if (status) return `${fallback} (${status})`;
  return fallback;
}

async function loadSharedState() {
  return (await loadSharedRecord()).state;
}

async function loadSharedRecord() {
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state?id=eq.${encodeURIComponent(
    STATE_ROW_ID,
  )}&select=payload,updated_at`;
  const response = await fetch(url, {
    headers: getSupabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Supabase load failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  const payload = rows[0]?.payload;
  return {
    state: payload && Object.keys(payload).length ? payload : null,
    updatedAt: rows[0]?.updated_at || "",
  };
}

async function saveSharedState(nextState, options = {}) {
  if (syncStatus.mode !== "supabase") return;
  const stateToSave = typeof applyEventTombstones === "function"
    ? applyEventTombstones(nextState)
    : nextState;
  if (options.expectedUpdatedAt) return saveSharedStateIfUnchanged(stateToSave, options.expectedUpdatedAt);
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...getSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: STATE_ROW_ID,
      payload: stateToSave,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status} ${await response.text()}`);
}

async function saveSharedStateIfUnchanged(nextState, expectedUpdatedAt) {
  const rowId = STATE_ROW_ID;
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state?id=eq.${encodeURIComponent(
    rowId,
  )}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...getSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      payload: nextState,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  if (!rows.length) {
    const error = new Error("STALE_SHARED_STATE");
    error.code = "STALE_SHARED_STATE";
    throw error;
  }
}

async function saveSharedStateWithRetry(nextState, expectedUpdatedAt = "") {
  let stateToSave = nextState;
  let expected = expectedUpdatedAt;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof applyEventTombstones === "function") applyEventTombstones(stateToSave);
    if (typeof assertNoTombstonedPersonReferences === "function") assertNoTombstonedPersonReferences(stateToSave);
    try {
      await saveSharedState(stateToSave, expected ? { expectedUpdatedAt: expected } : {});
      return stateToSave;
    } catch (error) {
      if (error.code !== "STALE_SHARED_STATE") throw error;
      const record = await loadSharedRecord();
      const latestState = record.state ? migrateState(record.state) : null;
      stateToSave = latestState ? mergeSharedStateWithPersonTombstones(latestState, stateToSave) : applyPersonTombstones(stateToSave);
      if (typeof applyEventTombstones === "function") applyEventTombstones(stateToSave);
      if (typeof assertNoTombstonedPersonReferences === "function") {
        assertNoTombstonedPersonReferences(stateToSave, latestState);
      }
      expected = record.updatedAt;
    }
  }
  throw new Error("STALE_SHARED_STATE");
}

function getSupabaseHeaders() {
  const headers = { apikey: APP_CONFIG.supabaseAnonKey };
  if (!String(APP_CONFIG.supabaseAnonKey).startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${APP_CONFIG.supabaseAnonKey}`;
  }
  return headers;
}

function saveState(nextState, message = "保存しました。", options = {}) {
  if (typeof applyEventTombstones === "function") applyEventTombstones(nextState);
  const hardDeleteByPerson = new Map();
  for (const input of [...loadPendingHardDeletes(), ...(options.hardDeletes || [])]) {
    const operation = normalizePendingHardDeleteOperation(input);
    if (operation) hardDeleteByPerson.set(`${operation.personType}:${operation.id}`, operation);
  }
  const hardDeletes = [...hardDeleteByPerson.values()];
  const eventDeletes = typeof collectEventDeleteOperations === "function"
    ? collectEventDeleteOperations(options, true)
    : [];
  const requestedEventDeletes = typeof getRequestedEventDeleteOperations === "function"
    ? getRequestedEventDeleteOperations(options)
    : [];
  const deferSharedSuccessToast = syncStatus.mode === "supabase"
    && (eventDeletes.length > 0 || requestedEventDeletes.length > 0);
  try {
    assertNoTombstonedPersonReferences(nextState, state);
  } catch (error) {
    showToast(error.userMessage || "削除済み人物への参照は保存できません。", "error");
    return;
  }
  if (syncStatus.mode === "supabase" && hardDeletes.length) persistPendingHardDeletes(hardDeletes);
  if (syncStatus.mode === "supabase" && eventDeletes.length && typeof persistPendingEventDeletes === "function") {
    persistPendingEventDeletes(eventDeletes);
  }
  state = nextState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (syncStatus.mode === "supabase") {
    localStorage.setItem(PENDING_LOCAL_CHANGES_KEY, "1");
    saveMergedSharedState(state, {
      ...options,
      hardDeletes,
      eventDeletes,
      allowPartialEventDeletes: eventDeletes.length > 0,
    })
      .then((result) => {
        removePendingHardDeletes(hardDeletes);
        if (typeof removePendingEventDeletes === "function") {
          removePendingEventDeletes(result?.processedEventDeletes || eventDeletes);
        }
        const remainingEventDeletes = typeof loadPendingEventDeletes === "function" ? loadPendingEventDeletes() : [];
        const remainingHardDeletes = typeof loadPendingHardDeletes === "function" ? loadPendingHardDeletes() : [];
        if (remainingEventDeletes.length || remainingHardDeletes.length) {
          localStorage.setItem(PENDING_LOCAL_CHANGES_KEY, "1");
        } else {
          localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
        }
        if (result?.eventDeleteConflicts?.length) {
          syncStatus = { mode: "error", text: "一部のイベント削除を中止" };
          showToast(result.eventDeleteConflicts.map((conflict) => conflict.message).join(" / "), "error");
        } else {
          syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
          if (deferSharedSuccessToast) showToast(message);
        }
        render();
      })
      .catch((error) => {
        console.error(error);
        if (error.recoveryState) {
          state = error.recoveryState;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          if (error.hardDeleteOperations) removePendingHardDeletes(error.hardDeleteOperations);
          else if (!error.eventDeleteConflict) removePendingHardDeletes(hardDeletes);
          if (typeof removePendingEventDeletes === "function" && error.eventDeleteConflict) {
            removePendingEventDeletes(error.eventDeleteOperations || eventDeletes);
          }
          if (error.clearPendingEventDeleteStorage && typeof writePendingEventDeletes === "function") {
            writePendingEventDeletes([]);
          }
          localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
          showToast(error.userMessage || "参照が追加されたため削除を取り消しました。", "error");
        }
        syncStatus = { mode: "error", text: shortSyncError(error, "共有DBへの保存に失敗") };
        render();
      });
  }
  if (!deferSharedSuccessToast) showToast(message);
  render();
}

async function saveMergedSharedState(localState, options = {}) {
  const hardDeletes = options.hardDeletes || [];
  const allowPartialEventDeletes = options.allowPartialEventDeletes === true;
  const requestedEventDeletes = typeof getRequestedEventDeleteOperations === "function"
    ? getRequestedEventDeleteOperations(options)
    : [];
  const eventDeletes = typeof collectEventDeleteOperations === "function"
    ? collectEventDeleteOperations(options)
    : [];
  const createResult = (nextState, classification) => ({
    state: nextState,
    processedEventDeletes: eventDeletes,
    successfulEventDeletes: classification.applicable.map((item) => item.operation),
    conflictedEventDeletes: classification.conflicts.map((item) => item.operation),
    eventDeleteConflicts: classification.conflicts.map((item) => ({
      eventId: item.operation?.eventId || "",
      code: item.error.code,
      message: item.error.userMessage,
    })),
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await loadSharedRecord();
    const migratedRemoteState = record.state ? migrateState(record.state) : null;
    const latestState = migratedRemoteState || localState;
    const sharedAuthoritativeEventDeleteIds = typeof findSharedAuthoritativeEventDeletionIds === "function"
      ? findSharedAuthoritativeEventDeletionIds(localState, latestState, eventDeletes)
      : [];
    const trustedLocalState = sharedAuthoritativeEventDeleteIds.length
      && typeof restoreSharedEventDeletionAudit === "function"
      ? restoreSharedEventDeletionAudit(localState, latestState, sharedAuthoritativeEventDeleteIds)
      : localState;
    if (!allowPartialEventDeletes && typeof validateEventDeleteOperations === "function") {
      validateEventDeleteOperations(latestState, requestedEventDeletes, eventDeletes);
    }
    const unverifiedEventDeleteIds = typeof findUnverifiedLocalEventDeletionIds === "function"
      ? findUnverifiedLocalEventDeletionIds(trustedLocalState, latestState, eventDeletes)
      : [];
    const unverifiedConflicts = unverifiedEventDeleteIds.map((eventId) => {
      const operation = { eventId };
      const error = createEventDeleteConflict(
        latestState,
        operation,
        "イベント削除の保留情報を確認できないローカル削除があるため、保存を中止しました。",
        "EVENT_DELETE_PENDING_MISSING",
      );
      error.clearPendingEventDeleteStorage = true;
      error.hardDeleteOperations = [];
      return { operation, error };
    });
    if (unverifiedConflicts.length && !allowPartialEventDeletes) throw unverifiedConflicts[0].error;

    let classification;
    if (allowPartialEventDeletes && typeof classifyEventDeleteOperations === "function") {
      classification = classifyEventDeleteOperations(latestState, requestedEventDeletes, eventDeletes);
      classification.conflicts.push(...unverifiedConflicts);
    } else {
      classification = {
        applicable: eventDeletes.map((operation) => ({ operation, validation: null })),
        conflicts: [],
      };
    }
    const hardDeleteValidations = hardDeletes.map((operation) => ({
      operation,
      validation: validateHardDeletePreconditions(latestState, operation),
    }));

    let mergedState;
    if (classification.conflicts.length) {
      mergedState = clone(latestState);
      for (const item of hardDeleteValidations) {
        if (!item.validation.completed) {
          materializePendingHardDelete(mergedState, item.operation, item.validation.person);
        }
      }
    } else {
      mergedState = migratedRemoteState
        ? mergeSharedStateWithPersonTombstones(migratedRemoteState, trustedLocalState, { deferTombstones: true })
        : trustedLocalState;
      applyHardDeleteOperations(mergedState, hardDeletes, { recoveryState: migratedRemoteState });
    }
    applyPersonTombstones(mergedState);
    if (typeof materializePendingEventDelete === "function") {
      for (const item of classification.applicable) {
        materializePendingEventDelete(mergedState, item.operation);
      }
    }
    if (typeof applyEventTombstones === "function") applyEventTombstones(mergedState);
    if (typeof assertNoTombstonedPersonReferences === "function") {
      assertNoTombstonedPersonReferences(mergedState, migratedRemoteState);
    }

    if (
      allowPartialEventDeletes
      && classification.conflicts.length
      && !classification.applicable.length
      && !hardDeletes.length
    ) {
      state = mergedState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return createResult(mergedState, classification);
    }
    if (attempt === 3) {
      state = mergedState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      throw new Error("STALE_SHARED_STATE");
    }
    try {
      await saveSharedState(mergedState, record.updatedAt ? { expectedUpdatedAt: record.updatedAt } : {});
      state = mergedState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return createResult(mergedState, classification);
    } catch (error) {
      if (error.code === "STALE_SHARED_STATE") continue;
      throw error;
    }
  }
}

function applyHardDeleteOperations(nextState, hardDeletes = [], options = {}) {
  for (const operation of hardDeletes || []) {
    if (!Array.isArray(nextState[operation.collection])) continue;
    const references = operation.personType
      ? getManagedPersonReferences(nextState, operation.personType, operation.id)
      : [];
    if (references.length) {
      const details = references.map((reference) => `${reference.label} ${reference.count}件`).join("、");
      const error = new Error("PERSON_REFERENCED");
      error.code = "PERSON_REFERENCED";
      error.userMessage = `${details} から参照されているため削除を取り消しました。`;
      error.recoveryState = options.recoveryState
        ? applyPersonTombstones(clone(options.recoveryState))
        : removeFailedHardDeleteArtifacts(nextState, operation);
      error.hardDeleteOperations = [operation];
      throw error;
    }
    if (operation.personType) {
      removeManagedPersonRecord(nextState, operation.personType, operation.id);
    } else {
      nextState[operation.collection] = nextState[operation.collection]
        .filter((item) => String(item.id) !== String(operation.id));
    }
    sanitizeManagedPersonHistory(nextState, operation.personType, operation.id);
  }
  return nextState;
}

function removeFailedHardDeleteArtifacts(nextState, operation) {
  const tombstones = normalizePersonTombstones(nextState.meta?.[PERSON_TOMBSTONES_META_KEY]).filter((tombstone) => {
    const samePerson = tombstone.person_type === operation.personType && String(tombstone.person_id) === String(operation.id);
    return !samePerson || tombstone.deleted_at !== operation.deletedAt;
  });
  nextState.meta = { ...(nextState.meta || {}), [PERSON_TOMBSTONES_META_KEY]: tombstones };
  nextState.histories = (nextState.histories || []).filter((history) => {
    return !(
      history.target_type === operation.historyTargetType
      && String(history.target_id) === String(operation.id)
      && history.changed_at === operation.deletedAt
      && history.after_payload?.deleted === true
    );
  });
  return applyPersonTombstones(nextState);
}

function sanitizeManagedPersonHistory(nextState, personType, personId) {
  if (personType !== "host") return nextState;
  nextState.histories = (nextState.histories || []).map((history) => {
    if (history.target_type !== "user" || String(history.target_id) !== String(personId)) return history;
    return {
      ...history,
      before_payload: removeHostPhotoData(history.before_payload),
      after_payload: removeHostPhotoData(history.after_payload),
    };
  });
  return nextState;
}

function removeHostPhotoData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const sanitized = { ...payload };
  delete sanitized.photo_data_url;
  delete sanitized.photo_name;
  return sanitized;
}

function archiveEndedEvents() {
  const result = archiveFinishedEvents(state);
  if (!result.changed) return;
  saveState(result.state, "終了したイベント日をアーカイブしました。");
}

function getDefaultEventId() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const activeEvents = state.event_dates.filter((event) => !isEventArchived(event));
  const open = activeEvents.find((event) => event.event_date >= todayKey && event.status !== "休み");
  return open?.id || activeEvents.find((event) => event.status !== "休み")?.id || activeEvents[0]?.id || "";
}

function getDefaultArchiveEventId() {
  const archived = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  return archived[0]?.id || "";
}

function normalizeAttendanceRole(role) {
  return String(role || "").trim() || "ホスト";
}

function getAttendanceUserRole(user) {
  return normalizeAttendanceRole(user?.role);
}

function getAttendanceRoleGroups(currentState) {
  const usersByRole = new Map();
  for (const user of getActiveUsers(currentState)) {
    const role = getAttendanceUserRole(user);
    if (!usersByRole.has(role)) usersByRole.set(role, []);
    usersByRole.get(role).push(user);
  }

  const configuredRoles = getRoles(currentState, true).map((role) => normalizeAttendanceRole(role.name));
  const roleOrder = [...new Set([...configuredRoles, ...usersByRole.keys()])];
  return roleOrder
    .filter((role) => usersByRole.has(role))
    .map((role) => ({ role, users: usersByRole.get(role) }));
}

function reconcileAttendanceSelection() {
  const roleGroups = getAttendanceRoleGroups(state);
  const selectedUser = getActiveUsers(state).find((user) => user.id === view.attendanceUserId);

  if (selectedUser) {
    view.attendanceRole = getAttendanceUserRole(selectedUser);
    return;
  }

  view.attendanceUserId = "";
  const selectedGroup = roleGroups.find((group) => group.role === view.attendanceRole);
  view.attendanceRole = selectedGroup?.role || "";
}

function resolvePendingAttendanceUserSelection() {
  if (!pendingAttendanceUserId) return;
  const selectedUser = getActiveUsers(state).find((user) => user.id === pendingAttendanceUserId);
  pendingAttendanceUserId = "";
  if (!selectedUser) {
    view.attendanceUserId = "";
    return;
  }
  view.attendanceUserId = selectedUser.id;
  view.attendanceRole = getAttendanceUserRole(selectedUser);
}

function restoreViewFromLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const page = params.get("page");
  const adminTab = params.get("adminTab");
  const reservationTab = params.get("reservationTab");

  if (VIEW_PAGES.has(page)) view.page = page;
  if (ADMIN_TABS.has(adminTab)) view.adminTab = adminTab;
  if (RESERVATION_TABS.has(reservationTab)) view.reservationTab = reservationTab;
  if (params.has("eventId")) view.eventId = params.get("eventId") || view.eventId;
  if (params.has("archiveEventId")) view.archiveEventId = params.get("archiveEventId") || "";
  if (params.has("attendanceRole")) {
    const requestedRole = String(params.get("attendanceRole") || "").trim();
    view.attendanceRole = requestedRole ? normalizeAttendanceRole(requestedRole) : "";
  }
  if (params.has("attendanceUserId")) {
    const requestedUserId = params.get("attendanceUserId") || "";
    const selectedUser = getActiveUsers(state).find((user) => user.id === requestedUserId);
    if (selectedUser) {
      pendingAttendanceUserId = "";
      view.attendanceUserId = selectedUser.id;
      view.attendanceRole = getAttendanceUserRole(selectedUser);
    } else if (requestedUserId && !sharedStateInitialized && getStorageMode() === "supabase") {
      pendingAttendanceUserId = requestedUserId;
      view.attendanceUserId = "";
    } else {
      pendingAttendanceUserId = "";
      view.attendanceUserId = "";
    }
  } else if (params.has("attendanceRole")) {
    pendingAttendanceUserId = "";
    view.attendanceUserId = "";
  }
  if (params.has("staffAttendanceMemberId")) view.staffAttendanceMemberId = params.get("staffAttendanceMemberId") || view.staffAttendanceMemberId;
  if (params.has("dashboardDetailType")) view.dashboardDetailType = params.get("dashboardDetailType") || "";
  if (params.has("dashboardDetailKey")) view.dashboardDetailKey = params.get("dashboardDetailKey") || "";
}

function saveViewToLocation() {
  const params = new URLSearchParams();
  params.set("page", view.page);
  params.set("eventId", view.eventId || "");
  if (view.page === "admin") params.set("adminTab", view.adminTab);
  if (view.page === "reservation" || (view.page === "admin" && view.adminTab === "reservations")) {
    params.set("reservationTab", view.reservationTab);
  }
  if (view.archiveEventId) params.set("archiveEventId", view.archiveEventId);
  if (view.attendanceRole) params.set("attendanceRole", view.attendanceRole);
  const attendanceUserId = view.attendanceUserId || (!sharedStateInitialized ? pendingAttendanceUserId : "");
  if (attendanceUserId) params.set("attendanceUserId", attendanceUserId);
  if (view.staffAttendanceMemberId) params.set("staffAttendanceMemberId", view.staffAttendanceMemberId);
  if (view.dashboardDetailType) params.set("dashboardDetailType", view.dashboardDetailType);
  if (view.dashboardDetailKey) params.set("dashboardDetailKey", view.dashboardDetailKey);

  const nextHash = `#${params.toString()}`;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
}

function render() {
  if (!siteUnlocked) {
    root.innerHTML = renderSiteLogin();
    return;
  }

  const selectedEvent = findEvent(state, view.eventId);
  if (!selectedEvent || isEventArchived(selectedEvent)) view.eventId = getDefaultEventId();
  if (view.archiveEventId && !findEvent(state, view.archiveEventId)) view.archiveEventId = "";
  reconcileAttendanceSelection();
  const selectedStaffMember = findStaffMember(state, view.staffAttendanceMemberId);
  if (!selectedStaffMember || selectedStaffMember.is_active === false) view.staffAttendanceMemberId = getActiveStaffMembers(state)[0]?.id || "";
  if (view.editingReservationRequestId && !(state.reservation_requests || []).some((request) => request.id === view.editingReservationRequestId && !request.is_deleted)) {
    view.editingReservationRequestId = "";
  }
  saveViewToLocation();

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-lockup" aria-label="${escapeAttr(`${BRAND_NAME} ${APP_TITLE}`)}">
          ${WIDE_LOGO_PATH
            ? `<img class="brand-wide-logo" src="${escapeAttr(WIDE_LOGO_PATH)}" alt="${escapeAttr(LOGO_ALT)}">`
            : `${LOGO_PATH ? `<img class="brand-mark" src="${escapeAttr(LOGO_PATH)}" alt="${escapeAttr(LOGO_ALT)}">` : ""}
              <div>
                <p class="brand-name">LEGACY GROUP</p>
                <p class="eyebrow">${escapeHtml(APP_EYEBROW)}</p>
              </div>`}
        </div>
        <div class="header-title">
          <h1>${escapeHtml(APP_TITLE)}</h1>
          <p>ホストクラブ運営を、美しく、スマートに。</p>
        </div>
        <div class="header-tools">
          ${renderStoreThemeSwitch()}
          <div class="admin-identity" aria-label="管理者情報">
            <span class="admin-avatar">◎</span>
            <span>
              <strong>ADMIN</strong>
              <small>システム管理者</small>
            </span>
          </div>
        </div>
        <nav class="top-nav" aria-label="主要画面">
          <span class="sync-pill ${syncStatus.mode}">${escapeHtml(syncStatus.text)}</span>
          ${navButton("attendance", "ホスト勤怠入力")}
          ${navButton("staffAttendance", "内勤勤怠入力")}
          ${navButton("attendanceList", "出勤一覧")}
          ${navButton("reservation", "予約入力")}
          ${navButton("admin", "運営画面")}
        </nav>
      </header>
      <main>
        ${renderCurrentPage()}
      </main>
    </div>
  `;
}

function renderStoreThemeSwitch() {
  return `
    <div class="store-switch" aria-label="STORE / THEME">
      <p>STORE / THEME</p>
      <div class="store-switch-options">
        ${renderStoreThemeTile(STORE_THEMES.lily)}
        ${renderStoreThemeTile(STORE_THEMES.rose)}
      </div>
    </div>
  `;
}

function renderStoreThemeTile(theme) {
  const isActive = theme.key === ACTIVE_STORE_THEME.key;
  const isDisabled = theme.key === "rose" && !isActive;
  const motif = theme.logoPath
    ? `<img src="${escapeAttr(theme.logoPath)}" alt="${escapeAttr(`${theme.name} ロゴ`)}">`
    : `<span class="store-theme-emblem">${theme.key === "rose" ? "R" : "L"}</span>`;
  return `
    <button class="store-theme-tile ${isActive ? "is-active" : ""} ${isDisabled ? "is-disabled" : ""}" type="button" ${isDisabled ? "disabled" : ""} aria-pressed="${isActive ? "true" : "false"}">
      ${motif}
      <span>
        <strong>${escapeHtml(theme.label)}</strong>
        <small>${escapeHtml(theme.name)}</small>
        <em>${escapeHtml(theme.statusLabel)}</em>
      </span>
    </button>
  `;
}

function renderSiteLogin() {
  return `
    <div class="app-shell">
      <section class="panel login-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Password</p>
            <h2>サイトログイン</h2>
          </div>
        </div>
        <form class="stack" data-action="site-login">
          <label>
            <span>サイト全体パスワード</span>
            <input name="password" type="password" autocomplete="current-password" required autofocus>
          </label>
          <button class="primary-button" type="submit">サイトを表示</button>
        </form>
        <p class="login-note">運営パスワードでもログインできます。その場合は運営画面も同時に解放されます。</p>
      </section>
    </div>
  `;
}

function navButton(page, label) {
  const icon = NAV_ICONS[page] || "□";
  const active = view.page === page;
  return `
    <button class="nav-button ${active ? "is-active" : ""}" data-action="navigate" data-page="${escapeAttr(page)}" type="button" ${active ? 'aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${icon}</span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderCurrentPage() {
  if (view.page === "staffAttendance") return renderStaffAttendancePage();
  if (view.page === "attendanceList") return renderHostAttendanceListPage();
  if (view.page === "reservation") return renderReservationPage(false);
  if (view.page === "admin") return renderAdminPage();
  return renderAttendancePage();
}

function renderAttendancePage() {
  const event = findEvent(state, view.eventId);
  const events = getActiveEvents(state)
    .filter((item) => item.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const activeUsers = getActiveUsers(state);
  const attendanceRoleGroups = getAttendanceRoleGroups(state);
  const selectedRoleGroup = attendanceRoleGroups.find((group) => group.role === view.attendanceRole);
  const roleUsers = selectedRoleGroup?.users || [];
  const selectedAttendanceUser = roleUsers.find((user) => user.id === view.attendanceUserId) || null;
  return `
    <section class="page-grid two-col">
      <div class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Host</p>
            <h2>ホスト勤怠まとめ入力</h2>
          </div>
          <span class="capacity ok">${events.length}日分</span>
        </div>
        <form class="bulk-attendance-form" data-action="save-bulk-attendance">
          <div class="attendance-person-selectors" role="group" aria-describedby="attendance-selection-help">
            <label>
              <span>ロール</span>
              <select data-role="attendance-role-select" aria-label="勤怠を入力するホストのロール" aria-describedby="attendance-selection-help" ${attendanceRoleGroups.length ? "" : "disabled"}>
                ${attendanceRoleGroups.length
                  ? `${option("", "ロールを選択してください", !selectedRoleGroup)}${attendanceRoleGroups.map((group) => option(group.role, `${group.role}（${group.users.length}人）`, group.role === view.attendanceRole)).join("")}`
                  : option("", "選択できるロールがありません", true)}
              </select>
            </label>
            <label>
              <span>ホスト名</span>
              <select name="user_id" data-role="attendance-user-select" aria-label="勤怠を入力するホスト" aria-describedby="attendance-selection-help" ${roleUsers.length ? "" : "disabled"}>
                ${option("", "選択してください", !selectedAttendanceUser)}
                ${roleUsers.map((user) => option(user.id, user.display_name, user.id === view.attendanceUserId)).join("")}
              </select>
            </label>
          </div>
          <p class="plan-note" id="attendance-selection-help">ロールを選び、続けて勤怠を入力するホストを選択してください。</p>
          <p class="plan-note">各日程の出欠をまとめて選択できます。何も選んでいない日は未入力のままです。</p>
          ${!activeUsers.length || !events.length
            ? `<p class="empty">入力対象の日程またはホストがありません。</p>`
            : !selectedAttendanceUser
              ? `<p class="attendance-selection-notice" role="status">ホストを選択すると、勤怠入力欄と保存ボタンが表示されます。</p>`
              : `
            <button class="primary-button bulk-save-button" type="submit">まとめて登録 / 更新する</button>
            <div class="bulk-attendance-list">
              ${events.map((item) => renderBulkAttendanceRow(item)).join("")}
            </div>
          `}
        </form>
      </div>
      <aside class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Status</p>
            <h2>${event ? formatDateLabel(event.event_date) : "対象日未設定"}</h2>
          </div>
          ${statusPill(event?.status || "未設定")}
        </div>
        <label>
          <span>確認する日付</span>
          <select data-role="event-select">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        ${renderAttendanceSummaryCards(view.eventId)}
        <div class="subsection">
          <h3>未入力者</h3>
          ${renderNameList(getMissingUsers(state, view.eventId), "未入力者はいません。")}
        </div>
      </aside>
    </section>
  `;
}

function renderBulkAttendanceRow(event) {
  const entry = getAttendanceEntry(state, event.id, view.attendanceUserId);
  return `
    <div class="bulk-attendance-row">
      <input type="hidden" name="attendance_event_id" value="${event.id}">
      <div class="bulk-date">
        <h3>${formatDateLabel(event.event_date)}</h3>
        <span>${formatDateTime(event.reservation_open_at)} 解放</span>
      </div>
      <div class="bulk-status-options" role="radiogroup" aria-label="${formatDateLabel(event.event_date)} の出欠">
        ${ATTENDANCE_STATUSES.map((status) => `
          <label class="bulk-status-option status-${status}">
            <input name="status_${event.id}" type="radio" value="${status}" ${entry?.status === status ? "checked" : ""}>
            <span>${bulkAttendanceLabel(status)}</span>
          </label>
        `).join("")}
      </div>
      <label class="bulk-memo">
        <span>メモ</span>
        <input name="memo_${event.id}" value="${escapeAttr(entry?.memo || "")}" placeholder="任意">
      </label>
    </div>
  `;
}

function bulkAttendanceLabel(status) {
  if (status === "出勤") return "○ 出勤";
  if (status === "欠席") return "× 欠席";
  if (status === "未定") return "△ 未定";
  return status;
}

function renderStaffAttendancePage() {
  const event = findEvent(state, view.eventId);
  const events = getActiveEvents(state)
    .filter((item) => item.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const staffMembers = getActiveStaffMembers(state);
  return `
    <section class="page-grid two-col">
      <div class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Staff</p>
            <h2>内勤勤怠まとめ入力</h2>
          </div>
          <span class="capacity ok">${events.length}日分</span>
        </div>
        <form class="bulk-attendance-form" data-action="save-bulk-staff-attendance">
          <label>
            <span>内勤名</span>
            <select name="staff_member_id" data-role="staff-attendance-member-select">
              ${staffMembers.map((member) => option(member.id, member.display_name, member.id === view.staffAttendanceMemberId)).join("")}
            </select>
          </label>
          <p class="plan-note">各日程の内勤出勤をまとめて選択できます。何も選んでいない日は未入力のままです。</p>
          ${staffMembers.length && events.length ? `
            <button class="primary-button bulk-save-button" type="submit">まとめて登録 / 更新する</button>
            <div class="bulk-attendance-list">
              ${events.map((item) => renderBulkStaffAttendanceRow(item)).join("")}
            </div>
          ` : `<p class="empty">入力対象の日程または内勤スタッフがありません。運営画面の「内勤一覧」から追加してください。</p>`}
        </form>
      </div>
      <aside class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Staff Status</p>
            <h2>${event ? formatDateLabel(event.event_date) : "対象日未設定"}</h2>
          </div>
          ${statusPill(event?.status || "未設定")}
        </div>
        <label>
          <span>確認する日付</span>
          <select data-role="event-select">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        ${renderStaffAttendanceSummaryCards(view.eventId)}
        <div class="subsection">
          <h3>内勤未入力</h3>
          ${renderNameList(getMissingStaffMembers(state, view.eventId), "内勤の未入力者はいません。")}
        </div>
      </aside>
    </section>
  `;
}

function renderBulkStaffAttendanceRow(event) {
  const entry = getStaffAttendanceEntry(state, event.id, view.staffAttendanceMemberId);
  return `
    <div class="bulk-attendance-row">
      <input type="hidden" name="attendance_event_id" value="${event.id}">
      <div class="bulk-date">
        <h3>${formatDateLabel(event.event_date)}</h3>
        <span>${formatDateTime(event.reservation_open_at)} 解放</span>
      </div>
      <div class="bulk-status-options is-staff" role="radiogroup" aria-label="${formatDateLabel(event.event_date)} の内勤出勤">
        ${STAFF_ATTENDANCE_STATUSES.map((status) => `
          <label class="bulk-status-option status-${status}">
            <input name="status_${event.id}" type="radio" value="${status}" ${entry?.status === status ? "checked" : ""}>
            <span>${bulkAttendanceLabel(status)}</span>
          </label>
        `).join("")}
      </div>
      <label class="bulk-memo">
        <span>メモ</span>
        <input name="memo_${event.id}" value="${escapeAttr(entry?.memo || "")}" placeholder="任意">
      </label>
    </div>
  `;
}

function renderHostAttendanceListPage() {
  const event = findEvent(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">Attendance List</p>
          <h2>${event ? formatDateLabel(event.event_date) : "出勤一覧"}</h2>
        </div>
        <div class="toolbar compact">
          <select data-role="event-select" aria-label="対象日">
            ${renderEventOptions(view.eventId)}
          </select>
          ${statusPill(event?.status || "未設定")}
        </div>
      </div>
      ${event?.status === "休み" ? `<div class="notice muted">この日は休みです。出勤一覧の対象外です。</div>` : ""}
      <div class="attendance-list-summaries">
        <section class="mini-panel">
          <h3>ホスト</h3>
          ${renderAttendanceSummaryCards(view.eventId)}
        </section>
        <section class="mini-panel">
          <h3>内勤</h3>
          ${renderStaffAttendanceSummaryCards(view.eventId)}
        </section>
      </div>
      <div class="attendance-list-grid">
        ${HOST_ATTENDANCE_LIST_STATUSES.map((status) => renderHostAttendanceListSection(status)).join("")}
      </div>
      <div class="section-title attendance-list-subtitle">
        <h3>内勤</h3>
      </div>
      <div class="attendance-list-grid">
        ${[...STAFF_ATTENDANCE_STATUSES, "未入力"].map((status) => renderStaffAttendanceListSection(status)).join("")}
      </div>
    </section>
  `;
}

function renderHostAttendanceListSection(status) {
  const items = getHostAttendanceListItems(status);
  return `
    <section class="mini-panel attendance-list-section status-${status}">
      <div class="section-title">
        <h3>${escapeHtml(status)}</h3>
        <span class="inline-pill muted">${items.length}人</span>
      </div>
      ${renderDetailList(items, `${status}のホストはいません。`)}
    </section>
  `;
}

function renderStaffAttendanceListSection(status) {
  const items = getStaffAttendanceListItems(status);
  return `
    <section class="mini-panel attendance-list-section status-${status}">
      <div class="section-title">
        <h3>${escapeHtml(status)}</h3>
        <span class="inline-pill muted">${items.length}人</span>
      </div>
      ${renderDetailList(items, `${status}の内勤はいません。`)}
    </section>
  `;
}

function getHostAttendanceListItems(status) {
  if (status === "未入力") {
    return getMissingUsers(state, view.eventId).map((user) => ({ title: user.display_name, meta: `ホスト / ${user.role || "ホスト"}` }));
  }
  if (status === "長期休暇") {
    return getVacationExemptUsers(state, view.eventId).map((user) => {
      const entry = getAttendanceEntry(state, view.eventId, user.id);
      return { title: user.display_name, meta: [`ホスト / ${user.role || "ホスト"}`, "長期休暇中", entry ? `${entry.status}入力あり` : ""].filter(Boolean).join(" / ") };
    });
  }
  const event = findEvent(state, view.eventId);
  return getActiveUsers(state)
    .map((user) => ({ user, entry: getAttendanceEntry(state, view.eventId, user.id) }))
    .filter(({ user, entry }) => entry?.status === status && !(event && isOnVacation(state, user.id, event.event_date)))
    .map(({ user }) => ({ title: user.display_name, meta: `ホスト / ${user.role || "ホスト"}` }));
}

function getStaffAttendanceListItems(status) {
  if (status === "未入力") {
    return getMissingStaffMembers(state, view.eventId).map((member) => ({ title: member.display_name, meta: `内勤 / ${member.staff_type || "内勤"}` }));
  }
  return getActiveStaffMembers(state)
    .map((member) => ({ member, entry: getStaffAttendanceEntry(state, view.eventId, member.id) }))
    .filter(({ entry }) => entry?.status === status)
    .map(({ member }) => ({ title: member.display_name, meta: `内勤 / ${member.staff_type || "内勤"}` }));
}

function renderReservationPage(adminMode) {
  const event = findEvent(state, view.eventId);
  const requestLocked = event && !adminMode && !isReservationRequestOpen(event);
  const isHoliday = event?.status === "休み";
  if (view.reservationTab === "grid") view.reservationTab = "requests";
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">${adminMode ? "Admin" : "Host"}</p>
          <h2>${event ? formatDateLabel(event.event_date) : "予約入力"}</h2>
        </div>
        <div class="toolbar compact">
          <div class="tab-switch" aria-label="予約表示切替">
            ${reservationTabButton("requests", "受付方式（仮）")}
            ${reservationTabButton("towers", "酒類一覧")}
          </div>
          <select data-role="event-select" aria-label="対象日">
            ${renderEventOptions(view.eventId)}
          </select>
          ${statusPill(event?.status || "未設定")}
        </div>
      </div>
      ${view.reservationTab === "towers" ? renderTowerScheduleOverview() : `
        ${renderReservationRequestOpenNotice(event, adminMode)}
        ${isHoliday ? `<div class="notice muted">この日は休みです。勤怠・予約入力対象外です。</div>` : ""}
        ${renderReservationRequestPrototype(event?.id || "", { adminMode, locked: Boolean(requestLocked || isHoliday) })}
      `}
    </section>
  `;
}

function reservationTabButton(tab, label) {
  return `<button class="tab-button ${view.reservationTab === tab ? "is-active" : ""}" data-action="reservation-tab" data-tab="${tab}" type="button">${label}</button>`;
}

function renderReservationOpenNotice(event, adminMode) {
  if (!event) return "";
  if (event.status === "休み") return "";
  if (adminMode) {
    return `<div class="notice">運営画面では予約解放前でも代理入力できます。通常解放: ${formatDateTime(event.reservation_open_at)}</div>`;
  }
  if (isReservationOpen(event)) {
    return `<div class="notice success">予約入力受付中です。解放日時: ${formatDateTime(event.reservation_open_at)}</div>`;
  }
  return `<div class="notice muted">この日の予約入力は対象週の水曜22:00から開始されます。現在は閲覧のみ可能です。解放日時: ${formatDateTime(event.reservation_open_at)}</div>`;
}

function renderReservationRequestOpenNotice(event, adminMode) {
  if (!event) return "";
  if (event.status === EVENT_STATUSES[2]) return "";
  const requestOpenAt = getReservationRequestOpenAt(event.event_date);
  if (adminMode) {
    return `<div class="notice">運営画面では受付方式（仮）の解放前でも代理入力できます。受付方式解放: ${formatDateTime(requestOpenAt)}</div>`;
  }
  if (isReservationRequestOpen(event)) {
    return `<div class="notice success">受付方式（仮）は受付中です。解放日時: ${formatDateTime(requestOpenAt)}</div>`;
  }
  return `<div class="notice muted">受付方式（仮）は対象週の水曜22:00から開始されます。現在は閲覧のみ可能です。解放日時: ${formatDateTime(requestOpenAt)}</div>`;
}

function renderReservationRequestPrototype(eventId, { adminMode = false, locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return "";
  const setting = getReservationSetting(state, eventId);
  const requests = getReservationRequestsForEvent(state, eventId);
  const buckets = getReservationRequestBuckets(state, eventId);
  const acceptance = getReservationRequestAcceptanceStatus(state, eventId);
  const requestLocked = locked || (!adminMode && acceptance.closed);
  const drinkPlanLocked = event.status === EVENT_STATUSES[2];
  const editingRequest = view.editingReservationRequestId
    ? requests.find((request) => request.id === view.editingReservationRequestId)
    : null;
  return `
    <section class="request-panel">
      <div class="section-title">
        <h3>予約受付方式（仮）</h3>
        <span class="capacity ${acceptance.closed ? "full" : "ok"}">${setting.instance_count}インスタンス / 合計 ${acceptance.total} / ${acceptance.capacity}</span>
      </div>
      <p class="plan-note">担当者は席を選ばず、受付順に予約を登録します。運営があとから予約枠・保留枠・インスタンスへ振り分けるための仮画面です。担当はホストのみ選択できます。</p>
      ${acceptance.closed ? `<div class="notice muted">受付上限 ${acceptance.capacity}件（予約枠${acceptance.reservationCapacity} + 保留枠${acceptance.holdCapacity}）に達しています。新規受付は締切です。</div>` : ""}
      ${adminMode ? renderReservationRequestSettingForm(eventId, setting) : ""}
      ${renderDrinkPlans(eventId, { locked: drinkPlanLocked })}
      ${renderReservationRequestForm(eventId, setting, requestLocked, editingRequest, adminMode)}
      ${renderReservationRequestSummaryV2(buckets, setting, acceptance)}
      ${renderReservationRequestBucketsV2(buckets, adminMode)}
      ${renderReservationRequestList(requests, adminMode, locked)}
    </section>
  `;
}

function renderReservationRequestSettingForm(eventId, setting) {
  return `
    <form class="request-setting-form" data-action="save-reservation-request-setting">
      <input type="hidden" name="event_date_id" value="${escapeAttr(eventId)}">
      <div class="request-setting-copy">
        <strong>運営用: インスタンス・予約枠設定</strong>
        <span>インスタンス数にかかわらず、前半・後半の通常席MAXとアイバン枠MAXを指定できます。</span>
      </div>
      <div class="request-setting-controls">
        <label class="request-instance-field">
          <span>インスタンス数</span>
          <select name="instance_count" data-role="request-instance-count">
            ${option("1", "1インスタンス（予約枠MAX指定）", setting.instance_count === 1)}
            ${option("2", "2インスタンス（予約枠MAX指定）", setting.instance_count === 2)}
          </select>
        </label>
        <div class="request-setting-capacities">
          <label>
            <span>前半 通常席MAX</span>
            <input name="normal_capacity_front" type="number" min="0" max="99" step="1" value="${setting.normal_capacity_front}">
          </label>
          <label>
            <span>後半 通常席MAX</span>
            <input name="normal_capacity_back" type="number" min="0" max="99" step="1" value="${setting.normal_capacity_back}">
          </label>
          <label>
            <span>アイバン枠MAX</span>
            <select name="ivan_capacity" data-role="request-ivan-capacity">
              ${option("2", "2枠", setting.ivan_capacity === 2)}
              ${option("4", "4枠", setting.ivan_capacity === 4)}
            </select>
          </label>
        </div>
        <button class="primary-button" type="submit">設定を反映</button>
      </div>
    </form>
  `;
}

function renderReservationRequestForm(eventId, setting, locked, editingRequest = null, adminMode = false) {
  const allowedSlots = TIME_SLOTS;
  const editing = editingRequest || {};
  const isEditing = Boolean(editingRequest);
  const immutableLocked = locked || (isEditing && !adminMode);
  const personOptions = getReservationPersonOptions(editing.host_user_id);
  const desiredSlot = editing.desired_time_slot || allowedSlots[0];
  const attribute = RESERVATION_ATTRIBUTE;
  const ivanAttribute = IVAN_ATTRIBUTES.includes(editing.ivan_attribute) ? editing.ivan_attribute : IVAN_ATTRIBUTE;
  return `
    <form class="reservation-request-form" data-action="save-reservation-request">
      ${isEditing ? `
        <div class="request-editing-notice">
          <strong>受付を編集中</strong>
          <span>${escapeHtml(getReservationPersonName(editing.host_user_id))} / ${escapeHtml(REQUEST_TIME_SLOT_LABELS[editing.desired_time_slot] || editing.desired_time_slot || "")} / ${formatHistoryDateTime(editing.created_at)}${adminMode ? "" : " / 担当・希望回は変更不可"}</span>
          <button class="ghost-button" data-action="new-reservation-request" type="button">新規入力に戻る</button>
        </div>
      ` : ""}
      <input type="hidden" name="id" value="${escapeAttr(editing.id || "")}">
      <input type="hidden" name="event_date_id" value="${escapeAttr(eventId)}">
      <div class="request-form-row request-host-row">
        <label><span>担当</span><select name="host_user_id" data-role="reservation-person-select" ${immutableLocked ? "disabled" : ""}><option value="">未選択</option>${personOptions.map((person) => option(person.id, person.label, person.id === editing.host_user_id)).join("")}</select></label>
        <label><span>希望回</span><select name="desired_time_slot" ${immutableLocked ? "disabled" : ""}>${allowedSlots.map((slot) => option(slot, REQUEST_TIME_SLOT_LABELS[slot] || slot, slot === desiredSlot)).join("")}</select></label>
      </div>
      <div class="request-form-row request-guest-row">
        <label><span>姫名</span><input name="princess_name" value="${escapeAttr(editing.princess_name || "")}" ${locked ? "disabled" : ""}></label>
        <label><span>属性</span><select name="attribute" data-role="reservation-attribute-select" ${locked ? "disabled" : ""}>${renderAttributeOptions(attribute, "attribute")}</select></label>
        <label><span>アイバン名</span><input name="ivan_name" value="${escapeAttr(editing.ivan_name || "")}" ${locked ? "disabled" : ""}></label>
        <label><span>アイバン属性</span><select name="ivan_attribute" data-role="reservation-attribute-select" ${locked ? "disabled" : ""}>${renderAttributeOptions(ivanAttribute, "ivan_attribute")}</select></label>
      </div>
      <div class="request-form-row request-drink-row">
        ${RESERVATION_DRINK_TYPES.map((item) => `<label><span>${escapeHtml(item.label)}</span><input name="${item.key}_count" type="number" min="0" step="1" value="${Number(editing[`${item.key}_count`]) || 0}" ${locked ? "disabled" : ""}></label>`).join("")}
        <label><span>タワー</span><select name="tower_count" ${locked ? "disabled" : ""}>${option("0", "なし", !Number(editing.tower_count))}${option("1", "あり", Boolean(Number(editing.tower_count)))}</select></label>
      </div>
      <div class="request-form-row request-submit-row">
        <label><span>メモ</span><input name="memo" value="${escapeAttr(editing.memo || "")}" placeholder="確認事項、交渉メモなど" ${locked ? "disabled" : ""}></label>
        <button class="primary-button" type="submit" ${locked ? "disabled" : ""}>${isEditing ? "受付を更新" : "受付に登録"}</button>
      </div>
    </form>
  `;
}

function renderReservationRequestSummaryV2(buckets, setting, acceptance) {
  return `
    <div class="request-summary-grid">
      <div class="mini-panel">
        <span>受付合計</span>
        <strong>${acceptance.total} / ${acceptance.capacity}</strong>
        <em>予約枠${acceptance.reservationCapacity} + 保留${acceptance.holdCapacity}</em>
        <span class="capacity ${acceptance.closed ? "full" : "ok"}">${acceptance.closed ? "締切" : "受付中"}</span>
      </div>
      <div class="mini-panel">
        <span>保留枠合計</span>
        <strong>${acceptance.holdUsed} / ${acceptance.holdCapacity}</strong>
        <em>前半3 / 後半3</em>
        <span class="capacity ${acceptance.holdUsed >= acceptance.holdCapacity ? "full" : "ok"}">${acceptance.holdUsed >= acceptance.holdCapacity ? "満枠" : `残り${acceptance.holdCapacity - acceptance.holdUsed}`}</span>
      </div>
      ${TIME_SLOTS.map((slot) => {
        const bucket = buckets[slot];
        return [
          renderRequestCapacityPanel(`${slot} 通常席`, bucket.normal),
          renderRequestCapacityPanel(`${slot} アイバン枠`, bucket.ivan),
        ].join("");
      }).join("")}
      ${TIME_SLOTS.map((slot) => renderRequestHoldCapacityPanel(slot, acceptance)).join("")}
    </div>
  `;
}

function renderRequestHoldCapacityPanel(slot, acceptance) {
  const used = acceptance.holdUsedByTimeSlot?.[slot] || 0;
  const cap = acceptance.holdCapacityByTimeSlot?.[slot] || 0;
  const level = used > cap ? "over" : used === cap ? "full" : "ok";
  return `<div class="mini-panel"><span>${escapeHtml(slot)} 保留枠</span><strong>${used} / ${cap}</strong><em>${used ? "予約枠超過分" : "まだ予約枠内"}</em><span class="capacity ${level}">${level === "over" ? "超過" : level === "full" ? "満枠" : `残り${cap - used}`}</span></div>`;
}

function renderRequestCapacityPanel(label, bucket) {
  const level = bucket.reserved.length > bucket.capacity ? "over" : bucket.reserved.length === bucket.capacity ? "full" : "ok";
  return `<div class="mini-panel"><span>${escapeHtml(label)}</span><strong>${bucket.reserved.length} / ${bucket.capacity}</strong><em>${bucket.hold.length ? `保留 ${bucket.hold.length}` : "保留なし"}</em><span class="capacity ${level}">${level === "over" ? "超過" : level === "full" ? "満枠" : "受付中"}</span></div>`;
}

function renderReservationRequestBucketsV2(buckets, adminMode) {
  return `
    <div class="request-bucket-grid">
      ${TIME_SLOTS.map((slot) => {
        const bucket = buckets[slot];
        return `
          ${renderRequestSeatBucket(`${slot} 通常席`, bucket.normal, adminMode)}
          ${renderRequestSeatBucket(`${slot} アイバン枠`, bucket.ivan, adminMode)}
        `;
      }).join("")}
    </div>
  `;
}

function renderRequestSeatBucket(label, bucket, adminMode) {
  return `
    <section class="request-bucket">
      <div class="section-title">
        <h3>${escapeHtml(label)}</h3>
        <span class="capacity ${bucket.reserved.length > bucket.capacity ? "over" : "ok"}">${bucket.reserved.length} / ${bucket.capacity}</span>
      </div>
      ${renderRequestCardsV2(bucket.reserved, adminMode, "予約枠はまだありません。")}
      <h4>保留枠</h4>
      ${renderRequestCardsV2(bucket.hold, adminMode, "保留枠はまだありません。")}
    </section>
  `;
}

function renderRequestCardsV2(requests, adminMode, emptyText) {
  if (!requests.length) return `<p class="empty">${emptyText}</p>`;
  return `<div class="request-card-list">${requests.map((request) => renderRequestCardV2(request, adminMode)).join("")}</div>`;
}

function renderRequestCardV2(request, adminMode) {
  const hostName = getReservationPersonName(request.host_user_id);
  const drinks = formatRequestDrinks(request);
  const seatType = isReservationRequestIvan(request) ? "アイバン枠" : "通常席";
  return `
    <article class="request-card ${request.placement_status || "auto"}">
      <div><strong>${escapeHtml(hostName)}</strong><span>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)} / ${escapeHtml(seatType)} / ${formatHistoryDateTime(request.created_at)}</span></div>
      <p>${escapeHtml(formatReservationGuestMeta(request) || "姫名未入力")}</p>
      <p>${escapeHtml([drinks, request.memo].filter(Boolean).join(" / "))}</p>
      ${adminMode ? renderRequestPlacementActionsV2(request) : renderHostRequestActions(request)}
    </article>
  `;
}

function renderRequestPlacementActionsV2(request) {
  return `
    <div class="request-actions">
      <button class="icon-button" data-action="edit-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">編集</button>
      <button class="icon-button" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="auto" type="button">自動</button>
      <button class="icon-button save" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="reserved" type="button">予約枠扱い</button>
      <button class="icon-button danger" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="hold" type="button">保留扱い</button>
      <button class="icon-button danger" data-action="delete-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">削除</button>
    </div>
  `;
}

function renderHostRequestActions(request) {
  return `
    <div class="request-actions">
      <button class="icon-button" data-action="edit-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">編集</button>
    </div>
  `;
}

function renderReservationRequestSummary(buckets, setting, acceptance) {
  return `
    <div class="request-summary-grid">
      <div class="mini-panel">
        <span>受付合計</span>
        <strong>${acceptance.total} / ${acceptance.capacity}</strong>
        <em>予約枠${acceptance.reservationCapacity} + 保留${acceptance.holdCapacity}</em>
        <span class="capacity ${acceptance.closed ? "full" : "ok"}">${acceptance.closed ? "締切" : "受付中"}</span>
      </div>
      <div class="mini-panel">
        <span>保留枠</span>
        <strong>${acceptance.holdUsed} / ${acceptance.holdCapacity}</strong>
        <em>${acceptance.holdUsed ? "予約枠超過分" : "まだ予約枠内"}</em>
        <span class="capacity ${acceptance.holdUsed >= acceptance.holdCapacity ? "full" : "ok"}">${acceptance.holdUsed >= acceptance.holdCapacity ? "満枠" : `残り${acceptance.holdCapacity - acceptance.holdUsed}`}</span>
      </div>
      ${TIME_SLOTS.map((slot) => {
        const bucket = buckets[slot];
        const level = bucket.reserved.length > bucket.capacity ? "over" : bucket.reserved.length === bucket.capacity ? "full" : "ok";
        return `<div class="mini-panel"><span>${REQUEST_TIME_SLOT_LABELS[slot]}</span><strong>${bucket.reserved.length} / ${bucket.capacity}</strong><em>${bucket.hold.length ? `保留 ${bucket.hold.length}` : "保留なし"}</em><span class="capacity ${level}">${level === "over" ? "超過" : level === "full" ? "満枠" : "受付中"}</span></div>`;
      }).join("")}
      ${setting.instance_count === 2 ? `<div class="mini-panel"><span>どちらでも可</span><strong>${buckets.flexible.length}</strong><em>運営調整枠</em><span class="capacity ok">振分待ち</span></div>` : ""}
    </div>
  `;
}

function renderReservationRequestBuckets(buckets, adminMode) {
  return `
    <div class="request-bucket-grid">
      ${TIME_SLOTS.map((slot) => `
        <section class="request-bucket">
          <div class="section-title">
            <h3>${REQUEST_TIME_SLOT_LABELS[slot]} 予約枠</h3>
            <span class="capacity ${buckets[slot].reserved.length > buckets[slot].capacity ? "over" : "ok"}">${buckets[slot].reserved.length} / ${buckets[slot].capacity}</span>
          </div>
          ${renderRequestCards(buckets[slot].reserved, adminMode, "予約枠はまだありません。")}
          <h4>保留枠</h4>
          ${renderRequestCards(buckets[slot].hold, adminMode, "保留枠はまだありません。")}
        </section>
      `).join("")}
      ${buckets.flexible.length ? `
        <section class="request-bucket span-2">
          <div class="section-title"><h3>どちらでも可（運営調整）</h3><span class="capacity ok">${buckets.flexible.length}件</span></div>
          ${renderRequestCards(buckets.flexible, adminMode, "調整枠はまだありません。")}
        </section>
      ` : ""}
    </div>
  `;
}

function renderRequestCards(requests, adminMode, emptyText) {
  if (!requests.length) return `<p class="empty">${emptyText}</p>`;
  return `<div class="request-card-list">${requests.map((request) => renderRequestCard(request, adminMode)).join("")}</div>`;
}

function renderRequestCard(request, adminMode) {
  const hostName = getReservationPersonName(request.host_user_id);
  const drinks = formatRequestDrinks(request);
  const flexibleHint = getFlexibleRequestHint(request);
  return `
    <article class="request-card ${request.placement_status || "auto"}">
      <div><strong>${escapeHtml(hostName)}</strong><span>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)} / ${formatHistoryDateTime(request.created_at)}</span></div>
      <p>${escapeHtml(formatReservationGuestMeta(request) || "姫名未入力")}</p>
      <p>${escapeHtml([drinks, request.no_same_time_double_booking ? "同タイム2枠不可" : "", flexibleHint, request.memo].filter(Boolean).join(" / "))}</p>
      ${adminMode ? renderRequestPlacementActions(request) : renderHostRequestActions(request)}
    </article>
  `;
}

function getFlexibleRequestHint(request) {
  if (request.desired_time_slot !== "どちらでも可" || !request.host_user_id) return "";
  const siblingRequests = getReservationRequestsForEvent(state, request.event_date_id)
    .filter((item) => item.id !== request.id && item.host_user_id === request.host_user_id);
  if (request.no_same_time_double_booking) {
    const blockedSlots = TIME_SLOTS.filter((slot) => {
      return siblingRequests.some((item) => {
        return item.desired_time_slot === slot && (item.no_same_time_double_booking || request.no_same_time_double_booking);
      });
    });
    const candidates = TIME_SLOTS.filter((slot) => !blockedSlots.includes(slot));
    if (candidates.length === 1) return `実質${REQUEST_TIME_SLOT_LABELS[candidates[0]]}`;
    if (!candidates.length) return "同タイム重複注意";
    const flexibleSiblings = siblingRequests.filter((item) => item.desired_time_slot === "どちらでも可" && item.no_same_time_double_booking);
    if (flexibleSiblings.length) return "前後半に分けて調整";
  }
  return "";
}

function renderRequestPlacementActions(request) {
  if (request.desired_time_slot === "どちらでも可") {
    return `<p class="request-note">前半・後半への振分は本実装時に対応します。</p>`;
  }
  return `
    <div class="request-actions">
      <button class="icon-button" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="auto" type="button">自動</button>
      <button class="icon-button save" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="reserved" type="button">予約枠扱い</button>
      <button class="icon-button danger" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="hold" type="button">保留扱い</button>
    </div>
  `;
}

function renderReservationRequestList(requests, adminMode, locked) {
  if (!requests.length) return `<p class="empty">受付はまだありません。</p>`;
  return `
    <div class="table-wrap request-table-wrap">
      <table class="data-table">
        <thead><tr><th>受付</th><th>担当</th><th>希望</th><th>姫 / アイバン</th><th>内容</th><th>扱い</th><th>操作</th></tr></thead>
        <tbody>
          ${requests.map((request, index) => `
            <tr>
              <td>#${String(index + 1).padStart(3, "0")}<br>${formatHistoryDateTime(request.created_at)}</td>
              <td>${escapeHtml(getReservationPersonName(request.host_user_id))}</td>
              <td>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)}</td>
              <td>${escapeHtml(formatReservationGuestMeta(request))}</td>
              <td>${escapeHtml([formatRequestDrinks(request), request.memo].filter(Boolean).join(" / "))}</td>
              <td>${escapeHtml(formatPlacementStatus(request.placement_status))}</td>
              <td>
                <button class="icon-button" data-action="edit-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button" ${locked && !adminMode ? "disabled" : ""}>編集</button>
                ${adminMode ? `<button class="icon-button danger" data-action="delete-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">削除</button>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatRequestDrinks(request) {
  return formatReservationDrinkBreakdown(request);
}

function formatPlacementStatus(status) {
  if (status === "reserved") return "予約枠扱い";
  if (status === "hold") return "保留扱い";
  return "自動";
}

function renderDrinkPlans(eventId, { locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return "";
  const plans = getDrinkPlansForEvent(state, eventId);
  const totals = getDrinkPlanTotals(state, eventId);
  return `
    <section class="drink-plan-panel">
      <div class="section-title">
        <h3>シャンパン・タワー事前申請</h3>
        <span class="capacity ok">予約解放前でも入力可</span>
      </div>
      <p class="plan-note">タワーやシャンパンを先に把握するための申請欄です。上限は2インスタンス前提で表示しています。</p>
      <form class="drink-plan-form" data-action="save-drink-plan">
        <input type="hidden" name="event_date_id" value="${eventId}">
        <label><span>予定タイミング</span><select name="time_slot" ${locked ? "disabled" : ""}>${TIME_SLOTS.map((slot) => option(slot, getTimeSlotLabel(slot), false)).join("")}</select></label>
        <label><span>担当</span><select name="host_user_id" data-role="reservation-person-select" ${locked ? "disabled" : ""}><option value="">未選択</option>${getReservationPersonOptions().map((person) => option(person.id, person.label, false)).join("")}</select></label>
        <label><span>種類</span><select name="item_type" ${locked ? "disabled" : ""}>${DRINK_PLAN_TYPES.map((item) => option(item.key, item.label, item.key === "tower")).join("")}</select></label>
        <label><span>本数</span><input name="count" type="number" min="1" step="1" value="1" ${locked ? "disabled" : ""}></label>
        <label class="span-2"><span>メモ</span><input name="memo" placeholder="姫名、予定内容、確認事項など" ${locked ? "disabled" : ""}></label>
        <button class="primary-button" type="submit" ${locked ? "disabled" : ""}>申請を追加</button>
      </form>
      ${renderDrinkPlanTotals(totals)}
      ${renderDrinkPlanList(plans, locked)}
    </section>
  `;
}

function renderDrinkPlanTotals(totals) {
  return `
    <ul class="plan-total-list">
      ${DRINK_PLAN_TYPES.map((item) => `<li><span>${item.label}</span><strong>${totals[item.key] || 0} / ${DRINK_LIMITS[item.key].limit}</strong></li>`).join("")}
    </ul>
  `;
}

function renderDrinkPlanList(plans, locked) {
  if (!plans.length) return `<p class="empty">事前申請はまだありません。</p>`;
  return `
    <div class="table-wrap plan-table-wrap">
      <table class="data-table plan-table">
        <thead><tr><th>申請</th><th>担当</th><th>種類</th><th>本数</th><th>メモ</th><th>操作</th></tr></thead>
        <tbody>
          ${plans.map((plan) => {
            const type = DRINK_PLAN_TYPES.find((item) => item.key === plan.item_type);
            return `
              <tr>
                <td>${getTimeSlotLabel(plan.time_slot)}</td>
                <td>${escapeHtml(getReservationPersonName(plan.host_user_id))}</td>
                <td>${escapeHtml(type?.label || plan.item_type)}</td>
                <td>${Number(plan.count) || 0}</td>
                <td>${escapeHtml(plan.memo || "")}</td>
                <td><button class="icon-button danger" data-action="delete-drink-plan" data-plan-id="${escapeAttr(plan.id || "")}" type="button" ${locked || !plan.id ? "disabled" : ""}>削除</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTowerScheduleOverview() {
  const events = getActiveEvents(state)
    .filter((event) => event.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  if (!events.length) return `<p class="empty">今後の開催日はありません。</p>`;
  return `
    <section class="tower-overview">
      <div class="section-title">
        <h3>この先のシャンパン・タワー状況</h3>
        <span class="capacity ok">空き日をまとめて確認</span>
      </div>
      <div class="tower-summary-list">
        ${events.map((event) => renderTowerScheduleItem(event)).join("")}
      </div>
    </section>
  `;
}

function renderTowerScheduleItem(event) {
  const showDrinkPlans = !isReservationRequestOpen(event);
  const actualTotals = getDrinkTotals(state, event.id);
  const planTotals = showDrinkPlans ? getDrinkPlanTotals(state, event.id) : {};
  const drinkStatuses = DRINK_PLAN_TYPES.map((item) => {
    const actual = actualTotals[item.key] || 0;
    const planned = planTotals[item.key] || 0;
    const total = actual + planned;
    const limit = DRINK_LIMITS[item.key].limit;
    return { ...item, actual, planned, total, limit, ...getLimitStatus(total, limit) };
  });
  const level = drinkStatuses.some((item) => item.level === "over")
    ? "over"
    : drinkStatuses.some((item) => item.level === "full")
      ? "full"
      : "ok";
  const activeDrinkTotal = drinkStatuses.reduce((sum, item) => sum + item.total, 0);
  const totalLimit = drinkStatuses.reduce((sum, item) => sum + item.limit, 0);
  const reservations = getReservationsForEvent(state, event.id).filter((reservation) => {
    return DRINK_PLAN_TYPES.some((item) => Number(reservation[item.key === "tower" ? "tower_count" : `${item.key}_count`]) > 0);
  });
  const acceptedRequests = getAcceptedReservationRequestsForEvent(state, event.id).filter((request) => {
    return DRINK_PLAN_TYPES.some((item) => Number(request[item.key === "tower" ? "tower_count" : `${item.key}_count`]) > 0);
  });
  const plans = showDrinkPlans ? getDrinkPlansForEvent(state, event.id) : [];
  return `
    <article class="tower-summary-item ${level}">
      <div class="tower-summary-main">
        <div>
          <p class="eyebrow">Drinks</p>
          <h3>${formatDateLabel(event.event_date)}</h3>
        </div>
        <span class="capacity ${level}">${activeDrinkTotal} / ${totalLimit} ${activeDrinkTotal === 0 ? "空き" : level === "over" ? "上限超過あり" : level === "full" ? "上限到達あり" : "申請あり"}</span>
      </div>
      <div class="tower-counts">
        ${drinkStatuses.map((item) => `<span class="${item.level}">${item.label} <strong>${item.total} / ${item.limit}</strong><em>${showDrinkPlans ? `実${item.actual} + 申${item.planned}` : `実${item.actual}`}</em></span>`).join("")}
      </div>
      ${reservations.length || acceptedRequests.length || plans.length ? `
        <ul class="tower-detail-list">
          ${reservations.map((reservation) => renderTowerReservationDetail(reservation)).join("")}
          ${acceptedRequests.map((request) => renderTowerRequestDetail(request)).join("")}
          ${plans.map((plan) => renderTowerPlanDetail(plan)).join("")}
        </ul>
      ` : `<p class="empty">シャンパン・タワー申請なし</p>`}
    </article>
  `;
}

function renderTowerReservationDetail(reservation) {
  const hostName = getReservationPersonName(reservation.host_user_id);
  const slot = `${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}`;
  const guest = formatReservationGuestMeta(reservation);
  const drinks = formatReservationDrinkBreakdown(reservation);
  const memo = reservation.memo ? ` / ${reservation.memo}` : "";
  return `<li><span class="inline-pill active">実予約</span><strong>${escapeHtml(slot)}</strong><em>${escapeHtml([hostName, guest, drinks].filter(Boolean).join(" / "))}${escapeHtml(memo)}</em></li>`;
}

function renderTowerRequestDetail(request) {
  const hostName = getReservationPersonName(request.host_user_id);
  const seatType = isReservationRequestIvan(request) ? "アイバン枠" : "通常席";
  const slot = `${REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot} ${seatType}`;
  const guest = formatReservationGuestMeta(request);
  const drinks = formatReservationDrinkBreakdown(request);
  const memo = request.memo ? ` / ${request.memo}` : "";
  return `<li><span class="inline-pill active">予約受付</span><strong>${escapeHtml(slot)}</strong><em>${escapeHtml([hostName, guest, drinks].filter(Boolean).join(" / "))}${escapeHtml(memo)}</em></li>`;
}

function formatReservationDrinkBreakdown(reservation) {
  return DRINK_PLAN_TYPES.map((item) => {
    const count = Number(reservation[item.key === "tower" ? "tower_count" : `${item.key}_count`]) || 0;
    return count ? `${item.label} ×${count}` : "";
  }).filter(Boolean).join(" / ");
}

function renderTowerPlanDetail(plan) {
  const hostName = getReservationPersonName(plan.host_user_id);
  const item = DRINK_LIMITS[plan.item_type];
  const memo = plan.memo ? ` / ${plan.memo}` : "";
  return `<li><span class="inline-pill muted">事前申請</span><strong>${escapeHtml(getTimeSlotLabel(plan.time_slot))}</strong><em>${escapeHtml(hostName)} / ${escapeHtml(item?.label || plan.item_type)} ${Number(plan.count) || 0}本${escapeHtml(memo)}</em></li>`;
}

function renderReservationGrid(eventId, { adminMode = false, locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return `<div class="empty">イベント日を作成してください。</div>`;
  return TIME_SLOTS.map((timeSlot) => {
    return RESERVATION_SEAT_ORDER.map((seatType) => renderReservationSection(eventId, timeSlot, seatType, adminMode, locked)).join("");
  }).join("");
}

function formatReservationGuestMeta(reservation) {
  return [
    formatGuestAttribute("姫", reservation.princess_name, reservation.attribute),
    formatGuestAttribute("アイバン", reservation.ivan_name, reservation.ivan_attribute),
  ].filter(Boolean).join(" / ");
}

function formatGuestAttribute(label, name, attribute) {
  if (!name) return "";
  return `${label}: ${name}${attribute ? `（${attribute}）` : ""}`;
}

function renderReservationSection(eventId, timeSlot, seatType, adminMode, locked) {
  const key = `${timeSlot}:${seatType}`;
  const count = getSeatLimitStatuses(state, eventId)[key];
  const noIvanColumn = seatType === SEAT_TYPES[0];
  const rows = getGroupLabels(seatType)
    .map((groupNo) => {
      const reservation = findReservationBySlot(state, eventId, timeSlot, seatType, groupNo);
      return renderReservationRow(reservation, { eventId, timeSlot, seatType, groupNo, adminMode, locked, noIvanColumn });
    })
    .join("");
  return `
    <section class="reservation-section">
      <div class="section-title">
        <h3>${getTimeSlotLabel(timeSlot)} ${seatType}</h3>
        <span class="capacity ${count.level}">${count.total} / ${count.limit}${count.level === "full" ? " 満席" : ""}${count.level === "over" ? " 超過" : ""}</span>
      </div>
      <div class="reservation-grid ${noIvanColumn ? "no-ivan-column" : ""}" role="table">
        <div class="grid-head" role="row">
          <span>組数</span><span>担当</span><span>姫名</span><span>属性</span>${noIvanColumn ? "" : "<span>アイバン名</span><span>属性</span>"}
          ${RESERVATION_DRINK_TYPES.map((item) => `<span>${escapeHtml(item.label)}</span>`).join("")}<span>タワー</span><span>メモ</span><span>操作</span>
        </div>
        ${rows}
      </div>
    </section>
  `;
}

function renderReservationRow(reservation, context) {
  const disabled = context.locked ? "disabled" : "";
  const data = reservation || {
    id: "",
    host_user_id: "",
    princess_name: "",
    ivan_name: "",
    attribute: RESERVATION_ATTRIBUTE,
    ivan_attribute: IVAN_ATTRIBUTE,
    purple_count: 0,
    red_count: 0,
    blue_count: 0,
    green_count: 0,
    tower_count: 0,
    memo: "",
  };
  const immutableDisabled = context.locked || (data.id && !context.adminMode) ? "disabled" : "";
  const warnings = reservation ? getReservationWarnings(state, reservation) : [];
  const rowClass = warnings.length ? "has-warning" : "";
  return `
    <div class="grid-row slot-row ${rowClass}" data-reservation-id="${escapeAttr(data.id || "")}" data-reservation-updated-at="${escapeAttr(data.updated_at || "")}" data-event-id="${escapeAttr(context.eventId)}" data-time-slot="${escapeAttr(context.timeSlot)}" data-seat-type="${escapeAttr(context.seatType)}" data-group-no="${escapeAttr(context.groupNo)}" role="row">
      <div class="grid-cell fixed" data-label="組数"><strong>${context.groupNo}</strong></div>
      <label class="grid-cell" data-label="担当">
        <select data-field="host_user_id" data-role="reservation-person-select" ${immutableDisabled}>
          <option value="">未選択</option>
          ${getReservationPersonOptions(data.host_user_id).map((person) => option(person.id, person.label, person.id === data.host_user_id)).join("")}
        </select>
      </label>
      ${textCell("princess_name", "姫名", data.princess_name, disabled)}
      ${attributeCell("attribute", context.noIvanColumn ? "属性" : "姫属性", data.attribute, disabled)}
      ${context.noIvanColumn ? "" : textCell("ivan_name", "アイバン名", data.ivan_name, disabled)}
      ${context.noIvanColumn ? "" : attributeCell("ivan_attribute", "アイバン属性", data.ivan_attribute, disabled)}
      ${RESERVATION_DRINK_TYPES.map((item) => numberCell(`${item.key}_count`, item.label, data[`${item.key}_count`], disabled)).join("")}
      <label class="grid-cell" data-label="タワー">
        <select data-field="tower_count" ${disabled}>
          ${option("0", "なし", Number(data.tower_count) === 0)}
          ${option("1", "あり", Number(data.tower_count) > 0)}
        </select>
      </label>
      ${textCell("memo", "メモ", data.memo, disabled)}
      <div class="grid-cell actions" data-label="操作">
        <button class="icon-button save" data-action="save-reservation" type="button" ${disabled}>${data.id ? "更新" : "登録"}</button>
        ${context.adminMode ? `<button class="icon-button danger" data-action="delete-reservation" type="button" ${disabled || !data.id ? "disabled" : ""}>削除</button>` : ""}
      </div>
      ${warnings.length ? `<div class="row-warning">${warnings.map(escapeHtml).join(" / ")}</div>` : ""}
    </div>
  `;
}

function textCell(field, label, value, disabled) {
  return `<label class="grid-cell" data-label="${label}"><input data-field="${field}" value="${escapeAttr(value || "")}" ${disabled}></label>`;
}

function attributeCell(field, label, value, disabled) {
  return `
    <label class="grid-cell" data-label="${label}">
      <select data-field="${field}" data-role="reservation-attribute-select" ${disabled}>
        ${renderAttributeOptions(value, field)}
      </select>
    </label>
  `;
}

function numberCell(field, label, value, disabled) {
  return `<label class="grid-cell compact-input" data-label="${label}"><input data-field="${field}" type="number" min="0" step="1" value="${Number(value) || 0}" ${disabled}></label>`;
}

function renderAdminPage() {
  if (!adminUnlocked) return renderAdminLogin();
  return `
    <section class="admin-layout">
      <aside class="admin-sidebar panel">
        <div class="admin-sidebar-head">
          <div>
            <p class="eyebrow">Operations</p>
            <h2>運営画面</h2>
          </div>
          <span class="sidebar-crest">LG</span>
        </div>
        <label class="sidebar-event-select">
          <span>対象日</span>
          <select data-role="event-select" aria-label="対象日">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        <nav class="side-nav" aria-label="運営メニュー">
          ${adminGroupButton("sales")}
          ${adminTabButton("events", "イベント日")}
          ${adminTabButton("hosts", "ホスト一覧")}
          ${adminTabButton("staff", "内勤一覧")}
          ${adminTabButton("vacations", "長期休暇")}
          ${adminTabButton("archive", "アーカイブ")}
          ${adminTabButton("histories", "変更履歴")}
          ${adminTabButton("data", "データ")}
        </nav>
        <div class="sidebar-store-card">
          <div class="sidebar-store-lockup">
            ${ACTIVE_STORE_THEME.logoPath ? `<img src="${escapeAttr(ACTIVE_STORE_THEME.logoPath)}" alt="${escapeAttr(`${ACTIVE_STORE_THEME.name} ロゴ`)}">` : ""}
            <div>
              <strong>${escapeHtml(ACTIVE_STORE_THEME.name)}</strong>
            </div>
          </div>
          <p>LEGACY GROUP</p>
        </div>
        <button class="ghost-button" data-action="admin-logout" type="button">ログアウト</button>
      </aside>
      <div class="admin-content">
        ${renderAdminContent()}
      </div>
    </section>
  `;
}

function renderAdminLogin() {
  return `
    <section class="panel login-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Password</p>
          <h2>運営画面ログイン</h2>
        </div>
      </div>
      <form class="stack" data-action="admin-login">
        <label>
          <span>共通パスワード</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="primary-button" type="submit">運営画面を表示</button>
      </form>
    </section>
  `;
}

function adminGroupButton(groupKey) {
  const group = ADMIN_NAV_GROUPS[groupKey];
  const active = group.items.some(([tab]) => view.adminTab === tab);
  const icon = ADMIN_TAB_ICONS[groupKey] || "□";
  return `
    <button class="side-button side-group-button ${active ? "is-active" : ""}" data-action="admin-tab" data-tab="${escapeAttr(group.defaultTab)}" type="button" ${active ? 'aria-current="page"' : ""}>
      <span class="side-icon" aria-hidden="true">${icon}</span>
      <span class="side-button-label">
        <strong>${escapeHtml(group.label)}</strong>
        <small>${escapeHtml(group.detail)}</small>
      </span>
    </button>
  `;
}

function adminTabButton(tab, label) {
  const icon = ADMIN_TAB_ICONS[tab] || "□";
  const active = view.adminTab === tab;
  return `
    <button class="side-button ${active ? "is-active" : ""}" data-action="admin-tab" data-tab="${escapeAttr(tab)}" type="button" ${active ? 'aria-current="page"' : ""}>
      <span class="side-icon" aria-hidden="true">${icon}</span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderAdminContent() {
  const groupKey = getAdminGroupKeyForTab(view.adminTab);
  const content = renderAdminContentBody();
  if (!groupKey) return content;
  return `${renderAdminSectionTabs(groupKey)}${content}`;
}

function renderAdminContentBody() {
  if (view.adminTab === "attendance") return renderAdminAttendance();
  if (view.adminTab === "staffAttendance") return renderAdminStaffAttendance();
  if (view.adminTab === "missing") return renderAdminMissing();
  if (view.adminTab === "hosts") return renderHostManagement();
  if (view.adminTab === "staff") return renderStaffManagement();
  if (view.adminTab === "vacations") return renderVacationManagement();
  if (view.adminTab === "events") return renderEventManagement();
  if (view.adminTab === "reservations") return renderReservationPage(true);
  if (view.adminTab === "instances") return renderInstancePlanner();
  if (view.adminTab === "archive") return renderArchive();
  if (view.adminTab === "totals") return renderTotals();
  if (view.adminTab === "discord") return renderDiscordTools();
  if (view.adminTab === "histories") return renderHistories();
  if (view.adminTab === "data") return renderDataTools();
  return renderAdminDashboard();
}

function getAdminGroupKeyForTab(tab) {
  return Object.entries(ADMIN_NAV_GROUPS).find(([, group]) => group.items.some(([itemTab]) => itemTab === tab))?.[0] || "";
}

function renderAdminSectionTabs(groupKey) {
  const group = ADMIN_NAV_GROUPS[groupKey];
  return `
    <nav class="admin-section-tabs panel" aria-label="${escapeAttr(group.label)}">
      <div>
        <p class="eyebrow">${escapeHtml(group.label)}</p>
        <h2>${escapeHtml(group.items.find(([tab]) => tab === view.adminTab)?.[1] || group.label)}</h2>
      </div>
      <div class="tab-switch admin-tab-switch">
        ${group.items.map(([tab, label]) => `
          <button class="tab-button ${view.adminTab === tab ? "is-active" : ""}" data-action="admin-tab" data-tab="${escapeAttr(tab)}" type="button" ${view.adminTab === tab ? 'aria-current="page"' : ""}>
            ${escapeHtml(label)}
          </button>
        `).join("")}
      </div>
    </nav>
  `;
}

function renderAdminDashboard() {
  const event = findEvent(state, view.eventId);
  const issues = getDashboardIssues(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">Dashboard</p>
          <h2>${event ? formatDateLabel(event.event_date) : "運営トップ"}</h2>
        </div>
        ${statusPill(event?.status || "未設定")}
      </div>
      <div class="dashboard-stack">
        <div class="dashboard-grid dashboard-attendance-grid">
          <div class="mini-panel">
            <h3>ホスト勤怠</h3>
            ${renderAttendanceSummaryCards(view.eventId, { detailType: "hostAttendance" })}
          </div>
          <div class="mini-panel">
            <h3>内勤勤怠</h3>
            ${renderStaffAttendanceSummaryCards(view.eventId, { detailType: "staffAttendance" })}
          </div>
        </div>
        ${renderDashboardDetailGroup(["hostAttendance", "staffAttendance"])}
        <div class="dashboard-grid dashboard-operations-grid">
          <div class="mini-panel">
            <h3>予約枠</h3>
            ${renderSeatStatusList(view.eventId, { detailType: "seat" })}
          </div>
          <div class="mini-panel">
            <h3>シャンパン・タワー</h3>
            ${renderDrinkStatusList(view.eventId, { detailType: "drink" })}
          </div>
          <div class="mini-panel">
            <h3>確認が必要</h3>
            ${issues.length ? `<ul class="issue-list">${issues.map((issue) => `<li class="${issue.level}">⚠ ${escapeHtml(issue.text)}</li>`).join("")}</ul>` : `<p class="empty">要確認項目はありません。</p>`}
          </div>
        </div>
        ${renderDashboardDetailGroup(["seat", "drink"])}
      </div>
    </section>
  `;
}

function renderAdminAttendance() {
  const event = findEvent(state, view.eventId);
  const rows = getActiveUsers(state).map((user) => {
    const entry = getAttendanceEntry(state, view.eventId, user.id);
    const vacation = event && isOnVacation(state, user.id, event.event_date);
    return `
      <tr>
        <td>${escapeHtml(user.display_name)}</td>
        <td>${escapeHtml(user.role)}${vacation ? `<span class="inline-pill muted">長期休暇</span>` : ""}</td>
        <td>
          <select data-field="status">
            ${ATTENDANCE_STATUSES.map((status) => option(status, status, status === (entry?.status || "出勤"))).join("")}
          </select>
        </td>
        <td><input data-field="memo" value="${escapeAttr(entry?.memo || "")}"></td>
        <td><button class="icon-button save" data-action="admin-save-attendance" data-user-id="${user.id}" type="button">保存</button></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Attendance</p><h2>ホスト勤怠管理</h2></div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト</th><th>状態</th><th>出欠</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAdminStaffAttendance() {
  const event = findEvent(state, view.eventId);
  const staffMembers = getActiveStaffMembers(state);
  const rows = staffMembers.map((member) => {
    const entry = getStaffAttendanceEntry(state, view.eventId, member.id);
    return `
      <tr>
        <td>${escapeHtml(member.display_name)}</td>
        <td>${escapeHtml(member.staff_type || "内勤")}</td>
        <td>
          <select data-field="status">
            ${STAFF_ATTENDANCE_STATUSES.map((status) => option(status, status, status === (entry?.status || "出勤"))).join("")}
          </select>
        </td>
        <td><input data-field="memo" value="${escapeAttr(entry?.memo || "")}"></td>
        <td><button class="icon-button save" data-action="admin-save-staff-attendance" data-staff-member-id="${member.id}" type="button">保存</button></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div><p class="eyebrow">Staff Attendance</p><h2>${event ? formatDateLabel(event.event_date) : ""} 内勤勤怠管理</h2></div>
        ${statusPill(event?.status || "未設定")}
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>内勤サマリー</h3>
          ${renderStaffAttendanceSummaryCards(view.eventId)}
        </div>
        <div class="mini-panel">
          <h3>未入力</h3>
          ${renderNameList(getMissingStaffMembers(state, view.eventId), "内勤の未入力者はいません。")}
        </div>
      </div>
      ${staffMembers.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>内勤</th><th>区分</th><th>出欠</th><th>メモ</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : `<p class="empty">内勤スタッフが未登録です。「内勤一覧」から追加してください。</p>`}
    </section>
  `;
}

function renderAdminMissing() {
  const event = findEvent(state, view.eventId);
  const missing = getMissingUsers(state, view.eventId);
  const missingStaff = getMissingStaffMembers(state, view.eventId);
  const exempt = getVacationExemptUsers(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Missing</p><h2>${event ? formatDateLabel(event.event_date) : ""} 未入力者</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>未入力</h3>
          ${renderNameList(missing, "未入力者はいません。")}
        </div>
        <div class="mini-panel">
          <h3>内勤未入力</h3>
          ${renderNameList(missingStaff, "内勤の未入力者はいません。")}
        </div>
        <div class="mini-panel">
          <h3>催促対象外</h3>
          ${renderNameList(exempt, "長期休暇中の対象者はいません。", "長期休暇中")}
        </div>
      </div>
    </section>
  `;
}

const MANAGED_PERSON_TYPES = {
  host: {
    collection: "users",
    label: "ホスト",
    historyTargetType: "user",
    missingMessage: "対象ホストが見つかりません。",
  },
  staff: {
    collection: "staff_members",
    label: "内勤",
    historyTargetType: "staff_member",
    missingMessage: "対象内勤が見つかりません。",
  },
};

function getManagedPersonReferences(state, personType, personId) {
  const id = String(personId);
  const references = [];
  const addReference = (collection, label, count) => references.push({ collection, label, count });

  if (personType === "host") {
    if ((state.attendance_entries || []).some((entry) => String(entry.user_id) === id)) {
      addReference("attendance_entries", "勤怠", state.attendance_entries.filter((entry) => String(entry.user_id) === id).length);
    }
    if ((state.long_vacations || []).some((vacation) => String(vacation.user_id) === id)) {
      addReference("long_vacations", "長期休暇", state.long_vacations.filter((vacation) => String(vacation.user_id) === id).length);
    }
  } else if (personType === "staff") {
    if ((state.staff_attendance_entries || []).some((entry) => String(entry.staff_member_id) === id)) {
      addReference("staff_attendance_entries", "内勤勤怠", state.staff_attendance_entries.filter((entry) => String(entry.staff_member_id) === id).length);
    }
  }

  if ((state.reservations || []).some((reservation) => String(reservation.host_user_id) === id)) {
    addReference("reservations", "予約", state.reservations.filter((reservation) => String(reservation.host_user_id) === id).length);
  }
  if ((state.reservation_requests || []).some((request) => String(request.host_user_id) === id)) {
    addReference("reservation_requests", "予約受付", state.reservation_requests.filter((request) => String(request.host_user_id) === id).length);
  }
  if ((state.drink_plans || []).some((plan) => String(plan.host_user_id) === id)) {
    addReference("drink_plans", "酒類予定", state.drink_plans.filter((plan) => String(plan.host_user_id) === id).length);
  }
  if ((state.instance_assignments || []).some((assignment) => {
    return assignment.person_type === personType && String(assignment.person_id) === id;
  })) {
    addReference("instance_assignments", "インスタンス振り分け", state.instance_assignments.filter((assignment) => {
      return assignment.person_type === personType && String(assignment.person_id) === id;
    }).length);
  }
  return references;
}

function findManagedPersonByType(state, personType, personId) {
  const collection = personType === "host" ? state.users : state.staff_members;
  return (collection || []).find((person) => String(person.id) === String(personId)) || null;
}

function hasManagedPersonTombstone(state, personType, personId) {
  return normalizePersonTombstones(state.meta?.[PERSON_TOMBSTONES_META_KEY]).some((tombstone) => {
    return tombstone.person_type === personType && String(tombstone.person_id) === String(personId);
  });
}

function createHardDeleteConflict(state, operation, message, code = "HARD_DELETE_CONFLICT") {
  const error = new Error(code);
  error.code = code;
  error.userMessage = message;
  error.recoveryState = applyPersonTombstones(clone(state));
  error.hardDeleteOperations = [operation];
  return error;
}

function validateHardDeletePreconditions(latestState, operation) {
  if (hasManagedPersonTombstone(latestState, operation.personType, operation.id)) return { completed: true };
  const person = findManagedPersonByType(latestState, operation.personType, operation.id);
  const label = operation.personType === "host" ? "ホスト" : "内勤";
  if (!person) {
    throw createHardDeleteConflict(latestState, operation, `削除処理中の${label}が共有DBで見つからないため、削除を中止しました。`);
  }
  if (person.is_active !== false) {
    throw createHardDeleteConflict(latestState, operation, `${person.display_name} は削除処理中に有効化されたため、削除を中止しました。`);
  }
  if (getManagedPersonVersion(person) !== operation.expectedVersion) {
    throw createHardDeleteConflict(latestState, operation, `${person.display_name} の情報が削除処理中に更新されたため、削除を中止しました。`);
  }
  const references = getManagedPersonReferences(latestState, operation.personType, operation.id);
  if (references.length) {
    const details = references.map((reference) => `${reference.label} ${reference.count}件`).join("、");
    throw createHardDeleteConflict(latestState, operation, `${person.display_name} は ${details} から参照されたため、削除を中止しました。`, "PERSON_REFERENCED");
  }
  return { completed: false, person };
}

function assertNoTombstonedPersonReferences(nextState, recoveryState = null) {
  const conflicts = [];
  for (const tombstone of normalizePersonTombstones(nextState.meta?.[PERSON_TOMBSTONES_META_KEY])) {
    const references = getManagedPersonReferences(nextState, tombstone.person_type, tombstone.person_id);
    if (references.length) conflicts.push({ tombstone, references });
  }
  if (!conflicts.length) return nextState;
  const details = conflicts.flatMap(({ tombstone, references }) => {
    const label = tombstone.person_type === "host" ? "削除済みホスト" : "削除済み内勤";
    return references.map((reference) => `${label}ID ${tombstone.person_id}: ${reference.label} ${reference.count}件`);
  }).join("、");
  const error = new Error("TOMBSTONED_PERSON_REFERENCED");
  error.code = "TOMBSTONED_PERSON_REFERENCED";
  error.userMessage = `古い端末から削除済み人物への参照が送信されたため保存を拒否しました。最新状態を読み込み直しました。${details}`;
  error.recoveryState = applyPersonTombstones(clone(recoveryState || nextState));
  throw error;
}

function removeTombstonedPersonReferences(nextState) {
  const hostIds = new Set();
  const staffIds = new Set();
  for (const tombstone of normalizePersonTombstones(nextState.meta?.[PERSON_TOMBSTONES_META_KEY])) {
    (tombstone.person_type === "host" ? hostIds : staffIds).add(String(tombstone.person_id));
  }
  if (!hostIds.size && !staffIds.size) return nextState;

  nextState.attendance_entries = (nextState.attendance_entries || []).filter((entry) => !hostIds.has(String(entry.user_id)));
  nextState.long_vacations = (nextState.long_vacations || []).filter((vacation) => !hostIds.has(String(vacation.user_id)));
  nextState.staff_attendance_entries = (nextState.staff_attendance_entries || []).filter((entry) => !staffIds.has(String(entry.staff_member_id)));
  const deletedPersonIds = new Set([...hostIds, ...staffIds]);
  nextState.reservations = (nextState.reservations || []).filter((reservation) => !deletedPersonIds.has(String(reservation.host_user_id)));
  nextState.reservation_requests = (nextState.reservation_requests || []).filter((request) => !deletedPersonIds.has(String(request.host_user_id)));
  nextState.drink_plans = (nextState.drink_plans || []).filter((plan) => !deletedPersonIds.has(String(plan.host_user_id)));
  nextState.instance_assignments = (nextState.instance_assignments || []).filter((assignment) => {
    const deletedIds = assignment.person_type === "host" ? hostIds : assignment.person_type === "staff" ? staffIds : null;
    return !deletedIds || !deletedIds.has(String(assignment.person_id));
  });
  return nextState;
}

function removeManagedPersonRecord(state, personType, personId) {
  const id = String(personId);
  if (personType === "host") {
    state.users = (state.users || []).filter((user) => String(user.id) !== id);
  } else if (personType === "staff") {
    state.staff_members = (state.staff_members || []).filter((staffMember) => String(staffMember.id) !== id);
  }
}

function renderManagedPersonStatus(person) {
  return person.is_active !== false
    ? `<span class="inline-pill active">有効</span>`
    : `<span class="inline-pill muted">無効</span>`;
}

function deleteManagedPerson(sourceState, personType, personId, now = new Date()) {
  const config = MANAGED_PERSON_TYPES[personType];
  if (!config) return { state: sourceState, ok: false, errors: ["削除対象の種別が不正です。"] };
  const person = (sourceState[config.collection] || []).find((item) => String(item.id) === String(personId));
  if (!person) return { state: sourceState, ok: false, errors: [config.missingMessage] };
  if (person.is_active !== false) {
    return { state: sourceState, ok: false, errors: [`${config.label}を削除する前に無効化してください。`] };
  }

  const references = getManagedPersonReferences(sourceState, personType, person.id);
  if (references.length) {
    const details = references.map((reference) => `${reference.label} ${reference.count}件`).join("、");
    return {
      state: sourceState,
      ok: false,
      errors: [`${person.display_name} は ${details} から参照されているため削除できません。無効のまま残してください。`],
      person,
      references,
    };
  }

  const draft = clone(sourceState);
  const stamp = new Date(now).toISOString();
  const historyPerson = removeHostPhotoData(clone(person));
  const hardDeletes = [{
    collection: config.collection,
    id: person.id,
    personType,
    historyTargetType: config.historyTargetType,
    deletedAt: stamp,
    expectedVersion: typeof getManagedPersonVersion === "function"
      ? getManagedPersonVersion(person)
      : (person.updated_at || JSON.stringify(person)),
    personSnapshot: historyPerson,
  }];
  applyHardDeleteOperations(draft, hardDeletes);
  draft.histories ||= [];
  draft.histories.unshift({
    id: createId("hist"),
    target_type: config.historyTargetType,
    target_id: person.id,
    before_payload: historyPerson,
    after_payload: { deleted: true },
    changed_at: stamp,
    change_note: `${config.label}を完全削除`,
  });
  draft.histories = draft.histories.slice(0, 300);
  draft.meta = {
    ...(draft.meta || {}),
    updated_at: stamp,
    [PERSON_TOMBSTONES_META_KEY]: normalizePersonTombstones([
      ...(draft.meta?.[PERSON_TOMBSTONES_META_KEY] || []),
      { person_type: personType, person_id: person.id, deleted_at: stamp },
    ]),
  };
  applyPersonTombstones(draft);
  return { state: draft, ok: true, person, references: [], hardDeletes, errors: [] };
}

function renderHostManagement() {
  const editing = view.editingUserId ? findUser(state, view.editingUserId) : null;
  const users = sortedUsers(state.users);
  const activeUsers = users.filter((user) => user.is_active !== false);
  const inactiveUsers = users.filter((user) => user.is_active === false);
  const roles = getRoles(state);
  const roleOptions = [...roles];
  if (editing?.role && !roleOptions.some((role) => role.name === editing.role)) {
    const inactiveRole = getRoles(state, true).find((role) => role.name === editing.role);
    roleOptions.push(inactiveRole || { name: editing.role, is_active: false });
  }
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Hosts</p><h2>ホスト一覧管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-user" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-user">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>ホスト名</span><input name="display_name" value="${escapeAttr(editing?.display_name || "")}" required></label>
        <label><span>読み仮名</span><input name="kana" value="${escapeAttr(editing?.kana || "")}"></label>
        <label><span>ロール</span><select name="role">${roleOptions.map((role) => option(role.name, role.is_active === false ? `${role.name}（無効）` : role.name, role.name === (editing?.role || "ホスト"))).join("")}</select></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="mini-panel role-manager">
        <h3>タグ管理</h3>
        <form class="role-form" data-action="save-role">
          <label><span>追加するタグ名</span><input name="name" placeholder="例: 幹部候補"></label>
          <button class="primary-button" type="submit">タグを追加</button>
        </form>
        <div class="role-chip-list">
          ${getRoles(state).map((role) => `
            <span class="role-chip">
              ${escapeHtml(role.name)}
              ${ROLES.includes(role.name)
                ? `<span class="role-chip-note">標準</span>`
                : `<button data-action="delete-role" data-role-name="${escapeAttr(role.name)}" type="button">削除</button>`}
            </span>
          `).join("")}
        </div>
      </div>
      ${renderHostManagementTable(activeUsers, "有効なホストがいません。", "有効なホスト一覧")}
      <details class="mini-panel collapsed-hosts" data-inactive-person-type="host" ${view.expandedInactivePersonType === "host" ? "open" : ""}>
        <summary><span class="collapsed-hosts-summary-content">無効化済みホスト <strong>${inactiveUsers.length}</strong>人</span></summary>
        ${renderHostManagementTable(inactiveUsers, "無効化済みホストはいません。", "無効化済みホスト一覧")}
      </details>
    </section>
  `;
}

function renderHostManagementTable(users, emptyText, caption = "ホスト一覧") {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <caption class="visually-hidden">${escapeHtml(caption)}</caption>
        <thead><tr><th scope="col">宣材</th><th scope="col">ホスト名</th><th scope="col">読み</th><th scope="col">ロール</th><th scope="col">状態</th><th scope="col">メモ</th><th scope="col">操作</th></tr></thead>
        <tbody>
          ${users.length ? users.map((user) => `
            <tr class="managed-person-row" data-managed-person-id="${escapeHtml(user.id)}" tabindex="-1">
              <td>${renderHostPhotoUploader(user)}</td>
              <${"th"} scope="row">${escapeHtml(user.display_name)}</${"th"}>
              <td>${escapeHtml(user.kana || "")}</td>
              <td>${escapeHtml(user.role)}</td>
              <td>${renderManagedPersonStatus(user)}</td>
              <td>${escapeHtml(user.note || "")}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-button" data-action="edit-user" data-user-id="${escapeHtml(user.id)}" type="button" aria-label="${escapeHtml(`${user.display_name}を編集`)}">編集</button>
                  ${user.is_active !== false
                    ? `<button class="icon-button danger" data-action="disable-user" data-user-id="${escapeHtml(user.id)}" type="button" aria-label="${escapeHtml(`${user.display_name}を無効化`)}">無効化</button>`
                    : `
                      <button class="icon-button save" data-action="enable-user" data-user-id="${escapeHtml(user.id)}" type="button" aria-label="${escapeHtml(`${user.display_name}を有効化`)}">有効化</button>
                      <button class="icon-button danger" data-action="delete-user" data-user-id="${escapeHtml(user.id)}" type="button" aria-label="${escapeHtml(`${user.display_name}を完全削除`)}">削除</button>
                    `}
                </div>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="7">${escapeHtml(emptyText)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderInstancePlanner() {
  const model = getInstancePlannerModel(view.eventId);
  const announcement = buildInstanceDiscordText(model);
  return `
    <section class="panel page-panel instance-planner-page">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">Instance Assignment</p>
          <h2>${model.event ? formatDateLabel(model.event.event_date) : "対象日未設定"} インス振り分け</h2>
        </div>
        <div class="toolbar compact">
          <button class="ghost-button" data-action="generate-instance-image" type="button"${model.event ? "" : " disabled"}>画像を生成</button>
          <button class="ghost-button" data-action="download-instance-image" data-instance-key="a" type="button"${model.event ? "" : " disabled"}>第1PNG保存</button>
          <button class="ghost-button" data-action="download-instance-image" data-instance-key="b" type="button"${model.event ? "" : " disabled"}>第2PNG保存</button>
          <button class="primary-button" data-action="download-instance-images" type="button"${model.event ? "" : " disabled"}>2枚ZIP保存</button>
        </div>
      </div>
      ${!model.event ? `<p class="empty">対象日を選択してください。</p>` : `
        <div class="instance-overview-grid">
          ${renderInstanceStatCard("未配置ホスト", model.hostGroups.unassigned.length)}
          ${renderInstanceStatCard("自由行動", model.hostGroups.free.length)}
          ${renderInstanceStatCard("第1インスタンス", model.hostGroups.a.length)}
          ${renderInstanceStatCard("第2インスタンス", model.hostGroups.b.length)}
        </div>
        <div class="instance-board">
          ${renderInstanceColumn("unassigned", "未配置ホスト", model.hostGroups.unassigned, model)}
          ${renderInstanceColumn("free", "自由行動", model.hostGroups.free, model)}
          ${renderInstanceColumn("a", "第1インスタンス", model.hostGroups.a, model)}
          ${renderInstanceColumn("b", "第2インスタンス", model.hostGroups.b, model)}
        </div>
        <div class="instance-board staff-board">
          ${renderStaffInstanceColumn("unassigned", "内勤（未振り分け）", model.staffGroups.unassigned)}
          ${renderStaffInstanceColumn("a", "第1インスタンス 内勤", model.staffGroups.a)}
          ${renderStaffInstanceColumn("b", "第2インスタンス 内勤", model.staffGroups.b)}
        </div>
        ${model.ineligibleHosts.length ? `
          <section class="mini-panel">
            <div class="section-title"><h3>欠席・休暇・未入力</h3><span class="capacity muted">${model.ineligibleHosts.length}名</span></div>
            <p class="empty">予約なしでも、勤怠が出勤または体入なら上の未配置ホストに表示されます。</p>
            <ul class="name-list">${model.ineligibleHosts.map((row) => `<li>${escapeHtml(row.user.display_name)}<span>${escapeHtml(row.status)}</span></li>`).join("")}</ul>
          </section>
        ` : ""}
        <div class="split instance-output-grid">
          <section class="mini-panel">
            <div class="section-title">
              <h3>Discordアナウンス文</h3>
              <button class="icon-button" data-action="copy-text" data-source="instance-discord" type="button">コピー</button>
            </div>
            <textarea class="copy-text instance-discord-text" data-copy-source="instance-discord" readonly>${escapeHtml(announcement)}</textarea>
          </section>
          <section class="mini-panel">
            <div class="section-title">
              <h3>画像プレビュー</h3>
              <span class="capacity ok">各 1600 x 900</span>
            </div>
            <div class="instance-preview-grid">
              <div class="instance-canvas-block">
                <div class="instance-canvas-title"><strong>第1インスタンス</strong><span>${model.hostGroups.a.length}名</span></div>
                <div class="instance-canvas-frame">
                  <canvas id="instance-image-canvas-a" class="instance-image-canvas" width="1600" height="900" aria-label="第1インスタンス振り分け画像"></canvas>
                </div>
              </div>
              <div class="instance-canvas-block">
                <div class="instance-canvas-title"><strong>第2インスタンス</strong><span>${model.hostGroups.b.length}名</span></div>
                <div class="instance-canvas-frame">
                  <canvas id="instance-image-canvas-b" class="instance-image-canvas" width="1600" height="900" aria-label="第2インスタンス振り分け画像"></canvas>
                </div>
              </div>
            </div>
          </section>
        </div>
      `}
    </section>
  `;
}

function renderInstanceStatCard(label, count) {
  return `<div class="summary-card"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`;
}

function renderInstanceColumn(instanceKey, title, hosts, model) {
  const summary = ["a", "b"].includes(instanceKey) ? renderInstanceReservationSummary(instanceKey, model) : "";
  return `
    <section class="instance-column ${instanceKey}">
      <div class="section-title">
        <h3>${escapeHtml(title)}</h3>
        <span class="capacity ${hosts.length ? "ok" : "muted"}">${hosts.length}名</span>
      </div>
      ${summary}
      <div class="instance-card-list">
        ${hosts.length ? hosts.map((row) => renderInstanceHostCard(row)).join("") : `<p class="empty">まだいません。</p>`}
      </div>
    </section>
  `;
}

function renderStaffInstanceColumn(instanceKey, title, staffRows) {
  return `
    <section class="instance-column staff ${instanceKey}">
      <div class="section-title">
        <h3>${escapeHtml(title)}</h3>
        <span class="capacity ${staffRows.length ? "ok" : "muted"}">${staffRows.length}名</span>
      </div>
      <div class="instance-card-list">
        ${staffRows.length ? staffRows.map((row) => renderInstanceStaffCard(row)).join("") : `<p class="empty">まだいません。</p>`}
      </div>
    </section>
  `;
}

function renderInstanceHostCard(row) {
  const reservationText = row.reservations.length
    ? `<ul class="instance-reservation-list">${row.reservations.slice(0, 4).map((item) => `<li>${escapeHtml(formatInstanceReservationItem(item))}</li>`).join("")}</ul>`
    : `<p class="empty">予約紐づけなし</p>`;
  return `
    <article class="instance-person-card">
      <div class="instance-person-main">
        ${renderHostPhoto(row.user, "md")}
        <div>
          <strong>${escapeHtml(row.user.display_name)}</strong>
          <span>${escapeHtml(row.status)} / ${escapeHtml(row.user.role || "ホスト")}</span>
        </div>
      </div>
      ${reservationText}
      <div class="instance-actions">
        ${renderInstanceAssignButton(row, "unassigned", "未配置")}
        ${renderInstanceAssignButton(row, "free", "自由")}
        ${renderInstanceAssignButton(row, "a", "A")}
        ${renderInstanceAssignButton(row, "b", "B")}
      </div>
    </article>
  `;
}

function renderInstanceStaffCard(row) {
  return `
    <article class="instance-person-card compact">
      <div class="instance-person-main">
        <span class="staff-avatar">内</span>
        <div>
          <strong>${escapeHtml(row.member.display_name)}</strong>
          <span>${escapeHtml(row.member.staff_type || "内勤")}</span>
        </div>
      </div>
      <div class="instance-actions">
        ${renderStaffInstanceAssignButton(row, "unassigned", "未配置")}
        ${renderStaffInstanceAssignButton(row, "a", "A")}
        ${renderStaffInstanceAssignButton(row, "b", "B")}
      </div>
    </article>
  `;
}

function renderInstanceAssignButton(row, instanceKey, label) {
  return `
    <button class="icon-button ${row.instanceKey === instanceKey ? "save" : ""}" data-action="instance-assign" data-person-type="host" data-person-id="${escapeAttr(row.user.id)}" data-instance-key="${escapeAttr(instanceKey)}" type="button">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderStaffInstanceAssignButton(row, instanceKey, label) {
  return `
    <button class="icon-button ${row.instanceKey === instanceKey ? "save" : ""}" data-action="instance-assign" data-person-type="staff" data-person-id="${escapeAttr(row.member.id)}" data-instance-key="${escapeAttr(instanceKey)}" type="button">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderInstanceReservationSummary(instanceKey, model) {
  const summary = getInstanceReservationSummary(instanceKey, model);
  return `
    <div class="instance-summary">
      ${TIME_SLOTS.map((slot) => {
        const item = summary[slot];
        return `<span>${escapeHtml(slot)} ${item.total}件 <em>通常${item.normal} / アイバン${item.ivan}</em></span>`;
      }).join("")}
    </div>
  `;
}

function getInstancePlannerModel(eventId) {
  const event = findEvent(state, eventId);
  const hostRows = [];
  const ineligibleHosts = [];
  const staffRows = [];
  const hostGroups = { unassigned: [], free: [], a: [], b: [] };
  const staffGroups = { unassigned: [], a: [], b: [] };
  if (!event) {
    return { event, hostRows, ineligibleHosts, staffRows, hostGroups, staffGroups, setting: getReservationSetting(state, eventId) };
  }

  for (const user of getActiveUsers(state)) {
    const vacation = isOnVacation(state, user.id, event.event_date);
    const entry = getAttendanceEntry(state, eventId, user.id);
    const status = vacation ? "長期休暇" : entry?.status || "未入力";
    const isEligible = status === "出勤" || status === "体入";
    const assignment = getInstanceAssignment(state, eventId, "host", user.id);
    const instanceKey = isEligible ? (assignment?.instance_key || "unassigned") : "unassigned";
    const row = {
      user,
      entry,
      status,
      isTrial: status === "体入" || user.role === "体入",
      instanceKey,
      reservations: getHostInstanceReservations(eventId, user.id),
    };
    if (isEligible) {
      hostRows.push(row);
      hostGroups[hostGroups[instanceKey] ? instanceKey : "unassigned"].push(row);
    } else {
      ineligibleHosts.push(row);
    }
  }

  for (const member of getActiveStaffMembers(state)) {
    const entry = getStaffAttendanceEntry(state, eventId, member.id);
    if (entry?.status !== "出勤") continue;
    const assignment = getInstanceAssignment(state, eventId, "staff", member.id);
    const instanceKey = assignment?.instance_key || "unassigned";
    const row = { member, entry, instanceKey };
    staffRows.push(row);
    staffGroups[staffGroups[instanceKey] ? instanceKey : "unassigned"].push(row);
  }

  return {
    event,
    hostRows,
    ineligibleHosts,
    staffRows,
    hostGroups,
    staffGroups,
    setting: getReservationSetting(state, eventId),
  };
}

function getHostInstanceReservations(eventId, userId) {
  const actualReservations = getReservationsForEvent(state, eventId)
    .filter((reservation) => isReservationFilled(reservation) && reservation.host_user_id === userId)
    .map((reservation) => ({
      source: "actual",
      time_slot: reservation.time_slot,
      seat_type: reservation.seat_type,
      guest_name: reservation.princess_name || "",
      ivan_name: reservation.ivan_name || "",
      memo: reservation.memo || "",
      is_ivan: Boolean(reservation.ivan_name || reservation.seat_type === SEAT_TYPES[1]),
    }));
  const acceptedRequests = getAcceptedReservationRequestsForEvent(state, eventId)
    .filter((request) => request.host_user_id === userId)
    .map((request) => ({
      source: "request",
      time_slot: request.desired_time_slot,
      seat_type: isReservationRequestIvan(request) ? SEAT_TYPES[1] : SEAT_TYPES[0],
      guest_name: request.princess_name || "",
      ivan_name: request.ivan_name || "",
      memo: request.memo || "",
      is_ivan: isReservationRequestIvan(request),
    }));
  return [...actualReservations, ...acceptedRequests].sort((a, b) => {
    const slot = TIME_SLOTS.indexOf(a.time_slot) - TIME_SLOTS.indexOf(b.time_slot);
    if (slot) return slot;
    return String(a.source).localeCompare(String(b.source));
  });
}

function formatInstanceReservationItem(item) {
  const kind = item.source === "request" ? "受付" : "実予約";
  const guest = item.guest_name || "姫名未入力";
  const ivan = item.ivan_name ? ` / join ${item.ivan_name}` : "";
  return `${item.time_slot}${kind}: ${guest}${ivan}`;
}

function getInstanceReservationSummary(instanceKey, model) {
  const result = Object.fromEntries(TIME_SLOTS.map((slot) => [slot, { normal: 0, ivan: 0, total: 0 }]));
  for (const row of model.hostGroups[instanceKey] || []) {
    for (const item of row.reservations) {
      const slot = TIME_SLOTS.includes(item.time_slot) ? item.time_slot : TIME_SLOTS[0];
      if (item.is_ivan) result[slot].ivan += 1;
      else result[slot].normal += 1;
      result[slot].total += 1;
    }
  }
  return result;
}

function buildInstanceDiscordText(model) {
  if (!model.event) return "";
  const freeHosts = model.hostGroups.free.map((row) => row.user.display_name);
  const trialHosts = model.hostRows.filter((row) => row.isTrial).map((row) => row.user.display_name);
  const unassignedStaff = model.staffGroups.unassigned.map((row) => row.member.display_name);
  const lines = [
    `@everyone 【${formatDateLabel(model.event.event_date)}本日の振り分け案内】`,
    "急だけど出勤したい、の連絡は私宛メンションでここに返信！",
    "※今日も姫ポイント2倍デー！",
    "※コールの関係で急遽入れ替える可能性があります。",
    "",
    `◆自由行動：${formatNameList(freeHosts)}`,
    `◆内勤（未振り分け）：${formatNameList(unassignedStaff)}`,
    `◆体入：${formatNameList(trialHosts)}`,
    "",
  ];

  lines.push(...buildInstanceDiscordBlock("第1インスタンス", model.hostGroups.a, model.staffGroups.a, model, "a"));
  lines.push("");
  lines.push(...buildInstanceDiscordBlock("第2インスタンス", model.hostGroups.b, model.staffGroups.b, model, "b"));
  return lines.join("\n").trim();
}

function buildInstanceDiscordBlock(title, hostRows, staffRows, model, instanceKey) {
  const summary = getInstanceReservationSummary(instanceKey, model);
  const staffNames = staffRows.map((row) => row.member.display_name);
  const lines = [
    `◆${title}　内勤：${formatNameList(staffNames)}`,
    ...TIME_SLOTS.map((slot) => {
      const item = summary[slot];
      const normalCap = slot === TIME_SLOTS[0] ? model.setting.normal_capacity_front : model.setting.normal_capacity_back;
      return `${slot}：通常${item.normal}名 / join枠${item.ivan}名 / 合計${item.total}名（通常枠${normalCap} / join枠${model.setting.ivan_capacity}）`;
    }),
  ];
  for (const row of hostRows) {
    lines.push(`・${row.user.display_name}${formatHostReservationSummaryForDiscord(row.reservations)}`);
  }
  if (!hostRows.length) lines.push("・未配置");
  return lines;
}

function formatHostReservationSummaryForDiscord(reservations) {
  if (!reservations.length) return "";
  const bySlot = TIME_SLOTS.map((slot) => {
    const items = reservations.filter((item) => item.time_slot === slot);
    if (!items.length) return "";
    return `${slot}予約：${items.map((item) => item.guest_name || item.ivan_name || "姫名未入力").join("、")}`;
  }).filter(Boolean);
  return bySlot.length ? `（${bySlot.join(" / ")}）` : "";
}

function formatNameList(names) {
  return names.length ? names.join("、") : "なし";
}

function renderHostPhotoUploader(user) {
  return `
    <label class="host-photo-uploader" title="宣材写真を登録">
      <span class="host-photo-thumb">${renderHostPhoto(user, "sm")}</span>
      <input data-role="host-photo-input" data-user-id="${escapeAttr(user.id)}" type="file" accept="image/*">
      <small>${user.photo_data_url ? "変更" : "登録"}</small>
    </label>
  `;
}

function renderHostPhoto(user, size = "md") {
  if (user?.photo_data_url) {
    return `<img class="host-photo ${size}" src="${escapeAttr(user.photo_data_url)}" alt="${escapeAttr(`${user.display_name} 宣材写真`)}">`;
  }
  const initial = String(user?.display_name || "?").trim().slice(0, 1) || "?";
  return `<span class="host-photo placeholder ${size}">${escapeHtml(initial)}</span>`;
}

function renderStaffManagement() {
  const editing = view.editingStaffMemberId
    ? state.staff_members.find((member) => member.id === view.editingStaffMemberId)
    : null;
  const staffMembers = sortedStaffMembers(state.staff_members || []);
  const activeStaffMembers = staffMembers.filter((member) => member.is_active !== false);
  const inactiveStaffMembers = staffMembers.filter((member) => member.is_active === false);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Staff</p><h2>内勤一覧管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-staff-member" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-staff-member">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>内勤名</span><input name="display_name" value="${escapeAttr(editing?.display_name || "")}" required></label>
        <label><span>読み仮名</span><input name="kana" value="${escapeAttr(editing?.kana || "")}"></label>
        <label><span>区分</span><input name="staff_type" value="${escapeAttr(editing?.staff_type || "内勤")}" placeholder="例: 内勤 / 受付 / 会計"></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="notice muted">ホスト一覧とは別管理です。ここに登録した人だけが「内勤出勤」の対象になります。</div>
      ${renderStaffManagementTable(activeStaffMembers, "有効な内勤スタッフがいません。", "有効な内勤一覧")}
      <details class="mini-panel collapsed-hosts" data-inactive-person-type="staff" ${view.expandedInactivePersonType === "staff" ? "open" : ""}>
        <summary><span class="collapsed-hosts-summary-content">無効化済み内勤 <strong>${inactiveStaffMembers.length}</strong>人</span></summary>
        ${renderStaffManagementTable(inactiveStaffMembers, "無効化済み内勤はいません。", "無効化済み内勤一覧")}
      </details>
    </section>
  `;
}

function renderStaffManagementTable(staffMembers, emptyText, caption = "内勤一覧") {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <caption class="visually-hidden">${escapeHtml(caption)}</caption>
        <thead><tr><th scope="col">内勤名</th><th scope="col">読み</th><th scope="col">区分</th><th scope="col">状態</th><th scope="col">メモ</th><th scope="col">操作</th></tr></thead>
        <tbody>
          ${staffMembers.length ? staffMembers.map((member) => `
            <tr class="managed-person-row" data-managed-person-id="${escapeHtml(member.id)}" tabindex="-1">
              <${"th"} scope="row">${escapeHtml(member.display_name)}</${"th"}>
              <td>${escapeHtml(member.kana || "")}</td>
              <td>${escapeHtml(member.staff_type || "内勤")}</td>
              <td>${renderManagedPersonStatus(member)}</td>
              <td>${escapeHtml(member.note || "")}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-button" data-action="edit-staff-member" data-staff-member-id="${escapeHtml(member.id)}" type="button" aria-label="${escapeHtml(`${member.display_name}を編集`)}">編集</button>
                  ${member.is_active !== false
                    ? `<button class="icon-button danger" data-action="disable-staff-member" data-staff-member-id="${escapeHtml(member.id)}" type="button" aria-label="${escapeHtml(`${member.display_name}を無効化`)}">無効化</button>`
                    : `
                      <button class="icon-button save" data-action="enable-staff-member" data-staff-member-id="${escapeHtml(member.id)}" type="button" aria-label="${escapeHtml(`${member.display_name}を有効化`)}">有効化</button>
                      <button class="icon-button danger" data-action="delete-staff-member" data-staff-member-id="${escapeHtml(member.id)}" type="button" aria-label="${escapeHtml(`${member.display_name}を完全削除`)}">削除</button>
                    `}
                </div>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="6">${escapeHtml(emptyText)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderVacationManagement() {
  const editing = view.editingVacationId
    ? state.long_vacations.find((vacation) => vacation.id === view.editingVacationId)
    : null;
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Vacation</p><h2>長期休暇管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-vacation" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-vacation">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>対象ホスト</span><select name="user_id">${getActiveUsers(state).map((user) => option(user.id, user.display_name, user.id === editing?.user_id)).join("")}</select></label>
        <label><span>休暇開始日</span><input name="start_date" type="date" value="${editing?.start_date || ""}" required></label>
        <label><span>休暇終了日</span><input name="end_date" type="date" value="${editing?.end_date || ""}" required></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>理由・メモ</span><input name="reason" value="${escapeAttr(editing?.reason || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト</th><th>期間</th><th>状態</th><th>理由</th><th>操作</th></tr></thead>
          <tbody>
            ${state.long_vacations.map((vacation) => `
              <tr>
                <td>${escapeHtml(findUser(state, vacation.user_id)?.display_name || "不明")}</td>
                <td>${escapeHtml(vacation.start_date)} - ${escapeHtml(vacation.end_date)}</td>
                <td>${vacation.is_active ? "有効" : "無効"}</td>
                <td>${escapeHtml(vacation.reason || "")}</td>
                <td><button class="icon-button" data-action="edit-vacation" data-vacation-id="${vacation.id}" type="button">編集</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">長期休暇は未登録です。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEventManagement() {
  const editing = view.editingEventId ? findEvent(state, view.editingEventId) : null;
  const activeEvents = state.event_dates.filter((event) => !isEventArchived(event));
  const archivedCount = getArchivedEvents(state).length;
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7);
  const newDate = toLocalDateTimeString(defaultDate).slice(0, 10);
  const eventDate = editing?.event_date || newDate;
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Events</p><h2>イベント日管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-event" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-event">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>イベント日</span><input name="event_date" type="date" value="${eventDate}" data-role="event-date-input" required></label>
        <label><span>ステータス</span><select name="status">${EVENT_STATUSES.map((status) => option(status, status, status === (editing?.status || "受付中"))).join("")}</select></label>
        <label><span>予約解放日時</span><input name="reservation_open_at" type="datetime-local" value="${editing?.reservation_open_at || getReservationOpenAt(eventDate)}" data-role="reservation-open-input"></label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="notice muted">終了した日付は自動でアーカイブに移動します。過去の予約は「アーカイブ」タブから確認できます。現在のアーカイブ: ${archivedCount}件</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>日付</th><th>ステータス</th><th>予約解放</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>
            ${activeEvents.map((event) => `
              <tr class="${event.status === "休み" ? "holiday-row" : ""}">
                <td>${formatDateLabel(event.event_date)}</td>
                <td>${statusPill(event.status)}</td>
                <td>${formatDateTime(event.reservation_open_at)}</td>
                <td>${escapeHtml(event.note || "")}</td>
                <td><button class="icon-button" data-action="edit-event" data-event-id="${event.id}" type="button">編集</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">受付中または休み予定のイベント日はありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderArchive() {
  const archivedEvents = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  if (!archivedEvents.length) {
    return `
      <section class="panel page-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">Archive</p><h2>アーカイブ</h2></div>
        </div>
        <p class="empty">終了済みのイベント日はまだありません。イベント日が終わると自動でここに移動します。</p>
      </section>
    `;
  }
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Archive</p>
          <h2>アーカイブ</h2>
        </div>
      </div>
      <div class="notice muted">終了したイベント日の予約を日付ごとに折りたたんで確認できます。ここでは編集せず、当日の最終予約と集計だけを見返します。</div>
      <div class="archive-list">
        ${archivedEvents.map((event) => renderArchiveItem(event)).join("")}
      </div>
    </section>
  `;
}

function renderArchiveItem(event) {
  const isOpen = view.archiveEventId === event.id;
  const reservations = getReservationsForEvent(state, event.id);
  const deletedReservations = getReservationsForEvent(state, event.id, true).filter((reservation) => reservation.is_deleted);
  const reservationRequests = getReservationRequestsForEvent(state, event.id);
  const deletedReservationRequests = getReservationRequestsForEvent(state, event.id, { includeDeleted: true }).filter((request) => request.is_deleted);
  const totalReservations = reservations.length + reservationRequests.length;
  const totalDeleted = deletedReservations.length + deletedReservationRequests.length;
  return `
    <section class="archive-item ${isOpen ? "is-open" : ""}">
      <button class="archive-toggle" data-action="toggle-archive" data-event-id="${event.id}" type="button" aria-expanded="${isOpen}">
        <span>${formatDateLabel(event.event_date)}</span>
        <strong>予約 ${totalReservations}件</strong>
        <em>${totalDeleted ? `削除履歴 ${totalDeleted}件` : "削除履歴なし"}</em>
        ${statusPill(event.status)}
      </button>
      ${isOpen ? `
        <div class="archive-body">
          <div class="split">
            <div class="mini-panel">
              <h3>予約枠</h3>
              ${renderSeatStatusList(event.id)}
            </div>
            <div class="mini-panel">
              <h3>シャンパン・タワー</h3>
              ${renderDrinkStatusList(event.id)}
            </div>
          </div>
          ${renderArchiveAttendance(event.id)}
          ${renderDrinkPlans(event.id, { locked: true })}
          ${renderArchiveReservationRequests(event.id)}
          ${reservations.length ? `
            <div class="subsection">
              <h3>旧予約グリッド履歴</h3>
              ${renderReservationGrid(event.id, { adminMode: true, locked: true })}
            </div>
          ` : ""}
          ${renderDeletedReservations(deletedReservations)}
          ${renderDeletedReservationRequests(deletedReservationRequests)}
          <footer class="archive-footer">
            <p>このイベント日と、紐づく勤怠・予約・集計データを完全に削除します。</p>
            <button class="danger-button archive-delete-button" data-action="delete-archived-event" data-event-id="${escapeAttr(event.id)}" type="button">完全に削除</button>
          </footer>
        </div>
      ` : ""}
    </section>
  `;
}

function renderArchiveAttendance(eventId) {
  const hostItems = getAttendanceEntriesForEvent(state, eventId)
    .filter((entry) => entry.status === "出勤" || entry.status === "体入")
    .map((entry) => {
      const user = findUser(state, entry.user_id);
      return {
        name: user?.display_name || entry.user_id || "不明",
        sortKey: user?.kana || user?.display_name || entry.user_id || "",
        status: entry.status,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));
  const staffItems = getStaffAttendanceEntriesForEvent(state, eventId)
    .filter((entry) => entry.status === "出勤")
    .map((entry) => {
      const member = findStaffMember(state, entry.staff_member_id);
      return {
        name: member?.display_name || entry.staff_member_id || "不明",
        sortKey: member?.kana || member?.display_name || entry.staff_member_id || "",
        status: entry.status,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));

  return `
    <div class="split">
      <div class="mini-panel">
        <h3>ホスト出勤記録</h3>
        ${renderArchiveAttendanceList(hostItems, "出勤・体入のホストはいません。")}
      </div>
      <div class="mini-panel">
        <h3>内勤出勤記録</h3>
        ${renderArchiveAttendanceList(staffItems, "出勤の内勤はいません。")}
      </div>
    </div>
  `;
}

function renderArchiveAttendanceList(items, emptyText) {
  if (!items.length) return `<p class="empty">${emptyText}</p>`;
  return `<ul class="name-list">${items
    .map((item) => `<li>${escapeHtml(item.name)}<span>${escapeHtml(item.status)}</span></li>`)
    .join("")}</ul>`;
}

function renderArchiveReservationRequests(eventId) {
  const requests = getReservationRequestsForEvent(state, eventId);
  const deletedRequests = getReservationRequestsForEvent(state, eventId, { includeDeleted: true }).filter((request) => request.is_deleted);
  if (!requests.length && !deletedRequests.length) {
    return `
      <div class="subsection">
        <h3>予約アーカイブ</h3>
        <p class="empty">予約受付履歴はありません。</p>
      </div>
    `;
  }
  const buckets = getReservationRequestBuckets(state, eventId);
  return `
    <div class="subsection">
      <h3>予約アーカイブ</h3>
      ${requests.length ? `
        ${renderReservationRequestBucketsV2(buckets, false)}
        ${renderArchiveReservationRequestList(requests)}
      ` : `<p class="empty">予約受付履歴はありません。</p>`}
    </div>
  `;
}

function renderArchiveReservationRequestList(requests) {
  return `
    <div class="table-wrap request-table-wrap">
      <table class="data-table">
        <thead><tr><th>受付</th><th>担当</th><th>希望</th><th>姫 / アイバン</th><th>内容</th><th>扱い</th></tr></thead>
        <tbody>
          ${requests.map((request, index) => `
            <tr>
              <td>#${String(index + 1).padStart(3, "0")}<br>${formatHistoryDateTime(request.created_at)}</td>
              <td>${escapeHtml(getReservationPersonName(request.host_user_id))}</td>
              <td>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)}</td>
              <td>${escapeHtml(formatReservationGuestMeta(request))}</td>
              <td>${escapeHtml([formatRequestDrinks(request), request.memo].filter(Boolean).join(" / "))}</td>
              <td>${escapeHtml(formatPlacementStatus(request.placement_status))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDeletedReservations(deletedReservations) {
  if (!deletedReservations.length) return "";
  return `
    <div class="subsection">
      <h3>削除済み予約</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>削除日時</th><th>枠</th><th>担当</th><th>姫 / アイバン</th><th>メモ</th></tr></thead>
          <tbody>
            ${deletedReservations.map((reservation) => `
              <tr>
                <td>${formatDateTime(reservation.deleted_at)}</td>
                <td>${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}</td>
                <td>${escapeHtml(getReservationPersonName(reservation.host_user_id))}</td>
                <td>${escapeHtml(formatReservationGuestMeta(reservation))}</td>
                <td>${escapeHtml(reservation.memo || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDeletedReservationRequests(deletedRequests) {
  if (!deletedRequests.length) return "";
  return `
    <div class="subsection">
      <h3>削除済み予約受付</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>削除日時</th><th>受付</th><th>担当</th><th>姫 / アイバン</th><th>内容</th><th>扱い</th></tr></thead>
          <tbody>
            ${deletedRequests.map((request, index) => `
              <tr>
                <td>${formatDateTime(request.deleted_at)}</td>
                <td>#${String(index + 1).padStart(3, "0")} / ${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)}</td>
                <td>${escapeHtml(getReservationPersonName(request.host_user_id))}</td>
                <td>${escapeHtml(formatReservationGuestMeta(request))}</td>
                <td>${escapeHtml([formatRequestDrinks(request), request.memo].filter(Boolean).join(" / "))}</td>
                <td>${escapeHtml(formatPlacementStatus(request.placement_status))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTotals() {
  const event = findEvent(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Limits</p><h2>${event ? formatDateLabel(event.event_date) : ""} シャンパン・タワー状況</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>シャンパン・タワー</h3>
          ${renderDrinkStatusList(view.eventId)}
        </div>
        <div class="mini-panel">
          <h3>予約枠</h3>
          ${renderSeatStatusList(view.eventId)}
        </div>
      </div>
    </section>
  `;
}

function renderDiscordTools() {
  const attendanceText = generateAttendanceDiscordText(state, view.eventId);
  const reservationText = generateReservationDiscordText(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Discord</p><h2>Discord文面生成</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>未入力者催促文</h3>
          <textarea class="copy-text" data-copy-source="attendance" rows="10" readonly>${escapeHtml(attendanceText)}</textarea>
          <button class="primary-button" data-action="copy-text" data-source="attendance" type="button">コピー</button>
        </div>
        <div class="mini-panel">
          <h3>予約確認文</h3>
          <textarea class="copy-text" data-copy-source="reservation" rows="10" readonly>${escapeHtml(reservationText)}</textarea>
          <button class="primary-button" data-action="copy-text" data-source="reservation" type="button">コピー</button>
        </div>
      </div>
    </section>
  `;
}

function renderHistories() {
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">History</p><h2>変更履歴</h2></div>
      </div>
      <div class="table-wrap">
        <table class="data-table history-table">
          <thead><tr><th>日時</th><th>対象</th><th>内容</th><th>変更前</th><th>変更後</th></tr></thead>
          <tbody>
            ${state.histories.map((history) => `
              <tr>
                <td>${formatHistoryDateTime(history.changed_at)}</td>
                <td>${escapeHtml(formatHistoryTarget(history))}</td>
                <td>${escapeHtml(history.change_note || "")}</td>
                <td><span class="history-summary">${escapeHtml(summarizeHistoryPayload(history, history.before_payload))}</span></td>
                <td><span class="history-summary">${escapeHtml(summarizeHistoryPayload(history, history.after_payload))}</span></td>
              </tr>
            `).join("") || `<tr><td colspan="5">履歴はまだありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function formatHistoryDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}.${ms}`;
}

function formatHistoryTarget(history) {
  const targetType = formatHistoryTargetType(history);
  const targetDetail = formatHistoryTargetDetail(history);
  return targetDetail ? `${targetType} / ${targetDetail}` : targetType;
}

function formatHistoryTargetType(history) {
  if (history.target_type === "reservation") return "予約";
  if (history.target_type === "reservation_request") return "予約受付";
  if (history.target_type === "reservation_setting") return "予約受付設定";
  if (history.target_type === "attendance") return "ホスト勤怠";
  if (history.target_type === "staff_attendance") return "内勤勤怠";
  if (history.target_type === "drink_plan") return "事前申請";
  if (history.target_type === "event") return "イベント日";
  if (history.target_type === "user") return "ホスト";
  if (history.target_type === "staff_member") return "内勤";
  if (history.target_type === "long_vacation") return "長期休暇";
  return history.target_type;
}

function formatHistoryTargetDetail(history) {
  const payload = history.after_payload || history.before_payload || {};
  if (history.target_type === "attendance") {
    const hostName = payload.user_id ? findUser(state, payload.user_id)?.display_name || payload.user_id : "";
    const event = payload.event_date_id ? findEvent(state, payload.event_date_id) : null;
    return [hostName, event ? formatDateLabel(event.event_date) : ""].filter(Boolean).join(" / ");
  }
  if (history.target_type === "staff_attendance") {
    const staffName = payload.staff_member_id ? findStaffMember(state, payload.staff_member_id)?.display_name || payload.staff_member_id : "";
    const event = payload.event_date_id ? findEvent(state, payload.event_date_id) : null;
    return [staffName, event ? formatDateLabel(event.event_date) : ""].filter(Boolean).join(" / ");
  }
  return "";
}

function renderDataTools() {
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Data</p><h2>データ管理</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>バックアップ</h3>
          <p>ブラウザの localStorage に保存されたデータをJSONで書き出します。</p>
          <button class="primary-button" data-action="export-json" type="button">JSONを書き出す</button>
        </div>
        <div class="mini-panel">
          <h3>初期化</h3>
          <p>このブラウザ内のデータを初期状態に戻します。必要な場合だけ実行してください。</p>
          <button class="danger-button" data-action="reset-data" type="button">初期データに戻す</button>
        </div>
      </div>
      <textarea class="copy-text" data-copy-source="export" rows="12" readonly></textarea>
    </section>
  `;
}

function renderDashboardDetail() {
  const { dashboardDetailType: type, dashboardDetailKey: key } = view;
  if (!type || !key) return "";
  if (type === "hostAttendance") return renderHostAttendanceDetail(key);
  if (type === "staffAttendance") return renderStaffAttendanceDetail(key);
  if (type === "seat") return renderSeatDetail(key);
  if (type === "drink") return renderDrinkDetail(key);
  return "";
}

function renderDashboardDetailGroup(types) {
  return types.includes(view.dashboardDetailType) ? renderDashboardDetail() : "";
}

function renderHostAttendanceDetail(status) {
  const event = findEvent(state, view.eventId);
  const title = `${event ? formatDateLabel(event.event_date) : ""} ホスト勤怠: ${status}`;
  const items = getHostAttendanceDetailItems(status);
  return renderDashboardDetailPanel(title, renderDetailList(items, "対象者はいません。"));
}

function getHostAttendanceDetailItems(status) {
  if (status === "未入力") {
    return getMissingUsers(state, view.eventId).map((user) => ({ title: user.display_name, meta: user.role || "ホスト" }));
  }
  if (status === "長期休暇") {
    return getVacationExemptUsers(state, view.eventId).map((user) => {
      const entry = getAttendanceEntry(state, view.eventId, user.id);
      return { title: user.display_name, meta: ["長期休暇中", entry ? `${entry.status}入力あり` : ""].filter(Boolean).join(" / ") };
    });
  }
  const event = findEvent(state, view.eventId);
  return getActiveUsers(state)
    .map((user) => ({ user, entry: getAttendanceEntry(state, view.eventId, user.id) }))
    .filter(({ user, entry }) => entry?.status === status && !(event && isOnVacation(state, user.id, event.event_date)))
    .map(({ user, entry }) => ({ title: user.display_name, meta: [user.role, entry.memo].filter(Boolean).join(" / ") }));
}

function renderStaffAttendanceDetail(status) {
  const event = findEvent(state, view.eventId);
  const title = `${event ? formatDateLabel(event.event_date) : ""} 内勤勤怠: ${status}`;
  const items = status === "未入力"
    ? getMissingStaffMembers(state, view.eventId).map((member) => ({ title: member.display_name, meta: member.staff_type || "内勤" }))
    : getActiveStaffMembers(state)
      .map((member) => ({ member, entry: getStaffAttendanceEntry(state, view.eventId, member.id) }))
      .filter(({ entry }) => entry?.status === status)
      .map(({ member, entry }) => ({ title: member.display_name, meta: [member.staff_type || "内勤", entry.memo].filter(Boolean).join(" / ") }));
  return renderDashboardDetailPanel(title, renderDetailList(items, "対象者はいません。"));
}

function renderSeatDetail(slotKey) {
  const [timeSlot, seatType] = slotKey.split(":");
  const reservations = getGroupLabels(seatType)
    .map((groupNo) => ({ groupNo, reservation: findReservationBySlot(state, view.eventId, timeSlot, seatType, groupNo) }))
    .filter(({ reservation }) => reservation && isReservationFilled(reservation));
  const emptyGroups = getGroupLabels(seatType)
    .filter((groupNo) => !findReservationBySlot(state, view.eventId, timeSlot, seatType, groupNo));
  const items = reservations.map(({ groupNo, reservation }) => {
    const hostName = getReservationPersonName(reservation.host_user_id);
    const drinks = formatReservationDrinkBreakdown(reservation);
    return {
      title: `${groupNo} ${hostName}`,
      meta: [formatReservationGuestMeta(reservation), drinks, reservation.memo].filter(Boolean).join(" / "),
    };
  });
  const body = `
    ${renderDetailList(items, "この枠の予約はまだありません。")}
    <p class="detail-note">空き枠: ${emptyGroups.length ? emptyGroups.join("、") : "なし"}</p>
  `;
  return renderDashboardDetailPanel(`予約枠: ${getTimeSlotLabel(timeSlot)} ${seatType}`, body);
}

function renderDrinkDetail(drinkKey) {
  const item = DRINK_LIMITS[drinkKey];
  if (!item) return "";
  const reservations = getReservationsForEvent(state, view.eventId)
    .filter((reservation) => Number(reservation[drinkKey === "tower" ? "tower_count" : `${drinkKey}_count`]) > 0)
    .map((reservation) => {
      const count = Number(reservation[drinkKey === "tower" ? "tower_count" : `${drinkKey}_count`]) || 0;
      const hostName = getReservationPersonName(reservation.host_user_id);
      return {
        title: `実予約 ${count}本`,
        meta: [`${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}`, hostName, formatReservationGuestMeta(reservation), reservation.memo].filter(Boolean).join(" / "),
      };
    });
  const requests = getAcceptedReservationRequestsForEvent(state, view.eventId)
    .filter((request) => Number(request[drinkKey === "tower" ? "tower_count" : `${drinkKey}_count`]) > 0)
    .map((request) => {
      const count = Number(request[drinkKey === "tower" ? "tower_count" : `${drinkKey}_count`]) || 0;
      const hostName = getReservationPersonName(request.host_user_id);
      const seatType = isReservationRequestIvan(request) ? "アイバン枠" : "通常席";
      return {
        title: `予約受付 ${count}本`,
        meta: [`${REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot} ${seatType}`, hostName, formatReservationGuestMeta(request), request.memo].filter(Boolean).join(" / "),
      };
    });
  const plans = getDrinkPlansForEvent(state, view.eventId)
    .filter((plan) => plan.item_type === drinkKey)
    .map((plan) => ({
      title: `事前申請 ${Number(plan.count) || 0}本`,
      meta: [getTimeSlotLabel(plan.time_slot), getReservationPersonName(plan.host_user_id), plan.memo].filter(Boolean).join(" / "),
    }));
  return renderDashboardDetailPanel(`${item.label}の内訳`, renderDetailList([...reservations, ...requests, ...plans], "登録はまだありません。"));
}

function renderDashboardDetailPanel(title, body) {
  return `
    <section class="dashboard-detail-panel">
      <div class="section-title">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-button" data-action="dashboard-detail-clear" type="button">閉じる</button>
      </div>
      ${body}
    </section>
  `;
}

function renderDetailList(items, emptyText) {
  if (!items.length) return `<p class="empty">${emptyText}</p>`;
  return `
    <ul class="detail-list">
      ${items.map((item) => `<li><strong>${escapeHtml(item.title)}</strong>${item.meta ? `<span>${escapeHtml(item.meta)}</span>` : ""}</li>`).join("")}
    </ul>
  `;
}

function renderAttendanceSummaryCards(eventId, options = {}) {
  const summary = getAttendanceSummary(state, eventId);
  return `
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => renderSummaryCard(key, value, options.detailType)).join("")}
    </div>
  `;
}

function renderStaffAttendanceSummaryCards(eventId, options = {}) {
  const summary = getStaffAttendanceSummary(state, eventId);
  return `
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => renderSummaryCard(key, value, options.detailType)).join("")}
    </div>
  `;
}

function renderSummaryCard(key, value, detailType = "") {
  if (!detailType) {
    return `<div class="summary-card status-${key}"><span>${escapeHtml(key)}</span><strong>${value}</strong></div>`;
  }
  const selected = view.dashboardDetailType === detailType && view.dashboardDetailKey === key;
  const attrs = `data-action="dashboard-detail" data-detail-type="${detailType}" data-detail-key="${escapeAttr(key)}"`;
  return `<button class="summary-card dashboard-trigger status-${key} ${selected ? "is-selected" : ""}" ${attrs} type="button"><span>${escapeHtml(key)}</span><strong>${value}</strong></button>`;
}

function renderSeatStatusList(eventId, options = {}) {
  const statuses = getSeatLimitStatuses(state, eventId);
  return `<ul class="status-list">${Object.entries(statuses)
    .map(([key, item]) => {
      const selected = view.dashboardDetailType === options.detailType && view.dashboardDetailKey === key;
      const attrs = options.detailType
        ? `data-action="dashboard-detail" data-detail-type="${options.detailType}" data-detail-key="${escapeAttr(key)}"`
        : "";
      return `<li class="${item.level} dashboard-list-item ${selected ? "is-selected" : ""}" ${attrs}><span>${key.replace(":", " ")}</span><strong>${item.total} / ${item.limit}</strong><em>${item.text}</em></li>`;
    })
    .join("")}</ul>`;
}

function renderDrinkStatusList(eventId, options = {}) {
  const statuses = getDrinkLimitStatuses(state, eventId);
  return `<ul class="status-list">${Object.entries(statuses)
    .map(([key, item]) => {
      const selected = view.dashboardDetailType === options.detailType && view.dashboardDetailKey === key;
      const attrs = options.detailType
        ? `data-action="dashboard-detail" data-detail-type="${options.detailType}" data-detail-key="${escapeAttr(key)}"`
        : "";
      return `<li class="${item.level} dashboard-list-item ${selected ? "is-selected" : ""}" ${attrs}><span>${item.label}</span><strong>${item.total} / ${item.limit}</strong><em>${item.text}</em></li>`;
    })
    .join("")}</ul>`;
}

function renderNameList(users, emptyText, suffix = "") {
  if (!users.length) return `<p class="empty">${emptyText}</p>`;
  return `<ul class="name-list">${users.map((user) => `<li>${escapeHtml(user.display_name)}${suffix ? `<span>${suffix}</span>` : ""}</li>`).join("")}</ul>`;
}

function renderEventOptions(selectedId) {
  const events = state.event_dates.filter((event) => !isEventArchived(event));
  return events
    .map((event) => option(event.id, `${formatDateLabel(event.event_date)} ${event.status === "休み" ? "休み" : ""}`, event.id === selectedId))
    .join("") || `<option value="">対象日がありません</option>`;
}

function renderArchiveEventOptions(selectedId) {
  const events = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  return events
    .map((event) => option(event.id, `${formatDateLabel(event.event_date)} ${event.status}`, event.id === selectedId))
    .join("") || `<option value="">アーカイブはまだありません</option>`;
}

function statusPill(status) {
  return `<span class="status-pill status-event-${status}">${escapeHtml(status)}</span>`;
}

function option(value, label, selected = false) {
  return `<option value="${escapeAttr(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderAttributeOptions(selectedValue, field = "attribute") {
  if (field === "ivan_attribute") {
    const selected = IVAN_ATTRIBUTES.includes(selectedValue) ? selectedValue : IVAN_ATTRIBUTE;
    return IVAN_ATTRIBUTES.map((attribute) => option(attribute, attribute, attribute === selected)).join("");
  }
  return option(RESERVATION_ATTRIBUTE, RESERVATION_ATTRIBUTE, true);
}

function getReservationPersonOptions(selectedId = "") {
  const people = [
    ...getActiveUsers(state).map((user) => ({ id: user.id, label: user.display_name })),
  ];
  if (selectedId && !people.some((person) => person.id === selectedId)) {
    const user = findUser(state, selectedId);
    if (user) people.push({ id: user.id, label: `${user.display_name}（無効）` });
  }
  return people;
}

function getReservationPersonName(personId) {
  if (!personId) return "未選択";
  const user = findUser(state, personId);
  if (user) return user.display_name;
  const staffMember = findStaffMember(state, personId);
  if (staffMember) return `${staffMember.display_name}（内勤）`;
  return personId;
}

function syncReservationAttributeControls(container) {
  const personField = container?.querySelector("[data-role='reservation-person-select']");
  if (!personField) return;
  container.querySelectorAll("[data-role='reservation-attribute-select']").forEach((select) => {
    if (select.name === "ivan_attribute" || select.dataset.field === "ivan_attribute") {
      select.value = IVAN_ATTRIBUTES.includes(select.value) ? select.value : IVAN_ATTRIBUTE;
      return;
    }
    select.value = RESERVATION_ATTRIBUTE;
  });
}

function renderAndFocusEditForm(formSelector) {
  render();
  window.requestAnimationFrame(() => {
    const form = root.querySelector(formSelector);
    if (!form) return;
    form.scrollIntoView({ block: "start", behavior: "smooth" });
    form.querySelector("input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled])")
      ?.focus({ preventScroll: true });
  });
}

function revealInactiveManagedPerson(personType, personId) {
  view.expandedInactivePersonType = personType;
  render();
  window.requestAnimationFrame(() => {
    const details = root.querySelector(`.collapsed-hosts[data-inactive-person-type="${personType}"]`);
    if (!details) return;
    details.open = true;
    window.requestAnimationFrame(() => {
      const row = [...details.querySelectorAll("[data-managed-person-id]")]
        .find((item) => item.dataset.managedPersonId === personId);
      const target = row || details.querySelector("summary");
      if (!target) return;
      target.scrollIntoView({ block: row ? "center" : "start", behavior: "smooth" });
      target.focus({ preventScroll: true });
    });
  });
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "navigate") {
    view.page = button.dataset.page;
    render();
    return;
  }
  if (action === "admin-tab") {
    view.adminTab = button.dataset.tab;
    render();
    return;
  }
  if (action === "reservation-tab") {
    view.reservationTab = button.dataset.tab;
    render();
    return;
  }
  if (action === "dashboard-detail") {
    const same = view.dashboardDetailType === button.dataset.detailType && view.dashboardDetailKey === button.dataset.detailKey;
    view.dashboardDetailType = same ? "" : button.dataset.detailType;
    view.dashboardDetailKey = same ? "" : button.dataset.detailKey;
    render();
    return;
  }
  if (action === "dashboard-detail-clear") {
    view.dashboardDetailType = "";
    view.dashboardDetailKey = "";
    render();
    return;
  }
  if (action === "admin-logout") {
    adminUnlocked = false;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    render();
    return;
  }
  if (action === "toggle-archive") {
    view.archiveEventId = view.archiveEventId === button.dataset.eventId ? "" : button.dataset.eventId;
    render();
    return;
  }
  if (action === "delete-archived-event") {
    deleteArchivedEventFromButton(button);
    return;
  }
  if (action === "save-reservation") saveReservationFromRow(button);
  if (action === "delete-reservation") deleteReservationFromRow(button);
  if (action === "edit-reservation-request") {
    view.editingReservationRequestId = button.dataset.requestId || "";
    renderAndFocusEditForm(".reservation-request-form");
    return;
  }
  if (action === "new-reservation-request") {
    view.editingReservationRequestId = "";
    render();
    return;
  }
  if (action === "delete-reservation-request") deleteReservationRequestFromButton(button);
  if (action === "request-placement") setReservationRequestPlacementFromButton(button);
  if (action === "delete-drink-plan") deleteDrinkPlanFromButton(button);
  if (action === "instance-assign") {
    saveInstanceAssignmentFromButton(button);
    return;
  }
  if (action === "generate-instance-image") {
    generateInstanceImage().catch(handleInstanceImageError);
    return;
  }
  if (action === "download-instance-image") {
    downloadInstanceImage(button.dataset.instanceKey || "a").catch(handleInstanceImageError);
    return;
  }
  if (action === "download-instance-images") {
    downloadAllInstanceImages().catch(handleInstanceImageError);
    return;
  }
  if (action === "admin-save-attendance") saveAdminAttendance(button);
  if (action === "admin-save-staff-attendance") saveAdminStaffAttendance(button);
  if (action === "edit-user") {
    view.editingUserId = button.dataset.userId;
    renderAndFocusEditForm("form[data-action='save-user']");
  }
  if (action === "edit-staff-member") {
    view.editingStaffMemberId = button.dataset.staffMemberId;
    renderAndFocusEditForm("form[data-action='save-staff-member']");
  }
  if (action === "disable-staff-member") {
    disableStaffMemberFromButton(button);
    return;
  }
  if (action === "enable-staff-member") {
    const result = setStaffMemberActive(state, button.dataset.staffMemberId, true);
    applyResult(result, "内勤を有効化しました。");
    return;
  }
  if (action === "disable-user") {
    disableUserFromButton(button);
    return;
  }
  if (action === "enable-user") {
    const result = setUserActive(state, button.dataset.userId, true);
    applyResult(result, "ホストを有効化しました。");
    return;
  }
  if (action === "delete-user") {
    deleteUserFromButton(button);
    return;
  }
  if (action === "delete-staff-member") {
    deleteStaffMemberFromButton(button);
    return;
  }
  if (action === "delete-role") {
    deleteRoleFromButton(button);
    return;
  }
  if (action === "new-user") {
    view.editingUserId = "";
    render();
  }
  if (action === "new-staff-member") {
    view.editingStaffMemberId = "";
    render();
  }
  if (action === "edit-vacation") {
    view.editingVacationId = button.dataset.vacationId;
    renderAndFocusEditForm("form[data-action='save-vacation']");
  }
  if (action === "new-vacation") {
    view.editingVacationId = "";
    render();
  }
  if (action === "edit-event") {
    view.editingEventId = button.dataset.eventId;
    renderAndFocusEditForm("form[data-action='save-event']");
  }
  if (action === "new-event") {
    view.editingEventId = "";
    render();
  }
  if (action === "copy-text") copyText(button.dataset.source);
  if (action === "export-json") exportJson();
  if (action === "reset-data") resetData();
}

function disableUserFromButton(button) {
  const user = findUser(state, button.dataset.userId);
  if (!user) {
    showToast("対象ホストが見つかりません。", "error");
    return;
  }
  const ok = window.confirm(`${user.display_name} を無効化します。入力候補と未入力判定から外れます。過去の予約履歴には名前が残ります。`);
  if (!ok) return;
  const result = setUserActive(state, user.id, false);
  if (result.ok && view.editingUserId === user.id) view.editingUserId = "";
  applyResult(result, `${user.display_name}を無効化し、「無効化済みホスト」へ移動しました。`);
  if (result.ok) revealInactiveManagedPerson("host", user.id);
}

function deleteRoleFromButton(button) {
  const roleName = button.dataset.roleName || "";
  const affectedUsers = (state.users || []).filter((user) => user.role === roleName);
  const message = affectedUsers.length
    ? `${roleName} を削除します。このタグのホスト ${affectedUsers.length}人は「ホスト」に戻ります。`
    : `${roleName} を削除します。`;
  if (!window.confirm(message)) return;
  const result = deleteRole(state, roleName);
  applyResult(result, "タグを削除しました。");
}

function disableStaffMemberFromButton(button) {
  const staffMember = state.staff_members.find((member) => member.id === button.dataset.staffMemberId);
  if (!staffMember) {
    showToast("対象内勤が見つかりません。", "error");
    return;
  }
  const ok = window.confirm(`${staffMember.display_name} を無効化します。内勤出勤の入力候補と未入力判定から外れます。過去の出勤履歴には名前が残ります。`);
  if (!ok) return;
  const result = setStaffMemberActive(state, staffMember.id, false);
  if (result.ok && view.editingStaffMemberId === staffMember.id) view.editingStaffMemberId = "";
  applyResult(result, `${staffMember.display_name}を無効化し、「無効化済み内勤」へ移動しました。`);
  if (result.ok) revealInactiveManagedPerson("staff", staffMember.id);
}

function deleteUserFromButton(button) {
  const user = findUser(state, button.dataset.userId);
  if (!user) {
    showToast("対象ホストが見つかりません。", "error");
    return;
  }
  if (user.is_active !== false) {
    showToast("ホストを削除する前に無効化してください。", "error");
    return;
  }
  deleteManagedPersonFromButton(button, "host", user);
}

function deleteStaffMemberFromButton(button) {
  const staffMember = findStaffMember(state, button.dataset.staffMemberId);
  if (!staffMember) {
    showToast("対象内勤が見つかりません。", "error");
    return;
  }
  if (staffMember.is_active !== false) {
    showToast("内勤を削除する前に無効化してください。", "error");
    return;
  }
  deleteManagedPersonFromButton(button, "staff", staffMember);
}

function deleteManagedPersonFromButton(button, personType, person) {
  const result = deleteManagedPerson(state, personType, person.id);
  if (!result.ok) {
    showToast((result.errors || ["削除できませんでした。"]).join(" / "), "error");
    return;
  }

  const config = MANAGED_PERSON_TYPES[personType];
  const photoNotice = personType === "host" && result.person.photo_data_url
    ? "登録済みの宣材写真データも削除されます。"
    : "";
  const message = `${result.person.display_name} を完全に削除します。この操作は元に戻せません。${photoNotice}`;
  if (!window.confirm(message)) return;

  if (personType === "host") {
    if (view.editingUserId === result.person.id) view.editingUserId = "";
    if (view.attendanceUserId === result.person.id) view.attendanceUserId = "";
  } else {
    if (view.editingStaffMemberId === result.person.id) view.editingStaffMemberId = "";
    if (view.staffAttendanceMemberId === result.person.id) view.staffAttendanceMemberId = "";
  }
  saveState(result.state, `${config.label}を完全に削除しました。`, { hardDeletes: result.hardDeletes });
}

function deleteArchivedEventFromButton(button) {
  const eventId = button.dataset.eventId || "";
  const archivedEvent = findEvent(state, eventId);
  if (!archivedEvent) {
    showToast("削除対象のイベント日が見つかりません。", "error");
    return;
  }

  const message = `${formatDateLabel(archivedEvent.event_date)} を完全に削除します。紐づく勤怠・予約・集計データも削除され、この操作は元に戻せません。`;
  if (!window.confirm(message)) return;

  const result = deleteArchivedEvent(state, archivedEvent.id);
  if (!result.ok) {
    showToast((result.errors || ["イベント日を削除できませんでした。"]).join(" / "), "error");
    return;
  }
  if (view.archiveEventId === archivedEvent.id) view.archiveEventId = "";
  saveState(result.state, `${formatDateLabel(archivedEvent.event_date)}を完全に削除しました。`, {
    eventDelete: result.eventDelete,
  });
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const data = Object.fromEntries(new FormData(form).entries());

  if (action === "save-attendance") {
    const result = upsertAttendance(state, data);
    applyResult(result, "勤怠を保存しました。");
  }
  if (action === "save-bulk-attendance") {
    await saveBulkAttendance(form);
    return;
  }
  if (action === "save-staff-attendance") {
    const result = upsertStaffAttendance(state, data);
    applyResult(result, "内勤出勤を保存しました。");
  }
  if (action === "save-bulk-staff-attendance") {
    saveBulkStaffAttendance(form);
    return;
  }
  if (action === "save-reservation-request") {
    const payload = {
      ...data,
      no_same_time_double_booking: false,
    };
    const result = upsertReservationRequest(state, payload, { admin: view.page === "admin" });
    if (result.ok) {
      form.reset();
      view.editingReservationRequestId = "";
    }
    applyResult(result, "予約受付に登録しました。");
    return;
  }
  if (action === "save-reservation-request-setting") {
    const result = upsertReservationSetting(state, data);
    applyResult(result, "予約受付設定を保存しました。");
    return;
  }
  if (action === "site-login") {
    if (data.password === state.settings.adminPassword) {
      siteUnlocked = true;
      adminUnlocked = true;
      sessionStorage.setItem(SITE_SESSION_KEY, "1");
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      showToast("サイトと運営画面を表示しました。");
      render();
    } else if (data.password === state.settings.sitePassword) {
      siteUnlocked = true;
      sessionStorage.setItem(SITE_SESSION_KEY, "1");
      showToast("サイトを表示しました。");
      render();
    } else {
      showToast("パスワードが違います。", "error");
    }
  }
  if (action === "admin-login") {
    if (data.password === state.settings.adminPassword) {
      adminUnlocked = true;
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      showToast("運営画面を表示しました。");
      render();
    } else {
      showToast("パスワードが違います。", "error");
    }
  }
  if (action === "save-user") {
    const result = upsertUser(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingUserId = "";
    applyResult(result, "ホスト情報を保存しました。");
  }
  if (action === "save-staff-member") {
    const result = upsertStaffMember(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingStaffMemberId = "";
    applyResult(result, "内勤情報を保存しました。");
  }
  if (action === "save-role") {
    const result = upsertRole(state, { name: data.name, is_active: true });
    applyResult(result, "タグを保存しました。");
  }
  if (action === "save-vacation") {
    const result = upsertVacation(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingVacationId = "";
    applyResult(result, "長期休暇を保存しました。");
  }
  if (action === "save-event") {
    const result = upsertEvent(state, data);
    if (result.ok) {
      view.editingEventId = "";
      view.eventId = result.event.id;
    }
    applyResult(result, "イベント日を保存しました。");
  }
  if (action === "save-drink-plan") {
    const result = upsertDrinkPlan(state, data);
    applyResult(result, "事前申請を保存しました。");
  }
}

function findSelectableAttendanceUser(targetState, userId, role) {
  const user = findUser(targetState, userId);
  if (!user || user.is_active !== true || getAttendanceUserRole(user) !== role) return null;
  return user;
}

async function getAttendanceUserForSave(userId, role) {
  const localUser = findSelectableAttendanceUser(state, userId, role);
  if (!localUser || syncStatus.mode !== "supabase") return localUser;

  try {
    const latestSharedState = await loadSharedState();
    if (!latestSharedState) return localUser;
    return findSelectableAttendanceUser(latestSharedState, userId, role) ? localUser : null;
  } catch (error) {
    console.warn("Could not revalidate the attendance host against the shared database.", error);
    return localUser;
  }
}

async function saveBulkAttendance(form) {
  const formData = new FormData(form);
  const userId = String(formData.get("user_id") || "");
  const eventIds = formData.getAll("attendance_event_id").map(String);
  const selectedCount = eventIds.filter((eventId) => formData.get(`status_${eventId}`)).length;
  let nextState = state;
  let savedCount = 0;
  const errors = [];
  if (!userId) {
    showToast("ホスト名を選択してください。", "error");
    return;
  }
  const user = await getAttendanceUserForSave(userId, view.attendanceRole);
  if (!user) {
    view.attendanceUserId = "";
    render();
    showToast("選択したホストの在籍状態またはロールが変更されています。ホストを選び直してください。", "error");
    return;
  }
  if (!selectedCount) {
    showToast("出欠を選択してください。", "error");
    return;
  }
  const ok = window.confirm(`${user?.display_name || "選択中のホスト"} として ${selectedCount}日分の勤怠を保存します。名前は間違いありませんか？`);
  if (!ok) return;
  view.attendanceUserId = userId;
  for (const eventId of eventIds) {
    const status = formData.get(`status_${eventId}`);
    if (!status) continue;
    const result = upsertAttendance(nextState, {
      event_date_id: eventId,
      user_id: userId,
      status,
      memo: formData.get(`memo_${eventId}`) || "",
    });
    if (!result.ok) {
      errors.push(...(result.errors || ["保存できませんでした。"]));
      continue;
    }
    nextState = result.state;
    savedCount += 1;
  }
  if (errors.length) {
    showToast(errors.join(" / "), "error");
    return;
  }
  saveState(nextState, `${savedCount}日分の勤怠を保存しました。`);
}

function saveBulkStaffAttendance(form) {
  const formData = new FormData(form);
  const staffMemberId = String(formData.get("staff_member_id") || "");
  const eventIds = formData.getAll("attendance_event_id").map(String);
  const selectedCount = eventIds.filter((eventId) => formData.get(`status_${eventId}`)).length;
  let nextState = state;
  let savedCount = 0;
  const errors = [];
  if (!staffMemberId) {
    showToast("内勤名を選択してください。", "error");
    return;
  }
  if (!selectedCount) {
    showToast("出欠を選択してください。", "error");
    return;
  }
  const staffMember = findStaffMember(state, staffMemberId);
  const ok = window.confirm(`${staffMember?.display_name || "選択中の内勤"} として ${selectedCount}日分の内勤出勤を保存します。名前は間違いありませんか？`);
  if (!ok) return;
  view.staffAttendanceMemberId = staffMemberId;
  for (const eventId of eventIds) {
    const status = formData.get(`status_${eventId}`);
    if (!status) continue;
    const result = upsertStaffAttendance(nextState, {
      event_date_id: eventId,
      staff_member_id: staffMemberId,
      status,
      memo: formData.get(`memo_${eventId}`) || "",
    });
    if (!result.ok) {
      errors.push(...(result.errors || ["保存できませんでした。"]));
      continue;
    }
    nextState = result.state;
    savedCount += 1;
  }
  if (errors.length) {
    showToast(errors.join(" / "), "error");
    return;
  }
  saveState(nextState, `${savedCount}日分の内勤出勤を保存しました。`);
}

function handleChange(event) {
  const eventSelect = event.target.closest("[data-role='event-select']");
  if (eventSelect) {
    view.eventId = eventSelect.value;
    view.editingReservationRequestId = "";
    render();
    return;
  }
  const archiveEventSelect = event.target.closest("[data-role='archive-event-select']");
  if (archiveEventSelect) {
    view.archiveEventId = archiveEventSelect.value;
    render();
    return;
  }
  const attendanceRole = event.target.closest("[data-role='attendance-role-select']");
  if (attendanceRole) {
    const selectedGroup = getAttendanceRoleGroups(state).find((group) => group.role === attendanceRole.value);
    view.attendanceRole = selectedGroup?.role || "";
    view.attendanceUserId = "";
    render();
    if (typeof root !== "undefined") root.querySelector("[data-role='attendance-user-select']")?.focus();
    return;
  }
  const attendanceUser = event.target.closest("[data-role='attendance-user-select']");
  if (attendanceUser) {
    view.attendanceUserId = attendanceUser.value;
    const selectedUser = getActiveUsers(state).find((user) => user.id === view.attendanceUserId);
    if (selectedUser) view.attendanceRole = getAttendanceUserRole(selectedUser);
    else view.attendanceUserId = "";
    render();
    return;
  }
  const staffAttendanceMember = event.target.closest("[data-role='staff-attendance-member-select']");
  if (staffAttendanceMember) {
    view.staffAttendanceMemberId = staffAttendanceMember.value;
    render();
    return;
  }
  const reservationPerson = event.target.closest("[data-role='reservation-person-select']");
  if (reservationPerson) {
    syncReservationAttributeControls(reservationPerson.closest("form") || reservationPerson.closest(".slot-row"));
    return;
  }
  const hostPhotoInput = event.target.closest("[data-role='host-photo-input']");
  if (hostPhotoInput) {
    saveHostPhotoFromInput(hostPhotoInput);
    return;
  }
  const eventDateInput = event.target.closest("[data-role='event-date-input']");
  if (eventDateInput) {
    const form = eventDateInput.closest("form");
    const openInput = form?.querySelector("[data-role='reservation-open-input']");
    if (openInput && eventDateInput.value) openInput.value = getReservationOpenAt(eventDateInput.value);
  }
}

async function saveReservationFromRow(button) {
  const row = button.closest(".slot-row");
  const payload = reservationPayloadFromRow(row);
  const adminMode = view.page === "admin";
  button.disabled = true;
  try {
    const localHostReferenceError = getReservationHostReferenceError(state, payload.host_user_id);
    if (localHostReferenceError) {
      showToast(localHostReferenceError, "error");
      return;
    }
    if (syncStatus.mode === "supabase") {
      const result = await saveReservationToSharedState(payload, adminMode);
      if (!result.ok) {
        showToast((result.errors || ["予約を保存できませんでした。"]).join(" / "), "error");
        return;
      }
      state = result.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
      showToast(result.warnings?.length ? `予約を保存しました。確認: ${result.warnings.join(" / ")}` : "予約を保存しました。");
      render();
      return;
    }
    const result = upsertReservation(state, payload, { admin: adminMode, strictDuplicate: true });
    applyResult(result, result.warnings?.length ? `予約を保存しました。確認: ${result.warnings.join(" / ")}` : "予約を保存しました。");
  } catch (error) {
    console.error(error);
    syncStatus = { mode: "error", text: shortSyncError(error, "共有DBへの保存に失敗") };
    showToast("共有DBへの保存に失敗しました。再読み込みして確認してください。", "error");
    render();
  } finally {
    button.disabled = false;
  }
}

async function saveReservationToSharedState(payload, adminMode) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await loadSharedRecord();
    const latestState = record.state ? migrateState(record.state) : state;
    const hostReferenceError = getReservationHostReferenceError(latestState, payload.host_user_id);
    if (hostReferenceError) {
      state = latestState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { ok: false, state: latestState, errors: [hostReferenceError] };
    }
    const conflict = getReservationSaveConflict(latestState, payload);
    if (conflict) {
      state = latestState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      return {
        ok: false,
        state: latestState,
        errors: [formatReservationConflictMessage(conflict)],
      };
    }
    const result = upsertReservation(latestState, payload, { admin: adminMode, strictDuplicate: true });
    if (!result.ok) return result;
    try {
      assertNoTombstonedPersonReferences(result.state, latestState);
    } catch (error) {
      return { ok: false, state: latestState, errors: [error.userMessage || "削除済み人物への参照は保存できません。"] };
    }
    try {
      await saveSharedState(result.state, { expectedUpdatedAt: record.updatedAt });
      return result;
    } catch (error) {
      if (error.code === "STALE_SHARED_STATE") continue;
      throw error;
    }
  }
  const record = await loadSharedRecord();
  const latestState = record.state ? migrateState(record.state) : state;
  state = latestState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  return {
    ok: false,
    state: latestState,
    errors: ["他の端末で先に更新されました。最新状態を読み込みました。もう一度確認してください。"],
  };
}

function getReservationHostReferenceError(latestState, hostUserId) {
  if (!hostUserId) return "";
  if (hasManagedPersonTombstone(latestState, "host", hostUserId)) {
    return "削除済みのホストが担当に指定されているため、予約を保存できません。最新状態を読み込みました。";
  }
  if (!findUser(latestState, hostUserId)) {
    return "共有DBに存在しないホストが担当に指定されているため、予約を保存できません。最新状態を読み込みました。";
  }
  return "";
}

function formatReservationConflictMessage(conflict) {
  const reservation = conflict.reservation;
  const summary = summarizeReservationPayload(reservation);
  if (conflict.type === "stale") {
    return `この予約は他の端末で先に変更されています。最新状態を読み込みました: ${summary}`;
  }
  return `この枠は既に登録されています。最新状態を読み込みました: ${summary}`;
}

function deleteReservationFromRow(button) {
  if (view.page !== "admin") {
    showToast("予約の削除は運営画面からのみ可能です。", "error");
    return;
  }
  const row = button.closest(".slot-row");
  const reservation = findReservationBySlot(state, row.dataset.eventId, row.dataset.timeSlot, row.dataset.seatType, row.dataset.groupNo);
  const reservationId = row.dataset.reservationId || reservation?.id || "";
  if (!reservationId) {
    showToast("削除する予約がありません。", "error");
    return;
  }
  const result = deleteReservation(state, reservationId, new Date(), { admin: true });
  applyResult(result, "予約を削除しました。");
}

function deleteDrinkPlanFromButton(button) {
  const planId = button.dataset.planId;
  if (!planId) {
    showToast("削除する事前申請がありません。", "error");
    return;
  }
  const ok = window.confirm("この事前申請を削除します。続行しますか？");
  if (!ok) return;
  const result = deleteDrinkPlan(state, planId);
  applyResult(result, "事前申請を削除しました。");
}

function deleteReservationRequestFromButton(button) {
  if (view.page !== "admin") {
    showToast("予約受付の削除は運営画面からのみ可能です。", "error");
    return;
  }
  const requestId = button.dataset.requestId;
  if (!requestId) {
    showToast("削除する予約受付がありません。", "error");
    return;
  }
  const ok = window.confirm("この予約受付を削除します。続行しますか？");
  if (!ok) return;
  const result = deleteReservationRequest(state, requestId, new Date(), { admin: true });
  if (result.ok && view.editingReservationRequestId === requestId) view.editingReservationRequestId = "";
  applyResult(result, "予約受付を削除しました。");
}

function setReservationRequestPlacementFromButton(button) {
  const requestId = button.dataset.requestId;
  const placementStatus = button.dataset.placementStatus || "auto";
  const result = setReservationRequestPlacement(state, requestId, placementStatus);
  applyResult(result, "予約受付の扱いを変更しました。");
}

function reservationPayloadFromRow(row) {
  const payload = {
    id: row.dataset.reservationId || "",
    event_date_id: row.dataset.eventId,
    time_slot: row.dataset.timeSlot,
    seat_type: row.dataset.seatType,
    group_no: row.dataset.groupNo,
  };
  row.querySelectorAll("[data-field]").forEach((field) => {
    payload[field.dataset.field] = field.value;
  });
  return {
    ...normalizeReservation(payload),
    base_updated_at: row.dataset.reservationUpdatedAt || "",
  };
}

function saveAdminAttendance(button) {
  const tr = button.closest("tr");
  const payload = {
    event_date_id: view.eventId,
    user_id: button.dataset.userId,
    status: tr.querySelector("[data-field='status']").value,
    memo: tr.querySelector("[data-field='memo']").value,
  };
  const result = upsertAttendance(state, payload);
  applyResult(result, "勤怠を保存しました。");
}

function saveAdminStaffAttendance(button) {
  const tr = button.closest("tr");
  const payload = {
    event_date_id: view.eventId,
    staff_member_id: button.dataset.staffMemberId,
    status: tr.querySelector("[data-field='status']").value,
    memo: tr.querySelector("[data-field='memo']").value,
  };
  const result = upsertStaffAttendance(state, payload);
  applyResult(result, "内勤出勤を保存しました。");
}

function saveInstanceAssignmentFromButton(button) {
  const result = upsertInstanceAssignment(state, {
    event_date_id: view.eventId,
    person_type: button.dataset.personType,
    person_id: button.dataset.personId,
    instance_key: button.dataset.instanceKey,
  });
  applyResult(result, "インスタンス振り分けを保存しました。");
}

async function saveHostPhotoFromInput(input) {
  const user = findUser(state, input.dataset.userId);
  const file = input.files?.[0];
  if (!user || !file) return;
  if (!file.type.startsWith("image/")) {
    showToast("画像ファイルを選択してください。", "error");
    input.value = "";
    return;
  }
  input.disabled = true;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const resized = await resizeImageDataUrl(dataUrl, 640, 0.86);
    const result = upsertUser(state, {
      ...user,
      photo_data_url: resized,
      photo_name: file.name,
    });
    applyResult(result, "宣材写真を保存しました。");
  } catch (error) {
    console.error(error);
    showToast("宣材写真を読み込めませんでした。", "error");
  } finally {
    input.disabled = false;
    input.value = "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function resizeImageDataUrl(dataUrl, maxSize, quality = 0.86) {
  const image = await loadCanvasImage(dataUrl);
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function generateInstanceImage() {
  const model = getInstancePlannerModel(view.eventId);
  if (!model.event) {
    showToast("対象日を選択してください。", "error");
    return;
  }
  const targets = [
    { key: "a", canvas: root.querySelector("#instance-image-canvas-a") },
    { key: "b", canvas: root.querySelector("#instance-image-canvas-b") },
  ].filter((target) => target.canvas);
  if (!targets.length) {
    showToast("画像プレビューが見つかりません。", "error");
    return;
  }
  await Promise.all(targets.map((target) => drawInstanceImage(target.canvas, model, target.key)));
  showToast("インスタンス別画像を生成しました。");
}

async function downloadInstanceImage(instanceKey = "a", options = {}) {
  const config = getInstanceImageConfig(instanceKey);
  const canvas = document.createElement("canvas");
  const model = getInstancePlannerModel(view.eventId);
  if (!model.event) {
    if (!options.silent) showToast("対象日を選択してください。", "error");
    return null;
  }
  await drawInstanceImage(canvas, model, config.key);
  downloadBlob(await canvasToPngBlob(canvas), buildInstanceImageFileName(model, config.key));
  if (!options.silent) showToast(`${config.title}のPNGを保存しました。`);
  return canvas;
}

async function downloadAllInstanceImages() {
  const model = getInstancePlannerModel(view.eventId);
  if (!model.event) {
    showToast("対象日を選択してください。", "error");
    return;
  }
  const files = await Promise.all(["a", "b"].map(async (instanceKey) => {
    const canvas = document.createElement("canvas");
    await drawInstanceImage(canvas, model, instanceKey);
    return {
      name: buildInstanceImageFileName(model, instanceKey),
      bytes: await canvasToPngBytes(canvas),
    };
  }));
  downloadBlob(new Blob([createStoredZip(files)], { type: "application/zip" }), buildInstanceZipFileName(model));
  showToast("第1・第2インスタンスのZIPを保存しました。");
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = URL.createObjectURL(blob);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas PNG export failed"));
      }
    }, "image/png");
  });
}

async function canvasToPngBytes(canvas) {
  return new Uint8Array(await (await canvasToPngBlob(canvas)).arrayBuffer());
}

function handleInstanceImageError(error) {
  console.error(error);
  showToast("画像生成に失敗しました。宣材写真を確認してください。", "error");
}

function getInstanceImageConfig(instanceKey) {
  const key = instanceKey === "b" ? "b" : "a";
  return {
    key,
    title: key === "a" ? "第1インスタンス" : "第2インスタンス",
    suffix: key === "a" ? "instance1" : "instance2",
  };
}

function buildInstanceImageFileName(model, instanceKey) {
  const config = getInstanceImageConfig(instanceKey);
  const event = model.event ? model.event.event_date.replaceAll("-", "") : "instance";
  return `legacy-lily-${config.suffix}-${event}.png`;
}

function buildInstanceZipFileName(model) {
  const event = model.event ? model.event.event_date.replaceAll("-", "") : "instance";
  return `legacy-lily-instances-${event}.zip`;
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const { time, date } = getDosDateTime(new Date());
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, file.bytes.length);
    writeUint32(localView, 22, file.bytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, file.bytes.length);
    writeUint32(centralView, 24, file.bytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.bytes.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, centralOffset);
  writeUint16(endView, 20, 0);

  return concatUint8Arrays([...localParts, ...centralParts, endHeader]);
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function getDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function drawInstanceImage(canvas, model, instanceKey = "a") {
  const config = getInstanceImageConfig(instanceKey);
  const hosts = model.hostGroups[config.key] || [];
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  const imageEntries = await Promise.all(hosts.map(async (row) => {
    if (!row.user.photo_data_url) return [row.user.id, null];
    try {
      return [row.user.id, await loadCanvasImage(row.user.photo_data_url)];
    } catch {
      return [row.user.id, null];
    }
  }));
  const imageMap = new Map(imageEntries);

  drawWorldToneInstanceBackground(ctx, canvas.width, canvas.height);
  drawWorldToneInstanceImageHeader(ctx, model, config.title);
  drawWorldToneInstancePosterGrid(ctx, hosts, imageMap);
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

const INSTANCE_IMAGE_THEME = {
  bg0: "#050612",
  bg1: "#101326",
  bg2: "#1a1436",
  marble: "rgba(235, 228, 255, 0.075)",
  lineSoft: "rgba(178, 137, 255, 0.12)",
  accent: "#caa1ff",
  accentSoft: "rgba(202, 161, 255, 0.32)",
  cyanSoft: "rgba(143, 224, 255, 0.12)",
  text: "#f8f4ff",
  muted: "#c8bed9",
  card: "#050711",
  cardMid: "#121427",
  cardLine: "rgba(221, 210, 244, 0.72)",
  shadow: "rgba(0, 0, 0, 0.66)",
};

function drawWorldToneInstanceBackground(ctx, width, height) {
  const theme = INSTANCE_IMAGE_THEME;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.bg0);
  gradient.addColorStop(0.48, theme.bg1);
  gradient.addColorStop(1, theme.bg2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = theme.lineSoft;
  ctx.lineWidth = 4;
  for (let x = -width; x < width * 1.7; x += 142) {
    ctx.beginPath();
    ctx.moveTo(x, height + 40);
    ctx.lineTo(x + height + 140, -40);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.68;
  for (let x = -120; x < width; x += 218) {
    const marble = ctx.createLinearGradient(x, 0, x + 420, height);
    marble.addColorStop(0, "transparent");
    marble.addColorStop(0.5, theme.marble);
    marble.addColorStop(1, "transparent");
    ctx.fillStyle = marble;
    ctx.fillRect(x, 0, 420, height);
  }
  ctx.restore();

  const glow = ctx.createRadialGradient(width * 0.2, height * 0.12, 0, width * 0.2, height * 0.12, width * 0.52);
  glow.addColorStop(0, theme.accentSoft);
  glow.addColorStop(1, "rgba(202, 161, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const cyanGlow = ctx.createRadialGradient(width * 0.82, height * 0.68, 0, width * 0.82, height * 0.68, width * 0.42);
  cyanGlow.addColorStop(0, theme.cyanSoft);
  cyanGlow.addColorStop(1, "rgba(143, 224, 255, 0)");
  ctx.fillStyle = cyanGlow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.68)";
  for (let index = 0; index < 56; index += 1) {
    const x = (index * 197 + 83) % width;
    const y = (index * 113 + 41) % height;
    const radius = index % 5 === 0 ? 2 : 1;
    ctx.globalAlpha = index % 4 === 0 ? 0.72 : 0.34;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWorldToneInstanceImageHeader(ctx, model, instanceTitle) {
  const theme = INSTANCE_IMAGE_THEME;
  ctx.fillStyle = theme.text;
  ctx.textAlign = "center";
  ctx.font = "800 86px Arial, sans-serif";
  ctx.fillText("ABYSS   出勤ホスト", 800, 96);
  ctx.fillStyle = theme.muted;
  ctx.font = "800 28px Arial, sans-serif";
  const dateLabel = model.event ? model.event.event_date.replaceAll("-", "/") : "対象日未設定";
  ctx.fillText(`Group Join  ×  ${dateLabel}`, 800, 144);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.shadowColor = theme.accentSoft;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(626, 172);
  ctx.lineTo(974, 172);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineCap = "butt";
  ctx.fillStyle = theme.text;
  ctx.font = "800 40px Arial, sans-serif";
  ctx.fillText(instanceTitle, 800, 218);
  ctx.textAlign = "left";
}

function drawWorldToneInstancePosterGrid(ctx, hosts, imageMap) {
  if (!hosts.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(248, 244, 255, 0.72)";
    ctx.font = "800 36px Arial, sans-serif";
    ctx.fillText("未配置", 800, 510);
    ctx.textAlign = "left";
    return;
  }

  const layout = getInstancePosterLayout(hosts.length, 1600, 900);
  hosts.forEach((row, index) => {
    const col = index % layout.cols;
    const rowIndex = Math.floor(index / layout.cols);
    const x = layout.startX + col * (layout.cardW + layout.gapX);
    const y = layout.startY + rowIndex * (layout.cardH + layout.gapY);
    drawWorldToneInstancePosterCard(ctx, x, y, layout.cardW, layout.cardH, row, imageMap.get(row.user.id));
  });
}

function drawWorldToneInstancePosterCard(ctx, x, y, width, height, row, image) {
  const theme = INSTANCE_IMAGE_THEME;
  ctx.save();
  ctx.shadowColor = theme.shadow;
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, x, y, width, height, 7);
  ctx.fillStyle = theme.card;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x + 3, y + 3, width - 6, height - 6, 4);
  ctx.clip();
  if (image) {
    drawImageCover(ctx, image, x + 3, y + 3, width - 6, height - 6);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, theme.card);
    gradient.addColorStop(0.58, theme.cardMid);
    gradient.addColorStop(1, "#02030a");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 3, y + 3, width - 6, height - 6);
    ctx.fillStyle = theme.text;
    ctx.font = `800 ${Math.max(16, width * 0.12)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("no photo", x + width / 2, y + height * 0.46);
    ctx.fillStyle = theme.accent;
    ctx.font = `700 ${Math.max(13, width * 0.08)}px Georgia, serif`;
    ctx.fillText(row.user.display_name, x + width / 2, y + height - 22);
    ctx.textAlign = "left";
  }
  ctx.restore();

  ctx.save();
  ctx.shadowColor = theme.accentSoft;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = theme.cardLine;
  ctx.lineWidth = Math.max(2, width * 0.018);
  roundRectPath(ctx, x, y, width, height, 6);
  ctx.stroke();
  ctx.restore();
}

function drawInstanceBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#07101f");
  gradient.addColorStop(0.58, "#111d34");
  gradient.addColorStop(1, "#07323a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(214, 181, 109, 0.12)";
  ctx.lineWidth = 5;
  for (let x = -width; x < width * 1.7; x += 138) {
    ctx.beginPath();
    ctx.moveTo(x, height + 40);
    ctx.lineTo(x + height + 140, -40);
    ctx.stroke();
  }
  ctx.restore();

  const glow = ctx.createRadialGradient(width * 0.12, height * 0.1, 0, width * 0.12, height * 0.1, width * 0.52);
  glow.addColorStop(0, "rgba(47, 140, 255, 0.24)");
  glow.addColorStop(1, "rgba(47, 140, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function drawInstanceImageHeader(ctx, model, instanceTitle) {
  ctx.fillStyle = "#fff8ea";
  ctx.textAlign = "center";
  ctx.font = "800 86px Arial, sans-serif";
  ctx.fillText("ABYSS   出勤ホスト", 800, 96);
  ctx.fillStyle = "#c7bda6";
  ctx.font = "800 28px Arial, sans-serif";
  const dateLabel = model.event ? model.event.event_date.replaceAll("-", "/") : "対象日未設定";
  ctx.fillText(`Group Join  ×  ${dateLabel}`, 800, 144);
  ctx.strokeStyle = "#d6b56d";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(626, 172);
  ctx.lineTo(974, 172);
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.fillStyle = "#fff8ea";
  ctx.font = "800 40px Arial, sans-serif";
  ctx.fillText(instanceTitle, 800, 218);
  ctx.textAlign = "left";
}

function drawInstancePosterGrid(ctx, hosts, imageMap) {
  if (!hosts.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 248, 234, 0.72)";
    ctx.font = "800 36px Arial, sans-serif";
    ctx.fillText("未配置", 800, 510);
    ctx.textAlign = "left";
    return;
  }

  const layout = getInstancePosterLayout(hosts.length, 1600, 900);
  hosts.forEach((row, index) => {
    const col = index % layout.cols;
    const rowIndex = Math.floor(index / layout.cols);
    const x = layout.startX + col * (layout.cardW + layout.gapX);
    const y = layout.startY + rowIndex * (layout.cardH + layout.gapY);
    drawInstancePosterCard(ctx, x, y, layout.cardW, layout.cardH, row, imageMap.get(row.user.id));
  });
}

function getInstancePosterLayout(count, width, height) {
  const rows = count <= 5 ? 1 : count <= 12 ? 2 : 3;
  const cols = Math.ceil(count / rows);
  const top = 240;
  const bottom = 56;
  const availableW = width - 190;
  const availableH = height - top - bottom;
  const minGapX = 34;
  const minGapY = rows === 3 ? 22 : 28;
  const maxCardW = rows === 1 ? 176 : rows === 2 ? 160 : 126;
  let cardW = Math.min(maxCardW, (availableW - minGapX * (cols - 1)) / cols);
  let cardH = cardW * 16 / 9;
  const maxCardH = (availableH - minGapY * (rows - 1)) / rows;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = cardH * 9 / 16;
  }
  const gapX = cols > 1 ? Math.min(155, Math.max(minGapX, (availableW - cardW * cols) / (cols - 1))) : 0;
  const gapY = rows > 1 ? Math.min(78, Math.max(minGapY, (availableH - cardH * rows) / (rows - 1))) : 0;
  const totalW = cardW * cols + gapX * (cols - 1);
  const totalH = cardH * rows + gapY * (rows - 1);
  return {
    rows,
    cols,
    cardW,
    cardH,
    gapX,
    gapY,
    startX: (width - totalW) / 2,
    startY: top + (availableH - totalH) / 2,
  };
}

function drawInstancePosterCard(ctx, x, y, width, height, row, image) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.62)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, x, y, width, height, 7);
  ctx.fillStyle = "#020409";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x + 3, y + 3, width - 6, height - 6, 4);
  ctx.clip();
  if (image) {
    drawImageCover(ctx, image, x + 3, y + 3, width - 6, height - 6);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, "#030509");
    gradient.addColorStop(0.58, "#0a0c10");
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 3, y + 3, width - 6, height - 6);
    ctx.fillStyle = "#fff8ea";
    ctx.font = `800 ${Math.max(16, width * 0.12)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("no photo", x + width / 2, y + height * 0.46);
    ctx.fillStyle = "#d6b56d";
    ctx.font = `700 ${Math.max(13, width * 0.08)}px Georgia, serif`;
    ctx.fillText(row.user.display_name, x + width / 2, y + height - 22);
    ctx.textAlign = "left";
  }
  ctx.restore();

  ctx.fillStyle = "#d6b56d";
  ctx.lineWidth = Math.max(2, width * 0.018);
  roundRectPath(ctx, x, y, width, height, 6);
  ctx.stroke();
}

function drawImageCover(ctx, image, x, y, width, height) {
  const imageW = image.naturalWidth || image.width;
  const imageH = image.naturalHeight || image.height;
  const scale = Math.max(width / imageW, height / imageH);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (imageW - sw) / 2;
  const sy = (imageH - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitCanvasText(ctx, text, x, y, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) {
    ctx.fillText(value, x, y);
    return;
  }
  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  ctx.fillText(`${output}...`, x, y);
}

function applyResult(result, successMessage) {
  if (!result.ok) {
    showToast((result.errors || ["保存できませんでした。"]).join(" / "), "error");
    return;
  }
  saveState(result.state, successMessage);
}

async function copyText(source) {
  const textarea = root.querySelector(`[data-copy-source="${source}"]`);
  if (!textarea) return;
  textarea.select();
  try {
    await navigator.clipboard.writeText(textarea.value);
    showToast("コピーしました。");
  } catch {
    document.execCommand("copy");
    showToast("コピーしました。");
  }
}

function exportJson() {
  const textarea = root.querySelector("[data-copy-source='export']");
  textarea.value = JSON.stringify(state, null, 2);
  textarea.select();
  showToast("JSONを書き出しました。");
}

function resetData() {
  const ok = window.confirm("このブラウザ内のデータを初期化します。続行しますか？");
  if (!ok) return;
  state = buildDefaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  view.eventId = getDefaultEventId();
  showToast("初期データに戻しました。");
  render();
}

function summarizeHistoryPayload(history, payload) {
  if (history?.target_type === "reservation") return summarizeReservationPayload(payload);
  if (history?.target_type === "reservation_request") return summarizeReservationRequestPayload(payload);
  if (history?.target_type === "drink_plan") return summarizeDrinkPlanPayload(payload);
  return summarizePayload(payload);
}

function summarizeReservationRequestPayload(payload) {
  if (!payload) return "-";
  const event = findEvent(state, payload.event_date_id);
  const slot = [
    event ? formatDateLabel(event.event_date) : "",
    REQUEST_TIME_SLOT_LABELS[payload.desired_time_slot] || payload.desired_time_slot,
  ].filter(Boolean).join(" ");
  const hostName = payload.host_user_id ? getReservationPersonName(payload.host_user_id) : "未選択";
  return [
    slot,
    `担当: ${hostName}`,
    formatReservationGuestMeta(payload),
    formatReservationDrinkBreakdown(payload),
    payload.memo ? `メモ: ${payload.memo}` : "",
    payload.is_deleted ? "削除済み" : "",
  ].filter(Boolean).join(" / ");
}

function summarizeDrinkPlanPayload(payload) {
  if (!payload) return "-";
  const event = findEvent(state, payload.event_date_id);
  const itemLabel = DRINK_LIMITS[payload.item_type]?.label || payload.item_type || "未選択";
  const hostName = payload.host_user_id ? getReservationPersonName(payload.host_user_id) : "未選択";
  return [
    [event ? formatDateLabel(event.event_date) : "", getTimeSlotLabel(payload.time_slot)].filter(Boolean).join(" "),
    `担当: ${hostName}`,
    `${itemLabel} ×${Number(payload.count) || 0}`,
    payload.memo ? `メモ: ${payload.memo}` : "",
    payload.is_deleted ? "削除済み" : "",
  ].filter(Boolean).join(" / ");
}

function summarizeReservationPayload(payload) {
  if (!payload) return "-";
  const event = findEvent(state, payload.event_date_id);
  const slot = [event ? formatDateLabel(event.event_date) : "", getTimeSlotLabel(payload.time_slot), payload.seat_type, payload.group_no]
    .filter(Boolean)
    .join(" ");
  const hostName = payload.host_user_id ? getReservationPersonName(payload.host_user_id) : "未選択";
  const drinks = formatReservationDrinkBreakdown(payload);
  return [
    slot,
    `担当: ${hostName}`,
    formatReservationGuestMeta(payload),
    drinks,
    payload.memo ? `メモ: ${payload.memo}` : "",
    payload.is_deleted ? "削除済み" : "",
  ].filter(Boolean).join(" / ");
}

function summarizePayload(payload) {
  if (!payload) return "-";
  const copy = clone(payload);
  const keys = [
    "display_name",
    "staff_type",
    "event_date",
    "status",
    "memo",
    "time_slot",
    "seat_type",
    "group_no",
    "host_user_id",
    "desired_time_slot",
    "instance_count",
    "normal_capacity_front",
    "normal_capacity_back",
    "ivan_capacity",
    "placement_status",
    "person_type",
    "person_id",
    "instance_key",
    "item_type",
    "count",
    "princess_name",
    "attribute",
    "ivan_name",
    "ivan_attribute",
    "purple_count",
    "red_count",
    "blue_count",
    "green_count",
    "tower_count",
    "is_deleted",
  ];
  const picked = {};
  for (const key of keys) {
    if (copy[key] !== undefined && copy[key] !== "") picked[key] = copy[key];
  }
  return JSON.stringify(picked);
}

function showToast(message, type = "success") {
  toastRoot.textContent = message;
  toastRoot.className = `toast is-visible ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toastRoot.className = "toast";
  }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
