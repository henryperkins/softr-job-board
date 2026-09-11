import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { sourceFixture } from "../fixtures/source.mjs";
import { openLocalMigration } from "../../scripts/migration/local-runtime.ts";
import {
  copyToPrivateR2,
  reconcile,
} from "../../scripts/migration/reconcile.ts";
import { importRecords } from "../../scripts/migration/import-d1.ts";
import { mapRecords } from "../../scripts/migration/map-records.ts";
import { recordHash } from "../../scripts/migration/validate-export.ts";

test("local D1/R2 rehearsal detects missing and corrupt bytes and resumes without activating users", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "job-board-synthetic-"));
  const source = sourceFixture();
  const bytes = Buffer.from("%PDF-1.4 synthetic migration fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  source.tables[1].fields.push({
    id: "resume",
    name: "Resume",
    type: "ATTACHMENT",
  });
  source.tables[1].records[0].fields.resume = [
    {
      id: "file-a",
      filename: "resume.pdf",
      type: "application/pdf",
      size: bytes.length,
      url: "https://source.example.test/private-signed-url",
    },
  ];
  const referenceId = recordHash([
    "profiles",
    "profile-a",
    "resume",
    "file-a",
    0,
  ]);
  const files = {
    sourceHash: recordHash(source),
    createdAt: new Date().toISOString(),
    scanner: "not-configured",
    attachments: [
      {
        referenceId,
        tableId: "profiles",
        recordId: "profile-a",
        fieldId: "resume",
        attachmentId: "file-a",
        ownerIds: ["user-a"],
        declaredSize: bytes.length,
        declaredType: "application/pdf",
        state: "downloaded-quarantined",
        sha256,
        bytes: bytes.length,
        detectedType: "application/pdf",
        sizeMatches: true,
        typeMatches: true,
        objectFile: "attachments/" + sha256 + ".bin",
      },
    ],
  };
  await mkdir(path.join(directory, "attachments"));
  await writeFile(path.join(directory, files.attachments[0].objectFile), bytes);
  const runtime = await openLocalMigration(path.join(directory, "target"));
  try {
    assert.equal(
      (await importRecords(runtime.db, source, files)).state,
      "rehearsed",
    );
    assert.ok(
      (await reconcile(runtime.db, runtime.files, source, files)).issues.some(
        (issue) => issue.code === "R2_OBJECT_MISSING",
      ),
    );
    assert.equal(
      (await copyToPrivateR2(runtime.files, source, files, directory)).copied,
      1,
    );
    const verified = await reconcile(runtime.db, runtime.files, source, files);
    assert.equal(verified.structurallyReconciled, true);
    assert.equal(verified.releaseReady, false);
    source.tables[1].records[0].updatedAt = "2026-09-11T12:00:00Z";
    files.sourceHash = recordHash(source);
    assert.equal(
      (await importRecords(runtime.db, source, files)).state,
      "rehearsed",
    );
    assert.equal(
      (
        await runtime.db
          .prepare("SELECT source_updated_at FROM attachments")
          .first()
      ).source_updated_at,
      source.tables[1].records[0].updatedAt,
    );
    assert.equal(
      (await reconcile(runtime.db, runtime.files, source, files))
        .structurallyReconciled,
      true,
    );
    const key = mapRecords(source, files).attachments[0].core.object_key;
    await runtime.files.put(key, Buffer.alloc(bytes.length));
    assert.ok(
      (await reconcile(runtime.db, runtime.files, source, files)).issues.some(
        (issue) => issue.code === "R2_CHECKSUM_MISMATCH",
      ),
    );
    assert.equal(
      (await copyToPrivateR2(runtime.files, source, files, directory)).copied,
      1,
    );
    assert.equal((await importRecords(runtime.db, source, files)).changed, 0);
    assert.equal(
      (
        await runtime.db
          .prepare("SELECT COUNT(*) AS n FROM auth_identities")
          .first()
      ).n,
      0,
    );
  } finally {
    await runtime.dispose();
  }
});
