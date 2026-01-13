import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useDrop } from "react-dnd";
import { useCollage, CANVAS_SIZES, CanvasSize } from "../../contexts/CollageContext";
import { Frame } from "../../types/frame";
import { Background } from "../../types/background";
import CustomCanvasDialog from "./CustomCanvasDialog";
import "./FloatingFrameSelector.css";

type PanelType = "frame" | "canvas" | "background" | null;

// Droppable Background Pill Component
function BackgroundPillButton({
  currentBackgroundName,
  isActive,
  openPanel,
  onClick,
  onDrop
}: {
  currentBackgroundName: string;
  isActive: boolean;
  openPanel: PanelType;
  onClick: () => void;
  onDrop: (item: { path: string; thumbnail: string; dimensions?: { width: number; height: number } }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'IMAGE',
    drop: (item: { path: string; thumbnail: string; dimensions?: { width: number; height: number } }) => {
      console.log('=== DROPPED ON BACKGROUND PILL ===');
      console.log('Item:', item);
      onDrop(item);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  drop(ref);

  return (
    <div
      ref={ref}
      className={`background-pill-wrapper ${isOver && canDrop ? 'drag-over' : ''}`}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={`frame-pill-button ${isActive ? "active" : ""}`}
        style={{
          border: isOver && canDrop ? '2px dashed var(--accent-blue)' : undefined,
          background: isOver && canDrop ? 'rgba(59, 130, 246, 0.1)' : undefined,
        }}
      >
        <span className="pill-icon">🎨</span>
        <span className="pill-text">
          {currentBackgroundName || "Background"}
        </span>
        <span className="pill-indicator">
          {openPanel === "background" ? "▼" : "▲"}
        </span>
      </motion.button>
      {isOver && canDrop && (
        <div style={{
          position: 'absolute',
          top: '-25px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--accent-blue)',
          color: 'white',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          zIndex: 100,
        }}>
          Set as background
        </div>
      )}
    </div>
  );
}

const FloatingFrameSelector = () => {
  const {
    currentFrame,
    setCurrentFrame,
    canvasSize,
    setCanvasSize,
    background,
    setBackground,
    backgrounds,
    setBackgrounds,
    customCanvasSizes,
    setCustomCanvasSizes,
    activeSidebarTab,
  } = useCollage();
  const [openPanel, setOpenPanel] = useState<PanelType>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingBg, setImportingBg] = useState(false);
  const [importingBackgrounds, setImportingBackgrounds] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState(0);
  const [pillBarStyle, setPillBarStyle] = useState({});
  const [deleteMode, setDeleteMode] = useState<'frame' | 'background' | 'canvas' | null>(null);
  const [showCustomCanvasDialog, setShowCustomCanvasDialog] = useState(false);

  // Check if frame selector should be disabled (when creating custom frame)
  const isFrameDisabled = activeSidebarTab === 'frames';

  // Close frame panel when entering frame creator mode
  useEffect(() => {
    if (isFrameDisabled && openPanel === 'frame') {
      setOpenPanel(null);
    }
  }, [isFrameDisabled, openPanel]);

  // Update pill bar position on mount and window resize
  useEffect(() => {
    const updatePillBarPosition = () => {
      const mainPanel = document.querySelector(".main-panel") as HTMLElement;
      if (!mainPanel) return;

      const mainPanelRect = mainPanel.getBoundingClientRect();
      const mainPanelCenter = mainPanelRect.left + mainPanelRect.width / 2;

      setPillBarStyle({
        position: "fixed" as const,
        left: `${mainPanelCenter}px`,
        transform: "translateX(-50%)",
        bottom: "1rem",
      });
    };

    updatePillBarPosition();
    window.addEventListener("resize", updatePillBarPosition);
    return () => window.removeEventListener("resize", updatePillBarPosition);
  }, []);

  // Auto-load frames, backgrounds, and custom canvases on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [loadedFrames, loadedBackgrounds] = await Promise.all([
          invoke<Frame[]>("load_frames"),
          invoke<Background[]>("load_backgrounds"),
        ]);
        // Filter out the system blank frame from the list
        const visibleFrames = loadedFrames.filter(f => f.id !== 'system-blank');
        setFrames(visibleFrames);
        setBackgrounds(loadedBackgrounds);

        // Auto-select first frame if none selected (skip blank frame)
        if (!currentFrame && visibleFrames.length > 0) {
          setCurrentFrame(visibleFrames[0]);
        }

        // Load custom canvas sizes
        await refreshCustomCanvases();
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const panelOrder: PanelType[] = ["frame", "background", "canvas"];

  const handleToggleFrame = () => {
    if (openPanel) {
      setDirection(
        panelOrder.indexOf("frame") > panelOrder.indexOf(openPanel) ? 1 : -1
      );
    }
    setOpenPanel(openPanel === "frame" ? null : "frame");
  };

  const handleToggleCanvas = () => {
    if (openPanel) {
      setDirection(
        panelOrder.indexOf("canvas") > panelOrder.indexOf(openPanel) ? 1 : -1
      );
    }
    setOpenPanel(openPanel === "canvas" ? null : "canvas");
  };

  const handleToggleBackground = () => {
    if (openPanel) {
      setDirection(
        panelOrder.indexOf("background") > panelOrder.indexOf(openPanel)
          ? 1
          : -1
      );
    }
    setOpenPanel(openPanel === "background" ? null : "background");
  };

  const getCurrentBackground = () => {
    if (!background) return null;
    return backgrounds.find((bg) => bg.value === background) || null;
  };

  const handleSelectFrame = (frame: Frame) => {
    setCurrentFrame(frame);
  };

  const handleDeleteFrame = async (frameId: string) => {
    try {
      await invoke('delete_frame', { frameId });
      // Reload frames
      const loadedFrames = await invoke<Frame[]>('load_frames');
      setFrames(loadedFrames);
      // Clear current frame if it was deleted
      if (currentFrame?.id === frameId) {
        setCurrentFrame(null);
      }
    } catch (error) {
      console.error('Failed to delete frame:', error);
    }
  };

  const handleDeleteBackground = async (bg: Background) => {
    // Don't allow deleting default solid color backgrounds (non-image type)
    if (bg.background_type !== "image") {
      return;
    }

    try {
      await invoke('delete_background', { backgroundId: bg.id });
      // Reload backgrounds
      const updatedBackgrounds = await invoke<Background[]>('load_backgrounds');
      setBackgrounds(updatedBackgrounds);
      // Clear current background if it was deleted
      if (background === bg.value) {
        setBackground(null);
      }
    } catch (error) {
      console.error('Failed to delete background:', error);
    }
  };

  const handleSelectCanvasSize = (size: CanvasSize) => {
    setCanvasSize(size);
  };

  const handleDeleteCustomCanvas = async (canvasToDelete: CanvasSize) => {
    try {
      // Delete using dedicated command
      await invoke('delete_custom_canvas_size', { name: canvasToDelete.name });

      // Update state
      const updatedCanvases = customCanvasSizes.filter(c => c.name !== canvasToDelete.name);
      setCustomCanvasSizes(updatedCanvases);

      // If the deleted canvas was selected, switch to default
      if (canvasSize.name === canvasToDelete.name) {
        setCanvasSize(CANVAS_SIZES[0]);
      }

      console.log('Custom canvas deleted:', canvasToDelete.name);
    } catch (error) {
      console.error('Failed to delete custom canvas:', error);
    }
  };

  const refreshCustomCanvases = async () => {
    try {
      const customCanvases = await invoke<{
        width: number;
        height: number;
        name: string;
        created_at: number;
      }[]>('get_custom_canvas_sizes');
      setCustomCanvasSizes(customCanvases.map(c => ({
        width: c.width,
        height: c.height,
        name: c.name,
        isCustom: true,
        createdAt: c.created_at.toString(),
      })));
    } catch (error) {
      console.error('Failed to refresh custom canvases:', error);
    }
  };

  const handleSelectBackground = (bg: Background) => {
    // Convert asset:// URLs to usable URLs
    console.log('=== handleSelectBackground ===');
    console.log('Selected background:', bg);
    console.log('Background value type:', typeof bg.value);
    console.log('Background value:', bg.value);

    let finalValue = bg.value;

    if (bg.value.startsWith('asset://')) {
      console.log('Converting asset:// URL');
      const convertedSrc = convertFileSrc(bg.value.replace('asset://', ''));
      console.log('Converted src:', convertedSrc);
      finalValue = convertedSrc;
    }

    console.log('Setting background to:', finalValue);
    setBackground(finalValue);
    console.log('Background set successfully');
    console.log('=========================');
  };

  const handleImportBackground = async () => {
    try {
      setImportingBg(true);
      console.log("Requesting background image selection...");
      const selected = await invoke<string>("select_file");

      if (selected) {
        console.log("Selected background file:", selected);
        const fileName = selected.split(/[\\/]/).pop() || "Custom Background";

        // Import the background using backend command
        const newBg = await invoke<Background>("import_background", {
          filePath: selected,
          name: fileName,
        });

        // Reload backgrounds list
        const updatedBackgrounds = await invoke<Background[]>(
          "load_backgrounds"
        );
        setBackgrounds(updatedBackgrounds);

        // Set the new background
        setBackground(newBg.value);
      }
    } catch (error) {
      console.error("Failed to import background:", error);
    } finally {
      setImportingBg(false);
    }
  };

  const handleDropImageOnBackground = async (item: { path: string; thumbnail: string; dimensions?: { width: number; height: number } }) => {
    try {
      console.log('=== SETTING DRAGGED IMAGE AS BACKGROUND ===');
      console.log('Image path:', item.path);

      // Generate a temp ID for this background while importing
      const tempId = `temp-${Date.now()}`;
      const fileName = item.path.split(/[\\/]/).pop() || "Custom Background";

      // Convert the path immediately and set as background - no need to import first!
      const convertedSrc = convertFileSrc(item.path.replace('asset://', ''));
      console.log('Setting background directly:', convertedSrc);
      setBackground(convertedSrc);

      // Add to importing set to show skeleton
      setImportingBackgrounds(prev => new Set(prev).add(tempId));

      // Then import in background for future use (non-blocking)
      invoke<Background>("import_background", {
        filePath: item.path,
        name: fileName,
      }).then(async (newBg) => {
        // Reload backgrounds list in background
        const updatedBackgrounds = await invoke<Background[]>("load_backgrounds");
        setBackgrounds(updatedBackgrounds);

        // Remove from importing set
        setImportingBackgrounds(prev => {
          const newSet = new Set(prev);
          newSet.delete(tempId);
          return newSet;
        });

        console.log('Background imported for future use:', newBg.name);
      }).catch(err => {
        console.error('Failed to import background for future use:', err);

        // Remove from importing set on error
        setImportingBackgrounds(prev => {
          const newSet = new Set(prev);
          newSet.delete(tempId);
          return newSet;
        });
      });

      console.log('Background set successfully (instant)');
      console.log('=========================================');
    } catch (error) {
      console.error("Failed to set dragged background:", error);
    }
  };

  // Slide animation variants for content
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 50 : -50,
      opacity: 0,
    }),
  };

  const getPanelStyle = () => {
    const mainPanel = document.querySelector(".main-panel") as HTMLElement;
    const mainPanelWidth = mainPanel?.getBoundingClientRect().width || 600;
    const panelWidth = mainPanelWidth * 0.9; // 90% of main panel (right area) width

    const mainPanelRect = mainPanel?.getBoundingClientRect();
    const mainPanelCenter = mainPanelRect
      ? mainPanelRect.left + mainPanelRect.width / 2
      : window.innerWidth / 2;
    const panelLeft = mainPanelCenter - panelWidth / 2;

    return {
      position: "fixed" as const,
      left: `${panelLeft}px`,
      width: `${panelWidth}px`,
      bottom: "95px",
      zIndex: 50,
    };
  };

  const getPanelWidth = () => {
    const mainPanel = document.querySelector(".main-panel") as HTMLElement;
    const mainPanelWidth = mainPanel?.getBoundingClientRect().width || 600;
    return `${mainPanelWidth * 0.9}px`;
  };

  return (
    <div className="floating-frame-selector">
      {/* Floating Pill Bar with All Buttons */}
      <div className="pill-bar" style={pillBarStyle}>
        {/* Frame Selector Button */}
        <motion.button
          whileHover={isFrameDisabled ? {} : { scale: 1.05 }}
          whileTap={isFrameDisabled ? {} : { scale: 0.95 }}
          onClick={isFrameDisabled ? undefined : handleToggleFrame}
          className={`frame-pill-button ${
            openPanel === "frame" ? "active" : ""
          } ${isFrameDisabled ? "disabled" : ""}`}
          disabled={isFrameDisabled}
        >
          <span className="pill-icon">🖼️</span>
          <span className="pill-text">
            {isFrameDisabled ? "Frame (Disabled)" : (currentFrame ? currentFrame.name : "Select Frame")}
          </span>
          <span className="pill-indicator">
            {isFrameDisabled ? "🔒" : (openPanel === "frame" ? "▼" : "▲")}
          </span>
        </motion.button>

        {/* Divider */}
        <div className="pill-divider" />

        {/* Background Selector Button - Droppable */}
        <BackgroundPillButton
          currentBackgroundName={getCurrentBackground()?.name || "Background"}
          isActive={openPanel === "background"}
          openPanel={openPanel}
          onClick={handleToggleBackground}
          onDrop={handleDropImageOnBackground}
        />

        {/* Divider */}
        <div className="pill-divider" />

        {/* Canvas Size Selector Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleToggleCanvas}
          className={`frame-pill-button ${
            openPanel === "canvas" ? "active" : ""
          }`}
        >
          <span className="pill-icon">📐</span>
          <span className="pill-text">
            {canvasSize.name} ({canvasSize.width}×{canvasSize.height})
          </span>
          <span className="pill-indicator">
            {openPanel === "canvas" ? "▼" : "▲"}
          </span>
        </motion.button>
      </div>

      {/* Single Panel Container with sliding content */}
      <AnimatePresence>
        {openPanel && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            style={{
              ...getPanelStyle(),
              width: getPanelWidth(),
              height: "235px",
            }}
            className="frame-options-panel"
          >
            <div className="panel-header">
              <h3>
                {openPanel === "frame" && "Frame Templates"}
                {openPanel === "canvas" && "Canvas Size"}
                {openPanel === "background" && "Backgrounds"}
              </h3>
              <div className="panel-header-actions">
                {/* Delete mode toggle button - for frame, background, and canvas panels */}
                {(openPanel === "frame" || openPanel === "background" || openPanel === "canvas") && (
                  <button
                    onClick={() => {
                      setDeleteMode(deleteMode === openPanel ? null : openPanel);
                    }}
                    className={`delete-toggle-btn ${deleteMode === openPanel ? 'active' : ''}`}
                    title={deleteMode === openPanel ? "Exit delete mode" : "Enter delete mode"}
                  >
                    🗑️
                  </button>
                )}
                <button
                  onClick={() => {
                    setOpenPanel(null);
                    setDeleteMode(null);
                  }}
                  className="close-btn"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="frame-list">
              <AnimatePresence mode="wait">
                {openPanel === "frame" && (
                  <motion.div
                    key="frame-content"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "row",
                      gap: "0.75rem",
                      overflowX: "auto",
                      overflowY: "hidden",
                      padding: "0.5rem 0.75rem",
                    }}
                  >
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
                          onClick={() => deleteMode !== 'frame' && handleSelectFrame(frame)}
                          className={`frame-option ${
                            currentFrame?.id === frame.id ? "selected" : ""
                          } ${deleteMode === 'frame' ? 'delete-mode' : ''}`}
                        >
                          <div className="frame-option-content">
                            <div className="frame-preview-container">
                              <div
                                className="frame-zones-preview"
                                style={{
                                  aspectRatio: `${frame.width} / ${frame.height}`,
                                }}
                              >
                                {frame.zones.map((zone) => (
                                  <div
                                    key={zone.id}
                                    className="frame-zone-box"
                                    style={{
                                      position: 'absolute',
                                      left: `${(zone.x / frame.width) * 100}%`,
                                      top: `${(zone.y / frame.height) * 100}%`,
                                      width: `${(zone.width / frame.width) * 100}%`,
                                      height: `${(zone.height / frame.height) * 100}%`,
                                      transform: `rotate(${zone.rotation}deg)`,
                                      borderRadius: zone.shape === 'circle' ? '50%' : (zone.shape === 'rounded_rect' ? '8px' : '2px'),
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                            <div className="frame-option-info">
                              <span className="frame-option-name">
                                {frame.name}
                              </span>
                              <span className="frame-zones-count">
                                {frame.zones.length} zones
                              </span>
                            </div>
                            {deleteMode === 'frame' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteFrame(frame.id);
                                }}
                                className="item-delete-btn"
                                title="Delete frame"
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="empty-state-small">
                        <span>No frames available</span>
                      </div>
                    )}
                  </motion.div>
                )}

                {openPanel === "canvas" && (
                  <motion.div
                    key="canvas-content"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "row",
                      gap: "0.75rem",
                      overflowX: "auto",
                      overflowY: "hidden",
                      padding: "0.5rem 0.75rem",
                    }}
                  >
                    {/* Custom Canvas Button */}
                    <motion.div
                      key="custom-canvas-btn"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setShowCustomCanvasDialog(true)}
                      className="frame-option import-bg-button"
                    >
                      <div className="frame-option-content">
                        <div className="frame-preview-container">
                          <div
                            className="import-bg-icon"
                            style={{
                              border: '2px dashed rgba(255, 255, 255, 0.25)',
                              overflow: 'visible',
                              paddingBottom: '10px'
                            }}
                          >
                            +
                          </div>
                        </div>
                        <div className="frame-option-info">
                          <span className="frame-option-name">
                            Custom
                          </span>
                        </div>
                      </div>
                    </motion.div>

                    {/* Custom Canvas Sizes */}
                    {customCanvasSizes.map((size) => (
                      <motion.div
                        key={size.name}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => deleteMode !== 'canvas' && handleSelectCanvasSize(size)}
                        className={`frame-option ${
                          canvasSize.name === size.name ? "selected" : ""
                        } ${deleteMode === 'canvas' ? 'delete-mode' : ''}`}
                        style={{
                          position: 'relative',
                        }}
                      >
                        <div className="frame-option-content">
                          <div className="frame-preview-container">
                            <div
                              className="canvas-preview-compact"
                              style={{
                                aspectRatio: `${size.width} / ${size.height}`,
                                width: "50px",
                                height: "auto",
                                maxHeight: "70px",
                                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2))',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                              }}
                            />
                          </div>
                          <div className="frame-option-info">
                            <span className="frame-option-name">
                              {size.name}
                            </span>
                            <span className="frame-zones-count">
                              {size.width}×{size.height}
                            </span>
                          </div>
                          {deleteMode === 'canvas' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCustomCanvas(size);
                              }}
                              className="item-delete-btn"
                              title="Delete custom canvas"
                            >
                                🗑
                              </button>
                          )}
                        </div>
                      </motion.div>
                    ))}

                    {/* Default Canvas Sizes */}
                    {CANVAS_SIZES.map((size) => (
                      <motion.div
                        key={size.name}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSelectCanvasSize(size)}
                        className={`frame-option ${
                          canvasSize.name === size.name ? "selected" : ""
                        } ${deleteMode === 'canvas' ? 'disabled' : ''}`}
                        style={{
                          opacity: deleteMode === 'canvas' ? 0.4 : 1,
                          pointerEvents: deleteMode === 'canvas' ? 'none' : 'auto',
                        }}
                      >
                        <div className="frame-option-content">
                          <div className="frame-preview-container">
                            <div
                              className="canvas-preview-compact"
                              style={{
                                aspectRatio: `${size.width} / ${size.height}`,
                                width: "50px",
                                height: "auto",
                                maxHeight: "70px",
                              }}
                            />
                          </div>
                          <div className="frame-option-info">
                            <span className="frame-option-name">
                              {size.name}
                            </span>
                            <span className="frame-zones-count">
                              {size.width}×{size.height}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}

                {openPanel === "background" && (
                  <motion.div
                    key="background-content"
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "row",
                      gap: "0.75rem",
                      overflowX: "auto",
                      overflowY: "hidden",
                      padding: "0.5rem 0.75rem",
                    }}
                  >
                    {/* Import button for custom backgrounds */}
                    {!loading && backgrounds.length > 0 && (
                      <motion.div
                        key="import-bg-btn"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleImportBackground}
                        className="frame-option import-bg-button"
                      >
                        <div className="frame-option-content">
                          <div className="frame-preview-container">
                            <div
                              className="bg-preview-compact import-bg-icon"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '2.5rem',
                                fontWeight: 300,
                                lineHeight: '0.8',
                                color: 'rgba(255, 255, 255, 0.4)',
                                border: '2px dashed rgba(255, 255, 255, 0.25)',
                                background: 'rgba(0, 0, 0, 0.15)',
                                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
                                overflow: 'visible',
                                paddingBottom: '10px'
                              }}
                            >
                              +
                            </div>
                          </div>
                          <div className="frame-option-info">
                            <span className="frame-option-name">
                              {importingBg ? "Importing..." : "Add Image"}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Skeleton loaders for backgrounds being imported */}
                    {Array.from(importingBackgrounds).map((tempId) => (
                      <div key={tempId} className="frame-option skeleton-loading">
                        <div className="frame-option-content">
                          <div className="frame-preview-container">
                            <div className="bg-preview-compact skeleton-thumbnail" />
                          </div>
                          <div className="frame-option-info">
                            <div className="skeleton-text skeleton-filename" />
                          </div>
                        </div>
                      </div>
                    ))}

                    {loading ? (
                      <div className="loading-state">
                        <div className="spinner-small"></div>
                        <span>Loading backgrounds...</span>
                      </div>
                    ) : backgrounds.filter(
                        (bg) => bg.background_type !== "gradient"
                      ).length > 0 ? (
                      backgrounds
                        .filter((bg) => bg.background_type !== "gradient")
                        .sort((a, b) => {
                          // Sort: image backgrounds first, then solid colors
                          // Within each category, sort by name
                          const aIsImage = a.background_type === "image";
                          const bIsImage = b.background_type === "image";

                          if (aIsImage && !bIsImage) return -1;
                          if (!aIsImage && bIsImage) return 1;

                          // Same type - sort by name
                          return a.name.localeCompare(b.name);
                        })
                        .map((bg) => (
                          <motion.div
                            key={bg.id}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => deleteMode !== 'background' && handleSelectBackground(bg)}
                            className={`frame-option ${
                              background === bg.value ? "selected" : ""
                            } ${deleteMode === 'background' ? 'delete-mode' : ''} ${
                              bg.background_type !== 'image' ? 'non-deletable' : ''
                            }`}
                          >
                            <div className="frame-option-content">
                              <div className="frame-preview-container">
                                <div
                                  className="bg-preview-compact"
                                  style={
                                    bg.background_type === "image" &&
                                    bg.thumbnail
                                      ? {}
                                      : bg.background_type === "gradient"
                                      ? { background: bg.value }
                                      : { backgroundColor: bg.value }
                                  }
                                  title={bg.description}
                                >
                                  {bg.background_type === "image" &&
                                    bg.thumbnail && (
                                      <img
                                        src={convertFileSrc(bg.thumbnail.replace('asset://', ''))}
                                        alt={bg.name}
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "cover",
                                        }}
                                      />
                                    )}
                                </div>
                              </div>
                              <div className="frame-option-info">
                                <span className="frame-option-name">
                                  {bg.name}
                                </span>
                              </div>
                              {deleteMode === 'background' && bg.background_type === 'image' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteBackground(bg);
                                  }}
                                  className="item-delete-btn"
                                  title="Delete background"
                                >
                                  🗑
                                </button>
                              )}
                            </div>
                          </motion.div>
                        ))
                    ) : (
                      <div className="empty-state-small">
                        <span>No backgrounds available</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Canvas Dialog */}
      <CustomCanvasDialog
        isOpen={showCustomCanvasDialog}
        onClose={async () => {
          setShowCustomCanvasDialog(false);
          await refreshCustomCanvases();
        }}
      />
    </div>
  );
};

export default FloatingFrameSelector;
