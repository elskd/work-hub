import assert from "node:assert/strict";
export async function extendedChecks(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00Z"));
  await page.goto(url);
  const key = "workhub.stage1.v1";
  await page.evaluate(async () => {
    const { emptyState } = await import("/src/domain.js");
    const s = emptyState();
    s.projects = [
      {
        id: "qa-project",
        title:
          "Тестовый проект — очень длинное название для проверки связей и аккуратных переносов",
        clientName: "Проверочный клиент",
        stage: "Прототип",
        status: "active",
        deadline: "2026-10-14",
      },
    ];
    s.payments = [
      {
        id: "qa-receipt",
        projectId: "qa-project",
        status: "received",
        receivedDate: "2026-10-12",
        amountKopecks: 6000000,
      },
      {
        id: "qa-expected",
        projectId: "qa-project",
        status: "expected",
        receivedDate: "2026-10-12",
        amountKopecks: 9000000,
      },
      {
        id: "qa-previous",
        projectId: "qa-project",
        status: "received",
        receivedDate: "2026-09-30",
        amountKopecks: 1000000,
      },
    ];
    localStorage.setItem("workhub.stage1.v1", JSON.stringify(s));
  });
  await page.reload();
  assert.match(await page.locator(".money-total").innerText(), /60\s?000/);
  assert.match(
    await page.locator("[data-section=deadlines]").innerText(),
    /Тестовый проект/,
  );
  await page.locator("#income-month").fill("2026-09");
  await page.locator("#income-month").dispatchEvent("change");
  assert.match(await page.locator(".money-total").innerText(), /10\s?000/);
  await page.goto(url + "/#tasks");
  await page.locator(".page-head [data-action=new]").click();
  await page.locator("[name=title]").fill("Проверка связи с проектом");
  await page.locator("[name=projectId]").selectOption("qa-project");
  await page.locator("[name=plannedDate]").fill("2026-10-12");
  await page.locator("[name=deadline]").fill("2026-10-15");
  await page.locator("[name=start]").fill("10:00");
  await page.locator("[name=end]").fill("11:00");
  await page.locator("#task-form [type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  await page.reload();
  assert.match(await page.locator(".task-meta").innerText(), /Тестовый проект/);
  await page.locator("#project-filter").selectOption("none");
  assert.equal(await page.locator(".task-title").count(), 0);
  await page.locator("#project-filter").selectOption("qa-project");
  assert.equal(await page.locator(".task-title").count(), 1);
  await page.locator(".task-title").click();
  await page.locator("[name=plannedDate]").fill("2026-10-13");
  await page.locator("[name=frequency]").selectOption("daily");
  await page.locator("#task-form [type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  let s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  assert.equal(s.tasks[0].deadline, "2026-10-15");
  const first = s.tasks[0].id;
  await page.locator(`[data-toggle="${first}"]`).click();
  await page.waitForFunction(
    (k) => JSON.parse(localStorage.getItem(k)).tasks.length === 2,
    key,
  );
  s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  const next = s.tasks.find((t) => t.id !== first);
  assert.equal(next.plannedDate, "2026-10-14");
  assert.equal(next.projectId, "qa-project");
  await page.locator(".task-title").click();
  await page.locator("[name=title]").fill("Новое название всей серии");
  await page.locator("[name=scope]").selectOption("future");
  await page.locator("#task-form [type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#editor").open);
  await page.locator(`[data-toggle="${next.id}"]`).click();
  await page.waitForFunction(
    (k) => JSON.parse(localStorage.getItem(k)).tasks.length === 3,
    key,
  );
  s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  assert.equal(s.tasks[2].title, "Новое название всей серии");
  // Existing interval warns without discarding either task's input.
  await page.locator(".page-head [data-action=new]").click();
  await page.locator("[name=title]").fill("Пересекающийся интервал");
  await page.locator("[name=plannedDate]").fill(s.tasks[2].plannedDate);
  await page.locator("[name=start]").fill("10:30");
  await page.locator("[name=end]").fill("11:30");
  await page.locator("[name=end]").blur();
  assert.match(
    await page.locator("#overlap-warning").innerText(),
    /Пересечение/,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#editor").evaluate((e) => e.open), false);
  // Browser history leaves no orphaned modal. Keyboard focus is returned to the page.
  await page.goto(url + "/#home");
  await page.goto(url + "/#tasks");
  await page.locator(".page-head [data-action=new]").click();
  await page.goBack();
  assert.equal(await page.locator("#editor").evaluate((e) => e.open), false);
  await page.goForward();
  const second = await context.newPage();
  await second.goto(url + "/#settings");
  await page.locator(".page-head [data-action=new]").click();
  await page.locator("[name=title]").fill("Черновик при конфликте вкладок");
  await second.locator("[data-setting=accent]").selectOption("wine");
  await page.locator("#task-form [type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#form-error")
      .textContent.includes("другой вкладке"),
  );
  assert.match(await page.locator("#form-error").innerText(), /другой вкладке/);
  assert.equal(
    await page.locator("[name=title]").inputValue(),
    "Черновик при конфликте вкладок",
  );
  await page.keyboard.press("Escape");
  await context.close();
  return [
    "project association and filter",
    "project deadlines",
    "receipt month boundaries",
    "enable repeat on an existing task",
    "future-series edit",
    "schedule does not alter deadline",
    "overlap warning",
    "Escape and Back/Forward modal cleanup",
    "cross-tab stale write preserves draft",
  ];
}
