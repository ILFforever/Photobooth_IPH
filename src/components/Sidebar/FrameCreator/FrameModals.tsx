import { createPortal } from 'react-dom';
import { Frame } from '../../../types/frame';
import './FrameModals.css';

interface FrameModalsProps {
  // Save dialog state
  showSaveDialog: boolean;
  setShowSaveDialog: (show: boolean) => void;
  saveError: string;
  setSaveError: (error: string) => void;
  saveSuccess: boolean;
  setSaveSuccess: (success: boolean) => void;
  newFrameName: string;
  setNewFrameName: (name: string) => void;

  // Replace confirm state
  showReplaceConfirm: boolean;
  setShowReplaceConfirm: (show: boolean) => void;
  existingFrameToReplace: Frame | null;
  pendingApplyAfterSave: boolean;

  // Load dialog state
  showLoadDialog: boolean;
  setShowLoadDialog: (show: boolean) => void;
  customFrames: Frame[];

  // New confirm state
  showNewConfirm: boolean;
  setShowNewConfirm: (show: boolean) => void;

  // Callbacks
  saveFrame: (name: string, forceReplace: boolean, shouldApply: boolean) => Promise<void>;
  confirmReplace: () => void;
  cancelReplace: () => void;
  loadFrame: (frame: Frame) => void;
  confirmNew: () => void;
}

export function FrameModals({
  showSaveDialog,
  setShowSaveDialog,
  saveError,
  setSaveError,
  saveSuccess,
  setSaveSuccess,
  newFrameName,
  setNewFrameName,
  showReplaceConfirm,
  existingFrameToReplace,
  showLoadDialog,
  setShowLoadDialog,
  customFrames,
  showNewConfirm,
  setShowNewConfirm,
  saveFrame,
  confirmReplace,
  cancelReplace,
  loadFrame,
  confirmNew,
}: FrameModalsProps) {
  const portalRoot = document.getElementById('modal-portal-root');
  if (!portalRoot) return null;

  return (
    <>
      {/* Save Dialog Modal — Portal */}
      {showSaveDialog && createPortal(
        <div className="confirm-overlay" onClick={() => setShowSaveDialog(false)} style={{ position: 'fixed' }}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon save-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </div>
            <h3>{saveSuccess ? 'Saved!' : 'Save Frame'}</h3>
            {!saveSuccess && (
              <input
                type="text"
                placeholder="Enter frame name..."
                value={newFrameName}
                onChange={(e) => {
                  setNewFrameName(e.target.value);
                  setSaveError('');
                }}
                className="frame-name-input"
                autoFocus
              />
            )}
            {saveError && <div className="save-error">{saveError}</div>}
            {saveSuccess && <p className="save-success-text">Frame saved successfully</p>}
            {!saveSuccess && (
              <div className="save-dialog-actions">
                <button
                  className="confirm-btn primary full-width"
                  onClick={() => saveFrame(newFrameName, false, true)}
                  title="Save and apply this frame"
                >
                  Save & Apply
                </button>
                <div className="confirm-actions">
                  <button
                    className="confirm-btn cancel"
                    onClick={() => {
                      setShowSaveDialog(false);
                      setSaveError('');
                      setSaveSuccess(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button className="confirm-btn secondary" onClick={() => saveFrame(newFrameName, false, false)}>
                    Save Only
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        portalRoot
      )}

      {/* Replace Confirmation Modal — Portal */}
      {showReplaceConfirm && createPortal(
        <div className="confirm-overlay" onClick={cancelReplace} style={{ position: 'fixed' }}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01"/>
                <path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"/>
              </svg>
            </div>
            <h3>Replace Frame?</h3>
            <p>
              A frame named "<strong>{existingFrameToReplace?.name}</strong>" already exists. Do you want to replace it?
            </p>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={cancelReplace}>
                Cancel
              </button>
              <button className="confirm-btn danger" onClick={confirmReplace}>
                Replace
              </button>
            </div>
          </div>
        </div>,
        portalRoot
      )}

      {/* Load Dialog Modal — Portal */}
      {showLoadDialog && createPortal(
        <div className="modal-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="modal-content load-dialog-content" onClick={(e) => e.stopPropagation()}>
            <h3>Load Frame</h3>
            <div className="frames-list">
              {customFrames.length === 0 ? (
                <div className="empty-frames">No saved frames found</div>
              ) : (
                customFrames.map((frame) => (
                  <div key={frame.id} className="saved-frame-item" onClick={() => loadFrame(frame)}>
                    <div className="frame-info">
                      <span className="frame-name">{frame.name}</span>
                      <span className="frame-zones-count">
                        {frame.zones.length} zone{frame.zones.length !== 1 ? 's' : ''} · {frame.width}×{frame.height}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel-btn" onClick={() => setShowLoadDialog(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>,
        portalRoot
      )}

      {/* New Confirm Modal — Portal */}
      {showNewConfirm && createPortal(
        <div className="confirm-overlay" onClick={() => setShowNewConfirm(false)} style={{ position: 'fixed' }}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01"/>
                <path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"/>
              </svg>
            </div>
            <h3>Clear All Zones?</h3>
            <p>Starting a new frame will clear your current work. This action cannot be undone.</p>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={() => setShowNewConfirm(false)}>
                Cancel
              </button>
              <button className="confirm-btn danger" onClick={confirmNew}>
                Clear All
              </button>
            </div>
          </div>
        </div>,
        portalRoot
      )}
    </>
  );
}
