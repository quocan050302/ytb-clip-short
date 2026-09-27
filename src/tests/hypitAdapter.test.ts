import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { HypitAdapter } from '../main/hypitAdapter';
import { runSpawn } from '../main/util';
import { ClipCandidate, JobSettings } from '../main/types';

describe('HypitAdapter & Child Process Safety', () => {
  let adapter: HypitAdapter;
  let tempDir: string;

  beforeEach(() => {
    adapter = new HypitAdapter();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypit_adapter_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('safely handles arguments containing spaces and Vietnamese Unicode characters without shell interpolation', async () => {
    // Tests runSpawn with echo
    const testArg = 'Đường dẫn có khoảng trắng và Tiếng Việt: /Thư mục video/Shorts 2026.mp4';
    const { promise } = runSpawn('echo', [testArg]);
    const res = await promise;

    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe(testArg);
  });

  it('supports child process cancellation without hanging or memory leaks', async () => {
    const startTime = Date.now();
    const { promise, cancel } = runSpawn('sleep', ['10']);

    // Cancel after 100ms
    setTimeout(() => {
      cancel();
    }, 100);

    const res = await promise;
    const elapsed = Date.now() - startTime;

    // Process was killed well before 10 seconds
    expect(elapsed).toBeLessThan(1000);
    expect(res.code).not.toBe(0);
  });

  it('generates valid Hypit project files (.svml, .svrun, .svs, hypit.runtime.json) matching engine specification', () => {
    const candidate: ClipCandidate = {
      id: 'cand_test',
      title: 'Khoảnh khắc ấn tượng & thú vị',
      start: 10,
      end: 45,
      duration: 35,
      score: 92,
      scoreBreakdown: { hook: 95, pacing: 90, payoff: 90 },
      reason: 'Đoạn nói hay',
      transcriptExcerpt: 'Đây là câu mở đầu...',
      selected: true,
    };

    const settings: JobSettings = {
      targetClipCount: 1,
      clipDurationMin: 30,
      clipDurationMax: 45,
      aspectRatio: '9:16',
      preset: 'reaction',
      captions: true,
      bgm: true,
      sfx: true,
      broll: false,
      mode: 'local',
    };

    const dummyCutPath = path.join(tempDir, 'aroll_test.mp4');
    fs.writeFileSync(dummyCutPath, 'sample binary');

    const projectDir = path.join(tempDir, 'hypit_proj_1');
    const { svmlPath, svrunPath, runtimePath } = adapter.generateProject(
      projectDir,
      candidate,
      settings,
      dummyCutPath,
      []
    );

    expect(fs.existsSync(svmlPath)).toBe(true);
    expect(fs.existsSync(svrunPath)).toBe(true);
    expect(fs.existsSync(runtimePath)).toBe(true);

    const svmlContent = fs.readFileSync(svmlPath, 'utf8');
    expect(svmlContent).toContain('<?svml using="@hypit/markup@1"?>');
    expect(svmlContent).toContain('<space:Canvas id="viewport" width="1080" height="1920"/>');
    expect(svmlContent).toContain('<render:Video id="final"');

    const svrunContent = fs.readFileSync(svrunPath, 'utf8');
    expect(svrunContent).toContain('<?svml using="@hypit/run-markup@1"?>');
    expect(svrunContent).toContain('<target output="final.video"/>');

    const runtimeContent = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    expect(runtimeContent.format).toBe('hypit.runtime-local@1');
    expect(runtimeContent.endpoints['media.local']).toBeDefined();
    expect(runtimeContent.endpoints['hyperframes.local']).toBeDefined();
    // Verify pure local mode has no paid hypihub endpoint
    expect(runtimeContent.endpoints['hypihub.default']).toBeUndefined();
  });
});
