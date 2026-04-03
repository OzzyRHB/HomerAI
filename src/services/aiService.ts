import { GameState, StoryCard } from "../types";
import { advanceBeats, computeBeatEngineState, buildBeatInjection, getCurrentTurn } from "./beatEngine";

export async function generateStoryResponse(state: GameState, diceRoll?: number, signal?: AbortSignal, isRetry: boolean = false) {
  const settings = state.settings || {
    model: "",
    models: [],
    useRollingModels: false,
    temperature: 0.8,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 256,
    memoryLimit: 10,
    memoryTokens: 1024,
    minP: 0.05,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    repetitionPenalty: 1.1,
    stopSequences: [],
    useDice: false
  };
  
  let model = settings.model;

  if (settings.useRollingModels && settings.models && settings.models.length > 0) {
    const aiEntriesCount = state.entries.filter(e => e.type === 'ai').length;
    model = settings.models[aiEntriesCount % settings.models.length];
  }
  
  if (!model) {
    return "Please select a local model in settings.";
  }

  // ── Story Beats: advance lifecycle and compute foreground/background state ──
  const currentTurn = getCurrentTurn(state.entries);
  const advancedTracks = state.beatTracks ? advanceBeats(state.beatTracks, currentTurn) : [];
  const beatState = computeBeatEngineState(advancedTracks);
  const beatInjection = buildBeatInjection(beatState);

  // 1. Identify relevant story cards
  const memoryLimit = settings.memoryLimit || 10;
  const memoryTokens = settings.memoryTokens || 1024;
  const charLimit = memoryTokens * 4; // Rough estimate

  const recentHistoryForCards = state.entries.slice(-memoryLimit).map(e => e.text).join(" ");
  const relevantCards = state.storyCards.filter(card => 
    card.keys.some(key => {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKey}\\b`, 'i');
      return regex.test(recentHistoryForCards);
    })
  );

  // 2. Build the system prompt
  // Dice: compute a short outcome label only.
  // The actual directive goes into the user prompt right before AI: — local
  // models follow end-of-prompt instructions far more reliably than system ones.
  const diceOutcomeLabel = diceRoll === undefined ? null
    : diceRoll === 1  ? `CRITICAL FAILURE (roll: ${diceRoll}) — action fails AND something extra bad happens`
    : diceRoll <= 9   ? `FAILURE (roll: ${diceRoll}) — the action simply does not work`
    : diceRoll <= 19  ? `SUCCESS (roll: ${diceRoll}) — the action works`
    :                   `CRITICAL SUCCESS (roll: ${diceRoll}) — action works AND something extra good happens`;

  // ── Card+: inject active NPC brains into context ────────────────────────
  // Cards prefixed with @ are NPC cards. If they have a brain (notes JSON) and
  // appear in recent history, their inner state is fed to the model so it can
  // authentically portray their mood, goals, and secrets.
  const recentTextForNpcs = state.entries.slice(-5).map(e => e.text).join(' ').toLowerCase();
  const activeNpcCards = state.storyCards.filter(card => {
    if (!card.title.startsWith('@') || !card.notes) return false;
    const name = card.title.replace(/^@/, '').toLowerCase();
    return recentTextForNpcs.includes(name) ||
           card.keys.some(k => recentTextForNpcs.includes(k.toLowerCase()));
  });
  const npcBrainContext = activeNpcCards.length > 0
    ? `\nACTIVE NPC INNER STATES (use privately to guide authentic behavior — never reveal directly):\n${activeNpcCards.map(c => {
        const name = c.title.replace(/^@/, '');
        try {
          const brain = JSON.parse(c.notes!);
          return `[${name}]: ${Object.entries(brain).map(([k, v]) => `${k}: "${v}"`).join(' | ')}`;
        } catch { return `[${name}]: ${c.notes}`; }
      }).join('\n')}`
    : '';

  const systemInstruction = `
You are an advanced interactive fiction engine. Your goal is to weave a compelling, immersive narrative that evolves based on the player's choices.

STRICT OPERATIONAL DIRECTIVES:
1. PLAYER AGENCY IS SUPREME: The player's most recent action is the SOLE driver of what happens next. You MUST resolve the player's action immediately in your opening sentence. The player can steer the story in ANY direction — follow their lead completely, even if it contradicts earlier scenes or plot points.
2. FORWARD ONLY: NEVER recap, summarize, or revisit earlier scenes. NEVER re-describe something already narrated. Every sentence must advance the story BEYOND where it currently is. If you catch yourself writing something that already happened, STOP and write something new instead.
3. PACING & ATMOSPHERE: After resolving the player's action, slow down. Describe the environment using sensory details (sight, sound, smell, texture). Build tension and atmosphere.
4. DIALOGUE-RICH: NPCs should speak often. Use dialogue to reveal character, provide information, and build relationships. Ensure NPC speech is distinct and fits their personality.
5. EVOLUTION OVER RIGIDITY: If the player's actions lead the narrative in a new direction, follow it enthusiastically. Do not force the story back "on rails." The player's choices can completely redirect the plot.
6. SECOND PERSON, PRESENT TENSE: Always use "You..." and describe events as they happen now.
7. NO REPETITION: Never repeat phrases, descriptions, or sentence structures from the Recent Events. Each response must feel like a brand new scene.
8. RESOLVE THEN ADVANCE: Describe the direct consequences of the player's action FIRST, then introduce new elements, reactions, or developments.
${isRetry ? "9. VARIATION: This is a RETRY. The player didn't like the previous outcome. Try a completely different approach or narrative path while still respecting the player's latest action." : ""}


CORE CONTEXT:
- ${state.entries.filter(e => e.type === 'ai' && e.id !== 'start').length === 0 ? 'STARTING PREMISE' : 'ORIGINAL PREMISE (ALREADY HAPPENED — do not re-narrate, do not re-introduce characters, story has moved past this)'}: ${state.premise}
- WORLD RULES (AI INSTRUCTIONS): ${state.aiInstructions || "Be a helpful and creative story teller."}
- PLOT ESSENTIALS: ${state.plotEssentials || "None provided."}
- AUTHOR'S NOTE (STYLE): ${state.authorsNote || "None provided."}

STORY SO FAR (SUMMARY):
${state.summary || "No summary yet."}

ACTIVE LORE (STORY CARDS):
${relevantCards.length > 0 ? relevantCards.map(c => {
    const is24BModel = model.includes('24B') || model.includes('24b');
    const content = is24BModel && c.content.length > 120 ? c.content.slice(0, 120) + '…' : c.content;
    return `[${c.type.toUpperCase()}: ${c.title}]: ${content}`;
  }).join("\n") : "No specific lore triggered for this turn."}
${npcBrainContext}

MANDATORY FORMATTING:
- NPCs speak with distinct voices.
- Use 1-3 paragraphs per response.
- Your FIRST sentence must directly react to or resolve the player's latest action.
- End with a complete sentence and proper punctuation.
- DO NOT speak for the player unless it is a direct, unavoidable physical reaction.
- DO NOT begin your response by re-describing the current scene or setting. Jump straight into the consequences of the player's action.
`;

  // 3. Format the history — condense AI entries, keep player actions verbatim
  // AI entries are trimmed to keep context short. For 24B models (limited VRAM),
  // only 1 sentence per AI entry is kept; for smaller models, 2 sentences.
  // Filter out the 'start' entry — it's identical to the premise in the system prompt.
  const is24B = model.includes('24B') || model.includes('24b');
  const aiSentenceCap = is24B ? 1 : 2;
  const effectiveMemoryLimit = is24B ? Math.min(memoryLimit, 6) : memoryLimit;

  const historyEntries = state.entries
    .filter(e => e.id !== 'start')
    .slice(-effectiveMemoryLimit);

  // Separate the latest player action from the rest of history
  const lastPlayerIdx = historyEntries.map((e, i) => ({ e, i }))
    .reverse()
    .find(({ e }) => e.type !== 'ai')?.i;

  let history = historyEntries.map((entry, idx) => {
    const text = entry.text || '';

    if (entry.type === 'ai') {
      // Condense AI responses — 1 sentence for 24B, 2 for smaller models
      const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
      const condensed = sentences.slice(0, aiSentenceCap).join(' ').trim();
      return `[Narrator]: ${condensed}${sentences.length > aiSentenceCap ? '…' : ''}`;
    }

    // Skip the latest player entry here — it gets highlighted separately below
    if (lastPlayerIdx !== undefined && idx === lastPlayerIdx) return null;

    const lowerText = text.toLowerCase();
    const alreadyHasYou = lowerText.startsWith('you ') || lowerText.startsWith("you're ") || lowerText.startsWith('your ');

    switch (entry.type) {
      case 'say': return `[Player]: You say: "${text}"`;
      case 'do':  return `[Player]: ${alreadyHasYou ? text : `You ${text}`}`;
      case 'story': return `[Story]: ${text}`;
      default: return text;
    }
  }).filter(Boolean).join("\n\n");

  // Apply memory token limit (rough char estimate) — tighter for 24B
  const effectiveCharLimit = is24B ? Math.min(charLimit, 3000) : charLimit;
  if (history.length > effectiveCharLimit) {
    history = history.substring(history.length - effectiveCharLimit);
    const firstNewline = history.indexOf("\n\n");
    if (firstNewline !== -1) {
      history = history.substring(firstNewline + 2);
    }
  }

  // Format the latest player action for prominent placement
  const lastPlayerEntry = lastPlayerIdx !== undefined ? historyEntries[lastPlayerIdx] : null;
  let latestActionText = '';
  if (lastPlayerEntry) {
    const text = lastPlayerEntry.text || '';
    const lowerText = text.toLowerCase();
    const alreadyHasYou = lowerText.startsWith('you ') || lowerText.startsWith("you're ") || lowerText.startsWith('your ');
    switch (lastPlayerEntry.type) {
      case 'say': latestActionText = `You say: "${text}"`; break;
      case 'do':  latestActionText = alreadyHasYou ? text : `You ${text}`; break;
      case 'story': latestActionText = text; break;
      default: latestActionText = text;
    }
  }

  // Dice instruction sits right before AI: — the last thing the model reads.
  // Kept deliberately short: local models follow brief end-of-prompt cues best.
  const diceInstruction = diceOutcomeLabel
    ? `\n[DICE OUTCOME]: ${diceOutcomeLabel}. Write the response to match this outcome exactly.`
    : "";

  // ── Prompt structure ──────────────────────────────────────────────────────
  // The player's latest action is isolated and placed last, right before AI:,
  // so it's the freshest thing in the model's attention window.
  // History is condensed (AI turns trimmed) so the model can't circle back.
  const isFirstTurn = state.entries.filter(e => e.type === 'ai' && e.id !== 'start').length === 0;
  const firstTurnNote = isFirstTurn
    ? "\nIMPORTANT: The opening scene is already established. Do NOT repeat or re-describe it. Begin immediately after it ends.\n"
    : "";

  const prompt = latestActionText
    ? `RECENT EVENTS (condensed for context):
${history}

>>> PLAYER'S ACTION (this is what you MUST react to) <<<
${latestActionText}
${diceInstruction}${firstTurnNote}

Write the NEXT scene. Your first sentence must directly follow from the player's action above. Do not recap anything from Recent Events. Move the story FORWARD.
${beatInjection ? `\n${beatInjection}` : ""}
AI:`
    : `RECENT EVENTS (condensed for context):
${history}
${diceInstruction}${firstTurnNote}

Continue the story. Move the narrative forward with new developments. Do not recap earlier scenes.
${beatInjection ? `\n${beatInjection}` : ""}
AI:`;

  try {
    console.log(`[Frontend] Requesting generation from model: ${model}`);
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelName: model,
        prompt,
        systemInstruction,
        temperature: settings.temperature,
        topK: settings.topK,
        topP: settings.topP,
        minP: settings.minP,
        frequencyPenalty: settings.frequencyPenalty,
        presencePenalty: settings.presencePenalty,
        repetitionPenalty: settings.repetitionPenalty,
        stopSequences: settings.stopSequences,
        memoryTokens: settings.memoryTokens,
        maxOutputTokens: settings.maxOutputTokens || 400,
      }),
      signal,
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    console.log(`[Frontend] Generation received`);
    let text = data.text || "The story fades into mist... (Local AI failed)";

    // Strip system prompt echo — weak models sometimes repeat instructions in output
    const echoAnchors = [
      'You are an advanced interactive fiction engine',
      'STRICT OPERATIONAL DIRECTIVES',
      'CORE CONTEXT:',
      'MANDATORY FORMATTING:',
      'STARTING PREMISE',
      'ORIGINAL PREMISE',
    ];
    for (const echoAnchor of echoAnchors) {
      const echoIdx = text.indexOf(echoAnchor);
      if (echoIdx !== -1) {
        const resumeIdx = text.indexOf('\n\n', echoIdx);
        text = resumeIdx !== -1 ? text.substring(resumeIdx).trim() : '';
      }
    }
    
    // Post-processing to prevent cut-off sentences at start and end
    text = text.trim();
    
    // 1. Fix beginning cut-off
    // Remove leading ellipsis or common artifacts if present
    if (text.startsWith('...') || text.startsWith('..')) {
      text = text.replace(/^\.+/, '').trim();
    }
    
    // Capitalize first letter if it's a lowercase letter (common model artifact)
    if (text && /^[a-z]/.test(text)) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    // 2. Fix ending cut-off
    if (text && !['.', '!', '?', '"', '…'].includes(text.slice(-1))) {
      const lastPunc = Math.max(
        text.lastIndexOf('.'),
        text.lastIndexOf('!'),
        text.lastIndexOf('?')
      );
      if (lastPunc !== -1) {
        text = text.substring(0, lastPunc + 1);
      }
    }

    // Fix unclosed quotes
    const quoteCount = (text.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      text += '"';
    }

    return text;
  } catch (error) {
    console.error("AI Error:", error);
    return "An error occurred while weaving the tale. Make sure your local model is loaded and fits in memory.";
  }
}

export async function extractStoryCards(state: GameState, signal?: AbortSignal): Promise<Partial<StoryCard>[]> {
  const model = state.settings?.model;
  if (!model) return [];
  
  const recentHistory = state.entries.slice(-10).map(entry => {
    return `${entry.type.toUpperCase()}: ${entry.text}`;
  }).join("\n\n");

  const systemInstruction = `
Analyze the provided story history and identify key characters, items, locations, or factions that should be remembered.
Return a JSON array of objects with the following structure:
{
  "title": "Name of the entity",
  "type": "character" | "item" | "location" | "faction" | "other",
  "keys": ["keyword1", "keyword2"],
  "content": "A detailed description"
}

STRICT REQUIREMENTS for specific types:
- character: You MUST generate a short backstory, physical appearance, and personality details for the character, even if not fully described in the text (infer from context).
- location: You MUST provide a detailed sensory description of the place (sights, sounds, smells, atmosphere).
- faction: Describe their goals, influence, and key members.

Only include NEW entities or significant updates to existing ones.
`;

  const prompt = `
Recent History:
${recentHistory}

Existing Story Cards:
${state.storyCards.map(c => c.title).join(", ")}

Identify important lore elements to save as story cards.
`;

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelName: model,
        prompt,
        systemInstruction,
        temperature: 0.1,
      }),
      signal,
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    const text = data.text || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error("Extraction Error:", error);
    return [];
  }
}

export async function summarizeStory(state: GameState, signal?: AbortSignal): Promise<string> {
  const model = state.settings?.model;
  if (!model) return state.summary;

  const recentHistory = state.entries.slice(-(state.settings.summaryFrequency || 15)).map(entry => {
    return `${entry.type.toUpperCase()}: ${entry.text}`;
  }).join("\n\n");

  const systemInstruction = `
You are a master chronicler. Your task is to update the "Story Summary" by incorporating the latest events into the existing summary.
The summary must be written in a factual, dry style using short, simple sentences.
Avoid opinions, reviews, or flowery language.
Use specific names and facts from the story instead of generic descriptions.
Capture the most important plot points and the current situation.

STRICT COMPRESSION DIRECTIVES:
1. MERGE: Combine the existing summary with the new events into a single, cohesive, and highly compressed narrative.
2. ELIMINATE FLUFF: Remove any redundant information or minor details that don't impact the overall plot.
3. AGGRESSIVE BREVITY: Use as few words as possible while retaining the core meaning.
4. WORD LIMIT: You MUST keep the entire summary within approximately ${state.settings.summaryTokenLimit || 500} words. If it exceeds this, you MUST rewrite and compress it further.
5. NO REPETITION: Do not repeat information already present in the summary.
6. CONTINUITY: Ensure the summary flows logically from the beginning to the current moment.

STARTING PROMPT:
${state.premise}

PLOT ESSENTIALS:
${state.plotEssentials || "None provided."}

STORY CARDS (Known Lore):
${state.storyCards.map(c => `[${c.type.toUpperCase()}: ${c.title}]: ${c.content}`).join("\n")}

EXISTING SUMMARY:
${state.summary || "No summary yet."}
`;

  const prompt = `
LATEST EVENTS:
${recentHistory}

Provide an updated, comprehensive, and COMPRESSED summary of the story so far, incorporating these latest events and ensuring consistency with the world premise and story cards.
`;


  try {
    console.log(`[AI] Summarizing story...`);
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelName: model,
        prompt,
        systemInstruction,
        temperature: 0.3,
        maxOutputTokens: state.settings.summaryTokenLimit || 500,
      }),
      signal,
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    console.log(`[AI] Summary complete`);
    return data.text || state.summary;
  } catch (error) {
    console.error("Summarization Error:", error);
    return state.summary;
  }
}


// ── Beat card generator ───────────────────────────────────────────────────────
// Fires silently on beat completion. Reads what actually happened in the story
// and either creates a new card for the central character or updates an existing one.
// Returns null on failure — never interrupts gameplay.
export async function generateCardFromBeat(
  state: GameState,
  beatTitle: string,
  beatGoal: string,
  signal?: AbortSignal
): Promise<{
  action: 'create' | 'update' | 'skip';
  matchTitle?: string;   // exact title of existing card to update
  card?: { title: string; type: string; content: string; keys: string[]; isUnresolved: boolean };
} | null> {
  const model = state.settings?.model;
  if (!model) return null;

  const recentText = state.entries.slice(-15).map(e => `${e.type.toUpperCase()}: ${e.text}`).join('\n');
  const existingTitles = state.storyCards.map(c => c.title).join(', ') || 'None';

  const prompt = `A story beat just completed.
Beat title: "${beatTitle}"
Beat goal: "${beatGoal}"

Recent story:
${recentText}

Existing story cards: ${existingTitles}

Task: Identify the central character of this beat.
- If they match an existing card exactly, return action "update" with the exact card title in matchTitle.
- If they are new, return action "create" with a full card.
- If no clear character was central, return action "skip".

For the card content use EXACTLY this format if character:
Name: [name, or a descriptive title like "The Stranger" / "The Hooded Merchant" if unnamed]
Age: [specific age or estimated range — never Unknown]
Appearance: [keyword, keyword, keyword]
Personality: [keyword, keyword]
Info: [one key story fact from this beat]

Set isUnresolved to true if the character has no known name yet (you used a descriptive title).
Set isUnresolved to false if a real name is known.

Return ONLY valid JSON:
{
  "action": "create" | "update" | "skip",
  "matchTitle": "exact existing card title or null",
  "card": {
    "title": "character name or descriptive title",
    "type": "character",
    "content": "formatted card content",
    "keys": ["keyword1", "keyword2"],
    "isUnresolved": true | false
  }
}`;

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: model,
        prompt,
        systemInstruction: 'Return only valid JSON. No markdown. No explanation.',
        temperature: 0.2,
        maxOutputTokens: 350,
        memoryTokens: 512,
      }),
      signal,
    });
    const data = await response.json();
    if (data.error) return null;
    const jsonMatch = (data.text || '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const result = JSON.parse(jsonMatch[0]);
    if (!result.action) return null;
    return result;
  } catch {
    return null;
  }
}

// ── Unresolved card name resolver ─────────────────────────────────────────────
// Runs in the background after each AI turn when unresolved cards exist.
// Scans recent story for name reveals and renames the placeholder card.
export async function resolveUnknownCards(
  state: GameState,
  signal?: AbortSignal
): Promise<{ id: string; title: string; content: string }[]> {
  const model = state.settings?.model;
  if (!model) return [];

  const unresolvedCards = state.storyCards.filter(c => c.isUnresolved);
  if (unresolvedCards.length === 0) return [];

  const recentText = state.entries.slice(-10).map(e => e.text).join(' ');

  const prompt = `These story cards were created for characters whose names were not yet known:
${unresolvedCards.map(c => `ID: ${c.id} | Title: "${c.title}" | Content: ${c.content}`).join('\n')}

Recent story:
${recentText}

For each card: check if the recent story reveals the character's real name.
Look for patterns like "his name was X", "she introduced herself as X", "known as X", "called himself X".

Only return cards where a real name is now clearly known. Return an empty array if none.

Return ONLY valid JSON array:
[
  {
    "id": "card id",
    "title": "Real Name",
    "content": "updated content with real name replacing the placeholder title"
  }
]`;

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: model,
        prompt,
        systemInstruction: 'Return only valid JSON array. No markdown. No explanation. If no names resolved, return [].',
        temperature: 0.1,
        maxOutputTokens: 400,
        memoryTokens: 512,
      }),
      signal,
    });
    const data = await response.json();
    if (data.error) return [];
    const jsonMatch = (data.text || '').trim().match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const results = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(results)) return [];
    return results;
  } catch {
    return [];
  }
}

// ── Card+: NPC brain updater ─────────────────────────────────────────────
// Runs silently in the background after each AI response. For every @-prefixed
// story card whose character appeared in recent history, it fires a secondary AI
// call to update that NPC's inner mental state JSON (mood, goals, secrets, etc).
// Results are returned so the caller can patch state — gameplay is never blocked.
export async function updateNpcBrain(
  state: GameState,
  signal?: AbortSignal
): Promise<{ id: string; notes: string }[]> {
  const model = state.settings?.model;
  if (!model) return [];

  const npcCards = state.storyCards.filter(c => c.title.startsWith('@'));
  if (npcCards.length === 0) {
    console.log('[Card+] No @ cards found — skipping brain update');
    return [];
  }

  const recentText = state.entries.slice(-10).map(e => e.text).join(' ').toLowerCase();

  const activeNpcs = npcCards.filter(card => {
    const name = card.title.replace(/^@/, '').toLowerCase();
    return recentText.includes(name) ||
           card.keys.some(k => recentText.includes(k.toLowerCase()));
  });

  if (activeNpcs.length === 0) {
    console.log(`[Card+] ${npcCards.length} @ card(s) found but none active in recent history`);
    return [];
  }

  console.log(`[Card+] Updating brains for: ${activeNpcs.map(c => c.title).join(', ')}`);

  const updates: { id: string; notes: string }[] = [];

  for (const card of activeNpcs) {
    const name = card.title.replace(/^@/, '');
    const existingBrain = card.notes || '{}';

    const prompt = `Character: ${name}
Current inner state: ${existingBrain}

Recent story events:
${state.entries.slice(-8).map(e => `${e.type.toUpperCase()}: ${e.text}`).join('\n')}

Update ${name}'s inner mental state JSON based on these recent events.
Rules:
- All values are short single-sentence strings written from ${name}'s 1st person perspective
- Keys use descriptive lower_snake_case (e.g. current_goal, mood, secret, opinion_of_player)
- Maximum 8 key-value pairs total — prune outdated entries, add new ones
- Always include: mood, current_goal, opinion_of_player
- Return ONLY a valid JSON object, no markdown, no explanation`;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelName: model,
          prompt,
          systemInstruction: 'You are a psychology simulation engine. Respond ONLY with a valid JSON object. No markdown. No explanation.',
          temperature: 0.4,
          maxOutputTokens: 300,
          memoryTokens: 1024, // Keep context small for brain updates — they don't need full history
        }),
        signal,
      });
      const data = await response.json();
      if (data.error) continue;
      const text = (data.text || '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        JSON.parse(jsonMatch[0]); // validate before storing
        updates.push({ id: card.id, notes: jsonMatch[0] });
        console.log(`[AI] Brain updated for NPC: ${name}`);
      }
    } catch {
      // Silent per-NPC failure — never interrupt gameplay
    }
  }

  return updates;
}
