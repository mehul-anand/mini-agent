import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { exec } from "child_process";

export const grepTool = tool(
  async (input) => {
    const pattern = input.pattern;
    const path = input.path || ".";

    const cmd = `rg --no-heading -n -C 2 "${pattern.replace(/"/g, '\\"')}" ${path} 2>/dev/null || grep -rn -C 2 "${pattern.replace(/"/g, '\\"')}" ${path} 2>/dev/null || echo "No matches found"`;

    return new Promise((resolve) => {
      exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) {
          resolve(`Search error: ${err.message}`);
        } else {
          const results = stdout.trim();
          resolve(results ? results : "No matches found");
        }
      });
    });
  },
  {
    name: "grepTool",
    description:
      "Searches for a text pattern (regex supported) across files, returning matching lines with file names and line numbers. Falls back from ripgrep (rg) to grep. Use this to find where a function is defined, where a variable is used, or to locate code patterns.",
    schema: z.object({
      pattern: z.string().describe("The regex pattern to search for."),
      path: z.string().optional().describe("Directory or file path to search in. Defaults to current directory."),
    }),
  },
);
