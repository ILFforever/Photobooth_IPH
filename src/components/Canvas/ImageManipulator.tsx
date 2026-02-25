import { useState, useEffect } from "react";
import { useCollage } from "../../contexts/CollageContext";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./ImageManipulator.css";

const ImageManipulator = () => {
  const { selectedZone, placedImages, updatePlacedImage, removePlacedImage, background, backgroundTransform, setBackgroundTransform, isBackgroundSelected } = useCollage();
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const placedImage = selectedZone ? placedImages.get(selectedZone) : null;
  const isBackgroundMode = isBackgroundSelected && background;

  const previewSrc = isBackgroundMode
    ? (background?.startsWith('http') || background?.startsWith('data:')
        ? background
        : convertFileSrc(background?.replace('asset://', '') || ''))
    : placedImage
      ? convertFileSrc(placedImage.sourceFile.replace('asset://', ''))
      : '';

  useEffect(() => {
    setIsPanning(false);
  }, [selectedZone, isBackgroundSelected]);

  useEffect(() => {
    if (isPanning) {
      const handleMouseUp = () => setIsPanning(false);
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isPanning]);

  if ((!selectedZone || !placedImage) && !isBackgroundMode) {
    return (
      <div className="im">
        <div className="im-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <p>Select an image to adjust</p>
        </div>
      </div>
    );
  }

  const transform = isBackgroundMode ? backgroundTransform : placedImage!.transform;

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    if (isBackgroundMode) {
      setBackgroundTransform({ ...backgroundTransform, scale });
    } else {
      updatePlacedImage(selectedZone!, { transform: { ...placedImage!.transform, scale } });
    }
  };

  const handleRotationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isBackgroundMode) return;
    const rotation = parseFloat(e.target.value);
    updatePlacedImage(selectedZone!, { transform: { ...placedImage!.transform, rotation } });
  };

  const handleFlipHorizontal = () => {
    if (isBackgroundMode) return;
    updatePlacedImage(selectedZone!, {
      transform: { ...placedImage!.transform, flipHorizontal: !placedImage!.transform.flipHorizontal },
    });
  };

  const handleFlipVertical = () => {
    if (isBackgroundMode) return;
    updatePlacedImage(selectedZone!, {
      transform: { ...placedImage!.transform, flipVertical: !placedImage!.transform.flipVertical },
    });
  };

  const handleResetTransform = () => {
    if (isBackgroundMode) {
      setBackgroundTransform({ scale: 1, offsetX: 0, offsetY: 0 });
    } else {
      const optimalScale = placedImage!.originalScale || DEFAULT_TRANSFORM.scale;
      updatePlacedImage(selectedZone!, { transform: { ...DEFAULT_TRANSFORM, scale: optimalScale } });
    }
  };

  const handleRemoveImage = () => {
    if (!isBackgroundMode && selectedZone) {
      removePlacedImage(selectedZone);
    }
  };

  const handlePanStart = (e: React.MouseEvent) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - transform.offsetX, y: e.clientY - transform.offsetY });
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const offsetX = e.clientX - panStart.x;
    const offsetY = e.clientY - panStart.y;
    if (isBackgroundMode) {
      setBackgroundTransform({ ...backgroundTransform, offsetX, offsetY });
    } else {
      updatePlacedImage(selectedZone!, { transform: { ...placedImage!.transform, offsetX, offsetY } });
    }
  };

  return (
    <div className="im">
      {/* Header */}
      <div className="im-header">
        <div className="im-header-left">
          <h3>{isBackgroundMode ? 'Background' : 'Image Controls'}</h3>
          <span className="im-zone">{isBackgroundMode ? 'Background Layer' : selectedZone}</span>
        </div>
      </div>

      <div className="im-body">
        {/* Preview */}
        <div
          className={`im-preview ${isPanning ? 'panning' : ''}`}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={() => setIsPanning(false)}
          onMouseLeave={() => setIsPanning(false)}
        >
          <img
            src={previewSrc}
            alt="Preview"
            style={{
              transform: isBackgroundMode
                ? `scale(${transform.scale}) translate(${transform.offsetX / transform.scale}px, ${transform.offsetY / transform.scale}px)`
                : `scale(${placedImage!.transform.scale}) translate(${placedImage!.transform.offsetX / placedImage!.transform.scale}px, ${placedImage!.transform.offsetY / placedImage!.transform.scale}px) rotate(${placedImage!.transform.rotation}deg) scaleX(${placedImage!.transform.flipHorizontal ? -1 : 1}) scaleY(${placedImage!.transform.flipVertical ? -1 : 1})`,
            }}
            draggable={false}
          />
          {isPanning && (
            <div className="im-pan-badge">Panning</div>
          )}
        </div>

        {/* Scale */}
        <div className="im-control">
          <div className="im-control-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            <span>Scale</span>
            <span className="im-value">{transform.scale.toFixed(2)}x</span>
          </div>
          <div className="im-slider-wrap">
            <input type="range" min="0.5" max="3" step="0.1" value={transform.scale} onChange={handleScaleChange} className="im-slider" />
            <div className="im-slider-labels"><span>0.5x</span><span>3x</span></div>
          </div>
        </div>

        {/* Rotation */}
        {!isBackgroundMode && (
          <div className="im-control">
            <div className="im-control-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/>
              </svg>
              <span>Rotation</span>
              <span className="im-value">{placedImage!.transform.rotation}°</span>
            </div>
            <div className="im-slider-wrap">
              <input type="range" min="-180" max="180" step="1" value={placedImage!.transform.rotation} onChange={handleRotationChange} className="im-slider" />
              <div className="im-slider-labels"><span>-180°</span><span>180°</span></div>
            </div>
          </div>
        )}

        {/* Position */}
        <div className="im-control">
          <div className="im-control-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20"/>
            </svg>
            <span>Position</span>
            <div className="im-pos-values">
              <span>X: {Math.round(transform.offsetX)}</span>
              <span>Y: {Math.round(transform.offsetY)}</span>
            </div>
          </div>
          <p className="im-hint">Drag the preview to pan</p>
        </div>

        {/* Flip */}
        {!isBackgroundMode && (
          <div className="im-control">
            <div className="im-control-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
              <span>Flip</span>
            </div>
            <div className="im-flip-row">
              <button onClick={handleFlipHorizontal} className={`im-flip-btn ${placedImage!.transform.flipHorizontal ? 'active' : ''}`} title="Flip horizontal">⬌</button>
              <button onClick={handleFlipVertical} className={`im-flip-btn ${placedImage!.transform.flipVertical ? 'active' : ''}`} title="Flip vertical">⬍</button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="im-actions">
          <button className="im-btn-reset" onClick={handleResetTransform}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
            Reset
          </button>
          {!isBackgroundMode && (
            <button className="im-btn-remove" onClick={handleRemoveImage}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageManipulator;
