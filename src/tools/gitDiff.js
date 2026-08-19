import { runShellSafe } from "./shell.js";

export default {
  name: "git_diff",
  description:
    "Show the git diff. By default shows unstaged changes vs HEAD. Use target='staged' for staged changes, or a commit/branch ref to diff against.",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "'working' for unstaged changes, 'staged' for the index, or a commit/branch ref.",
      },
    },
    required: [],
  },
  async run({ target = "working" } = {}) {
    let cmd;
    if (target === "working") cmd = "git diff";
    else if (target === "staged") cmd = "git diff --staged";
    else cmd = `git diff ${target}`;
    return runShellSafe(cmd);
  },
};
