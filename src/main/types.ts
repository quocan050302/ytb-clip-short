export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export type AspectRatio = '9:16' | '16:9';
export type VideoPreset = 'reaction' | 'documentary';

export interface JobSettings {
  targetClipCount: number;
  clipDurationMin: number;
  clipDurationMax: number;
  aspectRatio: AspectRatio;
  preset: VideoPreset;
  captions: boolean;
  bgm: boolean;
  sfx: boolean;
  broll: boolean;
  mode: 'local' | 'cloud';
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface ScoreBreakdown {
  hook: number;     // Energy and engagement in first 3-5 seconds (0-100)
  pacing: number;   // Speech cadence & flow, low awkward pauses (0-100)
  payoff: number;   // Strong ending or punchline conclusion (0-100)
}

export type BeatType = 'hook' | 'reveal' | 'surprise' | 'fail' | 'punchline' | 'pause';

export interface AssetItem {
  id: string;
  name: string;
  type: 'meme' | 'sfx' | 'music';
  filePath: string;
  sourceUrl: string;
  author?: string;
  license: string;
  fetchedAt: string;
  fingerprint: string;
  mood?: string;
  tags: string[];
}

export interface BeatEvent {
  id: string;
  beatType: BeatType;
  timestamp: number;    // seconds relative to clip start (e.g. 3.5s)
  duration: number;     // overlay display duration in seconds (e.g. 1.5s)
  sfx: AssetItem;       // paired SFX (fires at timestamp)
  meme: AssetItem;      // paired Meme (shown from timestamp to timestamp + duration)
  confidence: number;   // 0.0 - 1.0
  reason: string;
}

export interface DuckingSettings {
  normalVolume: number;
  duckedVolume: number;
  fadeInDuration: number;
  fadeOutDuration: number;
}

export interface ClipAssetPlan {
  clipId: string;
  musicTrack: AssetItem | null;
  beats: BeatEvent[];
  duckingSettings: DuckingSettings;
}

export interface ClipCandidate {
  id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
  transcriptExcerpt: string;
  thumbnailPath?: string;
  selected: boolean;
  assetPlan?: ClipAssetPlan;
}

export type ClipRenderStatus = 
  | 'queued' 
  | 'analyzing' 
  | 'planning' 
  | 'rendering' 
  | 'completed' 
  | 'failed' 
  | 'canceled';

export interface RenderedClip {
  id: string;
  candidateId: string;
  title: string;
  status: ClipRenderStatus;
  progress: number;
  outputPath?: string;
  hypitBuildId?: string;
  error?: string;
  duration?: number;
  updatedAt: string;
  assetPlan?: ClipAssetPlan;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  clipId?: string;
}

export type JobStatus = 
  | 'idle' 
  | 'analyzing' 
  | 'candidates_ready' 
  | 'rendering' 
  | 'completed' 
  | 'error';

export interface JobMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceVideoPath: string;
  videoInfo: VideoInfo;
  settings: JobSettings;
  status: JobStatus;
  transcript: TranscriptSegment[];
  candidates: ClipCandidate[];
  clips: RenderedClip[];
  logs: LogEntry[];
  jobDir: string;
}

export interface EnvironmentStatus {
  nodeVersion: string;
  hypitVersion: string;
  hypitOk: boolean;
  hypitPath: string;
  ffmpegOk: boolean;
  ffmpegVersion: string;
  ffprobeOk: boolean;
  runtimeReady: boolean;
  details: string;
}
