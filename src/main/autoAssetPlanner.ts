import { BeatDetector, DetectedBeat } from './beatDetector';
import { LocalAssetProvider } from './assetProvider';
import { TrendCatalog } from './trendCatalog';
import {
  AudioEventPlan,
  BeatEvent,
  ClipAssetPlan,
  ClipCandidate,
  DuckingSettings,
  JobSettings,
  MomentEvent,
  PlannedSfxEvent,
  TranscriptSegment,
  VisualOverlayPlan,
} from './types';
import { SilenceInterval } from './videoAnalyzer';

export class AutoAssetPlanner {
  private beatDetector = new BeatDetector();
  private assetProvider: LocalAssetProvider;
  private trendCatalog: TrendCatalog;

  constructor(assetProvider?: LocalAssetProvider) {
    this.assetProvider = assetProvider || new LocalAssetProvider();
    this.trendCatalog = new TrendCatalog(this.assetProvider);
  }

  getAssetProvider(): LocalAssetProvider {
    return this.assetProvider;
  }

  getTrendCatalog(): TrendCatalog {
    return this.trendCatalog;
  }

  /**
   * Plan beats, multi-SFX timeline, and ducked music bed for one clip candidate
   */
  planForClip(
    candidate: ClipCandidate,
    settings: JobSettings,
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[]
  ): ClipAssetPlan {
    const clipDuration = candidate.duration;
    const detected = this.beatDetector.detectBeats(
      candidate.start,
      candidate.end,
      allSegments,
      allSilences
    );

    // Map each detected beat to paired SFX and Meme sharing the EXACT SAME timestamp (for backward compat)
    const beats: BeatEvent[] = detected.map((b) => {
      const sfx = this.assetProvider.getSfxForBeat(b.type, settings.preset);
      const meme = this.assetProvider.getMemeForBeat(b.type, settings.preset);

      return {
        id: b.id,
        beatType: b.type,
        timestamp: b.timestamp,
        duration: b.duration,
        sfx,
        meme,
        confidence: b.confidence,
        reason: b.reason,
      };
    });

    // Select mood-appropriate music bed
    let musicTrack = null;
    if (settings.bgm) {
      const { track } = this.trendCatalog.resolveMusicForPreset(settings.preset);
      musicTrack = track;
    }

    const duckingSettings: DuckingSettings = {
      normalVolume: settings.preset === 'reaction' ? 0.22 : 0.16,
      duckedVolume: settings.preset === 'reaction' ? 0.06 : 0.04,
      fadeInDuration: 0.5,
      fadeOutDuration: 1.0,
    };

    // ── Generate Multi-SFX Timeline (independent timeline) ───────────────────
    const sfxEvents = this.generateSfxEvents(
      candidate,
      settings,
      detected,
      allSegments,
      allSilences
    );

    return {
      clipId: candidate.id,
      musicTrack,
      beats,
      sfxEvents,
      duckingSettings,
    };
  }

  /**
   * Propose evidence-based SFX events across the Short's timeline.
   * Rules:
   * - Rule-based suggestion, NOT a fixed quota.
   * - Allows multiple SFX around moments (e.g. pre-cue whoosh + reaction impact).
   * - Avoids spamming duplicate SFX in quick succession.
   * - Minimal suggestions for placeholder transcripts.
   */
  private generateSfxEvents(
    candidate: ClipCandidate,
    settings: JobSettings,
    detectedBeats: DetectedBeat[],
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[]
  ): PlannedSfxEvent[] {
    const clipDuration = candidate.duration;
    const realSegments = allSegments
      .filter((s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text) && s.end > candidate.start && s.start < candidate.end)
      .map((s) => ({
        ...s,
        relStart: Math.max(0, s.start - candidate.start),
        relEnd: Math.min(clipDuration, s.end - candidate.start),
      }));

    const isPlaceholder = realSegments.length === 0;
    const rawEvents: PlannedSfxEvent[] = [];

    // Helper to add event
    let eventSeq = 1;
    const addEvent = (
      assetKey: string,
      triggerAt: number,
      sourceBeatId: string | undefined,
      reason: string,
      volume: number = 0.85,
      fadeIn: number = 0.05,
      fadeOut: number = 0.2
    ) => {
      const asset = this.assetProvider.getSfxForBeat(assetKey as any, settings.preset);
      if (!asset || !asset.filePath) return;
      const clampedTs = Math.max(0, Math.min(clipDuration - 0.15, Math.round(triggerAt * 10) / 10));
      rawEvents.push({
        id: `sfx_${Date.now()}_${eventSeq++}`,
        asset,
        triggerAt: clampedTs,
        volume: Math.max(0.2, Math.min(1.2, volume)),
        fadeIn: Math.max(0, fadeIn),
        fadeOut: Math.max(0, fadeOut),
        enabled: true,
        sourceBeatId,
        origin: 'auto',
        reason,
      });
    };

    // 1. Hook moment in opening 1-2.5s
    const hookBeat = detectedBeats.find((b) => b.type === 'hook');
    if (hookBeat) {
      if (!isPlaceholder) {
        addEvent('hook', hookBeat.timestamp, hookBeat.id, 'Whoosh mở đầu tạo nhịp chú ý cho Short', 0.80, 0.04, 0.2);
      } else {
        // If placeholder, add single minimal hook cue for preview
        addEvent('hook', hookBeat.timestamp, hookBeat.id, 'Gợi ý hook mở đầu (chờ duyệt do thiếu transcript)', 0.70, 0.05, 0.2);
      }
    }

    // 2. Process semantic beats (surprise, reveal, fail, punchline, pause)
    for (const b of detectedBeats) {
      if (b.type === 'hook') continue; // already handled

      switch (b.type) {
        case 'surprise': {
          // Double-SFX support around a strong surprise beat:
          // A light pre-cue whoosh 0.35s before impact if there's room
          if (b.confidence > 0.82 && b.timestamp >= 0.7) {
            addEvent('hook', b.timestamp - 0.35, b.id, 'Âm thanh chuyển động lướt trước phản ứng bất ngờ', 0.55, 0.04, 0.15);
          }
          addEvent('surprise', b.timestamp, b.id, `Âm thanh nhấn mạnh phản ứng bất ngờ (${b.reason})`, 0.90, 0.04, 0.25);
          break;
        }

        case 'reveal': {
          addEvent('reveal', b.timestamp, b.id, `Âm thanh chuông báo điểm nhấn tiết lộ: "${b.reason}"`, 0.85, 0.05, 0.3);
          break;
        }

        case 'fail': {
          addEvent('fail', b.timestamp, b.id, `Âm thanh fail / bruh hài hước (${b.reason})`, 0.88, 0.05, 0.3);
          break;
        }

        case 'punchline': {
          if (b.confidence > 0.80 && b.timestamp >= 0.6) {
            addEvent('hook', b.timestamp - 0.3, b.id, 'Hiệu ứng gia tốc trước điểm rơi punchline', 0.50, 0.04, 0.15);
          }
          addEvent('punchline', b.timestamp, b.id, `Âm thanh impact điểm rơi cao trào (${b.reason})`, 0.90, 0.04, 0.3);
          break;
        }

        case 'pause': {
          addEvent('pause', b.timestamp, b.id, `Âm thanh nhấn mạnh khoảng lặng kịch tính (${b.reason})`, 0.70, 0.05, 0.25);
          break;
        }
      }
    }

    // 3. Scan silences for dramatic pre-reveal cues
    if (!isPlaceholder && allSilences?.length > 0) {
      const clipSilences = allSilences
        .filter((s) => s.end > candidate.start && s.start < candidate.end)
        .map((s) => ({
          relStart: Math.max(0, s.start - candidate.start),
          relEnd: Math.min(clipDuration, s.end - candidate.start),
          dur: s.end - s.start,
        }))
        .filter((s) => s.dur >= 0.5 && s.relStart >= 2.0 && s.relEnd <= clipDuration - 2.0);

      for (const sil of clipSilences) {
        // Only add if no SFX already exists near this silence (< 1.5s)
        const hasNearby = rawEvents.some((e) => Math.abs(e.triggerAt - sil.relEnd) < 1.5);
        if (!hasNearby) {
          addEvent('reveal', sil.relEnd, undefined, 'Điểm nhấn âm thanh kết thúc khoảng lặng trước câu nói tiếp theo', 0.75, 0.05, 0.25);
        }
      }
    }

    // 4. Anti-spam & Contextual Deduplication
    rawEvents.sort((a, b) => a.triggerAt - b.triggerAt);

    const filtered: PlannedSfxEvent[] = [];
    for (const evt of rawEvents) {
      // Don't repeat the exact same asset within 2.0 seconds
      const tooCloseDuplicate = filtered.some(
        (prev) => prev.asset.id === evt.asset.id && Math.abs(prev.triggerAt - evt.triggerAt) < 2.0
      );
      if (tooCloseDuplicate) continue;

      filtered.push(evt);
    }

    return filtered;
  }

  /**
   * Automatically enrich all candidates with an Asset Plan
   */
  planAll(
    candidates: ClipCandidate[],
    settings: JobSettings,
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[]
  ): ClipCandidate[] {
    return candidates.map((cand) => {
      const plan = this.planForClip(cand, settings, allSegments, allSilences);
      return {
        ...cand,
        assetPlan: plan,
      };
    });
  }
}

/**
 * Migration helper: If candidate.assetPlan has beats with SFX but no sfxEvents,
 * migrate them into sfxEvents[] with stable IDs and auto origin.
 */
export function migrateAssetPlan(plan: ClipAssetPlan | undefined, clipDuration: number = 30): ClipAssetPlan {
  if (!plan) {
    return {
      clipId: '',
      musicTrack: null,
      beats: [],
      sfxEvents: [],
      duckingSettings: {
        normalVolume: 0.22,
        duckedVolume: 0.06,
        fadeInDuration: 0.5,
        fadeOutDuration: 1.0,
      },
    };
  }
  if (!plan.sfxEvents || !Array.isArray(plan.sfxEvents)) {
    plan.sfxEvents = (plan.beats || [])
      .filter((b) => b.sfx && b.sfx.filePath)
      .map((b, i) => ({
        id: `sfx_migrated_${b.id || i}`,
        asset: b.sfx,
        triggerAt: Math.max(0, Math.min(Math.max(0, clipDuration - 0.1), b.timestamp)),
        duration: b.duration,
        volume: 0.85,
        fadeIn: 0.05,
        fadeOut: 0.25,
        enabled: true,
        sourceBeatId: b.id,
        origin: 'auto' as const,
        reason: b.reason || `SFX đồng bộ theo beat ${b.beatType}`,
      }));
  }
  return plan;
}

/**
 * Build AudioEventPlan list from ClipAssetPlan.sfxEvents (effective SFX source of truth)
 */
export function buildAudioEventsFromAssetPlan(
  plan: ClipAssetPlan | undefined,
  moments?: MomentEvent[],
  clipDuration: number = 30
): AudioEventPlan[] {
  if (!plan) return [];
  const migrated = migrateAssetPlan(plan, clipDuration);
  return (migrated.sfxEvents || [])
    .filter((e) => e.enabled !== false && e.asset?.filePath)
    .map((e) => {
      const matchedMoment = moments?.find((m) => Math.abs(m.timestamp - e.triggerAt) < 1.2);
      return {
        id: e.id,
        type: 'sfx' as const,
        assetPath: e.asset.filePath,
        triggerAt: Math.max(0, Math.min(clipDuration - 0.05, e.triggerAt)),
        volume: Math.max(0.05, Math.min(2.0, e.volume ?? 0.85)),
        fadeIn: Math.max(0, e.fadeIn ?? 0.05),
        fadeOut: Math.max(0, e.fadeOut ?? 0.2),
        duration: e.duration,
        momentId: matchedMoment?.id || e.sourceBeatId,
      };
    });
}

/**
 * Build VisualOverlayPlan list from ClipAssetPlan.beats (memes)
 */
export function buildVisualOverlaysFromAssetPlan(
  plan: ClipAssetPlan | undefined,
  moments?: MomentEvent[],
  clipDuration: number = 30
): VisualOverlayPlan[] {
  if (!plan) return [];
  return (plan.beats || [])
    .filter((b) => b.meme?.filePath)
    .map((beat, i) => ({
      id: `visual_${i}`,
      type: 'meme-image' as const,
      assetPath: beat.meme.filePath,
      start: beat.timestamp,
      end: Math.min(clipDuration, beat.timestamp + (beat.duration || 1.5)),
      xNorm: 0.5 - 0.15,
      yNorm: 0.12,
      widthNorm: 0.30,
      heightNorm: 0.20,
      opacity: 0.92,
      momentId: moments?.find((m) => Math.abs(m.timestamp - beat.timestamp) < 1.5)?.id || beat.id,
    }));
}

