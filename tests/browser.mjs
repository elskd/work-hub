import { layoutChecks, optionalWebkitLayoutChecks } from "./layout.mjs";
import { extendedChecks } from "./integration.mjs";
import http from "node:http";
import path from "node:path";
const server = http.createServer(async (req, res) => {
  try {
    const target = path.join(
      process.cwd(),
      decodeURIComponent(req.url.split("?")[0]) === "/"
        ? "index.html"
        : decodeURIComponent(req.url.split("?")[0]),
    );
    const body = await fs.readFile(target);
    res.setHeader(
      "Content-Type",
      target.endsWith(".js")
        ? "text/javascript"
        : target.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(4173, "127.0.0.1", r));
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/chromium"),
  headless: true,
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await fs.mkdir("test-results", { recursive: true });
const url = "http://127.0.0.1:4173",
  key = "workhub.stage1.v1";
const snap = async () =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const overflow = async (label) =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    label,
  );
await page.clock.setFixedTime(new Date("2026-10-12T12:00:00Z"));
await page.goto(url);
await page.locator("h1").waitFor();
for (const width of [320, 390, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 1000 });
  await overflow("empty " + width);
  await page.screenshot({
    style: ".toast{visibility:hidden}",
    path: `test-results/empty-${width}.png`,
    fullPage: true,
  });
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.locator(".page-head [data-action=new]").click();
await page.locator("#task-form [type=submit]").click();
assert.match(await page.locator("#form-error").innerText(), /название/);
const title =
  "Подготовить подробную структуру многостраничного сайта и согласовать все разделы с заказчиком — проверка длинного русского названия";
await page.locator("[name=title]").fill(title);
await page.locator("[name=plannedDate]").fill("2026-10-12");
await page.locator("[name=deadline]").fill("2026-10-13");
await page.locator("[name=start]").fill("10:00");
await page.locator("[name=end]").fill("09:00");
await page.locator("#task-form [type=submit]").click();
assert.match(await page.locator("#form-error").innerText(), /позже/);
await page.locator("[name=end]").fill("11:30");
await page.locator("[name=frequency]").selectOption("daily");
await page.locator("[data-action=add-sub]").click();
await page
  .getByRole("textbox", { name: "Название подзадачи" })
  .fill("Собрать черновик");
await page.locator("#task-form [type=submit]").click();
await page.waitForFunction(() => !document.querySelector("#editor").open);
assert.equal((await snap()).tasks.length, 1);
await page.reload();
await page.locator(".task-title").first().waitFor();
assert.equal((await snap()).tasks[0].title, title);
await page.locator(".task-title").first().click();
await page.locator("[name=priority]").selectOption("high");
await page.locator('[aria-label="Подзадача выполнена"]').check();
await page.locator("#task-form [type=submit]").click();
await page.waitForFunction(() => !document.querySelector("#editor").open);
assert.equal((await snap()).tasks[0].priority, "high");
await page.locator("[data-toggle]").first().check();
await page.waitForFunction(
  (k) => JSON.parse(localStorage.getItem(k)).tasks.length === 2,
  key,
);
await page.reload();
assert.equal((await snap()).tasks.length, 2);
await page.locator("[data-toggle]").first().uncheck();
await page.locator("[data-toggle]").first().check();
assert.equal((await snap()).tasks.length, 2);
for (const width of [320, 390, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  for (const route of ["home", "tasks", "settings", "design", "assistant"]) {
    await page.goto(url + "/#" + route);
    await page.locator("h1").waitFor();
    await overflow(route + " " + width);
    await page.screenshot({
      style: ".toast{visibility:hidden}",
      path: `test-results/${route}-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto(url + "/#tasks");
  await page.locator(".page-head [data-action=new]").click();
  await page.locator("[name=title]").fill(title);
  await page.locator("#task-form [type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  await page.locator(".page-head [data-action=new]").click();
  await page.locator("#task-form [type=submit]").click();
  await overflow("modal " + width);
  assert.equal(
    await page
      .locator("#editor")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
    false,
  );
  await page.screenshot({
    style: ".toast{visibility:hidden}",
    path: `test-results/modal-${width}.png`,
  });
  await page.keyboard.press("Escape");
  if (width < 600) {
    await page.locator("[data-action=more]").click();
    await overflow("menu " + width);
    assert.equal(await page.locator("#more-nav a").count(), 11);
    await page.screenshot({
      style: ".toast{visibility:hidden}",
      path: `test-results/menu-${width}.png`,
    });
    await page.keyboard.press("Escape");
  }
}
await page.setViewportSize({ width: 390, height: 900 });
await page.goto(url + "/#settings");
for (const theme of ["dark", "light", "system"]) {
  await page.locator("[data-setting=theme]").selectOption(theme);
  for (const accent of ["black", "wine", "green"]) {
    await page.locator("[data-setting=accent]").selectOption(accent);
    await overflow(theme + accent);
    await page.screenshot({
      style: ".toast{visibility:hidden}",
      path: `test-results/theme-${theme}-${accent}.png`,
      fullPage: true,
    });
  }
}
await page.goto(url + "/#tasks");
await page.locator(".task-title").first().click();
await page.locator("[data-archive]").click();
await page.waitForFunction(() => !document.querySelector("#editor").open);
await page.locator("[data-view=archived]").click();
assert.equal(await page.locator(".task-title").count(), 1);
await page.locator(".task-title").first().click();
await page.locator("[data-delete]").click();
await page.waitForFunction(() => !document.querySelector("#editor").open);
assert.equal(await page.locator(".task-title").count(), 0);
await page.locator(".page-head [data-action=new]").click();
await page.locator("[name=title]").fill("Не потерять при ошибке");
await page.evaluate(() => {
  Storage.prototype.setItem = function () {
    throw Error("QuotaExceededError");
  };
});
await page.locator("#task-form [type=submit]").click();
await page.waitForFunction(() =>
  document
    .querySelector("#form-error")
    .textContent.includes("Не удалось сохранить"),
);
assert.match(
  await page.locator("#form-error").innerText(),
  /Не удалось сохранить/,
);
assert.equal(
  await page.locator("[name=title]").inputValue(),
  "Не потерять при ошибке",
);
await page.reload();
// An isolated context verifies corrupt records are not overwritten.
const bad = await browser.newContext();
const p = await bad.newPage();
await p.goto(url);
await p.evaluate((k) => localStorage.setItem(k, "{broken"), key);
await p.reload();
await p.getByRole("alert").waitFor();
assert.equal(await p.evaluate((k) => localStorage.getItem(k), key), "{broken");
await bad.close();
const extended = await extendedChecks(browser, url);
const layout = await layoutChecks(browser, url);
const webkit = await optionalWebkitLayoutChecks(url);
assert.deepEqual(errors, []);
await fs.writeFile(
  "test-results/result.json",
  JSON.stringify(
    {
      browser: await browser.version(),
      widths: [320, 390, 768, 1024, 1440],
      pageErrors: errors,
      result: "PASS",
      extended,
      layout,
      webkit,
      scenarios: [
        "create",
        "edit",
        "subtasks",
        "complete",
        "reopen",
        "repeat idempotence",
        "reload",
        "archive",
        "delete",
        "validation",
        "quota error retention",
        "corrupt data protection",
        "all navigation",
        "light/dark/system and accents",
        "page and modal overflow",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "PASS browser scenarios, 5 widths, themes, menus, dialogs, persistence and failure states.",
);
await browser.close();
server.close();
