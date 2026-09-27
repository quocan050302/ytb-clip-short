import { describe, expect, it } from 'vitest';
import { suggestShortsCopy } from '../main/shortsPackage';
import { ClipCandidate, TranscriptSegment } from '../main/types';

const candidate = { start: 10, end: 42, title: 'Clip đề xuất #1 (32s)' } as ClipCandidate;

describe('Shorts publishing package', () => {
  it('keeps title, thumbnail hook and person hashtags grounded in this clip', () => {
    const transcript: TranscriptSegment[] = [
      { id: 'prior', start: 0, end: 8, text: 'Duke Dennis was here' },
      { id: 'clip', start: 12, end: 16, text: 'Kai Cenat said no way when Fanum walked in!' },
    ];
    const result = suggestShortsCopy(candidate, transcript);
    expect(result.publishTitle).toContain('Kai Cenat & Fanum');
    expect(result.thumbnailHook).toBe('NO WAY');
    expect(result.hashtags).toContain('#Fanum');
    expect(result.hashtags).not.toContain('#DukeDennis');
  });

  it('does not invent streamer identities from a placeholder transcript', () => {
    const result = suggestShortsCopy(candidate, [
      { id: 'placeholder', start: 11, end: 15, text: '[Đoạn nói 1]', isPlaceholder: true },
    ]);
    expect(result.hashtags).toEqual(['#StreamerClips', '#Shorts']);
    expect(result.thumbnailHook).toBe('WATCH THIS');
  });
});
