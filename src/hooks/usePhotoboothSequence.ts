import { useState, useEffect, useCallback, useRef } from 'react';
import { triggerCapture } from '../services/cameraCaptureService';
import { createLogger } from '../utils/logger';
const logger = createLogger('usePhotoboothSequence');

export type SequenceState = 'idle' | 'scramble' | 'countdown' | 'capturing' | 'photoConfirm' | 'waitingForPreview' | 'review' | 'betweenPhotos' | 'preCountdown' | 'complete' | 'manualReview';

interface SequenceConfig {
  delayBeforeFirstPhoto: number;
  delayBetweenPhotos: number;
  photoReviewTime: number;
  autoCount: number;
  onPhotoCaptured?: (photoNumber: number) => void;
  onPreviewLoaded?: () => void; // Called when entering waitingForPreview state
  onCaptureStart?: () => void; // Called when capture is initiated (sets downloading state)
}

export type ManualPhase = 'idle' | 'waiting' | 'review';

interface UsePhotoboothSequenceReturn {
  // Auto sequence state
  sequenceState: SequenceState;
  currentCountdown: number;
  reviewCountdown: number;
  photosTaken: number;
  scrambleTick: number;
  isPaused: boolean;

  // Manual capture state (completely separate from auto)
  manualPhase: ManualPhase;
  manualReviewCountdown: number;

  // Actions
  start: () => void;
  stop: () => void;
  stopIfActive: () => void;
  togglePause: () => void;
  captureNow: () => void;  // Single capture — uses manual state machine only
  notifyCaptureComplete: () => void;  // Auto only: photo_downloaded WS event
  startReviewCountdown: () => void;  // Called when preview image loads (handles both auto & manual)
  startManualReview: () => void;  // External camera capture — enters manual waiting

  // Derived
  isActive: boolean;
  isAutoRunning: boolean;
  isComplete: boolean;
}

export function usePhotoboothSequence(config: SequenceConfig): UsePhotoboothSequenceReturn {
  const [sequenceState, setSequenceState] = useState<SequenceState>('idle');
  const [currentCountdown, setCurrentCountdown] = useState(config.delayBeforeFirstPhoto);
  const [reviewCountdown, setReviewCountdown] = useState(0);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [scrambleTick, setScrambleTick] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [autoSequenceActive, setAutoSequenceActive] = useState(false);

  // ── Manual capture state (completely independent of auto) ──
  const [manualPhase, setManualPhase] = useState<ManualPhase>('idle');
  const [manualReviewCountdown, setManualReviewCountdown] = useState(0);

  // Ref mirror of sequenceState — updated synchronously so callbacks called
  // in the same event handler as stop() see the real current state.
  const sequenceStateRef = useRef<SequenceState>('idle');
  // Track if preview loaded while in photoConfirm state (before waitingForPreview)
  const previewLoadedRef = useRef(false);
  // Track if an auto-capture is in flight (set true in capturing effect, false on complete/stop)
  const capturingRef = useRef(false);
  const photoNumberRef = useRef(1);

  // Keep ref in sync with React state
  useEffect(() => {
    sequenceStateRef.current = sequenceState;
  }, [sequenceState]);

  const isActive = sequenceState !== 'idle' && sequenceState !== 'complete';

  // Start the auto sequence
  const start = useCallback(() => {
    setManualPhase('idle'); // Cancel any manual capture in progress
    setManualReviewCountdown(0);
    setPhotosTaken(0);
    setReviewCountdown(0);
    setIsPaused(false);
    setAutoSequenceActive(true);
    previewLoadedRef.current = false;
    setSequenceState('scramble');
  }, []);

  // Stop everything
  const stop = useCallback(() => {
    sequenceStateRef.current = 'idle';
    capturingRef.current = false;
    setAutoSequenceActive(false);
    setManualPhase('idle');
    setManualReviewCountdown(0);
    setSequenceState('idle');
    setCurrentCountdown(config.delayBeforeFirstPhoto);
    setPhotosTaken(0);
    setReviewCountdown(0);
    setIsPaused(false);
  }, [config.delayBeforeFirstPhoto]);

  // Toggle pause (only works during countdown)
  const togglePause = useCallback(() => {
    if (sequenceState === 'countdown') {
      setIsPaused(p => !p);
    }
  }, [sequenceState]);

  // Stop if active (for capture button)
  const stopIfActive = useCallback(() => {
    if (isActive) {
      stop();
    }
  }, [isActive, stop]);

  // ── Manual single capture ──
  // Completely separate from auto. Uses manualPhase state only.
  const captureNow = useCallback(() => {
    if (manualPhase !== 'idle') {
      logger.debug('[PhotoboothSequence] captureNow skipped — manual capture already in progress');
      return;
    }
    const autoState = sequenceStateRef.current;
    if (autoState !== 'idle' && autoState !== 'complete') {
      logger.debug('[PhotoboothSequence] captureNow skipped — auto sequence active:', autoState);
      return;
    }
    logger.debug('[PhotoboothSequence] captureNow — starting manual capture');
    setManualPhase('waiting');

    triggerCapture(config.onCaptureStart).then((response) => {
      logger.debug('[PhotoboothSequence] Manual capture response:', response);
      if (!response.success) {
        logger.error('[PhotoboothSequence] Manual capture failed:', response.error);
        setManualPhase('idle');
      }
    }).catch((error) => {
      logger.error('[PhotoboothSequence] Manual capture error:', error);
      setManualPhase('idle');
    });
  }, [manualPhase]);

  // ========== STATE MACHINE ==========

  // Scramble: show random digits for ~1.2s, then start countdown
  useEffect(() => {
    if (sequenceState === 'scramble') {
      setScrambleTick(0);
      const interval = setInterval(() => setScrambleTick(t => t + 1), 50);

      const scrambleEnd = setTimeout(() => {
        clearInterval(interval);
        setSequenceState('countdown');
        setCurrentCountdown(config.delayBeforeFirstPhoto);
      }, 1200);

      return () => {
        clearInterval(interval);
        clearTimeout(scrambleEnd);
      };
    }
  }, [sequenceState, config.delayBeforeFirstPhoto]);

  // Countdown: count down to 0, then trigger capture
  useEffect(() => {
    if (sequenceState === 'countdown' && !isPaused) {
      const interval = setInterval(() => {
        setCurrentCountdown(prev => {
          if (prev <= 1) {
            setSequenceState('capturing');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sequenceState, isPaused]);

  // Called by workspace when photo_downloaded WS event arrives (auto only).
  const notifyCaptureComplete = useCallback(() => {
    if (!capturingRef.current) {
      logger.debug('[PhotoboothSequence] notifyCaptureComplete — no active auto capture, ignoring');
      return;
    }

    logger.debug('[PhotoboothSequence] notifyCaptureComplete — advancing state machine');
    const newTaken = photosTaken + 1;
    setPhotosTaken(newTaken);
    capturingRef.current = false;

    if (config.onPhotoCaptured) {
      config.onPhotoCaptured(photoNumberRef.current);
    }
    photoNumberRef.current += 1;

    // Always go through review cycle, even for the last photo
    if (previewLoadedRef.current) {
      logger.debug('[PhotoboothSequence] Preview already loaded, starting review immediately');
      setReviewCountdown(config.photoReviewTime + 1);
      setSequenceState('review');
      previewLoadedRef.current = false;
    } else {
      setSequenceState('waitingForPreview');
    }
  }, [photosTaken, config.onPhotoCaptured, config.autoCount, config.photoReviewTime]);

  // Called when preview image has loaded — routes to manual or auto path
  const startReviewCountdown = useCallback(() => {
    // Manual path: preview loaded during manual capture
    if (manualPhase === 'waiting') {
      logger.debug('[PhotoboothSequence] Preview loaded — starting manual review countdown');
      setManualReviewCountdown(config.photoReviewTime + 1);
      setManualPhase('review');
      return;
    }

    // Auto path: use ref to avoid stale closure (state may still be 'capturing'
    // in the closure when the preview image onLoad fires)
    const currentState = sequenceStateRef.current;
    logger.debug('[PhotoboothSequence] startReviewCountdown (auto) — sequenceState:', currentState);
    previewLoadedRef.current = true;
    if (currentState === 'waitingForPreview') {
      logger.debug('[PhotoboothSequence] Preview loaded — starting auto review countdown');
      setReviewCountdown(config.photoReviewTime + 1);
      setSequenceState('review');
    }
  }, [manualPhase, config.photoReviewTime]);

  // External camera capture (not via button) — enters manual waiting
  const startManualReview = useCallback(() => {
    if (manualPhase !== 'idle') return;
    logger.debug('[PhotoboothSequence] startManualReview — entering manual waiting');
    setManualPhase('waiting');
  }, [manualPhase]);

  useEffect(() => {
    if (sequenceState === 'capturing' && !capturingRef.current) {
      // Reset the preview loaded flag for the new capture
      previewLoadedRef.current = false;
      capturingRef.current = true;

      // Trigger the actual camera capture via daemon
      triggerCapture(config.onCaptureStart).then((response) => {
        if (!response.success) {
          logger.error('[PhotoboothSequence] Capture failed:', response.error);
        }
      }).catch((error) => {
        logger.error('[PhotoboothSequence] Capture error:', error);
      });

      // Safety timeout: if no photo_downloaded arrives within 15s, advance anyway
      const safetyTimeout = setTimeout(() => {
        if (capturingRef.current) {
          logger.warn('[PhotoboothSequence] Safety timeout — advancing after 15s');
          const newTaken = photosTaken + 1;
          setPhotosTaken(newTaken);
          capturingRef.current = false;

          if (config.onPhotoCaptured) {
            config.onPhotoCaptured(photoNumberRef.current);
          }
          photoNumberRef.current += 1;

          if (newTaken >= config.autoCount) {
            setSequenceState('complete');
          } else {
            setSequenceState('waitingForPreview');
          }
        }
      }, 15000);

      return () => clearTimeout(safetyTimeout);
    }
  }, [sequenceState, photosTaken, config.autoCount, config.onPhotoCaptured]);

  // Handle preview loading while in auto waitingForPreview state
  useEffect(() => {
    if (sequenceState === 'waitingForPreview') {
      if (previewLoadedRef.current) {
        logger.debug('[PhotoboothSequence] Auto waitingForPreview — preview already loaded, starting review');
        setReviewCountdown(config.photoReviewTime + 1);
        setSequenceState('review');
        previewLoadedRef.current = false;
      } else {
        // Safety timeout: if preview never loads, use photoReviewTime + 4s
        const safetyTimeout = setTimeout(() => {
          if (sequenceStateRef.current === 'waitingForPreview') {
            logger.warn('[PhotoboothSequence] waitingForPreview safety timeout — continuing');
            setReviewCountdown(config.photoReviewTime + 1);
            setSequenceState('review');
            previewLoadedRef.current = false;
          }
        }, (config.photoReviewTime + 4) * 1000);
        return () => clearTimeout(safetyTimeout);
      }
    }
  }, [sequenceState, config.photoReviewTime]);

  // Auto review: countdown review time, then go to betweenPhotos for next photo
  useEffect(() => {
    if (sequenceState === 'review' && !isPaused && reviewCountdown > 0) {
      const interval = setInterval(() => {
        setReviewCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            // Use the current photosTaken value from state, not closure
            setPhotosTaken(currentTaken => {
              if (currentTaken >= config.autoCount) {
                logger.debug('[PhotoboothSequence] Auto review ended — all photos taken, completing');
                setCurrentCountdown(config.delayBeforeFirstPhoto);
                setSequenceState('complete');
              } else {
                logger.debug('[PhotoboothSequence] Auto review ended, continuing to betweenPhotos');
                const nextDelay = currentTaken >= 1 ? config.delayBetweenPhotos : config.delayBeforeFirstPhoto;
                setCurrentCountdown(nextDelay);
                setSequenceState('betweenPhotos');
              }
              return currentTaken;
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sequenceState, isPaused, config.delayBeforeFirstPhoto, config.delayBetweenPhotos, config.autoCount, reviewCountdown]);

  // BetweenPhotos: wait delay, then show "--" before countdown
  useEffect(() => {
    if (sequenceState === 'betweenPhotos' && !isPaused) {
      const delayTimeout = setTimeout(() => {
        setSequenceState('preCountdown');
      }, config.delayBetweenPhotos * 1000);
      return () => clearTimeout(delayTimeout);
    }
  }, [sequenceState, isPaused, config.delayBetweenPhotos]);

  // PreCountdown: show "--" briefly, then start countdown
  useEffect(() => {
    if (sequenceState === 'preCountdown') {
      const confirmTimeout = setTimeout(() => {
        setSequenceState('countdown');
      }, 500);
      return () => clearTimeout(confirmTimeout);
    }
  }, [sequenceState]);

  // ── Manual capture effects ──

  // Manual waiting: safety timeout if preview never loads
  useEffect(() => {
    if (manualPhase === 'waiting') {
      const timeout = setTimeout(() => {
        logger.warn('[PhotoboothSequence] Manual waiting safety timeout');
        setManualPhase('idle');
      }, (config.photoReviewTime + 3) * 1000);
      return () => clearTimeout(timeout);
    }
  }, [manualPhase, config.photoReviewTime]);

  // Manual review: countdown then return to idle
  useEffect(() => {
    if (manualPhase === 'review' && manualReviewCountdown > 0) {
      const interval = setInterval(() => {
        setManualReviewCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            logger.debug('[PhotoboothSequence] Manual review ended, returning to idle');
            setManualPhase('idle');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [manualPhase, manualReviewCountdown]);

  // Update countdown when config changes or sequence finishes
  useEffect(() => {
    if (sequenceState === 'idle' || sequenceState === 'complete') {
      setCurrentCountdown(config.delayBeforeFirstPhoto);
    }
  }, [config.delayBeforeFirstPhoto, sequenceState]);

  return {
    sequenceState,
    currentCountdown,
    reviewCountdown,
    photosTaken,
    scrambleTick,
    isPaused,
    manualPhase,
    manualReviewCountdown,
    start,
    stop,
    stopIfActive,
    togglePause,
    captureNow,
    notifyCaptureComplete,
    startReviewCountdown,
    startManualReview,
    isActive,
    isAutoRunning: autoSequenceActive && isActive,
    isComplete: sequenceState === 'complete',
  };
}
