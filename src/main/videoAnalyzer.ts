import { runSpawn } from './util';
import { ClipCandidate, JobSettings, TranscriptSegment } from './types';
import { ScoredCandidateDraft, StandardScoringModule } from './scoringModule';

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

export class VideoAnalyzer {
  private scoringModule = new StandardScoringModule();

  /**
   * Run ffmpeg silencedetect to find pauses and speech boundaries
   */
  async detectSilence(videoPath: string): Promise<SilenceInterval[]> {
    const silences: SilenceInterval[] = [];
    let currentStart: number | null = null;

    try {
      const { promise } = runSpawn('ffmpeg', [
        '-i', videoPath,
        '-af', 'silencedetect=noise=-30dB:d=0.4',
        '-f', 'null',
        '-'
      ]);

      const result = await promise;
      const lines = (result.stderr + '\n' + result.stdout).split('\n');

      for (const line of lines) {
        if (line.includes('silence_start:')) {
          const match = line.match(/silence_start:\s*([\d.]+)/);
          if (match) {
            currentStart = parseFloat(match[1]);
          }
        } else if (line.includes('silence_end:') && currentStart !== null) {
          const endMatch = line.match(/silence_end:\s*([\d.]+)/);
          const durMatch = line.match(/silence_duration:\s*([\d.]+)/);
          if (endMatch) {
            const end = parseFloat(endMatch[1]);
            const duration = durMatch ? parseFloat(durMatch[1]) : end - currentStart;
            silences.push({ start: currentStart, end, duration });
            currentStart = null;
          }
        }
      }
    } catch (err) {
      console.warn('Silence detection completed or fell back:', err);
    }

    return silences;
  }

  /**
   * Parse SRT subtitle text into TranscriptSegments with seconds timestamps
   */
  parseSrt(srtContent: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const blocks = srtContent.replace(/\r\n/g, '\n').split('\n\n');

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;
      const lines = block.split('\n');
      if (lines.length < 2) continue;

      let timeLineIdx = 1;
      if (lines[0].includes('-->')) {
        timeLineIdx = 0;
      }

      const timeLine = lines[timeLineIdx];
      const match = timeLine.match(
        /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
      );

      if (!match) continue;

      const start =
        parseInt(match[1]) * 3600 +
        parseInt(match[2]) * 60 +
        parseInt(match[3]) +
        parseInt(match[4]) / 1000;

      const end =
        parseInt(match[5]) * 3600 +
        parseInt(match[6]) * 60 +
        parseInt(match[7]) +
        parseInt(match[8]) / 1000;

      const text = lines.slice(timeLineIdx + 1).join(' ').trim();
      if (text) {
        segments.push({
          id: `seg_${i + 1}`,
          start: Math.round(start * 100) / 100,
          end: Math.round(end * 100) / 100,
          text,
        });
      }
    }

    return segments;
  }

  /**
   * Generate automatic speech segments from audio silence intervals
   * when no external transcript is uploaded.
   */
  generateSilenceBasedTranscript(
    totalDuration: number,
    silences: SilenceInterval[]
  ): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    let curTime = 0;

    for (let i = 0; i < silences.length; i++) {
      const s = silences[i];
      if (s.start > curTime + 0.5) {
        segments.push({
          id: `seg_${segments.length + 1}`,
          start: Math.round(curTime * 100) / 100,
          end: Math.round(s.start * 100) / 100,
          text: `[Đoạn nói ${segments.length + 1}] (${(s.start - curTime).toFixed(1)}s)`,
          isPlaceholder: true,
        });
      }
      curTime = s.end;
    }

    if (curTime < totalDuration - 0.5) {
      segments.push({
        id: `seg_${segments.length + 1}`,
        start: Math.round(curTime * 100) / 100,
        end: Math.round(totalDuration * 100) / 100,
        text: `[Đoạn nói ${segments.length + 1}] (${(totalDuration - curTime).toFixed(1)}s)`,
        isPlaceholder: true,
      });
    }

    return segments;
  }

  /**
   * Generate high-potential candidate clips for short-form video
   */
  generateCandidates(
    segments: TranscriptSegment[],
    silences: SilenceInterval[],
    totalDuration: number,
    settings: JobSettings
  ): ClipCandidate[] {
    const minDur = settings.clipDurationMin || 30;
    const maxDur = settings.clipDurationMax || 45;
    const targetCount = settings.targetClipCount || 5;

    const candidatePool: Array<{
      start: number;
      end: number;
      draft: ScoredCandidateDraft;
    }> = [];

    // If segments exist, align boundaries to segment starts/ends
    if (segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        const segStart = segments[i].start;
        // Search forward for a matching endpoint within [minDur, maxDur]
        for (let j = i; j < segments.length; j++) {
          const segEnd = segments[j].end;
          const dur = segEnd - segStart;

          if (dur >= minDur && dur <= maxDur) {
            const draft = this.scoringModule.evaluateCandidate(
              segStart,
              segEnd,
              segments,
              silences
            );
            candidatePool.push({ start: segStart, end: segEnd, draft });
          } else if (dur > maxDur) {
            break;
          }
        }
      }
    }

    // Fallback: If no transcript segments or pool is sparse, create window steps
    if (candidatePool.length < targetCount) {
      const step = Math.max(10, Math.floor(minDur / 2));
      for (let t = 0; t + minDur <= totalDuration; t += step) {
        const end = Math.min(totalDuration, t + Math.floor((minDur + maxDur) / 2));
        if (end - t >= minDur) {
          const draft = this.scoringModule.evaluateCandidate(
            t,
            end,
            segments,
            silences
          );
          candidatePool.push({ start: t, end, draft });
        }
      }
    }

    // Sort descending by score
    candidatePool.sort((a, b) => b.draft.score - a.draft.score);

    // Pick top candidates ensuring minimal overlap (at least 60% distinct)
    const selectedList: typeof candidatePool = [];

    for (const item of candidatePool) {
      if (selectedList.length >= targetCount) break;

      const overlaps = selectedList.some((existing) => {
        const overlapStart = Math.max(existing.start, item.start);
        const overlapEnd = Math.min(existing.end, item.end);
        const overlapDur = Math.max(0, overlapEnd - overlapStart);
        const minLen = Math.min(existing.end - existing.start, item.end - item.start);
        return overlapDur / minLen > 0.4; // More than 40% overlap is avoided
      });

      if (!overlaps) {
        selectedList.push(item);
      }
    }

    // If still need more, fill without strict non-overlap
    if (selectedList.length < targetCount) {
      for (const item of candidatePool) {
        if (selectedList.length >= targetCount) break;
        if (!selectedList.includes(item)) {
          selectedList.push(item);
        }
      }
    }

    // Sort selected chronologically for intuitive viewing
    selectedList.sort((a, b) => a.start - b.start);

    return selectedList.map((item, idx) => ({
      id: `cand_${Date.now()}_${idx + 1}`,
      title: `Clip đề xuất #${idx + 1} (${item.draft.duration.toFixed(0)}s)`,
      start: item.draft.start,
      end: item.draft.end,
      duration: item.draft.duration,
      score: item.draft.score,
      scoreBreakdown: item.draft.scoreBreakdown,
      reason: item.draft.reason,
      transcriptExcerpt: item.draft.transcriptExcerpt,
      selected: true,
    }));
  }
}
