import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { JobManager } from './jobManager';
import { HypitAdapter } from './hypitAdapter';
import { ClipCandidate, JobSettings } from './types';

let mainWindow: BrowserWindow | null = null;
const jobManager = new JobManager();
const hypitAdapter = new HypitAdapter();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#0A0D14',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Listen to job updates and forward to renderer
  jobManager.setJobUpdatedCallback((job) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('job:updated', job);
    }
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console ${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer Failed Load] code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`);
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const prodPath = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(prodPath)) {
    console.log(`Loading prod path: ${prodPath}`);
    mainWindow.loadFile(prodPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function setupIpcHandlers(): void {
  // System diagnosis
  ipcMain.handle('system:getEnvironmentStatus', async () => {
    return await hypitAdapter.checkEnvironment();
  });

  // File dialogs
  ipcMain.handle('dialog:selectVideo', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn video nguồn (MP4, MOV, MKV)',
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] },
      ],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('dialog:selectSrt', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn file phụ đề SRT / VTT',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const filePath = res.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf8');
      return { path: filePath, content };
    }
    return null;
  });

  ipcMain.handle('dialog:selectExportFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục xuất video',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('dialog:importSfx', async (_, mode?: 'files' | 'folder') => {
    if (!mainWindow) return null;
    const isFolder = mode === 'folder';
    const res = await dialog.showOpenDialog(mainWindow, {
      title: isFolder ? 'Chọn thư mục chứa SFX' : 'Chọn các file SFX (.mp3, .wav, .aac...)',
      properties: isFolder
        ? ['openDirectory']
        : ['openFile', 'multiSelections'],
      filters: isFolder
        ? undefined
        : [
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] },
            { name: 'All Files', extensions: ['*'] },
          ],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const provider = jobManager.getAutoAssetPlanner().getAssetProvider();
      return await provider.importSfxPaths(res.filePaths);
    }
    return null;
  });

  // Shell integration
  ipcMain.handle('system:openPath', async (_, targetPath: string) => {
    if (fs.existsSync(targetPath)) {
      await shell.openPath(targetPath);
    }
  });

  ipcMain.handle('system:showItemInFolder', async (_, targetPath: string) => {
    if (fs.existsSync(targetPath)) {
      shell.showItemInFolder(targetPath);
    }
  });

  // Job management
  ipcMain.handle(
    'job:create',
    async (_, videoPath: string, settings: JobSettings, title?: string) => {
      return await jobManager.createJob(videoPath, settings, title);
    }
  );

  ipcMain.handle(
    'job:analyze',
    async (_, jobId: string, srtContent?: string) => {
      return await jobManager.analyzeVideo(jobId, srtContent);
    }
  );

  ipcMain.handle(
    'job:updateCandidates',
    async (_, jobId: string, candidates: ClipCandidate[]) => {
      return jobManager.updateCandidates(jobId, candidates);
    }
  );

  ipcMain.handle(
    'job:updateAssetPlan',
    async (_, jobId: string, candidateId: string, plan: any) => {
      return jobManager.updateCandidateAssetPlan(jobId, candidateId, plan);
    }
  );

  ipcMain.handle(
    'job:rescanCandidateSfx',
    async (_, jobId: string, candidateId: string) => {
      return await jobManager.rescanCandidateSfx(jobId, candidateId);
    }
  );

  ipcMain.handle('asset:getAll', async (_, type?: 'meme' | 'sfx' | 'music') => {
    return await jobManager.getAutoAssetPlanner().getAssetProvider().getAllAssets(type);
  });

  ipcMain.handle('asset:getCatalogStats', async () => {
    return jobManager.getAutoAssetPlanner().getAssetProvider().getCatalogStats();
  });

  ipcMain.handle('asset:getTrends', async () => {
    return jobManager.getAutoAssetPlanner().getTrendCatalog().getTrends();
  });

  ipcMain.handle('asset:importSfxPaths', async (_, paths: string[]) => {
    const provider = jobManager.getAutoAssetPlanner().getAssetProvider();
    return await provider.importSfxPaths(paths);
  });

  ipcMain.handle('asset:getImportedSfx', async () => {
    const provider = jobManager.getAutoAssetPlanner().getAssetProvider();
    return provider.getImportedAssets();
  });

  ipcMain.handle('asset:updateImportedSfx', async (_, id: string, updates: any) => {
    const provider = jobManager.getAutoAssetPlanner().getAssetProvider();
    return await provider.updateImportedAsset(id, updates);
  });

  ipcMain.handle('asset:deleteImportedSfx', async (_, id: string) => {
    const provider = jobManager.getAutoAssetPlanner().getAssetProvider();
    return await provider.deleteImportedAsset(id);
  });

  ipcMain.handle('job:renderAll', async (_, jobId: string) => {
    return await jobManager.renderAllCandidates(jobId);
  });

  ipcMain.handle(
    'job:updatePublishPackage',
    async (_, jobId: string, clipId: string, updatesOrTitle: any, hook?: string, hashtags?: string[]) => {
      return await jobManager.updatePublishPackage(jobId, clipId, updatesOrTitle, hook, hashtags);
    }
  );

  ipcMain.handle(
    'job:regeneratePublishPackage',
    async (_, jobId: string, clipId: string, resetSuggestions?: boolean) => {
      return await jobManager.regeneratePublishPackage(jobId, clipId, resetSuggestions);
    }
  );

  ipcMain.handle(
    'job:renderSingleClip',
    async (_, jobId: string, clipId: string) => {
      return await jobManager.renderSingleClip(jobId, clipId);
    }
  );

  ipcMain.handle(
    'job:cancelClip',
    async (_, jobId: string, clipId: string) => {
      jobManager.cancelClipRender(jobId, clipId);
    }
  );

  ipcMain.handle('job:getAll', async () => {
    return jobManager.getAllJobs();
  });

  ipcMain.handle('job:getOne', async (_, jobId: string) => {
    return jobManager.getJob(jobId) || null;
  });

  ipcMain.handle('job:delete', async (_, jobId: string) => {
    return jobManager.deleteJob(jobId);
  });
}
