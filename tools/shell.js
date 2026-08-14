import { exec } from "child_process";

export function runShell(cmd, { timeout = 30000, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\nstderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function runShellSafe(cmd, opts = {}) {
  return runShell(cmd, opts).catch((err) => `Command failed: ${err.message}`);
}