import { X, AlertCircle, RefreshCw, RotateCw, HelpCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { VmLogEntry } from '../../../../hooks/useVmLogs';

interface VmLogsModalProps {
  show: boolean;
  isVmOnline: boolean;
  vmLogs: VmLogEntry[];
  isLoadingLogs: boolean;
  logsError: string | null;
  isRestartingVm: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRestart: () => void;
  onShowLedInfo?: () => void;
}

export function VmLogsModal({
  show,
  isVmOnline,
  vmLogs,
  isLoadingLogs,
  logsError,
  isRestartingVm,
  onClose,
  onRefresh,
  onRestart,
  onShowLedInfo,
}: VmLogsModalProps) {
  const logsContentRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when modal opens or logs update
  useEffect(() => {
    if (show && logsContentRef.current) {
      logsContentRef.current.scrollTop = logsContentRef.current.scrollHeight;
    }
  }, [show, vmLogs]);

  if (!show) return null;

  return (
    <div className="vm-logs-modal-overlay" onClick={onClose}>
      <div className="vm-logs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vm-logs-modal-header">
          <h3 className="vm-logs-modal-title">
            <div className={`vm-logs-status-indicator ${isVmOnline ? 'online' : 'offline'}`} />
            Linux VM Logs
          </h3>
          <button className="vm-logs-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="vm-logs-modal-body">
          {logsError ? (
            <div className="vm-logs-error">
              <AlertCircle size={32} />
              <span>{logsError}</span>
            </div>
          ) : isLoadingLogs && vmLogs.length === 0 ? (
            <div className="vm-logs-empty">Loading logs...</div>
          ) : vmLogs.length === 0 ? (
            <div className="vm-logs-empty">No logs available</div>
          ) : (
            <div className="vm-logs-content" ref={logsContentRef}>
              {vmLogs.map((log, index) => (
                <div key={index} className="vm-logs-entry">
                  {log.timestamp && <span className="vm-logs-timestamp">{log.timestamp}</span>}
                  <span className={`vm-logs-message ${log.level} ${log.message.toLowerCase().includes('error') ? 'has-error' : ''} ${log.message.includes('GET') ? 'get-request' : ''} ${log.message.startsWith('Connection from') ? 'connection-log' : ''} ${log.message.includes('controller: Received') ? 'controller-received' : ''} ${log.message.includes('controller: Downloaded') ? 'controller-downloaded' : ''} ${log.message.includes('controller: Emitted') ? 'controller-emitted' : ''} ${log.message.includes('controller: Deleted') ? 'controller-deleted' : ''}`}>{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="vm-logs-footer">
          <span className="vm-logs-status-text">
            {isVmOnline ? 'Connected' : 'Disconnected'} • {vmLogs.length} entries
          </span>
          <div className="vm-logs-footer-buttons">
            {onShowLedInfo && (
              <button
                className="vm-logs-led-info-btn"
                onClick={onShowLedInfo}
                title="LED Status Guide"
              >
                <HelpCircle size={14} />
                LED Guide
              </button>
            )}
            <button
              className={`vm-logs-restart-btn ${isRestartingVm ? 'spinning' : ''}`}
              onClick={onRestart}
              disabled={isRestartingVm}
              title="Restart VM"
            >
              <RotateCw size={14} />
              {isRestartingVm ? 'Restarting...' : 'Restart VM'}
            </button>
            <button
              className={`vm-logs-refresh-btn ${isLoadingLogs ? 'spinning' : ''}`}
              onClick={onRefresh}
              disabled={!isVmOnline || isLoadingLogs}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
