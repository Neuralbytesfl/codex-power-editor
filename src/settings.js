import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const defaultSettings = {
  autoIndent: true,
  suggestions: true,
  watchFiles: true,
  regexSearch: true,
  searchAcrossTabs: true,
  maxParallelAI: 2,
  hoverDocs: true,
  knowledgeIndex: true,
  colorScheme: 0,
  tabSize: 4,
  learnedWords: {},
  learnedPhrases: {},
  pythonMembers: {}
};

export function settingsPath() {
  const root = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "cpx", "settings.json");
}

export async function loadSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), "utf8"));
    return { ...defaultSettings, ...parsed, learnedWords: parsed.learnedWords || {}, learnedPhrases: parsed.learnedPhrases || {}, pythonMembers: parsed.pythonMembers || {} };
  } catch {
    return structuredClone(defaultSettings);
  }
}

export async function saveSettings(settings) {
  const path = settingsPath();
  const words = Object.entries(settings.learnedWords || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5000);
  const phrases = Object.entries(settings.learnedPhrases || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2000);
  const compact = { ...settings, learnedWords: Object.fromEntries(words), learnedPhrases: Object.fromEntries(phrases) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(compact, null, 2)}\n`);
}

export const settingRows = [
  { key: "autoIndent", label: "Auto indentation", type: "boolean" },
  { key: "suggestions", label: "Word suggestions", type: "boolean" },
  { key: "watchFiles", label: "Watch external file changes", type: "boolean" },
  { key: "regexSearch", label: "Regex search", type: "boolean" },
  { key: "searchAcrossTabs", label: "Search across tabs", type: "boolean" },
  { key: "maxParallelAI", label: "Parallel AI jobs", type: "number", min: 1, max: 4 },
  { key: "hoverDocs", label: "Mouse hover documentation", type: "boolean" },
  { key: "knowledgeIndex", label: "Learn completions from files", type: "boolean" },
  { key: "colorScheme", label: "Color scheme", type: "choice", min: 0, max: 4 },
  { key: "tabSize", label: "Indent width", type: "number", min: 1, max: 8 }
];
