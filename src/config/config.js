import path from "path";
import os from "os";
import fs from "fs";

// ---- Config directory (platform-specific) ----
function getConfigDir() {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "mini-agent");
    case "win32":
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "mini-agent");
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "mini-agent");
  }
}

export const CONFIG_DIR = getConfigDir();
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const KEYCHAIN_SERVICE = "mini-agent";

// ---- Keytar (OS keychain) — loaded lazily, optional ----
let keytar = null;
try {
  const mod = await import("keytar");
  keytar = mod.default || mod;
} catch {
  keytar = null;
}

// ---- Config file helpers ----
function readConfigFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    /* ignore parse errors */
  }
  return {};
}

function writeConfigFile(config) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error("Failed to write config file:", e.message);
  }
}

// ---- Resolve API key (priority: env var → keychain → config file) ----
export async function resolveApiKey() {
  // 1. Environment variable (highest priority — works with direnv, CI)
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  // 2. OS keychain (encrypted by the operating system)
  if (keytar) {
    try {
      const stored = await keytar.getPassword(KEYCHAIN_SERVICE, "openai-api-key");
      if (stored) return stored;
    } catch {
      /* keychain error — try next source */
    }
  }

  // 3. Config file (plaintext, but file permissions are restricted to 600)
  const config = readConfigFile();
  if (config.apiKey) return config.apiKey;

  return null;
}

// ---- Synchronous key resolution (env var + config file only) ----
export function resolveApiKeySync() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const config = readConfigFile();
  return config.apiKey || null;
}

// ---- Mutable config object (live binding — changes are visible to importers) ----
export const CONFIG = {
  openaiApiKey: resolveApiKeySync(),
  model: process.env.OPENAI_MODEL || "gpt-4o",
  isConfigured: false,
  configDir: CONFIG_DIR,
  configFile: CONFIG_FILE,
  keychainAvailable: keytar !== null,
};

// ---- Load / refresh config (async — includes keychain lookup) ----
export async function loadConfig() {
  CONFIG.openaiApiKey = await resolveApiKey();
  CONFIG.model = process.env.OPENAI_MODEL || readConfigFile().model || "gpt-4o";
  CONFIG.isConfigured = !!CONFIG.openaiApiKey;
  return CONFIG;
}

// ---- Save API key (primary: keychain → fallback: config file) ----
export async function saveApiKey(apiKey) {
  const trimmed = apiKey.trim();

  // Primary: OS keychain
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, "openai-api-key", trimmed);
      console.log("✓ API key saved to OS keychain (encrypted by your system)");
      return { method: "keychain", success: true };
    } catch (e) {
      console.log("  Keychain unavailable, falling back to config file...");
    }
  }

  // Fallback: config file with restricted permissions
  writeConfigFile({ apiKey: trimmed, model: CONFIG.model });
  fs.chmodSync(CONFIG_FILE, 0o600);
  console.log("✓ API key saved to " + CONFIG_FILE + " (permissions: 600)");
  return { method: "config-file", success: true };
}

// ---- Clear stored API key ----
export async function clearApiKey() {
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, "openai-api-key");
    } catch {
      /* ignore */
    }
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = readConfigFile();
      delete config.apiKey;
      if (Object.keys(config).length > 0) {
        writeConfigFile(config);
      } else {
        fs.unlinkSync(CONFIG_FILE);
      }
    }
  } catch {
    /* ignore cleanup errors */
  }

  await loadConfig();
  return CONFIG;
}

// ---- Validate configuration ----
export const validateConfig = () => {
  if (!CONFIG.openaiApiKey) {
    throw new Error("No API key configured. Run `node cli.js /connect` to set it up.");
  }
  return true;
};

// ---- Get masked key for display ----
export function getMaskedKey() {
  if (!CONFIG.openaiApiKey) return null;
  const k = CONFIG.openaiApiKey;
  if (k.length <= 8) return "*".repeat(k.length);
  return k.slice(0, 4) + "*".repeat(k.length - 8) + k.slice(-4);
}

// ---- Load config on module import (sync part — env + file only) ----
loadConfig();
