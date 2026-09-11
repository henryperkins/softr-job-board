import { test, expect, type Page } from "@playwright/test";
import { accounts } from "./synthetic-accounts.mjs";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(accounts[0].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}
async function heartbeat(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({
    "CF-Connecting-IP": `192.0.2.${50 + info.testId.length}`,
  });
});
test("session revalidation retains unsaved profile and draft values after 503, network failure and recovery", async ({
  page,
}) => {
  await login(page);
  await page.goto("/profile?selected=synthetic-profile-a");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByLabel("Summary", { exact: true })
    .fill("Unsaved profile during outage");
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "Temporary gateway failure",
    }),
  );
  await heartbeat(page);
  await expect(page.getByRole("alert")).toContainText(
    "could not verify your session",
  );
  await expect(page.getByLabel("Summary", { exact: true })).toHaveValue(
    "Unsaved profile during outage",
  );
  await expect(page).toHaveURL(/\/profile\?selected=/);
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "Retry session check" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Summary", { exact: true })).toHaveValue(
    "Unsaved profile during outage",
  );
  await page.goto("/saved-jobs/synthetic-save-a");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Unsaved saved-job notes");
  await page.getByLabel("Cover letter").fill("Unsaved cover letter");
  await page.route("**/api/session", (route) => route.abort("failed"));
  await heartbeat(page);
  await expect(page.getByRole("alert")).toContainText(
    "could not verify your session",
  );
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Unsaved saved-job notes",
  );
  await expect(page.getByLabel("Cover letter")).toHaveValue(
    "Unsaved cover letter",
  );
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "Retry session check" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Cover letter")).toHaveValue(
    "Unsaved cover letter",
  );
});
test("confirmed revoked 401 still removes unsaved private content and redirects", async ({
  page,
  baseURL,
}) => {
  await login(page);
  await page.goto("/profile?selected=synthetic-profile-a");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByLabel("Summary", { exact: true })
    .fill("Private unsaved sentinel");
  const response = await page.request.post("/auth/sign-out", {
    headers: { Origin: baseURL! },
    data: {},
  });
  expect(response.status()).toBe(200);
  const check = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.status() === 401,
  );
  await heartbeat(page);
  await check;
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Summary", { exact: true })).toHaveCount(0);
  await expect(page.locator("#root")).not.toContainText(
    "Private unsaved sentinel",
  );
});
test("canonical job and saved path IDs override conflicting legacy recordId query values", async ({
  page,
  baseURL,
}) => {
  await login(page);
  await page.goto("/jobs/synthetic-job-01?recordId=synthetic-job-02");
  await expect(
    page.getByRole("heading", { name: "Senior AI Engineer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View application on source site" }),
  ).toHaveAttribute("href", "https://example.test/jobs/1");
  const otherResponse = await page.request.post("/api/saved-jobs", {
    headers: { Origin: baseURL! },
    data: { jobId: "synthetic-job-02" },
  });
  expect(otherResponse.status()).toBe(200);
  const other = await otherResponse.json();
  await page.goto("/saved-jobs/synthetic-save-a?recordId=" + other.id);
  await expect(
    page.getByRole("heading", { name: "Senior AI Engineer", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Only canonical save changes");
  await page.getByRole("button", { name: "Save job details" }).click();
  await expect(
    page.getByText("Saved job updated.", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/saved-jobs/synthetic-save-a")).json())
      .notes,
  ).toBe("Only canonical save changes");
  expect(
    (await (await page.request.get("/api/saved-jobs/" + other.id)).json())
      .notes,
  ).toBeNull();
  await page.goto("/job-details?recordId=legacy-synthetic-job-02");
  await expect(
    page.getByRole("heading", { name: "AI Platform Engineer 2", exact: true }),
  ).toBeVisible();
  await page.goto("/saved-job-details?recordId=legacy-synthetic-save-a");
  await expect(
    page.getByRole("heading", { name: "Senior AI Engineer", exact: true }),
  ).toBeVisible();
});
