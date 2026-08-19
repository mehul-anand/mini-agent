import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextareaRenderable,
  ASCIIFontRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  RGBA,
  t,
  bold,
  fg,
} from "@opentui/core";
import { resolveApiKey, CONFIG, loadConfig } from "../config/config.js";
import { streamChat } from "../agent/chat.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { runAgentLoop } from "../agent/loop.js";

const C = {
  bg: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  accent: "#58a6ff",
  muted: "#8b949e",
  user: "#7ee787",
  agent: "#58a6ff",
  system: "#d29922",
  error: "#f85149",
};

let renderer, root, headerMode, headerStatus, transcript, composer;
let syntaxStyle;
const state = { mode: "PLAN", status: "ready", messages: [] };

function roleColor(role) {
  if (role === "user") return C.user;
  if (role === "agent") return C.agent;
  if (role === "system") return C.system;
  return C.muted;
}

function roleLabel(role) {
  if (role === "user") return "You";
  if (role === "agent") return "Agent";
  if (role === "system") return "System";
  return role;
}

function modeColor(mode) {
  return mode === "PLAN" ? C.accent : C.user;
}

export function setStatus(status) {
  state.status = status;
  if (headerStatus) headerStatus.content = status;
}

export function setMode(mode) {
  state.mode = mode;
  if (headerMode) {
    headerMode.content = `● ${mode}`;
    headerMode.fg = modeColor(mode);
  }
}

export function addMessage(role, text = "") {
  const color = roleColor(role);
  const block = new BoxRenderable(renderer, {
    width: "100%",
    flexDirection: "column",
    marginBottom: 1,
  });
  block.add(
    new TextRenderable(renderer, {
      content: t`${bold(fg(color)(roleLabel(role)))}`,
      fg: color,
    }),
  );

  let body;
  if (role === "agent") {
    body = new MarkdownRenderable(renderer, {
      width: "100%",
      content: text,
      syntaxStyle,
      streaming: true,
    });
  } else {
    body = new TextRenderable(renderer, {
      width: "100%",
      content: text,
      fg: C.text,
    });
  }
  block.add(body);
  transcript.add(block);

  state.messages.push({ role, content: text });
  const idx = state.messages.length - 1;

  return {
    append(token) {
      body.content = (body.content || "") + token;
      state.messages[idx].content = body.content;
    },
    setText(value) {
      body.content = value;
      state.messages[idx].content = value;
    },
    finish() {
      try {
        body.streaming = false;
      } catch {}
    },
  };
}

function welcome() {
  const box = new BoxRenderable(renderer, {
    width: "100%",
    flexDirection: "column",
    marginBottom: 1,
  });
  box.add(
    new ASCIIFontRenderable(renderer, {
      text: "AI Studio",
      font: "slick",
      color: RGBA.fromHex(C.accent),
    }),
  );
  box.add(
    new TextRenderable(renderer, {
      content: t`${fg(C.muted)("AI Studio — your terminal coding agent. Plug in your API key to start.")}`,
      fg: C.muted,
    }),
  );
  box.add(
    new TextRenderable(renderer, {
      content: t`${fg(C.muted)("Type a message and press Enter. Esc or C-c to quit.")}`,
      fg: C.muted,
    }),
  );
  transcript.add(box);
}

async function sendToAgent() {
  const apiKey = await resolveApiKey();
  if (!apiKey) {
    addMessage(
      "system",
      "No API key set. Export your OPENAI_API_KEY (or run /connect) to enable responses.",
    );
    setStatus("ready");
    return;
  }

  setStatus("thinking");
  const agentMsg = addMessage("agent", "");

  const history = state.messages.slice(0, -1).map((m) => ({
    role: m.role === "agent" ? "assistant" : m.role,
    content: m.content,
  }));
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

  try {
    await runAgentLoop({
      messages,
      model: CONFIG.model || "gpt-4o",
      apiKey,
      mode: state.mode,
      onToken: (token) => agentMsg.append(token),
      onToolCall: (name, args) => {
        setStatus("tool");
        addMessage("system", `⚙ ${name}(${args || ""})`);
      },
      onObservation: (name, out) => {
        addMessage("system", `↳ ${name} → ${out}`);
      },
      onDone: () => agentMsg.finish(),
      onError: (err) => {
        agentMsg.setText("Error: " + (err?.message || String(err)));
        agentMsg.finish();
      },
    });
  } catch (err) {
    agentMsg.setText("Error: " + (err?.message || String(err)));
    agentMsg.finish();
  }
  setStatus("ready");
}

function handleSubmit() {
  const text = (composer.plainText || "").trim();
  if (!text) return;
  composer.clear();
  addMessage("user", text);
  sendToAgent();
}

export async function runApp() {
  process.on("uncaughtException", (e) => {
    try {
      renderer?.destroy();
    } catch {}
    console.error("Error:", e?.message || e);
    process.exit(1);
  });

  renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: C.bg,
  });

  syntaxStyle = SyntaxStyle.fromStyles({
    "markup.heading.1": { fg: RGBA.fromHex("#58A6FF"), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex("#58A6FF"), bold: true },
    "markup.list": { fg: RGBA.fromHex("#FF7B72") },
    "markup.raw": { fg: RGBA.fromHex("#A5D6FF") },
    "markup.bold": { fg: RGBA.fromHex("#E6EDF3"), bold: true },
    default: { fg: RGBA.fromHex("#E6EDF3") },
  });

  root = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: C.bg,
  });
  renderer.root.add(root);

  const header = new BoxRenderable(renderer, {
    width: "100%",
    height: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: C.panel,
  });
  const title = new TextRenderable(renderer, {
    content: t`${bold(fg(C.accent)("AI Studio"))}`,
    fg: C.accent,
  });
  headerMode = new TextRenderable(renderer, {
    content: `● ${state.mode}`,
    fg: modeColor(state.mode),
  });
  headerStatus = new TextRenderable(renderer, {
    content: state.status,
    fg: C.muted,
  });
  header.add(title);
  header.add(headerMode);
  header.add(headerStatus);

  transcript = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    padding: 1,
    backgroundColor: C.bg,
  });
  transcript.content.flexDirection = "column";

  composer = new TextareaRenderable(renderer, {
    width: "100%",
    height: 3,
    placeholder: "Type a message — Enter to send · Esc to quit",
    backgroundColor: C.panel,
    focusedBackgroundColor: "#1c2333",
    textColor: C.text,
    cursorColor: C.accent,
    wrapMode: "word",
    onSubmit: handleSubmit,
    keyBindings: [{ name: "return", action: "submit" }],
  });

  root.add(header);
  root.add(transcript);
  root.add(composer);

  welcome();

  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "escape") renderer.destroy();
  });

  composer.focus();

  await loadConfig();

  return { renderer, state, addMessage, setStatus, setMode };
}
