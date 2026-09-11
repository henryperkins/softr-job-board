import { test, expect } from "@playwright/test";
import { accounts } from "./synthetic-accounts.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const evidence = resolve(
  import.meta.dirname,
  "../../../../work/task-6-browser",
);
test("first-generation queued draft saves edits and retains them after reload", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.SYNTHETIC_GENERATION !== "true",
    "Requires isolated request harness; no provider execution.",
  );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(accounts[0].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  const savedResponse = await page.request.post("/api/saved-jobs", {
    headers: { Origin: baseURL! },
    data: { jobId: "synthetic-job-02" },
  });
  expect(savedResponse.ok()).toBe(true);
  const saved = (await savedResponse.json()) as { id: string };
  await page.goto("/saved-job-details?recordId=" + saved.id);
  await expect(
    page.getByText("No draft is attached to this saved job."),
  ).toBeVisible();
  await page
    .getByLabel("Profile and immutable version")
    .selectOption("synthetic-profile-version-a");
  await page
    .getByRole("button", { name: "Request draft", exact: true })
    .click();
  await expect(
    page.getByText("Generation: queued", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Cover letter", { exact: true })
    .fill("My first draft edit while queued");
  await expect(
    page.getByRole("button", { name: "Approve this revision", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save draft edits", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save draft edits", exact: true })
    .click();
  await expect(
    page.getByText("Draft edits saved as a new revision.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Cover letter", { exact: true })).toHaveValue(
    "My first draft edit while queued",
  );
  await expect(
    page.getByText("Generation: queued", { exact: true }),
  ).toBeVisible();
  const options = (await (
    await page.request.get("/api/saved-jobs/" + saved.id + "/generation")
  ).json()) as { requests: { draftId: string; expectedRevision: number }[] };
  const draft = (await (
    await page.request.get("/api/drafts/" + options.requests[0].draftId)
  ).json()) as {
    revision: number;
    approvedRevision: number | null;
    executionStatus: string;
  };
  expect(options.requests[0].expectedRevision).toBe(1);
  expect(draft.revision).toBe(2);
  expect(draft.executionStatus).toBe("cancelled");
  expect(draft.approvedRevision).toBeNull();
});
test("queued generation persists while saved and draft edits survive status updates and conflicts", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.SYNTHETIC_GENERATION !== "true",
    "Requires isolated opt-in generation request harness; no provider execution.",
  );
  mkdirSync(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("Email address").fill(accounts[0].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  const original = await (
    await page.request.get("/api/saved-jobs/synthetic-save-a")
  ).json();
  await page.request.patch("/api/saved-jobs/synthetic-save-a", {
    headers: { Origin: baseURL! },
    data: { expectedRevision: original.revision, status: "Saved" },
  });
  await page.goto("/saved-job-details?recordId=legacy-synthetic-save-a");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Typed notes retained during generation");
  await page
    .getByLabel("Cover letter", { exact: true })
    .fill("My unsaved cover letter");
  await page
    .getByLabel("Profile and immutable version")
    .selectOption("synthetic-profile-version-a");
  await page.getByRole("button", { name: "Regenerate selected draft" }).click();
  await expect(
    page.getByText("Generation: queued", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Cover letter", { exact: true })).toHaveValue(
    "My unsaved cover letter",
  );
  await page
    .getByRole("button", { name: "Save job details", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "unsaved text is preserved",
  );
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Typed notes retained during generation",
  );
  await page
    .getByRole("button", { name: "Refresh details, keep my edits" })
    .click();
  await expect(
    page.getByText("Latest saved details loaded.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Typed notes retained during generation",
  );
  await page
    .getByRole("button", { name: "Save job details", exact: true })
    .click();
  await expect(
    page.getByText("Saved job updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Generation: queued", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Typed notes retained during generation",
  );
  await page
    .getByLabel("Cover letter", { exact: true })
    .fill("Text retained during a synthetic failed status");
  // UI-only failure transport fixture. Actual API acceptance and persistence above used native local D1.
  await page.route("**/api/saved-jobs/*/generation", async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    for (const request of body.requests) {
      request.state = "failed";
      request.failureCode = "provider_acceptance_unknown";
    }
    await route.fulfill({ response, json: body });
  });
  await expect(
    page.getByText("Provider acceptance is unknown.", { exact: false }),
  ).toBeVisible({ timeout: 12000 });
  await expect(page.getByLabel("Cover letter", { exact: true })).toHaveValue(
    "Text retained during a synthetic failed status",
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(evidence, "generation-" + width + ".png"),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
