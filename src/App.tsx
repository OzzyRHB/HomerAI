import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  BookOpen, 
  Plus, 
  Trash2, 
  Send, 
  Settings, 
  History, 
  Brain, 
  ScrollText,
  ChevronRight,
  MessageSquare,
  Zap,
  Loader2,
  Image as ImageIcon,
  ArrowLeft,
  Play,
  Save,
  X,
  Pencil,
  Edit3,
  Copy,
  Download,
  Upload,
  FileJson,
  RotateCcw,
  RotateCw,
  RefreshCw,
  Undo2,
  Redo2,
  Wand2,
  User,
  Activity,
  ChevronLeft,
  Footprints,
  Speech,
  Check,
  Map,
  Cpu,
  Palette,
  MonitorSmartphone,
  Dices,
  Sparkles,
  Layers,
  Milestone
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HexColorPicker } from "react-colorful";
import ReactMarkdown from 'react-markdown';
import Cropper from 'react-easy-crop';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { GameState, StoryEntry, ActionType, StoryCard, AppState, StoryCardType, BeatTrack, StoryBeat } from './types';
import { generateStoryResponse, summarizeStory, updateNpcBrain, generateCardFromBeat, resolveUnknownCards } from './services/aiService';
import { createDefaultTracks, advanceBeats, computeBeatEngineState, completeBeat, getCurrentTurn } from './services/beatEngine';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const VERSION = '0.5.023';

const DEFAULT_SETTINGS = {
  model: '',
  models: [],
  useRollingModels: false,
  rollingModelFrequency: 5,
  temperature: 0.8,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 95,
  memoryLimit: 10,
  memoryTokens: 1024,
  minP: 0.05,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
  repetitionPenalty: 1.1,
  stopSequences: [],
  summaryFrequency: 15,
  summaryTokenLimit: 500,
  useSummary: true,
  useDice: false,
  useCardPlus: true,
  useCardResolution: true,
};

const DEFAULT_THEME = {
  background: '#0a0a0a',
  text: '#e7e5e4', // stone-200
  accent: '#FF8800', // Orange
  fontSize: 18,
  version: VERSION,
};

const DEFAULT_SCENARIO: GameState = {
  id: 'default-scenario-1',
  title: 'The Whispering Woods',
  description: 'A mysterious forest where the trees seem to talk and shadows move on their own.',
  premise: 'You stand at the edge of the Whispering Woods. The air is thick with the scent of damp earth and ancient magic. A narrow path winds into the darkness, and you feel as if a thousand eyes are watching you from the foliage.',
  aiInstructions: 'Maintain a mysterious and slightly eerie tone. Focus on sensory details and the unsettling nature of the forest.',
  authorsNote: 'Focus on the atmosphere and the feeling of being watched.',
  entries: [],
  history: [],
  redoStack: [],
  storyCards: [
    {
      id: 'sc-1',
      title: 'The Whispering Trees',
      type: 'location',
      keys: ['trees', 'whisper', 'forest'],
      content: 'Ancient oaks and willows that seem to murmur in a forgotten language. They are said to hold the memories of the land.'
    }
  ],
  plotEssentials: 'The forest is alive and reacts to the emotions of those within it. Leaving the path is dangerous.',
  summary: '',
  isGenerating: false,
  isSummarizing: false,
  lastPlayed: Date.now(),
  settings: DEFAULT_SETTINGS,
  theme: DEFAULT_THEME,
};

// ── Dice trigger detection ────────────────────────────────────────────────────
// Returns true if the player's input warrants a dice roll.
// Only fires on 'do' actions containing action-attempt keywords.
const ACTION_KEYWORDS = [
  'try', 'attempt', 'attack', 'grab', 'sneak', 'pick', 'climb', 'jump',
  'dodge', 'block', 'cast', 'shoot', 'punch', 'kick', 'throw', 'catch',
  'convince', 'persuade', 'deceive', 'lie', 'bluff', 'charm', 'intimidate',
  'hack', 'lockpick', 'disarm', 'steal', 'hide', 'run', 'escape', 'search',
  'investigate', 'examine', 'lift', 'push', 'pull', 'break', 'force',
];

function shouldTriggerDice(actionType: string, input: string): boolean {
  if (actionType !== 'do') return false;
  const lower = input.toLowerCase();
  return ACTION_KEYWORDS.some(kw => {
    const idx = lower.indexOf(kw);
    if (idx === -1) return false;
    // Make sure it's a word boundary (not e.g. "trying" failing to match "try" mid-word is fine,
    // but "catchy" shouldn't match "catch")
    const after = lower[idx + kw.length];
    return !after || /[\s.,!?'"]/.test(after);
  });
}

// ── DiceModal with animated roll ─────────────────────────────────────────────
const DiceModal = ({
  value,
  onClose,
  accentColor
}: {
  value: number,
  onClose: () => void,
  accentColor: string
}) => {
  const [displayed, setDisplayed] = useState<number | null>(null);
  const [rolling, setRolling] = useState(true);

  // Outcome derived from value
  const outcome = value === 1  ? { label: 'Critical Failure', sub: 'Something goes terribly wrong.', color: '#ef4444' }
                : value <= 9   ? { label: 'Failure',          sub: 'You do not succeed.',            color: '#f97316' }
                : value <= 19  ? { label: 'Success',          sub: 'You pull it off.',               color: '#22c55e' }
                :                { label: 'Critical Success',  sub: 'Outstanding! A bonus awaits.',  color: '#a855f7' };

  useEffect(() => {
    // Spin through random numbers for 1.2s then land on the real value
    let frame = 0;
    const total = 36; // ~1.2s at 30ms intervals
    const interval = setInterval(() => {
      frame++;
      if (frame >= total) {
        clearInterval(interval);
        setDisplayed(value);
        setRolling(false);
      } else {
        setDisplayed(Math.floor(Math.random() * 20) + 1);
      }
    }, 33);
    return () => clearInterval(interval);
  }, [value]);

  useEffect(() => {
    if (rolling) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rolling, onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.5, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="bg-stone-900 border-2 border-stone-800 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative overflow-hidden"
        style={{ borderColor: rolling ? `${accentColor}44` : `${outcome.color}66` }}
      >
        {/* Background glow that pulses when rolling */}
        <div
          className="absolute inset-0 opacity-5 pointer-events-none transition-colors duration-500"
          style={{ backgroundColor: rolling ? accentColor : outcome.color }}
        />

        <div className="relative z-10 space-y-6">
          <h3 className="text-stone-500 uppercase tracking-[0.3em] text-xs font-bold">
            {rolling ? 'Rolling...' : 'Fate Decided'}
          </h3>

          {/* D20 face */}
          <div className="flex justify-center">
            <div className="relative w-32 h-32">
              {/* Hexagon-ish d20 shape via clip-path */}
              <div
                className="w-full h-full flex items-center justify-center transition-all duration-200"
                style={{
                  clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                  backgroundColor: rolling ? `${accentColor}22` : `${outcome.color}22`,
                  border: `2px solid ${rolling ? accentColor : outcome.color}`,
                }}
              >
                <span
                  className="text-5xl font-black font-sans tabular-nums transition-all duration-100"
                  style={{
                    color: rolling ? accentColor : outcome.color,
                    textShadow: `0 0 24px ${rolling ? accentColor : outcome.color}99`,
                    transform: rolling ? `rotate(${Math.random() * 20 - 10}deg)` : 'rotate(0deg)',
                  }}
                >
                  {displayed ?? '?'}
                </span>
              </div>
            </div>
          </div>

          {/* Outcome text — only shown when done rolling */}
          <div className="space-y-1 min-h-[56px] flex flex-col items-center justify-center">
            {!rolling && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-1"
              >
                <p className="font-bold text-xl" style={{ color: outcome.color }}>
                  {outcome.label}
                </p>
                <p className="text-stone-400 font-sans text-sm italic">{outcome.sub}</p>
                <p className="text-stone-600 text-[10px] uppercase tracking-widest pt-1">
                  Press Enter or click to continue
                </p>
              </motion.div>
            )}
          </div>

          <button
            onClick={() => { if (!rolling) onClose(); }}
            disabled={rolling}
            className="w-full py-4 rounded-xl text-white font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-30"
            style={{ backgroundColor: rolling ? '#44403c' : outcome.color }}
          >
            {rolling ? 'Rolling...' : 'Continue'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const SearchableModelSelect = ({ 
  value, 
  options, 
  onChange, 
  className,
  placeholder = "Select a model...",
  trigger
}: { 
  value: string, 
  options: string[], 
  onChange: (val: string) => void,
  className?: string,
  placeholder?: string,
  trigger?: React.ReactNode
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options
    .filter(opt => opt.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 100);

  return (
    <div ref={containerRef} className="relative w-full">
      {trigger ? (
        <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
          {trigger}
        </div>
      ) : (
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "w-full bg-stone-900 border border-stone-800 rounded-xl p-4 cursor-pointer flex justify-between items-center text-sm",
            isOpen && "border-stone-600",
            className
          )}
        >
          <span className={value ? "text-stone-200 truncate" : "text-stone-500 truncate"}>
            {value || placeholder}
          </span>
          <ChevronRight className={cn("w-4 h-4 shrink-0 transition-transform", isOpen && "rotate-90")} />
        </div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-[100] top-full left-0 right-0 mt-2 bg-stone-900/90 backdrop-blur-xl border border-stone-800 rounded-xl shadow-2xl overflow-hidden min-w-[280px] md:min-w-[400px] md:left-1/2 md:-translate-x-1/2"
          >
            <div className="p-2 border-b border-stone-800">
              <input 
                autoFocus
                type="text"
                placeholder="Search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-stone-800 border border-stone-800 rounded-lg p-2 text-base font-sans focus:outline-none focus:border-stone-600"
              />
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map(opt => (
                  <div 
                    key={opt}
                    onClick={() => {
                      onChange(opt);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer text-sm transition-colors",
                      opt === value ? "bg-stone-800 text-white" : "hover:bg-stone-800/50 text-stone-400"
                    )}
                  >
                    {opt}
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-stone-500 text-xs">No models found</div>
              )}
              {options.length > 100 && search === '' && (
                <div className="p-2 text-center text-[10px] text-stone-600 uppercase tracking-widest">
                  Showing first 100 models. Use search to find more.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Running = ({ className, size = 24, color = "currentColor", ...props }: { className?: string, size?: number, color?: string, [key: string]: any }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill={color}
    stroke="none"
    className={className}
    {...props}
  >
    {/* Speed lines */}
    <rect x="1" y="8" width="5" height="1.4" rx="0.7" />
    <rect x="2" y="11" width="4" height="1.4" rx="0.7" />
    <rect x="1" y="14" width="3.5" height="1.4" rx="0.7" />
    {/* Head */}
    <circle cx="16" cy="4.5" r="2.2" />
    {/* Body — leaning forward runner */}
    <path d="M13.5 7.5 L11 13 L12.5 13 L11 18.5 L14 14 L12.5 14 L15 8.5 Z" />
    {/* Front arm */}
    <path d="M14.5 8.5 Q16 7, 18 8.5" strokeWidth="1.6" stroke={color} fill="none" strokeLinecap="round" />
    {/* Back arm */}
    <path d="M13 9.5 Q11 8, 9.5 9.5" strokeWidth="1.6" stroke={color} fill="none" strokeLinecap="round" />
    {/* Front leg (extended) */}
    <path d="M12.5 14 Q15 16.5, 18 15.5" strokeWidth="1.8" stroke={color} fill="none" strokeLinecap="round" />
    {/* Back leg (kicked back) */}
    <path d="M13 14 Q10 17, 8 18.5" strokeWidth="1.8" stroke={color} fill="none" strokeLinecap="round" />
    {/* Front foot */}
    <path d="M18 15.5 L19.5 14.5" strokeWidth="1.6" stroke={color} fill="none" strokeLinecap="round" />
    {/* Back foot */}
    <path d="M8 18.5 L6.5 19" strokeWidth="1.6" stroke={color} fill="none" strokeLinecap="round" />
  </svg>
);


const DEFAULT_MODELS: string[] = [];

const COMMON_WORDS = new Set([
  // Pronouns & articles
  'The', 'A', 'An', 'You', 'I', 'He', 'She', 'It', 'They', 'We',
  'Your', 'My', 'His', 'Her', 'Its', 'Their', 'Our',
  // Conjunctions & prepositions
  'Then', 'But', 'And', 'Or', 'So', 'If', 'When', 'Where', 'Why', 'How',
  'There', 'Here', 'This', 'That', 'These', 'Those',
  'With', 'Without', 'For', 'Against', 'Before', 'After',
  'Between', 'Among', 'Through', 'Across', 'Over', 'Under', 'Above', 'Below',
  'Near', 'Far', 'In', 'Out', 'On', 'Off', 'Up', 'Down',
  // Common nouns (generic, not names)
  'Someone', 'Something', 'Now', 'Today', 'Yesterday', 'Tomorrow',
  'Day', 'Night', 'Morning', 'Evening', 'Time', 'Way', 'Thing', 'Place',
  'World', 'Life', 'Man', 'Woman', 'Boy', 'Girl',
  'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister',
  'Friend', 'Enemy', 'King', 'Queen', 'Lord', 'Lady', 'Sir', 'Madam',
  'Master', 'Mistress', 'God', 'Goddess', 'Heaven', 'Hell',
  'Death', 'Love', 'Hate', 'War', 'Peace',
  'Fire', 'Water', 'Earth', 'Air', 'Sun', 'Moon', 'Star',
  'Sea', 'Land', 'Forest', 'Mountain', 'River', 'City', 'Town', 'Village',
  'House', 'Room', 'Door', 'Window', 'Table', 'Chair', 'Bed', 'Book',
  'Sword', 'Shield', 'Gold', 'Silver', 'Iron', 'Stone', 'Wood',
  'Blood', 'Bone', 'Skin', 'Eye', 'Ear', 'Nose', 'Mouth', 'Hand', 'Foot',
  'Head', 'Body', 'Soul', 'Mind', 'Heart', 'Spirit', 'Ghost',
  'Shadow', 'Light', 'Dark',
  // Adjectives / adverbs masquerading as proper nouns
  'Cold', 'Hot', 'Old', 'New', 'Good', 'Bad', 'True', 'False',
  'High', 'Low', 'Big', 'Small', 'Long', 'Short', 'Fast', 'Slow',
  'Strong', 'Weak', 'Rich', 'Poor', 'Happy', 'Sad', 'Angry',
  'Fear', 'Hope', 'Dream', 'Truth', 'Lie',
  'Right', 'Wrong', 'Left', 'North', 'South', 'East', 'West',
  'Again', 'Always', 'Never', 'Often', 'Sometimes', 'Once', 'Twice', 'Thrice',
  'First', 'Last', 'Next', 'Previous', 'Only', 'Just', 'Very', 'Too',
  'Enough', 'Quite', 'Rather', 'Almost', 'Nearly', 'Even', 'Still',
  'Yet', 'Already', 'Soon', 'Later',
  'All', 'Any', 'Each', 'Every', 'Some', 'No', 'None',
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Who', 'Whom', 'Whose', 'Which', 'What',
  // ── Interjections & common sentence-openers ──────────────────────────────────
  // These appear capitalised at sentence starts and were slipping through
  'Oh', 'Ah', 'Ha', 'Eh', 'Uh', 'Um', 'Hmm', 'Hm', 'Wow', 'Hey',
  'Yes', 'No', 'Not', 'Well', 'Look', 'See', 'Wait', 'Stop', 'Come',
  'Go', 'Run', 'Get', 'Let', 'Put', 'Take', 'Make', 'Keep', 'Hold',
  'Please', 'Sorry', 'Thanks', 'Maybe', 'Perhaps', 'Indeed', 'Exactly',
  'Suddenly', 'Finally', 'Slowly', 'Quickly', 'Carefully', 'Quietly',
  'Meanwhile', 'However', 'Therefore', 'Nevertheless', 'Furthermore',
  'Though', 'Although', 'Because', 'Since', 'Unless', 'Until', 'While',
  'As', 'At', 'By', 'Of', 'To', 'Do', 'Did', 'Does', 'Has', 'Have',
  'Had', 'Was', 'Were', 'Are', 'Is', 'Be', 'Been', 'Being',
  'Will', 'Would', 'Could', 'Should', 'Might', 'Must', 'Can', 'May',
  'Without', 'Within', 'Beside', 'Behind', 'Beyond', 'Toward', 'Towards',
]);

export default function App() {
  const [appState, setAppState] = useState<AppState>({
    adventures: [],
    scenarios: [DEFAULT_SCENARIO],
    currentAdventureId: null,
    modelRegistry: DEFAULT_MODELS,
    view: 'home',
    layoutMode: 'desktop',
    isSettingsOpen: false,
    user: null,
    globalTheme: DEFAULT_THEME,
    globalSettings: {
      model: DEFAULT_SETTINGS.model,
    },
  });

  const view = appState.view;
  const setView = (v: 'home' | 'new' | 'game') => setAppState(prev => ({ ...prev, view: v }));
  const [homeTab, setHomeTab] = useState<'adventures' | 'scenarios'>('scenarios');
  const [showAdvancedNew, setShowAdvancedNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'adventure' | 'scenario' | null>(null);
  const [input, setInput] = useState('');
  const [actionType, setActionType] = useState<ActionType>('do');
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showStoryCards, setShowStoryCards] = useState(false);
  const [showManualCardModal, setShowManualCardModal] = useState(false);
  const [manualCardName, setManualCardName] = useState('');
  const [mobileTab, setMobileTab] = useState<'scenarios' | 'adventures'>('adventures');
  const [settingsTab, setSettingsTab] = useState<'adventure' | 'cards' | 'ai' | 'beats'>('adventure');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string, type: 'scenario' | 'adventure' } | null>(null);
  const [editingEntry, setEditingEntry] = useState<{ id: string, text: string } | null>(null);
  const [isEditingEntryText, setIsEditingEntryText] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auth Listener - Removed for local-only
  useEffect(() => {
    setAppState(prev => ({ ...prev, user: null }));
  }, []);

  // Firestore Sync - Removed for local-only
  useEffect(() => {
    // No-op
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('worldforge_theme');
    if (savedTheme) {
      try {
        const theme = JSON.parse(savedTheme);
        setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, ...theme } }));
      } catch (e) {
        console.error("Failed to load theme:", e);
      }
    }
    const savedSettings = localStorage.getItem('worldforge_settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setAppState(prev => ({ ...prev, globalSettings: { ...prev.globalSettings, ...settings } }));
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('worldforge_theme', JSON.stringify(appState.globalTheme));
  }, [appState.globalTheme]);

  useEffect(() => {
    localStorage.setItem('worldforge_settings', JSON.stringify(appState.globalSettings));
  }, [appState.globalSettings]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [editingStoryCard, setEditingStoryCard] = useState<StoryCard | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [diceRoll, setDiceRoll] = useState<{ show: boolean, value: number } | null>(null);
  const [isGeneratingOpening, setIsGeneratingOpening] = useState(false);
  const [editingBeat, setEditingBeat] = useState<{ beat: StoryBeat; trackId: string } | null>(null);
  const [beatEditTarget, setBeatEditTarget] = useState<'new' | 'game'>('game');

  const generateOpeningScene = async () => {
    if (!newAdventure.settings?.model) {
      alert("Please select a model first in the AI Settings tab.");
      return;
    }
    
    setIsGeneratingOpening(true);
    try {
      const prompt = `Generate an opening scene for a story. 
Title: ${newAdventure.title || 'Untitled'}
Description: ${newAdventure.description || 'No description'}
Perspective: Second person ("You...")
Tense: Present
Tone: ${newAdventure.authorsNote || 'Atmospheric'}

Write only the opening scene, starting with "You...". Keep it to 1-2 paragraphs. Ensure it's immersive and sets the stage for an adventure.`;

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: newAdventure.settings.model,
          prompt,
          systemInstruction: "You are a master storyteller. Write an immersive opening scene in the second person.",
          temperature: 0.8,
          maxOutputTokens: 500,
        }),
      });
      
      const data = await response.json();
      if (data.text) {
        setNewAdventure(prev => ({ ...prev, premise: data.text.trim() }));
      }
    } catch (error) {
      console.error("Error generating opening scene:", error);
    } finally {
      setIsGeneratingOpening(false);
    }
  };

  const isProcessingDetection = useRef(false);

  const processCharacterDetection = async (state: GameState) => {
    if (isProcessingDetection.current) return;
    isProcessingDetection.current = true;
    setIsProcessingCards(true);

    try {
      // Count real turns: one AI entry = one completed turn
      const turnCount = state.entries.filter(e => e.type === 'ai').length;

      // ── Proper noun extraction ─────────────────────────────────────────────
      // FIX: Words at the start of a sentence are capitalised by grammar rules,
      // not because they're proper nouns. Normalise those away first so that
      // common words like "Oh", "Look", "Suddenly" can't become candidates.
      //
      // Strategy: lowercase the first character after any sentence boundary
      // (period, exclamation, question mark, or newline followed by whitespace),
      // then also lowercase the very first word of the whole text.
      // After normalisation, only words that are ALWAYS capitalised mid-sentence
      // (i.e. genuine proper nouns) survive the /\b[A-Z][a-z]{2,}\b/ scan.
      const rawText = state.entries.slice(-50).map(e => e.text).join(" ");
      const normalizedText = rawText
        // Lowercase the first word of the entire block
        .replace(/^([A-Z])/, c => c.toLowerCase())
        // Lowercase the first letter after a sentence-ending punctuation + space
        .replace(/([.!?]\s+)([A-Z])/g, (_, punct, cap) => punct + cap.toLowerCase())
        // Lowercase after a newline
        .replace(/([\n]\s*)([A-Z])/g, (_, nl, cap) => nl + cap.toLowerCase());

      // Require at least 3 characters (filters "Oh", "Ha", "Ah", etc.)
      const words = normalizedText.match(/\b[A-Z][a-z]{2,}\b/g) || [];
      const recentCounts: Record<string, number> = {};
      words.forEach(word => {
        if (!COMMON_WORDS.has(word)) recentCounts[word] = (recentCounts[word] || 0) + 1;
      });

      const candidates = Object.entries(recentCounts)
        .filter(([_, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1]);

      if (candidates.length === 0) return;

      const model = state.settings?.model;
      if (!model) return;

      // Find the first candidate that needs action — either a new card or a flesh-out.
      // Without this, the most frequent name (e.g. Claire) always wins and blocks
      // newly introduced characters from ever getting a card created.
      let name: string | null = null;
      let existingCard: any = null;
      let needsNewCard = false;
      let needsFleshOut = false;
      // FIX: declare turnsSince here so it's in scope for the fleshOut log below
      let turnsSince = 0;

      for (const [candidate] of candidates) {
        const found = state.storyCards.find(c => {
          const cardName = c.title.replace(/^@/, '').toLowerCase();
          return cardName === candidate.toLowerCase() || c.keys.some(k => k.toLowerCase() === candidate.toLowerCase());
        });

        if (!found) {
          // New character — prioritise creating their card
          name = candidate;
          existingCard = null;
          needsNewCard = true;
          break;
        }

        const createdAt = (found as any).createdAtTurn ?? 0;
        const sinceTurns = turnCount - createdAt;
        const fleshThreshold = 15 + (found.id.charCodeAt(0) % 11);
        if (!found.isFleshedOut && sinceTurns >= fleshThreshold) {
          name = candidate;
          existingCard = found;
          needsFleshOut = true;
          turnsSince = sinceTurns; // capture for use in the log after the loop
          // Don't break — keep looking for a new character first
          // (but if no new character found, use this)
        }
      }

      if (!name) return;

      if (needsNewCard) {
        // ── New entity — create initial card ─────────────────────────────────
        const prompt = `You are writing a story card for an interactive fiction game.
Analyze the name "${name}" in this story context.

Recent story:
${state.entries.slice(-8).map(e => e.text).join('\n')}

Return JSON only:
{
  "type": "character" | "location" | "faction" | "skip",
  "content": "text"
}

If character, content MUST be exactly this bullet-point format:
• Name: ${name}
• Age: [specific age or range, e.g. mid-30s]
• Appearance: [keyword, keyword, keyword — physical traits only]
• Traits: [keyword, keyword — personality only]
• Info: [one major story fact — one short line]

If location or faction: 2-3 bullet points with key facts.
If "${name}" is not a proper name or named entity: {"type":"skip","content":""}
Return ONLY valid JSON.`;

        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelName: model,
            prompt,
            systemInstruction: "Return only valid JSON. Use bullet points (•) for content. No markdown. No fluff.",
            temperature: 0.2,
            maxOutputTokens: 250,
            memoryTokens: 512,
          }),
        });

        const data = await response.json();
        if (data.text) {
          const jsonMatch = data.text.trim().match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const json = JSON.parse(jsonMatch[0]);
              if (json.type && json.type !== 'skip' && json.content) {
                const rawContent = json.content;
                const safeContent = typeof rawContent === 'string'
                  ? rawContent
                  : Object.entries(rawContent as Record<string, string>)
                      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
                      .join('\n');

                const cardTitle = json.type === 'character' ? `@${name}` : name;
                console.log(`[AutoCards] Creating card: ${cardTitle} (turn ${turnCount})`);

                setGameState(prev => {
                  if (!prev) return prev;
                  if (prev.storyCards.some(c => c.title.replace(/^@/, '').toLowerCase() === name.toLowerCase())) return prev;
                  return {
                    ...prev,
                    storyCards: [...prev.storyCards, {
                      id: Math.random().toString(36).substr(2, 9),
                      title: cardTitle,
                      type: json.type,
                      keys: [name.toLowerCase()],
                      content: safeContent,
                      isFleshedOut: false,
                      createdAtTurn: turnCount,
                    } as any]
                  };
                });

                setCardFlash(true);
                setTimeout(() => setCardFlash(false), 1500);
              }
            } catch {}
          }
        }
      } else if (needsFleshOut && existingCard) {
        // ── Existing card — flesh out after 15-25 turns ───────────────────────
        {
          let prompt = "";
          if (existingCard.type === 'character') {
            prompt = `Update this character card for "${name}" using recent story events.
Return ONLY bullet points in this exact format — no prose, no markdown headers:
• Name: ${name}
• Age: [specific age or range, e.g. mid-30s]
• Appearance: [keyword, keyword, keyword — physical traits only]
• Traits: [keyword, keyword — personality only]
• Recent: [most important recent action or event — one short line]

Current card:
${existingCard.content}

Recent story (last 15 entries):
${state.entries.slice(-15).map((e: any) => e.text).join('\n').slice(0, 1500)}`;
          } else {
            prompt = `Update this ${existingCard.type} card for "${name}" using recent events.
Return ONLY bullet points — no prose, no markdown:
• Type: ${existingCard.type}
• Key detail: [most important fact]
• Recent: [what changed recently — one short line]

Current: ${existingCard.content}
Recent events: ${state.entries.slice(-10).map((e: any) => e.text).join(' ').slice(0, 600)}`;
          }

          console.log(`[AutoCards] Fleshing out: ${existingCard.title} (${turnsSince} turns since creation)`);

          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelName: model,
              prompt,
              systemInstruction: "Return only the formatted card text. No markdown. No explanation. Factual and brief.",
              temperature: 0.2,
              maxOutputTokens: 300,
              memoryTokens: 512,
            }),
          });

          const data = await response.json();
          if (data.text) {
            const newContent = data.text.trim();
            setGameState(prev => {
              if (!prev) return prev;
              const idx = prev.storyCards.findIndex(c => c.id === existingCard.id);
              if (idx === -1) return prev;
              const updatedCards = [...prev.storyCards];
              updatedCards[idx] = { ...updatedCards[idx], content: newContent, isFleshedOut: true };
              return { ...prev, storyCards: updatedCards };
            });
            console.log(`[AutoCards] Card fleshed out: ${existingCard.title}`);
            setCardFlash(true);
            setTimeout(() => setCardFlash(false), 1500);
          }
        }
      }
    } catch (e) {
      console.error("Detection Error:", e);
    } finally {
      isProcessingDetection.current = false;
      setIsProcessingCards(false);
    }
  };


  const fetchLocalModels = async () => {
    try {
      const response = await fetch('/api/models');
      const data = await response.json();
      const llms = data.llms || [];
      
      setAppState(prev => {
        const currentModel = prev.globalSettings.model;
        const newModel = (currentModel && llms.includes(currentModel)) ? currentModel : (llms[0] || '');
        return { 
          ...prev, 
          modelRegistry: llms.length > 0 ? llms : DEFAULT_MODELS,
          globalSettings: {
            ...prev.globalSettings,
            model: newModel
          }
        };
      });

      setNewAdventure(prev => ({
        ...prev,
        settings: {
          ...(prev.settings || DEFAULT_SETTINGS),
          model: (prev.settings?.model && llms.includes(prev.settings.model)) ? prev.settings.model : (llms[0] || ''),
        }
      }));
    } catch (error) {
      console.error("Failed to fetch local models:", error);
    }
  };

  const fetchData = async () => {
    try {
      console.log("[Persistence] Fetching data from server...");
      const response = await fetch('/api/data');
      if (response.ok) {
        const data = await response.json();
        console.log(`[Persistence] Loaded ${data.adventures?.length || 0} adventures and ${data.scenarios?.length || 0} scenarios.`);
        setAppState(prev => ({
          ...prev,
          adventures: data.adventures || [],
          scenarios: data.scenarios || [],
        }));
      }
    } catch (error) {
      console.error("[Persistence] Failed to fetch data from server:", error);
    }
  };

  // Load app state on mount
  useEffect(() => {
    fetchData().then(() => {
      setTimeout(() => {
        isInitialLoad.current = false;
      }, 500);
    });
    fetchLocalModels();
  }, []);

  // Cropper State
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<'new' | 'current'>('new');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const fileInputRefNew = useRef<HTMLInputElement>(null);
  const fileInputRefCurrent = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const getCroppedImg = async (imageSrc: string, pixelCrop: any): Promise<string> => {
    const image = new Image();
    // Only set crossOrigin if it's a remote URL
    if (!imageSrc.startsWith('data:') && !imageSrc.startsWith('blob:')) {
      image.crossOrigin = 'anonymous';
    }
    image.src = imageSrc;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return canvas.toDataURL('image/jpeg', 0.9);
  };

  const handleCropSave = async () => {
    if (cropImage && croppedAreaPixels) {
      try {
        const croppedImage = await getCroppedImg(cropImage, croppedAreaPixels);
        if (cropTarget === 'new') {
          setNewAdventure(prev => ({ ...prev, image: croppedImage }));
        } else {
          setGameState(prev => ({ ...prev, image: croppedImage }));
        }
        // Clean up the object URL
        if (cropImage.startsWith('blob:')) {
          URL.revokeObjectURL(cropImage);
        }
        setCropImage(null);
      } catch (error) {
        console.error("Error cropping image:", error);
        alert("Failed to crop image. Please try again.");
      }
    } else if (cropImage) {
      // If for some reason croppedAreaPixels isn't set, just use the original
      if (cropTarget === 'new') {
        setNewAdventure(prev => ({ ...prev, image: cropImage }));
      } else {
        setGameState(prev => ({ ...prev, image: cropImage }));
      }
      setCropImage(null);
    }
  };
  const [keywordsInput, setKeywordsInput] = useState('');
  const [isRecapping, setIsRecapping] = useState(false);
  const [modelFlash, setModelFlash] = useState(false);
  const [cardFlash, setCardFlash] = useState(false);

  // Sync keywords input when editing story card changes
  useEffect(() => {
    if (editingStoryCard) {
      setKeywordsInput(editingStoryCard.keys?.join(', ') || '');
    } else {
      setKeywordsInput('');
    }
  }, [editingStoryCard?.id]);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isProcessingCards, setIsProcessingCards] = useState(false);

  // ── Placeholder modal state ───────────────────────────────────────────────────
  // Holds a pending scenario while the player fills in ${...} placeholders.
  // placeholderModalRef mirrors the state synchronously so click handlers can
  // guard against launching a second scenario before React re-renders.
  const placeholderModalRef = useRef(false);
  const [placeholderModal, setPlaceholderModal] = useState<{
    scenario: GameState;
    placeholders: string[];       // unique labels e.g. ["your name", "your class"]
    values: Record<string, string>; // label → player input
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  const getUniqueTitle = (baseTitle: string, existingItems: { title: string }[]) => {
    const existingTitles = existingItems.map(item => item.title.toLowerCase());
    if (!existingTitles.includes(baseTitle.toLowerCase())) return baseTitle;

    let counter = 1;
    let newTitle = `${baseTitle} (${counter})`;
    while (existingTitles.includes(newTitle.toLowerCase())) {
      counter++;
      newTitle = `${baseTitle} (${counter})`;
    }
    return newTitle;
  };

  const DEFAULT_AI_INSTRUCTIONS = `You are an advanced interactive fiction engine. Your goal is to continue the story based on the player's actions.
Maintain a consistent tone, style, and world logic.

CORE RULES:
- ALWAYS use the second person ("You...") to describe the player's actions and experiences.
- ALWAYS use the present tense.
- Be descriptive and atmospheric.
- NPCs are active participants: they speak, make their own decisions, and have their own motivations.
- NPCs should engage in dialogue and react naturally to the world and the player.
- Do not speak for the player unless it's a natural consequence of their action.
- If the player uses "SAY", they are speaking.
- If the player uses "DO", they are performing an action.
- If the player uses "STORY", they are adding a narrative beat.
- Keep responses concise but impactful (1-2 paragraphs).
- You MUST end your response with a complete sentence.

STORYTELLING GUIDELINES:
- Focus on sensory details (sights, sounds, smells, textures, atmosphere).
- Show, don't just tell.
- Maintain the established personality and backstory of all characters.
- Ensure locations feel distinct and immersive.
- Respect the established lore and plot essentials.`;

  // New Adventure Form State
  const [newAdventure, setNewAdventure] = useState<Partial<GameState>>({
    title: '',
    description: '',
    premise: '',
    aiInstructions: `You are an advanced interactive fiction engine. NPCs are active participants: they speak, make their own decisions, and react naturally to the player.`,
    authorsNote: 'Maintain a dark, atmospheric tone.',
    plotEssentials: '',
    summary: '',
    storyCards: [],
    image: '',
    settings: DEFAULT_SETTINGS,
    theme: DEFAULT_THEME,
  });

  const updatePlotEssentialInNew = (text: string) => {
    setNewAdventure(prev => ({
      ...prev,
      plotEssentials: text
    }));
  };

  const addStoryCardToNew = () => {
    setNewAdventure(prev => ({
      ...prev,
      storyCards: [...(prev.storyCards || []), { 
        id: Math.random().toString(36).substr(2, 9), 
        title: '', 
        content: '', 
        keys: [],
        type: 'other'
      }]
    }));
  };

  const updateStoryCardInNew = (id: string, updates: Partial<StoryCard>) => {
    setNewAdventure(prev => ({
      ...prev,
      storyCards: (prev.storyCards || []).map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const removeStoryCardFromNew = (id: string) => {
    setNewAdventure(prev => ({
      ...prev,
      storyCards: (prev.storyCards || []).filter(s => s.id !== id)
    }));
  };

  const renderStoryCardModal = () => (
    <AnimatePresence>
      {editingStoryCard && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => setEditingStoryCard(null)}
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg bg-[#111] border border-stone-800 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-8 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold tracking-tight">Lore Card</h3>
                <button onClick={() => setEditingStoryCard(null)} className="text-stone-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <section className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Title</label>
                  <input 
                    value={editingStoryCard.title || ''}
                    onChange={(e) => setEditingStoryCard({...editingStoryCard, title: e.target.value})}
                    className="w-full bg-stone-800 border border-stone-800 rounded-xl p-4 focus:outline-none focus:border-stone-600 transition-all text-lg font-sans"
                    placeholder="e.g., The Silver King"
                  />
                </section>

                <div className="grid grid-cols-2 gap-4">
                  <section className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Type</label>
                    <select 
                      value={editingStoryCard.type}
                      onChange={(e) => setEditingStoryCard({...editingStoryCard, type: e.target.value as StoryCardType})}
                      className="w-full bg-stone-800 border border-stone-800 rounded-xl p-4 focus:outline-none focus:border-stone-600 transition-all text-lg font-sans"
                    >
                      <option value="character">Character</option>
                      <option value="item">Item</option>
                      <option value="location">Location</option>
                      <option value="race">Race</option>
                      <option value="faction">Faction</option>
                      <option value="other">Other</option>
                    </select>
                  </section>
                  <section className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Keywords</label>
                    <input 
                      value={keywordsInput}
                      onChange={(e) => setKeywordsInput(e.target.value)}
                      className="w-full bg-stone-800 border border-stone-800 rounded-xl p-4 focus:outline-none focus:border-stone-600 transition-all text-lg font-sans"
                      placeholder="king, silver, crown"
                    />
                  </section>
                </div>

                <section className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Lore Content</label>
                  <textarea 
                    value={typeof editingStoryCard.content === 'string' ? editingStoryCard.content : JSON.stringify(editingStoryCard.content) || ''}
                    onChange={(e) => setEditingStoryCard({...editingStoryCard, content: e.target.value})}
                    className="w-full h-80 bg-stone-800 border border-stone-800 rounded-xl p-4 focus:outline-none focus:border-stone-600 transition-all resize-none text-lg font-sans leading-relaxed"
                    placeholder="Describe this entity for the AI..."
                  />
                </section>
              </div>

              <div className="flex flex-wrap gap-3 pt-4">
                <button 
                  onClick={() => {
    const copy: StoryCard = {
      ...JSON.parse(JSON.stringify(editingStoryCard)),
      id: Math.random().toString(36).substr(2, 9),
      title: getUniqueTitle(editingStoryCard.title, (view === 'new' ? newAdventure.storyCards : currentAdventure?.storyCards) || []),
      keys: keywordsInput.split(',').map(k => k.trim()).filter(k => k)
    };
                    if (view === 'new') {
                      setNewAdventure(prev => ({
                        ...prev,
                        storyCards: [...(prev.storyCards || []), copy]
                      }));
                    } else if (view === 'game' && currentAdventure) {
                      setGameState(prev => ({
                        ...prev,
                        storyCards: [...prev.storyCards, copy]
                      }));
                    }
                    setEditingStoryCard(null);
                  }}
                  className="flex-1 py-3 bg-stone-900 hover:bg-stone-800 text-stone-400 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Duplicate
                </button>
                <button 
                  onClick={() => {
                    if (view === 'new') {
                      setNewAdventure(prev => ({
                        ...prev,
                        storyCards: (prev.storyCards || []).filter(c => c.id !== editingStoryCard.id)
                      }));
                    } else if (view === 'game' && currentAdventure) {
                      setGameState(prev => ({
                        ...prev,
                        storyCards: prev.storyCards.filter(c => c.id !== editingStoryCard.id)
                      }));
                    }
                    setEditingStoryCard(null);
                  }}
                  className="flex-1 py-3 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/50 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
                <button 
                  onClick={() => {
                    const finalCard = {
                      ...editingStoryCard,
                      keys: keywordsInput.split(',').map(k => k.trim()).filter(k => k)
                    };
                    if (view === 'new') {
                      const exists = (newAdventure.storyCards || []).some(c => c.id === finalCard.id);
                      if (exists) {
                        updateStoryCardInNew(finalCard.id, finalCard);
                      } else {
                        setNewAdventure(prev => ({
                          ...prev,
                          storyCards: [...(prev.storyCards || []), finalCard]
                        }));
                      }
                    } else if (view === 'game' && currentAdventure) {
                      const exists = currentAdventure.storyCards.some(c => c.id === finalCard.id);
                      if (exists) {
                        setGameState(prev => ({
                          ...prev,
                          storyCards: prev.storyCards.map(c => c.id === finalCard.id ? finalCard : c)
                        }));
                      } else {
                        setGameState(prev => ({
                          ...prev,
                          storyCards: [...prev.storyCards, finalCard]
                        }));
                      }
                    }
                    setEditingStoryCard(null);
                  }}
                  className="w-full py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg"
                  style={{ backgroundColor: appState.globalTheme.accent, boxShadow: `0 10px 15px -3px ${appState.globalTheme.accent}33` }}
                >
                  Save Card
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  // Load app state on mount
  useEffect(() => {
    const saved = localStorage.getItem('ai_adventure_forge_app_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAppState(prev => ({
          ...prev,
          currentAdventureId: parsed.currentAdventureId || null,
          view: 'home', // always start at home — restoring 'game' view causes stale adventure issues
          globalTheme: parsed.globalTheme || DEFAULT_THEME,
        }));
      } catch (e) {
        console.error("Failed to load app state:", e);
      }
    }
  }, []);

  // Save app state to server whenever adventures or scenarios change
  useEffect(() => {
    if (isInitialLoad.current) return;
    const saveAdventures = async () => {
      try {
        await fetch('/api/adventures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appState.adventures),
        });
      } catch (error) {
        console.error("Failed to save adventures:", error);
      }
    };
    saveAdventures();
  }, [appState.adventures]);

  // Auto-save to LocalStorage — only small state, NOT adventures/scenarios
  // (those are server-side via /api/adventures and /api/scenarios).
  // Saving large scenario arrays to localStorage causes QuotaExceededError.
  useEffect(() => {
    if (isInitialLoad.current) return;
    const timeoutId = setTimeout(() => {
      setIsSyncing(true);
      setTimeout(() => setIsSyncing(false), 500);
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [appState.adventures, appState.scenarios]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    const saveScenarios = async () => {
      try {
        await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appState.scenarios),
        });
      } catch (error) {
        console.error("Failed to save scenarios:", error);
      }
    };
    saveScenarios();
  }, [appState.scenarios]);

  // Save other state to localStorage
  useEffect(() => {
    const { adventures, scenarios, modelRegistry, ...rest } = appState;
    localStorage.setItem('ai_adventure_forge_app_state', JSON.stringify(rest));
  }, [appState.currentAdventureId, appState.view, appState.globalTheme]);

  const currentAdventure = appState.adventures.find(a => a.id === appState.currentAdventureId);

  // Removed resolvedAdventure as placeholders are disabled

  // Placeholder System: Removed

  useEffect(() => {
    if (currentAdventure?.settings.model) {
      setModelFlash(true);
      const timer = setTimeout(() => setModelFlash(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [currentAdventure?.settings.model]);

  const setGameState = (updater: (prev: GameState) => GameState) => {
    if (!appState.currentAdventureId) return;
    setAppState(prev => ({
      ...prev,
      adventures: prev.adventures.map(a => 
        a.id === prev.currentAdventureId ? updater(a) : a
      )
    }));
  };

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current;
      const timeoutId = setTimeout(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight + 200,
          behavior: 'smooth'
        });
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [currentAdventure?.entries, currentAdventure?.isGenerating, view, appState.currentAdventureId]);

  // Auto-generate first response for new adventures
  useEffect(() => {
    if (view === 'game' && currentAdventure && currentAdventure.entries.length === 1 && !currentAdventure.isGenerating) {
      const firstEntry = currentAdventure.entries[0];
      if (firstEntry.id === 'start') {
        handleAction('');
      }
    }
  }, [view, currentAdventure?.id]);

  const handleAction = async (overrideInput?: string) => {
    if (!currentAdventure || currentAdventure.isGenerating) return;
    const actionInput = overrideInput !== undefined ? overrideInput : input.trim();
    
    // For "Continue", we don't need input if it's just the AI continuing
    if (overrideInput === undefined && !input.trim()) return;

    let updatedEntries = [...currentAdventure.entries];
    
    if (actionInput) {
      const newEntry: StoryEntry = {
        id: Math.random().toString(36).substr(2, 9),
        type: actionType,
        text: actionInput,
        timestamp: Date.now(),
      };
      updatedEntries.push(newEntry);
    }

    // Handle Rolling Models
    let currentModel = currentAdventure.settings.model;
    if (currentAdventure.settings.useRollingModels && appState.modelRegistry.length > 0) {
      const turnCount = updatedEntries.length;
      const freq = currentAdventure.settings.rollingModelFrequency || 5;
      const modelIndex = Math.floor(turnCount / freq) % appState.modelRegistry.length;
      currentModel = appState.modelRegistry[modelIndex];
      console.log(`[Rolling Models] Switching to: ${currentModel}`);
    }

    const updatedState: GameState = {
      ...currentAdventure,
      entries: updatedEntries,
      history: [...currentAdventure.history, currentAdventure.entries].slice(-20), // Limit history depth
      redoStack: [], // Clear redo stack on new action
      isGenerating: true,
      lastPlayed: Date.now(),
      settings: {
        ...currentAdventure.settings,
        model: currentModel
      }
    };

    setGameState(() => updatedState);
    setInput('');

    if (currentAdventure.settings.useDice && shouldTriggerDice(actionType, actionInput)) {
      const roll = Math.floor(Math.random() * 20) + 1;
      setDiceRoll({ value: roll, show: true });
      // AI generation waits for the modal to close
    } else {
      const resolvedState = updatedState;
      await triggerAIGeneration(resolvedState);
    }
  };

  const triggerAIGeneration = async (state: GameState, roll?: number) => {
    abortControllerRef.current = new AbortController();

    try {
      const aiResponse = await generateStoryResponse(state, roll, abortControllerRef.current.signal);

      const aiEntry: StoryEntry = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'ai',
        text: aiResponse,
        timestamp: Date.now(),
      };

      let finalState: GameState = {
        ...state,
        entries: [...state.entries, aiEntry],
        isGenerating: false,
      };

      // ── Memory-safe state: 2-turn edit window ──────────────────────────
      // Exclude the latest 2 AI entries from permanent memory systems (summary,
      // NPC brains, card resolution) so the player has time to edit AI output
      // before it gets baked into summary/NPC state. The prompt history in
      // aiService reads live state.entries, so edits ARE reflected there.
      const MEMORY_DELAY_TURNS = 2;
      const recentAiIndices: number[] = [];
      for (let i = finalState.entries.length - 1; i >= 0 && recentAiIndices.length < MEMORY_DELAY_TURNS; i--) {
        if (finalState.entries[i].type === 'ai') recentAiIndices.push(i);
      }
      const memorySafeEntries = finalState.entries.filter((_, i) => !recentAiIndices.includes(i));
      const memorySafeState: GameState = { ...finalState, entries: memorySafeEntries };

      // Handle Summarization — SMART TRIGGER
      // Instead of a rigid turn interval, check how much unsummarized content exists.
      // Fire early if lots has happened, skip if nothing meaningful has occurred.
      // The frequency slider now sets the MINIMUM interval between summaries.
      const turnCount = finalState.entries.filter(e => e.type === 'ai').length;
      const summaryFreq = finalState.settings.summaryFrequency || 15;
      const lastSummaryTurn = (finalState as any)._lastSummaryTurn || 0;
      const turnsSinceLastSummary = turnCount - lastSummaryTurn;
      
      // Measure unsummarized content — entries since last summary
      const unsummarizedEntries = finalState.entries.slice(-(turnsSinceLastSummary * 2 + 1));
      const unsummarizedLength = unsummarizedEntries.map(e => e.text).join('').length;
      
      // Smart conditions:
      // 1. Minimum interval met (frequency slider) AND some content exists (>500 chars)
      // 2. OR content overflow — so much happened it can't wait (>4000 chars, min 5 turns)
      const intervalReached = turnsSinceLastSummary >= summaryFreq && unsummarizedLength > 500;
      const contentOverflow = unsummarizedLength > 4000 && turnsSinceLastSummary >= 5;
      
      if (finalState.settings.useSummary && turnCount > 0 && (intervalReached || contentOverflow)) {
        const reason = contentOverflow && !intervalReached ? 'content overflow' : `turn interval (${summaryFreq})`;
        console.log(`[Summary] Running — ${reason}, ${unsummarizedLength} chars unsummarized, ${turnsSinceLastSummary} turns since last`);
        setGameState(prev => prev ? { ...prev, isSummarizing: true } : prev);
        const newSummary = await summarizeStory(memorySafeState, abortControllerRef.current.signal);
        finalState = {
          ...finalState,
          summary: newSummary,
          isSummarizing: false,
          _lastSummaryTurn: turnCount, // track when we last summarized
        } as any;
      } else if (!finalState.settings.useSummary) {
        console.log('[Summary] Skipped — disabled by toggle');
      } else if (turnCount > 0 && turnsSinceLastSummary >= summaryFreq && unsummarizedLength <= 500) {
        console.log(`[Summary] Skipped — interval reached but only ${unsummarizedLength} chars unsummarized (too little content)`);
      }

      // Persist advanced beat tracks — detect newly expired beats and write resolutions to cards
      const beatTurnCount = getCurrentTurn(finalState.entries);
      if (finalState.beatTracks && finalState.beatTracks.length > 0) {
        const prevTracks = finalState.beatTracks;
        const nextTracks = advanceBeats(prevTracks, beatTurnCount);
        // Find beats that just transitioned to expired this turn
        let updatedCards = finalState.storyCards;
        const newlyExpiredBeats: StoryBeat[] = [];
        prevTracks.forEach(track => {
          track.beats.forEach(prevBeat => {
            if (prevBeat.status !== 'expired') {
              const nextBeat = nextTracks.flatMap(t => t.beats).find(b => b.id === prevBeat.id);
              if (nextBeat?.status === 'expired') {
                newlyExpiredBeats.push(prevBeat);
                if (prevBeat.linkedCardId) {
                  updatedCards = applyResolutionToCard(updatedCards, prevBeat);
                }
              }
            }
          });
        });
        finalState = { ...finalState, beatTracks: nextTracks, storyCards: updatedCards };

        // Fire card generation for each newly expired beat — background, never blocks
        for (const expiredBeat of newlyExpiredBeats) {
          generateCardFromBeat(finalState, expiredBeat.title, expiredBeat.narrativeGoal, abortControllerRef.current?.signal)
            .then(result => {
              if (!result || result.action === 'skip') return;
              setGameState(prev => {
                if (result.action === 'update' && result.matchTitle) {
                  const existing = prev.storyCards.find(c =>
                    c.title.toLowerCase() === result.matchTitle!.toLowerCase()
                  );
                  if (!existing || !result.card) return prev;
                  return {
                    ...prev,
                    storyCards: prev.storyCards.map(c =>
                      c.id === existing.id
                        ? { ...c, content: result.card!.content, isFleshedOut: true }
                        : c
                    ),
                  };
                }
                if (result.action === 'create' && result.card) {
                  if (prev.storyCards.some(c =>
                    c.title.toLowerCase() === result.card!.title.toLowerCase()
                  )) return prev;
                  return {
                    ...prev,
                    storyCards: [...prev.storyCards, {
                      id: Math.random().toString(36).substr(2, 9),
                      title: result.card.title,
                      type: result.card.type as any,
                      keys: result.card.keys,
                      content: result.card.content,
                      isFleshedOut: false,
                      isUnresolved: result.card.isUnresolved,
                    }],
                  };
                }
                return prev;
              });
              setCardFlash(true);
              setTimeout(() => setCardFlash(false), 1500);
            })
            .catch(() => {});
        }
      }

      setGameState(() => finalState);
      autoSave(finalState);
      
      // Character detection disabled — manual card creation via top-bar button

      // Resolve placeholder card names silently in the background.
      // Uses memorySafeState — excludes latest 2 AI entries (edit window).
      // OPTIMIZATION: pre-check — skip entirely if no unresolved cards exist.
      const hasUnresolvedCards = finalState.storyCards.some(c => c.isUnresolved);
      if (finalState.settings.useCardResolution !== false && hasUnresolvedCards) {
        console.log(`[CardResolution] Running — ${finalState.storyCards.filter(c => c.isUnresolved).length} unresolved card(s)`);
      resolveUnknownCards(memorySafeState, abortControllerRef.current?.signal).then(resolved => {
        if (resolved.length === 0) return;
        setGameState(prev => ({
          ...prev,
          storyCards: prev.storyCards.map(card => {
            const update = resolved.find(r => r.id === card.id);
            return update
              ? { ...card, title: update.title, content: update.content, isUnresolved: false }
              : card;
          }),
        }));
        setCardFlash(true);
        setTimeout(() => setCardFlash(false), 1500);
        console.log(`[AutoCards] Resolved ${resolved.length} placeholder card(s)`);
      }).catch(() => {});
      } else if (!hasUnresolvedCards) {
        console.log('[CardResolution] Skipped — no unresolved cards');
      } else {
        console.log('[CardResolution] Skipped — disabled by toggle');
      }

      // Card+: update NPC brains silently in the background.
      // Uses memorySafeState — excludes latest 2 AI entries (edit window).
      // OPTIMIZATION: throttle to every 3 turns — NPC mood doesn't shift every turn.
      // Never awaited — gameplay continues immediately while brains update.
      const BRAIN_UPDATE_INTERVAL = 3;
      const shouldUpdateBrains = finalState.settings.useCardPlus !== false && turnCount > 0 && turnCount % BRAIN_UPDATE_INTERVAL === 0;
      if (shouldUpdateBrains) {
        console.log(`[Card+] Running NPC brain updates (turn ${turnCount}, every ${BRAIN_UPDATE_INTERVAL} turns)`);
      updateNpcBrain(memorySafeState).then(brainUpdates => {
        if (brainUpdates.length === 0) return;
        setGameState(prev => {
          if (!prev) return prev;
          const updatedCards = prev.storyCards.map(card => {
            const update = brainUpdates.find(u => u.id === card.id);
            return update ? { ...card, notes: update.notes } : card;
          });
          return { ...prev, storyCards: updatedCards };
        });
      }).catch(() => {}); // Silent failure — never interrupts gameplay
      } else if (finalState.settings.useCardPlus === false) {
        console.log('[Card+] Skipped — disabled by toggle');
      } else {
        console.log(`[Card+] Skipped — next update at turn ${Math.ceil((turnCount + 1) / BRAIN_UPDATE_INTERVAL) * BRAIN_UPDATE_INTERVAL}`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("[AI] Generation aborted by user.");
      } else {
        console.error("Action Error:", error);
      }
      setGameState(prev => prev ? { ...prev, isGenerating: false, isSummarizing: false } : prev);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const autoSave = async (state: GameState) => {
    try {
      // Patch the single adventure in the full adventures array server-side.
      // /api/save doesn't exist — /api/adventures handles persistence.
      const updated = appState.adventures.map(a => a.id === state.id ? state : a);
      await fetch('/api/adventures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    } catch (error) {
      console.error("Failed to auto-save:", error);
    }
  };

  const undoTurn = () => {
    if (!currentAdventure || currentAdventure.history.length === 0) return;
    
    const previousEntries = currentAdventure.history[currentAdventure.history.length - 1];
    const newHistory = currentAdventure.history.slice(0, -1);
    
    const updatedState: GameState = {
      ...currentAdventure,
      entries: previousEntries,
      history: newHistory,
      redoStack: [currentAdventure.entries, ...currentAdventure.redoStack].slice(0, 20), // Limit redo depth
    };
    
    setGameState(() => updatedState);
    autoSave(updatedState);
  };

  const redoTurn = () => {
    if (!currentAdventure || currentAdventure.redoStack.length === 0) return;
    
    const nextEntries = currentAdventure.redoStack[0];
    const newRedoStack = currentAdventure.redoStack.slice(1);
    
    const updatedState: GameState = {
      ...currentAdventure,
      entries: nextEntries,
      history: [...currentAdventure.history, currentAdventure.entries].slice(-20), // Limit history depth
      redoStack: newRedoStack,
    };
    
    setGameState(() => updatedState);
    autoSave(updatedState);
  };

  const retryTurn = async () => {
    if (!currentAdventure || currentAdventure.entries.length < 2) return;
    
    // Find the last AI entry
    const lastEntry = currentAdventure.entries[currentAdventure.entries.length - 1];
    if (lastEntry.type !== 'ai') return;

    // Remove the last AI entry and regenerate
    const entriesWithoutLastAI = currentAdventure.entries.slice(0, -1);
    
    const updatedState: GameState = {
      ...currentAdventure,
      entries: entriesWithoutLastAI,
      isGenerating: true,
    };

    setGameState(() => updatedState);
    
    abortControllerRef.current = new AbortController();

    try {
      const aiResponse = await generateStoryResponse(updatedState, undefined, abortControllerRef.current.signal, true);

      const aiEntry: StoryEntry = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'ai',
        text: aiResponse,
        timestamp: Date.now(),
      };

      const finalState: GameState = {
        ...updatedState,
        entries: [...updatedState.entries, aiEntry],
        isGenerating: false,
      };

      setGameState(() => finalState);
      autoSave(finalState);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("[AI] Retry aborted by user.");
      } else {
        console.error("Retry Error:", error);
      }
      setGameState(prev => prev ? { ...prev, isGenerating: false } : prev);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const continueStory = () => {
    if (currentAdventure.isGenerating) return;
    handleAction('');
  };

  const createAdventure = () => {
    if (!newAdventure.title || !newAdventure.premise) {
      alert("Title and Beginning Prompt are required!");
      return;
    }

    if (editingId && editingType === 'adventure') {
      setAppState(prev => ({
        ...prev,
        adventures: prev.adventures.map(a => a.id === editingId ? {
          ...a,
          ...newAdventure,
          id: a.id, // keep original id
          lastPlayed: Date.now(),
        } as GameState : a),
        currentAdventureId: editingId
      }));
      setView('game');
      resetNewAdventureForm();
      return;
    }

      const adventure: GameState = {
        id: Math.random().toString(36).substr(2, 9),
        title: getUniqueTitle(newAdventure.title || 'Untitled Adventure', appState.adventures),
        description: newAdventure.description || '',
        image: newAdventure.image || '',
        premise: newAdventure.premise || '',
        aiInstructions: newAdventure.aiInstructions || '',
        authorsNote: newAdventure.authorsNote || '',
        summary: newAdventure.summary || '',
        entries: [
          { id: 'start', type: 'ai', text: newAdventure.premise || '', timestamp: Date.now() }
        ],
        history: [],
        redoStack: [],
        storyCards: newAdventure.storyCards || [],
        plotEssentials: newAdventure.plotEssentials || '',
        isGenerating: false,
        isSummarizing: false,
        lastPlayed: Date.now(),
        settings: newAdventure.settings || DEFAULT_SETTINGS,
        theme: newAdventure.theme || DEFAULT_THEME,
        beatTracks: newAdventure.beatTracks || createDefaultTracks(),
      };

    setAppState(prev => ({
      ...prev,
      adventures: [adventure, ...prev.adventures],
      currentAdventureId: adventure.id,
    }));
    setView('game');
    resetNewAdventureForm();
  };

  const saveScenario = () => {
    if (!newAdventure.title || !newAdventure.premise) {
      alert("Title and Beginning Prompt are required!");
      return;
    }

    const scenario: GameState = {
      id: editingId && editingType === 'scenario' ? editingId : Math.random().toString(36).substr(2, 9),
      title: newAdventure.title || 'Untitled Scenario',
      description: newAdventure.description || '',
      image: newAdventure.image || '',
      premise: newAdventure.premise || '',
      aiInstructions: newAdventure.aiInstructions || '',
      authorsNote: newAdventure.authorsNote || '',
      summary: newAdventure.summary || '',
      entries: [],
      history: [],
      redoStack: [],
      storyCards: newAdventure.storyCards || [],
      plotEssentials: newAdventure.plotEssentials || '',
      isGenerating: false,
      isSummarizing: false,
      lastPlayed: Date.now(),
      settings: newAdventure.settings || DEFAULT_SETTINGS,
      theme: newAdventure.theme || DEFAULT_THEME,
      beatTracks: newAdventure.beatTracks || createDefaultTracks(),
    };

    setAppState(prev => {
      if (editingId && editingType === 'scenario') {
        return {
          ...prev,
          scenarios: prev.scenarios.map(s => s.id === editingId ? scenario : s)
        };
      } else {
        return {
          ...prev,
          scenarios: [scenario, ...prev.scenarios]
        };
      }
    });
    setView('home');
    setHomeTab('scenarios');
    resetNewAdventureForm();
  };

  const resetNewAdventureForm = () => {
    setNewAdventure({
      title: '',
      description: '',
      premise: '',
      aiInstructions: '',
      authorsNote: '',
      plotEssentials: '',
      summary: '',
      storyCards: [],
      image: '',
      settings: { ...DEFAULT_SETTINGS, model: appState.globalSettings.model },
      theme: DEFAULT_THEME,
    });
    setEditingId(null);
    setEditingType(null);
  };

  const startAdventure = async (adventure: GameState) => {
    if (placeholderModalRef.current) return;
    setIsLoadingModel(true);
    let modelToLoad = adventure.settings.model || '';
    
    // Check if the current model exists in the registry
    if (!appState.modelRegistry.includes(modelToLoad)) {
      console.log(`[AI] Model ${modelToLoad} not found in registry. Selecting a fallback.`);
      modelToLoad = appState.modelRegistry.length > 0 
        ? appState.modelRegistry[Math.floor(Math.random() * appState.modelRegistry.length)]
        : '';
    }

    // Update model in state first to ensure it's available for the game view
    setAppState(prev => ({
      ...prev,
      adventures: prev.adventures.map(a => 
        a.id === adventure.id ? { ...a, settings: { ...a.settings, model: modelToLoad } } : a
      ),
      currentAdventureId: adventure.id
    }));

    try {
      if (modelToLoad) {
        await fetch('/api/load-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelName: modelToLoad })
        });
      }
    } catch (e) {
      console.error("Failed to pre-load model:", e);
    }
    
    setView('game');
    setIsLoadingModel(false);
  };

  // ── Placeholder helpers ───────────────────────────────────────────────────────
  const scanPlaceholders = (scenario: GameState): string[] => {
    const cards = scenario.storyCards || [];
    const fields = [
      scenario.premise,
      scenario.aiInstructions,
      scenario.plotEssentials,
      scenario.authorsNote,
      ...cards.map(c => c.content),
      ...cards.map(c => c.title),
      ...cards.map(c => c.keys.join(' ')),
    ];
    const found = new Set<string>();
    fields.forEach(text => {
      (text || '').replace(/\$\{([^}]+)\}/g, (_, label) => {
        found.add(label.trim());
        return '';
      });
    });
    return Array.from(found);
  };

  const applyPlaceholders = (scenario: GameState, values: Record<string, string>): GameState => {
    const replace = (text: string) =>
      (text || '').replace(/\$\{([^}]+)\}/g, (_, label) => values[label.trim()] ?? '');
    return {
      ...scenario,
      premise: replace(scenario.premise),
      aiInstructions: replace(scenario.aiInstructions || ''),
      plotEssentials: replace(scenario.plotEssentials || ''),
      authorsNote: replace(scenario.authorsNote || ''),
      storyCards: (scenario.storyCards || []).map(c => ({
        ...c,
        title: replace(c.title),
        content: replace(c.content),
        keys: c.keys.map(replace),
      })),
    };
  };

  const startFromScenario = (scenario: GameState) => {
    console.log('[Debug] startFromScenario called, ref:', placeholderModalRef.current, 'scenario:', scenario?.title);
    if (placeholderModalRef.current) {
      console.log('[Debug] blocked by ref');
      return;
    }
    const placeholders = scanPlaceholders(scenario);
    console.log('[Debug] placeholders found:', placeholders);
    if (placeholders.length > 0) {
      placeholderModalRef.current = true;
      setPlaceholderModal({
        scenario,
        placeholders,
        values: Object.fromEntries(placeholders.map(p => [p, ''])),
      });
      return;
    }
    _launchFromScenario(scenario);
  };

  const _launchFromScenario = async (scenario: GameState) => {
    setIsLoadingModel(true);
    let modelToLoad = scenario.settings.model || '';

    if (!appState.modelRegistry.includes(modelToLoad)) {
      console.log(`[AI] Model ${modelToLoad} not found in registry. Selecting a fallback.`);
      modelToLoad = appState.modelRegistry.length > 0
        ? appState.modelRegistry[Math.floor(Math.random() * appState.modelRegistry.length)]
        : '';
    }

    try {
      if (modelToLoad) {
        await fetch('/api/load-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelName: modelToLoad })
        });
      }
    } catch (e) {
      console.error("Failed to pre-load model:", e);
    }

    const adventure: GameState = {
      ...JSON.parse(JSON.stringify(scenario)),
      id: Math.random().toString(36).substr(2, 9),
      title: getUniqueTitle(scenario.title, appState.adventures),
      summary: scenario.summary || '',
      isSummarizing: false,
      settings: {
        ...scenario.settings,
        model: modelToLoad
      },
      beatTracks: scenario.beatTracks && scenario.beatTracks.length > 0 ? scenario.beatTracks : createDefaultTracks(),
      entries: [
        { id: 'start', type: 'ai', text: scenario.premise, timestamp: Date.now() }
      ],
      history: [],
      redoStack: [],
      lastPlayed: Date.now(),
    };

    setAppState(prev => ({
      ...prev,
      adventures: [adventure, ...prev.adventures],
      currentAdventureId: adventure.id,
    }));
    setView('game');
    setIsLoadingModel(false);
  };

  const editScenario = (scenario: GameState, e: React.MouseEvent) => {
    e.stopPropagation();
    setNewAdventure({
      ...scenario
    });
    setEditingId(scenario.id);
    setEditingType('scenario');
    setView('new');
  };

  const deleteScenario = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete({ id, type: 'scenario' });
  };

  const duplicateScenario = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const original = appState.scenarios.find(s => s.id === id);
    if (!original) return;

    const copy: GameState = {
      ...JSON.parse(JSON.stringify(original)),
      id: Math.random().toString(36).substr(2, 9),
      title: getUniqueTitle(original.title, appState.scenarios),
      lastPlayed: Date.now(),
    };

    setAppState(prev => ({
      ...prev,
      scenarios: [copy, ...prev.scenarios]
    }));
  };

  const deleteAdventure = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete({ id, type: 'adventure' });
  };

  const duplicateAdventure = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const original = appState.adventures.find(a => a.id === id);
    if (!original) return;

    const copy: GameState = {
      ...JSON.parse(JSON.stringify(original)),
      id: Math.random().toString(36).substr(2, 9),
      title: getUniqueTitle(original.title, appState.adventures),
      lastPlayed: Date.now(),
    };

    setAppState(prev => ({
      ...prev,
      adventures: [copy, ...prev.adventures]
    }));
  };

  const cancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGameState(prev => prev ? { ...prev, isGenerating: false, isSummarizing: false } : prev);
  };

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    const { id, type } = confirmDelete;
    
    setAppState(prev => {
      if (type === 'scenario') {
        return {
          ...prev,
          scenarios: prev.scenarios.filter(s => s.id !== id)
        };
      } else {
        return {
          ...prev,
          adventures: prev.adventures.filter(a => a.id !== id),
          currentAdventureId: prev.currentAdventureId === id ? null : prev.currentAdventureId
        };
      }
    });
    setConfirmDelete(null);
  };

  const exportAdventure = (adventure: GameState) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(adventure, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${adventure.title.replace(/\s+/g, '_')}_export.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importAdventure = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as GameState;
        if (!imported.title || !imported.entries) {
          throw new Error("Invalid adventure file format.");
        }
        imported.id = Math.random().toString(36).substr(2, 9);
        imported.lastPlayed = Date.now();
        setAppState(prev => ({
          ...prev,
          adventures: [imported, ...prev.adventures]
        }));
        alert("Adventure imported successfully!");
      } catch (err) {
        alert("Failed to import adventure: " + (err instanceof Error ? err.message : "Invalid JSON"));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const exportStoryCards = (cards: StoryCard[]) => {
    const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-cards-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importStoryCards = (e: React.ChangeEvent<HTMLInputElement>, target: 'new' | 'current') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        const cards = Array.isArray(imported) ? imported : [imported];
        
        // Validate cards
        const validCards = cards.filter(c => c.title && c.content);

        if (target === 'new') {
          setNewAdventure(prev => ({
            ...prev,
            storyCards: [...(prev.storyCards || []), ...validCards]
          }));
        } else {
          setGameState(prev => ({
            ...prev,
            storyCards: [...prev.storyCards, ...validCards]
          }));
        }
      } catch (err) {
        console.error("Failed to import story cards:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset
  };

  const importScenario = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as GameState;
        if (!imported.title || !imported.premise) {
          throw new Error("Invalid scenario file format.");
        }
        imported.id = Math.random().toString(36).substr(2, 9);
        imported.lastPlayed = Date.now();
        imported.entries = []; // Scenarios shouldn't have entries
        setAppState(prev => ({
          ...prev,
          scenarios: [imported, ...prev.scenarios]
        }));
        alert("Scenario imported successfully!");
      } catch (err) {
        alert("Failed to import scenario: " + (err instanceof Error ? err.message : "Invalid JSON"));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addModelToRegistry = (modelId: string) => {
    if (!modelId.trim() || appState.modelRegistry.includes(modelId)) return;
    setAppState(prev => ({
      ...prev,
      modelRegistry: [...prev.modelRegistry, modelId.trim()]
    }));
  };

  const removeModelFromRegistry = (modelId: string) => {
    setAppState(prev => ({
      ...prev,
      modelRegistry: prev.modelRegistry.filter(m => m !== modelId)
    }));
  };

  const loadModelsFromFile = async () => {
    try {
      const response = await fetch('/models/models.json');
      if (!response.ok) throw new Error("Could not find models.json in /models folder.");
      const data = await response.json();
      if (data.models && Array.isArray(data.models)) {
        setAppState(prev => {
          const newModels = data.models.filter((m: string) => !prev.modelRegistry.includes(m));
          if (newModels.length === 0) {
            alert("No new models found in file.");
            return prev;
          }
          alert(`Loaded ${newModels.length} new models.`);
          return {
            ...prev,
            modelRegistry: [...prev.modelRegistry, ...newModels]
          };
        });
      }
    } catch (err) {
      alert("Error loading models: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'new' | 'current') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert("Please select an image file.");
      return;
    }

    // Use Object URL for better performance and reliability
    const imageUrl = URL.createObjectURL(file);
    setCropImage(imageUrl);
    setCropTarget(target);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  const startEditing = (entry: StoryEntry) => {
    setEditingEntryId(entry.id);
    setEditValue(entry.text);
  };

  const saveEdit = () => {
    if (!editingEntryId) return;
    setGameState(prev => ({
      ...prev,
      entries: prev.entries.map(e => e.id === editingEntryId ? { ...e, text: editValue } : e)
    }));
    setEditingEntryId(null);
  };

  const cancelEdit = () => {
    setEditingEntryId(null);
  };

  const deleteEntry = (id: string) => {
    if (confirm("Delete this entry?")) {
      setGameState(prev => ({
        ...prev,
        entries: prev.entries.filter(e => e.id !== id)
      }));
    }
  };

  const renderCropperModal = () => (
    <AnimatePresence>
      {cropImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] bg-black/95 flex flex-col items-center justify-center p-4 md:p-8"
        >
          <div className="relative w-full max-w-5xl h-[50vh] md:h-[70vh] bg-stone-900 rounded-2xl overflow-hidden border border-stone-800 shadow-2xl">
            <Cropper
              image={cropImage}
              crop={crop}
              zoom={zoom}
              aspect={16 / 9}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          </div>
          
          <div className="mt-8 flex items-center gap-6">
            <div className="flex items-center gap-4">
              <span className="text-stone-400 text-xs uppercase tracking-widest font-bold">Zoom</span>
              <input
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                aria-labelledby="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-48"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (cropImage && cropImage.startsWith('blob:')) {
                    URL.revokeObjectURL(cropImage);
                  }
                  setCropImage(null);
                }}
                className="px-6 py-2 bg-stone-800 hover:bg-stone-700 text-white rounded-full text-xs font-sans font-bold uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCropSave}
                className="px-6 py-2 text-white rounded-full text-xs font-sans font-bold uppercase tracking-widest transition-all flex items-center gap-2"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                <Check className="w-4 h-4" />
                Save Crop
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );



  const renderAdventureSettings = () => {
    if (!currentAdventure) return null;
    return (
      <>
        {/* 1. Cover Image */}
        <section className="space-y-3">
          <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Adventure Cover</label>
          <div className="relative h-32 bg-stone-900 border border-stone-800 rounded-xl overflow-hidden group">
            {currentAdventure.image ? (
              <>
                <img src={currentAdventure.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div 
                  onClick={() => fileInputRefCurrent.current?.click()}
                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-all"
                >
                  <ImageIcon className="w-6 h-6 mb-1" />
                  <span className="text-[10px] uppercase font-bold">Change Cover</span>
                  <input 
                    ref={fileInputRefCurrent}
                    type="file" 
                    className="hidden" 
                    accept="image/*" 
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleImageUpload(e, 'current')} 
                  />
                </div>
              </>
            ) : (
              <div 
                onClick={() => fileInputRefCurrent.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-stone-800/50 transition-all"
              >
                <ImageIcon className="w-6 h-6 text-stone-600 mb-1" />
                <span className="text-[10px] text-stone-500 uppercase font-bold">Upload Cover</span>
                <input 
                  ref={fileInputRefCurrent}
                  type="file" 
                  className="hidden" 
                  accept="image/*" 
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleImageUpload(e, 'current')} 
                />
              </div>
            )}
          </div>
        </section>

        {/* 2. Title */}
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Adventure Title</h3>
          <input 
            value={currentAdventure.title}
            onChange={(e) => setGameState(prev => ({ ...prev, title: e.target.value }))}
            className="w-full bg-stone-800 border border-stone-800 rounded-lg p-4 text-lg font-sans focus:outline-none focus:border-stone-600 transition-colors"
          />
        </section>

        {/* 3. Premise */}
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Starting Prompt</h3>
          <textarea 
            value={currentAdventure.premise}
            onChange={(e) => setGameState(prev => ({ ...prev, premise: e.target.value }))}
            className="w-full h-48 bg-stone-800 border border-stone-800 rounded-lg p-4 text-lg font-sans focus:outline-none focus:border-stone-600 transition-colors resize-none"
          />
        </section>

        {/* 4. AI Instructions */}
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">AI Instructions</h3>
          <div className="space-y-2">
            <textarea 
              value={currentAdventure.aiInstructions}
              onChange={(e) => setGameState(prev => ({ ...prev, aiInstructions: e.target.value }))}
              className="w-full h-80 bg-stone-800 border border-stone-800 rounded-lg p-4 text-lg font-sans focus:outline-none focus:border-stone-600 transition-colors resize-none"
            />
            <button 
              onClick={() => setGameState(prev => ({ ...prev, aiInstructions: DEFAULT_AI_INSTRUCTIONS }))}
              className="px-4 py-2 rounded-lg text-[10px] uppercase font-bold transition-all border border-stone-800 hover:bg-stone-800 text-stone-400"
            >
              Use Default
            </button>
          </div>
        </section>

        {/* 5. Plot Essentials */}
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Plot Essentials</h3>
          <textarea 
            value={currentAdventure.plotEssentials}
            onChange={(e) => setGameState(prev => ({
              ...prev,
              plotEssentials: e.target.value
            }))}
            placeholder="Core rules and plot points the AI must follow..."
            className="w-full h-96 bg-stone-800 border border-stone-800 rounded p-4 text-lg font-sans focus:outline-none focus:border-stone-600 resize-none leading-relaxed"
          />
        </section>

        {/* 6. Author's Note */}
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Author's Note</h3>
          <textarea 
            value={currentAdventure.authorsNote}
            onChange={(e) => setGameState(prev => ({ ...prev, authorsNote: e.target.value }))}
            className="w-full h-80 bg-stone-800 border border-stone-800 rounded-lg p-4 text-lg font-sans focus:outline-none focus:border-stone-600 transition-colors resize-none"
          />
        </section>

        {/* 7. Story Summarization */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Story Summarization</h3>
            <button 
              onClick={() => setGameState(prev => ({ ...prev, settings: { ...prev.settings, useSummary: !prev.settings.useSummary } }))}
              className="w-10 h-5 rounded-full transition-colors relative bg-stone-800"
              style={currentAdventure.settings.useSummary ? { backgroundColor: appState.globalTheme.accent } : {}}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                currentAdventure.settings.useSummary ? "left-6" : "left-1"
              )} />
            </button>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-stone-500 uppercase font-bold">Summary Frequency ({currentAdventure.settings.summaryFrequency || 15} turns)</label>
            <input 
              type="range" min="5" max="50" step="1"
              value={currentAdventure.settings.summaryFrequency || 15}
              onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, summaryFrequency: parseInt(e.target.value) } }))}
              className="w-full"
              style={{ accentColor: appState.globalTheme.accent }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-stone-500 uppercase font-bold">Summary Token Limit</label>
            <input 
              type="number"
              value={currentAdventure.settings.summaryTokenLimit || 500}
              onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, summaryTokenLimit: parseInt(e.target.value) } }))}
              className="w-full bg-stone-900 border border-stone-800 rounded p-2 text-xs focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Story Summary</label>
              <button 
                onClick={async () => {
                  setGameState(prev => ({ ...prev, isSummarizing: true }));
                  const newSummary = await summarizeStory(currentAdventure);
                  setGameState(prev => ({ ...prev, summary: newSummary, isSummarizing: false }));
                }}
                className="text-[10px] uppercase font-bold hover:opacity-80 flex items-center gap-1"
                style={{ color: appState.globalTheme.accent }}
              >
                <RefreshCw className={cn("w-3 h-3", currentAdventure.isSummarizing && "animate-spin")} />
                Force Update
              </button>
            </div>
            <textarea 
              value={currentAdventure.summary || ''}
              onChange={(e) => setGameState(prev => ({ ...prev, summary: e.target.value }))}
              className="w-full h-80 bg-stone-800 border border-stone-800 rounded p-4 text-lg font-sans leading-relaxed focus:outline-none focus:border-stone-700 resize-none"
              placeholder="The story summary will appear here..."
            />
          </div>
        </div>

        {/* Actions & Tools */}
        <section className="pt-4 border-t border-stone-800 space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Actions & Tools</h3>
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => exportAdventure(currentAdventure)}
              className="py-3 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-xl text-[10px] font-sans font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-stone-800"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <label className="py-3 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-xl text-[10px] font-sans font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-stone-800 cursor-pointer">
              <Upload className="w-4 h-4" />
              Import
              <input type="file" className="hidden" accept=".json" onChange={importAdventure} />
            </label>
          </div>
        </section>
      </>
    );
  };

  const renderCardSettings = () => {
    if (!currentAdventure) return null;
    return (
      <section className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Story Cards</h3>
          <div className="flex gap-2">
            <button 
              onClick={() => exportStoryCards(currentAdventure.storyCards)}
              className="p-1 hover:bg-stone-800 rounded text-stone-400"
              title="Export All Cards"
            >
              <Download className="w-4 h-4" />
            </button>
            <label className="p-1 hover:bg-stone-800 rounded text-stone-400 cursor-pointer" title="Import Cards">
              <Upload className="w-4 h-4" />
              <input type="file" className="hidden" accept=".json" onChange={(e) => importStoryCards(e, 'current')} />
            </label>
            <button 
              onClick={() => setEditingStoryCard({
                id: Math.random().toString(36).substr(2, 9),
                title: '',
                type: 'character',
                keys: [],
                content: ''
              })}
              className="p-1 hover:bg-stone-800 rounded text-stone-400"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {currentAdventure.storyCards.map(card => (
            <div 
              key={card.id} 
              onClick={() => setEditingStoryCard(card)}
              className="bg-stone-900 border border-stone-800 rounded-lg p-3 space-y-2 group relative cursor-pointer hover:border-stone-600 transition-all"
            >
              <div className="flex justify-between items-start">
                <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: appState.globalTheme.accent }}>{card.type}</span>
                <h4 className="font-bold text-sm text-stone-200">{card.title || 'Untitled Card'}</h4>
              </div>
              <p className="text-[10px] text-stone-500 line-clamp-2 font-sans">{typeof card.content === 'string' ? card.content : JSON.stringify(card.content) || 'No description...'}</p>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderAISettings = () => {
    if (!currentAdventure) return null;
    return (
      <section className="space-y-8 pb-12">
        {/* Model selector */}
        <div className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Model selector</h3>
          <SearchableModelSelect 
            value={currentAdventure.settings.model}
            options={appState.modelRegistry}
            onChange={(val) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, model: val } }))}
            className="p-3 rounded"
          />
        </div>

        {/* Rolling Models toggle and slider */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Rolling Models</h3>
            <button 
              onClick={() => setGameState(prev => ({ ...prev, settings: { ...prev.settings, useRollingModels: !prev.settings.useRollingModels } }))}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative bg-stone-800",
                currentAdventure.settings.useRollingModels && "opacity-100"
              )}
              style={currentAdventure.settings.useRollingModels ? { backgroundColor: appState.globalTheme.accent } : {}}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                currentAdventure.settings.useRollingModels ? "left-6" : "left-1"
              )} />
            </button>
          </div>
          {currentAdventure.settings.useRollingModels && (
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Turn Amount ({currentAdventure.settings.rollingModelFrequency} turns)</label>
              <input 
                type="range" min="1" max="20" step="1"
                value={currentAdventure.settings.rollingModelFrequency}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, rollingModelFrequency: parseInt(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
          )}
        </div>

        {/* Context & Memory Settings */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Context & Memory Settings</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Memory Limit ({currentAdventure.settings.memoryLimit} entries)</label>
              <input 
                type="range" min="5" max="100" step="1"
                value={currentAdventure.settings.memoryLimit}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, memoryLimit: parseInt(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Context Window ({currentAdventure.settings.memoryTokens || 1024} tokens)</label>
              <input 
                type="range" min="256" max="8192" step="128"
                value={currentAdventure.settings.memoryTokens || 1024}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, memoryTokens: parseInt(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
          </div>
        </div>

        {/* Creativity & Randomness (Sampling) */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Creativity & Randomness (Sampling)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Temp ({currentAdventure.settings.temperature})</label>
              <input 
                type="range" min="0" max="2" step="0.1"
                value={currentAdventure.settings.temperature}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, temperature: parseFloat(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Top P ({currentAdventure.settings.topP})</label>
              <input 
                type="range" min="0" max="1" step="0.05"
                value={currentAdventure.settings.topP}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, topP: parseFloat(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Min P ({currentAdventure.settings.minP || 0.05})</label>
              <input 
                type="range" min="0" max="1" step="0.01"
                value={currentAdventure.settings.minP || 0.05}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, minP: parseFloat(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Top K ({currentAdventure.settings.topK})</label>
              <input 
                type="number"
                value={currentAdventure.settings.topK}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, topK: parseInt(e.target.value) } }))}
                className="w-full bg-stone-900 border border-stone-800 rounded p-2 text-xs focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Style & Coherence Penalties */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Style & Coherence Penalties</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Repetition Penalty ({currentAdventure.settings.repetitionPenalty || 1.1})</label>
              <input 
                type="range" min="1" max="2" step="0.05"
                value={currentAdventure.settings.repetitionPenalty || 1.1}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, repetitionPenalty: parseFloat(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Frequency Penalty ({currentAdventure.settings.frequencyPenalty || 0})</label>
              <input 
                type="range" min="0" max="2" step="0.1"
                value={currentAdventure.settings.frequencyPenalty || 0}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, frequencyPenalty: parseFloat(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Presence Penalty ({currentAdventure.settings.presencePenalty || 0})</label>
              <input 
                type="range" min="0" max="2" step="0.1"
                value={currentAdventure.settings.presencePenalty || 0}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, presencePenalty: parseFloat(e.target.value) } }))}
                className="w-full"
                style={{ accentColor: appState.globalTheme.accent }}
              />
            </div>
          </div>
        </div>

        {/* Structural & Content constraints */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Structural & Content constraints</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Max Tokens ({currentAdventure.settings.maxOutputTokens})</label>
              <input 
                type="number"
                value={currentAdventure.settings.maxOutputTokens}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, maxOutputTokens: parseInt(e.target.value) } }))}
                className="w-full bg-stone-900 border border-stone-800 rounded p-2 text-xs focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-stone-500 uppercase font-bold">Stop Sequences (comma separated)</label>
              <input 
                type="text"
                value={(currentAdventure.settings.stopSequences || []).join(', ')}
                onChange={(e) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, stopSequences: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } }))}
                className="w-full bg-stone-900 border border-stone-800 rounded p-2 text-xs focus:outline-none"
                placeholder="e.g. \n, ###, User:"
              />
            </div>
          </div>
        </div>

        {/* Dice Mechanic */}
        <div className="flex items-center justify-between p-4 bg-stone-900/50 border border-stone-800 rounded-xl">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-stone-200 font-sans font-bold flex items-center gap-2">
              <Dices className="w-4 h-4" /> d20 Dice Mechanic
            </label>
            <p className="text-[10px] text-stone-500 font-sans">Roll for success on every action</p>
          </div>
          <button 
            onClick={() => setGameState(prev => ({ ...prev, settings: { ...prev.settings, useDice: !prev.settings.useDice } }))}
            className={cn(
              "w-12 h-6 rounded-full transition-all relative",
              currentAdventure.settings.useDice ? "" : "bg-stone-800"
            )}
            style={currentAdventure.settings.useDice ? { backgroundColor: appState.globalTheme.accent } : {}}
          >
            <div className={cn(
              "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
              currentAdventure.settings.useDice ? "left-7" : "left-1"
            )} />
          </button>
        </div>

        {/* Model Management */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Background Systems</h3>
          <p className="text-[10px] text-stone-600">Each enabled system runs an extra AI call per turn. Disable to speed up gameplay.</p>
          
          {/* Card+ (NPC Brains) */}
          <div className="flex items-center justify-between p-3 bg-stone-900/50 border border-stone-800 rounded-xl">
            <div className="space-y-0.5">
              <label className="text-[10px] uppercase tracking-widest text-stone-300 font-bold">Card+ (NPC Brains)</label>
              <p className="text-[10px] text-stone-600">Updates NPC mood, goals & secrets each turn</p>
            </div>
            <button 
              onClick={() => setGameState(prev => ({ ...prev, settings: { ...prev.settings, useCardPlus: !(prev.settings.useCardPlus !== false) } }))}
              className={cn("w-10 h-5 rounded-full transition-colors relative bg-stone-800")}
              style={currentAdventure.settings.useCardPlus !== false ? { backgroundColor: appState.globalTheme.accent } : {}}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                currentAdventure.settings.useCardPlus !== false ? "left-6" : "left-1"
              )} />
            </button>
          </div>

          {/* Card Resolution */}
          <div className="flex items-center justify-between p-3 bg-stone-900/50 border border-stone-800 rounded-xl">
            <div className="space-y-0.5">
              <label className="text-[10px] uppercase tracking-widest text-stone-300 font-bold">Auto Card Resolution</label>
              <p className="text-[10px] text-stone-600">Resolves placeholder card names from beats</p>
            </div>
            <button 
              onClick={() => setGameState(prev => ({ ...prev, settings: { ...prev.settings, useCardResolution: !(prev.settings.useCardResolution !== false) } }))}
              className={cn("w-10 h-5 rounded-full transition-colors relative bg-stone-800")}
              style={currentAdventure.settings.useCardResolution !== false ? { backgroundColor: appState.globalTheme.accent } : {}}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                currentAdventure.settings.useCardResolution !== false ? "left-6" : "left-1"
              )} />
            </button>
          </div>

          {/* Summarization */}
          <div className="flex items-center justify-between p-3 bg-stone-900/50 border border-stone-800 rounded-xl">
            <div className="space-y-0.5">
              <label className="text-[10px] uppercase tracking-widest text-stone-300 font-bold">Auto Summarization</label>
              <p className="text-[10px] text-stone-600">Compresses story every {currentAdventure.settings.summaryFrequency || 15} turns</p>
            </div>
            <button 
              onClick={() => setGameState(prev => ({ ...prev, settings: { ...prev.settings, useSummary: !prev.settings.useSummary } }))}
              className={cn("w-10 h-5 rounded-full transition-colors relative bg-stone-800")}
              style={currentAdventure.settings.useSummary ? { backgroundColor: appState.globalTheme.accent } : {}}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                currentAdventure.settings.useSummary ? "left-6" : "left-1"
              )} />
            </button>
          </div>
        </div>

        {/* Model Management */}
        <div className="space-y-4 pt-4 border-t border-stone-800">
          <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Model Management</h3>
          <button 
            onClick={() => {
              const modelId = currentAdventure.settings.model;
              setAppState(prev => ({
                ...prev,
                modelRegistry: prev.modelRegistry.filter(m => m !== modelId)
              }));
            }}
            className="w-full py-3 bg-red-900/20 hover:bg-red-900/30 text-red-400 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-red-900/30"
          >
            Remove Current Model from Registry
          </button>
        </div>
      </section>
    );
  };


  // ── Story Beats UI ─────────────────────────────────────────────────────────

  const BEAT_STATUS_COLORS: Record<string, string> = {
    pending:       '#6b7280',
    foreshadowing: '#a78bfa',
    active:        '#22c55e',
    completed:     '#3b82f6',
    expired:       '#ef4444',
  };

  // Appends a beat's resolution to its linked story card's Info section.
  // Called on both manual and auto completion.
  const applyResolutionToCard = (
    cards: StoryCard[],
    beat: StoryBeat,
  ): StoryCard[] => {
    if (!beat.linkedCardId) return cards;
    const resolutionText = beat.resolution?.trim()
      || `${beat.title} came to pass.`; // fallback if player left it blank
    return cards.map(card => {
      if (card.id !== beat.linkedCardId) return card;
      const content = card.content || '';
      // Append to Info: line if present, otherwise add new Info line
      if (/^Info:/m.test(content)) {
        return { ...card, content: content.replace(/^(Info:.*)$/m, `$1 / ${resolutionText}`) };
      }
      return { ...card, content: content.trimEnd() + `\nInfo: ${resolutionText}` };
    });
  };

  // Fires on manual beat completion. Applies resolution to linked card,
  // then silently generates/updates a story card for the beat's central character.
  const handleBeatComplete = (beat: StoryBeat, currentTurn: number) => {
    setGameState(prev => ({
      ...prev,
      beatTracks: completeBeat(prev.beatTracks || [], beat.id, currentTurn),
      storyCards: applyResolutionToCard(prev.storyCards, beat),
    }));

    // Fire beat card generation in background — never blocks gameplay
    if (currentAdventure) {
      const stateSnapshot = { ...currentAdventure };
      generateCardFromBeat(stateSnapshot, beat.title, beat.narrativeGoal)
        .then(result => {
          if (!result || result.action === 'skip') return;
          setGameState(prev => {
            if (result.action === 'update' && result.matchTitle) {
              const existing = prev.storyCards.find(c =>
                c.title.toLowerCase() === result.matchTitle!.toLowerCase()
              );
              if (!existing || !result.card) return prev;
              return {
                ...prev,
                storyCards: prev.storyCards.map(c =>
                  c.id === existing.id
                    ? { ...c, content: result.card!.content, isFleshedOut: true }
                    : c
                ),
              };
            }
            if (result.action === 'create' && result.card) {
              // Avoid duplicate
              if (prev.storyCards.some(c =>
                c.title.toLowerCase() === result.card!.title.toLowerCase()
              )) return prev;
              return {
                ...prev,
                storyCards: [...prev.storyCards, {
                  id: Math.random().toString(36).substr(2, 9),
                  title: result.card.title,
                  type: result.card.type as any,
                  keys: result.card.keys,
                  content: result.card.content,
                  isFleshedOut: false,
                  isUnresolved: result.card.isUnresolved,
                }],
              };
            }
            return prev;
          });
          setCardFlash(true);
          setTimeout(() => setCardFlash(false), 1500);
        })
        .catch(() => {});
    }
  };

  const exportBeats = (tracks: BeatTrack[]) => {
    const blob = new Blob([JSON.stringify(tracks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-beats-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBeats = (e: React.ChangeEvent<HTMLInputElement>, target: 'new' | 'game') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as BeatTrack[];
        if (!Array.isArray(imported)) throw new Error('Invalid beats file');
        if (target === 'new') {
          setNewAdventure(prev => ({ ...prev, beatTracks: imported }));
        } else {
          setGameState(prev => ({ ...prev, beatTracks: imported }));
        }
      } catch {
        alert('Failed to import beats — invalid file format.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const renderBeatEditModal = () => (
    <AnimatePresence>
      {editingBeat && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => setEditingBeat(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg bg-[#111] border border-stone-800 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="p-6 border-b border-stone-800 flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold tracking-tight">
                {editingBeat.beat.title ? 'Edit Beat' : 'New Beat'}
              </h3>
              <button onClick={() => setEditingBeat(null)} className="text-stone-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Beat Title</label>
                <input
                  value={editingBeat.beat.title}
                  onChange={e => setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, title: e.target.value } } : null)}
                  className="w-full bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none focus:border-stone-600 font-sans text-lg"
                  placeholder="The Betrayal..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Narrative Goal (Foreground)</label>
                <p className="text-[10px] text-stone-600">What the AI steers toward when this is the active foreground beat. Be specific but brief.</p>
                <textarea
                  value={editingBeat.beat.narrativeGoal}
                  onChange={e => setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, narrativeGoal: e.target.value } } : null)}
                  className="w-full h-28 bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none focus:border-stone-600 font-sans resize-none text-lg"
                  placeholder="Elara reveals she was working for the Duke all along..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Foreshadow Hint (optional)</label>
                <p className="text-[10px] text-stone-600">Vague atmospheric hint injected before the active window. Do not name the beat directly.</p>
                <textarea
                  value={editingBeat.beat.foreshadowHint}
                  onChange={e => setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, foreshadowHint: e.target.value } } : null)}
                  className="w-full h-20 bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none focus:border-stone-600 font-sans resize-none"
                  placeholder="Something about old loyalties feels fragile..."
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Target Turn</label>
                  <input
                    type="number" min="1"
                    key={`turn-${editingBeat.beat.id}`}
                    defaultValue={editingBeat.beat.targetTurn}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1) setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, targetTurn: n, actualFireTurn: null } } : null); }}
                    className="w-full bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none text-center font-sans"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">± Window</label>
                  <input
                    type="number" min="0"
                    key={`window-${editingBeat.beat.id}`}
                    defaultValue={editingBeat.beat.windowSize}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 0) setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, windowSize: n } } : null); }}
                    className="w-full bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none text-center font-sans"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Foreshadow</label>
                  <input
                    type="number" min="0"
                    key={`foreshadow-${editingBeat.beat.id}`}
                    defaultValue={editingBeat.beat.foreshadowDistance}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 0) setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, foreshadowDistance: n } } : null); }}
                    className="w-full bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none text-center font-sans"
                  />
                </div>
              </div>
              <p className="text-[10px] text-stone-600 leading-relaxed">
                Fires between turn <strong>{Math.max(1, editingBeat.beat.targetTurn - editingBeat.beat.windowSize)}</strong> – <strong>{editingBeat.beat.targetTurn + editingBeat.beat.windowSize}</strong>.
                {' '}Foreshadowing starts <strong>{editingBeat.beat.foreshadowDistance}</strong> turns before the active window.
              </p>

              <div className="pt-2 border-t border-stone-800 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Link to Story Card (optional)</label>
                  <p className="text-[10px] text-stone-600">When this beat completes, the resolution is appended to this card's Info section — so the relationship persists in context forever.</p>
                  <select
                    value={editingBeat.beat.linkedCardId || ''}
                    onChange={e => setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, linkedCardId: e.target.value || undefined } } : null)}
                    className="w-full bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none focus:border-stone-600 font-sans text-sm"
                  >
                    <option value="">— No card linked —</option>
                    {(beatEditTarget === 'new' ? newAdventure.storyCards || [] : currentAdventure?.storyCards || [])
                      .map(card => (
                        <option key={card.id} value={card.id}>{card.title}</option>
                      ))
                    }
                  </select>
                </div>

                {editingBeat.beat.linkedCardId && (
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Resolution (optional)</label>
                    <p className="text-[10px] text-stone-600">One sentence describing what actually happened. Written to the card on completion. Leave blank for an auto-generated fallback.</p>
                    <textarea
                      value={editingBeat.beat.resolution || ''}
                      onChange={e => setEditingBeat(prev => prev ? { ...prev, beat: { ...prev.beat, resolution: e.target.value } } : null)}
                      className="w-full h-20 bg-stone-800 border border-stone-800 rounded-xl p-3 focus:outline-none focus:border-stone-600 font-sans resize-none text-sm"
                      placeholder="Elara confessed her feelings at the river crossing..."
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-stone-800 flex gap-3 shrink-0">
              <button
                onClick={() => {
                  if (beatEditTarget === 'new') {
                    setNewAdventure(prev => ({
                      ...prev,
                      beatTracks: (prev.beatTracks || []).map(t =>
                        t.id === editingBeat.trackId
                          ? { ...t, beats: t.beats.filter(b => b.id !== editingBeat.beat.id) }
                          : t
                      )
                    }));
                  } else {
                    if (!currentAdventure) return;
                    setGameState(prev => ({
                      ...prev,
                      beatTracks: (prev.beatTracks || []).map(t =>
                        t.id === editingBeat.trackId
                          ? { ...t, beats: t.beats.filter(b => b.id !== editingBeat.beat.id) }
                          : t
                      )
                    }));
                  }
                  setEditingBeat(null);
                }}
                className="py-3 px-4 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/50 rounded-xl transition-all flex items-center justify-center"
                title="Delete beat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditingBeat(null)}
                className="flex-1 py-3 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-xl font-bold text-xs uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!editingBeat.beat.title.trim()) return;
                  const saveBeat = (existingTracks: BeatTrack[]) => {
                    const tracks = existingTracks && existingTracks.length > 0 ? existingTracks : createDefaultTracks();
                    if (!tracks.some(t => t.id === editingBeat.trackId)) return tracks;
                    return tracks.map(t => {
                      if (t.id !== editingBeat.trackId) return t;
                      const beatExists = t.beats.some(b => b.id === editingBeat.beat.id);
                      return {
                        ...t,
                        beats: beatExists
                          ? t.beats.map(b => b.id === editingBeat.beat.id ? editingBeat.beat : b)
                          : [...t.beats, editingBeat.beat],
                      };
                    });
                  };
                  if (beatEditTarget === 'new') {
                    setNewAdventure(prev => ({ ...prev, beatTracks: saveBeat(prev.beatTracks || createDefaultTracks()) }));
                  } else {
                    if (!currentAdventure) return;
                    setGameState(prev => ({ ...prev, beatTracks: saveBeat(prev.beatTracks || []) }));
                  }
                  setEditingBeat(null);
                }}
                className="flex-1 py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                Save Beat
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  const renderBeatsSettings = () => {
    if (!currentAdventure) return null;
    const tracks = currentAdventure.beatTracks && currentAdventure.beatTracks.length > 0
      ? currentAdventure.beatTracks
      : createDefaultTracks();
    const currentTurn = getCurrentTurn(currentAdventure.entries);
    const beatState = computeBeatEngineState(tracks);

    return (
      <section className="space-y-6 pb-12">

        {/* Turn indicator */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-stone-500 font-bold">Story Beats</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportBeats(tracks)}
              className="p-1 hover:bg-stone-800 rounded text-stone-600 hover:text-stone-300 transition-colors"
              title="Export beats"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <label className="p-1 hover:bg-stone-800 rounded text-stone-600 hover:text-stone-300 transition-colors cursor-pointer" title="Import beats">
              <Upload className="w-3.5 h-3.5" />
              <input type="file" className="hidden" accept=".json" onChange={e => importBeats(e, 'game')} />
            </label>
            <span className="text-[10px] text-stone-600 uppercase tracking-widest font-bold">Turn {currentTurn}</span>
          </div>
        </div>

        {/* Active beat engine status */}
        {(beatState.foregroundBeat || beatState.backgroundBeats.length > 0 || beatState.foreshadowingBeats.length > 0) && (
          <div className="space-y-2">
            {beatState.foregroundBeat && (
              <div
                className="p-4 rounded-xl border space-y-1.5"
                style={{ borderColor: `${appState.globalTheme.accent}55`, backgroundColor: `${appState.globalTheme.accent}0d` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: appState.globalTheme.accent }}>▶ Foreground</span>
                  <span className="text-[9px] text-stone-600">expires t.{beatState.foregroundBeat.targetTurn + beatState.foregroundBeat.windowSize}</span>
                </div>
                <p className="text-sm font-bold text-stone-200">{beatState.foregroundBeat.title}</p>
                <p className="text-[11px] text-stone-400 leading-relaxed line-clamp-2">{beatState.foregroundBeat.narrativeGoal}</p>
              </div>
            )}
            {beatState.backgroundBeats.map(b => (
              <div key={b.id} className="px-4 py-3 rounded-xl border border-stone-800 bg-stone-900/40 flex items-center gap-3">
                <span className="text-[9px] uppercase tracking-widest text-stone-600 font-bold shrink-0">BG</span>
                <p className="text-xs text-stone-400 truncate">{b.title}</p>
              </div>
            ))}
            {beatState.foreshadowingBeats.map(b => (
              <div key={b.id} className="px-4 py-3 rounded-xl border border-stone-800/50 bg-stone-900/20 flex items-center gap-3">
                <span className="text-[9px] uppercase tracking-widest font-bold shrink-0" style={{ color: '#a78bfa' }}>~ hint</span>
                <p className="text-xs text-stone-500 truncate">{b.title}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tracks */}
        {tracks.map(track => (
          <div key={track.id} className="space-y-3">
            {/* Track header */}
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: track.color }} />
              <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">{track.name}</span>
              <div className="h-px flex-1 bg-stone-800" />
              <button
                onClick={() => {
                  const newBeat: StoryBeat = {
                    id: Math.random().toString(36).substr(2, 9),
                    trackId: track.id,
                    title: '',
                    narrativeGoal: '',
                    foreshadowHint: '',
                    targetTurn: Math.max(1, currentTurn + 10),
                    windowSize: 5,
                    foreshadowDistance: 3,
                    actualFireTurn: null,
                    status: 'pending',
                    completedAtTurn: null,
                    order: track.beats.length,
                  };
                  setBeatEditTarget('game');
                  setEditingBeat({ beat: newBeat, trackId: track.id });
                }}
                className="p-1 hover:bg-stone-800 rounded text-stone-600 hover:text-stone-300 transition-colors"
                title="Add beat to this track"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Beat cards */}
            {track.beats.length === 0 ? (
              <p className="text-[10px] text-stone-700 pl-5 italic">No beats yet</p>
            ) : (
              <div className="space-y-2 pl-2">
                {[...track.beats]
                  .sort((a, b) => a.targetTurn - b.targetTurn)
                  .map(beat => {
                    const sc = BEAT_STATUS_COLORS[beat.status] || '#6b7280';
                    const isActive = beat.status === 'active';
                    const canComplete = beat.status === 'active' || beat.status === 'foreshadowing';
                    return (
                      <div
                        key={beat.id}
                        className="flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:border-stone-600"
                        style={{
                          borderColor: isActive ? `${sc}55` : '#292524',
                          backgroundColor: isActive ? `${sc}0d` : 'transparent',
                        }}
                        onClick={() => { setBeatEditTarget('game'); setEditingBeat({ beat, trackId: track.id }); }}
                      >
                        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: sc }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-stone-200 truncate">{beat.title || 'Untitled Beat'}</p>
                            <span className="text-[8px] uppercase tracking-widest font-bold shrink-0" style={{ color: sc }}>{beat.status}</span>
                          </div>
                          <p className="text-[10px] text-stone-500 mt-0.5">
                            Turn {beat.targetTurn} ± {beat.windowSize}
                            {beat.actualFireTurn ? ` · fires t.${beat.actualFireTurn}` : ''}
                          </p>
                          {beat.narrativeGoal && (
                            <p className="text-[10px] text-stone-600 mt-1 line-clamp-2 leading-relaxed">{beat.narrativeGoal}</p>
                          )}
                        </div>
                        {canComplete && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleBeatComplete(beat, currentTurn);
                            }}
                            className="shrink-0 p-1.5 rounded-lg border border-stone-700 hover:bg-stone-800 text-stone-400 hover:text-white transition-all"
                            title="Mark as completed"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        ))}
      </section>
    );
  };

  const renderSettingsSidebarContent = () => {
    if (!currentAdventure) return null;
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {settingsTab === 'adventure' && renderAdventureSettings()}
        {settingsTab === 'cards' && renderCardSettings()}
        {settingsTab === 'ai' && renderAISettings()}
        {settingsTab === 'beats' && renderBeatsSettings()}
      </div>
    );
  };

  const SyncIndicator = () => {
    if (!isSyncing) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
        <RefreshCw className="w-3 h-3 text-emerald-500 animate-spin" />
        <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">Saving Locally</span>
      </div>
    );
  };

  const renderConfirmDeleteModal = () => (
    <AnimatePresence>
      {confirmDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            onClick={() => setConfirmDelete(null)}
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative w-full max-w-sm bg-stone-900 border border-stone-800 rounded-3xl p-8 shadow-2xl text-center space-y-6"
          >
            <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto text-red-500">
              <Trash2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-stone-100">Delete {confirmDelete.type === 'scenario' ? 'Scenario' : 'Adventure'}?</h3>
              <p className="text-sm text-stone-500">This action cannot be undone. All story progress will be lost forever.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-3 bg-stone-800 hover:bg-stone-700 text-stone-400 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDeleteAction}
                className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg shadow-red-900/20"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  const renderThemeModal = () => {
    const defaultColors = [
      { name: 'Blue', hex: '#1AB2FF' },
      { name: 'Pink', hex: '#FF1AC2' },
      { name: 'Green', hex: '#31A300' },
      { name: 'Red', hex: '#F53100' },
      { name: 'Purple', hex: '#B569E8' },
      { name: 'Default', hex: '#FF8800' }
    ];

    return (
      <AnimatePresence>
        {showThemeSettings && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="w-full max-w-md bg-stone-900 border border-stone-800 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-stone-800 flex justify-between items-center shrink-0">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Palette className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
                  Theme Settings
                </h2>
                <button 
                  onClick={() => setShowThemeSettings(false)}
                  className="p-2 hover:bg-stone-800 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="p-6 space-y-8 overflow-y-auto">
                {/* Default Colors */}
                <div className="space-y-4">
                  <label className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Quick Presets</label>
                  <div className="grid grid-cols-6 gap-2">
                    {defaultColors.map(color => (
                      <button
                        key={color.hex}
                        onClick={() => setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, accent: color.hex } }))}
                        className={cn(
                          "aspect-square rounded-xl border-2 transition-all active:scale-90",
                          appState.globalTheme.accent.toLowerCase() === color.hex.toLowerCase() ? "border-white scale-110 shadow-lg" : "border-transparent"
                        )}
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Color Pickers */}
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Accent Color</label>
                      <span className="text-[10px] font-sans text-stone-400 bg-stone-800 px-2 py-1 rounded-md uppercase tracking-tighter">{appState.globalTheme.accent}</span>
                    </div>
                    
                    {/* Color Wheel for Mobile & Desktop */}
                    <div className="flex flex-col gap-4">
                      <div className="flex justify-center py-6 bg-stone-950/50 rounded-3xl border border-stone-800/50 shadow-inner">
                        <HexColorPicker 
                          color={appState.globalTheme.accent} 
                          onChange={(color) => setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, accent: color } }))}
                        />
                      </div>
                      <div className="flex items-center gap-3 bg-stone-900 border border-stone-800 rounded-xl p-3 shadow-sm">
                        <div 
                          className="w-10 h-10 rounded-lg shadow-inner border border-white/10 shrink-0"
                          style={{ backgroundColor: appState.globalTheme.accent }}
                        />
                        <input 
                          value={appState.globalTheme.accent}
                          onChange={(e) => setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, accent: e.target.value } }))}
                          className="flex-1 bg-transparent text-sm font-sans uppercase focus:outline-none tracking-widest"
                          placeholder="#FFFFFF"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Background</label>
                      <div className="relative">
                        <input 
                          type="color" 
                          value={appState.globalTheme.background}
                          onChange={(e) => setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, background: e.target.value } }))}
                          className="w-full h-12 bg-transparent border border-stone-800 rounded-xl cursor-pointer"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[8px] font-sans text-stone-500 uppercase bg-stone-900/80 px-1 rounded">{appState.globalTheme.background}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Text Color</label>
                      <div className="relative">
                        <input 
                          type="color" 
                          value={appState.globalTheme.text}
                          onChange={(e) => setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, text: e.target.value } }))}
                          className="w-full h-12 bg-transparent border border-stone-800 rounded-xl cursor-pointer"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[8px] font-sans text-stone-500 uppercase bg-stone-900/80 px-1 rounded">{appState.globalTheme.text}</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Font Size</label>
                      <span className="text-xs font-sans">{appState.globalTheme.fontSize}px</span>
                    </div>
                    <input 
                      type="range" min="12" max="32" step="1"
                      value={appState.globalTheme.fontSize}
                      onChange={(e) => setAppState(prev => ({ ...prev, globalTheme: { ...prev.globalTheme, fontSize: parseInt(e.target.value) } }))}
                      className="w-full h-2 bg-stone-800 rounded-lg appearance-none cursor-pointer"
                      style={{ accentColor: appState.globalTheme.accent }}
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 bg-stone-950 border-t border-stone-800 flex gap-3 shrink-0">
                <button 
                  onClick={() => {
                    setAppState(prev => ({ ...prev, globalTheme: DEFAULT_THEME }));
                  }}
                  className="flex-1 py-4 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95"
                >
                  Reset
                </button>
                <button 
                  onClick={() => setShowThemeSettings(false)}
                  className="flex-[2] py-4 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-black/40"
                  style={{ backgroundColor: appState.globalTheme.accent }}
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );
  };


  const renderSidebar = () => {
    if (!appState.isSettingsOpen || !currentAdventure) return null;

    const isMobile = appState.layoutMode === 'mobile';

    return (
      <motion.div 
        initial={isMobile ? { opacity: 0, y: '100%' } : { x: 600 }}
        animate={isMobile ? { opacity: 1, y: 0 } : { x: 0 }}
        exit={isMobile ? { opacity: 0, y: '100%' } : { x: 600 }}
        className={cn(
          "fixed z-[120] bg-[#111] flex flex-col shadow-2xl",
          isMobile ? "inset-0" : "right-0 top-0 bottom-0 w-full md:w-[32rem] border-l border-stone-800"
        )}
      >
        <div className="p-6 border-b border-stone-800 flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            World Forge
          </h2>
          <div className="flex gap-2">
            {!isMobile && (
              <button 
                onClick={() => setView('home')}
                className="p-2 hover:bg-stone-800 rounded-full transition-colors"
                title="Back to Library"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={() => setAppState(prev => ({ ...prev, isSettingsOpen: false }))}
              className="p-2 hover:bg-stone-800 rounded-full transition-colors"
            >
              {isMobile ? <X className="w-6 h-6" /> : <ChevronRight className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-800 bg-black/10 shrink-0">
          {[
            { id: 'adventure', label: 'Adventure', icon: Map },
            { id: 'cards', label: 'Story Cards', icon: Brain },
            { id: 'beats', label: 'Story Beats', icon: Milestone },
            { id: 'ai', label: 'Settings', icon: Cpu },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id as any)}
              className={cn(
                "flex-1 py-4 text-[10px] uppercase font-bold tracking-widest flex items-center justify-center gap-2 transition-all border-b-2",
                settingsTab === tab.id 
                  ? "text-white border-white" 
                  : "text-stone-500 border-transparent hover:text-stone-300"
              )}
              style={settingsTab === tab.id ? { borderColor: appState.globalTheme.accent, color: appState.globalTheme.accent } : {}}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {settingsTab === 'adventure' && renderAdventureSettings()}
          {settingsTab === 'cards' && renderCardSettings()}
          {settingsTab === 'ai' && renderAISettings()}
          {settingsTab === 'beats' && renderBeatsSettings()}
        </div>
      </motion.div>
    );
  };

  // ── Manual Card Creation Modal ─────────────────────────────────────────
  const handleManualCardCreate = async () => {
    const name = manualCardName.trim();
    if (!name || !currentAdventure) return;

    const model = currentAdventure.settings?.model;
    if (!model) { alert('Please select a model first.'); return; }

    // Check for duplicate
    if (currentAdventure.storyCards.some(c => c.title.replace(/^@/, '').toLowerCase() === name.toLowerCase())) {
      alert(`A card for "${name}" already exists.`);
      return;
    }

    setShowManualCardModal(false);
    setIsProcessingCards(true);

    try {
      const recentText = currentAdventure.entries.slice(-8).map(e => e.text).join('\n');
      const prompt = `You are writing a story card for an interactive fiction game.
Analyze the name "${name}" in this story context.

Recent story:
${recentText}

Return JSON only:
{
  "type": "character" | "location" | "faction" | "skip",
  "content": "text"
}

If character, content MUST be exactly this format:
Name: ${name}
Age: [specific age, or estimated range e.g. "mid-30s" — never write Unknown]
Appearance: [keyword, keyword, keyword — physical traits only, no sentences]
Personality: [keyword, keyword — core traits only, no sentences]
Info: [one major story fact or decision / another if applicable — major events only]

If location or faction: 2 factual sentences.
If "${name}" is not a proper name or named entity: {"type":"skip","content":""}
Return ONLY valid JSON.`;

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: model,
          prompt,
          systemInstruction: "Return only valid JSON. Factual and concise. No markdown. No fluff.",
          temperature: 0.2,
          maxOutputTokens: 250,
          memoryTokens: 512,
        }),
      });

      const data = await response.json();
      if (data.text) {
        const jsonMatch = data.text.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const json = JSON.parse(jsonMatch[0]);
          if (json.type && json.type !== 'skip' && json.content) {
            const rawContent = json.content;
            const safeContent = typeof rawContent === 'string'
              ? rawContent
              : Object.entries(rawContent as Record<string, string>)
                  .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
                  .join('\n');

            const cardTitle = json.type === 'character' ? `@${name}` : name;
            const turnCount = currentAdventure.entries.filter(e => e.type === 'ai').length;

            setGameState(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                storyCards: [...prev.storyCards, {
                  id: Math.random().toString(36).substr(2, 9),
                  title: cardTitle,
                  type: json.type,
                  keys: [name.toLowerCase()],
                  content: safeContent,
                  isFleshedOut: false,
                  createdAtTurn: turnCount,
                } as any]
              };
            });

            setCardFlash(true);
            setTimeout(() => setCardFlash(false), 1500);
            console.log(`[ManualCard] Created card: ${cardTitle}`);
          } else {
            alert(`The AI couldn't create a card for "${name}". It may not be a named entity in the current story.`);
          }
        }
      }
    } catch (e) {
      console.error("[ManualCard] Error:", e);
      alert("Failed to create card. Check console for details.");
    } finally {
      setIsProcessingCards(false);
    }
  };

  const renderManualCardModal = () => {
    if (!showManualCardModal) return null;
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6" onClick={() => setShowManualCardModal(false)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={e => e.stopPropagation()}
          className="bg-stone-900 border border-stone-800 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl"
        >
          <div className="p-6 border-b border-stone-800 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Create Story Card</h3>
            <button onClick={() => setShowManualCardModal(false)} className="text-stone-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-xs text-stone-500">Enter the name of an NPC or entity from the story. The AI will generate a card based on recent events.</p>
            <input
              autoFocus
              type="text"
              value={manualCardName}
              onChange={e => setManualCardName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && manualCardName.trim()) handleManualCardCreate(); }}
              placeholder="Character or entity name..."
              className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-sm font-sans text-stone-200 focus:outline-none focus:border-stone-500 placeholder-stone-600"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowManualCardModal(false)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-stone-500 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleManualCardCreate}
                disabled={!manualCardName.trim()}
                className="px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest text-white disabled:opacity-30 transition-all"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                Create
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  const renderGlobalModals = () => (
    <>
      {renderStoryCardModal()}
      {renderBeatEditModal()}
      {renderCropperModal()}
      {renderThemeModal()}
      {renderManualCardModal()}

      {renderConfirmDeleteModal()}
      
      <AnimatePresence>
        {renderSidebar()}
      </AnimatePresence>

      {/* Placeholder modal — portal so it renders on home/new/game views */}
      {placeholderModal && createPortal(
        <div className="fixed inset-0 z-[999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="bg-stone-900 border border-stone-700 rounded-2xl p-8 w-full max-w-md shadow-2xl space-y-6"
            style={{ borderColor: `${appState.globalTheme.accent}44` }}
          >
            <div className="space-y-1 text-center">
              <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500 font-bold">Before your story begins</p>
              <h2 className="text-xl font-bold text-white">Customize Your Adventure</h2>
            </div>

            <div className="space-y-4">
              {placeholderModal.placeholders.map(label => (
                <div key={label} className="space-y-1.5">
                  <label className="text-xs uppercase tracking-widest text-stone-400 font-bold block">
                    {label.replace(/\?$/, '')}
                  </label>
                  <input
                    type="text"
                    value={placeholderModal.values[label] || ''}
                    onChange={e => setPlaceholderModal(prev => prev ? ({
                      ...prev,
                      values: { ...prev.values, [label]: e.target.value }
                    }) : null)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const allFilled = placeholderModal.placeholders.every(p => (placeholderModal.values[p] || '').trim());
                        if (allFilled) {
                          const filled = applyPlaceholders(placeholderModal.scenario, placeholderModal.values);
                          placeholderModalRef.current = false;
                          setPlaceholderModal(null);
                          _launchFromScenario(filled);
                        }
                      }
                    }}
                    placeholder={`Enter ${label.replace(/\?$/, '')}...`}
                    className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-white text-sm font-sans placeholder-stone-600 focus:outline-none focus:border-stone-500 transition-colors"
                    autoFocus={placeholderModal.placeholders.indexOf(label) === 0}
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { placeholderModalRef.current = false; setPlaceholderModal(null); }}
                className="flex-1 py-3 rounded-xl border border-stone-700 text-stone-400 text-xs uppercase tracking-widest font-bold hover:bg-stone-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const filled = applyPlaceholders(placeholderModal.scenario, placeholderModal.values);
                  placeholderModalRef.current = false;
                  setPlaceholderModal(null);
                  _launchFromScenario(filled);
                }}
                disabled={!placeholderModal.placeholders.every(p => (placeholderModal.values[p] || '').trim())}
                className="flex-1 py-3 rounded-xl text-white text-xs uppercase tracking-widest font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                Begin
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );

  if (view === 'home') {
    if (appState.layoutMode === 'mobile') {
      return (
        <div className="min-h-screen bg-[#0a0a0a] text-stone-200 font-sans flex flex-col overflow-hidden">
          <header className="p-6 border-b border-stone-900 space-y-4 shrink-0 relative">
            <div className="absolute top-3 right-6 text-[10px] text-stone-700 font-sans uppercase tracking-widest">{VERSION}</div>
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tighter text-stone-100">HomerAI</h1>
                <p className="text-stone-500 uppercase tracking-widest text-[10px] font-sans">Shape your own adventures</p>
              </div>
              <div className="flex gap-2">
                <SyncIndicator />
                <SearchableModelSelect 
                  value={appState.globalSettings.model}
                  options={appState.modelRegistry}
                  onChange={(val) => setAppState(prev => ({ ...prev, globalSettings: { ...prev.globalSettings, model: val } }))}
                  trigger={
                    <button className="flex items-center gap-2 px-3 py-1.5 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full text-[10px] font-bold uppercase tracking-widest text-stone-300 active:scale-95 transition-all shadow-lg" title="Default Model">
                      <Cpu className="w-4 h-4" style={{ color: appState.globalTheme.accent }} />
                      <span className="max-w-[80px] truncate">{appState.globalSettings.model || 'Select Model'}</span>
                    </button>
                  }
                />
                <button
                  onClick={() => setAppState(prev => ({ ...prev, layoutMode: 'desktop' }))}
                  className="p-3 bg-stone-900 border border-stone-800 rounded-full active:scale-90 transition-all"
                >
                  <MonitorSmartphone className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
                </button>
                <button
                  onClick={() => setShowThemeSettings(true)}
                  className="p-3 bg-stone-900 border border-stone-800 rounded-full active:scale-90 transition-all"
                >
                  <Palette className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
                </button>
              </div>
            </div>
            
            <div className="flex gap-3">
              <label className="flex-1 py-3 bg-stone-900 border border-stone-800 rounded-xl text-[10px] uppercase tracking-widest font-bold font-sans text-stone-500 flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all">
                <Upload className="w-4 h-4" style={{ color: appState.globalTheme.accent }} />
                Adventure
                <input type="file" className="hidden" accept=".json" onChange={importAdventure} />
              </label>
              <label className="flex-1 py-3 bg-stone-900 border border-stone-800 rounded-xl text-[10px] uppercase tracking-widest font-bold font-sans text-stone-500 flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all">
                <Upload className="w-4 h-4" style={{ color: appState.globalTheme.accent }} />
                Scenario
                <input type="file" className="hidden" accept=".json" onChange={importScenario} />
              </label>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => { resetNewAdventureForm(); setView('new'); }}
                className="w-full py-4 text-white rounded-2xl font-sans font-bold uppercase tracking-widest text-xs shadow-lg flex items-center justify-center gap-2"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                <Plus className="w-4 h-4" />
                Create Scenario
              </button>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => setMobileTab('adventures')}
                className={cn(
                  "flex-1 py-2 rounded-xl text-[10px] uppercase tracking-widest font-bold font-sans transition-all",
                  mobileTab === 'adventures' ? "bg-stone-800 text-white border border-stone-700" : "text-stone-600"
                )}
              >
                Library
              </button>
              <button 
                onClick={() => setMobileTab('scenarios')}
                className={cn(
                  "flex-1 py-2 rounded-xl text-[10px] uppercase tracking-widest font-bold font-sans transition-all",
                  mobileTab === 'scenarios' ? "bg-stone-800 text-white border border-stone-700" : "text-stone-600"
                )}
              >
                Scenarios
              </button>
            </div>
          </header>

            <div className="flex-1 overflow-y-auto p-6 pb-32 space-y-6">
            {mobileTab === 'scenarios' ? (
              <div className="grid grid-cols-1 gap-6">
                {appState.scenarios.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).map(scenario => (
                  <div key={scenario.id} className="space-y-2">
                  <div 
                    onClick={() => setActiveItemId(activeItemId === scenario.id ? null : scenario.id)}
                    className="relative aspect-video bg-stone-900 rounded-2xl overflow-hidden border border-stone-800 active:scale-[0.98] transition-all shadow-xl group"
                  >
                    {scenario.image ? (
                      <img src={scenario.image} className="absolute inset-0 w-full h-full object-cover opacity-60" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-950 opacity-40" />
                    )}
                    
                    <div className="absolute inset-0 p-4 flex flex-col justify-end bg-gradient-to-t from-black via-black/20 to-transparent">
                      <h3 className="font-bold text-lg text-white drop-shadow-md">{scenario.title}</h3>
                      <div className="flex gap-3 mt-1">
                        <span className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-stone-300 font-bold bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
                          <Brain className="w-2 h-2" /> {(scenario.storyCards || []).length} Cards
                        </span>
                      </div>
                    </div>
                    
                    <div className="absolute bottom-4 right-4 text-[8px] uppercase tracking-widest text-stone-500 font-bold bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
                      Last Played: {new Date(scenario.lastPlayed || Date.now()).toLocaleDateString()}
                    </div>

                    {/* Action Overlay */}
                    <AnimatePresence>
                      {activeItemId === scenario.id && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 gap-4 z-20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button 
                            onClick={() => startFromScenario(scenario)}
                            className="w-full py-3 bg-white text-black rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                          >
                            <Play className="w-4 h-4 fill-current" />
                            Start Adventure
                          </button>
                          <div className="flex gap-2 w-full">
                            <button 
                              onClick={() => { setEditingId(scenario.id); setEditingType('scenario'); setNewAdventure({...scenario}); setView('new'); }}
                              className="flex-1 py-3 bg-stone-800 text-white rounded-xl flex items-center justify-center"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => duplicateScenario(scenario.id, e as any)}
                              className="flex-1 py-3 bg-stone-800 text-white rounded-xl flex items-center justify-center"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => deleteScenario(scenario.id, e as any)}
                              className="flex-1 py-3 bg-red-900/40 text-red-400 border border-red-900/50 rounded-xl flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {scenario.premise && (
                    <p className="text-white text-base font-bold font-sans leading-relaxed line-clamp-3 px-5 py-4 bg-stone-800 rounded-b-2xl -mt-6 relative z-10 overflow-hidden">
                      {scenario.premise}
                    </p>
                  )}
                  </div>
                ))}
                <button 
                  onClick={() => { resetNewAdventureForm(); setView('new'); }}
                  className="w-full aspect-video border-2 border-dashed border-stone-800 rounded-2xl flex flex-col items-center justify-center gap-2 text-stone-600 hover:bg-stone-900/30 transition-all"
                >
                  <Plus className="w-6 h-6" />
                  <span className="text-[10px] uppercase tracking-widest font-bold font-sans">Create Scenario</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {appState.adventures.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).map(adventure => (
                  <div key={adventure.id} className="space-y-2">
                  <div 
                    onClick={() => setActiveItemId(activeItemId === adventure.id ? null : adventure.id)}
                    className="relative aspect-video bg-stone-900 rounded-2xl overflow-hidden border border-stone-800 active:scale-[0.98] transition-all shadow-xl group"
                  >
                    {adventure.image ? (
                      <img src={adventure.image} className="absolute inset-0 w-full h-full object-cover opacity-60" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-950 opacity-40" />
                    )}
                    
                    <div className="absolute inset-0 p-4 flex flex-col justify-end bg-gradient-to-t from-black via-black/20 to-transparent">
                      <h3 className="font-bold text-lg text-white drop-shadow-md">{adventure.title}</h3>
                      <div className="flex gap-3 mt-1">
                        <span className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-stone-300 font-bold bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
                          <Activity className="w-2 h-2" /> {adventure.entries.filter(e => e.type === 'ai').length} Turns
                        </span>
                        <span className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-stone-300 font-bold bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
                          <Brain className="w-2 h-2" /> {adventure.storyCards.length} Cards
                        </span>
                      </div>
                    </div>

                    <div className="absolute bottom-4 right-4 text-[8px] uppercase tracking-widest text-stone-500 font-bold bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
                      Last Played: {new Date(adventure.lastPlayed || Date.now()).toLocaleDateString()}
                    </div>

                    {/* Action Overlay */}
                    <AnimatePresence>
                      {activeItemId === adventure.id && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 gap-4 z-20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button 
                            onClick={() => startAdventure(adventure)}
                            className="w-full py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                            style={{ backgroundColor: appState.globalTheme.accent }}
                          >
                            <Play className="w-4 h-4 fill-current" />
                            Resume Journey
                          </button>
                          <div className="flex gap-2 w-full">
                            <button 
                              onClick={() => { setEditingId(adventure.id); setEditingType('adventure'); setNewAdventure({...adventure}); setView('new'); }}
                              className="flex-1 py-3 bg-stone-800 text-white rounded-xl flex items-center justify-center"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => duplicateAdventure(adventure.id, e as any)}
                              className="flex-1 py-3 bg-stone-800 text-white rounded-xl flex items-center justify-center"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => deleteAdventure(adventure.id, e as any)}
                              className="flex-1 py-3 bg-red-900/40 text-red-400 border border-red-900/50 rounded-xl flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {adventure.premise && (
                    <p className="text-white text-base font-bold font-sans leading-relaxed line-clamp-3 px-5 py-4 bg-stone-800 rounded-b-2xl -mt-6 relative z-10 overflow-hidden">
                      {adventure.premise}
                    </p>
                  )}
                  </div>
                ))}
                {appState.adventures.length === 0 && (
                  <div className="py-12 text-center space-y-4">
                    <Play className="w-12 h-12 mx-auto opacity-10" />
                    <p className="text-[10px] uppercase tracking-widest text-stone-600 font-bold">Your library is empty</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {renderGlobalModals()}
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#0a0a0a] text-stone-200 font-sans overflow-hidden flex flex-col">
        <header className="p-8 md:p-12 border-b border-stone-900 flex justify-between items-center relative">
          <div className="absolute top-4 right-8 text-[10px] text-stone-700 font-sans uppercase tracking-widest">{VERSION}</div>
          <div className="space-y-1">
            <h1 className="text-4xl font-bold tracking-tighter text-stone-100">HomerAI</h1>
            <p className="text-stone-500 uppercase tracking-[0.3em] text-[10px] font-sans">Shape your own adventures</p>
          </div>
          <div className="flex gap-4">
            <SearchableModelSelect 
              value={appState.globalSettings.model}
              options={appState.modelRegistry}
              onChange={(val) => setAppState(prev => ({ ...prev, globalSettings: { ...prev.globalSettings, model: val } }))}
              trigger={
                <button className="flex items-center gap-2 px-4 py-2 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full text-[10px] font-bold uppercase tracking-widest text-stone-300 active:scale-95 transition-all shadow-lg" title="Default Model">
                  <Cpu className="w-4 h-4" style={{ color: appState.globalTheme.accent }} />
                  <span>{appState.globalSettings.model || 'Select Model'}</span>
                </button>
              }
            />
            <button
              onClick={() => setAppState(prev => ({ ...prev, layoutMode: prev.layoutMode === 'desktop' ? 'mobile' : 'desktop' }))}
              className="p-2 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-full border transition-all"
              style={{ borderColor: `${appState.globalTheme.accent}33` }}
              title={`Switch to ${appState.layoutMode === 'desktop' ? 'Mobile' : 'Desktop'} Layout`}
            >
              <MonitorSmartphone className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
            </button>
            <button
              onClick={() => setShowThemeSettings(true)}
              className="p-2 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-full border transition-all"
              style={{ borderColor: `${appState.globalTheme.accent}33` }}
              title="Customize Theme"
            >
              <Palette className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
            </button>
            <label 
              className="px-6 py-2 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest cursor-pointer transition-all flex items-center gap-2 border"
              style={{ borderColor: `${appState.globalTheme.accent}33` }}
            >
              <Upload className="w-3 h-3" style={{ color: appState.globalTheme.accent }} />
              Import Adventure
              <input type="file" className="hidden" accept=".json" onChange={importAdventure} />
            </label>
            <label 
              className="px-6 py-2 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest cursor-pointer transition-all flex items-center gap-2 border"
              style={{ borderColor: `${appState.globalTheme.accent}33` }}
            >
              <Upload className="w-3 h-3" style={{ color: appState.globalTheme.accent }} />
              Import Scenario
              <input type="file" className="hidden" accept=".json" onChange={importScenario} />
            </label>
            <button
              onClick={() => {
                resetNewAdventureForm();
                setView('new');
              }}
              className="px-6 py-2 text-white rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-all flex items-center gap-2"
              style={{ backgroundColor: appState.globalTheme.accent }}
            >
              <Plus className="w-3 h-3" />
              New Scenario
            </button>

            <SyncIndicator />
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Scenarios */}
          <div className="flex-1 border-r border-stone-900 overflow-y-auto p-8 space-y-8">
            <div className="flex items-center gap-4">
              <h2 className="text-stone-400 uppercase tracking-widest text-xs font-sans font-bold">Scenarios</h2>
              <div className="h-px flex-1 bg-stone-900" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              {appState.scenarios.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).map((item) => (
                <div key={item.id} className="space-y-2">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setActiveItemId(activeItemId === item.id ? null : item.id)}
                  className="group relative aspect-video bg-stone-900 rounded-3xl overflow-hidden border border-stone-800 hover:border-stone-600 transition-all cursor-pointer shadow-2xl"
                >
                  {item.image ? (
                    <img src={item.image} className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-950 opacity-30" />
                  )}
                  <div className="absolute inset-0 p-8 flex flex-col justify-end bg-gradient-to-t from-black via-black/20 to-transparent">
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-lg">{item.title}</h3>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2 text-[10px] text-stone-300 uppercase tracking-widest font-bold font-sans bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
                        <Brain className="w-3 h-3" /> {(item.storyCards || []).length} Cards
                      </div>
                    </div>

                    <div className="absolute bottom-8 right-8 text-[10px] uppercase tracking-widest text-stone-500 font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
                      Last Played: {new Date(item.lastPlayed || Date.now()).toLocaleDateString()}
                    </div>
                    
                    {/* Action Overlay */}
                    <div className={cn(
                      "absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-12 gap-6 transition-all duration-300 z-20",
                      activeItemId === item.id ? "opacity-100 visible" : "opacity-0 invisible md:group-hover:opacity-100 md:group-hover:visible"
                    )}>
                      <h3 className="text-2xl font-bold text-white text-center">{item.title}</h3>
                      <div className="flex flex-wrap justify-center gap-3 w-full max-w-sm">
                        <button onClick={(e) => { e.stopPropagation(); startFromScenario(item); }} className="flex-1 min-w-[140px] py-3 bg-white text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-stone-200 transition-all flex items-center justify-center gap-2">
                          <Play className="w-4 h-4 fill-current" />
                          Start
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingId(item.id); setEditingType('scenario'); setNewAdventure({...item}); setView('new'); }} className="p-3 bg-stone-800 text-white rounded-xl hover:bg-stone-700 transition-all" title="Edit"><Pencil className="w-5 h-5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); duplicateScenario(item.id, e as any); }} className="p-3 bg-stone-800 text-white rounded-xl hover:bg-stone-700 transition-all" title="Duplicate"><Copy className="w-5 h-5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); deleteScenario(item.id, e as any); }} className="p-3 bg-stone-800 text-red-400 rounded-xl hover:bg-red-900/30 transition-all" title="Delete"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    </div>
                  </div>
                </motion.div>
                {item.premise && (
                  <p className="text-white text-base font-bold font-sans leading-relaxed line-clamp-3 px-5 py-4 bg-stone-800 rounded-b-3xl -mt-6 relative z-10 overflow-hidden">
                    {item.premise}
                  </p>
                )}
                </div>
              ))}
              {appState.scenarios.length === 0 && (
                <div className="col-span-full h-64 border-2 border-dashed border-stone-800 rounded-2xl flex flex-col items-center justify-center text-stone-600 space-y-4">
                  <ScrollText className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-sans uppercase tracking-widest font-bold">No scenarios yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Adventures */}
          <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-stone-950/30">
            <div className="flex items-center gap-4">
              <h2 className="text-stone-400 uppercase tracking-widest text-xs font-sans font-bold">Started Adventures</h2>
              <div className="h-px flex-1 bg-stone-900" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              {appState.adventures.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).map((item) => (
                <div key={item.id} className="space-y-2">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setActiveItemId(activeItemId === item.id ? null : item.id)}
                  className="group relative aspect-video bg-stone-900 rounded-3xl overflow-hidden border border-stone-800 hover:border-stone-600 transition-all cursor-pointer shadow-2xl"
                >
                  {item.image ? (
                    <img src={item.image} className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-950 opacity-30" />
                  )}
                  <div className="absolute inset-0 p-8 flex flex-col justify-end bg-gradient-to-t from-black via-black/20 to-transparent">
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-lg">{item.title}</h3>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2 text-[10px] text-stone-300 uppercase tracking-widest font-bold font-sans bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
                        <Activity className="w-3 h-3" style={{ color: item.theme?.accent || appState.globalTheme.accent }} />
                        {item.entries.filter(e => e.type === 'ai').length} Turns
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-stone-300 uppercase tracking-widest font-bold font-sans bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
                        <Brain className="w-3 h-3" style={{ color: item.theme?.accent || appState.globalTheme.accent }} />
                        {item.storyCards.length} Cards
                      </div>
                    </div>

                    <div className="absolute bottom-8 right-8 text-[10px] uppercase tracking-widest text-stone-500 font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
                      Last Played: {new Date(item.lastPlayed || Date.now()).toLocaleDateString()}
                    </div>
                    
                    {/* Action Overlay */}
                    <div className={cn(
                      "absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-12 gap-6 transition-all duration-300 z-20",
                      activeItemId === item.id ? "opacity-100 visible" : "opacity-0 invisible md:group-hover:opacity-100 md:group-hover:visible"
                    )}>
                      <h3 className="text-2xl font-bold text-white text-center">{item.title}</h3>
                      <div className="flex flex-wrap justify-center gap-3 w-full max-w-sm">
                        <button onClick={(e) => { e.stopPropagation(); startAdventure(item); }} className="flex-1 min-w-[140px] py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2" style={{ backgroundColor: appState.globalTheme.accent }}>
                          <Play className="w-4 h-4 fill-current" />
                          Resume
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingId(item.id); setEditingType('adventure'); setNewAdventure({...item}); setView('new'); }} className="p-3 bg-stone-800 text-white rounded-xl hover:bg-stone-700 transition-all" title="Settings"><Settings className="w-5 h-5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); duplicateAdventure(item.id, e as any); }} className="p-3 bg-stone-800 text-white rounded-xl hover:bg-stone-700 transition-all" title="Duplicate"><Copy className="w-5 h-5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); deleteAdventure(item.id, e as any); }} className="p-3 bg-stone-800 text-red-400 rounded-xl hover:bg-red-900/30 transition-all" title="Delete"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    </div>
                  </div>
                </motion.div>
                {item.premise && (
                  <p className="text-white text-base font-bold font-sans leading-relaxed line-clamp-3 px-5 py-4 bg-stone-800 rounded-b-3xl -mt-6 relative z-10 overflow-hidden">
                    {item.premise}
                  </p>
                )}
                </div>
              ))}
              {appState.adventures.length === 0 && (
                <div className="col-span-full h-64 border-2 border-dashed border-stone-800 rounded-2xl flex flex-col items-center justify-center text-stone-600 space-y-4">
                  <Play className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-sans uppercase tracking-widest font-bold">No adventures in progress</p>
                </div>
              )}
            </div>
          </div>
        </div>
        {renderGlobalModals()}
      </div>
    );
  }

  if (view === 'new') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-stone-200 font-sans p-8 md:p-16 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-12 pb-24">
          <header className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => {
                  resetNewAdventureForm();
                  setView('home');
                }}
                className="flex items-center gap-2 text-stone-500 hover:text-stone-200 transition-colors uppercase tracking-widest text-[10px] font-sans font-bold"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <div className="flex gap-2">
                <button 
                  onClick={saveScenario}
                  className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-full font-sans font-bold uppercase tracking-widest text-[10px] transition-all border border-stone-700"
                >
                  {editingId && editingType === 'scenario' ? 'Update' : 'Save'}
                </button>
                <button 
                  onClick={createAdventure}
                  className="px-4 py-2 text-white rounded-full font-sans font-bold uppercase tracking-widest text-[10px] transition-all shadow-lg"
                  style={{ backgroundColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                >
                  {editingId && editingType === 'adventure' ? 'Update' : 'Begin'}
                </button>
              </div>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              {editingId ? `Edit ${editingType === 'scenario' ? 'Scenario' : 'Adventure'}` : 'Forge New Tale'}
            </h2>
          </header>

          <div className="space-y-12">
            {/* 1. Image */}
            <section className="space-y-3">
              <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Adventure Cover</label>
              <div className="relative h-96 bg-stone-900 border-2 border-dashed border-stone-800 rounded-2xl overflow-hidden group">
                {newAdventure.image ? (
                  <>
                    <img src={newAdventure.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <button 
                      onClick={() => setNewAdventure(prev => ({ ...prev, image: '' }))}
                      className="absolute top-4 right-4 p-2 bg-black/50 rounded-full hover:bg-red-900/50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <div 
                    onClick={() => fileInputRefNew.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-stone-800/50 transition-all"
                  >
                    <ImageIcon className="w-10 h-10 text-stone-600 mb-2" />
                    <span className="text-xs text-stone-500 font-sans uppercase tracking-widest font-bold">Upload Cover Image</span>
                    <input 
                      ref={fileInputRefNew}
                      type="file" 
                      className="hidden" 
                      accept="image/*" 
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleImageUpload(e, 'new')} 
                    />
                  </div>
                )}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-12">
              <div className="space-y-12">
                {/* 2. Title */}
                <section className="space-y-3">
                  <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Adventure Title</label>
                  <input 
                    value={newAdventure.title}
                    onChange={(e) => setNewAdventure(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-stone-800 border border-stone-800 rounded-xl p-6 text-xl font-sans focus:outline-none focus:border-stone-600 transition-all"
                    placeholder="The Whispering Woods..."
                  />
                </section>

                {/* 3. Description */}
                <section className="space-y-3">
                  <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Short Description</label>
                  <textarea 
                    value={newAdventure.description}
                    onChange={(e) => setNewAdventure(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full h-64 bg-stone-800 border border-stone-800 rounded-xl p-6 text-xl font-sans focus:outline-none focus:border-stone-600 transition-all resize-none"
                    placeholder="A brief summary for your library..."
                  />
                </section>

                {/* 4. Model Selector */}
                <section className="space-y-3">
                  <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Starting Model</label>
                  <SearchableModelSelect 
                    value={newAdventure.settings?.model || DEFAULT_SETTINGS.model}
                    options={appState.modelRegistry}
                    onChange={(val) => setNewAdventure(prev => ({ 
                      ...prev, 
                      settings: { ...(prev.settings || DEFAULT_SETTINGS), model: val } 
                    }))}
                  />
                </section>

                {/* 4.1 Dice Mechanic */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between p-6 bg-stone-900 border border-stone-800 rounded-xl">
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-widest text-stone-200 font-sans font-bold flex items-center gap-2">
                        <Dices className="w-4 h-4" /> d20 Dice Mechanic (WIP)
                      </label>
                      <p className="text-[10px] text-stone-500 font-sans">Roll for success on every action</p>
                    </div>
                    <button 
                      onClick={() => setNewAdventure(prev => ({ 
                        ...prev, 
                        settings: { ...(prev.settings || DEFAULT_SETTINGS), useDice: !(prev.settings?.useDice) } 
                      }))}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        newAdventure.settings?.useDice ? "" : "bg-stone-800"
                      )}
                      style={newAdventure.settings?.useDice ? { backgroundColor: newAdventure.theme?.accent || appState.globalTheme.accent } : {}}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        newAdventure.settings?.useDice ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>
                </section>

                {/* 4.2 Summarization Settings */}
                <section className="space-y-6 pt-4 border-t border-stone-800/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Advanced AI Settings</h3>
                    <button 
                      onClick={() => setShowAdvancedNew(!showAdvancedNew)}
                      className="text-[10px] uppercase font-bold text-stone-500 hover:text-stone-200 transition-colors"
                    >
                      {showAdvancedNew ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  {showAdvancedNew && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <label className="text-[10px] text-stone-500 uppercase font-bold">Temperature ({newAdventure.settings?.temperature || 0.8})</label>
                          <input 
                            type="range" min="0" max="2" step="0.1"
                            value={newAdventure.settings?.temperature || 0.8}
                            onChange={(e) => setNewAdventure(prev => ({ 
                              ...prev, 
                              settings: { ...(prev.settings || DEFAULT_SETTINGS), temperature: parseFloat(e.target.value) } 
                            }))}
                            className="w-full"
                            style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                          />
                        </div>
                        <div className="space-y-3">
                          <label className="text-[10px] text-stone-500 uppercase font-bold">Top-P ({newAdventure.settings?.topP || 0.95})</label>
                          <input 
                            type="range" min="0" max="1" step="0.05"
                            value={newAdventure.settings?.topP || 0.95}
                            onChange={(e) => setNewAdventure(prev => ({ 
                              ...prev, 
                              settings: { ...(prev.settings || DEFAULT_SETTINGS), topP: parseFloat(e.target.value) } 
                            }))}
                            className="w-full"
                            style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                          />
                        </div>
                        <div className="space-y-3">
                          <label className="text-[10px] text-stone-500 uppercase font-bold">Min-P ({newAdventure.settings?.minP || 0.05})</label>
                          <input 
                            type="range" min="0" max="1" step="0.01"
                            value={newAdventure.settings?.minP || 0.05}
                            onChange={(e) => setNewAdventure(prev => ({ 
                              ...prev, 
                              settings: { ...(prev.settings || DEFAULT_SETTINGS), minP: parseFloat(e.target.value) } 
                            }))}
                            className="w-full"
                            style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                          />
                        </div>
                        <div className="space-y-3">
                          <label className="text-[10px] text-stone-500 uppercase font-bold">Max Tokens ({newAdventure.settings?.maxOutputTokens || 95})</label>
                          <input 
                            type="number"
                            value={newAdventure.settings?.maxOutputTokens || 95}
                            onChange={(e) => setNewAdventure(prev => ({ 
                              ...prev, 
                              settings: { ...(prev.settings || DEFAULT_SETTINGS), maxOutputTokens: parseInt(e.target.value) } 
                            }))}
                            className="w-full bg-stone-900 border border-stone-800 rounded p-2 text-xs focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] text-stone-500 uppercase font-bold">Memory Limit ({newAdventure.settings?.memoryLimit || 10} entries)</label>
                        <input 
                          type="range" min="5" max="100" step="1"
                          value={newAdventure.settings?.memoryLimit || 10}
                          onChange={(e) => setNewAdventure(prev => ({ 
                            ...prev, 
                            settings: { ...(prev.settings || DEFAULT_SETTINGS), memoryLimit: parseInt(e.target.value) } 
                          }))}
                          className="w-full"
                          style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                        />
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] text-stone-500 uppercase font-bold">Context Window ({newAdventure.settings?.memoryTokens || 1024} tokens)</label>
                        <input 
                          type="range" min="256" max="8192" step="128"
                          value={newAdventure.settings?.memoryTokens || 1024}
                          onChange={(e) => setNewAdventure(prev => ({ 
                            ...prev, 
                            settings: { ...(prev.settings || DEFAULT_SETTINGS), memoryTokens: parseInt(e.target.value) } 
                          }))}
                          className="w-full"
                          style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Summary Frequency ({newAdventure.settings?.summaryFrequency || 15} turns)</label>
                          <input 
                            type="range" min="5" max="50" step="1"
                            value={newAdventure.settings?.summaryFrequency || 15}
                            onChange={(e) => setNewAdventure(prev => ({ 
                              ...prev, 
                              settings: { ...(prev.settings || DEFAULT_SETTINGS), summaryFrequency: parseInt(e.target.value) } 
                            }))}
                            className="w-full"
                            style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                          />
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Rolling Models</label>
                            <button 
                              onClick={() => setNewAdventure(prev => ({ 
                                ...prev, 
                                settings: { ...(prev.settings || DEFAULT_SETTINGS), useRollingModels: !(prev.settings?.useRollingModels) } 
                              }))}
                              className={cn(
                                "w-10 h-5 rounded-full transition-all relative bg-stone-800",
                                newAdventure.settings?.useRollingModels && "opacity-100"
                              )}
                              style={newAdventure.settings?.useRollingModels ? { backgroundColor: appState.globalTheme.accent } : {}}
                            >
                              <div className={cn(
                                "absolute top-1 w-2.5 h-2.5 rounded-full transition-all",
                                newAdventure.settings?.useRollingModels ? "right-1 bg-white" : "left-1 bg-stone-500"
                              )} />
                            </button>
                          </div>
                          <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold block">Model Cycle Frequency ({newAdventure.settings?.rollingModelFrequency || 5} turns)</label>
                          <input 
                            type="range" min="0" max="50" step="1"
                            value={newAdventure.settings?.rollingModelFrequency || 5}
                            onChange={(e) => setNewAdventure(prev => ({ 
                              ...prev, 
                              settings: { ...(prev.settings || DEFAULT_SETTINGS), rollingModelFrequency: parseInt(e.target.value) } 
                            }))}
                            className="w-full"
                            style={{ accentColor: newAdventure.theme?.accent || appState.globalTheme.accent }}
                          />
                          <p className="text-[10px] text-stone-600 italic">0 turns disables the feature.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* 5. Begin Prompt */}
                <section className="space-y-3">
                  <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Beginning Prompt (First AI Response)</label>
                  <div className="relative">
                    <textarea 
                      value={newAdventure.premise}
                      onChange={(e) => setNewAdventure(prev => ({ ...prev, premise: e.target.value }))}
                      className="w-full h-[400px] bg-stone-800 border border-stone-800 rounded-xl p-6 text-xl font-sans focus:outline-none focus:border-stone-600 transition-all resize-none"
                      placeholder="You find yourself standing at the edge of..."
                    />
                    <AnimatePresence>
                      {!newAdventure.premise && (
                        <motion.button
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          onClick={generateOpeningScene}
                          disabled={isGeneratingOpening}
                          className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] uppercase font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl z-10"
                          style={{ backgroundColor: appState.globalTheme.accent, color: '#fff' }}
                        >
                          {isGeneratingOpening ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Wand2 className="w-4 h-4" />
                          )}
                          Generate
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="text-[10px] text-stone-500 uppercase tracking-widest font-sans font-bold mt-2">
                    Pro Tip: Fill in the other field first and add Story Cards, then press generate.
                  </p>
                </section>
              </div>
            </div>

            {/* 6. AI Instructions */}
            <section className="space-y-3">
              <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">AI Instructions (Behavior)</label>
              <div className="relative">
                <textarea 
                  value={newAdventure.aiInstructions}
                  onChange={(e) => setNewAdventure(prev => ({ ...prev, aiInstructions: e.target.value }))}
                  className="w-full h-80 bg-stone-800 border border-stone-800 rounded-2xl p-6 focus:outline-none focus:border-stone-600 transition-all resize-none text-lg font-sans leading-relaxed"
                  placeholder="Define the AI's role and set the rules..."
                />
                <AnimatePresence>
                  {!newAdventure.aiInstructions && (
                    <motion.button 
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      onClick={() => setNewAdventure(prev => ({ ...prev, aiInstructions: DEFAULT_AI_INSTRUCTIONS }))}
                      className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] uppercase font-bold tracking-widest transition-all hover:brightness-110 shadow-xl z-10"
                      style={{ backgroundColor: appState.globalTheme.accent, color: '#fff' }}
                    >
                      <Download className="w-3 h-3" />
                      Default
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* 7. Plot Essentials */}
            <section className="space-y-3">
              <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Plot Essentials (Immutable Rules)</label>
              <textarea 
                value={newAdventure.plotEssentials}
                onChange={(e) => updatePlotEssentialInNew(e.target.value)}
                className="w-full h-48 bg-stone-900 border border-stone-800 rounded-2xl p-6 focus:outline-none focus:border-stone-600 transition-all resize-none text-sm leading-relaxed"
                placeholder="Things the AI should always remember..."
              />
            </section>

            {/* 8. Author's Note */}
            <section className="space-y-3">
              <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Author's Note (Style)</label>
              <div className="relative">
                <textarea 
                  value={newAdventure.authorsNote}
                  onChange={(e) => setNewAdventure(prev => ({ ...prev, authorsNote: e.target.value }))}
                  className="w-full h-64 bg-stone-900 border border-stone-800 rounded-2xl p-6 focus:outline-none focus:border-stone-600 transition-all resize-none text-sm leading-relaxed"
                  placeholder="Stylistic guidance (e.g., Use purple prose, focus on sensory details...)"
                />
                <AnimatePresence>
                  {!newAdventure.authorsNote && (
                    <motion.button 
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      onClick={() => setNewAdventure(prev => ({ 
                        ...prev, 
                        authorsNote: "Genre: \nTheme: \nTone: \nSetting: \nWriting style:" 
                      }))}
                      className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] uppercase font-bold tracking-widest transition-all hover:brightness-110 shadow-xl z-10"
                      style={{ backgroundColor: appState.globalTheme.accent, color: '#fff' }}
                    >
                      <Download className="w-3 h-3" />
                      Default
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* 8.1 Story Summary */}
            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Story Summary (AI Generated)</label>
                <button 
                  onClick={() => setNewAdventure(prev => ({ 
                    ...prev, 
                    settings: { ...(prev.settings || DEFAULT_SETTINGS), useSummary: !(prev.settings?.useSummary ?? true) } 
                  }))}
                  className="w-10 h-5 rounded-full transition-colors relative bg-stone-800"
                  style={(newAdventure.settings?.useSummary ?? true) ? { backgroundColor: newAdventure.theme?.accent || appState.globalTheme.accent } : {}}
                >
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    (newAdventure.settings?.useSummary ?? true) ? "left-6" : "left-1"
                  )} />
                </button>
              </div>
              <textarea 
                value={newAdventure.summary}
                onChange={(e) => setNewAdventure(prev => ({ ...prev, summary: e.target.value }))}
                className="w-full h-48 bg-stone-900 border border-stone-800 rounded-2xl p-6 focus:outline-none focus:border-stone-600 transition-all resize-none text-sm leading-relaxed"
                placeholder="The AI will maintain a summary of the story here..."
              />
            </section>

            {/* 9. Story Cards */}
            <section className="space-y-6">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Story Cards (Lore)</label>
                  <p className="text-[10px] text-stone-600 font-sans">Key entities the AI should remember when mentioned</p>
                </div>
                <div className="flex gap-2">
                  <label className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-all flex items-center gap-2 border border-stone-800 cursor-pointer">
                    <Upload className="w-3 h-3" />
                    Import
                    <input type="file" className="hidden" accept=".json" onChange={(e) => importStoryCards(e, 'new')} />
                  </label>
                  <button 
                    onClick={() => {
                      const newCard: StoryCard = {
                        id: Math.random().toString(36).substr(2, 9),
                        title: '',
                        type: 'character',
                        keys: [],
                        content: ''
                      };
                      setEditingStoryCard(newCard);
                    }}
                    className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-stone-300 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-all flex items-center gap-2 border border-stone-800"
                  >
                    <Plus className="w-3 h-3" />
                    Add Card
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(newAdventure.storyCards || []).map(s => (
                  <div 
                    key={s.id} 
                    onClick={() => setEditingStoryCard(s)}
                    className="p-4 bg-stone-900/50 border border-stone-800 rounded-xl hover:border-stone-600 transition-all cursor-pointer group relative"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: newAdventure.theme.accent }}>{s.type}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStoryCardFromNew(s.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-stone-600 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <h4 className="font-bold text-stone-200 mb-1">{s.title || 'Untitled Card'}</h4>
                    <p className="text-[10px] text-stone-500 line-clamp-2 font-sans">{s.content || 'No description...'}</p>
                  </div>
                ))}
                {(newAdventure.storyCards || []).length === 0 && (
                  <div className="col-span-full py-12 border-2 border-dashed border-stone-900 rounded-2xl flex flex-col items-center justify-center text-stone-700 space-y-2">
                    <ScrollText className="w-8 h-8 opacity-20" />
                    <p className="text-[10px] uppercase tracking-widest font-bold">No lore cards yet</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
            {/* 10. Story Beats */}
            <section className="space-y-6">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-widest text-stone-500 font-sans font-bold">Story Beats</label>
                  <p className="text-[10px] text-stone-600 font-sans">Plan major plot points that unfold gradually over time</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportBeats(newAdventure.beatTracks || createDefaultTracks())}
                    className="p-1.5 hover:bg-stone-800 rounded text-stone-500 hover:text-stone-300 transition-colors"
                    title="Export beats"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <label className="p-1.5 hover:bg-stone-800 rounded text-stone-500 hover:text-stone-300 transition-colors cursor-pointer" title="Import beats">
                    <Upload className="w-4 h-4" />
                    <input type="file" className="hidden" accept=".json" onChange={e => importBeats(e, 'new')} />
                  </label>
                </div>
              </div>

              {(newAdventure.beatTracks || createDefaultTracks()).map(track => (
                <div key={track.id} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: track.color }} />
                    <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">{track.name}</span>
                    <div className="h-px flex-1 bg-stone-800" />
                    <button
                      onClick={() => {
                        const initialisedTracks = newAdventure.beatTracks && newAdventure.beatTracks.length > 0
                          ? newAdventure.beatTracks
                          : createDefaultTracks();
                        const newBeat: StoryBeat = {
                          id: Math.random().toString(36).substr(2, 9),
                          trackId: track.id,
                          title: '',
                          narrativeGoal: '',
                          foreshadowHint: '',
                          targetTurn: 10,
                          windowSize: 5,
                          foreshadowDistance: 3,
                          actualFireTurn: null,
                          status: 'pending',
                          completedAtTurn: null,
                          order: track.beats.length,
                        };
                        // Ensure beatTracks is committed to state before modal opens
                        setNewAdventure(prev => ({
                          ...prev,
                          beatTracks: prev.beatTracks && prev.beatTracks.length > 0
                            ? prev.beatTracks
                            : initialisedTracks
                        }));
                        setBeatEditTarget('new');
                        setEditingBeat({ beat: newBeat, trackId: track.id });
                      }}
                      className="px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded-full border border-stone-800 hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>

                  {track.beats.length === 0 ? (
                    <p className="text-[10px] text-stone-700 pl-5 italic">No beats yet — click Add to plan a plot point</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-2">
                      {[...track.beats]
                        .sort((a, b) => a.targetTurn - b.targetTurn)
                        .map(beat => (
                          <div
                            key={beat.id}
                            onClick={() => { setBeatEditTarget('new'); setEditingBeat({ beat, trackId: track.id }); }}
                            className="p-4 bg-stone-900/50 border border-stone-800 rounded-xl hover:border-stone-600 transition-all cursor-pointer group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-bold text-stone-200 leading-snug">{beat.title || 'Untitled Beat'}</p>
                              <span className="text-[8px] uppercase tracking-widest font-bold shrink-0 text-stone-600">
                                t.{beat.targetTurn} ± {beat.windowSize}
                              </span>
                            </div>
                            {beat.narrativeGoal && (
                              <p className="text-[10px] text-stone-500 mt-1.5 line-clamp-2 leading-relaxed">{beat.narrativeGoal}</p>
                            )}
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              ))}
            </section>

        {renderGlobalModals()}
      </div>
    );
  }

  if (view === 'game' && !currentAdventure) {
    setView('home');
    return null;
  }

  const themeStyles = {
    backgroundColor: currentAdventure?.image ? 'transparent' : appState.globalTheme.background,
    color: appState.globalTheme.text,
    fontSize: `${appState.globalTheme.fontSize}px`
  };

  const fontClass = 'font-sans';

  if (view === 'game' && currentAdventure && appState.layoutMode === 'mobile') {
    return (
      <div 
        className={cn("h-screen flex flex-col overflow-hidden relative", fontClass)}
        style={{ backgroundColor: appState.globalTheme.background, color: appState.globalTheme.text }}
      >
        {/* Mobile Background */}
        {currentAdventure.image && (
          <div 
            className="fixed inset-0 z-0 opacity-20 pointer-events-none"
            style={{ 
              backgroundImage: `url(${currentAdventure.image})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(60px)'
            }}
          />
        )}

        {/* Mobile Header */}
        <header className="h-16 border-b border-stone-800 flex items-center justify-between px-4 shrink-0 bg-black/60 backdrop-blur-md z-50 sticky top-0">
          <div className="flex items-center gap-1 w-1/4">
            <button onClick={() => setView('home')} className="p-2 hover:bg-stone-800 rounded-full transition-colors active:scale-90">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div className="p-2 flex items-center gap-1">
              <Brain 
                className={cn(
                  "w-5 h-5 transition-all duration-500",
                  currentAdventure.isSummarizing ? "text-[#00DB04] animate-pulse" : "text-stone-700"
                )} 
              />
              <span className="text-[10px] font-bold text-stone-500 font-sans">{currentAdventure.entries.filter(e => e.type === 'ai').length}</span>
            </div>
          </div>

            <div className="flex items-center justify-center gap-2 flex-1 relative">
              {/* Model Selector Trigger */}
              <SearchableModelSelect 
                value={currentAdventure.settings.model}
                options={appState.modelRegistry}
                onChange={(val) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, model: val } }))}
                trigger={
                  <button className="flex items-center gap-2 px-3 py-1.5 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full text-[10px] font-bold uppercase tracking-widest text-stone-300 active:scale-95 transition-all shadow-lg">
                    <Cpu className={cn("w-3.5 h-3.5 transition-colors duration-500", modelFlash ? "text-emerald-500" : "")} style={!modelFlash ? { color: appState.globalTheme.accent } : {}} />
                    <span className="max-w-[80px] truncate">{currentAdventure.settings.model || 'Select Model'}</span>
                  </button>
                }
              />
              {/* Card counter — tap to create a new card */}
              <button
                onClick={() => { setManualCardName(''); setShowManualCardModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full text-[10px] font-bold uppercase tracking-widest text-stone-300 shadow-lg hover:bg-stone-800/60 active:scale-95 transition-all"
                title="Create a story card"
              >
                <Layers className={cn("w-3.5 h-3.5 transition-colors duration-500", cardFlash ? "text-amber-400" : "")} style={!cardFlash ? { color: appState.globalTheme.accent } : {}} />
                <span className={cn("transition-colors duration-500", cardFlash ? "text-amber-400" : "")}>{(currentAdventure.storyCards || []).length}</span>
              </button>
            </div>

          <div className="flex items-center justify-end gap-1 w-1/4">
            <button 
              onClick={() => setShowThemeSettings(true)}
              className="p-2 hover:bg-stone-800 rounded-full transition-colors active:scale-90"
              title="Customize Theme"
            >
              <Palette className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
            </button>
            <button 
              onClick={() => setAppState(prev => ({ ...prev, isSettingsOpen: true }))} 
              className="p-2 hover:bg-stone-800 rounded-full transition-colors active:scale-90"
            >
              <Settings className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
            </button>
          </div>
        </header>

        {/* Floating Action Buttons */}
        <div className="fixed top-20 right-4 z-40 flex flex-col gap-3">
          <button 
            onClick={undoTurn}
            disabled={!currentAdventure.history || currentAdventure.history.length === 0}
            className="w-10 h-10 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full flex items-center justify-center shadow-lg hover:bg-stone-800/60 disabled:opacity-20 active:scale-90 transition-all"
          >
            <Undo2 className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
          </button>
          <button 
            onClick={retryTurn}
            disabled={currentAdventure.entries.length < 2 || currentAdventure.isGenerating}
            className="w-10 h-10 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full flex items-center justify-center shadow-lg hover:bg-stone-800/60 disabled:opacity-20 active:scale-90 transition-all"
          >
            <RotateCcw className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
          </button>
          <button 
            onClick={redoTurn}
            disabled={!currentAdventure.redoStack || currentAdventure.redoStack.length === 0}
            className="w-10 h-10 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full flex items-center justify-center shadow-lg hover:bg-stone-800/60 disabled:opacity-20 active:scale-90 transition-all"
          >
            <Redo2 className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
          </button>
        </div>

        {/* Story Log */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-8 pb-64"
        >
          {currentAdventure.entries.map((entry, idx) => {
            const isAI = entry.type === 'ai';
            const Icon = entry.type === 'say' ? Speech : 
                         entry.type === 'do' ? Running : 
                         entry.type === 'story' ? ScrollText : Brain;
            
            return (
              <div 
                key={entry.id} 
                className={cn("space-y-3 cursor-pointer active:opacity-70 transition-opacity", !isAI && "pl-4 border-l border-stone-800/50")}
                onClick={() => {
                  setEditingEntry({ id: entry.id, text: entry.text });
                  setIsEditingEntryText(false);
                }}
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold" style={isAI ? { color: appState.globalTheme.accent } : { color: appState.globalTheme.accent }}>
                  <Icon className="w-4 h-4" />
                  {entry.type}
                </div>
                <div className={cn("font-sans leading-relaxed prose prose-invert prose-stone max-w-none")} style={{ fontSize: `${appState.globalTheme.fontSize}px`, color: isAI ? appState.globalTheme.text : "rgba(168, 162, 158, 1)" }}>
                  <ReactMarkdown>{entry.text}</ReactMarkdown>
                </div>
              </div>
            );
          })}
          {(currentAdventure.isGenerating || currentAdventure.isSummarizing || isProcessingCards) && (
            <div className="flex items-center justify-center py-8">
              <div className="relative">
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4], scale: [0.98, 1.02, 0.98] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="relative flex items-center justify-center"
                >
                  {currentAdventure.isSummarizing ? (
                    <Brain className="w-10 h-10 opacity-70" style={{ color: '#00DB04' }} />
                  ) : isProcessingCards ? (
                    <Layers className="w-10 h-10 opacity-70" style={{ color: appState.globalTheme.accent }} />
                  ) : (
                    <>
                      <ScrollText className="w-10 h-10 opacity-50" style={{ color: appState.globalTheme.accent }} />
                      <motion.div
                        animate={{ x: [-2, 2, -2, 2, -2], y: [-1, 1, 1, -1, -1], rotate: [-5, 5, -5, 5, -5] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="absolute -top-1 -right-1"
                      >
                        <Pencil className="w-6 h-6" style={{ color: appState.globalTheme.accent }} />
                      </motion.div>
                    </>
                  )}
                </motion.div>
                <div
                  className="absolute inset-0 animate-ping opacity-20 rounded-full"
                  style={{ backgroundColor: currentAdventure.isSummarizing ? '#00DB04' : appState.globalTheme.accent }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Mobile Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 p-3 bg-transparent z-20">
          {/* Cancel Request Button */}
          <AnimatePresence>
            {currentAdventure.isGenerating && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="flex justify-center mb-4"
              >
                <button 
                  onClick={cancelRequest}
                  className="w-10 h-10 flex items-center justify-center bg-stone-900 text-red-500 rounded-full shadow-2xl active:scale-90 transition-all border border-stone-800"
                  title="Cancel Generation"
                >
                  <X className="w-5 h-5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
            <div className="flex justify-around px-1">
              {[
                { type: 'do', icon: Running, label: 'Do' },
                { type: 'say', icon: Speech, label: 'Say' },
                { type: 'story', icon: BookOpen, label: 'Story' },
                { type: 'ai', icon: Wand2, label: 'Continue' }
              ].map(({ type, icon: Icon, label }) => (
                <div key={type} className="flex flex-col items-center gap-1">
                  <button
                    onClick={() => {
                      if (type === 'ai') {
                        continueStory();
                      } else {
                        setActionType(type as ActionType);
                      }
                    }}
                    className={cn(
                      "w-14 h-14 rounded-full flex items-center justify-center transition-all relative shadow-xl border border-stone-800/50",
                      (actionType === type || (type === 'ai' && currentAdventure.isGenerating)) 
                        ? "bg-stone-800 scale-110" 
                        : "bg-stone-900/80 backdrop-blur-md text-stone-400"
                    )}
                    style={(actionType === type || (type === 'ai' && currentAdventure.isGenerating)) ? { color: '#fff', backgroundColor: appState.globalTheme.accent, borderColor: appState.globalTheme.accent } : {}}
                  >
                    <Icon className="w-6 h-6" />
                    {actionType === type && type !== 'ai' && (
                      <motion.div 
                        layoutId="activeAction"
                        className="absolute -bottom-1 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: appState.globalTheme.accent }}
                      />
                    )}
                  </button>
                  <span className={cn(
                    "text-[10px] uppercase tracking-widest font-bold",
                    actionType === type ? "text-white" : "text-stone-500"
                  )}>{label}</span>
                </div>
              ))}
            </div>
            <div className="relative flex items-center gap-2 bg-stone-900/90 backdrop-blur-xl rounded-2xl border border-stone-800/50 px-2 shadow-2xl">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAction();
                  }
                }}
                placeholder={
                  actionType === 'do' ? "What do you do?" :
                  actionType === 'say' ? "What do you say?" :
                  "Add to the story..."
                }
                className="flex-1 bg-transparent p-4 text-sm font-sans focus:outline-none min-h-[52px] max-h-32 resize-none leading-relaxed"
              />
              <button
                onClick={() => handleAction()}
                disabled={!input.trim() || currentAdventure.isGenerating}
                className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-20 transition-all shrink-0 shadow-lg"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>

        {renderGlobalModals()}
        {editingEntry && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-stone-900 border border-stone-800 rounded-3xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-stone-800 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">
                  {isEditingEntryText ? "Editing Entry" : "Entry Options"}
                </h3>
                <button onClick={() => setEditingEntry(null)} className="p-2 hover:bg-stone-800 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 flex-1 overflow-y-auto">
                {isEditingEntryText ? (
                  <textarea
                    value={editingEntry.text}
                    onChange={(e) => setEditingEntry({ ...editingEntry, text: e.target.value })}
                    className="w-full h-64 bg-stone-950 border border-stone-800 rounded-xl p-4 text-sm font-sans focus:outline-none focus:border-stone-600 transition-all resize-none leading-relaxed"
                  />
                ) : (
                  <div className="text-sm font-sans text-stone-300 leading-relaxed max-h-64 overflow-y-auto p-4 bg-stone-950 rounded-xl border border-stone-800/50">
                    <ReactMarkdown>{editingEntry.text}</ReactMarkdown>
                  </div>
                )}
              </div>

              <div className="p-6 bg-stone-950/50 border-t border-stone-800 flex gap-3">
                {isEditingEntryText ? (
                  <>
                    <button 
                      onClick={() => setIsEditingEntryText(false)}
                      className="flex-1 py-3 bg-stone-800 text-stone-300 rounded-xl font-bold text-xs uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => {
                        setAppState(prev => {
                          if (!prev.currentAdventureId) return prev;
                          return {
                            ...prev,
                            adventures: prev.adventures.map(adv => 
                              adv.id === prev.currentAdventureId 
                                ? { ...adv, entries: adv.entries.map(e => e.id === editingEntry.id ? { ...e, text: editingEntry.text } : e) }
                                : adv
                            )
                          };
                        });
                        setEditingEntry(null);
                      }}
                      className="flex-1 py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest"
                      style={{ backgroundColor: appState.globalTheme.accent }}
                    >
                      Save Changes
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setIsEditingEntryText(true)}
                    className="w-full py-4 flex items-center justify-center gap-3 bg-stone-800 hover:bg-stone-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit Text
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
        {diceRoll?.show && (
          <DiceModal 
            value={diceRoll.value} 
            accentColor={appState.globalTheme.accent}
            onClose={() => {
              setDiceRoll(null);
              triggerAIGeneration(currentAdventure, diceRoll.value);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-screen overflow-hidden", fontClass)} style={themeStyles}>
      {/* Blurred Background Layer */}
      {currentAdventure?.image && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-black">
          <div 
            className="absolute inset-0 bg-cover bg-center scale-110 blur-[80px] opacity-50"
            style={{ backgroundImage: `url(${currentAdventure.image})` }}
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}

      <div className="relative z-10 flex flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {isLoadingModel && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center space-y-6"
          >
            <Loader2 className="w-12 h-12 animate-spin" style={{ color: appState.globalTheme.accent }} />
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-white uppercase tracking-[0.2em]">Loading AI Model</h3>
              <p className="text-stone-500 text-sm font-sans">Preparing the neural engine for your journey...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {renderSidebar()}

      {/* Main Content */}
      <main 
        className="flex-1 flex flex-col relative z-10"
        style={{ 
          backgroundColor: 'transparent',
          color: appState.globalTheme.text,
          fontSize: `${appState.globalTheme.fontSize}px`
        }}
      >
        {/* Header */}
        <header 
          className="h-16 border-b border-stone-800 flex items-center justify-between px-8 backdrop-blur-md z-50 sticky top-0 shrink-0"
          style={{ backgroundColor: `${appState.globalTheme.background}CC` }}
        >
          <div className="flex items-center gap-4 w-1/4">
            <button 
              onClick={() => setView('home')}
              className="p-2 hover:bg-stone-800 rounded-full transition-colors"
              title="Back to Library"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Brain 
              className={cn(
                "w-5 h-5 transition-all duration-500",
                currentAdventure.isSummarizing ? "text-[#00DB04] animate-pulse" : "text-stone-700"
              )} 
            />
            <h1 className="text-xl font-bold tracking-tight truncate">{currentAdventure.title}</h1>
          </div>

          <div className="flex-1 flex justify-center">
            {/* Model Selector + Card Counter in Header */}
            <div className="flex items-center gap-2">
              <SearchableModelSelect 
                value={currentAdventure.settings.model}
                options={appState.modelRegistry}
                onChange={(val) => setGameState(prev => ({ ...prev, settings: { ...prev.settings, model: val } }))}
                trigger={
                  <button className="flex items-center gap-2 px-4 py-2 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full text-[10px] font-bold uppercase tracking-widest text-stone-300 active:scale-95 transition-all shadow-lg">
                    <Cpu className={cn("w-4 h-4 transition-colors duration-500", modelFlash ? "text-emerald-500" : "")} style={!modelFlash ? { color: appState.globalTheme.accent } : {}} />
                    <span>{currentAdventure.settings.model || 'Select Model'}</span>
                  </button>
                }
              />
              <button
                onClick={() => { setManualCardName(''); setShowManualCardModal(true); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 rounded-full text-[10px] font-bold uppercase tracking-widest text-stone-300 shadow-lg hover:bg-stone-800/60 active:scale-95 transition-all"
                title="Create a story card"
              >
                <Layers className={cn("w-4 h-4 transition-colors duration-500", cardFlash ? "text-amber-400" : "")} style={!cardFlash ? { color: appState.globalTheme.accent } : {}} />
                <span className={cn("transition-colors duration-500", cardFlash ? "text-amber-400" : "")}>{(currentAdventure.storyCards || []).length}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 text-stone-500 text-sm w-1/4">
            <button
              onClick={() => setAppState(prev => ({ ...prev, layoutMode: prev.layoutMode === 'desktop' ? 'mobile' : 'desktop' }))}
              className="p-2 hover:bg-stone-800 rounded-full transition-colors"
              title={`Switch to ${appState.layoutMode === 'desktop' ? 'Mobile' : 'Desktop'} Layout`}
            >
              <MonitorSmartphone className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
            </button>
            <button 
              onClick={() => setShowThemeSettings(true)}
              className="p-2 hover:bg-stone-800 rounded-full transition-colors"
              title="Customize Theme"
            >
              <Palette className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
            </button>
            <AnimatePresence>
              {isRecapping && (
                <span className="flex items-center gap-2 animate-pulse font-bold text-xs uppercase tracking-widest" style={{ color: currentAdventure.theme.accent }}>
                  <Brain className="w-4 h-4 animate-bounce" />
                  Recapping Story...
                </span>
              )}
            </AnimatePresence>
            
            <div className="h-4 w-px bg-stone-800 mx-2" />
            <span className="flex items-center gap-1"><History className="w-4 h-4" /> {currentAdventure.entries.filter(e => e.type === 'ai').length} turns</span>
            <span className="flex items-center gap-1"><Brain className="w-4 h-4" /> {currentAdventure.storyCards.length} cards</span>
            
            {!appState.isSettingsOpen && (
              <button 
                onClick={() => setAppState(prev => ({ ...prev, isSettingsOpen: true }))}
                className="p-2 hover:bg-stone-800 rounded-full transition-colors ml-2"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        {/* Story Log */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-8 md:px-24 lg:px-48 space-y-8 scroll-smooth pb-64"
        >
          {currentAdventure.entries.map((entry, idx) => {
            const isAI = entry.type === 'ai';
            const text = entry.text || '';
            const lowerText = text.toLowerCase();
            const alreadyHasYou = lowerText.startsWith('you ') || lowerText.startsWith("you're ") || lowerText.startsWith('your ');
            
            const Icon = entry.type === 'say' ? Speech : 
                         entry.type === 'do' ? Running : 
                         entry.type === 'story' ? ScrollText : Brain;

            return (
              <motion.div 
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx === currentAdventure.entries.length - 1 ? 0.2 : 0 }}
                className={cn(
                  "max-w-3xl mx-auto group relative flex gap-6",
                  isAI ? "text-stone-200" : "text-stone-400 italic border-l-2 border-stone-800 pl-6 py-2"
                )}
              >
                {!isAI && (
                  <div className="flex-shrink-0 pt-1">
                    <Icon className="w-5 h-5" style={{ color: currentAdventure.theme.accent }} />
                  </div>
                )}
                <div className="flex-1">
                  {editingEntryId === entry.id ? (
                    <div className="space-y-4">
                      <textarea 
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full bg-stone-800 border border-stone-700 rounded-lg p-4 text-stone-200 focus:outline-none min-h-[150px] font-sans text-lg"
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={cancelEdit} className="px-4 py-2 text-xs uppercase tracking-widest text-stone-500 hover:text-stone-300">Cancel</button>
                        <button 
                          onClick={saveEdit} 
                          className="px-4 py-2 text-white rounded text-xs uppercase tracking-widest font-bold"
                          style={{ backgroundColor: appState.globalTheme.accent }}
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="prose prose-invert prose-stone max-w-none" style={{ color: appState.globalTheme.text, fontSize: `${appState.globalTheme.fontSize}px` }}>
                        <ReactMarkdown>
                          {entry.type === 'say' ? `You say: "${text}"` : 
                           entry.type === 'do' ? (alreadyHasYou ? text : `You ${text}`) : 
                           text}
                        </ReactMarkdown>
                      </div>
                      
                      <div className="absolute -right-12 top-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
                        <button onClick={() => startEditing(entry)} className="p-2 hover:bg-stone-800 rounded text-stone-500 hover:text-stone-200" title="Edit Entry"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteEntry(entry.id)} className="p-2 hover:bg-stone-800 rounded text-stone-500 hover:text-red-400" title="Delete Entry"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
          {(currentAdventure.isGenerating || currentAdventure.isSummarizing || isProcessingCards) && (
            <div className="max-w-3xl mx-auto flex items-center gap-4 text-stone-500">
              <div className="relative">
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4], scale: [0.98, 1.02, 0.98] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="relative flex items-center justify-center"
                >
                  {currentAdventure.isSummarizing ? (
                    <Brain className="w-8 h-8 opacity-70" style={{ color: '#00DB04' }} />
                  ) : isProcessingCards ? (
                    <Layers className="w-8 h-8 opacity-70" style={{ color: appState.globalTheme.accent }} />
                  ) : (
                    <>
                      <ScrollText className="w-8 h-8 opacity-50" style={{ color: appState.globalTheme.accent }} />
                      <motion.div
                        animate={{ x: [-2, 2, -2, 2, -2], y: [-1, 1, 1, -1, -1], rotate: [-5, 5, -5, 5, -5] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="absolute -top-1 -right-1"
                      >
                        <Pencil className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
                      </motion.div>
                    </>
                  )}
                </motion.div>
                <div
                  className="absolute inset-0 animate-ping opacity-20 rounded-full"
                  style={{ backgroundColor: currentAdventure.isSummarizing ? '#00DB04' : appState.globalTheme.accent }}
                />
              </div>
              <span className="text-sm italic animate-pulse font-sans">
                {currentAdventure.isSummarizing ? 'Summarizing...' : isProcessingCards ? 'Updating cards...' : 'Generating...'}
              </span>
            </div>
          )}
        </div>

        {/* Action Bar */}
        <div 
          className="p-8 md:px-24 lg:px-48"
          style={{ background: `linear-gradient(to top, ${appState.globalTheme.background}, ${appState.globalTheme.background}, transparent)` }}
        >
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                {[
                  { id: 'do', label: 'Do', icon: Running },
                  { id: 'say', label: 'Say', icon: Speech },
                  { id: 'story', label: 'Story', icon: BookOpen },
                ].map(type => (
                  <button
                    key={type.id}
                    onClick={() => setActionType(type.id as ActionType)}
                    className={cn(
                      "px-5 py-2.5 rounded-full text-xs font-sans font-bold uppercase tracking-widest flex items-center gap-3 transition-all",
                      actionType === type.id 
                        ? "text-white" 
                        : "bg-stone-900 text-stone-500 hover:bg-stone-800"
                    )}
                    style={actionType === type.id ? { backgroundColor: appState.globalTheme.accent } : {}}
                  >
                    <type.icon className="w-5 h-5" />
                    {type.label}
                  </button>
                ))}
                <button
                  onClick={() => continueStory()}
                  disabled={currentAdventure.isGenerating}
                  className="px-5 py-2.5 bg-stone-900 text-stone-300 hover:bg-stone-800 rounded-full text-xs font-sans font-bold uppercase tracking-widest flex items-center gap-3 transition-all disabled:opacity-50"
                >
                  <Wand2 className="w-5 h-5" style={{ color: appState.globalTheme.accent }} />
                  Continue
                </button>
              </div>

              <div className="flex gap-2">
                {currentAdventure.isGenerating && (
                  <button
                    onClick={cancelRequest}
                    className="p-2 bg-stone-900 text-red-500 hover:text-red-400 rounded-full transition-all border border-red-900/30"
                    title="Cancel Request"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={retryTurn}
                  disabled={currentAdventure.isGenerating || currentAdventure.entries.length < 2 || currentAdventure.entries[currentAdventure.entries.length-1].type !== 'ai'}
                  className="p-2 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 text-stone-500 hover:text-stone-200 rounded-full disabled:opacity-30 transition-all shadow-lg"
                  title="Retry Turn"
                >
                  <RefreshCw className={cn("w-4 h-4", currentAdventure.isGenerating && "animate-spin")} style={{ color: appState.globalTheme.accent }} />
                </button>
                <button
                  onClick={undoTurn}
                  disabled={!currentAdventure.history || currentAdventure.history.length === 0}
                  className="p-2 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 text-stone-500 hover:text-stone-200 rounded-full disabled:opacity-30 transition-all shadow-lg"
                  title="Undo Turn"
                >
                  <Undo2 className="w-4 h-4" style={{ color: appState.globalTheme.accent }} />
                </button>
                <button
                  onClick={redoTurn}
                  disabled={!currentAdventure.redoStack || currentAdventure.redoStack.length === 0}
                  className="p-2 bg-stone-900/40 backdrop-blur-md border border-stone-800/50 text-stone-500 hover:text-stone-200 rounded-full disabled:opacity-30 transition-all shadow-lg"
                  title="Redo Turn"
                >
                  <Redo2 className="w-4 h-4" style={{ color: appState.globalTheme.accent }} />
                </button>
              </div>
            </div>

            <div className="relative group">
              <div className="absolute left-6 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                {actionType === 'do' && <Running className="w-6 h-6 text-stone-600" />}
                {actionType === 'say' && <Speech className="w-6 h-6 text-stone-600" />}
                {actionType === 'story' && <BookOpen className="w-6 h-6 text-stone-600" />}
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAction();
                  }
                }}
                placeholder={
                  actionType === 'do' ? "What do you do?" :
                  actionType === 'say' ? "What do you say?" :
                  "Add to the story..."
                }
                className="w-full bg-stone-800 border border-stone-800 rounded-2xl p-6 pl-16 pr-16 text-xl font-sans focus:outline-none focus:border-stone-600 transition-all min-h-[120px] shadow-2xl resize-none"
                style={{ color: currentAdventure.theme.text }}
              />
              <button 
                onClick={() => handleAction()}
                disabled={!input.trim() || currentAdventure.isGenerating}
                className="absolute right-4 bottom-4 p-3 text-white rounded-xl hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
                style={{ backgroundColor: appState.globalTheme.accent }}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {appState.isSettingsOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          onClick={() => setAppState(prev => ({ ...prev, isSettingsOpen: false }))}
        />
      )}

      </div>
      {renderGlobalModals()}
      {diceRoll?.show && currentAdventure && (
        <DiceModal 
          value={diceRoll.value} 
          accentColor={appState.globalTheme.accent}
          onClose={() => {
            setDiceRoll(null);
            triggerAIGeneration(currentAdventure, diceRoll.value);
          }}
        />
      )}

    </div>
  );
}
