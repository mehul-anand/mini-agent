import { readFileSync } from "fs";
import { safeResolve } from "./workspace.js";

export default {
  name: "read_file",
  description:
    "Read a file in the workspace and return its contents with line numbers. Use this to inspect exact context before editing. Paths are relative to the project root.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read, relative to the project root.",
      },
    },
    required: ["path"],
  },
  async run({ path }) {
    try {
      const full = safeResolve(path);
      const content = readFileSync(full, "utf-8");
      const lines = content.split("\n");
      const maxDigits = String(lines.length).length;
      const numbered = lines
        .map((line, i) => `${String(i + 1).padStart(maxDigits, " ")} | ${line}`)
        .join("\n");
      return `File: ${path} (${lines.length} lines)\n${"─".repeat(maxDigits + 2)}\n${numbered}`;
    } catch (err) {
      return `Error reading file ${path}: ${err.message}`;
    }
  },
};
