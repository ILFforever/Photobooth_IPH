import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Monitor, Eye, X } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { DisplayLayoutPreview, DisplayLayout } from '../../../../types/displayLayout';
import { DisplayElementLayer } from '../../../DisplayLayoutEditor/DisplayElementLayer';

interface DisplayLayoutSectionProps {
  expanded: boolean;
  onToggle: () => void;
  layouts: DisplayLayoutPreview[];
  selectedDisplayLayoutId: string | null;
  onSelectLayout: (id: string | null) => void;
}

function getThumbnailSrc(thumbnail: string): string {
  return thumbnail.startsWith('asset://')
    ? convertFileSrc(thumbnail.replace('asset://', ''))
    : thumbnail;
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const PREVIEW_W = 1100;

// Accepts either a ready-made layout or an ID to fetch from the backend
function LayoutPreviewCanvas({ layoutId, staticLayout }: { layoutId?: string; staticLayout?: DisplayLayout }) {
  const [layout, setLayout] = useState<DisplayLayout | null>(staticLayout ?? null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(PREVIEW_W / CANVAS_W);

  useEffect(() => {
    if (staticLayout) { setLayout(staticLayout); return; }
    if (!layoutId) return;
    setLayout(null);
    setError(null);
    invoke<DisplayLayout>('get_display_layout', { layoutId })
      .then(setLayout)
      .catch(e => setError(String(e)));
  }, [layoutId, staticLayout]);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.offsetWidth;
      const canvasW = layout?.canvasWidth ?? CANVAS_W;
      const canvasH = layout?.canvasHeight ?? CANVAS_H;
      setScale(Math.min(w / canvasW, (w * (canvasH / canvasW)) / canvasH));
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [layout]);

  const canvasW = layout?.canvasWidth ?? CANVAS_W;
  const canvasH = layout?.canvasHeight ?? CANVAS_H;

  if (error) {
    return (
      <div className="display-layout-preview-placeholder">
        <Monitor size={40} />
        <span>Failed to load layout</span>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="display-layout-preview-placeholder">
        <span className="display-layout-preview-loading" />
      </div>
    );
  }

  const scaledW = Math.round(canvasW * scale);
  const scaledH = Math.round(canvasH * scale);

  const bgSrc = layout.backgroundImage
    ? (layout.backgroundImage.startsWith('asset://')
        ? convertFileSrc(layout.backgroundImage.replace('asset://', ''))
        : layout.backgroundImage)
    : undefined;

  return (
    <div ref={containerRef} className="display-layout-preview-canvas-wrap">
      <div style={{ width: scaledW, height: scaledH, position: 'relative', flexShrink: 0 }}>
        <div
          style={{
            width: canvasW,
            height: canvasH,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            position: 'absolute',
            top: 0,
            left: 0,
            backgroundColor: layout.backgroundColor,
            backgroundImage: bgSrc ? `url(${bgSrc})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            overflow: 'hidden',
          }}
        >
          {layout.elements
            .filter(el => el.visible)
            .sort((a, b) => a.layerOrder - b.layerOrder)
            .map(element => (
              <DisplayElementLayer
                key={element.id}
                element={element}
                isSelected={false}
                onSelect={() => {}}
                onUpdate={() => {}}
                canvasScale={scale}
                canvasWidth={canvasW}
                canvasHeight={canvasH}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

// Static mock of the real hardcoded default finalize screen
function DefaultLayoutPreview() {
  return (
    <div style={{
      width: '100%', aspectRatio: '16/9',
      background: '#000000', display: 'flex', alignItems: 'center',
      padding: '4% 8% 4% 3%', gap: '3%', boxSizing: 'border-box',
    }}>
      {/* Collage placeholder — 2×6 inch = 1:3 portrait */}
      <div style={{
        flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          aspectRatio: '2/6', height: '90%',
          background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#aaa', fontSize: '1vw', flexShrink: 0,
        }}>
          Collage
        </div>
      </div>
      {/* Divider */}
      <div style={{ width: 1, height: '60%', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      {/* QR section */}
      <div style={{
        flexShrink: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '3%', padding: '0 1.5%',
      }}>
        <div style={{
          background: '#fff', padding: '1.2%', borderRadius: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '10%',
        }}>
          <div style={{
            width: '12vh', height: '12vh',
            background: 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#aaa', fontSize: '0.7vw',
          }}>
            QR Code
          </div>
        </div>
        <span style={{ fontSize: '0.85vw', fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          SCAN FOR PHOTOS
        </span>
        <span style={{ fontSize: '0.6vw', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.02em' }}>
          Thank you for using IPH Photobooth!
        </span>
      </div>
    </div>
  );
}

type PreviewTarget =
  | { type: 'default'; name: string }
  | { type: 'id'; name: string; id: string; createdAt: string };

export function DisplayLayoutSection({
  expanded,
  onToggle,
  layouts,
  selectedDisplayLayoutId,
  onSelectLayout,
}: DisplayLayoutSectionProps) {
  const selectedLayout = layouts.find(l => l.id === selectedDisplayLayoutId) ?? null;
  const isDefaultActive = !selectedDisplayLayoutId;
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  return (
    <>
      <div className="collapsible-section">
        <button className="collapsible-header" onClick={onToggle}>
          <div className="collapsible-header-left">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="collapsible-title">Guest Display</span>
          </div>
          <span className={`collapsible-badge ${isDefaultActive ? 'badge-yellow' : ''}`}>
            {selectedLayout ? selectedLayout.name : 'Classic'}
          </span>
        </button>

        {expanded && (
          <div className="collapsible-content">
            <div className="display-layout-section-list">
              {/* None / Default option */}
              <button
                className={`display-layout-section-item ${!selectedDisplayLayoutId ? 'active' : ''}`}
                onClick={() => onSelectLayout(null)}
              >
                <div className="display-layout-section-thumb display-layout-section-thumb--none">
                  <Monitor size={16} />
                </div>
                <div className="display-layout-section-info">
                  <span className="display-layout-section-name">Classic</span>
                  <span className="display-layout-section-desc">QR + collage side by side</span>
                </div>
                <button
                  className="display-layout-preview-btn"
                  onClick={e => {
                    e.stopPropagation();
                    setPreview({ type: 'default', name: 'Classic' });
                  }}
                  title="Preview layout"
                >
                  <Eye size={13} />
                </button>
              </button>

              {layouts.map(layout => (
                <button
                  key={layout.id}
                  className={`display-layout-section-item ${selectedDisplayLayoutId === layout.id ? 'active' : ''}`}
                  onClick={() => onSelectLayout(layout.id)}
                >
                  <div className="display-layout-section-thumb">
                    {layout.thumbnail ? (
                      <img
                        src={getThumbnailSrc(layout.thumbnail)}
                        alt={layout.name}
                      />
                    ) : (
                      <Monitor size={16} />
                    )}
                  </div>
                  <div className="display-layout-section-info">
                    <span className="display-layout-section-name">{layout.name}</span>
                    {layout.isDefault ? (
                      <span className="display-layout-section-badge">Default</span>
                    ) : (
                      <span className="display-layout-card-badge muted">
                        {new Date(layout.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <button
                    className="display-layout-preview-btn"
                    onClick={e => { e.stopPropagation(); setPreview({ type: 'id', name: layout.name, id: layout.id, createdAt: layout.createdAt }); }}
                    title="Preview layout"
                  >
                    <Eye size={13} />
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div
          className="display-layout-preview-overlay"
          onClick={() => setPreview(null)}
        >
          <div
            className="display-layout-preview-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="display-layout-preview-header">
              <div className="display-layout-preview-title-group">
                <span className="display-layout-preview-title">{preview.name}</span>
                {preview.type === 'id' && (
                  <span className="display-layout-card-badge muted">
                    {new Date(preview.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </div>
              <button
                className="display-layout-preview-close"
                onClick={() => setPreview(null)}
                title="Close preview"
              >
                <X size={14} />
              </button>
            </div>
            {preview.type === 'default'
              ? <DefaultLayoutPreview />
              : <LayoutPreviewCanvas layoutId={preview.id} />}
          </div>
        </div>
      )}
    </>
  );
}
