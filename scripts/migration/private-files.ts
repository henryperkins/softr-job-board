import { mkdir, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function outsideRepository(destination: string, existing = true) {
  const repository = await realpath(
    fileURLToPath(new URL("../../", import.meta.url).href),
  );
  const target = existing
    ? await realpath(destination)
    : path.join(
        await realpath(path.dirname(path.resolve(destination))),
        path.basename(destination),
      );
  const relative = path.relative(repository, target);
  if (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    throw new Error("Private migration data must be outside the repository.");
  }
  return target;
}

export async function createProtectedDirectory(destination: string) {
  const target = await outsideRepository(destination, false);
  // Never change permissions on a pre-existing directory.
  await mkdir(target, { mode: 0o700 });
  if (process.platform === "win32") {
    const run = promisify(execFile);
    const { stdout } = await run("whoami.exe", []);
    const principal = stdout.trim();
    if (!principal || /[\r\n]/.test(principal))
      throw new Error("Unable to determine archive owner.");
    await run("icacls.exe", [
      target,
      "/inheritance:r",
      "/grant:r",
      principal + ":(OI)(CI)F",
    ]);
  }
  return target;
}
