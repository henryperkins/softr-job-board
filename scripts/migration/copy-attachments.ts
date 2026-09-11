import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordHash, type SourceExport } from "./validate-export.ts";

type Attachment = { id?: string; url?: string; size?: number; type?: string };
export type FileEntry = {
  referenceId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
  attachmentId: string | null;
  ownerIds: string[];
  declaredSize: number | null;
  declaredType: string | null;
  state: "downloaded-quarantined" | "unavailable";
  reason?: string;
  httpStatus?: number;
  sha256?: string;
  bytes?: number;
  detectedType?: string;
  typeMatches?: boolean;
  sizeMatches?: boolean;
  objectFile?: string;
};
export type Manifest = {
  sourceHash: string;
  createdAt: string;
  scanner: "not-configured";
  attachments: FileEntry[];
};
type Options = {
  directory: string;
  allowedHosts?: readonly string[];
  maxBytes?: number;
  fetcher?: typeof fetch;
};
const defaultHosts = [
  "softr-tables-eu-prod-bucket05.s3.eu-central-1.amazonaws.com",
];
async function acquireCopyLock(lockPath: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
      return lock;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
      const original = await readFile(lockPath, "utf8");
      const previous = JSON.parse(original) as { pid?: number };
      if (!Number.isSafeInteger(previous.pid) || (previous.pid ?? 0) <= 0)
        throw new Error("Unrecognized copy lock; inspect it before recovery.");
      try {
        process.kill(previous.pid!, 0);
        throw new Error("Another attachment copy process is active.");
      } catch (probe) {
        if (
          !probe ||
          typeof probe !== "object" ||
          !("code" in probe) ||
          probe.code !== "ESRCH"
        )
          throw probe;
      }
      if ((await readFile(lockPath, "utf8")) !== original)
        throw new Error("Copy lock changed; retry later.");
      await unlink(lockPath);
    }
  }
  throw new Error("Unable to acquire copy lock.");
}
function ids(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(
    (item) =>
      item &&
      typeof item === "object" &&
      "id" in item &&
      typeof item.id === "string"
        ? [item.id]
        : typeof item === "string"
          ? [item]
          : [],
  );
}
function detect(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  return "unknown";
}
export async function copyAttachments(
  source: SourceExport,
  options: Options,
): Promise<Manifest> {
  const directory = await realpath(options.directory);
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 50 * 1024 * 1024
  )
    throw new Error("Invalid download size limit.");
  const allowedHosts = options.allowedHosts ?? defaultHosts;
  const fetcher = options.fetcher ?? fetch;
  const sourceHash = recordHash(source);
  await mkdir(path.join(directory, "attachments"), {
    mode: 0o700,
    recursive: true,
  });
  const lockPath = path.join(directory, "attachment-copy.lock");
  const lock = await acquireCopyLock(lockPath);
  try {
    let previous: Manifest | undefined;
    try {
      const candidate = JSON.parse(
        await readFile(
          path.join(directory, "attachment-manifest.json"),
          "utf8",
        ),
      ) as Manifest;
      if (
        candidate.sourceHash === sourceHash &&
        Array.isArray(candidate.attachments)
      )
        previous = candidate;
    } catch {
      /* No usable checkpoint: fetch every referenced object again. */
    }
    const report: Manifest = {
      sourceHash,
      createdAt: new Date().toISOString(),
      scanner: "not-configured",
      attachments: [],
    };
    const checkpoint = async () => {
      const temporary = path.join(
        directory,
        "attachment-manifest.partial.json",
      );
      await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(temporary, path.join(directory, "attachment-manifest.json"));
    };
    for (const table of source.tables)
      for (const record of table.records)
        for (const field of table.fields.filter(
          (f) => f.type === "ATTACHMENT",
        )) {
          const ownerField = table.fields.find(
            (f) =>
              f.name ===
              (table.name === "Candidate Profile" ? "Owner" : "User"),
          );
          const ownerIds =
            table.name === "Users"
              ? [record.id]
              : ids(ownerField ? record.fields[ownerField.id] : null);
          const raw = record.fields[field.id];
          const attachments = (
            Array.isArray(raw) ? raw : raw ? [raw] : []
          ) as Attachment[];
          for (const [index, attachment] of attachments.entries()) {
            const a =
              attachment && typeof attachment === "object" ? attachment : {};
            const referenceId = recordHash([
              table.id,
              record.id,
              field.id,
              a.id ?? null,
              index,
            ]);
            const base = {
              referenceId,
              tableId: table.id,
              recordId: record.id,
              fieldId: field.id,
              attachmentId: typeof a.id === "string" ? a.id : null,
              ownerIds,
              declaredSize: typeof a.size === "number" ? a.size : null,
              declaredType: typeof a.type === "string" ? a.type : null,
            };
            const old = previous?.attachments.find(
              (item) => item.referenceId === referenceId,
            );
            if (
              old?.state === "downloaded-quarantined" &&
              old.sha256 &&
              /^[a-f0-9]{64}$/.test(old.sha256)
            ) {
              try {
                const file = "attachments/" + old.sha256 + ".bin";
                const bytes = await readFile(path.join(directory, file));
                if (
                  bytes.length <= maxBytes &&
                  createHash("sha256").update(bytes).digest("hex") ===
                    old.sha256
                ) {
                  report.attachments.push({
                    ...old,
                    ...base,
                    objectFile: file,
                  });
                  await checkpoint();
                  continue;
                }
              } catch {
                /* A missing/corrupt local object must be fetched again. */
              }
            }
            try {
              const url = new URL(a.url ?? "");
              if (
                url.protocol !== "https:" ||
                !allowedHosts.includes(url.hostname) ||
                url.username ||
                url.password ||
                (url.port && url.port !== "443")
              )
                throw new Error("UNAPPROVED_ORIGIN");
              const response = await fetcher(url, {
                redirect: "error",
                signal: AbortSignal.timeout(20000),
              });
              if (!response.ok) {
                report.attachments.push({
                  ...base,
                  state: "unavailable",
                  httpStatus: response.status,
                });
                await checkpoint();
                continue;
              }
              const reader = response.body?.getReader();
              if (!reader) throw new Error("EMPTY_BODY");
              const chunks: Uint8Array[] = [];
              let size = 0;
              try {
                for (;;) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  size += chunk.value.length;
                  if (size > maxBytes) {
                    await reader.cancel();
                    throw new Error("OVERSIZE");
                  }
                  chunks.push(chunk.value);
                }
              } finally {
                reader.releaseLock();
              }
              const bytes = Buffer.concat(chunks);
              const sha256 = createHash("sha256").update(bytes).digest("hex");
              const objectFile = "attachments/" + sha256 + ".bin";
              await writeFile(path.join(directory, objectFile), bytes, {
                mode: 0o600,
              });
              const detectedType = detect(bytes);
              report.attachments.push({
                ...base,
                state: "downloaded-quarantined",
                sha256,
                bytes: bytes.length,
                objectFile,
                detectedType,
                typeMatches:
                  detectedType !== "unknown" && detectedType === a.type,
                sizeMatches:
                  typeof a.size === "number" && a.size === bytes.length,
              });
            } catch (error) {
              const reason =
                error instanceof Error &&
                ["UNAPPROVED_ORIGIN", "EMPTY_BODY", "OVERSIZE"].includes(
                  error.message,
                )
                  ? error.message
                  : "FETCH_FAILED";
              report.attachments.push({
                ...base,
                state: "unavailable",
                reason,
              });
            }
            await checkpoint();
          }
        }
    await checkpoint();
    return report;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const index = process.argv.indexOf("--manifest");
  const sourcePath = index >= 0 ? process.argv[index + 1] : undefined;
  if (!sourcePath) {
    console.error(
      "Usage: node scripts/migration/copy-attachments.ts --manifest <protected-source-export.json>",
    );
    process.exitCode = 2;
  } else {
    try {
      const sourceFile = await realpath(sourcePath);
      const repository = await realpath(
        fileURLToPath(new URL("../../", import.meta.url)),
      );
      const relative = path.relative(repository, sourceFile);
      if (
        relative === "" ||
        (!relative.startsWith(".." + path.sep) &&
          relative !== ".." &&
          !path.isAbsolute(relative))
      )
        throw new Error("PRIVATE_ARCHIVE_REQUIRED");
      const report = await copyAttachments(
        JSON.parse(await readFile(sourceFile, "utf8")) as SourceExport,
        { directory: path.dirname(sourceFile) },
      );
      const unavailable = report.attachments.filter(
        (a) => a.state === "unavailable",
      ).length;
      const mismatch = report.attachments.filter(
        (a) => a.typeMatches === false || a.sizeMatches === false,
      ).length;
      console.log(
        JSON.stringify({
          references: report.attachments.length,
          downloaded: report.attachments.length - unavailable,
          unavailable,
          mismatch,
          uniqueObjects: new Set(
            report.attachments.filter((a) => a.sha256).map((a) => a.sha256),
          ).size,
          scanner: report.scanner,
          targetR2Copied: false,
        }),
      );
      if (unavailable || mismatch) process.exitCode = 1;
    } catch {
      console.error(
        "Attachment copy failed; source URLs and file metadata withheld.",
      );
      process.exitCode = 2;
    }
  }
}
