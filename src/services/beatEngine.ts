// beatEngine.ts — Story Beats engine for HomerAI
// Handles beat lifecycle, foreground/background selection, and prompt injection.

import type { StoryBeat, BeatTrack, BeatEngineState } from '../types';

// ── Default tracks ────────────────────────────────────────────────────────────

export const DEFAULT_TRACK_TEMPLATES: Omit<BeatTrack, 'beats'>[] = [
  { id: 'main',         name: 'Main Plot',    priority: 1, color: '#6366f1' },
  { id: 'relationship', name: 'Relationship', priority: 2, color: '#ec4899' },
  { id: 'lore',         name: 'World / Lore', priority: 3, color: '#10b981' },
  { id: 'danger',       name: 'Danger',       priority: 4, color: '#f59e0b' },
];

export function createDefaultTracks(): BeatTrack[] {
  return DEFAULT_TRACK_TEMPLATES.map(t => ({ ...t, beats: [] }));
}

// ── Fire turn resolution ──────────────────────────────────────────────────────

function rollFireTurn(beat: StoryBeat): number {
  const min = Math.max(1, beat.targetTurn - beat.windowSize);
  const max = beat.targetTurn + beat.windowSize;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Beat lifecycle advancement ────────────────────────────────────────────────
// Called once per turn. Returns updated tracks (immutable — does not mutate input).

export function advanceBeats(tracks: BeatTrack[], currentTurn: number): BeatTrack[] {
  return tracks.map(track => ({
    ...track,
    beats: track.beats.map(beat => {
      // Terminal states — no further changes
      if (beat.status === 'completed' || beat.status === 'expired') return beat;

      const updated = { ...beat };

      // Lazily resolve the actual fire turn on first evaluation
      if (updated.actualFireTurn === null) {
        updated.actualFireTurn = rollFireTurn(updated);
      }

      const fireStart  = updated.actualFireTurn;
      const fireEnd    = updated.targetTurn + updated.windowSize;
      const foreshadowStart = fireStart - updated.foreshadowDistance;

      // pending → foreshadowing
      if (updated.status === 'pending' && currentTurn >= foreshadowStart && currentTurn < fireStart) {
        updated.status = 'foreshadowing';
      }

      // pending/foreshadowing → active
      if ((updated.status === 'pending' || updated.status === 'foreshadowing') && currentTurn >= fireStart) {
        updated.status = 'active';
      }

      // active → expired (auto-expiry when window closes)
      if (updated.status === 'active' && currentTurn > fireEnd) {
        updated.status = 'expired';
      }

      return updated;
    }),
  }));
}

// ── Foreground / background selection ────────────────────────────────────────
// Foreground = active beat whose window expires soonest (most urgent).
// Tiebreak by track priority (lower number wins).
// All other active beats = background.

export function computeBeatEngineState(tracks: BeatTrack[]): BeatEngineState {
  const allActive: Array<{ beat: StoryBeat; trackPriority: number }> = [];
  const foreshadowingBeats: StoryBeat[] = [];

  for (const track of tracks) {
    for (const beat of track.beats) {
      if (beat.status === 'active') {
        allActive.push({ beat, trackPriority: track.priority });
      }
      if (beat.status === 'foreshadowing') {
        foreshadowingBeats.push(beat);
      }
    }
  }

  if (allActive.length === 0) {
    return { foregroundBeat: null, backgroundBeats: [], foreshadowingBeats };
  }

  allActive.sort((a, b) => {
    const expiryA = a.beat.targetTurn + a.beat.windowSize;
    const expiryB = b.beat.targetTurn + b.beat.windowSize;
    if (expiryA !== expiryB) return expiryA - expiryB;
    return a.trackPriority - b.trackPriority;
  });

  const foregroundBeat   = allActive[0].beat;
  const backgroundBeats  = allActive.slice(1).map(x => x.beat);

  return { foregroundBeat, backgroundBeats, foreshadowingBeats };
}

// ── Prompt injection builder ──────────────────────────────────────────────────
// Returns an empty string when there are no beats to inject — safe to concat.

export function buildBeatInjection(state: BeatEngineState): string {
  const { foregroundBeat, backgroundBeats, foreshadowingBeats } = state;

  if (!foregroundBeat && backgroundBeats.length === 0 && foreshadowingBeats.length === 0) {
    return '';
  }

  const lines: string[] = ['[STORY BEATS]'];

  if (foregroundBeat) {
    lines.push(
      'FOREGROUND — gradually steer this scene toward the following. ' +
      'Do NOT resolve it in one exchange. Build tension slowly:',
      `> ${foregroundBeat.title}: ${foregroundBeat.narrativeGoal}`,
    );
  }

  if (backgroundBeats.length > 0) {
    lines.push('BACKGROUND — these threads are alive in the world. Reference subtly if natural; do not force:');
    for (const beat of backgroundBeats) {
      lines.push(`> ${beat.title}: ${beat.narrativeGoal}`);
    }
  }

  if (foreshadowingBeats.length > 0) {
    const hints = foreshadowingBeats.filter(b => b.foreshadowHint.trim());
    if (hints.length > 0) {
      lines.push('ATMOSPHERE — foreshadow these vaguely. Do not name or resolve directly:');
      for (const beat of hints) {
        lines.push(`> ${beat.foreshadowHint}`);
      }
    }
  }

  lines.push('[/STORY BEATS]');
  return lines.join('\n');
}

// ── Manual beat completion ────────────────────────────────────────────────────
// Player explicitly marks a beat as done before its window expires.

export function completeBeat(
  tracks: BeatTrack[],
  beatId: string,
  currentTurn: number,
): BeatTrack[] {
  return tracks.map(track => ({
    ...track,
    beats: track.beats.map(beat =>
      beat.id === beatId
        ? { ...beat, status: 'completed' as const, completedAtTurn: currentTurn }
        : beat,
    ),
  }));
}

// ── Current turn counter ──────────────────────────────────────────────────────
// Counts AI response entries in the story so far.

export function getCurrentTurn(entries: Array<{ type: string }>): number {
  return entries.filter(e => e.type === 'ai').length;
}
