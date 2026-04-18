import { useRef, useState, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import Icon from '@mdi/react';
import { mdiMonitor } from '@mdi/js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useDisplayLayout } from '../../contexts/display/DisplayLayoutContext';
import { DisplayElementLayer } from './DisplayElementLayer';
import { ElementListSidebar } from './ElementListSidebar';
import { SnapGuides, EMPTY_SNAP_GUIDES } from '../../utils/canvas/snapUtils';
import './DisplayCanvas.css';
import './display-common.css';

const CANVAS_W_DEFAULT = 1920;
const CANVAS_H_DEFAULT = 1080;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

export function DisplayCanvas() {
  const { activeLayout, selectedElementId, setSelectedElementId, updateElement, createNewLayout, importLayout } = useDisplayLayout();

  const handleImport = async () => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'IPH Layout', extensions: ['iplayout'] }] as any,
    });
    if (filePath) {
      const path = typeof filePath === 'string' ? filePath : (filePath as any).path;
      try { await importLayout(path); } catch {}
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>(EMPTY_SNAP_GUIDES);

  const canvasW = activeLayout?.canvasWidth ?? CANVAS_W_DEFAULT;
  const canvasH = activeLayout?.canvasHeight ?? CANVAS_H_DEFAULT;
  const canvasScale = fitScale * zoom;

  useEffect(() => {
    const updateFit = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = (rect.width - 48) / canvasW;
      const scaleY = (rect.height - 48) / canvasH;
      setFitScale(Math.min(scaleX, scaleY));
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [canvasW, canvasH]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(prev => {
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((prev + delta) * 100) / 100));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100)), []);
  const handleZoomReset = useCallback(() => setZoom(1), []);
  const handleCanvasClick = useCallback(() => setSelectedElementId(null), [setSelectedElementId]);

  const scaledW = Math.round(canvasW * canvasScale);
  const scaledH = Math.round(canvasH * canvasScale);

  const zoomGrowth = Math.max(0, zoom - 1);
  const spacing = zoomGrowth * scaledH * 0.5;

  return (
    <div className="display-canvas-area">
      {/* Canvas container */}
      <div ref={containerRef} className="display-canvas-container" onClick={handleCanvasClick}>
        <div className="display-canvas-scroll-content">
        {!activeLayout ? (
          <div className="display-canvas-empty">
            <div className="display-canvas-empty-content">
              <div className="display-canvas-empty-icon">
                <Icon path={mdiMonitor} size={2.5} />
              </div>
              <h3 className="display-canvas-empty-title">Design Your Guest Display</h3>
              <p className="display-canvas-empty-description">
                Create custom finalize screens that guests see after their photo session.
                Position the collage, QR code, images, and text exactly how you want.
              </p>
              <div className="display-canvas-empty-actions">
                <button
                  className="display-canvas-empty-cta"
                  onClick={createNewLayout}
                >
                  Create Your First Layout
                </button>
                <button
                  className="display-canvas-empty-import"
                  onClick={handleImport}
                >
                  Import a layout ( .iplayout )
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Invisible spacer to allow scrolling when zoomed */}
            {spacing > 0 && <div style={{ height: `${spacing}px`, flexShrink: 0 }} />}

            <div style={{ width: scaledW, height: scaledH, position: 'relative', flexShrink: 0 }}>
            <div
              className="display-canvas"
              style={{
                width: canvasW,
                height: canvasH,
                transformOrigin: 'top left',
                transform: `scale(${canvasScale})`,
                position: 'absolute',
                top: 0,
                left: 0,
                backgroundColor: activeLayout.backgroundColor,
                backgroundImage: activeLayout.backgroundImage
                  ? `url("${activeLayout.backgroundImage.startsWith('asset://') ? convertFileSrc(activeLayout.backgroundImage.replace('asset://', '')) : activeLayout.backgroundImage}")`
                  : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              onClick={handleCanvasClick}
              title="Click element to select • Drag to move • Use Ctrl+Scroll to zoom"
            >
              {activeLayout.elements
                .sort((a, b) => a.layerOrder - b.layerOrder)
                .map(element => (
                  <DisplayElementLayer
                    key={element.id}
                    element={element}
                    isSelected={selectedElementId === element.id}
                    onSelect={() => setSelectedElementId(element.id)}
                    onUpdate={(updates) => updateElement(element.id, updates)}
                    canvasScale={canvasScale}
                    canvasWidth={canvasW}
                    canvasHeight={canvasH}
                    onSnapGuidesChange={setSnapGuides}
                  />
                ))}

              {snapGuides.centerH && (
                <div className="snap-guide snap-guide-vertical" style={{ position: 'absolute', left: '50%', top: 0, height: '100%', transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 200 }} />
              )}
               {snapGuides.centerV && (
                 <div className="snap-guide snap-guide-horizontal" style={{ position: 'absolute', top: '50%', left: 0, width: '100%', transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 200 }} />
               )}
            </div>
            </div>
            {spacing > 0 && <div style={{ height: `${spacing}px`, flexShrink: 0 }} />}
           </>
        )}
        </div>
      </div>

      {/* Overlay for fixed-position controls */}
      <div className="display-canvas-overlay">
        {/* Zoom controls */}
        <div className="display-zoom-controls" onClick={e => e.stopPropagation()}>
          <button className="display-zoom-btn" onClick={handleZoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out (Ctrl+Scroll)">
            <ZoomOut size={14} />
          </button>
          <span className="display-zoom-level">{Math.round(zoom * 100)}%</span>
          <button className="display-zoom-btn" onClick={handleZoomIn} disabled={zoom >= ZOOM_MAX} title="Zoom in (Ctrl+Scroll)">
            <ZoomIn size={14} />
          </button>
          <button className="display-zoom-btn" onClick={handleZoomReset} disabled={zoom === 1} title="Reset zoom">
            <RotateCcw size={14} />
          </button>
        </div>

        {/* Interaction hints */}
        {activeLayout && (
          <div className="display-canvas-hints">
            <div className="display-hint-item">
              <span className="display-hint-key">Click</span>
              <span className="display-hint-label">to select</span>
            </div>
            <div className="display-hint-item">
              <span className="display-hint-key">Drag</span>
              <span className="display-hint-label">to move</span>
            </div>
            <div className="display-hint-item">
              <span className="display-hint-key display-hint-arrows">
                <ArrowUp size={12} />
                <ArrowDown size={12} />
                <ArrowLeft size={12} />
                <ArrowRight size={12} />
              </span>
              <span className="display-hint-label">1px / </span>
              <span className="display-hint-key">Shift</span>
              <span>+</span>
              <span>10px</span>
            </div>
            <div className="display-hint-item">
              <span className="display-hint-key">Ctrl+Scroll</span>
              <span className="display-hint-label">to zoom</span>
            </div>
            <div className="display-hint-item">
              <span className="display-hint-key">Delete</span>
              <span className="display-hint-label">to remove</span>
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar: Element list + properties */}
      <div className="display-editor-right">
        <ElementListSidebar />
      </div>
    </div>
  );
}
