/**
 * MomentPlanner
 * Replaces and extends the old BeatDetector.
 * 
 * Analyzes transcript segments + silence intervals to detect:
 *   hook | reveal | surprise | fail | punchline | pause |
 *   reaction | emphasis | transition
 *
 * Each detected moment has: timestamp, duration, confidence, reason, triggerWord
 * 
 * Design rules:
 * - Source of truth = transcript text + timing (real data only, no placeholders)
 * - Falls back to silence-based heuristics when no transcript
 * - All moments are relative to CLIP START (0-based)
 */

import { MomentEvent, MomentType, TranscriptSegment, WordTiming } from './types';

// ─── Config ───────────────────────────────────────────────────────────────────

interface MomentPlannerConfig {
  /** Seconds from clip start considered "hook zone" */
  hookZoneSec: number;
  /** Minimum silence gap (sec) to be a dramatic pause */
  minPauseSec: number;
  /** Min confidence threshold to include moment */
  minConfidence: number;
  /** Max moments per clip to avoid crowding */
  maxMomentsPerClip: number;
}

const DEFAULT_CONFIG: MomentPlannerConfig = {
  hookZoneSec: 5,
  minPauseSec: 0.6,
  minConfidence: 0.45,
  maxMomentsPerClip: 12,
};

// ─── Keyword Dictionaries ─────────────────────────────────────────────────────

const HOOK_WORDS = [
  'attention', 'listen', 'wait', 'watch this', 'no way', 'omg', 'wow',
  'this is', 'today', 'secret', 'hack', 'tip', 'trick', 'must', 'best',
  'worst', 'ever', 'never', 'always', 'first time', 'breaking',
  // Vietnamese
  'chú ý', 'nghe này', 'đợi đã', 'không thể tin', 'sự thật', 'bí mật',
  'mẹo', 'đỉnh nhất', 'tệ nhất', 'lần đầu', 'hôm nay', 'xem này',
];

const SURPRISE_WORDS = [
  'surprise', 'unexpected', 'shocking', 'plot twist', 'twist', 'but wait',
  'actually', 'turns out', 'realized', 'suddenly', 'out of nowhere',
  // Vietnamese
  'bất ngờ', 'thực ra', 'hóa ra', 'té ra', 'nhưng mà', 'đột nhiên',
  'thế mà', 'ai ngờ', 'không ngờ',
];

const FAIL_WORDS = [
  'fail', 'mistake', 'wrong', 'oops', 'error', 'broke', 'crash', 'fell',
  'failed', 'disaster', 'epic fail',
  // Vietnamese  
  'thất bại', 'sai rồi', 'lỗi', 'ôi không', 'vỡ', 'hỏng', '망', 'té',
];

const PUNCHLINE_WORDS = [
  'lol', 'haha', 'funny', 'joke', 'get it', 'see what', 'that\'s why',
  'so basically', 'long story short', 'bottom line', 'moral of',
  // Vietnamese
  'haha', 'buồn cười', 'đùa thôi', 'thì ra', 'tóm lại', 'nói tóm',
  'đó là lý do', 'thế mới',
];

const REVEAL_WORDS = [
  'reveal', 'the answer is', 'turns out', 'here it is', 'ta-da', 'voilà',
  'the result', 'final', 'and that', 'so the',
  // Vietnamese
  'kết quả là', 'đây rồi', 'câu trả lời', 'cuối cùng', 'vậy là',
  'thì ra là', 'hóa ra là',
];

const REACTION_PATTERNS = [
  /\b(oh|ah|uh|um|wow|huh|whoa|ugh|yikes|aww|awww)\b/gi,
  /\b(ôi|ừ|ừm|ừa|ơ kìa|trời ơi|ây da|ha|he|hi)\b/gi,
];

const EMPHASIS_PATTERNS = [
  // ALL CAPS word (if present as signal in ASR output)
  /\b[A-Z]{3,}\b/g,
  // repeated punctuation patterns in text
  /\w+!{2,}/g,
];

// ─── Main MomentPlanner Class ─────────────────────────────────────────────────

export class MomentPlanner {
  private config: MomentPlannerConfig;

  constructor(config?: Partial<MomentPlannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect all moments in a clip.
   * @param segments - Transcript segments, already remapped to clip-relative time (0-based)
   * @param silences - Silence intervals, relative to clip start
   * @param clipDuration - Total clip duration in seconds
   */
  detectMoments(
    segments: TranscriptSegment[],
    silences: Array<{ start: number; end: number }>,
    clipDuration: number
  ): MomentEvent[] {
    const moments: MomentEvent[] = [];
    let idCounter = 0;

    const nextId = (type: MomentType) => `moment_${type}_${idCounter++}`;

    // Separate real segments from silence placeholders
    const realSegments = segments.filter(
      (s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text)
    );

    // 1. HOOK – strong opener in first hookZoneSec
    if (realSegments.length > 0) {
      const hookZone = realSegments.filter((s) => s.start < this.config.hookZoneSec);
      if (hookZone.length > 0) {
        const firstSeg = hookZone[0];
        const hookTrigger = findKeyword(firstSeg.text, HOOK_WORDS);
        moments.push({
          id: nextId('hook'),
          momentType: 'hook',
          timestamp: firstSeg.start,
          duration: Math.min(3, firstSeg.end - firstSeg.start),
          confidence: hookTrigger ? 0.88 : 0.65,
          reason: hookTrigger
            ? `Hook keyword "${hookTrigger}" detected in opening ${this.config.hookZoneSec}s`
            : `Opening speech in first ${this.config.hookZoneSec}s`,
          triggerWord: hookTrigger ?? undefined,
          energyScore: hookTrigger ? 0.85 : 0.65,
        });
      }
    } else {
      // Fixed safe hook timing without fake text
      moments.push({
        id: nextId('hook'),
        momentType: 'hook',
        timestamp: 0.8,
        duration: 2.0,
        confidence: 0.70,
        reason: 'Nhịp mở đầu (safe hook timing)',
        energyScore: 0.70,
      });
    }

    // 2. Scan REAL segments only for keyword-based moments
    for (const seg of realSegments) {
      const text = seg.text.toLowerCase();
      const segMid = (seg.start + seg.end) / 2;

      // SURPRISE
      const surpriseTrigger = findKeyword(text, SURPRISE_WORDS);
      if (surpriseTrigger && !momentExists(moments, segMid, 1.5)) {
        moments.push({
          id: nextId('surprise'),
          momentType: 'surprise',
          timestamp: seg.start,
          duration: Math.min(2.5, seg.end - seg.start),
          confidence: 0.78,
          reason: `Surprise keyword "${surpriseTrigger}" found`,
          triggerWord: surpriseTrigger,
          energyScore: 0.75,
        });
      }

      // FAIL
      const failTrigger = findKeyword(text, FAIL_WORDS);
      if (failTrigger && !momentExists(moments, segMid, 1.5)) {
        moments.push({
          id: nextId('fail'),
          momentType: 'fail',
          timestamp: seg.start,
          duration: Math.min(2, seg.end - seg.start),
          confidence: 0.80,
          reason: `Fail keyword "${failTrigger}" found`,
          triggerWord: failTrigger,
          energyScore: 0.70,
        });
      }

      // PUNCHLINE
      const punchTrigger = findKeyword(text, PUNCHLINE_WORDS);
      if (punchTrigger && !momentExists(moments, segMid, 1.5)) {
        moments.push({
          id: nextId('punchline'),
          momentType: 'punchline',
          timestamp: seg.start,
          duration: Math.min(2, seg.end - seg.start),
          confidence: 0.75,
          reason: `Punchline keyword "${punchTrigger}" found`,
          triggerWord: punchTrigger,
          energyScore: 0.72,
        });
      }

      // REVEAL
      const revealTrigger = findKeyword(text, REVEAL_WORDS);
      if (revealTrigger && !momentExists(moments, segMid, 1.5)) {
        moments.push({
          id: nextId('reveal'),
          momentType: 'reveal',
          timestamp: seg.start,
          duration: Math.min(2.5, seg.end - seg.start),
          confidence: 0.73,
          reason: `Reveal keyword "${revealTrigger}" found`,
          triggerWord: revealTrigger,
          energyScore: 0.68,
        });
      }

      // REACTION patterns
      for (const pattern of REACTION_PATTERNS) {
        const match = text.match(pattern);
        if (match && !momentExists(moments, segMid, 1.0)) {
          moments.push({
            id: nextId('reaction'),
            momentType: 'reaction',
            timestamp: seg.start,
            duration: Math.min(1.5, seg.end - seg.start),
            confidence: 0.65,
            reason: `Reaction expression "${match[0]}" detected`,
            triggerWord: match[0],
            energyScore: 0.60,
          });
          break;
        }
      }

      // EMPHASIS (word-level if available)
      if (seg.words && seg.words.length > 0) {
        detectEmphasisFromWords(seg.words).forEach((w) => {
          if (!momentExists(moments, w.start, 0.8)) {
            moments.push({
              id: nextId('emphasis'),
              momentType: 'emphasis',
              timestamp: w.start,
              duration: Math.min(1, w.end - w.start + 0.3),
              confidence: 0.60,
              reason: `Emphasized word "${w.word}" (confidence: ${w.confidence.toFixed(2)})`,
              triggerWord: w.word,
              energyScore: 0.55,
            });
          }
        });
      }
    }

    // 3. TRANSITION – segment boundaries with notable gap
    for (let i = 0; i < segments.length - 1; i++) {
      const gap = segments[i + 1].start - segments[i].end;
      if (gap > 1.5 && !momentExists(moments, segments[i].end, 1.0)) {
        moments.push({
          id: nextId('transition'),
          momentType: 'transition',
          timestamp: segments[i].end,
          duration: gap,
          confidence: 0.55,
          reason: `Topic transition gap ${gap.toFixed(1)}s between segments`,
          energyScore: 0.40,
        });
      }
    }

    // 4. PAUSE – silence intervals within clip
    for (const silence of silences) {
      const dur = silence.end - silence.start;
      if (dur >= this.config.minPauseSec && dur < 4.0) {
        if (!momentExists(moments, silence.start, 0.5)) {
          moments.push({
            id: nextId('pause'),
            momentType: 'pause',
            timestamp: silence.start,
            duration: dur,
            confidence: 0.58,
            reason: `Dramatic silence ${dur.toFixed(1)}s`,
            energyScore: 0.35,
          });
        }
      }
    }

    // 4b. Safe punchline timing at payoff zone (ending 3-4s)
    const punchlineTime = Math.max(3.0, clipDuration - 3.5);
    if (!momentExists(moments, punchlineTime, 2.0)) {
      moments.push({
        id: nextId('punchline'),
        momentType: 'punchline',
        timestamp: punchlineTime,
        duration: 1.8,
        confidence: 0.75,
        reason: 'Đoạn kết cao trào (safe punchline timing)',
        energyScore: 0.75,
      });
    }

    // 5. Filter by confidence and sort by timestamp
    const filtered = moments
      .filter((m) => m.confidence >= this.config.minConfidence)
      .sort((a, b) => a.timestamp - b.timestamp);

    // 6. Deduplicate – remove overlapping moments (keep higher confidence)
    const deduped = deduplicateMoments(filtered);

    // 7. Cap at maxMomentsPerClip (prioritize by confidence desc)
    const capped = deduped
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxMomentsPerClip)
      .sort((a, b) => a.timestamp - b.timestamp);

    return capped;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find first matching keyword in text (case-insensitive) */
function findKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

/** Check if a moment already exists near a given timestamp (within toleranceSec) */
function momentExists(
  moments: MomentEvent[],
  timestamp: number,
  toleranceSec: number
): boolean {
  return moments.some(
    (m) => Math.abs(m.timestamp - timestamp) < toleranceSec
  );
}

/** Detect emphasis from word-level timing: very short high-confidence words */
function detectEmphasisFromWords(words: WordTiming[]): WordTiming[] {
  const emphasized: WordTiming[] = [];
  for (const w of words) {
    // Word is "short" (< 0.3s) but high confidence → likely stressed consonants
    // OR word in ALL CAPS in source text
    const isShortHighConf = (w.end - w.start) < 0.25 && w.confidence > 0.85;
    const isAllCaps = w.word === w.word.toUpperCase() && w.word.length > 2 && /[A-Z]/.test(w.word);
    if (isShortHighConf || isAllCaps) {
      emphasized.push(w);
    }
  }
  return emphasized;
}

/** Remove moments that overlap within 1.0s window – keep highest confidence */
function deduplicateMoments(moments: MomentEvent[]): MomentEvent[] {
  const result: MomentEvent[] = [];
  for (const m of moments) {
    const conflict = result.findIndex(
      (r) => Math.abs(r.timestamp - m.timestamp) < 1.0
    );
    if (conflict === -1) {
      result.push(m);
    } else if (m.confidence > result[conflict].confidence) {
      result[conflict] = m;
    }
  }
  return result;
}
