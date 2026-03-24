import { motion, AnimatePresence } from "framer-motion";
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, AlertCircle, Package, CheckCircle2, Film } from 'lucide-react';
import { useToast } from '../../../contexts';
import './FFmpegDownloadModal.css';
import "../../../styles/Modal.css";
import "../../../styles/Buttons.css";
import { createLogger } from '../../../utils/logger';
const logger = createLogger('FFmpegDownloadModal');

interface FFmpegDownloadModalProps {
  show: boolean;
  onClose: () => void;
  onDownloadComplete: () => void;
}

type DownloadState = 'idle' | 'checking' | 'downloading' | 'complete' | 'error';

interface DownloadProgress {
  current_bytes: number;
  total_bytes: number;
  percentage: number;
  stage: string;
}

export default function FFmpegDownloadModal({
  show,
  onClose,
  onDownloadComplete,
}: FFmpegDownloadModalProps) {
  const { showToast } = useToast();
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState<DownloadProgress>({
    current_bytes: 0,
    total_bytes: 0,
    percentage: 0,
    stage: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [ffmpegVersion, setFfmpegVersion] = useState<string | null>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!show) {
      setDownloadState('idle');
      setProgress({
        current_bytes: 0,
        total_bytes: 0,
        percentage: 0,
        stage: '',
      });
      setError(null);
      setFfmpegVersion(null);
    }
  }, [show]);

  // Check if FFmpeg is already installed when modal opens
  useEffect(() => {
    if (!show) return;

    const checkInstallation = async () => {
      try {
        logger.debug('[FFMPEG MODAL] Checking installation...');
        setDownloadState('checking');

        const isInstalled = await invoke<boolean>('check_ffmpeg_installed');

        if (isInstalled) {
          logger.debug('[FFMPEG MODAL] FFmpeg already installed');
          try {
            const version = await invoke<string>('get_ffmpeg_version');
            setFfmpegVersion(version);
            setDownloadState('complete');
          } catch (e) {
            // Version check failed, but it's installed
            setDownloadState('complete');
          }
        } else {
          logger.debug('[FFMPEG MODAL] FFmpeg not installed');
          setDownloadState('idle');
        }
      } catch (e) {
        logger.error('[FFMPEG MODAL] Check failed:', e);
        setError(String(e));
        setDownloadState('error');
      }
    };

    checkInstallation();
  }, [show]);

  // Listen for download progress
  useEffect(() => {
    if (!show || downloadState !== 'downloading') return;

    logger.debug('[FFMPEG MODAL] Setting up progress listener');

    const unlisten = listen<DownloadProgress>('ffmpeg-download-progress', (event) => {
      logger.debug('[FFMPEG MODAL] Progress update:', event.payload);
      setProgress(event.payload);

      if (event.payload.stage === 'complete') {
        setDownloadState('complete');
        // Show success toast
        showToast('FFmpeg downloaded successfully!', 'success', 3000);
        // Notify parent component
        onDownloadComplete();
      }
    });

    return () => {
      logger.debug('[FFMPEG MODAL] Cleaning up progress listener');
      unlisten.then(fn => fn());
    };
  }, [show, downloadState, onDownloadComplete, showToast]);

  // Format bytes to human readable size
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Handle download start
  const handleDownload = useCallback(async () => {
    logger.debug('[FFMPEG MODAL] Starting download...');
    setDownloadState('downloading');
    setError(null);

    try {
      const ffmpegUrl = 'https://firebasestorage.googleapis.com/v0/b/iph-ptb.firebasestorage.app/o/ffmpeg%2Fffmpeg.exe?alt=media';
      await invoke<string>('download_ffmpeg_command', { url: ffmpegUrl });
      logger.debug('[FFMPEG MODAL] Download initiated');
    } catch (e) {
      logger.error('[FFMPEG MODAL] Download failed:', e);
      setError(String(e));
      setDownloadState('error');
      showToast('Failed to download FFmpeg', 'error', 5000);
    }
  }, [showToast]);

  // Retry download
  const handleRetry = useCallback(() => {
    handleDownload();
  }, [handleDownload]);

  // Handle close
  const handleClose = useCallback(() => {
    if (downloadState === 'downloading') {
      // Don't allow closing while downloading
      return;
    }
    onClose();
  }, [downloadState, onClose]);

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="ffmpeg-modal-content"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="ffmpeg-modal-header">
            <div className="ffmpeg-modal-icon">
              <Film size={40} />
            </div>
            <div className="ffmpeg-modal-title">
              <h2>FFmpeg Required</h2>
              <p className="ffmpeg-modal-subtitle">
                {downloadState === 'complete'
                  ? 'FFmpeg is installed and ready!'
                  : 'Download FFmpeg to use video features'}
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="ffmpeg-modal-body">
            {/* Checking state */}
            {downloadState === 'checking' && (
              <div className="ffmpeg-modal-checking">
                <Loader2 className="spinner" size={24} />
                <span>Checking installation...</span>
              </div>
            )}

            {/* Idle state - show info and download button */}
            {downloadState === 'idle' && (
              <>
                <div className="ffmpeg-modal-info">
                  <div className="ffmpeg-modal-info-item">
                    <Package size={16} />
                    <span>
                      <strong>What is FFmpeg?</strong> A video processing tool needed for slideshow video generation and HDMI capture.
                    </span>
                  </div>
                  <div className="ffmpeg-modal-info-item">
                    <Package size={16} />
                    <span>
                      <strong>Size:</strong> ~200 MB (one-time download)
                    </span>
                  </div>
                  <div className="ffmpeg-modal-info-item">
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDownload}
                  className="btn-primary"
                >
                  <Download size={16} />
                  Download FFmpeg
                </motion.button>
              </>
            )}

            {/* Downloading state */}
            {downloadState === 'downloading' && (
              <div className="ffmpeg-modal-progress">
                <div className="ffmpeg-modal-progress-header">
                  <span>
                    {progress.stage === 'connecting' && 'Connecting...'}
                    {progress.stage === 'downloading' && 'Downloading...'}
                  </span>
                  <span>{progress.percentage.toFixed(1)}%</span>
                </div>
                <div className="ffmpeg-modal-progress-bar">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress.percentage}%` }}
                    transition={{ ease: 'linear' }}
                    className="ffmpeg-modal-progress-fill"
                  />
                </div>
                {progress.total_bytes > 0 && (
                  <div className="ffmpeg-modal-progress-info">
                    {formatBytes(progress.current_bytes)} / {formatBytes(progress.total_bytes)}
                  </div>
                )}
              </div>
            )}

            {/* Complete state */}
            {downloadState === 'complete' && (
              <div className="ffmpeg-modal-complete">
                <div className="ffmpeg-modal-complete-info">
                  <CheckCircle2 size={24} />
                  <div>
                    <strong>Ready to use!</strong>
                    {ffmpegVersion && (
                      <span className="ffmpeg-modal-version">{ffmpegVersion}</span>
                    )}
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleClose}
                  className="btn-primary"
                >
                  Continue
                </motion.button>
              </div>
            )}

            {/* Error state */}
            {downloadState === 'error' && (
              <div className="ffmpeg-modal-error">
                <AlertCircle size={24} />
                <div className="ffmpeg-modal-error-content">
                  <strong>Download Failed</strong>
                  <span>{error || 'An error occurred while downloading FFmpeg'}</span>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleRetry}
                    className="btn-secondary btn-sm"
                  >
                    <Download size={14} />
                    Retry
                  </motion.button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
