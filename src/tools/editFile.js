import { readFileSync, writeFileSync } from "fs";
import { safeResolve } from "./workspace.js";

export default {
  name: "edit_file",
  description:
    "Edits a file by replacing an exact string (old_string) with a new string (new_string). The old_string must appear exactly once in the file. Always read the file first to get exact content. Does NOT create new files — use write_file for that.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit, relative to the project root.",
      },
      old_string: {
        type: "string",
        description:
          "The exact text to find and replace. Must be unique in the file.",
      },
      new_string: {
        type: "string",
        description: "The replacement text.",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
  async run({ path, old_string, new_string }) {
    try {
      const full = safeResolve(path);
      const content = readFileSync(full, "utf-8");

      const occurrences = content.split(old_string).length - 1;

      if (occurrences === 0) {
        return `ERROR: old_string not found in ${path}. No changes made.\n\nSearched for:\n${old_string}`;
      }

      if (occurrences > 1) {
        return `ERROR: old_string found ${occurrences} times in ${path}. Must be unique. No changes made.\n\nSearched for:\n${old_string}`;
      }

      const updated = content.replace(old_string, new_string);
      writeFileSync(full, updated, "utf-8");

      const deltaBytes = Buffer.byteLength(new_string) - Buffer.byteLength(old_string);
      return `Edited ${path}: replaced 1 occurrence (${deltaBytes} bytes delta)`;
    } catch (err) {
      return `Error editing file ${path}: ${err.message}`;
    }
  },
};