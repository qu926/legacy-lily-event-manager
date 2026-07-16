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
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} must exist`);

  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function formControlValue(html, tagName, name) {
  const control = html.match(new RegExp(`<${tagName}\\b(?=[^>]*\\bname=["']${name}["'])[^>]*>`))?.[0];
  assert.ok(control, `${name} must be rendered`);
  return control.match(/\bvalue=["']([^"']*)["']/)?.[1];
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
