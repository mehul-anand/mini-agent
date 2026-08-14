import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export const writeFileTool = tool(
  async (input) => {
    try {
      const dir = dirname(input.path);
      mkdirSync(dir, { recursive: true });
      writeFileSync(input.path, input.content, "utf-8");
      return `File written successfully: ${input.path} (${input.content.length} bytes)`;
    } catch (err) {
      return `Error writing file ${input.path}: ${err.message}`;
    }
  },
  {
    name: "writeFileTool",
    description:
      "Creates or overwrites a file with the given content. Parent directories are created automatically. Use this to create new files or replace a file's entire content. Do NOT use for small edits — use editFileTool instead.",
    schema: z.object({
      path: z.string().describe("Path to the file to write, relative to the project root."),
      content: z.string().describe("The full file content to write."),
    }),
  },
);
