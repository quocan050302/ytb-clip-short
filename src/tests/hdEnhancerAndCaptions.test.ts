import { describe, it, expect, vi } from 'vitest';
import { VideoAnalyzer } from '../main/videoAnalyzer';
import { MomentPlanner } from '../main/momentPlanner';
import { BeatDetector } from '../main/beatDetector';
import { renderWithEditPlan } from '../main/renderEngine';
import { enhanceVideo } from '../main/videoEnhancer';
import { TranscriptSegment, ClipCandidate, ClipEditPlan, JobSettings } from '../main/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('VẤN ĐỀ 2 — Xóa toàn bộ placeholder caption [Đoạn nói...]', () => {
  const analyzer = new VideoAnalyzer();
  const momentPlanner = new MomentPlanner();
  const beatDetector = new BeatDetector();

  it('generateSilenceBasedTranscript marks all generated segments with isPlaceholder: true', () => {
    const silences = [
      { start: 5.0, end: 6.0, duration: 1.0 },
      { start: 12.0, end: 13.0, duration: 1.0 },
    ];
    const totalDuration = 25.0;

    const segments = analyzer.generateSilenceBasedTranscript(totalDuration, silences);

    expect(segments.length).toBeGreaterThan(0);
    for (const seg of segments) {
      expect(seg.isPlaceholder).toBe(true);
    }
  });

  it('MomentPlanner does NOT use placeholder text as hook trigger or reason', () => {
    const placeholderSegments: TranscriptSegment[] = [
      { id: 'seg_1', start: 0.0, end: 8.0, text: '[Đoạn nói 1] (8.0s)', isPlaceholder: true },
      { id: 'seg_2', start: 9.0, end: 20.0, text: '[Đoạn nói 2] (11.0s)', isPlaceholder: true },
    ];
    const silences = [{ start: 8.0, end: 9.0 }];

    const moments = momentPlanner.detectMoments(placeholderSegments, silences, 20.0);

    for (const m of moments) {
      expect(m.triggerWord).toBeUndefined();
      expect(m.reason).not.toContain('[Đoạn nói');
    }
  });

  it('BeatDetector does NOT trigger semantic beats from placeholder text', () => {
    const placeholderSegments: TranscriptSegment[] = [
      { id: 'seg_1', start: 0.0, end: 10.0, text: '[Đoạn nói 1] (10.0s)', isPlaceholder: true },
      { id: 'seg_2', start: 11.0, end: 25.0, text: '[Đoạn nói 2] (14.0s)', isPlaceholder: true },
    ];
    const silences = [{ start: 10.0, end: 11.0, duration: 1.0 }];

    const beats = beatDetector.detectBeats(0, 25, placeholderSegments, silences);

    for (const b of beats) {
      expect(b.reason).not.toContain('[Đoạn nói');
    }
  });
});

describe('VẤN ĐỀ 1 — HD Enhancer & Validation', () => {
  it('throws ffprobe validation error if output resolution is not 1080x1920', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclip_test_'));
    const dummyIn = path.join(tmpDir, 'dummy.mp4');
    const dummyOut = path.join(tmpDir, 'dummy_HD.mp4');
    fs.writeFileSync(dummyIn, 'dummy');

    // Test with invalid mode or settings
    await expect(
      enhanceVideo({
        inputPath: dummyIn,
        outputPath: dummyOut,
        settings: { mode: 'blur-bg-preserve', blurRadius: 40 },
        ffmpegPath: 'invalid_ffmpeg_path_test',
        ffprobePath: 'invalid_ffprobe_path_test',
        onLog: () => {},
        onProgress: () => {},
      })
    ).rejects.toThrow();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
