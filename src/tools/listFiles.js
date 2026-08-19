import { existsSync, statSync, readdirSync } from "fs";
import { safeResolve } from "./workspace.js";

/**
 * Tool definition — single source of truth.
 * `parameters` is JSON Schema (draft-07-ish), sent to OpenAI as-is.
 * `run` is the executor; args are JSON-parsed from the model's call.
 */
export default {
  name: "list_files",
  description:
    "List the contents of a directory in the workspace. Returns file names and subdirectory names. Use this to explore a project's structure before reading or editing.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list (relative to project root). Defaults to current directory.",
      },
    },
    required: [],
  },
  async run({ path = "." } = {}) {
    const dir = safeResolve(path);
    if (!existsSync(dir)) return `Directory does not exist: ${dir}`;
    const stat = statSync(dir);
    if (!stat.isDirectory()) return `Not a directory: ${dir}`;

    const entries = readdirSync(dir, { withFileTypes: true });
    const items = entries.map((e) => {
      const suffix = e.isDirectory() ? "/" : "";
      const prefix = e.isDirectory() ? "📁 " : "📄 ";
      return `${prefix}${e.name}${suffix}`;
    });

    return items.length
      ? `Contents of ${dir}:\n` + items.join("\n")
      : `Directory is empty: ${dir}`;
  },
};
