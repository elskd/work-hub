import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, webkit } from "playwright";

const viewports = [
  ...[320, 390, 768, 1024, 1440].map((width) => ({ width, height: 900 })),
  { width: 390, height: 500 },
];
const taskTitle =
  "Подготовить подробную структуру многостраничного сайта и согласовать все разделы с заказчиком: длинное название для проверки переноса строк";
const within = (actual, expected, label, tolerance = 2) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}px, received ${actual}px`,
  );

async function fixture(page, url) {
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00Z"));
  await page.goto(url);
  await page.locator("h1").waitFor();
  await page.evaluate(async (title) => {
    const { emptyState } = await import("/src/domain.js");
    const state = emptyState();
    state.tasks = [
      {
        id: "layout-task",
        title,
        description: "Проверка длинного названия и первой строки.",
        projectId: "",
        priority: "normal",
        done: false,
        archived: false,
        plannedDate: "2026-10-12",
        deadline: "2026-10-14",
        start: "",
        end: "",
        repeat: { frequency: "none", interval: 1, weekdays: [] },
        subtasks: [],
      },
    ];
    state.payments = [
      {
        id: "oct",
        status: "received",
        receivedDate: "2026-10-12",
        amountKopecks: 6000000,
      },
      {
        id: "sep",
        status: "received",
        receivedDate: "2026-09-12",
        amountKopecks: 1000000,
      },
    ];
    localStorage.setItem("workhub.stage1.v1", JSON.stringify(state));
  }, taskTitle);
  await page.reload();
  await page.locator("h1").waitFor();
}

async function noOverflow(page, label) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    `${label}: page has horizontal overflow`,
  );
}

async function dialogGeometry(page, label) {
  const geometry = await page.locator("#editor").evaluate((dialog) => {
    const box = (element) => {
      const { top, right, bottom, left, width, height } =
        element.getBoundingClientRect();
      return { top, right, bottom, left, width, height };
    };
    const body = dialog.querySelector(".dialog-body");
    const header = dialog.querySelector(".dialog-head");
    const actions = dialog.querySelector(".dialog-actions");
    return {
      dialog: box(dialog),
      header: box(header),
      actions: box(actions),
      body: box(body),
      controls: [...actions.querySelectorAll("button")].map(box),
      viewport: { width: innerWidth, height: innerHeight },
      dialogScrollTop: dialog.scrollTop,
      dialogOverflow: dialog.scrollHeight - dialog.clientHeight,
      dialogOverflowX: dialog.scrollWidth - dialog.clientWidth,
      formScrollTop: dialog.querySelector("form").scrollTop,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyScrollTop: body.scrollTop,
      bodyScrollRange: body.scrollHeight - body.clientHeight,
      pageScrollY: scrollY,
    };
  });
  for (const [name, box] of [
    ["dialog", geometry.dialog],
    ["header", geometry.header],
    ["actions", geometry.actions],
    ...geometry.controls.map((box, index) => [`action ${index + 1}`, box]),
  ]) {
    assert.ok(box.width > 0 && box.height > 0, `${label}: ${name} has no size`);
    assert.ok(
      box.top >= -1 &&
        box.left >= -1 &&
        box.bottom <= geometry.viewport.height + 1 &&
        box.right <= geometry.viewport.width + 1,
      `${label}: ${name} is clipped by viewport: ${JSON.stringify(box)}`,
    );
    if (name !== "dialog") {
      assert.ok(
        box.top >= geometry.dialog.top - 1 &&
          box.bottom <= geometry.dialog.bottom + 1,
        `${label}: ${name} is clipped by dialog`,
      );
    }
  }
  assert.ok(
    geometry.body.top >= geometry.header.bottom - 1,
    `${label}: body overlaps header`,
  );
  assert.ok(
    geometry.body.bottom <= geometry.actions.top + 1,
    `${label}: body overlaps footer`,
  );
  assert.match(
    geometry.bodyOverflowY,
    /auto|scroll/,
    `${label}: body must own vertical scrolling`,
  );
  assert.ok(
    geometry.dialogOverflow <= 2,
    `${label}: outer dialog has scrollable content`,
  );
  assert.ok(
    geometry.dialogOverflowX <= 1,
    `${label}: dialog has horizontal overflow`,
  );
  assert.equal(geometry.dialogScrollTop, 0, `${label}: outer dialog scrolled`);
  assert.equal(
    geometry.formScrollTop,
    0,
    `${label}: form scrolled instead of body`,
  );
  return geometry;
}

async function controlHeights(page, label) {
  const controls = await page
    .locator(
      '#editor select, #editor input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
    )
    .evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.name || element.id,
        tag: element.tagName,
        height: element.getBoundingClientRect().height,
      })),
    );
  assert.ok(
    controls.some((control) => control.tag === "SELECT"),
    `${label}: missing native selects`,
  );
  for (const control of controls)
    within(control.height, 44, `${label}: ${control.name} height`);
}

async function assertInlineTitleError(page, label) {
  const title = page.locator('#editor [name="title"]');
  assert.equal(
    await title.getAttribute("aria-invalid"),
    "true",
    `${label}: title must be marked invalid`,
  );
  assert.equal(
    await title.evaluate((element) => element === document.activeElement),
    true,
    `${label}: title must receive focus`,
  );
  const result = await title.evaluate((element) => {
    const body = element.closest(".dialog-body").getBoundingClientRect();
    const titleBox = element.getBoundingClientRect();
    const descriptions = (element.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const error = descriptions.find(
      (node) => node.textContent.trim() && /название/i.test(node.textContent),
    );
    const errorBox = error?.getBoundingClientRect();
    return {
      text: error?.textContent.trim(),
      errorVisible:
        !!errorBox &&
        errorBox.width > 0 &&
        errorBox.height > 0 &&
        errorBox.top >= body.top - 1 &&
        errorBox.bottom <= body.bottom + 1,
      titleVisible:
        titleBox.top >= body.top - 1 && titleBox.bottom <= body.bottom + 1,
    };
  });
  assert.match(
    result.text || "",
    /название/i,
    `${label}: inline error must describe the title`,
  );
  assert.equal(
    result.errorVisible,
    true,
    `${label}: inline error must be visible without scrolling`,
  );
  assert.equal(
    result.titleVisible,
    true,
    `${label}: invalid title must be visible without scrolling`,
  );
}

async function dialogChecks(page, label) {
  await page.locator(".page-head [data-action=new]").click();
  await page.locator("#editor .dialog-body").waitFor();
  const initial = await dialogGeometry(page, `${label} opened`);
  await controlHeights(page, label);
  assert.ok(
    initial.bodyScrollRange > 0,
    `${label}: fixture must exercise body scrolling`,
  );
  await page.locator("#editor .dialog-body").evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  const bottom = await dialogGeometry(page, `${label} scrolled`);
  assert.ok(bottom.bodyScrollTop > 0, `${label}: body did not scroll`);
  for (const part of ["header", "actions"]) {
    within(
      bottom[part].top,
      initial[part].top,
      `${label}: ${part} moved while body scrolled`,
      1,
    );
    within(
      bottom[part].bottom,
      initial[part].bottom,
      `${label}: ${part} resized while body scrolled`,
      1,
    );
  }
  within(
    bottom.pageScrollY,
    initial.pageScrollY,
    `${label}: background moved`,
    1,
  );
  await page.locator("#task-form [type=submit]").click();
  await assertInlineTitleError(page, label);
  await dialogGeometry(page, `${label} blank submit`);
  await noOverflow(page, label);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#editor").evaluate((dialog) => dialog.open),
    false,
  );
}

async function taskAlignment(page, label) {
  const alignment = await page
    .locator(".task-row")
    .first()
    .evaluate((row) => {
      const title = row.querySelector(".task-title");
      const style = getComputedStyle(title);
      const box = title.getBoundingClientRect();
      const center = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      return {
        firstLine:
          box.top +
          parseFloat(style.borderTopWidth) +
          parseFloat(style.paddingTop) +
          parseFloat(style.lineHeight) / 2,
        checkbox: center(row.querySelector("[data-toggle]")),
        ellipsis: center(row.querySelector(":scope > .icon-button svg")),
        height: box.height,
        lineHeight: parseFloat(style.lineHeight),
      };
    });
  assert.ok(
    Number.isFinite(alignment.firstLine),
    `${label}: title needs an explicit line height`,
  );
  within(
    alignment.checkbox,
    alignment.firstLine,
    `${label}: checkbox first-line alignment`,
    3,
  );
  within(
    alignment.ellipsis,
    alignment.firstLine,
    `${label}: ellipsis first-line alignment`,
    3,
  );
  if (page.viewportSize().width <= 390)
    assert.ok(
      alignment.height > alignment.lineHeight,
      `${label}: long title must wrap`,
    );
}

async function homeChecks(page, url, label) {
  await page.goto(`${url}/#home`);
  await page.locator("#home-date").waitFor();
  const dateToday = await page.evaluate(() => {
    const date = document.querySelector("#home-date").getBoundingClientRect();
    const today = document
      .querySelector('[data-action="today"]')
      .getBoundingClientRect();
    return {
      dateHeight: date.height,
      dateCenter: date.top + date.height / 2,
      todayCenter: today.top + today.height / 2,
    };
  });
  within(dateToday.dateHeight, 44, `${label}: date height`);
  within(
    dateToday.todayCenter,
    dateToday.dateCenter,
    `${label}: date/Today baseline`,
    2,
  );
  for (const id of ["income-month", "income-year"]) {
    const control = page.locator(`#${id}`);
    assert.equal(
      await control.evaluate((element) => element.tagName),
      "SELECT",
      `${label}: ${id} must be a native select`,
    );
    const geometry = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = element.selectedOptions[0]?.textContent.trim() || "";
      return {
        text,
        height: element.getBoundingClientRect().height,
        fontSize: parseFloat(style.fontSize),
        textWidth: context.measureText(text).width,
        availableWidth:
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
      };
    });
    within(geometry.height, 44, `${label}: ${id} height`);
    assert.ok(geometry.fontSize >= 13, `${label}: ${id} text is too small`);
    assert.ok(
      geometry.textWidth <= geometry.availableWidth + 2,
      `${label}: ${id} selected label is clipped`,
    );
    assert.ok(
      geometry.text.length >= 4,
      `${label}: ${id} needs a readable label`,
    );
  }
  assert.equal(
    await page.locator('input[type="month"]').count(),
    0,
    `${label}: native month input remains`,
  );
  assert.equal(await page.locator("#income-year").inputValue(), "2026");
  assert.match(
    await page.locator("#income-month option:checked").innerText(),
    /октябр/i,
  );
  await noOverflow(page, `${label} home`);
}

async function filterChecks(page, label) {
  const toggle = page.locator('[data-action="toggle-filters"]');
  assert.equal(
    await toggle.count(),
    1,
    `${label}: filter toggle has not been implemented`,
  );
  const controls = ["#priority-filter", "#project-filter", "#deadline-filter"];
  if (page.viewportSize().width <= 390) {
    assert.equal(
      await toggle.isVisible(),
      true,
      `${label}: mobile filter toggle must be visible`,
    );
    assert.equal(
      await toggle.getAttribute("aria-expanded"),
      "false",
      `${label}: mobile filters must begin collapsed`,
    );
    for (const selector of controls)
      assert.equal(
        await page.locator(selector).isVisible(),
        false,
        `${label}: ${selector} should be collapsed`,
      );
    assert.equal(
      await page.locator("#task-search").isVisible(),
      true,
      `${label}: search must remain visible`,
    );
    await toggle.click();
    assert.equal(
      await toggle.getAttribute("aria-expanded"),
      "true",
      `${label}: expanded state not announced`,
    );
    for (const selector of controls) {
      assert.equal(
        await page.locator(selector).isVisible(),
        true,
        `${label}: ${selector} did not expand`,
      );
      within(
        (await page.locator(selector).boundingBox()).height,
        44,
        `${label}: ${selector} height`,
      );
    }
    await toggle.click();
    for (const selector of controls)
      assert.equal(
        await page.locator(selector).isVisible(),
        false,
        `${label}: ${selector} did not collapse`,
      );
  } else {
    for (const selector of controls)
      assert.equal(
        await page.locator(selector).isVisible(),
        true,
        `${label}: desktop ${selector} must be visible`,
      );
  }
  await noOverflow(page, `${label} filters`);
}

export async function layoutChecks(browser, url) {
  const context = await browser.newContext({
    viewport: viewports[0],
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await fixture(page, url);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const label = `${viewport.width}x${viewport.height}`;
      await homeChecks(page, url, label);
      await page.goto(`${url}/#tasks`);
      await page.locator(".task-title").waitFor();
      await filterChecks(page, label);
      await taskAlignment(page, label);
      await dialogChecks(page, label);
    }
    assert.deepEqual(errors, [], "layout checks generated page errors");
    return {
      result: "PASS",
      viewports,
      scenarios: [
        "fixed dialog header and actions before/after scrolling and blank submit",
        "dialog body owns scrolling",
        "focused invalid title and visible associated inline error",
        "44px native selects and inputs",
        "date/Today baseline",
        "task checkbox/title/ellipsis first-line alignment",
        "readable month/year selects",
        "collapsible mobile secondary filters",
        "no horizontal overflow",
      ],
    };
  } finally {
    await context.close();
  }
}

// Optional engine coverage uses only an already installed Playwright WebKit.
// This is WebKit engine coverage, never a claim that real Safari was tested.
export async function optionalWebkitLayoutChecks(url) {
  const executable = webkit.executablePath();
  try {
    await fs.access(executable);
  } catch {
    return {
      result: "SKIPPED",
      engine: "WebKit",
      reason: `Not installed: ${executable}. Safari was not tested.`,
    };
  }
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    return {
      result: "SKIPPED",
      engine: "WebKit",
      reason: `Installed engine could not launch: ${error.message}. Safari was not tested.`,
    };
  }
  try {
    return {
      engine: "WebKit",
      version: browser.version(),
      ...(await layoutChecks(browser, url)),
      note: "Engine coverage only; real Safari was not tested.",
    };
  } finally {
    await browser.close();
  }
}

// Run independently with `node tests/layout.mjs`, or pass an existing server URL.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let server;
  let browser;
  try {
    let url = process.argv[2];
    if (!url) {
      const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
      );
      server = http.createServer(async (request, response) => {
        try {
          const pathname = decodeURIComponent(
            new URL(request.url, "http://localhost").pathname,
          );
          const target = path.resolve(
            root,
            `.${pathname === "/" ? "/index.html" : pathname}`,
          );
          if (!target.startsWith(`${root}${path.sep}`))
            throw Error("Outside test root");
          const body = await fs.readFile(target);
          response.setHeader(
            "Content-Type",
            target.endsWith(".js")
              ? "text/javascript"
              : target.endsWith(".css")
                ? "text/css"
                : "text/html",
          );
          response.end(body);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${server.address().port}`;
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
    });
    console.log(
      JSON.stringify(
        {
          chromium: await layoutChecks(browser, url),
          webkit: await optionalWebkitLayoutChecks(url),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
