const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

async function readText(...segments) {
  return fs.readFile(path.join(root, ...segments), "utf8");
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} must exist`);

  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function actionBranch(source, action) {
  const marker = `if (action === "${action}")`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${action} action must exist`);

  const next = source.indexOf("\n  if (action === ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function functionEntries(source) {
  const matches = [...source.matchAll(/^function\s+([\w$]+)\s*\(/gm)];
  return matches.map((match, index) => ({
    name: match[1],
    source: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

function openingTags(source, tagName) {
  return [...source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "g"))].map((match) => match[0]);
}

test("edit actions render, reveal, and focus their management forms", async () => {
  const app = await readText("js", "app.js");
  const helper = functionSource(app, "renderAndFocusEditForm");

  assert.match(helper, /\brender\(\);/);
  assert.match(helper, /requestAnimationFrame\s*\(/);
  assert.match(helper, /root\.querySelector\(formSelector\)/);
  assert.match(helper, /scrollIntoView\s*\(\s*\{[^}]*block:\s*["']start["'][^}]*behavior:\s*["']smooth["']/s);
  assert.match(
    helper,
    /form\.querySelector\([^;]+\)\s*\?\.focus\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/s,
    "the first enabled form control must receive keyboard focus",
  );

  const expectedTargets = new Map([
    ["edit-user", "form[data-action='save-user']"],
    ["edit-staff-member", "form[data-action='save-staff-member']"],
    ["edit-vacation", "form[data-action='save-vacation']"],
    ["edit-event", "form[data-action='save-event']"],
    ["edit-reservation-request", ".reservation-request-form"],
  ]);

  for (const [action, selector] of expectedTargets) {
    const branch = actionBranch(app, action);
    assert.ok(
      branch.includes(`renderAndFocusEditForm("${selector}")`),
      `${action} must move the user to ${selector}`,
    );
  }
});

test("disabling a member reveals and focuses that member in the inactive section", async () => {
  const app = await readText("js", "app.js");
  const helper = functionEntries(app).find(({ source }) => (
    /\.collapsed-hosts/.test(source)
    && /\.open\s*=\s*true/.test(source)
    && /\.focus\s*\(/.test(source)
  ));

  assert.ok(helper, "a helper must reveal the inactive-member details and focus the moved member");
  assert.match(helper.source, /\brender\(\);/);
  assert.match(helper.source, /requestAnimationFrame\s*\(/);
  assert.match(helper.source, /root\.querySelector/);
  assert.match(helper.source, /scrollIntoView\s*\(/);
  assert.match(helper.source, /\.focus\s*\(\s*(?:\{\s*preventScroll:\s*true\s*\})?\s*\)/s);

  for (const { functionName, personExpression, destination } of [
    {
      functionName: "disableUserFromButton",
      personExpression: "user.id",
      destination: "無効化済みホスト",
    },
    {
      functionName: "disableStaffMemberFromButton",
      personExpression: "staffMember.id",
      destination: "無効化済み内勤",
    },
  ]) {
    const disable = functionSource(app, functionName);
    const helperCall = new RegExp(`\\b${helper.name}\\s*\\([^;]*${personExpression.replace(".", "\\.")}[^;]*\\)`);
    assert.match(disable, helperCall, `${functionName} must focus the member it just moved`);
    const notifications = [...disable.matchAll(/\b(?:applyResult|showToast)\s*\(([^;]*)\);/gs)]
      .map((match) => match[1]);
    assert.ok(
      notifications.some((message) => message.includes(".display_name") && message.includes(destination)),
      `${functionName} must announce both the affected member name and ${destination}`,
    );
  }
});

test("member management tables expose captions, column headers, and named actions", async () => {
  const app = await readText("js", "app.js");

  for (const { functionName, personExpression } of [
    { functionName: "renderHostManagementTable", personExpression: "user.display_name" },
    { functionName: "renderStaffManagementTable", personExpression: "member.display_name" },
  ]) {
    const table = functionSource(app, functionName);
    assert.match(table, /<caption\b[^>]*>[^<]+<\/caption>/, `${functionName} must label its table`);

    const headers = openingTags(table, "th");
    assert.ok(headers.length > 0, `${functionName} must render column headers`);
    for (const header of headers) {
      assert.match(header, /\bscope=["']col["']/, `${functionName} column headers must use scope=\"col\"`);
    }

    const actionButtons = openingTags(table, "button").filter((tag) => /\bdata-action=/.test(tag));
    assert.ok(actionButtons.length > 0, `${functionName} must render member actions`);
    for (const button of actionButtons) {
      assert.match(button, /\baria-label=/, `${functionName} actions must have an accessible name`);
      assert.ok(
        button.includes(personExpression),
        `${functionName} action labels must include the affected member name`,
      );
    }
  }
});

test("primary and admin navigation expose landmarks and current location", async () => {
  const app = await readText("js", "app.js");
  const render = functionSource(app, "render");
  const navButton = functionSource(app, "navButton");
  const adminPage = functionSource(app, "renderAdminPage");
  const adminGroupButton = functionSource(app, "adminGroupButton");
  const adminTabButton = functionSource(app, "adminTabButton");
  const adminSectionTabs = functionSource(app, "renderAdminSectionTabs");

  assert.match(render, /<nav\b(?=[^>]*\bclass=["']top-nav["'])(?=[^>]*\baria-label=)[^>]*>/);
  assert.match(navButton, /view\.page\s*===\s*page/);
  assert.match(navButton, /aria-current/);

  assert.match(
    adminPage,
    /<(?:nav\b(?=[^>]*\bclass=["']side-nav["'])(?=[^>]*\baria-label=)|[^>]+\bclass=["']side-nav["'][^>]*\brole=["']navigation["'])[^>]*>/,
    "the admin side navigation must be a labelled navigation landmark",
  );

  for (const [name, source] of [
    ["adminGroupButton", adminGroupButton],
    ["adminTabButton", adminTabButton],
    ["renderAdminSectionTabs", adminSectionTabs],
  ]) {
    assert.match(source, /aria-current/, `${name} must expose its current item`);
  }

  assert.match(adminSectionTabs, /<nav\b(?=[^>]*\bclass=["']admin-section-tabs panel["'])(?=[^>]*\baria-label=)[^>]*>/);
});

test("keyboard focus is visible on primary and admin navigation controls", async () => {
  const css = await readText("css", "styles.css");
  const focusRules = [...css.matchAll(/([^{}]+:focus-visible[^{}]*)\{([^{}]*)\}/g)]
    .map((match) => `${match[1]} {${match[2]}}`)
    .join("\n");

  assert.notEqual(focusRules, "", "styles must define a focus-visible rule");
  for (const className of ["nav-button", "side-button", "tab-button"]) {
    assert.ok(
      new RegExp(`\\.${className}\\b`).test(focusRules) || /(?:^|[,(])\s*button\b/m.test(focusRules),
      `.${className} must have a visible keyboard focus style`,
    );
  }
  assert.match(focusRules, /(?:outline|box-shadow)\s*:/);
});

test("inactive member tables stay inside the mobile page width", async () => {
  const css = await readText("css", "styles.css");
  const detailsRules = [...css.matchAll(/\.collapsed-hosts\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join("\n");
  const tableRules = [...css.matchAll(/\.collapsed-hosts\s+\.table-wrap\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join("\n");

  assert.match(detailsRules, /min-width\s*:\s*0/);
  assert.match(detailsRules, /max-width\s*:\s*100%/);
  assert.match(detailsRules, /overflow\s*:\s*hidden/);
  assert.match(tableRules, /width\s*:\s*100%/);
  assert.match(tableRules, /max-width\s*:\s*100%/);
  assert.match(tableRules, /min-width\s*:\s*0/);
});

test("inactive section summaries keep native disclosure-marker layout", async () => {
  const css = await readText("css", "styles.css");
  const summaryRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((selector) => (
      /\.collapsed-hosts(?:\s*>\s*|\s+)summary\s*$/.test(selector.trim())
    )));

  assert.ok(summaryRules.length > 0, "the inactive section summary must be styled");
  for (const [, selectors, declarations] of summaryRules) {
    assert.doesNotMatch(
      declarations,
      /\bdisplay\s*:\s*flex\b/,
      `${selectors.trim()} must not replace the summary element's native marker layout with flex`,
    );
  }
});
