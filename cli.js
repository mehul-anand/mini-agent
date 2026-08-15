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
// Only create readline interface for TTY mode — for piped input,
// readLineFromStdin() reads directly from stdin without readline
const rl = process.stdin.isTTY
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null;
// Piped input buffer (for non-TTY mode)
let pipeBuffer = "";

function readLineFromStdin() {
  return new Promise((resolve) => {
    const onData = (chunk) => {
      pipeBuffer += chunk.toString();
      const idx = pipeBuffer.indexOf("\n");
      if (idx >= 0) {
        const line = pipeBuffer.slice(0, idx).trim();
        pipeBuffer = pipeBuffer.slice(idx + 1);
        process.stdin.removeListener("data", onData);
        resolve(line);
      }
    };

    if (pipeBuffer) {
      const idx = pipeBuffer.indexOf("\n");
      if (idx >= 0) {
        const line = pipeBuffer.slice(0, idx).trim();
        pipeBuffer = pipeBuffer.slice(idx + 1);
        resolve(line);
        return;
      }
    }

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  });
}

function ask(prompt) {
  if (rl) {
    return new Promise((resolve) => rl.question(chalk.cyan(prompt), resolve));
  }
  process.stdout.write(chalk.cyan(prompt));
  return readLineFromStdin();
}

function askMasked(prompt) {
  const stdin = process.stdin;
  const hadRaw = stdin.isTTY && typeof stdin.setRawMode === "function";

  if (hadRaw) {
    return new Promise((resolve) => {
      let value = "";

      const cleanup = () => {
        stdin.off("keypress", onKeypress);
        stdin.setRawMode(false);
        process.stdout.write("\n");
      };

      const redraw = () => {
        process.stdout.write("\r\x1b[2K");
        process.stdout.write(chalk.cyan(prompt) + "*".repeat(value.length));
      };

      const onKeypress = (str, key = {}) => {
        if (key.ctrl && key.name === "c") {
          cleanup();
          process.exit(0);
        }

        if (key.name === "escape") {
          cleanup();
          resolve(null);
          return;
        }

        if (key.name === "return") {
          cleanup();
          resolve(value.trim());
          return;
        }

        if (key.name === "backspace") {
          value = value.slice(0, -1);
          redraw();
          return;
        }

        if (typeof str === "string" && str.length > 0 && !key.ctrl && !key.meta) {
          value += str;
          redraw();
        }
      };

      process.stdout.write(chalk.cyan(prompt));
      readline.emitKeypressEvents(stdin);
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("keypress", onKeypress);
    });
  } else {
    process.stdout.write(chalk.cyan(prompt));
    return readLineFromStdin();
  }
}

function printHeader(title) {
  console.log("\n" + chalk.cyan.bold("=".repeat(60)));
  console.log(chalk.cyan.bold("  " + title));
  console.log(chalk.cyan.bold("=".repeat(60)) + "\n");
}

function renderHelp() {
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
  console.log("  /          Open command palette");
  console.log("  /connect    Set or change your API key");
  console.log("  /keys       Manage stored API keys");
  console.log("  /env        Show current configuration");
  console.log("  /help       Show help");
  console.log("  /exit       Quit");
  console.log("  Tab         Switch between plan and build modes");
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
}

function showHelp() {
  renderHelp();
  process.exit(0);
}

if (args.help) showHelp();

const STUDIO_COMMANDS = [
  { id: "connect", label: "/connect", description: "Set or change your API key" },
  { id: "keys", label: "/keys", description: "Manage stored API keys" },
  { id: "env", label: "/env", description: "Show current configuration" },
  { id: "help", label: "/help", description: "Show help" },
  { id: "exit", label: "/exit", description: "Quit the app" },
];

const screenStack = [];

const MODE_LABELS = {
  plan: { label: "PLAN", fg: chalk.black, bg: chalk.bgGreenBright },
  build: { label: "BUILD", fg: chalk.white, bg: chalk.bgBlueBright },
};

function wrapText(text, width) {
  const safeWidth = Math.max(10, width);
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= safeWidth) {
      current = next;
      continue;
    }

    if (current) lines.push(current);

    if (word.length > safeWidth) {
      for (let i = 0; i < word.length; i += safeWidth) {
        const chunk = word.slice(i, i + safeWidth);
        if (chunk.length === safeWidth) lines.push(chunk);
        else current = chunk;
      }
    } else {
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function formatTranscriptEntry(entry, width) {
  const labelMap = {
    user: "You",
    assistant: "Agent",
    tool: "Tool",
    status: "System",
  };

  const prefix = labelMap[entry.role] || entry.role || "Note";
  const prefixText = `${prefix}: `;
  const lines = wrapText(entry.text, Math.max(10, width - prefixText.length));

  return lines.map((line, index) => {
    const head = index === 0 ? prefixText : " ".repeat(prefixText.length);
    return head + line;
  });
}

function renderStudioWorkspace(state) {
  const width = Math.max(72, Math.min(process.stdout.columns || 80, 120));
  const height = Math.max(24, process.stdout.rows || 24);
  const theme = MODE_LABELS[state.mode] || MODE_LABELS.plan;
  const badge = theme.bg(theme.fg(` ${theme.label} `));
  const header = chalk.cyan.bold("Agent Studio");
  const topRule = chalk.cyan("─".repeat(width));
  const footerHint = chalk.gray("Tab mode  •  / menu  •  Ctrl+K palette  •  Esc back  •  Enter send");
  const inputLabel = chalk.cyan("agent> ");
  const maxInput = Math.max(10, width - 18);
  const displayInput =
    (state.input || "").length > maxInput
      ? "…" + (state.input || "").slice(-(maxInput - 1))
      : state.input || "";

  const transcriptLines = [];
  const entries = state.transcript || [];
  entries.slice(-100).forEach((entry) => {
    transcriptLines.push(...formatTranscriptEntry(entry, width - 4));
    transcriptLines.push("");
  });

  const bodyHeight = Math.max(8, height - 10);
  const visibleTranscript = transcriptLines.slice(-bodyHeight);

  process.stdout.write("\x1b[2J\x1b[H");
  console.log(`${badge} ${header}  ${chalk.gray(`model ${CONFIG.model}`)}  ${chalk.gray(state.status || "ready")}`);
  console.log(chalk.gray(`Mode switches with Tab. / opens command menu. Esc goes back.`));
  console.log(topRule);

  if (visibleTranscript.length === 0) {
    console.log(chalk.gray("Start by typing a request. Use / for commands or Tab to switch mode."));
  } else {
    visibleTranscript.forEach((line) => console.log(line));
  }

  const remaining = bodyHeight - visibleTranscript.length;
  for (let i = 0; i < Math.max(0, remaining); i++) {
    console.log("");
  }

  console.log(topRule);
  console.log(`${badge} ${inputLabel}${displayInput}`);
  console.log(footerHint);
}

async function runStudioCommand(commandId) {
  switch (commandId) {
    case "connect":
      await cmdConnect();
      break;
    case "keys":
      await cmdKeys();
      break;
    case "env":
      await cmdEnv();
      break;
    case "help":
      renderHelp();
      break;
    case "exit":
      rl?.close();
      process.exit(0);
      break;
    default:
      break;
  }
}

function pushScreen(name) {
  screenStack.push(name);
}

function popScreen() {
  return screenStack.pop();
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function renderModalShell(title, bodyLines, footer) {
  clearScreen();
  const width = Math.max(64, Math.min(process.stdout.columns || 80, 96));
  const border = chalk.cyan("═".repeat(width - 2));
  console.log(chalk.cyan(`╔${border}╗`));
  console.log(chalk.cyan("║") + chalk.cyan.bold(` ${title} `).padEnd(width - 2) + chalk.cyan("║"));
  console.log(chalk.cyan(`╠${chalk.cyan("═".repeat(width - 2))}╣`));
  bodyLines.forEach((line) => {
    console.log(chalk.cyan("║") + chalk.gray(` ${line}`.padEnd(width - 2)) + chalk.cyan("║"));
  });
  console.log(chalk.cyan(`╠${chalk.cyan("═".repeat(width - 2))}╣`));
  console.log(chalk.cyan("║") + chalk.gray(footer.padEnd(width - 2)) + chalk.cyan("║"));
  console.log(chalk.cyan(`╚${border}╝`));
}

async function openInfoModal({ screenName, title, bodyLines, footer = "Esc to go back" }) {
  if (!rl) {
    bodyLines.forEach((line) => console.log(line));
    console.log(footer);
    return;
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
      popScreen();
      clearScreen();
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      if (key.name === "escape" || key.name === "return") {
        finish();
      }
    };

    pushScreen(screenName);
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    renderModalShell(title, bodyLines, footer);
  });
}

async function promptStudioLine(initialMode, state) {
  if (!rl) {
    const input = await ask(`${initialMode}> `);
    return { text: input, mode: initialMode };
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buffer = "";
    let mode = initialMode;

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
      process.stdout.write("\n");
    };

    const redraw = () => {
      renderStudioWorkspace({
        mode,
        input: buffer,
        transcript: state.transcript,
        status: state.status,
      });
    };

    const deletePreviousWord = () => {
      const trimmed = buffer.replace(/\s+$/, "");
      const next = trimmed.replace(/\S+$/, "");
      buffer = next;
      redraw();
    };

    const onKeypress = async (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      if ((key.ctrl && key.name === "k") || (str === "/" && buffer.length === 0)) {
        cleanup();
        const command = await openCommandPalette();
        resolve(command ? { command: command.id, mode } : { cancelled: true, mode });
        return;
      }

      if (key.name === "tab") {
        mode = mode === "plan" ? "build" : "plan";
        redraw();
        return;
      }

      if (key.name === "return") {
        cleanup();
        resolve({ text: buffer.trim(), mode });
        return;
      }

      if (key.name === "backspace") {
        buffer = buffer.slice(0, -1);
        redraw();
        return;
      }

      if (key.ctrl && key.name === "w") {
        deletePreviousWord();
        return;
      }

      if (typeof str === "string" && str.length > 0 && !key.ctrl && !key.meta) {
        buffer += str;
        redraw();
      }
    };

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    redraw();
  });
}

function getPaletteMatches(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return STUDIO_COMMANDS;
  return STUDIO_COMMANDS.filter((command) => {
    return [command.id, command.label, command.description]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
}

function renderCommandPalette(query, matches, index) {
  const width = Math.max(62, Math.min(process.stdout.columns || 80, 88));
  const border = chalk.cyan("═".repeat(width - 2));
  const title = chalk.cyan.bold(" Command Palette ");
  const helper = chalk.gray("Esc back  •  Enter run  •  ↑↓ navigate  •  type to filter");

  process.stdout.write("\x1b[2J\x1b[H");
  console.log(chalk.cyan(`╔${border}╗`));
  console.log(chalk.cyan("║") + title.padEnd(width - 2) + chalk.cyan("║"));
  console.log(chalk.cyan(`╠${chalk.cyan("═".repeat(width - 2))}╣`));
  console.log(chalk.cyan("║") + chalk.gray(` Search: ${query}`.padEnd(width - 2)) + chalk.cyan("║"));
  console.log(chalk.cyan(`╠${chalk.cyan("═".repeat(width - 2))}╣`));

  if (matches.length === 0) {
    console.log(chalk.cyan("║") + chalk.gray(" No commands found".padEnd(width - 2)) + chalk.cyan("║"));
  } else {
    const visible = matches.slice(0, 5);
    visible.forEach((command, i) => {
      const selected = i === index;
      const label = command.label.padEnd(12);
      const description = command.description;
      const text = ` ${label} ${description}`.padEnd(width - 2);
      if (selected) {
        console.log(chalk.cyan("║") + chalk.bgCyan.black(text.slice(0, width - 2)) + chalk.cyan("║"));
      } else {
        console.log(chalk.cyan("║") + chalk.gray(text.slice(0, width - 2)) + chalk.cyan("║"));
      }
    });
    for (let i = visible.length; i < 5; i++) {
      console.log(chalk.cyan("║") + " ".repeat(width - 2) + chalk.cyan("║"));
    }
  }

  console.log(chalk.cyan(`╠${chalk.cyan("═".repeat(width - 2))}╣`));
  console.log(chalk.cyan("║") + chalk.gray(helper.padEnd(width - 2)) + chalk.cyan("║"));
  console.log(chalk.cyan(`╚${border}╝`));
}

async function openCommandPalette() {
  if (!rl) return null;

  return new Promise((resolve) => {
    const stdin = process.stdin;
    let query = "";
    let index = 0;
    let matches = getPaletteMatches(query);

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
      popScreen();
      process.stdout.write("\x1b[2J\x1b[H");
    };

    const redraw = () => {
      matches = getPaletteMatches(query);
      if (index >= matches.length) index = Math.max(0, matches.length - 1);
      renderCommandPalette(query, matches, index);
    };

    const finish = (command) => {
      cleanup();
      resolve(command);
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      if (key.name === "escape") {
        finish(null);
        return;
      }

      if (key.name === "up") {
        index = (index - 1 + matches.length) % Math.max(matches.length, 1);
        redraw();
        return;
      }

      if (key.name === "down") {
        index = (index + 1) % Math.max(matches.length, 1);
        redraw();
        return;
      }

      if (key.name === "backspace") {
        query = query.slice(0, -1);
        index = 0;
        redraw();
        return;
      }

      if (key.name === "return") {
        if (matches.length === 0) {
          finish(null);
          return;
        }
        finish(matches[index] || matches[0]);
        return;
      }

      if (typeof str === "string" && str.length > 0 && !key.ctrl && !key.meta) {
        query += str;
        index = 0;
        redraw();
      }
    };

    pushScreen("palette");
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    redraw();
  });
}

// ---- Shared: stream agent output ----
async function streamAgent(agent, query, handlers = {}) {
  const stream = await agent.stream(
    { messages: [new HumanMessage(query)] },
    { configurable: { thread_id: "default" }, streamMode: "values" },
  );

  let finalText = "";

  for await (const chunk of stream) {
    const lastMsg = chunk.messages?.[chunk.messages.length - 1];
    if (!lastMsg) continue;
    if (lastMsg.tool_calls?.length > 0) {
      for (const tc of lastMsg.tool_calls) {
        const toolLine = "Tool: " + tc.name + "(" + JSON.stringify(tc.args || {}) + ")";
        handlers.onTool?.(toolLine);
      }
    }
    if (lastMsg.content && typeof lastMsg.content === "string" && lastMsg.content.trim()) {
      finalText = lastMsg.content;
      handlers.onText?.(finalText);
    }
  }

  return finalText;
}

// ---- Onboarding wizard ----
async function runOnboarding() {
  printHeader("Agent Studio - Setup Wizard");

  console.log(chalk.gray("Welcome! Agent Studio needs an OpenAI API key to work."));
  console.log(chalk.gray("Get yours at: https://platform.openai.com/api-keys\n"));

  const key = await askMasked("  API Key: ");

  if (key === null) {
    console.log(chalk.gray("\n  Setup cancelled."));
    process.exit(0);
  }

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

  if (key === null) {
    console.log(chalk.gray("  Cancelled."));
    return;
  }

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
  if (!rl) {
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

    return;
  }

  let status = "";

  const runTest = async () => {
    if (!CONFIG.openaiApiKey) {
      status = "No key to test. Use /connect to add one.";
      return;
    }
    status = "Verifying key...";
    renderKeys();
    try {
      const { ChatOpenAI } = await import("@langchain/openai");
      const model = new ChatOpenAI({
        model: "gpt-3.5-turbo",
        apiKey: CONFIG.openaiApiKey,
        maxTokens: 10,
      });
      const res = await model.invoke("Hello");
      status = "✓ Key is valid!" + (res?.usage?.model ? ` (${res.usage.model})` : "");
    } catch (e) {
      status = "✗ Key may be invalid: " + e.message;
    }
    renderKeys();
  };

  const removeKey = async () => {
    await clearApiKey();
    await loadConfig();
    status = "✓ Key removed";
    renderKeys();
  };

  const renderKeys = () => {
    const bodyLines = [
      CONFIG.openaiApiKey ? `Current key: ${getMaskedKey()}` : "No API key configured",
      "",
      "1) Test current key",
      "2) Remove current key",
      "3) Back",
      "",
      status || "Esc to go back",
    ];
    renderModalShell("Keys — Manage Stored Credentials", bodyLines, "Esc back  •  1 test  •  2 remove  •  3 back");
  };

  return new Promise((resolve) => {
    const stdin = process.stdin;

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
      popScreen();
      clearScreen();
      resolve();
    };

    const onKeypress = async (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      if (key.name === "escape" || key.name === "return" || str === "3") {
        cleanup();
        return;
      }

      if (str === "1") {
        await runTest();
        return;
      }

      if (str === "2") {
        await removeKey();
        return;
      }
    };

    pushScreen("keys");
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    renderKeys();
  });
}

async function cmdEnv() {
  const configFile = CONFIG.configFile;
  let fileExists = false;
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    fileExists = true;
  } catch {}

  if (!rl) {
    printHeader("Environment");
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
    return;
  }

  const bodyLines = [
    `OpenAI Key: ${CONFIG.openaiApiKey ? getMaskedKey() : "(not set)"}`,
    `Model: ${CONFIG.model}`,
    `Config file: ${fileExists ? configFile : "(not found)"}`,
    `Env var: ${process.env.OPENAI_API_KEY ? "OPENAI_API_KEY is set" : "(not set)"}`,
    `Keychain: ${CONFIG.keychainAvailable ? "available" : "unavailable"}`,
    `Config dir: ${CONFIG.configDir}`,
    "",
    "Key resolution order: env var -> keychain -> config file",
  ];

  await openInfoModal({
    screenName: "env",
    title: "Environment",
    bodyLines,
    footer: "Esc back  •  Enter back",
  });
}

async function runInteractiveStudio(initialMode) {
  const planAgent = createPlanAgent();
  const buildAgent = createBuildAgent();
  const interactive = !!rl;
  const studioState = {
    mode: initialMode,
    input: "",
    transcript: [],
    status: "ready",
  };

  if (interactive) {
    renderStudioWorkspace(studioState);
  } else {
    printHeader("Agent Studio - Interactive");
    console.log(chalk.gray("Model: " + CONFIG.model));
    console.log(chalk.gray("Tab mode  •  / menu  •  Ctrl+K menu  •  Esc back  •  /help  •  /exit\n"));
  }

  while (true) {
    const result = await promptStudioLine(studioState.mode, studioState);
    const { text, mode, command, cancelled } = result;
    studioState.mode = mode;

    if (cancelled) {
      if (interactive) renderStudioWorkspace(studioState);
      continue;
    }

    if (command) {
      await runStudioCommand(command);
      if (interactive) renderStudioWorkspace(studioState);
      continue;
    }

    const trimmed = text.trim();

    if (trimmed === "" || trimmed === "/exit" || trimmed === "exit" || trimmed === "quit") {
      break;
    }

    if (trimmed.startsWith("/connect")) { await cmdConnect(); continue; }
    if (trimmed.startsWith("/keys")) { await cmdKeys(); continue; }
    if (trimmed.startsWith("/env")) { await cmdEnv(); continue; }
    if (trimmed.startsWith("/help")) { showHelp(); continue; }

    const agent = studioState.mode === "plan" ? planAgent : buildAgent;
    if (interactive) {
      studioState.transcript.push({ role: "user", text: trimmed });
      studioState.status = "thinking";
      renderStudioWorkspace(studioState);
    } else {
      console.log("");
      console.log(chalk.gray(`  Mode: ${studioState.mode.toUpperCase()}`));
    }

    try {
      const toolLines = [];
      const response = await streamAgent(agent, trimmed, {
        onTool: (line) => toolLines.push(line),
        onText: () => {},
      });

      if (interactive) {
        toolLines.forEach((line) => studioState.transcript.push({ role: "tool", text: line }));
        if (response && response.trim()) {
          studioState.transcript.push({ role: "assistant", text: response.trim() });
        }
        studioState.status = "ready";
        renderStudioWorkspace(studioState);
      } else {
        toolLines.forEach((line) => console.log(chalk.yellow("  " + line)));
        if (response && response.trim()) {
          response.trim().split("\n").forEach((line) => console.log(chalk.green("  " + line)));
        }
        console.log("");
      }
    } catch (err) {
      if (interactive) {
        studioState.status = "error";
        studioState.transcript.push({ role: "system", text: "Error: " + err.message });
        renderStudioWorkspace(studioState);
      } else {
        console.log(chalk.red("Error: " + err.message) + "\n");
      }
    }
  }

  rl?.close();
  console.log(chalk.gray("\nGoodbye!"));
  process.exit(0);
}

// ---- Mode: Plan (interactive REPL) ----
async function planMode() {
  await runInteractiveStudio("plan");
}

// ---- Mode: Build ----
async function buildMode() {
  await runInteractiveStudio("build");
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
  rl?.close();
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
