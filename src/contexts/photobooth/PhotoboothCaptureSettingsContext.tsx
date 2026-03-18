import { createContext, useContext, useState, ReactNode } from "react";

export interface CaptureTimingContextType {
  autoCount: number;
  setAutoCount: (value: number) => void;
  timerDelay: number;
  setTimerDelay: (value: number) => void;
  delayBetweenPhotos: number;
  setDelayBetweenPhotos: (value: number) => void;
  photoReviewTime: number;
  setPhotoReviewTime: (value: number) => void;
  delaySettingsLoaded: boolean;
  setDelaySettingsLoaded: (value: boolean) => void;
}

const CaptureTimingContext = createContext<CaptureTimingContextType | undefined>(undefined);

export function CaptureTimingProvider({ children }: { children: ReactNode }) {
  const [autoCount, setAutoCount] = useState(3);
  const [timerDelay, setTimerDelay] = useState(3);
  const [delayBetweenPhotos, setDelayBetweenPhotos] = useState(3);
  const [photoReviewTime, setPhotoReviewTime] = useState(3);
  const [delaySettingsLoaded, setDelaySettingsLoaded] = useState(false);

  return (
    <CaptureTimingContext.Provider
      value={{
        autoCount,
        setAutoCount,
        timerDelay,
        setTimerDelay,
        delayBetweenPhotos,
        setDelayBetweenPhotos,
        photoReviewTime,
        setPhotoReviewTime,
        delaySettingsLoaded,
        setDelaySettingsLoaded,
      }}
    >
      {children}
    </CaptureTimingContext.Provider>
  );
}

export function useCaptureTiming() {
  const context = useContext(CaptureTimingContext);
  if (!context) {
    throw new Error('useCaptureTiming must be used within CaptureTimingProvider');
  }
  return context;
}
