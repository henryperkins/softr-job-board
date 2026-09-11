import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { accounts } from "./synthetic-accounts.mjs";
const origin = `http://localhost:${process.env.SYNTHETIC_PORT ?? 8787}`;
const evidence = resolve(
  import.meta.dirname,
  "../../../../work/task-4-browser",
);
mkdirSync(evidence, { recursive: true });
test("rendered private routes are healthy at desktop and mobile widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push(message.text());
  });
  await login(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [name, url] of [
      ["dashboard", "/"],
      ["job-details", "/job-details?recordId=legacy-synthetic-job-01"],
      ["profile", "/profile?selected=synthetic-profile-a"],
      ["saved-details", "/saved-job-details?recordId=legacy-synthetic-save-a"],
      ["account", "/account"],
    ]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: "Loading" }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.locator("vite-error-overlay").count()).toBe(0);
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
      await page.screenshot({
        path: resolve(evidence, `${name}-${width}.png`),
        fullPage: false,
      });
    }
  }
  expect(errors).toEqual([]);
});
async function login(page: Page, index = 0) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(accounts[index].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts[index].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}
async function post(page: Page, path: string, data: unknown, method = "POST") {
  return page.request.fetch(path, {
    method,
    headers: { Origin: origin },
    data,
  });
}
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({
    "CF-Connecting-IP": `192.0.2.${10 + (info.testId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 200)}`,
  });
});
test("login presents real email/password controls", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "login-desktop.png"),
    fullPage: true,
  });
});
test("real login, filters, every stable job page, exact legacy details and duplicate saving", async ({
  page,
}) => {
  await login(page);
  await page.goto("/jobs");
  await expect(page).toHaveTitle("AI Jobs");
  const ids: string[] = [];
  do {
    await expect(page.locator(".job-card").first()).toBeVisible();
    ids.push(
      ...(await page
        .locator("[data-job-id]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-job-id")!),
        )),
    );
    if (
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .isDisabled()
    )
      break;
    const nextResponse = page.waitForResponse(
      (r) => r.url().includes("/api/jobs?") && r.status() === 200,
    );
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await nextResponse;
    await expect(page.locator(".job-card").first()).not.toHaveAttribute(
      "data-job-id",
      ids.at(-12)!,
    );
  } while (true);
  expect(ids).toHaveLength(32);
  expect(new Set(ids).size).toBe(32);
  await page.getByLabel("Workplace", { exact: true }).selectOption("Remote");
  await page
    .getByLabel("Employment type", { exact: true })
    .selectOption("Full-time");
  await page.getByLabel("Seniority", { exact: true }).selectOption("Senior");
  await page.getByLabel("Search title or company").fill("Example Research");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".job-card")).toHaveCount(11);
  await expect(page.locator(".job-card").first()).toContainText("Remote");
  await expect(page.locator(".job-card").first()).toContainText("Full-time");
  await page.screenshot({
    path: resolve(evidence, "jobs-desktop.png"),
    fullPage: true,
  });
  await page.goto("/job-details?recordId=legacy-synthetic-job-01");
  await expect(
    page.getByRole("heading", { name: "Senior AI Engineer", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".prose-text")).toContainText(
    "<script>This source text is inert.</script>",
  );
  await expect(
    page.getByRole("link", { name: "View application on source site" }),
  ).toHaveAttribute("href", "https://example.test/jobs/1");
  const r1 = await post(page, "/api/saved-jobs", { jobId: "synthetic-job-32" }),
    r2 = await post(page, "/api/saved-jobs", {
      jobId: "legacy-synthetic-job-32",
    });
  expect(r1.ok()).toBeTruthy();
  const s = await r1.json();
  expect((await r2.json()).id).toBe(s.id);
  await page.goto("/jobs/synthetic-job-32");
  await expect(
    page.getByRole("link", { name: "Open saved job" }),
  ).toHaveAttribute("href", "/saved-jobs/" + s.id);
  const missing = await page.request.get("/job-details?recordId=absent");
  expect(missing.status()).toBe(404);
});
test("jobs loading, empty and failure states provide retry", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/jobs?**", async (route) => {
    await blocked;
    await route.continue();
  });
  await page.goto("/jobs");
  await expect(page.getByRole("status")).toContainText("Loading");
  release();
  await expect(page.locator(".job-card").first()).toBeVisible();
  await page.unroute("**/api/jobs?**");
  await page
    .getByLabel("Search title or company")
    .fill("no-such-synthetic-role");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No jobs match those filters yet." }),
  ).toBeVisible();
  await page.route("**/api/jobs?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"error":"synthetic_failure"}',
    }),
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/jobs?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".job-card").first()).toBeVisible();
});
test("profile persists across reload and a second session, explicit activation, upload and stale text retention", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/profile");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  const name = "Browser profile " + Date.now();
  await page.getByLabel("Full name / profile name").fill(name);
  await page
    .getByLabel("Summary", { exact: true })
    .fill("Committed in real D1");
  await page.getByLabel("Location", { exact: true }).fill("Synthetic City");
  await page.getByLabel("Skills (one per line)").fill("TypeScript\nSQL");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose as active" }).click();
  await expect(
    page.getByText("Active profile chosen.", { exact: true }),
  ).toBeVisible();
  const profiles = await (await page.request.get("/api/profiles")).json();
  const p = profiles.items.find((x: { name: string }) => x.name === name);
  await page.goto("/profile?selected=" + p.id);
  await expect(
    page.getByText("Committed in real D1", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.41" },
  });
  const other = await context.newPage();
  await login(other);
  await other.goto("/profile?selected=" + p.id);
  await expect(
    other.getByText("Committed in real D1", { exact: true }),
  ).toBeVisible();
  await expect(
    other.getByText("Active profile: " + name, { exact: true }),
  ).toBeVisible();
  await page.bringToFront();
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Summary", exact: true })
    .fill("Unsaved conflict text");
  const newer = await post(
    other,
    "/api/profiles/" + p.id,
    { expectedRevision: 1, content: { summary: "Updated elsewhere" } },
    "PATCH",
  );
  expect(newer.status()).toBe(200);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("another session");
  await expect(page.getByLabel("Summary", { exact: true })).toHaveValue(
    "Unsaved conflict text",
  );
  await page.goto("/profile?selected=" + p.id);
  await page.getByLabel("Choose a profile file").setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n" + "synthetic ".repeat(40000)),
  });
  await page.getByRole("button", { name: "Upload private file" }).click();
  await expect(
    page.getByText("Pending security scan — download unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("synthetic.pdf", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Archive profile", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore profile", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore profile", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit profile", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "profile-desktop.png"),
    fullPage: true,
  });
  await context.close();
});
test("saved details, keyboard status, stale draft preservation, approval and history", async ({
  page,
}) => {
  await login(page);
  await page.goto("/saved-job-details?recordId=legacy-synthetic-save-a");
  await expect(
    page.getByRole("heading", { name: "Senior AI Engineer", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Notes", { exact: true }).fill("Persisted notes");
  await page.getByLabel("Priority", { exact: true }).selectOption("High");
  await page.getByLabel("Outcome notes").fill("Awaiting response");
  await page
    .getByLabel("Submission URL")
    .fill("https://example.test/submission/1");
  await page.getByRole("button", { name: "Save job details" }).click();
  await expect(
    page.getByText("Saved job updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Persisted notes",
  );
  await expect(
    page.getByRole("heading", { name: "Review draft", exact: true }),
  ).toBeVisible();
  const d = await (
    await page.request.get("/api/drafts/synthetic-draft-a")
  ).json();
  const original = await page.getByLabel("Cover letter").inputValue();
  await page.getByLabel("Cover letter").fill("Stale browser text");
  const changed = await post(
    page,
    "/api/drafts/" + d.id,
    {
      expectedRevision: d.revision,
      coverLetter: "Committed separately " + Date.now(),
    },
    "PATCH",
  );
  expect(changed.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save draft edits" }).click();
  await expect(page.getByRole("alert")).toContainText("another session");
  await expect(page.getByLabel("Cover letter")).toHaveValue(
    "Stale browser text",
  );
  await page.reload();
  await expect(page.getByLabel("Cover letter")).not.toHaveValue(original);
  await page
    .getByLabel("Cover letter")
    .fill("Approved from browser " + Date.now());
  await page.getByRole("button", { name: "Save draft edits" }).click();
  await expect(
    page.getByText("Draft edits saved as a new revision.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve this revision" }).click();
  await expect(
    page.getByText("Draft explicitly approved. No application was submitted.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("summary").first()).toContainText("Approved");
  await page.goto("/");
  const control = page.getByLabel("Status for Senior AI Engineer");
  await control.focus();
  await page.keyboard.press("End");
  await expect(
    page
      .locator(".saved-card")
      .filter({ hasText: "Senior AI Engineer" })
      .getByRole("button", { name: "Update status" }),
  ).toBeEnabled();
  const chosen = await control.inputValue();
  await control.press("Tab");
  await expect(
    page
      .locator(".saved-card")
      .filter({ hasText: "Senior AI Engineer" })
      .getByRole("button", { name: "Update status" }),
  ).toBeFocused();
  const mutation = page.waitForResponse(
    (r) =>
      r.url().includes("/api/saved-jobs/") && r.request().method() === "PATCH",
  );
  await page.keyboard.press("Enter");
  expect((await mutation).status()).toBe(200);
  await expect(
    page
      .locator(".saved-card")
      .filter({ hasText: "Senior AI Engineer" })
      .getByLabel("Status for Senior AI Engineer"),
  ).toHaveValue(chosen);
  await page.reload();
  await expect(page.getByLabel("Status for Senior AI Engineer")).toHaveValue(
    chosen,
  );
  await page.screenshot({
    path: resolve(evidence, "dashboard-desktop.png"),
    fullPage: true,
  });
});
test("second owner is isolated, mobile has no overflow, logout/back masks private content", async ({
  page,
  context,
}) => {
  await login(page, 1);
  const denied = await page.request.get("/api/saved-jobs/synthetic-save-a");
  expect(denied.status()).toBe(404);
  const profiles = await (await page.request.get("/api/profiles")).json();
  expect(
    profiles.items.every((p: { id: string }) => p.id !== "synthetic-profile-a"),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jobs");
  await expect(page.locator(".job-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.screenshot({
    path: resolve(evidence, "jobs-mobile.png"),
    fullPage: true,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect(await page.locator(".job-card").count()).toBe(0);
  expect(errors).toEqual([]);
  expect(
    (await context.cookies()).filter((c) => c.name.includes("session_token")),
  ).toHaveLength(0);
});
test("mail unavailable is honest, unsafe next redirects stay local and expired links are explicit", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("absent@example.test");
  await page.getByRole("button", { name: "Request reset link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Email is currently unavailable",
  );
  await expect(page.getByText("Email sent!", { exact: true })).toHaveCount(0);
  await page.goto("/reset-password?error=INVALID_TOKEN");
  await expect(
    page.getByRole("heading", { name: "This link is unavailable" }),
  ).toBeVisible();
  await page.goto("/login?next-page=//evil.example");
  await page.getByLabel("Email address").fill(accounts[0].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
});
test("onboarding is persistent and account password change revokes the second session", async ({
  page,
  browser,
}) => {
  await login(page, 1);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await page
    .getByLabel("Full name / profile name")
    .fill("Second candidate profile");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Second candidate profile/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Second candidate profile/ }).click();
  await page.getByRole("button", { name: "Choose as active" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Your job search" }),
  ).toBeVisible();
  const second = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.52" },
  });
  const other = await second.newPage();
  await login(other, 1);
  await other.goto("/profile");
  await expect(
    other.getByText("Active profile: Second candidate profile", {
      exact: true,
    }),
  ).toBeVisible();
  await page.bringToFront();
  await page.goto("/account");
  await page.getByLabel("Account name").fill("Synthetic name updated");
  await page.getByRole("button", { name: "Save account name" }).click();
  await expect(
    page.getByText("Account name saved.", { exact: true }),
  ).toBeVisible();
  const temporary = "Synthetic-new-password-123!";
  await page.getByLabel("Current password").fill(accounts[1].password);
  await page.getByLabel("New password").fill(temporary);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByText("Password changed and your other sessions were revoked.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await other.request.get("/api/session")).status()).toBe(401);
  const oldLogin = await other.request.post("/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email: accounts[1].email, password: accounts[1].password },
  });
  expect(oldLogin.status()).toBe(401);
  await page.getByLabel("Current password").fill(temporary);
  await page.getByLabel("New password").fill(accounts[1].password);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByText("Password changed and your other sessions were revoked.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Account name")).toHaveValue(
    "Synthetic name updated",
  );
  await second.close();
});
