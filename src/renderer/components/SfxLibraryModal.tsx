import React, { useState, useEffect, useRef } from 'react';
import {
  FolderPlus,
  FileAudio,
  Play,
  Square,
  Trash2,
  Edit2,
  Check,
  X,
  AlertCircle,
  HelpCircle,
  Tag,
  Search,
  CheckCircle2,
  RefreshCw,
  Folder,
} from 'lucide-react';
import { ImportedSfxMetadata, ImportResult } from '../../main/types';

interface SfxLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssetChanged?: () => void;
}

export const SfxLibraryModal: React.FC<SfxLibraryModalProps> = ({
  isOpen,
  onClose,
  onAssetChanged,
}) => {
  const [items, setItems] = useState<ImportedSfxMetadata[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ImportedSfxMetadata>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadImportedSfx();
    } else {
      stopAudio();
    }
  }, [isOpen]);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const loadImportedSfx = async () => {
    if (!window.electronAPI) return;
    setIsLoading(true);
    try {
      const data = await window.electronAPI.getImportedSfx();
      setItems(data);
    } catch (err) {
      console.error('Failed to load imported SFX:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportFiles = async (mode: 'files' | 'folder') => {
    if (!window.electronAPI) return;
    setIsLoading(true);
    setImportResult(null);
    try {
      const res = await window.electronAPI.importSfxDialog(mode);
      if (res) {
        setImportResult(res);
        await loadImportedSfx();
        if (onAssetChanged) onAssetChanged();
      }
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleAudition = (item: ImportedSfxMetadata) => {
    if (playingId === item.id) {
      stopAudio();
      return;
    }

    stopAudio();
    try {
      const audioUrl = `file://${item.filePath}`;
      const audio = new Audio(audioUrl);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      audio.play().then(() => {
        audioRef.current = audio;
        setPlayingId(item.id);
      }).catch(() => setPlayingId(null));
    } catch {
      setPlayingId(null);
    }
  };

  const startEdit = (item: ImportedSfxMetadata) => {
    setEditingId(item.id);
    setEditForm({
      displayName: item.displayName,
      category: item.category,
      tags: [...(item.tags || [])],
      license: item.license || 'Chưa xác nhận',
      reviewStatus: item.reviewStatus || 'approved',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id: string) => {
    if (!window.electronAPI) return;
    try {
      const updated = await window.electronAPI.updateImportedSfx(id, editForm);
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setEditingId(null);
      setEditForm({});
      if (onAssetChanged) onAssetChanged();
    } catch (err) {
      console.error('Failed to update SFX metadata:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.electronAPI) return;
    const item = items.find((i) => i.id === id);
    const confirmed = window.confirm(`Bạn có chắc muốn xóa SFX "${item?.displayName || id}" khỏi thư viện bền vững?`);
    if (!confirmed) return;

    if (playingId === id) stopAudio();

    try {
      const ok = await window.electronAPI.deleteImportedSfx(id);
      if (ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (onAssetChanged) onAssetChanged();
      }
    } catch (err) {
      console.error('Failed to delete SFX:', err);
    }
  };

  if (!isOpen) return null;

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      searchQuery === '' ||
      item.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.originalFilename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.tags && item.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())));

    const matchesCategory =
      selectedCategory === 'all' ||
      (selectedCategory === 'needs_review'
        ? item.reviewStatus === 'needs_review'
        : item.category === selectedCategory);

    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(items.map((i) => i.category || 'other')));

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 960, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 24 }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: 14,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--status-info)',
              }}
            >
              <FileAudio size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Quản Lý Thư Viện SFX Local
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: 0 }}>
                Lưu trữ bền vững trong app, tự chuẩn hóa tên snake_case, chống trùng SHA-256, không sửa file gốc.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleImportFiles('files')}
              disabled={isLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FileAudio size={14} /> Import File MP3/WAV...
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleImportFiles('folder')}
              disabled={isLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FolderPlus size={14} /> Import Thư Mục SFX...
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              style={{ padding: '6px 8px' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Import Results Banner */}
        {importResult && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              marginBottom: 14,
              fontSize: '0.8rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={16} color="var(--status-success)" />
                Kết quả import SFX:
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setImportResult(null)}
                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
              >
                Đóng
              </button>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--status-success)' }}>
                Đã thêm mới: <strong>{importResult.imported.length}</strong> file
              </span>
              <span style={{ color: 'var(--status-warning)' }}>
                Bỏ qua trùng SHA-256: <strong>{importResult.duplicates.length}</strong> file
              </span>
              {importResult.failed.length > 0 && (
                <span style={{ color: 'var(--status-danger)' }}>
                  File lỗi/không hợp lệ: <strong>{importResult.failed.length}</strong> file
                </span>
              )}
            </div>
            {importResult.duplicates.length > 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4 }}>
                File trùng: {importResult.duplicates.map((d) => d.filename).join(', ')}
              </div>
            )}
            {importResult.failed.length > 0 && (
              <div style={{ fontSize: '0.72rem', color: '#F87171', marginTop: 4 }}>
                Lỗi: {importResult.failed.map((f) => `${f.path} (${f.error})`).join('; ')}
              </div>
            )}
          </div>
        )}

        {/* Filter and Search Bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-dim)' }} />
            <input
              type="text"
              placeholder="Tìm kiếm theo tên hiển thị, tên gốc hoặc thẻ tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-input"
              style={{ width: '100%', paddingLeft: 32, fontSize: '0.82rem' }}
            />
          </div>

          <select
            className="text-input"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{ fontSize: '0.82rem', padding: '6px 10px', minWidth: 160 }}
          >
            <option value="all">Tất cả danh mục ({items.length})</option>
            <option value="needs_review">⚠️ Cần kiểm tra ({items.filter((i) => i.reviewStatus === 'needs_review').length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()} ({items.filter((i) => i.category === c).length})
              </option>
            ))}
          </select>

          <button
            className="btn btn-secondary btn-sm"
            onClick={loadImportedSfx}
            title="Làm mới danh sách"
            style={{ padding: '6px 10px' }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* SFX List Content */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
          {filteredItems.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--text-dim)',
                background: 'rgba(0,0,0,0.15)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <HelpCircle size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>
                {items.length === 0 ? 'Chưa có SFX local nào được import' : 'Không tìm thấy SFX phù hợp bộ lọc'}
              </div>
              <div style={{ fontSize: '0.78rem' }}>
                Bấm "Import File MP3/WAV..." hoặc "Import Thư Mục SFX..." ở trên để tải các âm thanh vào thư viện bền vững.
              </div>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isPlaying = playingId === item.id;
              const isEditing = editingId === item.id;
              const needsReview = item.reviewStatus === 'needs_review';

              return (
                <div
                  key={item.id}
                  style={{
                    background: needsReview ? 'rgba(245, 158, 11, 0.06)' : 'var(--bg-elevated)',
                    border: `1px solid ${needsReview ? 'rgba(245, 158, 11, 0.3)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Top Bar: Play, Display Name, Category, Badges, Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                      <button
                        className={`btn ${isPlaying ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                        onClick={() => handleToggleAudition(item)}
                        style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}
                        title={isPlaying ? 'Dừng phát' : 'Nghe thử âm thanh'}
                      >
                        {isPlaying ? <Square size={12} /> : <Play size={12} />}
                        {isPlaying ? 'Dừng' : 'Phát'}
                      </button>

                      {!isEditing ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-main)' }}>
                              {item.displayName}
                            </span>
                            <span
                              className="badge"
                              style={{
                                fontSize: '0.68rem',
                                background: needsReview ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                                color: needsReview ? '#FBBF24' : 'var(--status-info)',
                              }}
                            >
                              {item.category?.toUpperCase() || 'SFX'}
                            </span>
                            {needsReview ? (
                              <span
                                className="badge"
                                style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#F87171', fontSize: '0.65rem' }}
                              >
                                ⚠️ Cần kiểm tra âm thanh
                              </span>
                            ) : (
                              <span
                                className="badge badge-success"
                                style={{ fontSize: '0.65rem' }}
                              >
                                ✓ Đã chuẩn hóa
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>
                            File gốc: <code>{item.originalFilename}</code> ➔ Lưu: <code>{item.storedFilename}</code>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center' }}>
                          <input
                            type="text"
                            className="text-input"
                            style={{ flex: 2, fontSize: '0.82rem', padding: '4px 8px' }}
                            value={editForm.displayName || ''}
                            onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                            placeholder="Tên hiển thị..."
                          />
                          <select
                            className="text-input"
                            style={{ flex: 1, fontSize: '0.82rem', padding: '4px 8px' }}
                            value={editForm.category || 'other'}
                            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          >
                            <option value="impact">impact</option>
                            <option value="reaction">reaction</option>
                            <option value="comedy">comedy</option>
                            <option value="reveal">reveal</option>
                            <option value="money">money</option>
                            <option value="transition">transition</option>
                            <option value="chase">chase</option>
                            <option value="fail">fail</option>
                            <option value="other">other</option>
                          </select>
                          <select
                            className="text-input"
                            style={{ flex: 1, fontSize: '0.82rem', padding: '4px 8px' }}
                            value={editForm.reviewStatus || 'approved'}
                            onChange={(e) => setEditForm({ ...editForm, reviewStatus: e.target.value as any })}
                          >
                            <option value="approved">Đã duyệt (Approved)</option>
                            <option value="needs_review">Cần duyệt (Needs Review)</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!isEditing ? (
                        <>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => startEdit(item)}
                            title="Sửa tên, category, tags hoặc license"
                          >
                            <Edit2 size={12} /> Sửa
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                            onClick={() => handleDelete(item.id)}
                            title="Xóa khỏi thư viện app"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => saveEdit(item.id)}
                          >
                            <Check size={12} /> Lưu
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                            onClick={cancelEdit}
                          >
                            <X size={12} /> Hủy
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Tags and Technical Metadata */}
                  {!isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, fontSize: '0.74rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <Tag size={12} color="var(--text-dim)" />
                        {item.tags && item.tags.length > 0 ? (
                          item.tags.map((t) => (
                            <span
                              key={t}
                              className="badge badge-secondary"
                              style={{ fontSize: '0.68rem', padding: '1px 5px' }}
                            >
                              #{t}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Không có tag</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                        <span>Độ dài: <strong>{item.duration.toFixed(2)}s</strong></span>
                        {item.sampleRate && <span>{item.sampleRate} Hz</span>}
                        {item.channels && <span>{item.channels === 1 ? 'Mono' : 'Stereo'}</span>}
                        <span>Quyền: <strong>{item.license || 'Chưa xác nhận'}</strong></span>
                        <span title={`SHA-256: ${item.sha256}`}>Hash: <code>{item.sha256.substring(0, 8)}</code></span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, alignItems: 'center' }}>
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Thẻ tags (ngăn cách bằng dấu phẩy):
                        </label>
                        <input
                          type="text"
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={Array.isArray(editForm.tags) ? editForm.tags.join(', ') : ''}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
                            })
                          }
                          placeholder="impact, comedy, hit..."
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          Quyền sử dụng (License):
                        </label>
                        <input
                          type="text"
                          className="text-input"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                          value={editForm.license || ''}
                          onChange={(e) => setEditForm({ ...editForm, license: e.target.value })}
                          placeholder="Chưa xác nhận, CC0,..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 14,
            marginTop: 14,
            fontSize: '0.78rem',
            color: 'var(--text-dim)',
          }}
        >
          <div>
            Tổng số SFX đã import: <strong>{items.length}</strong> file. Sẵn sàng sử dụng cho thuật toán AI đề xuất âm thanh.
          </div>
          <button className="btn btn-secondary" onClick={onClose}>
            Đóng Thư Viện
          </button>
        </div>
      </div>
    </div>
  );
};
