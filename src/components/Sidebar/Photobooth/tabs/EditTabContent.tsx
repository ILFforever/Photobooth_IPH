import { useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePhotobooth } from '../../../../contexts';
import type { PlacedImage, ImageTransform } from '../../../../types/collage';
import { DEFAULT_TRANSFORM } from '../../../../types/collage';

interface EditTabContentProps {
  zoneId: string;
  placedImage: PlacedImage;
  onUpdate: (zoneId: string, updates: Partial<PlacedImage>) => void;
}

export function EditTabContent({ zoneId, placedImage, onUpdate }: EditTabContentProps) {
  const transform = placedImage.transform;
  const previewSrc = convertFileSrc(placedImage.sourceFile.replace('asset://', ''));

  // Find zone name
  const { photoboothFrame } = usePhotobooth();
  const zone = photoboothFrame?.zones.find(z => z.id === zoneId);
  const zoneIndex = photoboothFrame?.zones.findIndex(z => z.id === zoneId) ?? -1;
  const zoneName = zone ? `Zone ${zoneIndex + 1}` : 'Unknown Zone';

  const updateTransform = useCallback((updates: Partial<ImageTransform>) => {
    onUpdate(zoneId, {
      transform: { ...placedImage.transform, ...updates },
    });
  }, [zoneId, placedImage.transform, onUpdate]);

  const handleZoomIn = () => {
    const newScale = Math.min(3, transform.scale + 0.1);
    updateTransform({ scale: newScale });
  };

  const handleZoomOut = () => {
    const newScale = Math.max(0.5, transform.scale - 0.1);
    updateTransform({ scale: newScale });
  };

  const handleRotationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTransform({ rotation: parseFloat(e.target.value) });
  };

  const handleFlipHorizontal = () => {
    updateTransform({ flipHorizontal: !transform.flipHorizontal });
  };

  const handleFlipVertical = () => {
    updateTransform({ flipVertical: !transform.flipVertical });
  };

  const handleReset = () => {
    const optimalScale = placedImage.originalScale || DEFAULT_TRANSFORM.scale;
    onUpdate(zoneId, {
      transform: { ...DEFAULT_TRANSFORM, scale: optimalScale },
    });
  };

  return (
    <div className="edit-tab-content" style={{ padding: '12px 16px' }}>
      {/* Zone Name Header */}
      <div style={{
        marginBottom: '12px',
        padding: '10px 12px',
        background: 'linear-gradient(135deg, #1f1f1f 0%, #0f0f0f 100%)',
        borderRadius: '10px',
        border: '1px solid #282828',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)',
          }}>
            <span style={{
              fontSize: '14px',
              fontWeight: 800,
              color: '#fff',
              marginTop: '-2px',
            }}>
              {zoneIndex + 1}
            </span>
          </div>
          <div>
            <div style={{
              fontSize: '13px',
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              {zoneName}
            </div>
            <div style={{
              fontSize: '10px',
              color: '#666',
              fontWeight: 500,
              marginTop: '1px',
            }}>
              Photo Editing
            </div>
          </div>
        </div>
      </div>

      {/* Full-Width Preview */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '180px',
        marginBottom: '14px',
        background: 'linear-gradient(145deg, #1f1f1f, #0f0f0f)',
        borderRadius: '12px',
        padding: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.05)',
      }}>
        <div
          className="edit-tab-preview"
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #333',
          }}
        >
          <img
            src={previewSrc}
            alt="Preview"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              transform: `
                scale(${transform.scale})
                translate(${transform.offsetX / transform.scale}px, ${transform.offsetY / transform.scale}px)
                rotate(${transform.rotation}deg)
                scaleX(${transform.flipHorizontal ? -1 : 1})
                scaleY(${transform.flipVertical ? -1 : 1})
              `,
              pointerEvents: 'none',
            }}
            draggable={false}
          />
        </div>
      </div>

      {/* Zoom with +/- buttons */}
      <div style={{
        marginBottom: '14px',
        background: '#1a1a1a',
        padding: '12px',
        borderRadius: '10px',
        border: '1px solid #282828'
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '10px',
          color: '#999',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          fontWeight: 600
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <span>Zoom</span>
        </label>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: '#0f0f0f',
          padding: '6px',
          borderRadius: '8px',
          border: '1px solid #222'
        }}>
          <button
            onClick={handleZoomOut}
            disabled={transform.scale <= 0.5}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '36px',
              background: transform.scale <= 0.5 ? '#1a1a1a' : '#2a2a2a',
              border: 'none',
              borderRadius: '6px',
              color: transform.scale <= 0.5 ? '#555' : '#fff',
              cursor: transform.scale <= 0.5 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              boxShadow: transform.scale <= 0.5 ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.3)',
            }}
            onMouseEnter={(e) => {
              if (transform.scale > 0.5) {
                e.currentTarget.style.background = '#3b82f6';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (transform.scale > 0.5) {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <Minus size={18} />
          </button>
          <div style={{
            minWidth: '60px',
            textAlign: 'center',
            fontSize: '15px',
            fontWeight: 700,
            color: '#3b82f6',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {transform.scale.toFixed(1)}×
          </div>
          <button
            onClick={handleZoomIn}
            disabled={transform.scale >= 3}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '36px',
              background: transform.scale >= 3 ? '#1a1a1a' : '#2a2a2a',
              border: 'none',
              borderRadius: '6px',
              color: transform.scale >= 3 ? '#555' : '#fff',
              cursor: transform.scale >= 3 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              boxShadow: transform.scale >= 3 ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.3)',
            }}
            onMouseEnter={(e) => {
              if (transform.scale < 3) {
                e.currentTarget.style.background = '#3b82f6';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (transform.scale < 3) {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* Rotation */}
      <div style={{
        marginBottom: '14px',
        background: '#1a1a1a',
        padding: '12px',
        borderRadius: '10px',
        border: '1px solid #282828'
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '10px',
          color: '#999',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          fontWeight: 600
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
          </svg>
          <span>Rotation</span>
          <span style={{
            marginLeft: 'auto',
            color: '#3b82f6',
            fontSize: '13px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums'
          }}>
            {transform.rotation}°
          </span>
        </label>
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={transform.rotation}
          onChange={handleRotationChange}
          style={{
            width: '100%',
            accentColor: '#3b82f6',
            height: '6px',
            borderRadius: '3px',
            background: '#0f0f0f',
            border: '1px solid #222'
          }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '6px',
          fontSize: '10px',
          color: '#555',
          fontWeight: 500
        }}>
          <span>-180°</span>
          <span>0°</span>
          <span>180°</span>
        </div>
      </div>

      {/* Position Display - Compact */}
      <div style={{
        marginBottom: '14px',
        background: '#1a1a1a',
        padding: '12px',
        borderRadius: '10px',
        border: '1px solid #282828'
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#999',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          fontWeight: 600
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20" />
          </svg>
          <span>Position</span>
          <div style={{
            display: 'flex',
            gap: '14px',
            marginLeft: 'auto',
            fontSize: '12px',
            color: '#aaa',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600
          }}>
            <span style={{ color: '#3b82f6' }}>X</span>
            <span>{Math.round(transform.offsetX)}px</span>
            <span style={{ color: '#3b82f6' }}>Y</span>
            <span>{Math.round(transform.offsetY)}px</span>
          </div>
        </label>
      </div>

      {/* Flip Buttons - Compact */}
      <div style={{
        marginBottom: '14px',
        background: '#1a1a1a',
        padding: '12px',
        borderRadius: '10px',
        border: '1px solid #282828'
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '10px',
          color: '#999',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          fontWeight: 600
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span>Flip</span>
        </label>
        <div style={{
          display: 'flex',
          gap: '8px',
          background: '#0f0f0f',
          padding: '6px',
          borderRadius: '8px',
          border: '1px solid #222'
        }}>
          <button
            onClick={handleFlipHorizontal}
            title="Flip horizontal"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '44px',
              backgroundColor: transform.flipHorizontal ? '#3b82f6' : '#2a2a2a',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '22px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: transform.flipHorizontal ? '0 2px 8px rgba(59, 130, 246, 0.4)' : '0 2px 4px rgba(0, 0, 0, 0.3)',
            }}
            onMouseEnter={(e) => {
              if (!transform.flipHorizontal) {
                e.currentTarget.style.background = '#3a3a3a';
                e.currentTarget.style.transform = 'scale(1.02)';
              }
            }}
            onMouseLeave={(e) => {
              if (!transform.flipHorizontal) {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            ⬌
          </button>
          <button
            onClick={handleFlipVertical}
            title="Flip vertical"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '44px',
              backgroundColor: transform.flipVertical ? '#3b82f6' : '#2a2a2a',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '22px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: transform.flipVertical ? '0 2px 8px rgba(59, 130, 246, 0.4)' : '0 2px 4px rgba(0, 0, 0, 0.3)',
            }}
            onMouseEnter={(e) => {
              if (!transform.flipVertical) {
                e.currentTarget.style.background = '#3a3a3a';
                e.currentTarget.style.transform = 'scale(1.02)';
              }
            }}
            onMouseLeave={(e) => {
              if (!transform.flipVertical) {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            ⬍
          </button>
        </div>
      </div>

      {/* Reset Button */}
      <button
        onClick={handleReset}
        style={{
          width: '100%',
          padding: '12px',
          background: 'linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%)',
          border: '1px solid #3a3a3a',
          borderRadius: '10px',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'all 0.2s',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #3a3a3a 0%, #2f2f2f 100%)';
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        Reset to Default
      </button>
    </div>
  );
}
