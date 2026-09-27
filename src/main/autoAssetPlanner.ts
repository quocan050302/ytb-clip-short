import { BeatDetector, DetectedBeat } from './beatDetector';
import { LocalAssetProvider } from './assetProvider';
import { TrendCatalog } from './trendCatalog';
import {
  BeatEvent,
  ClipAssetPlan,
  ClipCandidate,
  DuckingSettings,
  JobSettings,
  TranscriptSegment,
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
   * Plan beats, paired meme + SFX, and ducked music bed for one clip candidate
   */
  planForClip(
    candidate: ClipCandidate,
    settings: JobSettings,
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[]
  ): ClipAssetPlan {
    const detected = this.beatDetector.detectBeats(
      candidate.start,
      candidate.end,
      allSegments,
      allSilences
    );

    // Map each detected beat to paired SFX and Meme sharing the EXACT SAME timestamp
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

    return {
      clipId: candidate.id,
      musicTrack,
      beats,
      duckingSettings,
    };
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
