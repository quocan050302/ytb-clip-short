/**
 * SpeechTimeline Engine
 * Parses SRT / WhisperX JSON into word-level timing (WordTiming[])
 * and provides utilities for clip-relative timestamp remapping.
 *
 * Rules:
 * - If no SRT → hasWordTiming = false, word captions DISABLED (warning emitted)
 * - Never uses placeholder transcripts ("[Đoạn nói 1]")
 * - Confidence is preserved from WhisperX if available; defaults to 1.0 for SRT
 */

import fs from 'fs';
import { TranscriptSegment, WordTiming } from './types';

// ─── SRT Parsing ──────────────────────────────────────────────────────────────

/** Parse SRT timestamp like "00:01:23,456" → seconds */
function parseSrtTimestamp(ts: string): number {
  const match = ts.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const [, h, m, s, ms] = match.map(Number);
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * Parse standard SRT content into TranscriptSegment[].
 * Optionally splits each segment into word-level estimates if
 * no WhisperX data is available (linear interpolation).
 */
export function parseSrt(
  srtContent: string,
  inferWordTiming = true
): TranscriptSegment[] {
  const blocks = srtContent.trim().split(/\n\s*\n/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // line 0: index (ignore), line 1: timestamps, line 2+: text
    const timeLine = lines[1];
    const timeMatch = timeLine.match(
      /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/
    );
    if (!timeMatch) continue;

    const start = parseSrtTimestamp(timeMatch[1]);
    const end = parseSrtTimestamp(timeMatch[2]);
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();

    if (!text) continue;

    let words: WordTiming[] | undefined;
    if (inferWordTiming) {
      words = interpolateWords(text, start, end);
    }

    segments.push({
      id: `seg_${segments.length}`,
      start,
      end,
      text,
      words,
    });
  }

  return segments;
}

/**
 * Parse WhisperX JSON format into TranscriptSegment[].
 * WhisperX output has word-level confidence and timestamps.
 *
 * Expected format:
 * { segments: [{ start, end, text, words: [{ word, start, end, score }] }] }
 */
export function parseWhisperX(jsonContent: string): TranscriptSegment[] {
  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error('Invalid WhisperX JSON');
  }

  const rawSegments: any[] = data.segments ?? data.chunks ?? [];
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const start = Number(seg.start ?? 0);
    const end = Number(seg.end ?? start + 1);
    const text = (seg.text ?? '').trim();
    if (!text) continue;

    const words: WordTiming[] = [];
    const rawWords: any[] = seg.words ?? [];

    for (const w of rawWords) {
      const wText = (w.word ?? w.text ?? '').trim();
      if (!wText) continue;
      words.push({
        word: wText,
        start: Number(w.start ?? start),
        end: Number(w.end ?? end),
        confidence: Number(w.score ?? w.confidence ?? 1.0),
      });
    }

    segments.push({
      id: `seg_${i}`,
      start,
      end,
      text,
      words: words.length > 0 ? words : interpolateWords(text, start, end),
    });
  }

  return segments;
}

/**
 * Auto-detect format and parse from file path.
 * Returns { segments, hasWordTiming, warnings }
 */
export interface SpeechTimelineResult {
  segments: TranscriptSegment[];
  hasWordTiming: boolean;
  warnings: string[];
}

export function loadSpeechTimeline(
  filePath: string | undefined,
  rawContent: string | undefined
): SpeechTimelineResult {
  const warnings: string[] = [];

  if (!filePath && !rawContent) {
    warnings.push(
      'No SRT or WhisperX file provided – word-level captions are DISABLED. ' +
      'Upload a .srt or whisperx.json to enable caption animation.'
    );
    return { segments: [], hasWordTiming: false, warnings };
  }

  let content = rawContent ?? '';
  if (!content && filePath) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err: any) {
      warnings.push(`Failed to read speech file (${filePath}): ${err.message}. Word-level captions DISABLED.`);
      return { segments: [], hasWordTiming: false, warnings };
    }
  }

  // Detect WhisperX JSON
  if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
    try {
      const segments = parseWhisperX(content);
      const hasWordTiming = segments.some((s) => (s.words?.length ?? 0) > 0);
      if (!hasWordTiming) {
        warnings.push('WhisperX JSON has no word-level data – captions will be segment-level only.');
      }
      return { segments, hasWordTiming, warnings };
    } catch (err: any) {
      warnings.push(`WhisperX parse error: ${err.message}. Trying SRT fallback.`);
    }
  }

  // Fallback to SRT
  const segments = parseSrt(content, true);
  if (segments.length === 0) {
    warnings.push('SRT parsed 0 segments – word-level captions DISABLED.');
    return { segments: [], hasWordTiming: false, warnings };
  }

  const hasWordTiming = true; // interpolated
  warnings.push(
    'SRT loaded: word timings are linearly interpolated (not real word-level). ' +
    'For accurate captions, provide a WhisperX JSON.'
  );

  return { segments, hasWordTiming, warnings };
}

// ─── Clip-Relative Remapping ──────────────────────────────────────────────────

/**
 * Filter segments overlapping [clipStart, clipEnd] and remap timestamps
 * to clip-relative (0-based) coordinates.
 */
export function filterAndRemapSegments(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number
): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];

  for (const seg of segments) {
    if (seg.end < clipStart || seg.start > clipEnd) continue;

    const remappedStart = Math.max(0, seg.start - clipStart);
    const remappedEnd = Math.min(clipEnd - clipStart, seg.end - clipStart);

    const remappedWords = seg.words?.map((w) => ({
      ...w,
      start: Math.max(0, w.start - clipStart),
      end: Math.min(clipEnd - clipStart, w.end - clipStart),
    }));

    result.push({
      ...seg,
      start: remappedStart,
      end: remappedEnd,
      words: remappedWords,
    });
  }

  return result;
}

/**
 * Extract all WordTiming from segments (flattened, clip-relative).
 */
export function extractAllWords(segments: TranscriptSegment[]): WordTiming[] {
  return segments.flatMap((s) => s.words ?? []);
}

/**
 * Find the word at a given clip-relative timestamp (±tolerance seconds).
 */
export function wordAtTimestamp(
  words: WordTiming[],
  t: number,
  toleranceSec = 0.15
): WordTiming | undefined {
  return words.find((w) => t >= w.start - toleranceSec && t <= w.end + toleranceSec);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Linear interpolation of word timings within a segment.
 * When only segment-level SRT is available (no word timestamps),
 * distribute words evenly across the segment duration.
 */
function interpolateWords(text: string, start: number, end: number): WordTiming[] {
  const rawWords = text.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return [];

  const segDuration = Math.max(0.1, end - start);
  const wordDur = segDuration / rawWords.length;

  return rawWords.map((word, i) => ({
    word,
    start: start + i * wordDur,
    end: start + (i + 1) * wordDur,
    confidence: 1.0,
  }));
}
