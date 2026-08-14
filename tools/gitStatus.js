import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { runShellSafe } from "./shell.js";

export const gitStatusTool = tool(
  async () => {
    const output = await runShellSafe("git status --short && echo '---' && git branch --show-current");
    return output;
  },
  {
    name: "gitStatusTool",
    description:
      "Returns the current git status including changed files and the active branch name. Use this to understand the current state of the working directory before making changes.",
    schema: z.object({}),
  },
);

export const gitLogTool = tool(
  async (input) => {
    const n = input.count || 5;
    return await runShellSafe(`git log --oneline -${n}`);
  },
  {
    name: "gitLogTool",
    description:
      "Returns recent git commit history in one-line format. Useful for understanding what changes have been made recently.",
    schema: z.object({
      count: z.number().optional().describe("Number of commits to show (default 5)."),
    }),
  },
);
