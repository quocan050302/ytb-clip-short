import { describe, it, expect } from 'vitest';
import { StandardScoringModule } from '../main/scoringModule';
import { TranscriptSegment } from '../main/types';

describe('StandardScoringModule', () => {
  const scoring = new StandardScoringModule();

  it('assigns high hook score when initial segment starts immediately with engaging vocabulary', () => {
    const segments: TranscriptSegment[] = [
      { id: '1', start: 0.1, end: 3.5, text: 'Tại sao video ngắn này lại có thể đạt triệu view?' },
      { id: '2', start: 3.6, end: 15.0, text: 'Bí mật nằm ở chỗ chúng ta biết cách giữ chân khán giả ngay từ giây đầu tiên.' },
      { id: '3', start: 15.2, end: 30.0, text: 'Hãy áp dụng công thức này ngay hôm nay để thấy kết quả rõ rệt.' },
    ];
    const silences: Array<{ start: number; end: number }> = [];

    const result = scoring.evaluateCandidate(0, 30, segments, silences);

    expect(result.scoreBreakdown.hook).toBeGreaterThanOrEqual(80);
    expect(result.scoreBreakdown.payoff).toBeGreaterThanOrEqual(75);
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.reason).toContain('Mở đầu có năng lượng tốt');
    expect(result.reason).toContain('kết thúc trọn vẹn');
  });

  it('penalizes hook and pacing when there is long awkward dead air in the first 2 seconds', () => {
    const segments: TranscriptSegment[] = [
      { id: '1', start: 3.5, end: 15.0, text: 'À ừm... xin chào các bạn.' },
      { id: '2', start: 20.0, end: 32.0, text: 'Hôm nay chúng ta nói về việc...' },
    ];
    const silences: Array<{ start: number; end: number }> = [
      { start: 0.0, end: 3.2 },
      { start: 15.1, end: 19.9 },
    ];

    const result = scoring.evaluateCandidate(0, 32, segments, silences);

    // Initial dead air should heavily penalize hook
    expect(result.scoreBreakdown.hook).toBeLessThanOrEqual(60);
    // Long pauses should penalize pacing
    expect(result.scoreBreakdown.pacing).toBeLessThanOrEqual(65);
    expect(result.reason).toContain('Mở đầu có khoảng chờ');
  });

  it('penalizes payoff if the clip ends abruptly with a trailing conjunction', () => {
    const segments: TranscriptSegment[] = [
      { id: '1', start: 0.2, end: 10.0, text: 'Đây là điều quan trọng nhất bạn cần biết.' },
      { id: '2', start: 10.5, end: 28.0, text: 'Nếu bạn bỏ qua bước này thì chúng ta sẽ và' },
    ];
    const silences: Array<{ start: number; end: number }> = [];

    const result = scoring.evaluateCandidate(0, 28, segments, silences);

    expect(result.scoreBreakdown.payoff).toBeLessThanOrEqual(55);
    expect(result.reason).toContain('cần rà soát lại điểm ngắt');
  });

  it('does NOT use placeholder text in transcriptExcerpt or reasons when segments are generated from silence', () => {
    const segments: TranscriptSegment[] = [
      { id: 'seg_1', start: 0.0, end: 12.0, text: '[Đoạn nói 1] (12.0s)', isPlaceholder: true },
      { id: 'seg_2', start: 13.0, end: 30.0, text: '[Đoạn nói 2] (17.0s)', isPlaceholder: true },
    ];
    const silences = [{ start: 12.0, end: 13.0 }];

    const result = scoring.evaluateCandidate(0, 30, segments, silences);

    expect(result.transcriptExcerpt).not.toContain('[Đoạn nói');
    expect(result.transcriptExcerpt).toBe('(Không có phụ đề - cắt theo nhịp âm thanh)');
    expect(result.reason).not.toContain('[Đoạn nói');
  });
});
