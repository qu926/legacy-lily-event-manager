const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

require("./ui-regression.test.cjs");
require("./member-lifecycle.test.cjs");
require("./archive-deletion.test.cjs");

const root = path.resolve(__dirname, "..");
const slug = "legacy-lily-event-manager";
const title = "Legacy Lily店 勤怠・予約管理";
const logoPath = "./assets/lily-mark-silver.png";
const wideLogoPath = "./assets/lily-wordmark-silver.png";
const homepage = "https://qu926.github.io/legacy-lily-event-manager/";
const repositoryUrl = "https://github.com/qu926/legacy-lily-event-manager.git";
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
]);
const legacyMarkers = [
  ["sample", "event"].join("-"),
  ["Sample", "Event"].join(" "),
  ["event", "manager", "template"].join("-"),
  ["EX", "CEED"].join(""),
  ["exceed", "event", "manager"].join("-"),
];

function fromRoot(...segments) {
  return path.join(root, ...segments);
}

async function readText(...segments) {
  return fs.readFile(fromRoot(...segments), "utf8");
}

async function loadWindowConfig() {
  const filename = fromRoot("js", "config.js");
  const source = await fs.readFile(filename, "utf8");
  const sandbox = { window: Object.create(null) };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "deployment-config",
  });
  const script = new vm.Script(source, { filename });

  script.runInContext(context, { timeout: 1_000 });
  return sandbox.window.EVENT_MANAGER_CONFIG;
}

function functionSource(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `function ${name} must exist`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === "async "
    ? functionStart - 6
    : functionStart;

  const nextPlain = source.indexOf("\nfunction ", functionStart + 1);
  const nextAsync = source.indexOf("\nasync function ", functionStart + 1);
  const nextCandidates = [nextPlain, nextAsync].filter((index) => index !== -1);
  const next = nextCandidates.length ? Math.min(...nextCandidates) : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

function formControlValue(html, tagName, name) {
  const control = html.match(new RegExp(`<${tagName}\\b(?=[^>]*\\bname=["']${name}["'])[^>]*>`))?.[0];
  assert.ok(control, `${name} must be rendered`);
  return control.match(/\bvalue=["']([^"']*)["']/)?.[1];
}

function dataRoleSelectOptions(html, dataRole) {
  const select = html.match(new RegExp(
    `<select\\b(?=[^>]*\\bdata-role=["']${dataRole}["'])[^>]*>([\\s\\S]*?)<\\/select>`,
  ));
  assert.ok(select, `${dataRole} must be rendered`);
  return [...select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((match) => ({
    value: match[1].match(/\bvalue=["']([^"']*)["']/)?.[1] || "",
    label: match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    selected: /\bselected\b/.test(match[1]),
  }));
}

function relatedFunctionSources(source, entryName, namePattern) {
  const names = [...source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map((match) => match[1]);
  const available = new Map(names.map((name) => [name, functionSource(source, name)]));
  const included = new Set([entryName]);
  const queue = [entryName];

  while (queue.length) {
    const current = available.get(queue.shift()) || "";
    for (const match of current.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const dependency = match[1];
      if (available.has(dependency) && namePattern.test(dependency) && !included.has(dependency)) {
        included.add(dependency);
        queue.push(dependency);
      }
    }
  }

  return [...included]
    .filter((name) => name !== entryName)
    .map((name) => available.get(name))
    .join("\n");
}

function attendanceFixtureState() {
  return {
    users: [
      { id: "host-blank", display_name: "Blank Host", role: "", is_active: true },
      { id: "host-standard", display_name: "Standard Host", role: "ホスト", is_active: true },
      { id: "leader-1", display_name: "Leader One", role: "幹部", is_active: true },
      { id: "leader-2", display_name: "Leader Two", role: "幹部", is_active: true },
      { id: "trial-1", display_name: "Trial Host", role: "体入", is_active: true },
      { id: "inactive-only", display_name: "Inactive Host", role: "休止ロール", is_active: false },
    ],
    roles: [
      { name: "ホスト", is_active: true },
      { name: "幹部", is_active: true },
      { name: "体入", is_active: true },
      { name: "在籍者なし", is_active: true },
      { name: "休止ロール", is_active: true },
    ],
  };
}

function attendanceSandbox(state, view) {
  const normalizeRole = (role) => String(role || "").trim() || "ホスト";
  const getActiveUsers = (targetState = state) => targetState.users.filter((user) => user.is_active !== false);
  const usersForRole = (targetStateOrRole, maybeRole) => {
    const targetState = typeof targetStateOrRole === "object" ? targetStateOrRole : state;
    const role = typeof targetStateOrRole === "object" ? maybeRole : targetStateOrRole;
    return getActiveUsers(targetState).filter((user) => normalizeRole(user.role) === normalizeRole(role));
  };

  return {
    state,
    view,
    DEFAULT_ATTENDANCE_ROLE: "ホスト",
    DEFAULT_HOST_ROLE: "ホスト",
    HOST_ROLE: "ホスト",
    ROLES: state.roles.map((role) => role.name),
    getActiveUsers,
    getRoles: (targetState = state) => targetState.roles.filter((role) => role.is_active !== false),
    findUser: (targetState, userId) => targetState.users.find((user) => user.id === userId),
    getAttendanceRole: normalizeRole,
    getAttendanceRoleForUser: (user) => normalizeRole(user?.role),
    getUserAttendanceRole: (user) => normalizeRole(user?.role),
    normalizeAttendanceRole: normalizeRole,
    normalizeHostRole: normalizeRole,
    getAttendanceUsersForRole: usersForRole,
    getActiveUsersByRole: usersForRole,
    getUsersForAttendanceRole: usersForRole,
  };
}

async function listTextFiles(directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTextFiles(entryPath));
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

test("package metadata is Lily-specific", async () => {
  const packageJson = JSON.parse(await readText("package.json"));
  assert.equal(packageJson.name, slug);
  assert.equal(packageJson.homepage, homepage);
  assert.equal(packageJson.repository?.url, repositoryUrl);
});

test("window config contains the Lily deployment identifiers and branding", async () => {
  const config = await loadWindowConfig();

  assert.ok(config && typeof config === "object");
  assert.equal(config.appId, slug);
  assert.equal(config.localStorageVersion, "v2");
  assert.equal(config.stateRowId, slug);
  assert.equal(config.brandName, "Legacy Lily店");
  assert.equal(config.title, title);
  assert.equal(config.eyebrow, "Legacy Group / Lily");
  assert.equal(config.logoPath, logoPath);
  assert.equal(config.wideLogoPath, wideLogoPath);
  assert.equal(config.logoAlt, "Legacy Lily店 ロゴ");
  assert.equal(config.core.sitePassword, "lily");
  assert.equal(config.core.adminPassword, "lily2026");
  assert.equal(config.core.eventStartDate, "2026-07-15");
  assert.equal(config.core.archiveGraceDays, 0);
  assert.deepEqual(Array.from(config.core.extraEventDates), []);
});

test("Supabase schema consistently uses the Lily state row ID", async () => {
  const schema = await readText("supabase", "schema.sql");
  const policyIds = [...schema.matchAll(/\bid\s*=\s*'([^']+)'/g)]
    .map((match) => match[1]);
  const insertedIds = [...schema.matchAll(/\bvalues\s*\(\s*'([^']+)'/gi)]
    .map((match) => match[1]);
  const stateIds = [...policyIds, ...insertedIds];

  assert.ok(stateIds.length > 0, "schema.sql must contain state row ID checks");
  assert.deepEqual(
    [...new Set(stateIds)],
    [slug],
    "every schema state row ID must match the Lily slug",
  );
});

test("index metadata uses the Lily title and logo", async () => {
  const html = await readText("index.html");

  assert.match(html, /<title>\s*Legacy Lily店 勤怠・予約管理\s*<\/title>/);
  assert.match(html, /<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']https:\/\/qu926\.github\.io\/legacy-lily-event-manager\/["'])[^>]*>/);
  assert.match(html, /<meta\b(?=[^>]*\bproperty=["']og:url["'])(?=[^>]*\bcontent=["']https:\/\/qu926\.github\.io\/legacy-lily-event-manager\/["'])[^>]*>/);
  assert.match(
    html,
    /<link\b(?=[^>]*\brel=["']icon["'])(?=[^>]*\bhref=["']\.\/assets\/lily-mark-silver\.png["'])[^>]*>/,
  );
});

test("README documents the Lily deployment slug", async () => {
  const readme = await readText("README.md");

  assert.match(readme, /GitHubリポジトリ名は `legacy-lily-event-manager`/);
  assert.match(readme, /https:\/\/[^/\s]+\.github\.io\/legacy-lily-event-manager\//);
});

test("configured Lily logo asset exists and is not empty", async () => {
  const config = await loadWindowConfig();
  for (const configuredPath of [config.logoPath, config.wideLogoPath]) {
    const normalizedLogoPath = configuredPath.replace(/^\.\//, "");
    const logoFile = fromRoot(...normalizedLogoPath.split("/"));
    const stat = await fs.stat(logoFile);

    assert.ok(stat.isFile(), `${configuredPath} must be a file`);
    assert.ok(stat.size > 0, `${configuredPath} must not be empty`);
  }
});

test("reservation request UI preserves single-instance capacities when the form is rerendered", async () => {
  const app = await readText("js", "app.js");
  const sandbox = {
    TIME_SLOTS: ["front", "back"],
    escapeAttr: String,
    escapeHtml: String,
    option(value, label, selected) {
      return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
    },
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "reservation-request-renderers",
  });
  const rendererNames = [
    "renderReservationRequestSettingForm",
    "renderReservationRequestSummaryV2",
    "renderRequestHoldCapacityPanel",
    "renderRequestCapacityPanel",
  ];
  const script = new vm.Script(`
    (() => {
      ${rendererNames.map((name) => functionSource(app, name)).join("\n")}
      return { renderReservationRequestSettingForm, renderReservationRequestSummaryV2 };
    })()
  `, { filename: fromRoot("js", "app.js") });
  const renderers = script.runInContext(context, { timeout: 1_000 });

  const twoInstanceHtml = renderers.renderReservationRequestSettingForm("event-1", {
    instance_count: 2,
    normal_capacity_front: 18,
    normal_capacity_back: 19,
    ivan_capacity: 4,
  });
  assert.equal(formControlValue(twoInstanceHtml, "input", "normal_capacity_front"), "18");
  assert.equal(formControlValue(twoInstanceHtml, "input", "normal_capacity_back"), "19");
  assert.match(twoInstanceHtml, /<option value="4" selected>/);

  const singleInstanceHtml = renderers.renderReservationRequestSettingForm("event-1", {
    instance_count: 1,
    normal_capacity_front: 4,
    normal_capacity_back: 4,
    ivan_capacity: 2,
  });
  assert.equal(formControlValue(singleInstanceHtml, "input", "normal_capacity_front"), "4");
  assert.equal(formControlValue(singleInstanceHtml, "input", "normal_capacity_back"), "4");
  assert.match(singleInstanceHtml, /<option value="2" selected>/);

  const emptySeatBucket = (capacity) => ({ reserved: [], hold: [], capacity });
  const buckets = {
    front: { normal: emptySeatBucket(4), ivan: emptySeatBucket(2) },
    back: { normal: emptySeatBucket(4), ivan: emptySeatBucket(2) },
  };
  const summaryHtml = renderers.renderReservationRequestSummaryV2(buckets, {
    instance_count: 1,
    normal_capacity_front: 4,
    normal_capacity_back: 4,
    ivan_capacity: 2,
  }, {
    total: 0,
    capacity: 18,
    reservationCapacity: 12,
    holdCapacity: 6,
    holdUsed: 0,
    holdUsedByTimeSlot: { front: 0, back: 0 },
    holdCapacityByTimeSlot: { front: 3, back: 3 },
    closed: false,
  });
  assert.equal((summaryHtml.match(/<strong>0 \/ 4<\/strong>/g) || []).length, 2);
  assert.equal((summaryHtml.match(/<strong>0 \/ 2<\/strong>/g) || []).length, 2);
});

test("reservation champagne UI uses branded names without changing legacy count fields", async () => {
  const app = await readText("js", "app.js");
  const champagneTypes = [
    { key: "purple", label: "ナイト 10p" },
    { key: "red", label: "ロード 30p" },
    { key: "blue", label: "デューク 50p" },
    { key: "green", label: "クラウン 120p" },
  ];
  const sandbox = {
    TIME_SLOTS: ["前半", "後半"],
    REQUEST_TIME_SLOT_LABELS: { 前半: "前半希望", 後半: "後半希望" },
    RESERVATION_ATTRIBUTE: "リピ",
    IVAN_ATTRIBUTE: "初回",
    IVAN_ATTRIBUTES: ["リピ", "初回"],
    RESERVATION_DRINK_TYPES: champagneTypes,
    DRINK_PLAN_TYPES: [{ key: "tower", label: "タワー" }, ...champagneTypes],
    DRINK_LIMITS: Object.fromEntries([
      { key: "tower", label: "タワー" },
      ...champagneTypes,
    ].map(({ key, label }) => [key, { label }])),
    state: {},
    clone: (value) => JSON.parse(JSON.stringify(value)),
    escapeAttr: String,
    escapeHtml: String,
    findEvent: () => ({ event_date: "2026-07-18" }),
    formatDateLabel: () => "7/18（土）",
    formatHistoryDateTime: String,
    getReservationPersonName: () => "Host",
    getReservationPersonOptions: () => [],
    getReservationWarnings: () => [],
    getTimeSlotLabel: (value) => value || "",
    renderAttributeOptions: () => "",
    option(value, label, selected) {
      return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
    },
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "champagne-ui-renderers",
  });
  const rendererNames = [
    "renderReservationRequestForm",
    "renderReservationRow",
    "textCell",
    "attributeCell",
    "numberCell",
    "formatReservationDrinkBreakdown",
    "formatReservationGuestMeta",
    "formatGuestAttribute",
    "summarizeHistoryPayload",
    "summarizeReservationPayload",
    "summarizeReservationRequestPayload",
    "summarizeDrinkPlanPayload",
    "summarizePayload",
  ];
  const script = new vm.Script(`
    (() => {
      ${rendererNames.map((name) => functionSource(app, name)).join("\n")}
      return { renderReservationRequestForm, renderReservationRow, formatReservationDrinkBreakdown, summarizeHistoryPayload };
    })()
  `, { filename: fromRoot("js", "app.js") });
  const renderers = script.runInContext(context, { timeout: 1_000 });
  const counts = {
    purple_count: 1,
    red_count: 2,
    blue_count: 3,
    green_count: 4,
  };

  const requestHtml = renderers.renderReservationRequestForm("event-1", {}, false, counts);
  const rowHtml = renderers.renderReservationRow(counts, {
    eventId: "event-1",
    timeSlot: "前半",
    seatType: "通常席",
    groupNo: "1",
    noIvanColumn: false,
    adminMode: true,
    locked: false,
  });

  for (const { key, label } of champagneTypes) {
    assert.ok(requestHtml.includes(`<span>${label}</span>`), `${label} must be shown in the request form`);
    assert.equal(formControlValue(requestHtml, "input", `${key}_count`), String(counts[`${key}_count`]));
    assert.ok(rowHtml.includes(`data-label="${label}"`), `${label} must be shown in the reservation grid`);
    assert.ok(rowHtml.includes(`data-field="${key}_count"`), `${key}_count must remain the stored field name`);
  }

  assert.equal(
    renderers.formatReservationDrinkBreakdown({ tower_count: 1, ...counts }),
    "タワー ×1 / ナイト 10p ×1 / ロード 30p ×2 / デューク 50p ×3 / クラウン 120p ×4",
  );
  assert.equal(
    renderers.summarizeHistoryPayload(
      { target_type: "drink_plan" },
      { event_date_id: "event-1", time_slot: "前半", host_user_id: "host-1", item_type: "purple", count: 2 },
    ),
    "7/18（土） 前半 / 担当: Host / ナイト 10p ×2",
  );
  assert.equal(
    renderers.summarizeHistoryPayload(
      { target_type: "reservation_request" },
      { event_date_id: "event-1", desired_time_slot: "前半", host_user_id: "host-1", purple_count: 1 },
    ),
    "7/18（土） 前半希望 / 担当: Host / ナイト 10p ×1",
  );
});

test("host attendance role selection filters active hosts and hides saving until a host is explicit", async () => {
  const app = await readText("js", "app.js");
  const state = attendanceFixtureState();
  const view = { eventId: "event-1", attendanceRole: "ホスト", attendanceUserId: "" };
  const sandbox = {
    ...attendanceSandbox(state, view),
    getActiveEvents: () => [{ id: "event-1", event_date: "2026-07-18", status: "開催" }],
    findEvent: () => ({ id: "event-1", event_date: "2026-07-18", status: "開催" }),
    formatDateLabel: () => "7/18（土）",
    option(value, label, selected) {
      return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
    },
    renderAttendanceSummaryCards: () => "",
    renderBulkAttendanceRow: () => "<div data-attendance-input-row></div>",
    renderEventOptions: () => "",
    renderNameList: () => "",
    getMissingUsers: () => [],
    statusPill: () => "",
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "host-attendance-role-renderer",
  });
  const script = new vm.Script(`
    (() => {
      ${relatedFunctionSources(app, "renderAttendancePage", /role|AttendanceUser/i)}
      ${functionSource(app, "renderAttendancePage")}
      return renderAttendancePage;
    })()
  `, { filename: fromRoot("js", "app.js") });
  const renderAttendancePage = script.runInContext(context, { timeout: 1_000 });

  const unselectedHtml = renderAttendancePage();
  const roleOptions = dataRoleSelectOptions(unselectedHtml, "attendance-role-select");
  assert.deepEqual(
    new Set(roleOptions.map((item) => item.value).filter(Boolean)),
    new Set(["ホスト", "幹部", "体入"]),
    "roles without active users must not be offered",
  );
  assert.match(roleOptions.find((item) => item.value === "ホスト")?.label || "", /2\s*(?:人|名)/);
  assert.match(roleOptions.find((item) => item.value === "幹部")?.label || "", /2\s*(?:人|名)/);
  assert.match(roleOptions.find((item) => item.value === "体入")?.label || "", /1\s*(?:人|名)/);

  const hostOptions = dataRoleSelectOptions(unselectedHtml, "attendance-user-select");
  assert.equal(hostOptions[0]?.value, "", "the host selector must start unselected");
  assert.deepEqual(
    hostOptions.filter((item) => item.value).map((item) => item.value),
    ["host-blank", "host-standard"],
    "blank roles must be treated as ホスト and inactive hosts must be excluded",
  );
  assert.doesNotMatch(unselectedHtml, /bulk-save-button/);
  assert.doesNotMatch(unselectedHtml, /data-attendance-input-row/);

  view.attendanceUserId = "host-blank";
  const selectedHtml = renderAttendancePage();
  assert.match(selectedHtml, /bulk-save-button/);
  assert.match(selectedHtml, /data-attendance-input-row/);
  assert.equal(
    dataRoleSelectOptions(selectedHtml, "attendance-user-select")
      .find((item) => item.value === "host-blank")?.selected,
    true,
  );

  view.attendanceRole = "幹部";
  view.attendanceUserId = "";
  const leaderOptions = dataRoleSelectOptions(renderAttendancePage(), "attendance-user-select");
  assert.deepEqual(
    leaderOptions.filter((item) => item.value).map((item) => item.value),
    ["leader-1", "leader-2"],
  );
});

test("changing attendance role clears the host until an explicit host change synchronizes it", async () => {
  const app = await readText("js", "app.js");
  const state = attendanceFixtureState();
  const view = { attendanceRole: "ホスト", attendanceUserId: "host-standard" };
  let renderCount = 0;
  let hostFocusCount = 0;
  const sandbox = {
    ...attendanceSandbox(state, view),
    render: () => { renderCount += 1; },
    root: {
      querySelector(selector) {
        assert.equal(selector, "[data-role='attendance-user-select']");
        return { focus: () => { hostFocusCount += 1; } };
      },
    },
    syncReservationAttributeControls: () => {},
    saveHostPhotoFromInput: () => {},
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "host-attendance-role-change-handler",
  });
  const script = new vm.Script(`
    (() => {
      ${relatedFunctionSources(app, "handleChange", /role|AttendanceUser/i)}
      ${functionSource(app, "handleChange")}
      return handleChange;
    })()
  `, { filename: fromRoot("js", "app.js") });
  const handleChange = script.runInContext(context, { timeout: 1_000 });
  const changeEvent = (dataRole, value) => {
    const control = {
      value,
      closest(selector) {
        return selector.includes(`data-role='${dataRole}'`) || selector.includes(`data-role="${dataRole}"`)
          ? control
          : null;
      },
    };
    return { target: control };
  };

  handleChange(changeEvent("attendance-role-select", "幹部"));
  assert.equal(view.attendanceRole, "幹部");
  assert.equal(view.attendanceUserId, "", "changing role must not impersonate the first host");

  handleChange(changeEvent("attendance-user-select", "leader-2"));
  assert.equal(view.attendanceUserId, "leader-2");
  assert.equal(view.attendanceRole, "幹部");

  handleChange(changeEvent("attendance-role-select", "ホスト"));
  assert.equal(view.attendanceUserId, "");
  assert.equal(renderCount, 3);
  assert.equal(hostFocusCount, 2, "focus must move to the host selector after each role change");
});

test("attendance starts without implicitly selecting the first host", async () => {
  const app = await readText("js", "app.js");

  assert.doesNotMatch(
    app,
    /view\.attendanceUserId\s*=\s*getActiveUsers\(state\)\[0\]/,
    "the first active host must never be selected during startup",
  );
  assert.match(app, /attendanceUserId:\s*""/);
  assert.match(app, /ロールを選択してください/);
});

test("attendance save revalidates the host against shared state and keeps offline fallback", async () => {
  const app = await readText("js", "app.js");
  const state = { ...attendanceFixtureState(), attendance_entries: [] };
  const view = { attendanceRole: "ホスト", attendanceUserId: "host-standard" };
  let renderCount = 0;
  let confirmCount = 0;
  let saveCount = 0;
  let toast = null;
  let remoteMode = "inactive";
  class FakeFormData {
    get(name) {
      if (name === "user_id") return "host-standard";
      if (name === "status_event-1") return "出勤";
      return "";
    }
    getAll(name) {
      return name === "attendance_event_id" ? ["event-1"] : [];
    }
  }
  const sandbox = {
    ...attendanceSandbox(state, view),
    FormData: FakeFormData,
    syncStatus: { mode: "supabase" },
    async loadSharedState() {
      if (remoteMode === "error") throw new Error("offline");
      return {
        ...state,
        users: state.users.map((user) => user.id === "host-standard" ? { ...user, is_active: false } : user),
      };
    },
    render: () => { renderCount += 1; },
    showToast: (message, type) => { toast = { message, type }; },
    saveState: () => { saveCount += 1; },
    upsertAttendance: () => { throw new Error("blocked saves must not reach upsertAttendance"); },
    window: { confirm: () => { confirmCount += 1; return true; } },
    console: { warn() {} },
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "host-attendance-shared-revalidation",
  });
  const script = new vm.Script(`
    (() => {
      ${functionSource(app, "normalizeAttendanceRole")}
      ${functionSource(app, "getAttendanceUserRole")}
      ${functionSource(app, "findSelectableAttendanceUser")}
      ${functionSource(app, "getAttendanceUserForSave")}
      ${functionSource(app, "saveBulkAttendance")}
      return { getAttendanceUserForSave, saveBulkAttendance };
    })()
  `, { filename: fromRoot("js", "app.js") });
  const attendanceSave = script.runInContext(context, { timeout: 1_000 });

  await attendanceSave.saveBulkAttendance({});
  assert.equal(view.attendanceUserId, "");
  assert.equal(renderCount, 1);
  assert.equal(confirmCount, 0);
  assert.equal(saveCount, 0);
  assert.equal(toast?.type, "error");

  remoteMode = "error";
  const offlineUser = await attendanceSave.getAttendanceUserForSave("host-standard", "ホスト");
  assert.equal(offlineUser?.id, "host-standard", "temporary connection failures must not disable local attendance entry");
});

test("attendance URL state preserves valid users but never substitutes invalid users", async () => {
  const app = await readText("js", "app.js");
  const state = attendanceFixtureState();
  const view = {
    page: "attendance",
    adminTab: "dashboard",
    reservationTab: "requests",
    eventId: "event-1",
    archiveEventId: "",
    attendanceRole: "幹部",
    attendanceUserId: "leader-2",
    staffAttendanceMemberId: "",
    dashboardDetailType: "",
    dashboardDetailKey: "",
  };
  let replacedUrl = "";
  let storageMode = "local";
  const window = {
    location: { hash: "", pathname: "/legacy-lily-event-manager/", search: "" },
    history: {
      replaceState(_state, _title, url) {
        replacedUrl = url;
      },
    },
  };
  const sandbox = {
    ...attendanceSandbox(state, view),
    window,
    URLSearchParams,
    VIEW_PAGES: new Set(["attendance", "admin", "reservation"]),
    ADMIN_TABS: new Set(["dashboard"]),
    RESERVATION_TABS: new Set(["requests", "towers"]),
    sharedStateInitialized: true,
    pendingAttendanceUserId: "",
    getStorageMode: () => storageMode,
  };
  const hasReconcile = app.includes("function reconcileAttendanceSelection(");
  const reconcileSupport = hasReconcile
    ? relatedFunctionSources(app, "reconcileAttendanceSelection", /role|AttendanceUser/i)
    : "";
  const reconcileSource = hasReconcile ? functionSource(app, "reconcileAttendanceSelection") : "";
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: "host-attendance-role-location",
  });
  const script = new vm.Script(`
    (() => {
      ${relatedFunctionSources(app, "restoreViewFromLocation", /role|AttendanceUser/i)}
      ${reconcileSupport}
      ${functionSource(app, "restoreViewFromLocation")}
      ${functionSource(app, "saveViewToLocation")}
      ${functionSource(app, "resolvePendingAttendanceUserSelection")}
      ${reconcileSource}
      return {
        restoreViewFromLocation,
        saveViewToLocation,
        resolvePendingAttendanceUserSelection,
        getPendingAttendanceUserId: () => pendingAttendanceUserId,
        setSharedStateInitialized: (value) => { sharedStateInitialized = value; },
        reconcileAttendanceSelection: typeof reconcileAttendanceSelection === "function"
          ? reconcileAttendanceSelection
          : null,
      };
    })()
  `, { filename: fromRoot("js", "app.js") });
  const locationFunctions = script.runInContext(context, { timeout: 1_000 });
  const restoreAndReconcile = () => {
    locationFunctions.restoreViewFromLocation();
    locationFunctions.reconcileAttendanceSelection?.();
  };

  locationFunctions.saveViewToLocation();
  const savedParams = new URLSearchParams(replacedUrl.split("#")[1]);
  assert.equal(savedParams.get("attendanceRole"), "幹部");
  assert.equal(savedParams.get("attendanceUserId"), "leader-2");

  view.attendanceRole = "ホスト";
  view.attendanceUserId = "host-standard";
  window.location.hash = "#page=attendance&eventId=event-1&attendanceRole=%E4%BD%93%E5%85%A5";
  restoreAndReconcile();
  assert.equal(view.attendanceRole, "体入");
  assert.equal(view.attendanceUserId, "", "a role-only URL must require an explicit host choice");

  view.attendanceRole = "ホスト";
  view.attendanceUserId = "";
  window.location.hash = "#page=attendance&eventId=event-1&attendanceUserId=leader-1";
  restoreAndReconcile();
  assert.equal(view.attendanceUserId, "leader-1", "legacy attendanceUserId-only URLs must retain a valid host");
  assert.equal(view.attendanceRole, "幹部");

  storageMode = "supabase";
  locationFunctions.setSharedStateInitialized(false);
  window.location.hash = "#page=attendance&eventId=event-1&attendanceUserId=remote-only";
  restoreAndReconcile();
  locationFunctions.saveViewToLocation();
  assert.equal(locationFunctions.getPendingAttendanceUserId(), "remote-only");
  assert.match(replacedUrl, /attendanceUserId=remote-only/);
  state.users.push({ id: "remote-only", display_name: "Remote Host", role: "幹部", is_active: true });
  locationFunctions.resolvePendingAttendanceUserSelection();
  assert.equal(view.attendanceUserId, "remote-only");
  assert.equal(view.attendanceRole, "幹部");

  storageMode = "local";
  locationFunctions.setSharedStateInitialized(true);

  for (const invalidUserId of ["inactive-only", "missing-user"]) {
    view.attendanceRole = "ホスト";
    view.attendanceUserId = "";
    window.location.hash = `#page=attendance&eventId=event-1&attendanceUserId=${invalidUserId}`;
    restoreAndReconcile();
    assert.equal(
      view.attendanceUserId,
      "",
      `${invalidUserId} must be cleared instead of being replaced with another host`,
    );
  }
});

test("repository text contains no legacy template branding", async () => {
  const files = await listTextFiles();

  for (const filename of files) {
    const source = await fs.readFile(filename, "utf8");
    for (const marker of legacyMarkers) {
      assert.equal(
        source.includes(marker),
        false,
        `${path.relative(root, filename)} contains legacy marker ${JSON.stringify(marker)}`,
      );
    }
  }
});
