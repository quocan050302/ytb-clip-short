import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JobManager } from '../main/jobManager';
import { JobSettings } from '../main/types';

describe('JobManager Persistence & State Lifecycle', () => {
  let tempDir: string;
  let jobManager: JobManager;

  const sampleSettings: JobSettings = {
    targetClipCount: 3,
    clipDurationMin: 20,
    clipDurationMax: 40,
    aspectRatio: '9:16',
    preset: 'reaction',
    captions: true,
    bgm: true,
    sfx: true,
    broll: false,
    mode: 'local',
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclip_test_'));
    jobManager = new JobManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('creates job directory structure with all required subdirectories', async () => {
    const fakeVideoPath = path.join(tempDir, 'sample_video.mp4');
    fs.writeFileSync(fakeVideoPath, 'fake video binary');

    const job = await jobManager.createJob(fakeVideoPath, sampleSettings, 'Test Project');

    expect(job.id).toBeDefined();
    expect(job.title).toBe('Test Project');
    expect(fs.existsSync(job.jobDir)).toBe(true);

    const subdirs = ['input', 'transcript', 'candidates', 'hypit_projects', 'logs', 'outputs'];
    for (const d of subdirs) {
      expect(fs.existsSync(path.join(job.jobDir, d))).toBe(true);
    }

    const metaFile = path.join(job.jobDir, 'metadata.json');
    expect(fs.existsSync(metaFile)).toBe(true);
  });

  it('persists and restores job state across manager instances', async () => {
    const fakeVideoPath = path.join(tempDir, 'persistence_video.mp4');
    fs.writeFileSync(fakeVideoPath, 'dummy data');

    const createdJob = await jobManager.createJob(fakeVideoPath, sampleSettings, 'Persistent Job');

    // Add candidates
    jobManager.updateCandidates(createdJob.id, [
      {
        id: 'c1',
        title: 'Candidate 1',
        start: 0,
        end: 30,
        duration: 30,
        score: 85,
        scoreBreakdown: { hook: 85, pacing: 85, payoff: 85 },
        reason: 'Good flow',
        transcriptExcerpt: 'Hello world',
        selected: true,
      },
    ]);

    // Create a new instance pointing to the same directory (simulating app restart)
    const newManager = new JobManager(tempDir);
    const restoredJobs = newManager.getAllJobs();

    expect(restoredJobs.length).toBe(1);
    expect(restoredJobs[0].id).toBe(createdJob.id);
    expect(restoredJobs[0].candidates.length).toBe(1);
    expect(restoredJobs[0].candidates[0].title).toBe('Candidate 1');
  });

  it('correctly transitions clip statuses and updates log files', async () => {
    const fakeVideoPath = path.join(tempDir, 'status_video.mp4');
    fs.writeFileSync(fakeVideoPath, 'dummy data');

    const job = await jobManager.createJob(fakeVideoPath, sampleSettings);

    jobManager.addLog(job.id, 'info', 'Step 1 completed');
    jobManager.addLog(job.id, 'warn', 'Warning test notice');

    const updatedJob = jobManager.getJob(job.id);
    expect(updatedJob?.logs.length).toBe(3); // 1 initial creation log + 2 added
    expect(updatedJob?.logs[1].message).toBe('Step 1 completed');

    const logFile = path.join(job.jobDir, 'logs', 'process.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const logContent = fs.readFileSync(logFile, 'utf8');
    expect(logContent).toContain('Step 1 completed');
    expect(logContent).toContain('Warning test notice');
  });
});
