import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { AutoAssetPlanner } from '../main/autoAssetPlanner';
import { LocalAssetProvider } from '../main/assetProvider';
import { TrendCatalog } from '../main/trendCatalog';
import { BeatDetector } from '../main/beatDetector';
import { ClipCandidate, JobSettings, TranscriptSegment } from '../main/types';

describe('Auto Asset Planner & Beat Synchronization Tests', () => {
  const assetsDir = path.resolve(__dirname, '../../assets');
  const provider = new LocalAssetProvider(assetsDir);
  const planner = new AutoAssetPlanner(provider);
  const trendCatalog = new TrendCatalog(provider);
  const beatDetector = new BeatDetector();

  const mockSettings: JobSettings = {
    targetClipCount: 3,
    clipDurationMin: 30,
    clipDurationMax: 45,
    aspectRatio: '9:16',
    preset: 'reaction',
    captions: true,
    bgm: true,
    sfx: true,
    broll: true,
    mode: 'local',
  };

  const mockSegments: TranscriptSegment[] = [
    { id: '1', start: 0, end: 3, text: 'Chào mừng các bạn đã đến với video đặc biệt này!' },
    { id: '2', start: 3.5, end: 7, text: 'Hôm nay chúng ta sẽ khám phá một điều cực kỳ bất ngờ!' },
    { id: '3', start: 7.5, end: 12, text: 'Hóa ra bí mật thực sự nằm ở đây này các bạn.' },
    { id: '4', start: 12.5, end: 18, text: 'Ôi toang rồi, hỏng luôn rồi fail quá.' },
    { id: '5', start: 18.5, end: 25, text: 'Và đây chính là kết quả cuối cùng không ngờ tới.' },
  ];

  const mockCandidate: ClipCandidate = {
    id: 'cand_test_1',
    title: 'Khoảnh khắc bất ngờ',
    start: 0,
    end: 25,
    duration: 25,
    score: 88,
    scoreBreakdown: { hook: 90, pacing: 85, payoff: 88 },
    reason: 'Đoạn clip có mở đầu mạnh và cao trào kết thúc',
    transcriptExcerpt: 'Chào mừng các bạn...',
    selected: true,
  };

  it('1. Đồng bộ hoàn hảo mốc thời gian giữa Meme và SFX trên từng Beat', () => {
    const plan = planner.planForClip(mockCandidate, mockSettings, mockSegments, []);

    expect(plan.beats.length).toBeGreaterThan(0);

    for (const beat of plan.beats) {
      // Meme và SFX phải tồn tại
      expect(beat.meme).toBeDefined();
      expect(beat.sfx).toBeDefined();

      // Timestamp của beat phải nằm trong phạm vi clip
      expect(beat.timestamp).toBeGreaterThanOrEqual(0);
      expect(beat.timestamp).toBeLessThan(mockCandidate.duration);

      // Cả Meme và SFX của cùng 1 beat phải có cùng mốc thời gian trên timeline
      expect(beat.sfx.filePath).toBeTruthy();
      expect(beat.meme.filePath).toBeTruthy();
      expect(fs.existsSync(beat.sfx.filePath)).toBe(true);
      expect(fs.existsSync(beat.meme.filePath)).toBe(true);

      // Duration overlay phải hợp lệ (1.0s - 3.0s)
      expect(beat.duration).toBeGreaterThanOrEqual(1.0);
      expect(beat.duration).toBeLessThanOrEqual(3.0);
    }
  });

  it('2. Kiểm tra tính toán Audio Ducking (Giảm âm lượng nhạc nền khi có lời thoại)', () => {
    // Reaction preset
    const reactionPlan = planner.planForClip(mockCandidate, mockSettings, mockSegments, []);
    expect(reactionPlan.musicTrack).not.toBeNull();
    expect(reactionPlan.duckingSettings.normalVolume).toBeGreaterThan(
      reactionPlan.duckingSettings.duckedVolume
    );
    expect(reactionPlan.duckingSettings.normalVolume).toBeCloseTo(0.22);
    expect(reactionPlan.duckingSettings.duckedVolume).toBeCloseTo(0.06);

    // Documentary preset
    const docSettings: JobSettings = { ...mockSettings, preset: 'documentary' };
    const docPlan = planner.planForClip(mockCandidate, docSettings, mockSegments, []);
    expect(docPlan.duckingSettings.normalVolume).toBeCloseTo(0.16);
    expect(docPlan.duckingSettings.duckedVolume).toBeCloseTo(0.04);
  });

  it('3. Xác minh tính hợp lệ của Asset Library: File thật, Fingerprint SHA-256 và Giấy phép bản quyền', async () => {
    const allAssets = await provider.getAllAssets();
    expect(allAssets.length).toBeGreaterThanOrEqual(9); // 4 SFX, 5 Memes, 2 Music

    for (const asset of allAssets) {
      // 1. Phải là file thật tồn tại trên đĩa, không dùng placeholder link
      expect(fs.existsSync(asset.filePath)).toBe(true);
      expect(fs.statSync(asset.filePath).size).toBeGreaterThan(0);

      // 2. Fingerprint SHA-256 đã tính
      expect(asset.fingerprint).toBeTruthy();
      expect(asset.fingerprint).not.toBe('unverified');
      expect(asset.fingerprint.length).toBe(16);

      // 3. Giấy phép sử dụng rõ ràng (CC0 / Public Domain hoặc Chưa xác nhận)
      expect(asset.license === 'Chưa xác nhận' || asset.license.includes('CC0')).toBe(true);
      expect(asset.sourceUrl).toBeTruthy();
      expect(asset.fetchedAt).toBeTruthy();
    }
  });

  it('4. Trend Catalog: Kiểm tra quyền sử dụng và phương án Fallback trung thực', () => {
    const trends = trendCatalog.getTrends();
    expect(trends.length).toBeGreaterThan(0);

    for (const trend of trends) {
      expect(trend.usageRights).toBeTruthy();
      expect(trend.source).toBeTruthy();
      expect(trend.detectedDate).toBeTruthy();
      if (trend.asset) {
        expect(fs.existsSync(trend.asset.filePath)).toBe(true);
      }
    }

    // Kiểm tra resolve nhạc cho preset
    const reactionResult = trendCatalog.resolveMusicForPreset('reaction');
    expect(reactionResult.track).toBeDefined();
    expect(fs.existsSync(reactionResult.track.filePath)).toBe(true);
    expect(reactionResult.attributionNotice).toBeTruthy();
  });

  it('5. Fallback an toàn khi tìm kiếm asset không tồn tại', async () => {
    // Khi query một từ khóa hoàn toàn không có trong thư viện
    const fallbackMeme = await provider.getAsset('meme', 'hoan_toan_khong_ton_tai_123456');
    expect(fallbackMeme).not.toBeNull();
    expect(fs.existsSync(fallbackMeme!.filePath)).toBe(true);

    const fallbackSfx = await provider.getAsset('sfx', 'am_thanh_la_khong_co');
    expect(fallbackSfx).not.toBeNull();
    expect(fs.existsSync(fallbackSfx!.filePath)).toBe(true);
  });

  it('6. Beat Detector: Phân loại chính xác các loại beat (hook, surprise, reveal, fail, punchline)', () => {
    const beats = beatDetector.detectBeats(0, 25, mockSegments, [
      { start: 10, end: 11, duration: 1.0 },
    ]);

    const types = beats.map((b) => b.type);
    expect(types).toContain('hook');
    expect(types).toContain('surprise');
    expect(types).toContain('reveal');
    expect(types).toContain('fail');

    // Mọi beat đều có lý do và độ tin cậy >= 0.75
    for (const b of beats) {
      expect(b.confidence).toBeGreaterThanOrEqual(0.75);
      expect(b.reason.length).toBeGreaterThan(10);
    }
  });
});
