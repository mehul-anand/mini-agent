import { exec } from "child_process";

/** Run a shell command, rejecting on error with stderr included. */
export function runShell(cmd, { timeout = 15000, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\nstderr: ${stderr}`));
      else resolve(stdout);
    });
  });
}

/** Like runShell but never throws — returns an error string instead. */
export function runShellSafe(cmd, opts = {}) {
  return runShell(cmd, opts).catch((err) => `Command failed: ${err.message}`);
}
