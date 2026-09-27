import React, { useState } from 'react';
import { Upload, Film, FileVideo, Check, Info } from 'lucide-react';
import { VideoInfo } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface VideoUploaderProps {
  videoPath: string | null;
  videoInfo: VideoInfo | null;
  onSelectVideo: (filePath: string) => void;
}

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  videoPath,
  videoInfo,
  onSelectVideo,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleBrowse = async () => {
    try {
      const selected = await window.electronAPI.selectVideoFile();
      if (selected) {
        onSelectVideo(selected);
      }
    } catch (err) {
      console.error('Error selecting video:', err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      // On Electron, file objects often have .path
      const filePath = (file as any).path;
      if (filePath) {
        onSelectVideo(filePath);
      }
    }
  };

  return (
    <div className="glass-card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Film size={18} color="var(--accent-primary)" />
        1. Chọn Video Nguồn (MP4, MOV)
      </h3>

      {!videoPath ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowse}
          style={{
            border: `2px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: '40px 20px',
            textAlign: 'center',
            background: isDragging ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(99, 102, 241, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'var(--accent-primary)',
            }}
          >
            <Upload size={28} />
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>
            Kéo thả video vào đây hoặc <span style={{ color: 'var(--accent-primary)' }}>chọn từ máy tính</span>
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Hỗ trợ MP4, MOV, MKV với độ dài bất kỳ (ví dụ: podcast, stream, bài giảng 10 - 60 phút)
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--status-success)',
              }}
            >
              <FileVideo size={24} />
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, wordBreak: 'break-all' }}>
                {videoPath.split('/').pop()}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12 }}>
                {videoInfo && (
                  <>
                    <span>Thời lượng: <strong>{formatTime(videoInfo.duration)}</strong> ({videoInfo.duration.toFixed(1)}s)</span>
                    <span>Độ phân giải: <strong>{videoInfo.width}x{videoInfo.height}</strong></span>
                    <span>FPS: <strong>{videoInfo.fps}</strong></span>
                    <span>Âm thanh: <strong>{videoInfo.hasAudio ? 'Có audio' : 'Không có'}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={handleBrowse}>
            Đổi video khác
          </button>
        </div>
      )}
    </div>
  );
};
