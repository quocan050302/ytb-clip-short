import { BeatDetector, DetectedBeat } from './beatDetector';
import { LocalAssetProvider } from './assetProvider';
import { TrendCatalog } from './trendCatalog';
import {
  AssetItem,
  AudioEventPlan,
  BeatEvent,
  ClipAssetPlan,
  ClipCandidate,
  DuckingSettings,
  JobSettings,
  MomentCandidate,
  MomentEvent,
  PlannedSfxEvent,
  SfxChoice,
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

    // ── Generate Multi-SFX Timeline & Moment Candidates (Two-Tier AI Selection) ──
    const { sfxEvents, suggestedMoments } = this.generateSfxAndMoments(
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
      suggestedMoments,
      duckingSettings,
    };
  }

  /**
   * Detect granular moment candidates with explicit contextual evidence from
   * real transcript segments, silences, and audio beats.
   */
  detectMoments(
    candidate: ClipCandidate,
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[],
    detectedBeats: DetectedBeat[]
  ): MomentCandidate[] {
    const clipDuration = candidate.duration;
    const realSegments = allSegments
      .filter((s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text) && s.end > candidate.start && s.start < candidate.end)
      .map((s) => ({
        ...s,
        relStart: Math.max(0, s.start - candidate.start),
        relEnd: Math.min(clipDuration, s.end - candidate.start),
      }));

    const isPlaceholder = realSegments.length === 0;
    const rawMoments: MomentCandidate[] = [];
    let momentSeq = 1;

    // 1. Hook moment at start
    const hookBeat = detectedBeats.find((b) => b.type === 'hook');
    const hookTime = hookBeat ? Math.max(0.5, Math.min(2.0, hookBeat.timestamp)) : 1.0;
    rawMoments.push({
      id: `moment_hook_${momentSeq++}`,
      timestamp: hookTime,
      type: 'hook',
      evidence: isPlaceholder
        ? 'Nhịp mở đầu Short (chờ duyệt do thiếu transcript thật)'
        : 'Nhịp mở đầu Short tạo sự chú ý trong 2 giây đầu tiên',
      confidence: isPlaceholder ? 0.65 : 0.95,
      status: isPlaceholder ? 'suggested' : 'approved',
    });

    if (!isPlaceholder) {
      // 2. Real transcript context scanning
      for (const seg of realSegments) {
        const text = seg.text.toLowerCase();

        // 2a. Cartoon slip: fall/slip keywords
        if (/\b(trượt|ngã|slip|fall|té|hụt chân|vấp ngã|trượt chân|té xỉu)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_slip_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.1)),
            type: 'slip',
            evidence: `Phát hiện hành động trượt ngã trong lời thoại: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.92,
            status: 'approved',
          });
        }

        // 2b. Money cue: money/cash keywords
        if (/\b(tiền|money|dollar|triệu|tỷ|đô|cash|lương|giàu|thu nhập|mua|bán|trúng thưởng|tài sản)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_money_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.1)),
            type: 'money',
            evidence: `Lời thoại nhắc đến tài chính/tiền bạc: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.90,
            status: 'approved',
          });
        }

        // 2c. Bonk / Punch: collision / hit / impact keywords
        if (/\b(đấm|đập|punch|hit|bonk|va chạm|cú đấm|táng|gõ đầu|đập bàn)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_impact_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.15)),
            type: 'impact',
            evidence: `Hành động va chạm/tác động vật lý trong lời thoại: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.88,
            status: 'approved',
          });
        }

        // 2d. Connection lost / glitch: network/loading keywords
        if (/\b(mất mạng|mất kết nối|đơ|lag|disconnect|loading|đứng hình|mất sóng)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_conn_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.1)),
            type: 'fail',
            evidence: `Lời thoại đề cập mất kết nối / đứng hình: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.90,
            status: 'approved',
          });
        }

        // 2e. Shocked / Surprise reaction
        if (/\b(sốc|shock|trời ơi|kinh ngạc|wow|không thể tin|kinh dị|hoảng hốt)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_shock_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.1)),
            type: 'surprise',
            evidence: `Phản ứng bất ngờ / kinh ngạc: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.88,
            status: 'approved',
          });
        }

        // 2f. Rizz / Flirt
        if (/\b(tán|tán gái|thính|rizz|flirt|cua gái|thả thính|ngầu lòi)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_rizz_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.1)),
            type: 'reaction',
            evidence: `Tình huống tán tỉnh / rizz: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.88,
            status: 'approved',
          });
        }

        // 2g. Running away / Chase
        if (/\b(chạy|chuồn|trốn|đuổi theo|chạy trốn|escape|rượt đuổi|chạy ngay đi)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_chase_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.15)),
            type: 'chase',
            evidence: `Tình huống rượt đuổi / tháo chạy: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.88,
            status: 'approved',
          });
        }

        // 2h. Reveal / Idea
        if (/\b(nhận ra|bí mật|ý tưởng|thì ra|hóa ra|bật mí|eureka|phát hiện ra)\b/i.test(text)) {
          rawMoments.push({
            id: `moment_reveal_${momentSeq++}`,
            timestamp: Math.max(0.2, Math.min(clipDuration - 0.2, seg.relStart + 0.1)),
            type: 'reveal',
            evidence: `Khoảnh khắc phát hiện / bật mí ý tưởng: "${seg.text.trim()}" (tại ${seg.relStart.toFixed(1)}s)`,
            confidence: 0.86,
            status: 'approved',
          });
        }

        // 2i. Awkward Fail (bruh): placed after speech end in the pause
        if (/\b(fail|thất bại|toang|hỏng rồi|quê|ngượng|lost|chán thật|bó tay|thua rồi|xong đời|mất rồi)\b/i.test(text)) {
          // If there is an explicit silence interval starting near or after seg.relEnd, align with silence
          const matchingSilence = allSilences?.find(
            (s) => (s.start - candidate.start) >= seg.relEnd - 0.2 && (s.start - candidate.start) <= seg.relEnd + 1.2
          );
          const pauseTimestamp = matchingSilence
            ? Math.round((matchingSilence.start - candidate.start + 0.1) * 10) / 10
            : Math.min(clipDuration - 0.2, Math.round((seg.relEnd + 0.1) * 10) / 10);

          rawMoments.push({
            id: `moment_fail_${momentSeq++}`,
            timestamp: pauseTimestamp,
            type: 'fail',
            evidence: `Lời thoại thất bại/ngượng ngùng "${seg.text.trim()}" kết thúc tại ${seg.relEnd.toFixed(1)}s, theo sau là khoảng dừng`,
            confidence: 0.90,
            status: 'approved',
          });
        }
      }
    }

    // 3. Integrate detected beats (e.g. surprise, reveal, punchline, pause)
    for (const b of detectedBeats) {
      if (b.type === 'hook') continue;
      if (b.type === 'fail' && rawMoments.some((m) => m.type === 'fail')) continue;
      const hasNearby = rawMoments.some((m) => Math.abs(m.timestamp - b.timestamp) < 0.6);
      if (!hasNearby) {
        rawMoments.push({
          id: `moment_beat_${b.id || momentSeq++}`,
          timestamp: b.timestamp,
          type: b.type,
          evidence: `Nhịp ${b.type} từ bộ dò beat: ${b.reason}`,
          confidence: Math.max(0.70, b.confidence),
          status: 'approved',
        });
      }
    }

    // 4. Dramatic silence intervals
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
        const hasNearby = rawMoments.some((m) => Math.abs(m.timestamp - sil.relEnd) < 1.0);
        if (!hasNearby) {
          rawMoments.push({
            id: `moment_sil_${momentSeq++}`,
            timestamp: Math.round(sil.relEnd * 10) / 10,
            type: 'pause',
            evidence: `Khoảng lặng kịch tính ${sil.dur.toFixed(1)}s trước câu nói tiếp theo`,
            confidence: 0.75,
            status: 'approved',
          });
        }
      }
    }

    // Sort chronologically and deduplicate moments too close together (< 0.4s)
    rawMoments.sort((a, b) => a.timestamp - b.timestamp);
    const deduplicated: MomentCandidate[] = [];
    for (const m of rawMoments) {
      const tooClose = deduplicated.find((prev) => Math.abs(prev.timestamp - m.timestamp) < 0.4);
      if (!tooClose) {
        deduplicated.push(m);
      } else if (m.confidence > tooClose.confidence) {
        // Replace with higher confidence moment
        const idx = deduplicated.indexOf(tooClose);
        deduplicated[idx] = m;
      }
    }

    return deduplicated;
  }

  /**
   * AI Sound Selector: Match and score the best SFX from the entire available library
   * (bundled + repo + imported) based on moment evidence, tags, duration, and pacing.
   * If no asset meets the confidence threshold, returns asset: null without fallback.
   */
  matchBestSfxForMoment(
    moment: MomentCandidate,
    availableSfx: AssetItem[],
    recentAssigned: Array<{ assetId: string; timestamp: number }> = []
  ): {
    asset: AssetItem | null;
    reason: string;
    confidence: number;
    topChoices: SfxChoice[];
  } | null {
    if (!availableSfx || availableSfx.length === 0) return null;

    const scoredChoices: SfxChoice[] = [];

    for (const asset of availableSfx) {
      let score = 0;
      const tags = (asset.tags || []).map((t) => t.toLowerCase());
      const cat = (asset.category || '').toLowerCase();
      const assetName = asset.name.toLowerCase();
      const filename = (asset.originalFilename || '').toLowerCase();

      let matchReason = '';

      // Category & Tag Affinity
      switch (moment.type) {
        case 'money':
          if (cat === 'money' || tags.some((t) => ['money', 'cash', 'reward'].includes(t)) || /money|cash/i.test(assetName) || /money/i.test(filename)) {
            score += 90;
            matchReason = 'Phù hợp ngữ cảnh tiền bạc / tài chính';
          }
          break;
        case 'slip':
          if (tags.some((t) => ['slip', 'fall'].includes(t)) || /slip/i.test(assetName) || /slip/i.test(filename)) {
            score += 90;
            matchReason = 'Phù hợp hành động trượt ngã / vấp';
          } else if (cat === 'comedy') {
            score += 35;
            matchReason = 'Nhóm âm thanh hài hước';
          }
          break;
        case 'impact':
          if (/bonk/i.test(moment.evidence) || /gõ đầu|đập/i.test(moment.evidence)) {
            if (/bonk/i.test(assetName) || /bonk/i.test(filename) || tags.includes('bonk')) {
              score += 95;
              matchReason = 'Âm thanh gõ / va chạm dạng bonk';
            } else if (tags.some((t) => ['punch', 'impact', 'hit'].includes(t))) {
              score += 75;
              matchReason = 'Tác động va chạm vật lý';
            }
          } else if (/punch|đấm/i.test(moment.evidence)) {
            if (/punch/i.test(assetName) || /punch/i.test(filename) || tags.includes('punch')) {
              score += 95;
              matchReason = 'Cú đấm gaming / tác động mạnh';
            } else if (tags.some((t) => ['bonk', 'impact', 'hit', 'boom'].includes(t))) {
              score += 75;
              matchReason = 'Tác động va chạm vật lý';
            }
          } else {
            if (tags.some((t) => ['punch', 'bonk', 'impact', 'hit', 'boom'].includes(t)) || /punch|bonk|boom/i.test(assetName)) {
              score += 85;
              matchReason = 'Tác động va chạm / âm thanh nhấn';
            }
          }
          break;
        case 'fail':
          if (/kết nối|disconnect|loading|lag|đơ|mất mạng/i.test(moment.evidence)) {
            if (tags.some((t) => ['disconnect', 'glitch', 'fail', 'loading'].includes(t)) || /connection|lost|loading/i.test(assetName) || /loading|connection/i.test(filename)) {
              score += 95;
              matchReason = 'Âm thanh lỗi kết nối / đứng hình / glitch';
            }
          } else {
            if (tags.some((t) => ['awkward', 'fail', 'bruh'].includes(t)) || /bruh/i.test(assetName) || /bruh/i.test(filename)) {
              score += 90;
              matchReason = 'Phù hợp tình huống ngượng ngùng / fail (bruh)';
            } else if (cat === 'reaction') {
              score += 30;
              matchReason = 'Âm thanh phản ứng';
            }
          }
          break;
        case 'surprise':
          if (/sốc|shock/i.test(moment.evidence)) {
            if (/shock/i.test(assetName) || /shock/i.test(filename) || tags.includes('shock')) {
              score += 95;
              matchReason = 'Âm thanh thể hiện sự kinh ngạc / sốc';
            } else if (tags.some((t) => ['boom', 'bass'].includes(t))) {
              score += 85;
              matchReason = 'Bass drop tạo cảm giác bất ngờ';
            }
          } else {
            if (tags.some((t) => ['shock', 'surprise', 'boom', 'bass'].includes(t)) || /shocked|vine_boom|boom/i.test(assetName)) {
              score += 85;
              matchReason = 'Phù hợp nhịp bất ngờ / kịch tính';
            }
          }
          break;
        case 'reaction':
          if (/rizz|thính|tán/i.test(moment.evidence)) {
            if (tags.some((t) => ['rizz', 'flirt'].includes(t)) || /rizz/i.test(assetName) || /rizz/i.test(filename)) {
              score += 95;
              matchReason = 'Nhạc nền tán tỉnh / rizz hài hước';
            }
          } else if (cat === 'reaction') {
            score += 60;
            matchReason = 'Âm thanh biểu cảm phản ứng';
          }
          break;
        case 'chase':
        case 'comedy':
          if (/rượt đuổi|chạy|escape|running/i.test(moment.evidence) || moment.type === 'chase') {
            if (tags.some((t) => ['escape', 'chase', 'running'].includes(t)) || /running/i.test(assetName) || /running/i.test(filename)) {
              score += 95;
              matchReason = 'Âm thanh rượt đuổi / bỏ chạy vui nhộn';
            }
          } else if (cat === 'comedy' || cat === 'chase') {
            score += 50;
            matchReason = 'Nhóm âm thanh hài hước';
          }
          break;
        case 'reveal':
          if (tags.some((t) => ['reveal', 'idea', 'ding', 'ting', 'bell'].includes(t)) || /ding|bell|ting/i.test(assetName) || /ding/i.test(filename)) {
            score += 90;
            matchReason = 'Chuông báo bật mí ý tưởng / khoảnh khắc thành công';
          }
          break;
        case 'hook':
          if (tags.some((t) => ['whoosh', 'transition', 'hook'].includes(t)) || /whoosh/i.test(assetName) || /whoosh/i.test(filename)) {
            score += 85;
            matchReason = 'Âm thanh lướt / chuyển cảnh mở đầu cuốn hút';
          } else if (tags.includes('pop')) {
            score += 65;
            matchReason = 'Âm thanh pop xuất hiện';
          }
          break;
        case 'pause':
          if (tags.some((t) => ['pause', 'awkward', 'ting', 'reveal'].includes(t))) {
            score += 50;
            matchReason = 'Âm thanh điểm xuyết khoảng lặng';
          }
          break;
      }

      // Recency penalty: penalize identical sound within 2.5s
      const tooRecent = recentAssigned.some(
        (r) => r.assetId === asset.id && Math.abs(r.timestamp - moment.timestamp) < 2.5
      );
      if (tooRecent) {
        score -= 50;
      }

      // Review status modifier: unreviewed assets get small penalty for auto-selection
      if (asset.reviewStatus === 'needs_review') {
        score -= 5;
      }

      if (score > 20) {
        scoredChoices.push({
          asset,
          score,
          reason: matchReason || `Phù hợp với nhịp ${moment.type}`,
        });
      }
    }

    // Sort by score descending
    scoredChoices.sort((a, b) => b.score - a.score);
    const topChoices = scoredChoices.slice(0, 3);

    // THRESHOLD CHECK: If no candidate achieves score >= 40, DO NOT FALLBACK to availableSfx[0]!
    if (topChoices.length === 0 || topChoices[0].score < 40) {
      return {
        asset: null,
        reason: 'Không có SFX phù hợp với ngữ cảnh này trong thư viện (Cần duyệt / Chọn thủ công)',
        confidence: 0.50,
        topChoices,
      };
    }

    const bestChoice = topChoices[0];
    const calculatedConfidence = Math.min(
      0.98,
      Math.max(0.60, moment.confidence + (bestChoice.score > 70 ? 0.05 : -0.05))
    );
    const reason = `Đề xuất "${bestChoice.asset.name}" ở ${moment.timestamp.toFixed(1)}s vì ${moment.evidence} (${bestChoice.reason})`;

    return {
      asset: bestChoice.asset,
      reason,
      confidence: Math.round(calculatedConfidence * 100) / 100,
      topChoices,
    };
  }

  /**
   * Generate both multi-SFX timeline events and detailed moment candidates for review
   */
  private generateSfxAndMoments(
    candidate: ClipCandidate,
    settings: JobSettings,
    detectedBeats: DetectedBeat[],
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[]
  ): { sfxEvents: PlannedSfxEvent[]; suggestedMoments: MomentCandidate[] } {
    const clipDuration = candidate.duration;
    const availableSfx = this.assetProvider.getAllAssetsSync('sfx');
    const detectedMoments = this.detectMoments(candidate, allSegments, allSilences, detectedBeats);

    const suggestedMoments: MomentCandidate[] = [];
    const rawSfxEvents: PlannedSfxEvent[] = [];
    const assignedHistory: Array<{ assetId: string; timestamp: number }> = [];

    let seq = 1;
    for (const moment of detectedMoments) {
      const match = this.matchBestSfxForMoment(moment, availableSfx, assignedHistory);
      if (match) {
        const enrichedMoment: MomentCandidate = {
          ...moment,
          suggestedSfx: match.asset || undefined,
          reason: match.reason,
          confidence: match.confidence,
          topChoices: match.topChoices,
        };
        suggestedMoments.push(enrichedMoment);

        // Convert high-confidence moments into active sfxEvents ONLY if asset is not null!
        if (enrichedMoment.suggestedSfx && enrichedMoment.confidence >= 0.70 && enrichedMoment.status !== 'rejected') {
          const trig = Math.max(0, Math.min(clipDuration - 0.1, Math.round(enrichedMoment.timestamp * 10) / 10));

          let vol = 0.85;
          const cat = enrichedMoment.suggestedSfx?.category;
          if (cat === 'impact') vol = 0.90;
          else if (cat === 'money' || cat === 'reveal') vol = 0.85;
          else if (cat === 'transition') vol = 0.80;

          rawSfxEvents.push({
            id: `sfx_${Date.now()}_${seq++}`,
            asset: enrichedMoment.suggestedSfx,
            triggerAt: trig,
            volume: vol,
            fadeIn: 0.05,
            fadeOut: 0.25,
            enabled: true,
            origin: 'auto',
            reason: enrichedMoment.reason,
          });

          assignedHistory.push({ assetId: enrichedMoment.suggestedSfx.id, timestamp: trig });
        }
      }
    }

    // Support double-SFX around strong surprise beats (pre-cue whoosh 0.35s before impact) ONLY if whoosh exists
    for (const b of detectedBeats) {
      if (b.type === 'surprise' && b.confidence >= 0.82 && b.timestamp >= 0.7) {
        const preCueTime = Math.round((b.timestamp - 0.35) * 10) / 10;
        const alreadyHasPreCue = rawSfxEvents.some((e) => Math.abs(e.triggerAt - preCueTime) < 0.25);
        if (!alreadyHasPreCue) {
          const whooshAsset = availableSfx.find(
            (a) => (a.tags || []).includes('whoosh') || /whoosh/i.test(a.name) || /whoosh/i.test(a.originalFilename || '')
          );
          if (whooshAsset) {
            rawSfxEvents.push({
              id: `sfx_precue_${Date.now()}_${seq++}`,
              asset: whooshAsset,
              triggerAt: preCueTime,
              volume: 0.60,
              fadeIn: 0.04,
              fadeOut: 0.15,
              enabled: true,
              sourceBeatId: b.id,
              origin: 'auto',
              reason: 'Âm thanh chuyển động lướt trước phản ứng bất ngờ',
            });
          }
        }
      }
    }

    // Sort and deduplicate identical sounds too close
    rawSfxEvents.sort((a, b) => a.triggerAt - b.triggerAt);
    const finalEvents: PlannedSfxEvent[] = [];
    for (const evt of rawSfxEvents) {
      const duplicateTooClose = finalEvents.some(
        (prev) => prev.asset.id === evt.asset.id && Math.abs(prev.triggerAt - evt.triggerAt) < 2.0
      );
      if (!duplicateTooClose) {
        finalEvents.push(evt);
      }
    }

    return {
      sfxEvents: finalEvents,
      suggestedMoments,
    };
  }

  /**
   * Rescan SFX proposals for a specific candidate using the latest SFX catalog.
   * Preserves all user manual/modified sfxEvents, updates unconfirmed auto suggestions.
   */
  rescanCandidateSfx(
    candidate: ClipCandidate,
    settings: JobSettings,
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[],
    existingPlan?: ClipAssetPlan
  ): ClipAssetPlan {
    const clipDuration = candidate.duration;
    const detected = this.beatDetector.detectBeats(
      candidate.start,
      candidate.end,
      allSegments,
      allSilences
    );

    const basePlan = existingPlan || candidate.assetPlan;
    const musicTrack =
      basePlan?.musicTrack ??
      (settings.bgm ? this.trendCatalog.resolveMusicForPreset(settings.preset).track : null);
    const duckingSettings = basePlan?.duckingSettings ?? {
      normalVolume: settings.preset === 'reaction' ? 0.22 : 0.16,
      duckedVolume: settings.preset === 'reaction' ? 0.06 : 0.04,
      fadeInDuration: 0.5,
      fadeOutDuration: 1.0,
    };

    // Re-detect moments and match against latest SFX catalog
    const { sfxEvents: newAutoEvents, suggestedMoments } = this.generateSfxAndMoments(
      candidate,
      settings,
      detected,
      allSegments,
      allSilences
    );

    // CRITICAL: Preserve manual/modified SFX events from user
    const existingEvents = basePlan?.sfxEvents || [];
    const manualEvents = existingEvents.filter((e) => e.origin === 'manual');

    // Combine manual events and newly rescanned auto events
    // Prevent auto events from clashing closely (< 0.3s) with manual events
    const nonClashingAutoEvents = newAutoEvents.filter(
      (autoEvt) => !manualEvents.some((man) => Math.abs(man.triggerAt - autoEvt.triggerAt) < 0.3)
    );

    const mergedSfxEvents = [...manualEvents, ...nonClashingAutoEvents].sort((a, b) => a.triggerAt - b.triggerAt);

    // Update beats
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

    return {
      clipId: candidate.id,
      musicTrack,
      beats,
      sfxEvents: mergedSfxEvents,
      suggestedMoments,
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

