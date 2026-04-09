<div align="center">
  <img width="1200" alt="HomerAI Banner" src="https://github.com/OzzyRHB/HomerAI/blob/screenshots/homerai.png?raw=true" />
</div>

<br>

<div align="center">
  <h1>HomerAI</h1>
  <p><strong>Create and play elaborate AI-generated stories and adventures — fully local, fully yours.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/version-0.5.021-orange" />
    <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows-blue" />
    <img src="https://img.shields.io/badge/AI-local%20only-green" />
    <img src="https://img.shields.io/badge/license-MIT-lightgrey" />
  </p>
</div>

---

## What is HomerAI?

HomerAI is a locally-run interactive fiction engine powered by your own AI models.

I created HomerAI for myself, because I was looking for a platform that can run on my desktop as well as on mobile for when I'm chilling in the garden. It started to get more and more fleshed out and I decided to put it up here, if anyone is interested.

Just connect with WiFi on the same network, open browser, play.

---

## Features

### Layouts & Interface

**Desktop & Mobile UI**
Two fully independent layouts — a wide desktop view and a compact mobile view — both running in your browser. Swap between them at any time. The mobile layout is optimised for touch and works well over local WiFi on your phone or tablet.

**Theme Customisation**
Fully customisable interface. Set your accent colour with a colour wheel or hex input, adjust background and text colour, and control font size. Quick presets are available for fast switching. Settings persist across sessions.

---

### AI & Model Management

**Local Models Only**
HomerAI runs entirely on your machine using GGUF models via node-llama-cpp. No API keys, no cloud, no data leaving your device. Models are stored in `~/models/` (Linux) or `C:\Users\YourName\models\` (Windows).

**Smart Model Loading**
Models are loaded on demand with automatic GPU layer allocation based on model size. A request queue prevents conflicts — only one inference runs at a time, and a 5-minute timeout prevents hung requests from blocking the queue forever.

**Model Selector**
Switch models mid-adventure from the header. The current model is always visible. A searchable dropdown handles large model libraries.

**Rolling Models**
Automatically cycle through a list of models every N turns. Useful for mixing creative styles or working around VRAM limits across a long session.

---

### Story Engine

**Action Types**
Three ways to interact with the story: **Do** (perform an action), **Say** (speak as your character), and **Story** (add a narrative beat directly). Each is labelled and formatted differently in the story log.

**Continue**
Ask the AI to advance the story without player input — useful for letting a scene breathe or pushing past a pause.

**Retry**
Discard the last AI response and generate a fresh one with a variation instruction, so the model tries a different approach.

**Undo / Redo**
Step backwards and forwards through your story history. Up to 20 undo steps are stored per session.

**Edit Entries**
Any entry in the story log — player or AI — can be edited or deleted directly. Useful for correcting mistakes or steering the story after the fact.

**d20 Dice Mechanic**
Keyword-triggered dice rolls on action inputs. When you attempt something risky, a d20 is rolled and the outcome (Critical Failure, Failure, Success, Critical Success) is injected into the prompt so the AI writes the scene to match. An animated dice modal shows the roll before generation continues.

---

### Context & Memory

**Rolling Context Window**
The most recent N entries are passed to the model each turn. AI responses are condensed to their first two sentences in the history window so the model stays focused on what's happening now rather than looping back to old scenes.

**Story Summarization**
Every N turns (configurable), the AI automatically compresses the full story so far into a short factual summary. This summary is injected into every prompt so long adventures stay coherent even when early events fall out of the context window. The summary can be manually triggered or edited at any time.

**Plot Essentials**
A persistent free-text field injected into every prompt. Use it for world rules, character facts, or anything the AI must never forget — regardless of how long the adventure runs.

**Author's Note**
Style and tone guidance injected at the end of the system prompt, immediately before the AI completion cue, for maximum influence on the model's output. Controls genre, atmosphere, and writing style.

**AI Instructions**
Full control over the AI's core behaviour — its role, rules, and priorities. A sensible default is provided, or write your own from scratch.

---

### Story Cards & Lore

**Story Cards**
Named lore entries (characters, locations, items, factions, races, or custom) with keyword triggers. When a keyword appears in recent story history, that card's content is injected into the prompt automatically — so the AI always has the right context at the right time.

**AutoCards**
Characters mentioned three or more times in the story are automatically detected and a structured story card is generated for them without any player input. Cards include name, estimated age, appearance keywords, personality keywords, and key story events. Cards are fleshed out further after 15–25 turns with updated detail.

**Card+**
Character cards prefixed with `@` get a hidden NPC brain — a small JSON object tracking the character's current mood, goals, secrets, and opinion of the player. This brain is updated silently after every AI turn and injected privately into the prompt so the AI portrays NPCs with authentic, evolving inner states. The brain is never shown to the player directly.

**Import / Export Cards**
Export all story cards from an adventure as a JSON file and reimport them into any other adventure or scenario. Build reusable lore libraries across playthroughs.

---

### Story Beats

**Story Beats**
Plan major plot points before the story begins. Each beat has a target turn and a randomised fire window so events never feel mechanical. Beats are organised into parallel tracks — Main Plot, Relationship, World/Lore, and Danger — which run independently so multiple narrative threads can develop at the same time without conflicting.

**Foreground & Background**
At any given turn, the most urgently expiring active beat becomes the **foreground** — the AI steers the scene gradually toward it without resolving it in one exchange. All other active beats across tracks run in the **background**, woven in subtly when natural.

**Foreshadowing**
Each beat has an optional foreshadow zone. A configurable number of turns before a beat goes live, a vague atmospheric hint is injected into the prompt — so the story feels like it was building toward something all along.

**Beat Lifecycle**
Beats move through five states: `pending → foreshadowing → active → completed / expired`. Beats can expire automatically when their window closes, or be marked complete early by the player with a single click.

**Linked Card Resolutions**
Each beat can be linked to a story card. When the beat completes, a resolution note is permanently appended to that card's Info section — so a relationship that developed during a beat, or an alliance that formed, stays in context for the rest of the adventure whenever that character appears. The player writes the resolution in their own words; a fallback is generated automatically if left blank.

**Beat Planning in Scenario Creator**
Story beats can be designed in the scenario editor before an adventure begins, so a full story arc is already in place the moment play starts.

**Import / Export Beats**
Export and reimport beat setups as JSON. Reuse a story structure across multiple playthroughs or share it with others.

---

### Scenarios & Adventures

**Scenarios**
Reusable story templates. Define the premise, world rules, lore cards, story beats, and settings once — then launch multiple adventures from the same starting point. Scenarios can be edited, duplicated, imported, and exported.

**Adventures**
Active playthroughs derived from a scenario or created from scratch. Each adventure stores its full story log, summary, story cards, beat state, and settings independently. Adventures auto-save to the server after every AI turn.

**Placeholder System**
Scenarios can include `${placeholder}` variables in any text field. When a player starts an adventure from a scenario containing placeholders, a modal prompts them to fill in the values before play begins — enabling personalised story openers without editing the scenario directly.

**Cover Images**
Adventures and scenarios support a cover image with a built-in crop tool. Images are displayed in the library and as a blurred background in the game view.

**Import / Export Adventures**
Export any adventure as a JSON file and reimport it on any device running HomerAI. Full story log, cards, beats, and settings are preserved.

---

## Screenshots

### Desktop

| | |
|---|---|
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop01.png) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop02.png) |
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop03.png) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop04.png) |
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop05.png) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop06.png) |
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop07.png) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop08.png) |
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop09.png) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop10.png) |
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/desktop11.png) |  |

### Mobile

| | | |
|---|---|---|
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/mobile01.jpg) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/mobile02.jpg) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/mobile03.jpg) |
| ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/mobile04.jpg) | ![](https://raw.githubusercontent.com/OzzyRHB/HomerAI/screenshots/screenshots/mobile05.jpg) | |

---

## Installation

### Linux

**Prerequisites:** Node.js, an NVIDIA GPU with CUDA (recommended)

```bash
# 1. Clone the repo
git clone https://github.com/OzzyRHB/HomerAI.git
cd HomerAI

# 2. Install dependencies
npm install

# 3. Place your .gguf models in your home folder
mkdir ~/models
# copy your .gguf files into ~/models/

# 4. Run
npm run dev
```

Then open `http://localhost:3000` in your browser.

---

### Windows

**Prerequisites:** Node.js, Visual Studio Build Tools, CUDA Toolkit (NVIDIA GPU)

1. Install [Node.js LTS](https://nodejs.org)
2. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — tick **Desktop development with C++**
3. Install [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) if using an NVIDIA GPU
4. Clone the repo and install:
```bash
git clone https://github.com/OzzyRHB/HomerAI.git
cd HomerAI
npm install
```
5. Place your `.gguf` models in `C:\Users\YourName\models\`
6. Run:
```bash
npm run dev
```

> **Note:** Linux is the recommended platform. Windows works but node-llama-cpp requires the C++ build tools to compile correctly.

---

## Roadmap

| Version | Focus |
|---|---|
| 0.1 | Basic functions and desktop UI |
| 0.2 | Mobile UI and fleshing out functions |
| 0.3 | Model loading optimization |
| 0.4 | Dice mechanic |
| 0.5 | AutoCards, Card+ and Story Beats |
| 0.6 | Story quality improvements _(upcoming)_ |
| 0.7 | Scenario builder polish _(upcoming)_ |
| 1.0 | Long adventure optimization _(upcoming)_ |

---

## Built With

- [React](https://react.dev) + [Vite](https://vitejs.dev) — frontend
- [Express](https://expressjs.com) — backend server
- [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) — local LLM inference
- [Tailwind CSS](https://tailwindcss.com) — styling
- [Framer Motion](https://www.framer.com/motion/) — animations
