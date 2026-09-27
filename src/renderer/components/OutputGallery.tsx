import React, { useEffect, useState } from 'react';
import { FolderOpen, Play, CheckCircle2, ExternalLink, Code } from 'lucide-react';
import { RenderedClip, JobMetadata } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface OutputGalleryProps {
  job: JobMetadata;
  onOpenFolder: (path: string) => void;
  onShowInFolder: (path: string) => void;
  onUpdatePackage: (clipId: string, title: string, hook: string, hashtags: string[]) => Promise<void>;
}

export const OutputGallery: React.FC<OutputGalleryProps> = ({
  job,
  onOpenFolder,
  onShowInFolder,
  onUpdatePackage,
}) => {
  const completedClips = job.clips.filter((c) => c.status === 'completed' && c.outputPath);
  const [activeClipId, setActiveClipId] = useState(completedClips[0]?.id || '');
  const activeClip = completedClips.find(c => c.id === activeClipId) || completedClips[0];
  const [draftTitle, setDraftTitle] = useState('');
  const [draftHook, setDraftHook] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraftTitle(activeClip?.publishTitle || '');
    setDraftHook(activeClip?.thumbnailHook || '');
    setDraftTags(activeClip?.hashtags?.join(' ') || '');
    setSaveError('');
  }, [activeClip?.id, activeClip?.updatedAt]);

  if (completedClips.length === 0) {
    return null;
  }

  const outputDir = `${job.jobDir}/outputs`;
  const hypitProjectsDir = `${job.jobDir}/hypit_projects`;

  return (
    <div className="glass-card" style={{ marginBottom: 30 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--status-success)' }}>
            <CheckCircle2 size={22} />
            4. Video Shorts Đã Xuất Thành Công ({completedClips.length} clips)
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginTop: 4 }}>
            Tất cả clip đã được render MP4 theo tỷ lệ {job.settings.aspectRatio} và giữ nguyên project Hypit để chỉnh sửa lại khi cần.
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

      {/* Main player + list layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 420px) 1fr', gap: 24 }}>
        {/* Built-in Video Player */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: job.settings.aspectRatio === '9:16' ? '9/16' : '16/9',
              maxHeight: 520,
              background: '#000',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
              margin: '0 auto',
            }}
          >
            {activeClip?.outputPath ? (
              <video
                key={activeClip.outputPath}
                src={`file://${activeClip.outputPath}`}
                controls
                autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                Chọn một clip để xem
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Đang phát: <strong>{activeClip?.title}</strong>
          </div>
          {activeClip && (
            <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              <label className="input-label">Title khi đăng Short</label>
              <input className="text-input" value={draftTitle} maxLength={100}
                onChange={e => setDraftTitle(e.target.value)} />
              <label className="input-label">Hook chỉ xuất hiện trên thumbnail</label>
              <input className="text-input" value={draftHook} maxLength={32}
                onChange={e => setDraftHook(e.target.value)} />
              <label className="input-label">Hashtag (cách nhau bằng dấu cách)</label>
              <input className="text-input" value={draftTags}
                onChange={e => setDraftTags(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setSaveError('');
                  try {
                    await onUpdatePackage(activeClip.id, draftTitle, draftHook, draftTags.split(/\s+/));
                  } catch (error: any) {
                    setSaveError(error?.message || 'Không lưu được thumbnail');
                  } finally { setSaving(false); }
                }}>{saving ? 'Đang cập nhật...' : 'Lưu và tạo lại thumbnail HD'}</button>
              {saveError && <div style={{ color: '#F87171', fontSize: '0.8rem' }}>{saveError}</div>}
            </div>
          )}
        </div>

        {/* Clip list cards */}
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
                  {clip.thumbnailPath && (
                    <img
                      src={`file://${clip.thumbnailPath}?v=${encodeURIComponent(clip.updatedAt)}`}
                      alt={`Thumbnail: ${clip.thumbnailHook || clip.title}`}
                      style={{ width: 85, height: 135, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                    />
                  )}
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: isSelected ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#FFF',
                    }}
                  >
                    <Play size={16} style={{ marginLeft: 2 }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{clip.title}</span>
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
                          HD enhance failed, using normal render
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 2 }}>
                      {clip.duration ? `${clip.duration.toFixed(0)} giây` : ''} • MP4 (H.264/AAC)
                      {clip.renderEngine ? ` • Engine: ${clip.renderEngine}` : ''}
                    </div>
                    {clip.publishTitle && (
                      <div style={{ marginTop: 9, fontSize: '0.84rem', color: 'var(--text-primary)' }}>
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
                      <div style={{ marginTop: 5, fontSize: '0.76rem', color: '#F87171' }}>{clip.publishWarning}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => clip.outputPath && onShowInFolder(clip.outputPath)}
                    title="Hiển thị vị trí file trong Finder"
                  >
                    <ExternalLink size={13} /> Finder
                  </button>
                  {clip.thumbnailPath && (
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => onShowInFolder(clip.thumbnailPath!)}
                      title="Hiển thị ảnh thumbnail HD trong Finder">
                      <ExternalLink size={13} /> Thumbnail HD
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
