import React from 'react';
import { Film, CheckCircle2, AlertTriangle, Clock, PlusCircle } from 'lucide-react';
import { EnvironmentStatus } from '../../main/types';

interface HeaderProps {
  envStatus: EnvironmentStatus | null;
  onOpenHistory: () => void;
  onNewJob: () => void;
}

export const Header: React.FC<HeaderProps> = ({ envStatus, onOpenHistory, onNewJob }) => {
  return (
    <header className="top-bar">
      <div className="brand-section non-drag">
        <div className="logo-badge">
          <Film size={22} />
        </div>
        <div>
          <h1 className="brand-title">AutoClip Studio</h1>
          <div className="brand-subtitle">Powered by Hypit Video Engine</div>
        </div>
      </div>

      <div className="sys-status-pills non-drag">
        {/* Hypit status */}
        <div className="sys-pill" title={envStatus?.hypitPath || 'Chưa cài đặt'}>
          <div className={`sys-dot ${envStatus?.hypitOk ? 'online' : 'warning'}`} />
          <span>Hypit: {envStatus?.hypitOk ? envStatus.hypitVersion.split(' ')[1] || '0.2.16' : 'Offline'}</span>
        </div>

        {/* FFmpeg status */}
        <div className="sys-pill">
          <div className={`sys-dot ${envStatus?.ffmpegOk ? 'online' : 'warning'}`} />
          <span>FFmpeg: {envStatus?.ffmpegOk ? envStatus.ffmpegVersion : 'Chưa có'}</span>
        </div>

        {/* Node status */}
        <div className="sys-pill">
          <div className="sys-dot online" />
          <span>Node {envStatus?.nodeVersion || 'v22'}</span>
        </div>

        {/* Actions */}
        <button
          className="btn btn-secondary btn-sm"
          onClick={onOpenHistory}
          title="Xem lịch sử các dự án đã lưu"
        >
          <Clock size={14} />
          Lịch sử dự án
        </button>

        <button
          className="btn btn-primary btn-sm"
          onClick={onNewJob}
          title="Tạo dự án dựng shorts mới"
        >
          <PlusCircle size={14} />
          Dự án mới
        </button>
      </div>
    </header>
  );
};
