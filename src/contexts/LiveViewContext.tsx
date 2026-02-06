import { createContext, useContext, useState, useRef, ReactNode, useCallback } from "react";

interface LiveViewContextType {
  liveViewStream: MediaStream | null;
  setLiveViewStream: (stream: MediaStream | null) => void;
  selectedDevice: string;
  setSelectedDevice: (device: string) => void;
}

const LiveViewContext = createContext<LiveViewContextType | undefined>(undefined);

export function LiveViewProvider({ children }: { children: ReactNode }) {
  const [liveViewStream, setLiveViewStream] = useState<MediaStream | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  // Cleanup stream when unmounting or changing
  const streamRef = useRef<MediaStream | null>(null);

  const setLiveViewStreamWithCleanup = useCallback((stream: MediaStream | null) => {
    // Stop previous stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    streamRef.current = stream;
    setLiveViewStream(stream);
  }, []);

  return (
    <LiveViewContext.Provider
      value={{
        liveViewStream,
        setLiveViewStream: setLiveViewStreamWithCleanup,
        selectedDevice,
        setSelectedDevice,
      }}
    >
      {children}
    </LiveViewContext.Provider>
  );
}

export function useLiveView() {
  const context = useContext(LiveViewContext);
  if (!context) {
    throw new Error('useLiveView must be used within LiveViewProvider');
  }
  return context;
}
