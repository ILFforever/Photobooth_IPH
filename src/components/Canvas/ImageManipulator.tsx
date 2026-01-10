import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useCollage } from "../../contexts/CollageContext";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import "./ImageManipulator.css";

const ImageManipulator = () => {
  const { selectedZone, placedImages, updatePlacedImage, removePlacedImage } = useCollage();
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const placedImage = selectedZone ? placedImages.get(selectedZone) : null;

  // Reset panning state when selection changes
  useEffect(() => {
    setIsPanning(false);
  }, [selectedZone]);

  // Handle mouse up when panning
  useEffect(() => {
    if (isPanning) {
      const handleMouseUp = () => setIsPanning(false);
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isPanning]);

  // Early return if no image selected
  if (!selectedZone || !placedImage) {
    return (
      <div className="image-manipulator">
        <div className="manipulator-empty">
          <span className="empty-icon">🎨</span>
          <p>Select an image to adjust</p>
        </div>
      </div>
    );
  }

  const { transform } = placedImage;

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    updatePlacedImage(selectedZone, {
      transform: { ...transform, scale },
    });
  };

  const handleRotationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rotation = parseFloat(e.target.value);
    updatePlacedImage(selectedZone, {
      transform: { ...transform, rotation },
    });
  };

  const handleFlipHorizontal = () => {
    updatePlacedImage(selectedZone, {
      transform: { ...transform, flipHorizontal: !transform.flipHorizontal },
    });
  };

  const handleFlipVertical = () => {
    updatePlacedImage(selectedZone, {
      transform: { ...transform, flipVertical: !transform.flipVertical },
    });
  };

  const handleResetTransform = () => {
    updatePlacedImage(selectedZone, {
      transform: DEFAULT_TRANSFORM,
    });
  };

  const handleRemoveImage = () => {
    if (selectedZone) {
      removePlacedImage(selectedZone);
    }
  };

  const handlePanStart = (e: React.MouseEvent) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - transform.offsetX, y: e.clientY - transform.offsetY });
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const offsetX = e.clientX - panStart.x;
      const offsetY = e.clientY - panStart.y;
      updatePlacedImage(selectedZone, {
        transform: { ...transform, offsetX, offsetY },
      });
    }
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  return (
    <div className="image-manipulator">
      <div className="manipulator-header">
        <h3>Image Controls</h3>
        <span className="zone-label">Zone {selectedZone}</span>
      </div>

      <div className="manipulator-content">
        {/* Preview Image */}
        <div
          className={`image-preview ${isPanning ? 'panning' : ''}`}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
        >
          <img
            src={placedImage.thumbnail || placedImage.sourceFile}
            alt="Preview"
            style={{
              transform: `
                scale(${transform.scale})
                translate(${transform.offsetX / transform.scale}px, ${transform.offsetY / transform.scale}px)
                rotate(${transform.rotation}deg)
                scaleX(${transform.flipHorizontal ? -1 : 1})
                scaleY(${transform.flipVertical ? -1 : 1})
              `,
            }}
            draggable={false}
          />
          {isPanning && (
            <div className="pan-hint">
              <span>🖐️ Drag to pan</span>
            </div>
          )}
        </div>

        {/* Scale Control */}
        <div className="control-group">
          <label>
            <span className="control-icon">🔍</span>
            <span>Scale</span>
            <span className="control-value">{transform.scale.toFixed(2)}x</span>
          </label>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={transform.scale}
            onChange={handleScaleChange}
            className="slider"
          />
          <div className="slider-labels">
            <span>0.5x</span>
            <span>3x</span>
          </div>
        </div>

        {/* Rotation Control */}
        <div className="control-group">
          <label>
            <span className="control-icon">🔄</span>
            <span>Rotation</span>
            <span className="control-value">{transform.rotation}°</span>
          </label>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={transform.rotation}
            onChange={handleRotationChange}
            className="slider"
          />
          <div className="slider-labels">
            <span>-180°</span>
            <span>180°</span>
          </div>
        </div>

        {/* Pan Control */}
        <div className="control-group">
          <label>
            <span className="control-icon">✋</span>
            <span>Position</span>
          </label>
          <div className="pan-info">
            <span>X: {transform.offsetX}px</span>
            <span>Y: {transform.offsetY}px</span>
          </div>
          <p className="control-hint">Click and drag the preview image to pan</p>
        </div>

        {/* Flip Controls */}
        <div className="control-group">
          <label>
            <span className="control-icon">🔀</span>
            <span>Flip</span>
          </label>
          <div className="button-row">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleFlipHorizontal}
              className={`btn-flip ${transform.flipHorizontal ? 'active' : ''}`}
            >
              ↔️ Horizontal
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleFlipVertical}
              className={`btn-flip ${transform.flipVertical ? 'active' : ''}`}
            >
              ↕️ Vertical
            </motion.button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="manipulator-actions">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleResetTransform}
            className="btn-reset"
          >
            🔄 Reset
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRemoveImage}
            className="btn-remove"
          >
            🗑️ Remove
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default ImageManipulator;
