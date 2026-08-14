import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { readFileSync, writeFileSync } from "fs";

export const editFileTool = tool(
  async (input) => {
    const { path, old_string, new_string } = input;

    try {
      const content = readFileSync(path, "utf-8");

      const occurrences = content.split(old_string).length - 1;

      if (occurrences === 0) {
        return `ERROR: old_string not found in ${path}. No changes made.\n\nSearched for:\n${old_string}`;
      }

      if (occurrences > 1) {
        return `ERROR: old_string found ${occurrences} times in ${path}. Must be unique. No changes made.\n\nSearched for:\n${old_string}`;
      }

      const updated = content.replace(old_string, new_string);
      writeFileSync(path, updated, "utf-8");

      return `Successfully edited ${path}: replaced 1 occurrence (${new_string.length - old_string.length} bytes delta).`;
    } catch (err) {
      return `Error editing file ${path}: ${err.message}`;
    }
  },
  {
    name: "editFileTool",
    description:
      "Edits a file by replacing an exact string (old_string) with a new string (new_string). The old_string must appear exactly once in the file. Always read the file first to get exact content. Does NOT create new files — use writeFileTool for that.",
    schema: z.object({
      path: z.string().describe("Path to the file to edit, relative to the project root."),
      old_string: z.string().describe("The exact text to find and replace. Must be unique in the file."),
      new_string: z.string().describe("The replacement text."),
    }),
  },
);
