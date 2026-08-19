import { safeResolve } from "./workspace.js";
import { runShellSafe } from "./shell.js";

export default {
  name: "grep",
  description:
    "Search for a regex pattern across files, returning matching lines with file names and line numbers (ripgrep preferred, grep fallback). Use to locate where a function, variable, or code pattern is defined or used.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The regex pattern to search for." },
      path: {
        type: "string",
        description: "Directory or file path to search in (relative to project root). Defaults to current directory.",
      },
    },
    required: ["pattern"],
  },
  async run({ pattern, path = "." }) {
    const target = safeResolve(path);
    const escaped = pattern.replace(/"/g, '\\"');
    const cmd = `rg --no-heading -n -C 2 "${escaped}" "${target}" 2>/dev/null || grep -rn -C 2 "${escaped}" "${target}" 2>/dev/null || echo "No matches found"`;
    const out = await runShellSafe(cmd);
    return out && out.trim() ? out.trim() : "No matches found";
  },
};
