import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { readFileSync } from "fs";

export const readFileTool = tool(
  async (input) => {
    try {
      const content = readFileSync(input.path, "utf-8");
      const lines = content.split("\n");
      const maxDigits = String(lines.length).length;

      const numbered = lines
        .map((line, i) => {
          const num = String(i + 1).padStart(maxDigits, " ");
          return `${num} | ${line}`;
        })
        .join("\n");

      const totalLines = lines.length;
      return `File: ${input.path} (${totalLines} lines)\n${"─".repeat(maxDigits + 2)}\n${numbered}`;
    } catch (err) {
      return `Error reading file ${input.path}: ${err.message}`;
    }
  },
  {
    name: "readFileTool",
    description:
      "Reads a file and returns its content with line numbers. Use this before editing a file to know the exact context. Paths are relative to the project root.",
    schema: z.object({
      path: z.string().describe("Path to the file to read, relative to the project root."),
    }),
  },
);
