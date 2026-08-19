import { runShellSafe } from "./shell.js";

export default {
  name: "git_status",
  description:
    "Return the current git status (changed/untracked files) and the active branch name. Use this to understand the working directory state before making changes.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async run() {
    return runShellSafe("git status --short && echo '---' && git branch --show-current");
  },
};
