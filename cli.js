#!/usr/bin/env node
import readline from "readline";
import chalk from "chalk";
import { execSync } from "child_process";
import fs from "fs";

import { createPlanAgent, createBuildAgent, createAutoLoopAgent } from "./agent.js";
import { getPRTool } from "./tools/index.js";
import { CONFIG, loadConfig, saveApiKey, clearApiKey, getMaskedKey, KEYCHAIN_SERVICE } from "./config.js";
import { HumanMessage } from "@langchain/core/messages";

const bold = chalk.bold;

// ---- Argument parser (no external deps) ----
function parseArgs(argv) {
  const args = { mode: "plan", pr: null, issue: null, model: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" || a === "-m") args.mode = argv[++i];
    else if (a === "--pr" || a === "-p") args.pr = parseInt(argv[++i], 10);
    else if (a === "--issue" || a === "-i") args.issue = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// ---- Terminal I/O ----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise((resolve) => rl.question(chalk.cyan(prompt), resolve));
}

function askMasked(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const hadRaw = stdin.isTTY && typeof stdin.setRawMode === "function";

    if (hadRaw) {
      process.stdout.write(chalk.cyan(prompt));
      stdin.setRawMode(true);
      stdin.once("data", (data) => {
        stdin.setRawMode(false);
        process.stdout.write("\n");
        resolve(data.toString().trim());
      });
    } else {
      rl.question(chalk.cyan(prompt), (answer) => resolve(answer.trim()));
    }
  });
}

function printHeader(title) {
  console.log("\n" + chalk.cyan.bold("=".repeat(60)));
  console.log(chalk.cyan.bold("  " + title));
  console.log(chalk.cyan.bold("=".repeat(60)) + "\n");
}

function showHelp() {
  console.log("");
  console.log(chalk.cyan.bold("Agent Studio") + " - CLI Coding Agent");
  console.log("");
  console.log(bold("USAGE"));
  console.log("  mini-agent [mode] [options]");
  console.log("");
  console.log(bold("MODES"));
  console.log("  plan        Analyze PRs/files — suggest fixes (default, interactive REPL)");
  console.log("  build       Apply an approved plan — edit files and commit");
  console.log("  auto        Self-improving loop: plan -> build -> evaluate -> (retry/commit)");
  console.log("");
  console.log(bold("COMMANDS (plan mode)"));
  console.log("  /connect    Set or change your API key");
  console.log("  /keys       Manage stored API keys");
  console.log("  /env        Show current configuration");
  console.log("  /help       Show help");
  console.log("  /exit       Quit");
  console.log("");
  console.log(bold("OPTIONS"));
  console.log("  --mode <mode>     Specify mode: plan | build | auto");
  console.log("  --pr <number>     Fetch PR #<number> and use it as the task");
  console.log("  --issue <text>    Provide an issue/PR text as the task");
  console.log("  --model <name>    Override the OpenAI model (default: " + CONFIG.model + ")");
  console.log("  --help, -h        Show this help");
  console.log("");
  console.log(bold("EXAMPLES"));
  console.log("  mini-agent plan --pr 42             # analyze PR #42");
  console.log("  mini-agent auto --pr 42              # auto-loop on PR #42");
  console.log('  mini-agent auto --issue "Fix XSS"  # auto-loop on text issue');
  console.log("  mini-agent build                     # interactive build");
  console.log("  npx mini-agent plan                  # run without installing");
  process.exit(0);
}

if (args.help) showHelp();

// ---- Shared: stream agent output ----
async function streamAgent(agent, query) {
  const stream = await agent.stream(
    { messages: [new HumanMessage(query)] },
    { configurable: { thread_id: "default" }, streamMode: "values" },
  );

  for await (const chunk of stream) {
    const lastMsg = chunk.messages?.[chunk.messages.length - 1];
    if (!lastMsg) continue;
    if (lastMsg.tool_calls?.length > 0) {
      for (const tc of lastMsg.tool_calls) {
        console.log(chalk.yellow("  Tool: " + tc.name + "(" + JSON.stringify(tc.args || {}) + ")"));
      }
    }
    if (lastMsg.content && typeof lastMsg.content === "string" && lastMsg.content.trim()) {
      lastMsg.content.split("\n").forEach((line) => console.log(chalk.green("  " + line)));
    }
  }
}

// ---- Onboarding wizard ----
async function runOnboarding() {
  printHeader("Agent Studio - Setup Wizard");

  console.log(chalk.gray("Welcome! Agent Studio needs an OpenAI API key to work."));
  console.log(chalk.gray("Get yours at: https://platform.openai.com/api-keys\n"));

  const key = await askMasked("  API Key: ");

  if (!key || key.length < 10) {
    console.log(chalk.red("\n✗ Invalid API key. Must be at least 10 characters."));
    process.exit(1);
  }

  console.log("");
  console.log(bold("  Where to save your key:"));
  console.log("  (1) OS Keychain — encrypted by your system (recommended)");
  console.log("  (2) Local config file (~/.mini-agent/config.json, chmod 600)");
  console.log("  (3) Just for this session (not saved)");
  const choice = await ask("  Select [1]: ");
  const sel = choice.trim() || "1";

  if (sel === "1") {
    if (CONFIG.keychainAvailable) {
      await saveApiKey(key);
      await loadConfig();
      console.log(chalk.green("\n✓ Key saved to OS keychain"));
    } else {
      console.log(chalk.yellow("  Keychain not available, using config file instead..."));
      await saveApiKey(key);
      await loadConfig();
    }
  } else if (sel === "2") {
    // Clear from keychain first, then save to file
    if (CONFIG.keychainAvailable) {
      try {
        const keytar = (await import("keytar")).default;
        await keytar.deletePassword(KEYCHAIN_SERVICE, "openai-api-key");
      } catch {}
    }
    // writeApiKeyToFile is handled by saveApiKey fallback
    await saveApiKey(key);
    await loadConfig();
    console.log(chalk.green("\n✓ Key saved to config file"));
  } else if (sel === "3") {
    // Store in memory only (env var)
    process.env.OPENAI_API_KEY = key;
    CONFIG.openaiApiKey = key;
    CONFIG.isConfigured = true;
    console.log(chalk.gray("\n  (Key not saved — you'll need to re-enter it next time)"));
  }

  console.log(chalk.green("\n✓ Setup complete! You're ready to use Agent Studio."));
  console.log(chalk.gray("  Tip: Run `mini-agent plan` to start a coding session.\n"));
}

// ---- Key management commands ----
async function cmdConnect() {
  printHeader("Connect — Set API Key");

  if (!CONFIG.keychainAvailable) {
    console.log(chalk.yellow("OS keychain not available on this system.\n"));
  } else {
    console.log(chalk.gray("Current key: " + (CONFIG.openaiApiKey ? getMaskedKey() : "(not set)")));
    console.log(chalk.gray("Storage: OS keychain (" + KEYCHAIN_SERVICE + ")\n"));
  }

  const key = await askMasked("  New API Key: ");
  if (!key || key.length < 10) {
    console.log(chalk.red("✗ Invalid key"));
    return;
  }

  const result = await saveApiKey(key);
  await loadConfig();
  console.log(chalk.green("\n✓ API key updated"));
  console.log(chalk.gray("  Storage method: " + result.method));
}

async function cmdKeys() {
  printHeader("Keys — Manage Stored Credentials");

  if (CONFIG.openaiApiKey) {
    console.log("  Current key: " + chalk.gray(getMaskedKey()));
  } else {
    console.log(chalk.gray("  No API key configured"));
  }

  console.log("");
  console.log(bold("  Options:"));
  console.log("  (1) Test current key");
  console.log("  (2) Remove current key");
  console.log("  (3) Go back");
  const choice = await ask("  Select: ");

  switch (choice.trim()) {
    case "1": {
      if (!CONFIG.openaiApiKey) {
        console.log(chalk.yellow("No key to test. Use /connect to add one."));
      } else {
        console.log(chalk.gray("  Verifying..."));
        try {
          const { ChatOpenAI } = await import("@langchain/openai");
          const model = new ChatOpenAI({
            model: "gpt-3.5-turbo",
            apiKey: CONFIG.openaiApiKey,
            maxTokens: 10,
          });
          const res = await model.invoke("Hello");
          console.log(chalk.green("  ✓ Key is valid! (" + res?.usage?.model + ")"));
        } catch (e) {
          console.log(chalk.red("  ✗ Key may be invalid: " + e.message));
        }
      }
      break;
    }
    case "2": {
      const confirm = await ask("  Are you sure? Type 'yes' to confirm: ");
      if (confirm.trim().toLowerCase() === "yes") {
        await clearApiKey();
        console.log(chalk.green("✓ Key removed"));
      } else {
        console.log("  Cancelled.");
      }
      break;
    }
    default:
      break;
  }
}

async function cmdEnv() {
  printHeader("Environment");

  const configFile = CONFIG.configFile;
  let fileExists = false;
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    fileExists = true;
  } catch {}

  console.log("  OpenAI Key:      " + chalk.gray(CONFIG.openaiApiKey ? getMaskedKey() : "(not set)"));
  console.log("  Model:           " + CONFIG.model);
  console.log("  Config file:     " + (fileExists ? configFile : "(not found)"));
  console.log("  Env var:         " + (process.env.OPENAI_API_KEY ? "OPENAI_API_KEY is set" : "(not set)"));
  console.log("  Keychain:        " + (CONFIG.keychainAvailable ? "available" : "unavailable"));
  console.log("  Config dir:      " + CONFIG.configDir);

  if (Object.keys(fileConfig).length > 0 && !fileConfig.apiKey) {
    console.log("  File contents:   " + JSON.stringify(fileConfig));
  }

  console.log("");
  console.log(chalk.gray("  Key resolution order: env var -> keychain -> config file"));
}

// ---- Mode: Plan (interactive REPL) ----
async function planMode() {
  printHeader("Agent Studio - Plan Mode");
  console.log(chalk.gray("Model: " + CONFIG.model));
  console.log(chalk.gray("Commands: /connect, /keys, /env, /help, /exit\n"));

  const agent = createPlanAgent();

  while (true) {
    const input = await ask("agent> ");
    const trimmed = input.trim();

    if (trimmed === "" || trimmed === "/exit" || trimmed === "exit" || trimmed === "quit") {
      break;
    }

    // Handle built-in commands
    if (trimmed.startsWith("/connect")) { await cmdConnect(); continue; }
    if (trimmed.startsWith("/keys")) { await cmdKeys(); continue; }
    if (trimmed.startsWith("/env")) { await cmdEnv(); continue; }
    if (trimmed.startsWith("/help")) { showHelp(); continue; }

    console.log("");
    try {
      await streamAgent(agent, trimmed);
      console.log("");
    } catch (err) {
      console.log(chalk.red("Error: " + err.message) + "\n");
    }
  }

  rl.close();
  console.log(chalk.gray("\nGoodbye!"));
  process.exit(0);
}

// ---- Mode: Build ----
async function buildMode() {
  printHeader("Agent Studio - Build Mode");
  console.log(chalk.gray("Model: " + CONFIG.model));
  console.log(chalk.gray("Enter your fix request or plan.\n"));

  const agent = createBuildAgent();

  while (true) {
    const input = await ask("agent> ");
    const trimmed = input.trim();
    if (trimmed === "" || trimmed === "/exit" || trimmed === "exit" || trimmed === "quit") break;

    console.log("");
    try {
      await streamAgent(agent, trimmed);
      console.log("");
    } catch (err) {
      console.log(chalk.red("Error: " + err.message) + "\n");
    }
  }

  rl.close();
  process.exit(0);
}

// ---- Mode: Auto ----
async function autoMode() {
  let issueText = args.issue;

  if (args.pr) {
    printHeader("Agent Studio - Auto Mode (fetching PR #" + args.pr + ")");
    const prData = await getPRTool.invoke({ number: args.pr });
    issueText = prData;
    console.log(chalk.gray("Fetched PR #" + args.pr + "\n"));
  } else if (!issueText) {
    printHeader("Agent Studio - Auto Mode");
    console.log(chalk.gray("Enter the issue or PR to fix:\n"));
    issueText = await ask("issue> ");
  }

  if (!issueText || !issueText.trim()) {
    console.log(chalk.red("No issue provided. Use --pr <number> or --issue \"text\""));
    process.exit(1);
  }

  printHeader("Agent Studio - Auto Loop");
  console.log(chalk.gray("Issue: " + issueText.slice(0, 80)));
  console.log(chalk.gray("Flow: plan -> build -> evaluate -> (retry/commit)\n"));

  const agent = createAutoLoopAgent();
  const stream = await agent.stream(
    { issue: issueText },
    { configurable: { thread_id: "auto-" + Date.now() }, streamMode: "values" },
  );

  for await (const chunk of stream) {
    const msg = chunk.messages?.[chunk.messages?.length - 1];
    if (msg && typeof msg.content === "string" && msg.content.trim()) {
      console.log(chalk.green("  " + msg.content.slice(0, 300)));
    }
  }

  console.log(chalk.green("\nAuto loop complete!"));
  console.log(chalk.gray("  Review changes with: git diff"));
  rl.close();
}

// ---- Main execution ----
async function main() {
  // Resolve config (env var -> keychain -> config file)
  await loadConfig();

  // Onboarding: if no key configured, run wizard
  if (!CONFIG.isConfigured && !args.help) {
    await runOnboarding();
  }

  switch (args.mode) {
    case "plan":
    case "build":
    case "auto":
      if (args.mode === "plan") await planMode();
      if (args.mode === "build") await buildMode();
      if (args.mode === "auto") await autoMode();
      break;
    default:
      console.log(chalk.red("Unknown mode: " + args.mode));
      showHelp();
  }
}

main().catch((err) => {
  console.error(chalk.red("Fatal error: " + err.message));
  process.exit(1);
});
