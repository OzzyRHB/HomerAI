export type ActionType = 'say' | 'do' | 'story' | 'ai';

export interface StoryEntry {
  id: string;
  type: ActionType;
  text: string;
  timestamp: number;
}

export type StoryCardType = 'character' | 'item' | 'location' | 'race' | 'faction' | 'other';

export interface StoryCard {
  id: string;
  title: string;
  type: StoryCardType;
  keys: string[]; // Keywords that trigger this card
  content: string;
  isFleshedOut?: boolean; // Track if the card has been detailed at 20+ occurrences
  notes?: string; // Inner-Self: JSON string storing NPC brain state (only used for @-prefixed cards)
  isUnresolved?: boolean;   // Card was created from a beat with no known name yet — pending name resolution
}


// ── Story Beats ───────────────────────────────────────────────────────────────

export type BeatStatus = 'pending' | 'foreshadowing' | 'active' | 'completed' | 'expired';

export interface StoryBeat {
  id: string;
  trackId: string;              // which track this belongs to
  title: string;                // short label e.g. "The Betrayal"
  narrativeGoal: string;        // what the AI is steered toward when foreground
  foreshadowHint: string;       // vague atmospheric hint injected before active window
  targetTurn: number;           // centre of the fire window
  windowSize: number;           // ± turns (fires between targetTurn-windowSize and targetTurn+windowSize)
  foreshadowDistance: number;   // turns before active window to start dropping hints
  actualFireTurn: number | null;// resolved randomly on first evaluation, null until then
  status: BeatStatus;
  completedAtTurn: number | null;
  order: number;                // position within track for display ordering
  linkedCardId?: string;        // story card to write resolution into on completion
  resolution?: string;          // player's one-sentence summary of what happened
}

export interface BeatTrack {
  id: string;
  name: string;                 // e.g. "Main Plot", "Relationship", "Danger"
  priority: number;             // tiebreaker: lower = higher priority for foreground
  color: string;                // hex colour, for timeline UI later
  beats: StoryBeat[];
}

// Computed each turn by the beat engine — consumed by prompt injection
export interface BeatEngineState {
  foregroundBeat: StoryBeat | null;  // most urgently expiring active beat
  backgroundBeats: StoryBeat[];      // all other active beats across tracks
  foreshadowingBeats: StoryBeat[];   // beats in foreshadow zone only
}

export interface GameState {
  id: string;
  title: string;
  description: string;
  image?: string; // Base64 or URL
  premise: string; // Beginning prompt
  aiInstructions: string;
  authorsNote: string;
  entries: StoryEntry[];
  history: StoryEntry[][]; // For undo
  redoStack: StoryEntry[][]; // For redo
  storyCards: StoryCard[];
  beatTracks?: BeatTrack[];          // optional — existing saves load without migration
  plotEssentials: string;
  summary: string;
  isGenerating: boolean;
  isSummarizing: boolean;
  lastPlayed: number;
  settings: {
    model: string;
    models: string[];
    useRollingModels: boolean;
    rollingModelFrequency: number;
    temperature: number;
    topK: number;
    topP: number;
    maxOutputTokens: number;
    memoryLimit: number;
    memoryTokens: number;
    minP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    repetitionPenalty: number;
    stopSequences: string[];
    summaryFrequency: number;
    summaryTokenLimit: number;
    useSummary: boolean;
    useDice: boolean;
    useCardPlus: boolean;
    useCardResolution: boolean;
  };
  theme: {
    background: string;
    text: string;
    accent: string;
    fontSize: number;
    version: string;
  };
}

export interface AppState {
  adventures: GameState[];
  scenarios: GameState[];
  currentAdventureId: string | null;
  modelRegistry: string[];
  view: 'home' | 'new' | 'game';
  layoutMode: 'desktop' | 'mobile';
  isSettingsOpen: boolean;
  user: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
  } | null;
  globalTheme: {
    background: string;
    text: string;
    accent: string;
    fontSize: number;
  };
  globalSettings: {
    model: string;
  };
}
