// HomerAI server — v0.5.006
// Changes vs 0.5.005:
//   • FIX: use os.homedir() instead of process.env.HOME || "~" (Node never expands ~)
//   • FIX: generate queue now sends an error response on failure (no more hung clients)
//   • FIX: sanitizeFilename adds a short hash suffix to prevent title-collision overwrites
//   • FIX: /api/generate has a configurable inference timeout (default 5 min)
//   • FIX: context size is now capped per model tier to avoid VRAM OOM on 24B models

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";                          // ← NEW: replaces process.env.HOME fallback
import crypto from "crypto";                  // ← NEW: for collision-safe filenames
import { fileURLToPath } from "url";
import { getLlama, LlamaModel, LlamaChatSession } from "node-llama-cpp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Global AI state ───────────────────────────────────────────────────────────
let currentLlama: any = null;
let currentModel: LlamaModel | null = null;
let currentModelPath: string | null = null;
let currentContext: any = null;
let currentContextSize: number = 0;

// ── Global error guards ───────────────────────────────────────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * FIX: Append a 4-char hash of the full title so that "My Story!" and "MyStory"
 * can no longer silently overwrite each other.
 */
function sanitizeFilename(name: string): string {
  const slug = name.replace(/[^a-z0-9]/gi, "");
  const hash = crypto.createHash("sha1").update(name).digest("hex").slice(0, 4);
  return `${slug}_${hash}`;
}

async function disposeContext() {
  if (currentContext) {
    try { await currentContext.dispose(); } catch {}
    currentContext = null;
    currentContextSize = 0;
  }
}

async function disposeModel() {
  await disposeContext();
  if (currentModel) {
    try { (currentModel as any).dispose?.(); } catch {}
    currentModel = null;
    currentModelPath = null;
  }
}

// ── GPU layer calculator ──────────────────────────────────────────────────────
function getGpuLayers(modelName: string): number {
  if (modelName.includes("24B") || modelName.includes("24b")) return 14;
  if (modelName.includes("13B") || modelName.includes("13b")) return 24;
  return 28;
}

// ── Context size limiter ──────────────────────────────────────────────────────
// FIX: Large models (24B) use most VRAM for weights; the KV cache for the
// context must fit in whatever is left. Capping per model tier prevents the
// "context size too large for available VRAM" crash.
//
// Tuning guide (adjust if you have more/less VRAM):
//   24B @ 14 layers  →  2048  (safe on 12-16 GB VRAM)
//   13B @ 24 layers  →  3072
//   ≤12B @ 28 layers →  4096  (or larger if your GPU allows)
//
function getSafeContextSize(modelName: string, requested: number): number {
  if (modelName.includes("24B") || modelName.includes("24b")) {
    const cap = 2048;
    if (requested > cap) {
      console.warn(`[AI] Context size ${requested} capped to ${cap} for 24B model (VRAM limit)`);
    }
    return Math.min(requested, cap);
  }
  if (modelName.includes("13B") || modelName.includes("13b")) {
    const cap = 3072;
    if (requested > cap) {
      console.warn(`[AI] Context size ${requested} capped to ${cap} for 13B model (VRAM limit)`);
    }
    return Math.min(requested, cap);
  }
  return requested; // ≤12B: trust the requested size
}

// ── Inference timeout helper ──────────────────────────────────────────────────
const INFERENCE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[AI] Inference timeout after ${ms / 1000}s (${label})`)),
      ms
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ── Server bootstrap ──────────────────────────────────────────────────────────
async function startServer() {
  console.log("[Server] Starting server initialization...");
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  const savesDir = path.join(process.cwd(), "saves");

  // FIX: os.homedir() always resolves correctly; process.env.HOME || "~" did not.
  const modelsDir = path.join(os.homedir(), "models");

  // ── Ensure directories exist ─────────────────────────────────────────────────
  console.log("[Server] Checking directories...");
  await fs.promises.mkdir(savesDir, { recursive: true });
  await fs.promises.mkdir(modelsDir, { recursive: true });

  // ── Migrate legacy saves dir if needed ───────────────────────────────────────
  const oldSavesDir = path.join(process.cwd(), "game", "saves");
  if (fs.existsSync(oldSavesDir)) {
    console.log(`[Server] Migrating saves from ${oldSavesDir} → ${savesDir}`);
    try {
      const files = await fs.promises.readdir(oldSavesDir);
      for (const file of files) {
        await fs.promises.rename(
          path.join(oldSavesDir, file),
          path.join(savesDir, file)
        );
      }
      await fs.promises.rmdir(oldSavesDir);
      const gameDir = path.join(process.cwd(), "game");
      if ((await fs.promises.readdir(gameDir)).length === 0) {
        await fs.promises.rmdir(gameDir);
      }
    } catch (e) {
      console.error("[Server] Failed to migrate saves:", e);
    }
  }

  // ── API routes ────────────────────────────────────────────────────────────────
  console.log("[Server] Registering API routes...");

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.5.006" });
  });

  // ── Save / load data ─────────────────────────────────────────────────────────
  app.get("/api/data", async (_req, res) => {
    try {
      const files = await fs.promises.readdir(savesDir);
      const adventures: any[] = [];
      const scenarios: any[] = [];

      for (const file of files) {
        const filePath = path.join(savesDir, file);
        if (file.startsWith("Adventure_") && file.endsWith(".json")) {
          try { adventures.push(JSON.parse(await fs.promises.readFile(filePath, "utf-8"))); }
          catch (e) { console.error(`Failed to parse: ${file}`, e); }
        } else if (file.startsWith("Scenario_") && file.endsWith(".json")) {
          try { scenarios.push(JSON.parse(await fs.promises.readFile(filePath, "utf-8"))); }
          catch (e) { console.error(`Failed to parse: ${file}`, e); }
        }
      }

      // Legacy fallbacks
      if (adventures.length === 0) {
        const p = path.join(savesDir, "adventures.json");
        if (fs.existsSync(p)) {
          try { adventures.push(...JSON.parse(await fs.promises.readFile(p, "utf-8"))); } catch {}
        }
      }
      if (scenarios.length === 0) {
        const p = path.join(savesDir, "scenarios.json");
        if (fs.existsSync(p)) {
          try { scenarios.push(...JSON.parse(await fs.promises.readFile(p, "utf-8"))); } catch {}
        }
      }

      res.json({ adventures, scenarios });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch data" });
    }
  });

  app.post("/api/adventures", async (req, res) => {
    try {
      const adventures = req.body;
      const files = await fs.promises.readdir(savesDir);
      for (const file of files) {
        if ((file.startsWith("Adventure_") && file.endsWith(".json")) || file === "adventures.json") {
          await fs.promises.unlink(path.join(savesDir, file));
        }
      }
      for (const adv of adventures) {
        const filename = `Adventure_${sanitizeFilename(adv.title || "Untitled")}.json`;
        await fs.promises.writeFile(path.join(savesDir, filename), JSON.stringify(adv, null, 2));
      }
      res.json({ status: "ok" });
    } catch {
      res.status(500).json({ error: "Failed to save adventures" });
    }
  });

  app.post("/api/scenarios", async (req, res) => {
    try {
      const scenarios = req.body;
      const files = await fs.promises.readdir(savesDir);
      for (const file of files) {
        if ((file.startsWith("Scenario_") && file.endsWith(".json")) || file === "scenarios.json") {
          await fs.promises.unlink(path.join(savesDir, file));
        }
      }
      for (const scn of scenarios) {
        const filename = `Scenario_${sanitizeFilename(scn.title || "Untitled")}.json`;
        await fs.promises.writeFile(path.join(savesDir, filename), JSON.stringify(scn, null, 2));
      }
      res.json({ status: "ok" });
    } catch {
      res.status(500).json({ error: "Failed to save scenarios" });
    }
  });

  // ── Model management ─────────────────────────────────────────────────────────
  app.get("/api/models", async (_req, res) => {
    try {
      const files = await fs.promises.readdir(modelsDir);
      const llms = files.filter((f) => f.endsWith(".gguf") || f.endsWith(".bin"));
      res.json({ llms, current: currentModelPath ? path.basename(currentModelPath) : null });
    } catch (error) {
      console.error("[Server] Failed to list models:", error);
      res.status(500).json({ error: "Failed to list models" });
    }
  });

  app.post("/api/load-model", async (req, res) => {
    const { modelName } = req.body || {};
    if (!modelName) return res.status(400).json({ error: "Model name is required" });

    const modelPath = path.join(modelsDir, modelName);
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({ error: `Model not found: ${modelName}` });
    }

    if (currentModelPath === modelPath) {
      console.log(`[AI] Model already loaded: ${modelName}`);
      return res.json({ success: true });
    }

    try {
      console.log(`[AI] Loading model: ${modelName}`);
      await disposeModel();
      if (!currentLlama) currentLlama = await getLlama();
      currentModel = await currentLlama.loadModel({
        modelPath,
        gpuLayers: getGpuLayers(modelName),
      });
      currentModelPath = modelPath;
      console.log(`[AI] Model loaded: ${modelName}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error(`[AI] Error loading model: ${error.message}`);
      currentModel = null;
      currentModelPath = null;
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/unload-model", async (_req, res) => {
    await disposeModel();
    console.log("[AI] Model unloaded");
    res.json({ success: true });
  });

  // ── Generate request queue ────────────────────────────────────────────────────
  // FIX: Queue now correctly forwards errors to the HTTP response.
  // Previously .catch(() => {}) meant a crashed inference left the client hanging.
  let generateQueue: Promise<void> = Promise.resolve();

  app.post("/api/generate", (req, res) => {
    generateQueue = generateQueue
      .then(() => handleGenerate(req, res))
      .catch((err) => {
        // This path is a safety net; handleGenerate should handle its own errors.
        if (!res.headersSent) {
          console.error("[Queue] Unhandled generate error:", err);
          res.status(500).json({ error: "Internal queue error" });
        }
      });
  });

  async function handleGenerate(req: any, res: any) {
    const {
      modelName, prompt, systemInstruction,
      temperature, topK, topP, minP,
      frequencyPenalty, presencePenalty, repetitionPenalty,
      stopSequences, memoryTokens, maxOutputTokens,
    } = req.body || {};

    if (!modelName) return res.status(400).json({ error: "Model name is required" });

    try {
      const modelPath = path.join(modelsDir, modelName);
      if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${modelName}`);

      if (currentModelPath !== modelPath) {
        console.log(`[AI] Switching model to: ${modelName}`);
        await disposeModel();
        if (!currentLlama) currentLlama = await getLlama();
        currentModel = await currentLlama.loadModel({ modelPath, gpuLayers: getGpuLayers(modelName) });
        currentModelPath = modelPath;
      }

      if (!currentModel) throw new Error("Model failed to load");

      // FIX: cap context size to what the model tier can safely fit in VRAM.
      const rawContextSize = memoryTokens ? Math.max(4096, memoryTokens + 512) : 4096;
      const contextSize = getSafeContextSize(modelName, rawContextSize);

      await disposeContext();
      console.log(`[AI] Creating context (size: ${contextSize})…`);
      currentContext = await currentModel.createContext({ contextSize });
      currentContextSize = contextSize;

      console.log("[AI] Creating chat session…");
      const session = new LlamaChatSession({
        contextSequence: currentContext.getSequence(),
        systemPrompt: systemInstruction,
      });

      console.log("[AI] Prompting model…");

      // FIX: Wrap inference in a timeout so a hung model doesn't block the queue forever.
      const response = await withTimeout(
        session.prompt(prompt, {
          maxTokens: maxOutputTokens || 256,
          temperature: temperature ?? 0.8,
          topK: topK ?? 40,
          topP: topP ?? 0.95,
          minP: minP ?? 0.05,
          repeatPenalty: {
            penalty: repetitionPenalty ?? 1.1,
            frequencyPenalty: frequencyPenalty ?? 0.0,
            presencePenalty: presencePenalty ?? 0.0,
          },
          stop: stopSequences || [],
        } as any),
        INFERENCE_TIMEOUT_MS,
        modelName
      );

      console.log("[AI] Inference complete");
      res.json({ text: response });
    } catch (error: any) {
      console.error(`[AI] Inference error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  }

  // ── Vite dev middleware ───────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Initializing Vite middleware…");
    try {
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          watch: {
            ignored: (filePath: string) => {
              const rel = path.relative(process.cwd(), filePath);
              return (
                rel.startsWith("models") ||
                rel.startsWith("saves") ||
                rel.startsWith("dist") ||
                rel.startsWith("node_modules") ||
                filePath.endsWith(".gguf") ||
                filePath.endsWith(".bin")
              );
            },
          },
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("[Server] Vite middleware ready.");
    } catch (viteError) {
      console.error("[Server] Failed to initialize Vite:", viteError);
    }
  } else {
    console.log("[Server] Serving static files from dist…");
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
    } else {
      console.warn("[Server] dist/ not found — run 'npm run build' first.");
    }
  }

  // ── Start listening ──────────────────────────────────────────────────────────
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\nServer running → http://localhost:${PORT}\n`);
  });
}

console.log("[Server] Launching startServer()…");
startServer().catch((err) => {
  console.error("[Server] Fatal error during startup:", err);
  process.exit(1);
});
