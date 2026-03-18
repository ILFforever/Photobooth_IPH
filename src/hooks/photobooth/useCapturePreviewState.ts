import { useState, useEffect, useRef, useCallback } from 'react';
import type { SequenceState, ManualPhase } from './usePhotoboothSequence';
import type { CurrentSetPhoto, DisplayMode } from '../../components/PhotoboothView/photoboothWorkspaceTypes';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PhotoboothWorkspace');

interface UseCapturePreviewStateParams {
  sequence: {
    sequenceState: SequenceState;
    reviewCountdown: number;
    manualPhase: ManualPhase;
    startReviewCountdown: () => void;
  };
  updateGuestDisplay: (data: {
    currentSetPhotos?: CurrentSetPhoto[];
    selectedPhotoIndex?: number | null;
    displayMode?: DisplayMode;
    showCapturePreview?: boolean;
    capturedPhotoUrl?: string | null;
  }) => void;
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  displayMode: DisplayMode;
}

export function useCapturePreviewState({
  sequence,
  updateGuestDisplay,
  currentSetPhotos,
  selectedPhotoIndex,
  displayMode,
}: UseCapturePreviewStateParams) {
  const [showCapturePreview, setShowCapturePreview] = useState(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const previewTimerStartedRef = useRef(false);
  const prevSequenceStateRef = useRef<string>('idle');
  const prevManualPhaseRef = useRef<string>('idle');

  // Hide preview when sequence leaves review state (review countdown ended)
  useEffect(() => {
    const prevState = prevSequenceStateRef.current;
    const currentState = sequence.sequenceState;

    logger.debug('[PhotoboothWorkspace] Preview hide check - prevState:', prevState, 'currentState:', currentState, 'showCapturePreview:', showCapturePreview, 'reviewCountdown:', sequence.reviewCountdown);

    // Hide preview when leaving review/waitingForPreview, OR when sequence ends (complete/idle)
    const wasInReview = prevState === 'review' || prevState === 'waitingForPreview';
    const isNowInReview = currentState === 'review' || currentState === 'waitingForPreview';
    const sequenceEnded = (currentState === 'complete' || currentState === 'idle') && prevState !== currentState;

    if ((wasInReview && !isNowInReview || sequenceEnded) && showCapturePreview) {
      logger.debug('[PhotoboothWorkspace] Review ended, hiding preview');
      previewTimerStartedRef.current = false;
      setShowCapturePreview(false);
      setCapturedPhotoUrl(null);
      updateGuestDisplay({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        showCapturePreview: false,
        capturedPhotoUrl: null,
      });
    }

    // Update ref for next check
    prevSequenceStateRef.current = currentState;
  }, [sequence.sequenceState, sequence.reviewCountdown, showCapturePreview, updateGuestDisplay, currentSetPhotos, selectedPhotoIndex, displayMode]);

  // Hide preview when manual capture review ends (manualPhase goes from review -> idle)
  useEffect(() => {
    const prev = prevManualPhaseRef.current;
    const current = sequence.manualPhase;
    if ((prev === 'review' || prev === 'waiting') && current === 'idle' && showCapturePreview) {
      logger.debug('[PhotoboothWorkspace] Manual review ended, hiding preview');
      previewTimerStartedRef.current = false;
      setShowCapturePreview(false);
      setCapturedPhotoUrl(null);
      updateGuestDisplay({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        showCapturePreview: false,
        capturedPhotoUrl: null,
      });
    }
    prevManualPhaseRef.current = current;
  }, [sequence.manualPhase, showCapturePreview, updateGuestDisplay, currentSetPhotos, selectedPhotoIndex, displayMode]);

  // Called when capture preview image has finished loading
  const handleCapturePreviewLoad = useCallback(() => {
    logger.debug('[PhotoboothWorkspace] handleCapturePreviewLoad called - sequenceState:', sequence.sequenceState, 'previewTimerStartedRef:', previewTimerStartedRef.current);

    // Only start timer once (either from main window or guest display, whoever loads first)
    if (previewTimerStartedRef.current) {
      logger.debug('[PhotoboothWorkspace] Preview timer already started, ignoring');
      return;
    }

    logger.debug('[PhotoboothWorkspace] Capture preview image loaded, starting review countdown');
    previewTimerStartedRef.current = true;

    // Both manual and automatic captures use the sequence state machine
    logger.debug('[PhotoboothWorkspace] Calling sequence.startReviewCountdown()');
    sequence.startReviewCountdown();
  }, [sequence.startReviewCountdown]);

  return {
    showCapturePreview,
    capturedPhotoUrl,
    setCapturedPhotoUrl,
    setShowCapturePreview,
    previewTimerStartedRef,
    handleCapturePreviewLoad,
  };
}
