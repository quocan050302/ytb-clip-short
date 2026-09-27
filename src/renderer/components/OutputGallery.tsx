import React, { useState } from 'react';
import { Film, FolderOpen, Play, CheckCircle2, Download, ExternalLink, Code } from 'lucide-react';
import { RenderedClip, JobMetadata } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface OutputGalleryProps {
  job: JobMetadata;
  onOpenFolder: (path: string) => void;
  onShowInFolder: (path: string) => void;
}

export const OutputGallery: React.FC<OutputGalleryProps> = ({
  job,
  onOpenFolder,
  onShowInFolder,
}) => {
  const completedClips = job.clips.filter((c) => c.status === 'completed' && c.outputPath);
  const [activeClip, setActiveClip] = useState<RenderedClip>(completedClips[0] || job.clips[0]);

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
            title="Mở thư mục chứa toàn bộ video MP4 thành phẩm"
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
        </div>

        {/* Clip list cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {completedClips.map((clip) => {
            const isSelected = activeClip?.id === clip.id;
            return (
              <div
                key={clip.id}
                onClick={() => setActiveClip(clip)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-elevated)',
                  border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 18px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{clip.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 2 }}>
                      {clip.duration ? `${clip.duration.toFixed(0)} giây` : ''} • MP4 (H.264/AAC)
                    </div>
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
