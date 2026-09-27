import { ScoreBreakdown, TranscriptSegment } from './types';

export interface ScoredCandidateDraft {
  start: number;
  end: number;
  duration: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
  transcriptExcerpt: string;
}

export interface ScoringModuleInterface {
  evaluateCandidate(
    start: number,
    end: number,
    segments: TranscriptSegment[],
    silenceIntervals: Array<{ start: number; end: number }>
  ): ScoredCandidateDraft;
}

/**
 * Standard Heuristic Scoring Module for AutoClip Studio.
 * Analyzes audio/speech cadence, hook quality, body pacing, and payoff integrity.
 *
 * NOTE: Points are structural editing quality metrics, NOT guaranteed viewer predictions.
 */
export class StandardScoringModule implements ScoringModuleInterface {
  evaluateCandidate(
    start: number,
    end: number,
    allSegments: TranscriptSegment[],
    silenceIntervals: Array<{ start: number; end: number }>
  ): ScoredCandidateDraft {
    const duration = end - start;

    // Filter segments belonging to this candidate window
    const relevantSegments = allSegments.filter(
      (s) => s.end > start && s.start < end
    );

    // Filter silences in this window
    const silencesInWindow = silenceIntervals.filter(
      (s) => s.end > start && s.start < end
    );

    const realSegments = relevantSegments.filter(
      (s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text)
    );

    const fullText = realSegments.map((s) => s.text).join(' ').trim();
    const words = fullText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const wordsPerSecond = duration > 0 ? wordCount / duration : 0;

    // 1. EVALUATE HOOK (First 3-5 seconds)
    // Hook benefits from immediate speech, no dead air in first 2 seconds,
    // question mark or engaging introductory vocabulary.
    let hook = 65; // Base hook score
    const hookWindowEnd = start + Math.min(5, duration * 0.25);
    const initialDeadAir = silencesInWindow.find(
      (s) => s.start <= start + 0.5 && s.end >= start + 1.5
    );

    if (initialDeadAir) {
      hook -= 25; // Awkward delay at start
    } else {
      hook += 15; // Fast verbal kick-off
    }

    const firstSegment = realSegments[0];
    if (firstSegment && firstSegment.text) {
      const hookText = firstSegment.text.toLowerCase();
      if (
        hookText.includes('?') ||
        hookText.includes('sao') ||
        hookText.includes('tại sao') ||
        hookText.includes('làm thế nào') ||
        hookText.includes('bất ngờ') ||
        hookText.includes('bí mật') ||
        hookText.includes('nhìn này') ||
        hookText.includes('chú ý') ||
        hookText.includes('why') ||
        hookText.includes('how') ||
        hookText.includes('look')
      ) {
        hook += 15; // Engaging question or prompt
      }
    }
    hook = Math.max(10, Math.min(98, hook));

    // 2. EVALUATE PACING (Flow, word cadence, silence distribution)
    let pacing = 70;
    if (realSegments.length > 0) {
      // Ideal short-form speaking pace is 2.2 - 3.4 words per second
      if (wordsPerSecond >= 2.0 && wordsPerSecond <= 3.5) {
        pacing += 15;
      } else if (wordsPerSecond < 1.4) {
        pacing -= 20; // Too sluggish
      } else if (wordsPerSecond > 4.2) {
        pacing -= 15; // Too rushed
      }
    } else {
      // Cadence based purely on silence distribution
      const silenceCount = silencesInWindow.length;
      if (silenceCount >= 2 && silenceCount <= 6) {
        pacing += 10;
      }
    }

    // Heavy dead air penalty (> 2.0s silence)
    const longPauses = silencesInWindow.filter((s) => s.end - s.start > 1.8);
    pacing -= longPauses.length * 10;
    pacing = Math.max(15, Math.min(95, pacing));

    // 3. EVALUATE PAYOFF (Ending 3-6 seconds)
    let payoff = 65;
    const lastSegment = realSegments[realSegments.length - 1];
    if (lastSegment && lastSegment.text) {
      const lastText = lastSegment.text.trim();
      const endsWithPunctuation = /[.!?]$/.test(lastText);
      if (endsWithPunctuation) {
        payoff += 15; // Sentence concludes naturally
      } else {
        payoff -= 15; // Cut off mid-phrase
      }

      // Check if ends on a trailing hesitation
      const lowerLast = lastText.toLowerCase();
      if (
        lowerLast.endsWith(' và') ||
        lowerLast.endsWith(' nhưng') ||
        lowerLast.endsWith(' thì') ||
        lowerLast.endsWith(' là') ||
        lowerLast.endsWith(' and') ||
        lowerLast.endsWith(' but')
      ) {
        payoff -= 20;
      }
    }
    payoff = Math.max(10, Math.min(95, payoff));

    // Composite weighted score
    const compositeScore = Math.round(hook * 0.4 + pacing * 0.35 + payoff * 0.25);

    // Formulate honest reason
    const reasons: string[] = [];
    if (hook >= 75) {
      reasons.push('Mở đầu có năng lượng tốt, vào thẳng chủ đề');
    } else {
      reasons.push('Mở đầu có khoảng chờ hoặc tốc độ vừa phải');
    }

    if (realSegments.length > 0) {
      if (pacing >= 75) {
        reasons.push(`nhịp nói ổn định (${wordsPerSecond.toFixed(1)} từ/s)`);
      } else {
        reasons.push(`nhịp nói chưa tối ưu (${wordsPerSecond.toFixed(1)} từ/s)`);
      }
    } else {
      reasons.push('cắt theo nhịp năng lượng âm thanh và khoảng lặng');
    }

    if (payoff >= 75) {
      reasons.push('kết thúc trọn vẹn ngữ nghĩa câu');
    } else {
      reasons.push('đoạn kết cần rà soát lại điểm ngắt câu');
    }

    const reason = reasons.join(', ') + '.';

    // Excerpt preview (no placeholder text, truthful excerpt)
    const transcriptExcerpt =
      realSegments.length > 0
        ? (fullText.length > 120 ? fullText.substring(0, 117) + '...' : fullText)
        : '(Không có phụ đề - cắt theo nhịp âm thanh)';

    return {
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      duration: Math.round(duration * 100) / 100,
      score: compositeScore,
      scoreBreakdown: { hook, pacing, payoff },
      reason,
      transcriptExcerpt,
    };
  }
}
