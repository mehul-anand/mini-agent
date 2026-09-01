import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { safeResolve } from "./workspace.js";

export default {
  name: "write_file",
  description:
    "Creates a new file or overwrites an existing file with the given content. Parent directories are created automatically. Use this to create files or replace a file's entire content. Do NOT use for small edits — use edit_file instead.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write, relative to the project root.",
      },
      content: {
        type: "string",
        description: "The full file content to write.",
      },
    },
    required: ["path", "content"],
  },
  async run({ path, content }) {
    try {
      const full = safeResolve(path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
      const bytes = Buffer.byteLength(content);
      return `File written: ${path} (${bytes} bytes)`;
    } catch (err) {
      return `Error writing file ${path}: ${err.message}`;
    }
  },
};