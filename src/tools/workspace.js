import { resolve, isAbsolute } from "path";

/**
 * Workspace boundary: resolve a user-supplied path against the project root
 * (cwd) and reject anything that escapes it. Shared by all file tools.
 */
export function safeResolve(path) {
  const base = process.cwd();
  const full = isAbsolute(path) ? path : resolve(base, path);
  if (!full.startsWith(base)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return full;
}
