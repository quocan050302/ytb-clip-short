import { BeatType, TranscriptSegment } from './types';
import { SilenceInterval } from './videoAnalyzer';

export interface DetectedBeat {
  id: string;
  type: BeatType;
  timestamp: number;    // seconds relative to clip start
  duration: number;     // overlay display duration (e.g. 1.5s)
  confidence: number;   // 0.0 - 1.0
  reason: string;
}

export class BeatDetector {
  /**
   * Detect semantic and acoustic beats within a clip candidate's timeframe
   */
  detectBeats(
    clipStart: number,
    clipEnd: number,
    allSegments: TranscriptSegment[],
    allSilences: SilenceInterval[]
  ): DetectedBeat[] {
    const clipDuration = clipEnd - clipStart;
    const beats: DetectedBeat[] = [];

    // Filter segments and silences in this clip's time window
    const segments = allSegments
      .filter((s) => s.end > clipStart && s.start < clipEnd)
      .map((s) => ({
        ...s,
        relStart: Math.max(0, s.start - clipStart),
        relEnd: Math.min(clipDuration, s.end - clipStart),
      }));

    const silences = allSilences
      .filter((s) => s.end > clipStart && s.start < clipEnd)
      .map((s) => ({
        ...s,
        relStart: Math.max(0, s.start - clipStart),
        relEnd: Math.min(clipDuration, s.end - clipStart),
      }));

    // 1. BEAT: HOOK (Always place an energetic hook beat in the opening 1.0 - 2.5s)
    beats.push({
      id: `beat_hook_${Math.round(clipStart)}`,
      type: 'hook',
      timestamp: 1.0,
      duration: 1.6,
      confidence: 0.95,
      reason: 'Nhịp mở đầu: kích hoạt sự chú ý của người xem trong 3 giây đầu tiên.',
    });

    // 2. SCAN TRANSCRIPT & SILENCE FOR SURPRISE, REVEAL, FAIL, PAUSE
    for (const seg of segments) {
      // Never use placeholder segments for semantic beats
      if (seg.isPlaceholder || /^\[Đoạn nói \d+\]/i.test(seg.text)) continue;

      // Avoid beats too close to the start (< 2.0s) or end (> duration - 2.5s)
      if (seg.relStart < 2.0 || seg.relStart > clipDuration - 2.5) continue;

      const text = seg.text.toLowerCase();

      // SURPRISE BEAT
      if (
        text.includes('!') ||
        text.includes('what') ||
        text.includes('omg') ||
        text.includes('bất ngờ') ||
        text.includes('không thể tin') ||
        text.includes('kinh khủng') ||
        text.includes('trời ơi') ||
        text.includes('ghê vậy')
      ) {
        if (!beats.some((b) => Math.abs(b.timestamp - seg.relStart) < 2.0)) {
          beats.push({
            id: `beat_surprise_${Math.round(seg.relStart)}`,
            type: 'surprise',
            timestamp: Math.round(seg.relStart * 10) / 10,
            duration: 1.5,
            confidence: 0.88,
            reason: `Khoảnh khắc bất ngờ phát hiện từ lời thoại: "${seg.text.substring(0, 40)}"`,
          });
        }
      }

      // REVEAL BEAT
      else if (
        text.includes('bí mật') ||
        text.includes('hóa ra') ||
        text.includes('thực ra') ||
        text.includes('lý do là') ||
        text.includes('nguyên nhân') ||
        text.includes('secret') ||
        text.includes('actually') ||
        text.includes('nhìn này')
      ) {
        if (!beats.some((b) => Math.abs(b.timestamp - seg.relStart) < 2.0)) {
          beats.push({
            id: `beat_reveal_${Math.round(seg.relStart)}`,
            type: 'reveal',
            timestamp: Math.round(seg.relStart * 10) / 10,
            duration: 1.6,
            confidence: 0.85,
            reason: `Khoảnh khắc tiết lộ thông tin / bước ngoặt: "${seg.text.substring(0, 40)}"`,
          });
        }
      }

      // FAIL BEAT (placed after speech ends in pause to avoid speech overlap)
      else if (
        text.includes('thất bại') ||
        text.includes('sai lầm') ||
        text.includes('hỏng') ||
        text.includes('toang') ||
        text.includes('oops') ||
        text.includes('fail') ||
        text.includes('nhầm')
      ) {
        const failTimestamp = Math.min(clipDuration - 0.2, Math.round((seg.relEnd + 0.1) * 10) / 10);
        if (!beats.some((b) => Math.abs(b.timestamp - failTimestamp) < 2.0)) {
          beats.push({
            id: `beat_fail_${Math.round(seg.relStart)}`,
            type: 'fail',
            timestamp: failTimestamp,
            duration: 1.4,
            confidence: 0.84,
            reason: `Tình huống ngượng ngùng / sự cố hài hước kết thúc câu: "${seg.text.substring(0, 40)}"`,
          });
        }
      }
    }

    // 3. SCAN FOR DRAMATIC PAUSE (> 0.8s silence)
    for (const sil of silences) {
      if (sil.duration >= 0.8 && sil.relStart > 3.0 && sil.relStart < clipDuration - 3.0) {
        if (!beats.some((b) => Math.abs(b.timestamp - sil.relStart) < 2.0)) {
          beats.push({
            id: `beat_pause_${Math.round(sil.relStart)}`,
            type: 'pause',
            timestamp: Math.round((sil.relStart + 0.1) * 10) / 10,
            duration: 1.2,
            confidence: 0.80,
            reason: `Khoảng lặng kịch tính (${sil.duration.toFixed(1)}s im lặng trước khi vào nhịp mới).`,
          });
        }
      }
    }

    // 4. BEAT: PUNCHLINE (Closing climax at 80-90% duration)
    const punchlineTime = Math.max(4.0, clipDuration - 3.5);
    if (!beats.some((b) => Math.abs(b.timestamp - punchlineTime) < 2.0)) {
      beats.push({
        id: `beat_punch_${Math.round(punchlineTime)}`,
        type: 'punchline',
        timestamp: Math.round(punchlineTime * 10) / 10,
        duration: 1.8,
        confidence: 0.90,
        reason: 'Đoạn kết cao trào (Payoff Climax): kết thúc ấn tượng để người xem lưu lại.',
      });
    }

    // Sort chronologically and limit max 6 beats per clip to prevent visual noise
    beats.sort((a, b) => a.timestamp - b.timestamp);
    return beats.slice(0, 6);
  }
}
