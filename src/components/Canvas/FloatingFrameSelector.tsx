import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useCollage, CANVAS_SIZES } from "../../contexts/CollageContext";
import { Frame } from "../../types/frame";
import { Background } from "../../types/background";
import "./FloatingFrameSelector.css";

type PanelType = 'frame' | 'canvas' | 'background' | null;

const FloatingFrameSelector = () => {
  console.log('🔴 FloatingFrameSelector RENDERING');
  const { currentFrame, setCurrentFrame, canvasSize, setCanvasSize, background, setBackground } = useCollage();
  const [openPanel, setOpenPanel] = useState<PanelType>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-load frames and backgrounds on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [loadedFrames, loadedBackgrounds] = await Promise.all([
          invoke<Frame[]>("load_frames"),
          invoke<Background[]>("load_backgrounds"),
        ]);
        console.log('Loaded frames:', loadedFrames);
        console.log('Loaded backgrounds:', loadedBackgrounds);
        setFrames(loadedFrames);
        setBackgrounds(loadedBackgrounds);

        // Auto-select first frame if none selected
        if (!currentFrame && loadedFrames.length > 0) {
          console.log('Auto-selecting first frame:', loadedFrames[0]);
          setCurrentFrame(loadedFrames[0]);
        }
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []); // Run once on mount

  const handleToggleFrame = () => {
    setOpenPanel(openPanel === 'frame' ? null : 'frame');
  };

  const handleToggleCanvas = () => {
    setOpenPanel(openPanel === 'canvas' ? null : 'canvas');
  };

  const handleToggleBackground = () => {
    setOpenPanel(openPanel === 'background' ? null : 'background');
  };


  const getCurrentBackground = () => {
    if (!background) return null;
    return backgrounds.find(bg => bg.value === background) || null;
  };

  const handleSelectFrame = (frame: Frame) => {
    setCurrentFrame(frame);
  };

  const handleSelectCanvasSize = (size: typeof CANVAS_SIZES[0]) => {
    setCanvasSize(size);
  };

  const handleSelectBackground = (bg: Background) => {
    setBackground(bg.value);
  };

  return (
    <div className="floating-frame-selector">
      {/* Floating Pill Bar with All Buttons */}
      <div className="pill-bar">
        {/* Frame Selector Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleToggleFrame}
          className={`frame-pill-button ${openPanel === 'frame' ? 'active' : ''}`}
        >
          <span className="pill-icon">🖼️</span>
          <span className="pill-text">
            {currentFrame ? currentFrame.name : "Select Frame"}
          </span>
          <span className="pill-indicator">{openPanel === 'frame' ? "▼" : "▲"}</span>
        </motion.button>

        {/* Divider */}
        <div className="pill-divider" />

        {/* Background Selector Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleToggleBackground}
          className={`frame-pill-button ${openPanel === 'background' ? 'active' : ''}`}
        >
          <span className="pill-icon">🎨</span>
          <span className="pill-text">
            {getCurrentBackground() ? getCurrentBackground()?.name : 'Background'}
          </span>
          <span className="pill-indicator">{openPanel === 'background' ? "▼" : "▲"}</span>
        </motion.button>

        {/* Divider */}
        <div className="pill-divider" />

        {/* Canvas Size Selector Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleToggleCanvas}
          className={`frame-pill-button ${openPanel === 'canvas' ? 'active' : ''}`}
        >
          <span className="pill-icon">📐</span>
          <span className="pill-text">
            {canvasSize.name} ({canvasSize.width}×{canvasSize.height})
          </span>
          <span className="pill-indicator">{openPanel === 'canvas' ? "▼" : "▲"}</span>
        </motion.button>
      </div>

      {/* Frame Options Panel */}
      <AnimatePresence>
        {openPanel === 'frame' && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="frame-options-panel"
          >
            <div className="panel-header">
              <h3>Frame Templates</h3>
              <button onClick={() => setOpenPanel(null)} className="close-btn">
                ✕
              </button>
            </div>

            <div className="frame-list">
              {loading ? (
                <div className="loading-state">
                  <div className="spinner-small"></div>
                  <span>Loading frames...</span>
                </div>
              ) : frames.length > 0 ? (
                frames.map((frame) => (
                  <motion.div
                    key={frame.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectFrame(frame)}
                    className={`frame-option ${currentFrame?.id === frame.id ? "selected" : ""}`}
                  >
                    <div className="frame-option-content">
                      <div className="frame-option-header">
                        <span className="frame-option-name">{frame.name}</span>
                        {currentFrame?.id === frame.id && (
                          <span className="selected-indicator">✓</span>
                        )}
                      </div>
                      <div className="frame-option-meta">
                        <span className="frame-zones">{frame.zones.length} zones</span>
                        <span className="frame-size">
                          {frame.width} × {frame.height}
                        </span>
                      </div>
                      {frame.description && (
                        <div className="frame-option-desc">{frame.description}</div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="empty-state-small">
                  <span>No frames available</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas Size Options Panel */}
      <AnimatePresence>
        {openPanel === 'canvas' && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="frame-options-panel canvas-size-panel"
          >
            <div className="panel-header">
              <h3>Canvas Size</h3>
              <button onClick={() => setOpenPanel(null)} className="close-btn">
                ✕
              </button>
            </div>

            <div className="frame-list">
              {CANVAS_SIZES.map((size) => (
                <motion.div
                  key={size.name}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectCanvasSize(size)}
                  className={`frame-option ${canvasSize.name === size.name ? "selected" : ""}`}
                >
                  <div className="frame-option-content">
                    <div className="frame-option-header">
                      <span className="frame-option-name">{size.name}</span>
                      {canvasSize.name === size.name && (
                        <span className="selected-indicator">✓</span>
                      )}
                    </div>
                    <div className="frame-option-meta">
                      <span className="frame-size">
                        {size.width} × {size.height}px
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Options Panel */}
      <AnimatePresence>
        {openPanel === 'background' && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="frame-options-panel background-panel"
          >
            <div className="panel-header">
              <h3>Backgrounds</h3>
              <button onClick={() => setOpenPanel(null)} className="close-btn">
                ✕
              </button>
            </div>

            <div className="frame-list">
              {loading ? (
                <div className="loading-state">
                  <div className="spinner-small"></div>
                  <span>Loading backgrounds...</span>
                </div>
              ) : backgrounds.length > 0 ? (
                backgrounds.map((bg) => (
                  <motion.div
                    key={bg.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectBackground(bg)}
                    className={`frame-option ${background === bg.value ? "selected" : ""}`}
                  >
                    <div className="frame-option-content">
                      <div className="frame-option-header">
                        <span className="frame-option-name">{bg.name}</span>
                        {background === bg.value && (
                          <span className="selected-indicator">✓</span>
                        )}
                      </div>
                      <div className="frame-option-meta">
                        {bg.background_type === 'color' && (
                          <div className="bg-preview-small">
                            <div
                              className="bg-color-swatch"
                              style={{ backgroundColor: bg.value }}
                              title={bg.description}
                            />
                            <span className="bg-color-value">{bg.value}</span>
                          </div>
                        )}
                        {bg.background_type === 'gradient' && (
                          <div
                            className="bg-gradient-preview-small"
                            style={{ background: bg.value }}
                            title={bg.description}
                          />
                        )}
                        {bg.background_type === 'image' && bg.thumbnail && (
                          <div className="bg-image-preview-small">
                            <img
                              src={bg.thumbnail.replace('asset://', '')}
                              alt={bg.name}
                            />
                          </div>
                        )}
                        {bg.is_default && (
                          <span className="bg-default-badge">Default</span>
                        )}
                      </div>
                      {bg.description && (
                        <div className="frame-option-desc">{bg.description}</div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="empty-state-small">
                  <span>No backgrounds available</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FloatingFrameSelector;
