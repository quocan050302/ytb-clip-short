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
