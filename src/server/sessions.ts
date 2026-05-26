import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TMP_ROOT = join(import.meta.dir, "..", "..", "tmp");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function ensureRoot(): Promise<void> {
  await mkdir(TMP_ROOT, { recursive: true });
}

export function sessionDir(sessionId: string): string {
  return join(TMP_ROOT, sessionId);
}

export async function createSession(): Promise<string> {
  const id = randomUUID();
  await mkdir(sessionDir(id), { recursive: true });
  return id;
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return false;
  try {
    const s = await stat(sessionDir(sessionId));
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function pruneOld(): Promise<void> {
  await ensureRoot();
  const cutoff = Date.now() - MAX_AGE_MS;
  const entries = await readdir(TMP_ROOT);
  for (const name of entries) {
    const p = join(TMP_ROOT, name);
    try {
      const s = await stat(p);
      if (s.mtimeMs < cutoff) await rm(p, { recursive: true, force: true });
    } catch {}
  }
}
