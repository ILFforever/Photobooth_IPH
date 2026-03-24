import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { useCollage } from '../../../contexts';
import { Background } from '../../../types/background';
import Icon from '@mdi/react';
import { mdiPlus, mdiDeleteOutline } from '@mdi/js';
import './BackgroundSidebar.css';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('BackgroundSidebar');

export function BackgroundSidebar() {
  const {
    backgrounds,
    setBackgrounds,
    background,
    setBackground,
    autoMatchBackground,
    setAutoMatchBackground,
    canvasSize,
    setCanvasSize,
    setBackgroundDimensions,
    activeSidebarTab,
  } = useCollage();

  const [deleteMode, setDeleteMode] = useState(false);

  useEffect(() => {
    if (activeSidebarTab !== 'background') setDeleteMode(false);
  }, [activeSidebarTab]);
  const [importingBackgrounds, setImportingBackgrounds] = useState<Set<string>>(new Set());

  const handleMatchBackground = (bgValue: string) => {
    const isHexColor = /^#([0-9A-F]{3}){1,2}$/i.test(bgValue);
    if (isHexColor) {
      setBackgroundDimensions({ width: 1200, height: 1800 });
      setCanvasSize({ width: 1200, height: 1800, name: '1200×1800', isCustom: true });
    } else {
      const img = new Image();
      img.src = bgValue;
      img.onload = () => {
        setBackgroundDimensions({ width: img.width, height: img.height });
        setCanvasSize({
          width: img.width,
          height: img.height,
          name: `${img.width}×${img.height}`,
          isCustom: true,
        });
      };
    }
  };

  const handleSelectBackground = (bg: Background) => {
    let finalValue = bg.value;
    if (bg.value.startsWith('asset://')) {
      finalValue = convertFileSrc(bg.value.replace('asset://', ''));
    }
    if (!canvasSize && !autoMatchBackground) {
      setAutoMatchBackground(true);
    }
    setBackground(finalValue);
    if (autoMatchBackground) {
      handleMatchBackground(finalValue);
    }
  };

  const handleImportBackground = async () => {
    try {
      const selected = await invoke<string>('select_file');
      if (!selected) return;

      const tempId = `importing-${Date.now()}`;
      setImportingBackgrounds(prev => new Set(prev).add(tempId));

      const fileName = (selected as string).split(/[\\/]/).pop() || 'Custom Background';
      const newBg = await invoke<Background>('import_background', {
        filePath: selected,
        name: fileName,
      });

      const updated = await invoke<Background[]>('load_backgrounds');
      setBackgrounds(updated);

      let finalValue = newBg.value;
      if (newBg.value.startsWith('asset://')) {
        finalValue = convertFileSrc(newBg.value.replace('asset://', ''));
      }
      setBackground(finalValue);
      if (autoMatchBackground) {
        setTimeout(() => handleMatchBackground(finalValue), 100);
      }

      setImportingBackgrounds(prev => {
        const s = new Set(prev);
        s.delete(tempId);
        return s;
      });
    } catch (error) {
      logger.error('Failed to import background:', error);
      setImportingBackgrounds(new Set());
    }
  };

  const handleDeleteBackground = async (bg: Background) => {
    if (bg.background_type !== 'image') return;
    try {
      await invoke('delete_background', { backgroundId: bg.id });
      const updated = await invoke<Background[]>('load_backgrounds');
      setBackgrounds(updated);

      let bgValueForCompare = bg.value;
      if (bg.value.startsWith('asset://')) {
        bgValueForCompare = convertFileSrc(bg.value.replace('asset://', ''));
      }
      if (background === bgValueForCompare) {
        setBackground(null);
      }
    } catch (error) {
      logger.error('Failed to delete background:', error);
    }
  };

  const sorted = backgrounds
    .filter(bg => bg.background_type !== 'gradient')
    .sort((a, b) => {
      const aIsImage = a.background_type === 'image';
      const bIsImage = b.background_type === 'image';
      if (aIsImage && !bIsImage) return -1;
      if (!aIsImage && bIsImage) return 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="bg-sidebar">
      <div className="bg-sidebar-header">
        <h3>Backgrounds</h3>
        <div className="bg-sidebar-actions">
          <button
            className={`bg-action-btn ${deleteMode ? 'is-delete-mode' : ''}`}
            onClick={() => setDeleteMode(d => !d)}
            title={deleteMode ? 'Exit delete mode' : 'Delete backgrounds'}
          >
            <Icon path={mdiDeleteOutline} size={0.85} />
          </button>
          <button
            className="bg-action-btn"
            onClick={handleImportBackground}
            title="Add background image"
          >
            <Icon path={mdiPlus} size={0.85} />
          </button>
        </div>
      </div>

      <div className="bg-sidebar-content">
        <div className="bg-grid">
          {/* Skeleton loaders for in-progress imports */}
          {Array.from(importingBackgrounds).map(tempId => (
            <div key={tempId} className="bg-card skeleton-loading">
              <div className="bg-card-thumb skeleton-thumbnail" />
              <div className="bg-card-name skeleton-text skeleton-filename" />
            </div>
          ))}

          {sorted.length === 0 && importingBackgrounds.size === 0 ? (
            <div className="bg-empty">
              <span>No backgrounds yet</span>
              <button className="bg-import-btn" onClick={handleImportBackground}>
                <Icon path={mdiPlus} size={0.85} />
                Add Image
              </button>
            </div>
          ) : (
            sorted.map(bg => {
              let bgValueForCompare = bg.value;
              if (bg.value.startsWith('asset://')) {
                bgValueForCompare = convertFileSrc(bg.value.replace('asset://', ''));
              }
              const isSelected = background === bgValueForCompare;
              const isDeletable = bg.background_type === 'image';

              return (
                <motion.div
                  key={bg.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (deleteMode && isDeletable) handleDeleteBackground(bg);
                    else if (!deleteMode) handleSelectBackground(bg);
                  }}
                  className={`bg-card ${isSelected ? 'selected' : ''} ${deleteMode ? 'delete-mode' : ''} ${deleteMode && !isDeletable ? 'non-deletable' : ''}`}
                >
                  <div
                    className="bg-card-thumb"
                    style={bg.background_type !== 'image' ? { backgroundColor: bg.value } : {}}
                  >
                    {bg.background_type === 'image' && (bg.thumbnail || bg.value.startsWith('asset://')) && (
                      <img
                        src={convertFileSrc((bg.thumbnail || bg.value).replace('asset://', ''))}
                        alt={bg.name}
                      />
                    )}
                    {deleteMode && isDeletable && (
                      <div className="bg-card-delete-overlay">
                        <div className="bg-card-delete-circle">
                          <Icon path={mdiDeleteOutline} size={1} />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="bg-card-name">{bg.name}</span>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
