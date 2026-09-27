import { contextBridge, ipcRenderer } from 'electron';
import {
  AssetItem,
  ClipAssetPlan,
  ClipCandidate,
  EnvironmentStatus,
  ImportedSfxMetadata,
  ImportResult,
  JobMetadata,
  JobSettings,
  LogEntry,
  RenderedClip,
} from './types';

export interface PublishPackageUpdates {
  title?: string;
  hook?: string;
  hashtags?: string[];
  selectedFrameId?: string;
  textPosition?: 'top' | 'middle' | 'bottom';
}

export interface IElectronAPI {
  selectVideoFile: () => Promise<string | null>;
  selectSrtFile: () => Promise<{ path: string; content: string } | null>;
  selectExportFolder: () => Promise<string | null>;
  getEnvironmentStatus: () => Promise<EnvironmentStatus>;
  createJob: (videoPath: string, settings: JobSettings, title?: string) => Promise<JobMetadata>;
  analyzeVideo: (jobId: string, srtContent?: string) => Promise<JobMetadata>;
  updateCandidates: (jobId: string, candidates: ClipCandidate[]) => Promise<JobMetadata>;
  updateCandidateAssetPlan: (jobId: string, candidateId: string, plan: ClipAssetPlan) => Promise<JobMetadata>;
  getAllAssets: (type?: 'meme' | 'sfx' | 'music') => Promise<AssetItem[]>;
  getTrends: () => Promise<any[]>;
  renderAllCandidates: (jobId: string) => Promise<JobMetadata>;
  renderSingleClip: (jobId: string, clipId: string) => Promise<RenderedClip>;
  updatePublishPackage: (
    jobId: string,
    clipId: string,
    updatesOrTitle: PublishPackageUpdates | string,
    hook?: string,
    hashtags?: string[]
  ) => Promise<JobMetadata>;
  regeneratePublishPackage: (
    jobId: string,
    clipId: string,
    resetSuggestions?: boolean
  ) => Promise<JobMetadata>;
  cancelClipRender: (jobId: string, clipId: string) => Promise<void>;
  getAllJobs: () => Promise<JobMetadata[]>;
  getJob: (jobId: string) => Promise<JobMetadata | null>;
  deleteJob: (jobId: string) => Promise<boolean>;
  openPath: (targetPath: string) => Promise<void>;
  showItemInFolder: (targetPath: string) => Promise<void>;
  onJobUpdated: (callback: (job: JobMetadata) => void) => () => void;
  onLog: (callback: (log: LogEntry) => void) => () => void;

  // SFX Import & Management
  importSfxDialog: (mode?: 'files' | 'folder') => Promise<ImportResult | null>;
  importSfxPaths: (paths: string[]) => Promise<ImportResult>;
  getImportedSfx: () => Promise<ImportedSfxMetadata[]>;
  updateImportedSfx: (id: string, updates: Partial<ImportedSfxMetadata>) => Promise<ImportedSfxMetadata>;
  deleteImportedSfx: (id: string) => Promise<boolean>;
}

const api: IElectronAPI = {
  selectVideoFile: () => ipcRenderer.invoke('dialog:selectVideo'),
  selectSrtFile: () => ipcRenderer.invoke('dialog:selectSrt'),
  selectExportFolder: () => ipcRenderer.invoke('dialog:selectExportFolder'),
  getEnvironmentStatus: () => ipcRenderer.invoke('system:getEnvironmentStatus'),
  createJob: (videoPath, settings, title) =>
    ipcRenderer.invoke('job:create', videoPath, settings, title),
  analyzeVideo: (jobId, srtContent) =>
    ipcRenderer.invoke('job:analyze', jobId, srtContent),
  updateCandidates: (jobId, candidates) =>
    ipcRenderer.invoke('job:updateCandidates', jobId, candidates),
  updateCandidateAssetPlan: (jobId, candidateId, plan) =>
    ipcRenderer.invoke('job:updateAssetPlan', jobId, candidateId, plan),
  getAllAssets: (type) => ipcRenderer.invoke('asset:getAll', type),
  getTrends: () => ipcRenderer.invoke('asset:getTrends'),
  renderAllCandidates: (jobId) =>
    ipcRenderer.invoke('job:renderAll', jobId),
  renderSingleClip: (jobId, clipId) =>
    ipcRenderer.invoke('job:renderSingleClip', jobId, clipId),
  updatePublishPackage: (jobId, clipId, updatesOrTitle, hook, hashtags) =>
    ipcRenderer.invoke('job:updatePublishPackage', jobId, clipId, updatesOrTitle, hook, hashtags),
  regeneratePublishPackage: (jobId, clipId, resetSuggestions) =>
    ipcRenderer.invoke('job:regeneratePublishPackage', jobId, clipId, resetSuggestions),
  cancelClipRender: (jobId, clipId) =>
    ipcRenderer.invoke('job:cancelClip', jobId, clipId),
  getAllJobs: () => ipcRenderer.invoke('job:getAll'),
  getJob: (jobId) => ipcRenderer.invoke('job:getOne', jobId),
  deleteJob: (jobId) => ipcRenderer.invoke('job:delete', jobId),
  openPath: (targetPath) => ipcRenderer.invoke('system:openPath', targetPath),
  showItemInFolder: (targetPath) =>
    ipcRenderer.invoke('system:showItemInFolder', targetPath),
  onJobUpdated: (callback) => {
    const handler = (_: any, job: JobMetadata) => callback(job);
    ipcRenderer.on('job:updated', handler);
    return () => ipcRenderer.removeListener('job:updated', handler);
  },
  onLog: (callback) => {
    const handler = (_: any, log: LogEntry) => callback(log);
    ipcRenderer.on('job:log', handler);
    return () => ipcRenderer.removeListener('job:log', handler);
  },
  importSfxDialog: (mode) => ipcRenderer.invoke('dialog:importSfx', mode),
  importSfxPaths: (paths) => ipcRenderer.invoke('asset:importSfxPaths', paths),
  getImportedSfx: () => ipcRenderer.invoke('asset:getImportedSfx'),
  updateImportedSfx: (id, updates) => ipcRenderer.invoke('asset:updateImportedSfx', id, updates),
  deleteImportedSfx: (id) => ipcRenderer.invoke('asset:deleteImportedSfx', id),
};

contextBridge.exposeInMainWorld('electronAPI', api);
