import React from 'react';
import { X, Clock, Trash2, FolderOpen, Film, ArrowRight } from 'lucide-react';
import { JobMetadata } from '../../main/types';
import { formatTime } from '../../shared/formatTime';

interface JobsDrawerProps {
  isOpen: boolean;
  jobs: JobMetadata[];
  currentJobId?: string;
  onSelectJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onClose: () => void;
}

export const JobsDrawer: React.FC<JobsDrawerProps> = ({
  isOpen,
  jobs,
  currentJobId,
  onSelectJob,
  onDeleteJob,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 550,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h4 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="var(--accent-primary)" />
            Lịch Sử Các Dự Án Đã Dựng ({jobs.length})
          </h4>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
          {jobs.map((job) => {
            const isCurrent = job.id === currentJobId;
            const completedClips = job.clips.filter((c) => c.status === 'completed').length;

            return (
              <div
                key={job.id}
                style={{
                  background: isCurrent ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-elevated)',
                  border: `1px solid ${isCurrent ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => onSelectJob(job.id)}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{job.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 2 }}>
                    Tạo: {new Date(job.createdAt).toLocaleDateString()} • {job.videoInfo.duration ? formatTime(job.videoInfo.duration) : ''} • {completedClips}/{job.clips.length} clip đã render
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => onSelectJob(job.id)}
                    title="Mở dự án này"
                  >
                    <ArrowRight size={13} /> Mở
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => onDeleteJob(job.id)}
                    title="Xóa dự án khỏi đĩa"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          {jobs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-dim)' }}>
              Chưa có dự án nào được lưu trên đĩa.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
