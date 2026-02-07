import { useState, useEffect, useCallback, useRef } from 'react';
import { triggerCapture } from '../services/cameraCaptureService';

export type SequenceState = 'idle' | 'scramble' | 'countdown' | 'capturing' | 'photoConfirm' | 'review' | 'betweenPhotos' | 'preCountdown' | 'complete';

interface SequenceConfig {
  delayBeforeFirstPhoto: number;
  delayBetweenPhotos: number;
  photoReviewTime: number;
  autoCount: number;
  onPhotoCaptured?: (photoNumber: number) => void;
}

interface UsePhotoboothSequenceReturn {
  // State
  sequenceState: SequenceState;
  currentCountdown: number;
  reviewCountdown: number;
  photosTaken: number;
  scrambleTick: number;
  isPaused: boolean;

  // Actions
  start: () => void;
  stop: () => void;
  stopIfActive: () => void;
  togglePause: () => void;
  captureNow: () => void;  // Trigger immediate capture
  notifyCaptureComplete: () => void;  // Call when photo_downloaded WS event arrives

  // Derived
  isActive: boolean;
  isComplete: boolean;
}

export function usePhotoboothSequence(config: SequenceConfig): UsePhotoboothSequenceReturn {
  const [sequenceState, setSequenceState] = useState<SequenceState>('idle');
  const [currentCountdown, setCurrentCountdown] = useState(config.delayBeforeFirstPhoto);
  const [reviewCountdown, setReviewCountdown] = useState(0);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [scrambleTick, setScrambleTick] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const isActive = sequenceState !== 'idle' && sequenceState !== 'complete';

  // Start the sequence
  const start = useCallback(() => {
    setPhotosTaken(0);
    setReviewCountdown(0);
    setIsPaused(false);
    setSequenceState('scramble');
  }, []);

  // Stop the sequence
  const stop = useCallback(() => {
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

  // Trigger immediate capture (for manual capture button)
  const captureNow = useCallback(() => {
    console.log('[PhotoboothSequence] captureNow called, sequenceState:', sequenceState);
    // If idle or complete, just trigger a single capture without starting sequence
    if (sequenceState === 'idle' || sequenceState === 'complete') {
      if (sequenceState === 'complete') {
        setSequenceState('idle');
        setPhotosTaken(0);
        setCurrentCountdown(config.delayBeforeFirstPhoto);
      }
      console.log('[PhotoboothSequence] Triggering immediate capture...');
      triggerCapture().then((response) => {
        console.log('[PhotoboothSequence] Capture response:', response);
        if (!response.success) {
          console.error('[PhotoboothSequence] Capture failed:', response.error);
        } else {
          console.log('[PhotoboothSequence] Capture succeeded, photo #', photoNumberRef.current);
          // Notify that a photo was captured
          if (config.onPhotoCaptured) {
            config.onPhotoCaptured(photoNumberRef.current);
          }
          photoNumberRef.current += 1;
        }
      }).catch((error) => {
        console.error('[PhotoboothSequence] Capture error:', error);
      });
    } else {
      console.log('[PhotoboothSequence] Skipping capture - not idle');
    }
  }, [sequenceState, config.onPhotoCaptured, config.delayBeforeFirstPhoto]);

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

  // Capturing: trigger camera capture, advance when notifyCaptureComplete is called
  const capturingRef = useRef(false);
  const photoNumberRef = useRef(1);

  // Called by workspace when photo_downloaded WS event arrives
  const notifyCaptureComplete = useCallback(() => {
    if (sequenceState !== 'capturing' && capturingRef.current === false) {
      // Manual capture (idle/complete) — just notify callback
      console.log('[PhotoboothSequence] notifyCaptureComplete (manual mode)');
      return;
    }

    console.log('[PhotoboothSequence] notifyCaptureComplete — advancing state machine');
    const newTaken = photosTaken + 1;
    setPhotosTaken(newTaken);
    capturingRef.current = false;

    if (config.onPhotoCaptured) {
      config.onPhotoCaptured(photoNumberRef.current);
    }
    photoNumberRef.current += 1;

    setSequenceState('photoConfirm');
  }, [sequenceState, photosTaken, config.onPhotoCaptured]);

  useEffect(() => {
    if (sequenceState === 'capturing' && !capturingRef.current) {
      capturingRef.current = true;

      // Trigger the actual camera capture via daemon
      triggerCapture().then((response) => {
        if (!response.success) {
          console.error('[PhotoboothSequence] Capture failed:', response.error);
        }
      }).catch((error) => {
        console.error('[PhotoboothSequence] Capture error:', error);
      });

      // Safety timeout: if no photo_downloaded arrives within 15s, advance anyway
      const safetyTimeout = setTimeout(() => {
        if (capturingRef.current) {
          console.warn('[PhotoboothSequence] Safety timeout — advancing state machine after 15s');
          const newTaken = photosTaken + 1;
          setPhotosTaken(newTaken);
          capturingRef.current = false;

          if (config.onPhotoCaptured) {
            config.onPhotoCaptured(photoNumberRef.current);
          }
          photoNumberRef.current += 1;
          setSequenceState('photoConfirm');
        }
      }, 15000);

      return () => clearTimeout(safetyTimeout);
    }
  }, [sequenceState, photosTaken, config.autoCount, config.onPhotoCaptured]);

  // PhotoConfirm: show "--" for 500ms, then review or complete
  useEffect(() => {
    if (sequenceState === 'photoConfirm') {
      const confirmTimeout = setTimeout(() => {
        if (photosTaken >= config.autoCount) {
          setSequenceState('complete');
        } else {
          setReviewCountdown(config.photoReviewTime);
          setSequenceState('review');
        }
      }, 500);
      return () => clearTimeout(confirmTimeout);
    }
  }, [sequenceState, photosTaken, config.autoCount, config.photoReviewTime]);

  // Review: countdown review time, then go to betweenPhotos delay
  useEffect(() => {
    if (sequenceState === 'review' && !isPaused && reviewCountdown > 0) {
      const interval = setInterval(() => {
        setReviewCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            // Use delayBetweenPhotos for subsequent photos (after the first one)
            const nextDelay = photosTaken >= 1 ? config.delayBetweenPhotos : config.delayBeforeFirstPhoto;
            setCurrentCountdown(nextDelay);
            setSequenceState('betweenPhotos');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sequenceState, isPaused, config.delayBeforeFirstPhoto, config.delayBetweenPhotos, reviewCountdown, photosTaken]);

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

  // Update countdown when config changes
  useEffect(() => {
    if (sequenceState === 'idle') {
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
    start,
    stop,
    stopIfActive,
    togglePause,
    captureNow,
    notifyCaptureComplete,
    isActive,
    isComplete: sequenceState === 'complete',
  };
}
