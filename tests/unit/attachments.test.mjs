import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyAttachments } from "../../scripts/migration/copy-attachments.ts";
const bytes = Buffer.from("%PDF-1.4\nsynthetic test only\n%%EOF");
test("a checkpoint left by a terminated copy process can resume", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  await writeFile(
    path.join(directory, "attachment-copy.lock"),
    JSON.stringify({ pid: 2147483647 }),
  );
  const report = await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async () => new Response(bytes),
  });
  assert.equal(report.attachments.length, 2);
  assert.equal(
    report.attachments.every((a) => a.state === "downloaded-quarantined"),
    true,
  );
});
function source() {
  return {
    schemaVersion: 1,
    tables: [
      {
        id: "profiles",
        name: "Candidate Profile",
        fields: [
          { id: "owner", name: "Owner", type: "LINKED_RECORD" },
          { id: "resume", name: "Resume File", type: "ATTACHMENT" },
        ],
        records: [
          {
            id: "p-a",
            fields: {
              owner: { id: "a" },
              resume: {
                id: "f-a",
                url: "https://files.example.test/a",
                type: "application/pdf",
                size: bytes.length,
              },
            },
          },
          {
            id: "p-b",
            fields: {
              owner: { id: "b" },
              resume: {
                id: "f-b",
                url: "https://files.example.test/b",
                type: "application/pdf",
                size: bytes.length,
              },
            },
          },
        ],
      },
    ],
  };
}
test("copies real bytes with owner-specific references and immutable hashes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  const result = await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async () => new Response(bytes),
  });
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].ownerIds[0], "a");
  assert.equal(result.attachments[1].ownerIds[0], "b");
  assert.equal(result.attachments[0].sha256, result.attachments[1].sha256);
  assert.equal(result.attachments[0].state, "downloaded-quarantined");
  assert.deepEqual(
    await readFile(path.join(directory, result.attachments[0].objectFile)),
    bytes,
  );
});
test("a source URL cannot redirect the downloader or contact an unapproved host", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  const input = source();
  input.tables[0].records[1].fields.resume.url = "https://evil.example/a";
  let calls = 0;
  const result = await copyAttachments(input, {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async (url, options) => {
      calls++;
      assert.equal(options.redirect, "error");
      return new Response(bytes);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.attachments[1].reason, "UNAPPROVED_ORIGIN");
});
test("interrupted file capture resumes completed hashes and retries failures", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  let count = 0;
  await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async () =>
      ++count === 2 ? new Response("", { status: 503 }) : new Response(bytes),
  });
  count = 0;
  const result = await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async () => {
      count++;
      return new Response(bytes);
    },
  });
  assert.equal(count, 1);
  assert.equal(
    result.attachments.every((a) => a.state === "downloaded-quarantined"),
    true,
  );
});
test("tampered local bytes are redownloaded during resume", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  const first = await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async () => new Response(bytes),
  });
  await writeFile(
    path.join(directory, first.attachments[0].objectFile),
    "tampered",
  );
  let count = 0;
  await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    fetcher: async () => {
      count++;
      return new Response(bytes);
    },
  });
  assert.equal(count, 1);
});
test("oversized bodies and mismatched signatures never become available files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  const result = await copyAttachments(source(), {
    directory,
    allowedHosts: ["files.example.test"],
    maxBytes: 10,
    fetcher: async () => new Response(bytes),
  });
  assert.equal(result.attachments[0].reason, "OVERSIZE");
  const other = await mkdtemp(path.join(os.tmpdir(), "job-board-files-"));
  const mismatch = await copyAttachments(source(), {
    directory: other,
    allowedHosts: ["files.example.test"],
    fetcher: async () => new Response("<html>untrusted</html>"),
  });
  assert.equal(mismatch.attachments[0].typeMatches, false);
  assert.equal(mismatch.attachments[0].state, "downloaded-quarantined");
});
