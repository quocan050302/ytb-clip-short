import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { VideoUploader } from './components/VideoUploader';
import { SettingsPanel } from './components/SettingsPanel';
import { AnalysisView } from './components/AnalysisView';
import { CandidatesGrid } from './components/CandidatesGrid';
import { RenderProgress } from './components/RenderProgress';
import { OutputGallery } from './components/OutputGallery';
import { CostPreflightModal } from './components/CostPreflightModal';
import { JobsDrawer } from './components/JobsDrawer';
import { AssetPlanModal } from './components/AssetPlanModal';
import {
  ClipAssetPlan,
  ClipCandidate,
  EnvironmentStatus,
  JobMetadata,
  JobSettings,
  VideoInfo,
} from '../main/types';

export const App: React.FC = () => {
  // System environment status
  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);

  // Text belongs on the standalone thumbnail; the exported video starts clean.
  const [settings, setSettings] = useState<JobSettings>({
    targetClipCount: 5,
    clipDurationMin: 30,
    clipDurationMax: 45,
    aspectRatio: '9:16',
    preset: 'reaction',
    captions: false,
    bgm: true,
    sfx: true,
    broll: true,
    mode: 'local',
    wordLevelCaptions: false,
    callouts: false,
    visualEffects: true,
    hdEnhance: true,
    enhanceMode: 'blur-bg-preserve',
    enhance: {
      mode: 'blur-bg-preserve',
      targetResolution: '1080p',
      faceAware: false,
      blurRadius: 40,
      upscaleFactor: 2,
      sharpen: true,
    },
  });

  // Current active job
  const [currentJob, setCurrentJob] = useState<JobMetadata | null>(null);
  const [allJobs, setAllJobs] = useState<JobMetadata[]>([]);
  const [activeStep, setActiveStep] = useState<number>(1);

  // Processing indicators
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [showJobsDrawer, setShowJobsDrawer] = useState(false);
  const [candidateForAssetPlan, setCandidateForAssetPlan] = useState<ClipCandidate | null>(null);

  // Load system environment and existing jobs on mount
  useEffect(() => {
    async function init() {
      try {
        if (window.electronAPI) {
          const status = await window.electronAPI.getEnvironmentStatus();
          setEnvStatus(status);

          const jobs = await window.electronAPI.getAllJobs();
          setAllJobs(jobs);

          // If there is an existing job, load the latest
          if (jobs.length > 0) {
            const latest = jobs[0];
            setCurrentJob(latest);
            setSettings(latest.settings);
            if (latest.status === 'completed' || latest.clips.some((c) => c.status === 'completed')) {
              setActiveStep(4);
            } else if (latest.candidates.length > 0) {
              setActiveStep(3);
            } else if (latest.transcript.length > 0) {
              setActiveStep(2);
            }
          }

          // Register realtime job update listener
          window.electronAPI.onJobUpdated((updatedJob) => {
            setCurrentJob((prev) => (prev?.id === updatedJob.id ? updatedJob : prev));
            setAllJobs((prev) =>
              prev.map((j) => (j.id === updatedJob.id ? updatedJob : j))
            );
          });
        }
      } catch (err) {
        console.error('Init error:', err);
      }
    }
    init();
  }, []);

  // Handle video selection
  const handleSelectVideo = async (filePath: string) => {
    try {
      const job = await window.electronAPI.createJob(filePath, settings);
      setCurrentJob(job);
      setAllJobs((prev) => [job, ...prev]);
      setActiveStep(1);
    } catch (err) {
      console.error('Failed to create job with selected video:', err);
    }
  };

  // Handle analysis
  const handleStartAnalysis = async () => {
    if (!currentJob) return;
    setIsAnalyzing(true);
    setActiveStep(2);

    try {
      const analyzedJob = await window.electronAPI.analyzeVideo(currentJob.id);
      setCurrentJob(analyzedJob);
      setActiveStep(3);
    } catch (err: any) {
      alert(`Phân tích video thất bại: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle SRT upload
  const handleUploadSrt = async (srtContent: string) => {
    if (!currentJob) return;
    setIsAnalyzing(true);
    try {
      const updatedJob = await window.electronAPI.analyzeVideo(currentJob.id, srtContent);
      setCurrentJob(updatedJob);
      setActiveStep(3);
    } catch (err: any) {
      alert(`Đọc SRT thất bại: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Candidate modifications
  const handleUpdateCandidate = async (updated: ClipCandidate) => {
    if (!currentJob) return;
    const newCandidates = currentJob.candidates.map((c) =>
      c.id === updated.id ? updated : c
    );
    const updatedJob = await window.electronAPI.updateCandidates(currentJob.id, newCandidates);
    setCurrentJob(updatedJob);
  };

  const handleDeleteCandidate = async (id: string) => {
    if (!currentJob) return;
    const newCandidates = currentJob.candidates.filter((c) => c.id !== id);
    const updatedJob = await window.electronAPI.updateCandidates(currentJob.id, newCandidates);
    setCurrentJob(updatedJob);
  };

  const handleReorderCandidates = async (newOrder: ClipCandidate[]) => {
    if (!currentJob) return;
    const updatedJob = await window.electronAPI.updateCandidates(currentJob.id, newOrder);
    setCurrentJob(updatedJob);
  };

  const handleAddManualCandidate = async (cand: ClipCandidate) => {
    if (!currentJob) return;
    const newCandidates = [...currentJob.candidates, cand];
    const updatedJob = await window.electronAPI.updateCandidates(currentJob.id, newCandidates);
    setCurrentJob(updatedJob);
  };

  const handleSaveAssetPlan = async (updatedPlan: ClipAssetPlan) => {
    if (!currentJob || !candidateForAssetPlan) return;
    try {
      const updatedJob = await window.electronAPI.updateCandidateAssetPlan(
        currentJob.id,
        candidateForAssetPlan.id,
        updatedPlan
      );
      setCurrentJob(updatedJob);
    } catch (err) {
      console.error('Failed to update asset plan:', err);
    }
  };

  // Render pipeline
  const handleConfirmRender = async () => {
    setShowPreflight(false);
    if (!currentJob) return;

    setIsRendering(true);
    setActiveStep(4);

    try {
      const renderedJob = await window.electronAPI.renderAllCandidates(currentJob.id);
      setCurrentJob(renderedJob);
    } catch (err: any) {
      console.error('Render error:', err);
    } finally {
      setIsRendering(false);
    }
  };

  const handleRetryClip = async (clipId: string) => {
    if (!currentJob) return;
    try {
      await window.electronAPI.renderSingleClip(currentJob.id, clipId);
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleCancelClip = async (clipId: string) => {
    if (!currentJob) return;
    try {
      await window.electronAPI.cancelClipRender(currentJob.id, clipId);
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  // Navigation / File opening
  const handleOpenFolder = (targetPath: string) => {
    window.electronAPI.openPath(targetPath);
  };

  const handleShowInFolder = (targetPath: string) => {
    window.electronAPI.showItemInFolder(targetPath);
  };

  const handleSelectJobFromHistory = async (jobId: string) => {
    const job = await window.electronAPI.getJob(jobId);
    if (job) {
      setCurrentJob(job);
      setSettings(job.settings);
      setShowJobsDrawer(false);
      if (job.clips.some((c) => c.status === 'completed')) {
        setActiveStep(4);
      } else if (job.candidates.length > 0) {
        setActiveStep(3);
      } else {
        setActiveStep(1);
      }
    }
  };

  const handleDeleteJobFromHistory = async (jobId: string) => {
    const ok = await window.electronAPI.deleteJob(jobId);
    if (ok) {
      setAllJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (currentJob?.id === jobId) {
        setCurrentJob(null);
        setActiveStep(1);
      }
    }
  };

  const handleNewJob = () => {
    setCurrentJob(null);
    setActiveStep(1);
  };

  const candidatesToRender = currentJob?.candidates.filter((c) => c.selected) || [];

  return (
    <div className="app-container">
      {/* Top Application Bar */}
      <Header
        envStatus={envStatus}
        onOpenHistory={() => setShowJobsDrawer(true)}
        onNewJob={handleNewJob}
      />

      {/* Workflow Step Navigation */}
      <nav className="nav-steps-bar">
        <button
          className={`step-tab ${activeStep === 1 ? 'active' : ''} ${currentJob ? 'completed' : ''}`}
          onClick={() => setActiveStep(1)}
        >
          <span className="step-num">1</span>
          Chọn & Cấu Hình
        </button>

        <button
          className={`step-tab ${activeStep === 2 ? 'active' : ''} ${currentJob?.transcript?.length ? 'completed' : ''}`}
          onClick={() => currentJob && setActiveStep(2)}
          disabled={!currentJob}
        >
          <span className="step-num">2</span>
          Phân Tích Lời Thoại
        </button>

        <button
          className={`step-tab ${activeStep === 3 ? 'active' : ''} ${currentJob?.candidates?.length ? 'completed' : ''}`}
          onClick={() => currentJob?.candidates?.length && setActiveStep(3)}
          disabled={!currentJob?.candidates?.length}
        >
          <span className="step-num">3</span>
          Duyệt Đoạn Đề Xuất
        </button>

        <button
          className={`step-tab ${activeStep === 4 ? 'active' : ''} ${currentJob?.clips?.some((c) => c.status === 'completed') ? 'completed' : ''}`}
          onClick={() => currentJob?.clips?.length && setActiveStep(4)}
          disabled={!currentJob?.clips?.length}
        >
          <span className="step-num">4</span>
          Dựng & Xuất Video
        </button>
      </nav>

      {/* Main Workspace Scroll View */}
      <main className="main-workspace">
        {/* Step 1: Video selection and settings */}
        <div style={{ display: activeStep === 1 ? 'block' : 'none' }}>
          <VideoUploader
            videoPath={currentJob?.sourceVideoPath || null}
            videoInfo={currentJob?.videoInfo || null}
            onSelectVideo={handleSelectVideo}
          />

          <SettingsPanel
            settings={settings}
            onChange={(updated) => {
              setSettings(updated);
              if (currentJob) {
                currentJob.settings = updated;
              }
            }}
            onAnalyze={handleStartAnalysis}
            disabled={!currentJob}
            isAnalyzing={isAnalyzing}
          />
        </div>

        {/* Step 2: Transcript and speech analysis */}
        <div style={{ display: activeStep === 2 ? 'block' : 'none' }}>
          <AnalysisView
            transcript={currentJob?.transcript || []}
            onUploadSrt={handleUploadSrt}
            isAnalyzing={isAnalyzing}
          />
        </div>

        {/* Step 3: Candidates review and tweaking */}
        <div style={{ display: activeStep === 3 ? 'block' : 'none' }}>
          {currentJob && (
            <CandidatesGrid
              candidates={currentJob.candidates}
              sourceVideoPath={currentJob.sourceVideoPath}
              onUpdateCandidate={handleUpdateCandidate}
              onDeleteCandidate={handleDeleteCandidate}
              onReorder={handleReorderCandidates}
              onAddManual={handleAddManualCandidate}
              onStartRender={() => setShowPreflight(true)}
              isRendering={isRendering}
              onEditAssetPlan={(cand) => setCandidateForAssetPlan(cand)}
            />
          )}
        </div>

        {/* Step 4: Render progress & Output Gallery */}
        <div style={{ display: activeStep === 4 ? 'block' : 'none' }}>
          {currentJob && currentJob.clips.length > 0 && (
            <>
              <RenderProgress
                clips={currentJob.clips}
                logs={currentJob.logs}
                onRetryClip={handleRetryClip}
                onCancelClip={handleCancelClip}
                onPreviewClip={(p) => handleOpenFolder(p)}
                onOpenFolder={() => handleOpenFolder(`${currentJob.jobDir}/outputs`)}
              />

              <OutputGallery
                job={currentJob}
                onOpenFolder={handleOpenFolder}
                onShowInFolder={handleShowInFolder}
                onUpdatePackage={async (clipId, title, hook, hashtags) => {
                  const updated = await window.electronAPI.updatePublishPackage(
                    currentJob.id, clipId, title, hook, hashtags
                  );
                  setCurrentJob(updated);
                }}
              />
            </>
          )}
        </div>
      </main>

      {/* Preflight Zero-Cost Check Modal */}
      {showPreflight && (
        <CostPreflightModal
          settings={settings}
          candidatesToRender={candidatesToRender}
          onConfirm={handleConfirmRender}
          onCancel={() => setShowPreflight(false)}
        />
      )}

      {/* Asset Plan Inspection & Tweaking Modal */}
      {candidateForAssetPlan && (
        <AssetPlanModal
          candidate={candidateForAssetPlan}
          onSave={handleSaveAssetPlan}
          onClose={() => setCandidateForAssetPlan(null)}
        />
      )}

      {/* Past Jobs Drawer */}
      <JobsDrawer
        isOpen={showJobsDrawer}
        jobs={allJobs}
        currentJobId={currentJob?.id}
        onSelectJob={handleSelectJobFromHistory}
        onDeleteJob={handleDeleteJobFromHistory}
        onClose={() => setShowJobsDrawer(false)}
      />
    </div>
  );
};
