import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { exec } from "child_process";

export const executeCmdTool = tool(
  async (input) => {
    const cmd = input.cmd.trim();
    return new Promise((resolve) => {
      exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve(`Command failed (exit code ${err.signal || err.code}):\n${stderr || stdout || err.message}`);
        } else {
          resolve(stdout || "(no output)");
        }
      });
    });
  },
  {
    name: "executeCmdTool",
    description:
      "Executes a shell command on the user's machine and returns stdout. Use for git commands, file operations, or any terminal task. The command runs from the project root. Use with caution — commands have full shell access. For GitHub operations, use gh CLI (e.g., 'gh pr view 42'). For git, use commands like 'git status', 'git diff', 'git log --oneline -5'.",
    schema: z.object({
      cmd: z.string().describe("The shell command to execute."),
    }),
  },
);
