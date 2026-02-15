import { createContext, useContext, useEffect, useRef, ReactNode } from "react";
import { useLiveViewManager, type LiveViewManagerState } from "../hooks/useLiveViewManager";
import { useHdmiCapture, type HdmiCaptureState } from "../hooks/useHdmiCapture";
import { usePtpStream, type PtpStreamState } from "../hooks/usePtpStream";

interface LiveViewContextValue extends LiveViewManagerState {
  hdmi: HdmiCaptureState;
  ptp: PtpStreamState;
}

const LiveViewContext = createContext<LiveViewContextValue | undefined>(undefined);

/**
 * Hidden video element that always consumes the MediaStream.
 *
 * Chromium / WebView aggressively manages media pipelines: if no <video>
 * element is actively pulling frames (e.g. the visible video is conditionally
 * un-rendered during a section collapse or display-mode switch), the engine
 * may end the underlying track to reclaim resources.  OBS doesn't have this
 * problem because it uses DirectShow directly, bypassing Chromium's lifecycle.
 *
 * This zero-size, muted, hidden video acts as a permanent consumer so the
 * track stays alive regardless of what the UI is doing.
 */
function StreamKeepAlive({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (stream) {
      el.srcObject = stream;
      // Some Chromium builds pause media on hidden/offscreen elements.
      // Explicitly calling play() prevents that.
      el.play().catch(() => {/* muted autoplay — safe to ignore */});
    } else {
      el.srcObject = null;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      // Invisible but still in the DOM so Chromium keeps the pipeline active
      style={{
        position: 'fixed',
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
        zIndex: -9999,
      }}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}

export function LiveViewProvider({ children }: { children: ReactNode }) {
  const manager = useLiveViewManager();
  const hdmi = useHdmiCapture();
  const ptp = usePtpStream();

  const value: LiveViewContextValue = { ...manager, hdmi, ptp };

  return (
    <LiveViewContext.Provider value={value}>
      {/* Keep-alive: prevents Chromium from ending the track when no visible <video> is consuming */}
      <StreamKeepAlive stream={manager.stream} />
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
