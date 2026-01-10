import { useEffect } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useAssets } from "../../contexts/AssetsContext";
import { useCollage } from "../../contexts/CollageContext";
import { Frame } from "../../types/frame";
import "./FrameSelector.css";

export default function FrameSelector() {
  const { frames, setFrames, loading, setLoading } = useAssets();
  const { currentFrame, setCurrentFrame } = useCollage();

  useEffect(() => {
    loadFrames();
  }, []);

  const loadFrames = async () => {
    setLoading(true);
    try {
      const loadedFrames = await invoke<Frame[]>("load_frames");
      setFrames(loadedFrames);

      // Auto-select first frame if none selected
      if (!currentFrame && loadedFrames.length > 0) {
        setCurrentFrame(loadedFrames[0]);
      }
    } catch (error) {
      console.error("Failed to load frames:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFrame = (frame: Frame) => {
    setCurrentFrame(frame);
  };

  if (loading) {
    return (
      <div className="frame-selector-loading">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="loading-spinner"
        >
          ⟳
        </motion.div>
        <p>Loading frames...</p>
      </div>
    );
  }

  return (
    <div className="frame-selector">
      <div className="frame-selector-header">
        <h3>Frame Templates</h3>
        <span className="frame-count">{frames.length} available</span>
      </div>

      <div className="frame-list">
        {frames.map((frame) => (
          <motion.button
            key={frame.id}
            className={`frame-item ${currentFrame?.id === frame.id ? 'selected' : ''}`}
            onClick={() => handleSelectFrame(frame)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="frame-preview">
              {frame.thumbnail ? (
                <img src={frame.thumbnail} alt={frame.name} />
              ) : (
                <div className="frame-preview-placeholder">
                  <span className="zone-count">{frame.zones.length}</span>
                  <span className="zone-label">zones</span>
                </div>
              )}
            </div>

            <div className="frame-info">
              <div className="frame-name">{frame.name}</div>
              <div className="frame-description">{frame.description}</div>
              <div className="frame-meta">
                <span>{frame.zones.length} zones</span>
                <span>•</span>
                <span>{frame.width}×{frame.height}</span>
                {frame.is_default && (
                  <>
                    <span>•</span>
                    <span className="default-badge">Default</span>
                  </>
                )}
              </div>
            </div>

            {currentFrame?.id === frame.id && (
              <div className="selected-indicator">✓</div>
            )}
          </motion.button>
        ))}
      </div>

      {frames.length === 0 && (
        <div className="frame-empty-state">
          <p>No frames available</p>
          <button className="btn-secondary" onClick={loadFrames}>
            Reload Frames
          </button>
        </div>
      )}
    </div>
  );
}
