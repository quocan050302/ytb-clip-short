import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  Play,
  CheckCircle2,
  ExternalLink,
  Code,
  Image,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Check,
  RotateCcw,
} from 'lucide-react';
import { JobMetadata, PublishStatus } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface OutputGalleryProps {
  job: JobMetadata;
  onOpenFolder: (path: string) => void;
  onShowInFolder: (path: string) => void;
  onUpdatePackage: (
    clipId: string,
    updates: {
      title?: string;
      hook?: string;
      hashtags?: string[];
      selectedFrameId?: string;
      textPosition?: 'top' | 'middle' | 'bottom';
    }
  ) => Promise<void>;
  onRegeneratePackage?: (clipId: string, resetSuggestions?: boolean) => Promise<void>;
}

export const OutputGallery: React.FC<OutputGalleryProps> = ({
  job,
  onOpenFolder,
  onShowInFolder,
  onUpdatePackage,
  onRegeneratePackage,
}) => {
  const completedClips = job.clips.filter((c) => c.status === 'completed' && c.outputPath);
  const [activeClipId, setActiveClipId] = useState(completedClips[0]?.id || '');
  const activeClip = completedClips.find((c) => c.id === activeClipId) || completedClips[0];

  const [draftTitle, setDraftTitle] = useState('');
  const [draftHook, setDraftHook] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftPosition, setDraftPosition] = useState<'top' | 'middle' | 'bottom'>('top');
  const [selectedFrameId, setSelectedFrameId] = useState('');
  const [previewMode, setPreviewMode] = useState<'thumbnail' | 'video'>('thumbnail');

  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setDraftTitle(activeClip?.publishTitle || '');
    setDraftHook(activeClip?.thumbnailHook || '');
    setDraftTags(activeClip?.hashtags?.join(' ') || '');
    setDraftPosition(activeClip?.thumbnailLayout?.textPosition || 'top');
    setSelectedFrameId(activeClip?.selectedThumbnailFrameId || activeClip?.thumbnailFrames?.[0]?.id || '');
    setSaveError('');
    setSaveSuccess(false);
  }, [activeClip?.id, activeClip?.updatedAt]);

  if (completedClips.length === 0) {
    return null;
  }

  const outputDir = `${job.jobDir}/outputs`;
  const hypitProjectsDir = `${job.jobDir}/hypit_projects`;

  const statusBadge = (status?: PublishStatus) => {
    switch (status) {
      case 'ready':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(16, 185, 129, 0.18)',
              color: '#34D399',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: 6,
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '2px 8px',
            }}
          >
            <Check size={12} /> Sẵn sàng đăng
          </span>
        );
      case 'needs_review':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(245, 158, 11, 0.18)',
              color: '#FBBF24',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: 6,
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '2px 8px',
            }}
          >
            <AlertTriangle size={12} /> Cần duyệt nội dung
          </span>
        );
      case 'failed':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(239, 68, 68, 0.18)',
              color: '#F87171',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 6,
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '2px 8px',
            }}
          >
            <AlertCircle size={12} /> Lỗi tạo thumbnail
          </span>
        );
      case 'generating':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(59, 130, 246, 0.18)',
              color: '#60A5FA',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              borderRadius: 6,
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '2px 8px',
            }}
          >
            <RefreshCw size={12} className="spin" /> Đang tạo...
          </span>
        );
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(148, 163, 184, 0.15)',
              color: '#94A3B8',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: 6,
              fontSize: '0.72rem',
              padding: '2px 8px',
            }}
          >
            Chưa tạo package
          </span>
        );
    }
  };

  const selectedCandidateFrame = activeClip?.thumbnailFrames?.find((f) => f.id === selectedFrameId);
  const activePreviewImage =
    activeClip?.thumbnailPath || selectedCandidateFrame?.path || activeClip?.thumbnailFrames?.[0]?.path;

  return (
    <div className="glass-card" style={{ marginBottom: 30 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h3
            style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--status-success)',
            }}
          >
            <CheckCircle2 size={22} />
            4. Video Shorts & Publish Package Hoàn Chỉnh ({completedClips.length} clips)
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginTop: 4 }}>
            Mỗi Short gồm file MP4 chuẩn tỷ lệ {job.settings.aspectRatio}, 3 khung hình ứng viên phân tích độ nét,
            thumbnail HD 2160×3840 độc lập và metadata đề xuất.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onOpenFolder(hypitProjectsDir)}
            title="Mở thư mục chứa file .svml, .svrun, .svs của Hypit"
          >
            <Code size={14} /> Xem Hypit Projects
          </button>

          <button
            className="btn btn-primary btn-sm"
            onClick={() => onOpenFolder(outputDir)}
            title="Mở thư mục chứa MP4, thumbnail PNG và metadata JSON"
          >
            <FolderOpen size={15} /> Mở thư mục Outputs
          </button>
        </div>
      </div>

      {/* Main Grid: Active Clip Inspector & Clip List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(330px, 450px) 1fr', gap: 24 }}>
        {/* Active Clip Inspector Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPreviewMode('thumbnail')}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: previewMode === 'thumbnail' ? 'rgba(99, 102, 241, 0.22)' : 'var(--bg-elevated)',
                borderColor: previewMode === 'thumbnail' ? 'var(--accent-primary)' : 'var(--border-subtle)',
                color: previewMode === 'thumbnail' ? '#FFF' : 'var(--text-muted)',
                fontWeight: previewMode === 'thumbnail' ? 600 : 400,
              }}
            >
              <Image size={14} /> Thumbnail HD (9:16)
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPreviewMode('video')}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: previewMode === 'video' ? 'rgba(99, 102, 241, 0.22)' : 'var(--bg-elevated)',
                borderColor: previewMode === 'video' ? 'var(--accent-primary)' : 'var(--border-subtle)',
                color: previewMode === 'video' ? '#FFF' : 'var(--text-muted)',
                fontWeight: previewMode === 'video' ? 600 : 400,
              }}
            >
              <Play size={14} /> Video MP4 Đã Dựng
            </button>
          </div>

          {/* Media Preview Box */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '9/16',
              maxHeight: 520,
              background: '#090A0F',
              borderRadius: 'var(--radius-lg, 12px)',
              overflow: 'hidden',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.55)',
              margin: '0 auto',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {previewMode === 'video' ? (
              activeClip?.outputPath ? (
                <video
                  key={activeClip.outputPath}
                  src={`file://${encodeURI(activeClip.outputPath)}`}
                  controls
                  autoPlay
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ color: 'var(--text-dim)' }}>Không tìm thấy file MP4</div>
              )
            ) : activePreviewImage ? (
              <img
                key={`${activePreviewImage}-${activeClip?.updatedAt}`}
                src={`file://${encodeURI(activePreviewImage)}?v=${encodeURIComponent(activeClip?.updatedAt || '')}`}
                alt={`Thumbnail Preview: ${activeClip?.thumbnailHook || activeClip?.title}`}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)' }}>
                <Image size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                <div>Chưa có thumbnail HD cho clip này</div>
                {onRegeneratePackage && activeClip && (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 12 }}
                    disabled={regenerating}
                    onClick={async () => {
                      setRegenerating(true);
                      try {
                        await onRegeneratePackage(activeClip.id, false);
                      } finally {
                        setRegenerating(false);
                      }
                    }}
                  >
                    <RefreshCw size={13} className={regenerating ? 'spin' : ''} /> Tạo thumbnail ngay
                  </button>
                )}
              </div>
            )}

            {/* Floating Status Badge */}
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
              {statusBadge(activeClip?.publishStatus)}
            </div>
          </div>

          {/* Warning banner if present */}
          {activeClip?.publishWarning && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                background:
                  activeClip.publishStatus === 'failed'
                    ? 'rgba(239, 68, 68, 0.12)'
                    : 'rgba(245, 158, 11, 0.12)',
                border: `1px solid ${
                  activeClip.publishStatus === 'failed'
                    ? 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(245, 158, 11, 0.3)'
                }`,
                color: activeClip.publishStatus === 'failed' ? '#F87171' : '#FBBF24',
                fontSize: '0.8rem',
                lineHeight: 1.35,
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>{activeClip.publishWarning}</div>
            </div>
          )}

          {/* 3 Candidate Frames Selector */}
          {activeClip && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  3 Khung hình ứng viên (đã chấm điểm độ nét & bố cục):
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Bấm để chọn khung</span>
              </div>

              {activeClip.thumbnailFrames && activeClip.thumbnailFrames.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {activeClip.thumbnailFrames.map((frame) => {
                    const isSelected = (selectedFrameId || activeClip.selectedThumbnailFrameId) === frame.id;
                    return (
                      <div
                        key={frame.id}
                        onClick={() => setSelectedFrameId(frame.id)}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: isSelected
                            ? '2px solid var(--accent-primary, #6366F1)'
                            : '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                          background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(0,0,0,0.3)',
                          boxShadow: isSelected ? '0 0 12px rgba(99, 102, 241, 0.35)' : 'none',
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        <div
                          style={{
                            position: 'relative',
                            width: '100%',
                            aspectRatio: '9/16',
                            background: '#111',
                          }}
                        >
                          <img
                            src={`file://${encodeURI(frame.path)}?v=${encodeURIComponent(activeClip.updatedAt || '')}`}
                            alt={frame.reason}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <span
                            style={{
                              position: 'absolute',
                              top: 4,
                              left: 4,
                              background: 'rgba(0,0,0,0.75)',
                              color: '#FFF',
                              fontSize: '0.64rem',
                              fontWeight: 600,
                              padding: '2px 4px',
                              borderRadius: 4,
                            }}
                          >
                            {formatTime(frame.timestamp)} ({frame.timestamp.toFixed(1)}s)
                          </span>
                          <span
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              background:
                                frame.score >= 70 ? 'rgba(16, 185, 129, 0.85)' : 'rgba(245, 158, 11, 0.85)',
                              color: '#FFF',
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 4,
                            }}
                          >
                            {frame.score}đ
                          </span>
                          {isSelected && (
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 4,
                                right: 4,
                                background: 'var(--accent-primary, #6366F1)',
                                color: '#FFF',
                                borderRadius: '50%',
                                width: 18,
                                height: 18,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Check size={12} />
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            padding: '6px 6px',
                            fontSize: '0.68rem',
                            color: 'var(--text-dim)',
                            lineHeight: 1.25,
                            minHeight: 32,
                          }}
                        >
                          {frame.reason}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px 8px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                  Chưa trích xuất 3 khung hình ứng viên cho clip này.
                </div>
              )}
            </div>
          )}

          {/* Form: Editorial Overrides */}
          {activeClip && (
            <div
              style={{
                display: 'grid',
                gap: 10,
                padding: 14,
                border: '1px solid var(--border-subtle)',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              {/* Title quick-options */}
              {activeClip.publishTitleOptions && activeClip.publishTitleOptions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                    Gợi ý tiêu đề dựa trên lời thoại thực tế (bấm để chọn nhanh):
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {activeClip.publishTitleOptions.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDraftTitle(opt)}
                        style={{
                          fontSize: '0.75rem',
                          padding: '5px 9px',
                          textAlign: 'left',
                          background: draftTitle === opt ? 'rgba(99, 102, 241, 0.22)' : 'rgba(255, 255, 255, 0.04)',
                          borderColor: draftTitle === opt ? 'var(--accent-primary)' : 'var(--border-subtle)',
                          color: draftTitle === opt ? '#FFF' : 'var(--text-muted)',
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title input */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <label className="input-label" style={{ margin: 0 }}>
                    Title khi đăng Short
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{draftTitle.length}/100</span>
                </div>
                <input
                  className="text-input"
                  value={draftTitle}
                  maxLength={100}
                  placeholder="Nhập tiêu đề hấp dẫn..."
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
              </div>

              {/* Hook input */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <label className="input-label" style={{ margin: 0 }}>
                    Hook trên thumbnail (2–5 từ, viết hoa)
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{draftHook.length}/32</span>
                </div>
                <input
                  className="text-input"
                  value={draftHook}
                  maxLength={32}
                  placeholder="Vd: NO WAY, CỰC CĂNG..."
                  onChange={(e) => setDraftHook(e.target.value)}
                />
              </div>

              {/* Text position selector */}
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 4 }}>
                  Vị trí chữ Hook trên Thumbnail:
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['top', 'middle', 'bottom'] as const).map((pos) => {
                    const isPosSelected = draftPosition === pos;
                    const label =
                      pos === 'top' ? 'Trên (Top)' : pos === 'middle' ? 'Giữa (Middle)' : 'Dưới (Bottom)';
                    return (
                      <button
                        key={pos}
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setDraftPosition(pos)}
                        style={{
                          flex: 1,
                          background: isPosSelected
                            ? 'var(--accent-primary, #6366F1)'
                            : 'var(--bg-elevated, rgba(255,255,255,0.06))',
                          color: isPosSelected ? '#FFF' : 'var(--text-muted, #CBD5E1)',
                          border: `1px solid ${isPosSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                          fontSize: '0.75rem',
                          fontWeight: isPosSelected ? 600 : 400,
                          padding: '6px 4px',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hashtag input */}
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 3 }}>
                  Hashtags (cách nhau bằng dấu cách)
                </label>
                <input
                  className="text-input"
                  value={draftTags}
                  placeholder="#Shorts #Clip..."
                  onChange={(e) => setDraftTags(e.target.value)}
                />
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={saving || regenerating}
                  style={{ flex: 2 }}
                  onClick={async () => {
                    setSaving(true);
                    setSaveError('');
                    setSaveSuccess(false);
                    try {
                      const tagsArray = draftTags
                        .split(/\s+/)
                        .map((t) => t.trim())
                        .filter(Boolean);
                      await onUpdatePackage(activeClip.id, {
                        title: draftTitle,
                        hook: draftHook,
                        hashtags: tagsArray,
                        selectedFrameId,
                        textPosition: draftPosition,
                      });
                      setSaveSuccess(true);
                      setTimeout(() => setSaveSuccess(false), 3000);
                    } catch (error: any) {
                      setSaveError(error?.message || 'Không lưu được thumbnail');
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? (
                    <>
                      <RefreshCw size={13} className="spin" /> Đang cập nhật & vẽ lại...
                    </>
                  ) : (
                    'Lưu thumbnail + metadata'
                  )}
                </button>

                {onRegeneratePackage && (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={saving || regenerating}
                    title="Tạo lại các khung hình và vẽ lại thumbnail từ MP4 hiện có"
                    onClick={async () => {
                      setRegenerating(true);
                      setSaveError('');
                      try {
                        await onRegeneratePackage(activeClip.id, false);
                      } catch (error: any) {
                        setSaveError(error?.message || 'Lỗi tạo lại thumbnail');
                      } finally {
                        setRegenerating(false);
                      }
                    }}
                  >
                    <RefreshCw size={13} className={regenerating ? 'spin' : ''} /> Tạo lại
                  </button>
                )}

                {onRegeneratePackage && (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={saving || regenerating}
                    title="Đặt lại gợi ý tiêu đề, hook và hashtag ban đầu"
                    onClick={async () => {
                      if (!window.confirm('Bạn có chắc muốn đặt lại toàn bộ gợi ý tiêu đề, hook và hashtag ban đầu?')) {
                        return;
                      }
                      setRegenerating(true);
                      setSaveError('');
                      try {
                        await onRegeneratePackage(activeClip.id, true);
                      } catch (error: any) {
                        setSaveError(error?.message || 'Lỗi đặt lại gợi ý');
                      } finally {
                        setRegenerating(false);
                      }
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>

              {saveSuccess && (
                <div style={{ color: '#34D399', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Check size={14} /> Đã cập nhật và lưu thumbnail HD thành công!
                </div>
              )}
              {saveError && (
                <div style={{ color: '#F87171', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={14} /> {saveError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clip list cards Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {completedClips.map((clip) => {
            const isSelected = activeClip?.id === clip.id;
            const isHD = clip.outputPath ? /_hd\.mp4$/i.test(clip.outputPath) : false;
            const hasRealCaptions = job.transcript.some(
              (s) => !s.isPlaceholder && !/^\[Đoạn nói \d+\]/i.test(s.text)
            );

            return (
              <div
                key={clip.id}
                onClick={() => setActiveClipId(clip.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-elevated)',
                  border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 18px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
                  {clip.thumbnailPath ? (
                    <img
                      src={`file://${encodeURI(clip.thumbnailPath)}?v=${encodeURIComponent(clip.updatedAt || '')}`}
                      alt={`Thumbnail: ${clip.thumbnailHook || clip.title}`}
                      style={{
                        width: 85,
                        height: 135,
                        objectFit: 'cover',
                        borderRadius: 8,
                        flexShrink: 0,
                        border: '1px solid var(--border-subtle)',
                      }}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 85,
                        height: 135,
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px dashed var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-dim)',
                        flexShrink: 0,
                        fontSize: '0.7rem',
                        textAlign: 'center',
                        padding: 4,
                      }}
                    >
                      Chưa có thumbnail
                    </div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{clip.title}</span>
                      {statusBadge(clip.publishStatus)}
                      {isHD && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(245, 158, 11, 0.2)',
                            color: '#FBBF24',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                            fontWeight: 700,
                            fontSize: '0.68rem',
                            padding: '2px 7px',
                          }}
                        >
                          HD
                        </span>
                      )}
                      {!hasRealCaptions && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(148, 163, 184, 0.15)',
                            color: '#94A3B8',
                            border: '1px solid rgba(148, 163, 184, 0.3)',
                            fontSize: '0.68rem',
                            padding: '2px 7px',
                          }}
                        >
                          No real captions
                        </span>
                      )}
                      {clip.hdEnhanceFailed && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#F87171',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            fontSize: '0.68rem',
                            padding: '2px 7px',
                          }}
                        >
                          HD enhance failed
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
                      {clip.duration ? `${clip.duration.toFixed(0)} giây` : ''} • MP4 (H.264/AAC)
                      {clip.renderEngine ? ` • Engine: ${clip.renderEngine}` : ''}
                    </div>

                    {clip.publishTitle && (
                      <div style={{ marginTop: 8, fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                        <strong>Title:</strong> {clip.publishTitle}
                      </div>
                    )}
                    {clip.thumbnailHook && (
                      <div style={{ marginTop: 4, fontSize: '0.8rem', color: '#FBBF24' }}>
                        <strong>Hook trên thumbnail:</strong> {clip.thumbnailHook}
                      </div>
                    )}
                    {!!clip.hashtags?.length && (
                      <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {clip.hashtags.join(' ')}
                      </div>
                    )}
                    {clip.publishWarning && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: '0.76rem',
                          color: clip.publishStatus === 'failed' ? '#F87171' : '#FBBF24',
                        }}
                      >
                        ⚠️ {clip.publishWarning}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, marginLeft: 12 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => clip.outputPath && onShowInFolder(clip.outputPath)}
                    title="Hiển thị video MP4 trong Finder"
                  >
                    <ExternalLink size={13} /> Finder
                  </button>
                  {clip.thumbnailPath && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onShowInFolder(clip.thumbnailPath!)}
                      title="Hiển thị ảnh thumbnail HD trong Finder"
                    >
                      <Image size={13} /> Thumbnail HD
                    </button>
                  )}
                  {onRegeneratePackage && (!clip.thumbnailPath || clip.publishStatus === 'failed') && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => onRegeneratePackage(clip.id, false)}
                      title="Tạo lại thumbnail & metadata"
                    >
                      <RefreshCw size={13} /> Tạo lại
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
