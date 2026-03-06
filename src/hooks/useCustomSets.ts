import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCollage } from '../contexts/CollageContext';
import { usePhotobooth } from '../contexts/PhotoboothContext';
import { useToast } from '../contexts/ToastContext';
import type { CustomSet, CustomSetPreview } from '../types/customSet';
import { createLogger } from '../utils/logger';
const logger = createLogger('useCustomSets');

export function useCustomSets() {
  const { showToast } = useToast();
  const { setSelectedCustomSetName } = useCollage();
  const {
    setPhotoboothCanvasSize,
    setPhotoboothBackground,
    setPhotoboothBackgroundTransform,
    setPhotoboothAutoMatchBackground,
    setPhotoboothOverlays,
    selectedCustomSetId,
    setSelectedCustomSetId,
    setPhotoboothFrame,
  } = usePhotobooth();

  const [customSets, setCustomSets] = useState<CustomSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [expandedSetIds, setExpandedSetIds] = useState<Set<string>>(new Set());

  const loadCustomSets = useCallback(async () => {
    try {
      setLoadingSets(true);
      const previews = await invoke<CustomSetPreview[]>('load_custom_sets');
      const fullSets = await Promise.all(
        previews.map(async (preview) => {
          try {
            return await invoke<CustomSet>('get_custom_set', { setId: preview.id });
          } catch {
            return null;
          }
        })
      );
      setCustomSets(fullSets.filter((s): s is CustomSet => s !== null));
    } catch (error) {
      logger.error('Failed to load custom sets:', error);
    } finally {
      setLoadingSets(false);
    }
  }, []);

  const handleLoadSet = useCallback(async (set: CustomSet) => {
    try {
      logger.debug('[useCustomSets] Loading custom set:', set.name);

      setPhotoboothCanvasSize({
        width: set.canvasSize.width,
        height: set.canvasSize.height,
        name: set.canvasSize.name,
        isCustom: set.canvasSize.isCustom,
        createdAt: set.canvasSize.createdAt,
      });

      setPhotoboothFrame(set.frame);
      setPhotoboothBackground(set.background.value);

      setPhotoboothBackgroundTransform({
        scale: set.backgroundTransform.scale,
        offsetX: set.backgroundTransform.offsetX,
        offsetY: set.backgroundTransform.offsetY,
      });

      setPhotoboothAutoMatchBackground(set.autoMatchBackground);
      setPhotoboothOverlays(set.overlays || []);

      logger.debug('[useCustomSets] Setting selectedCustomSetName to:', set.name);
      setSelectedCustomSetName(set.name);
      setSelectedCustomSetId(set.id);

      showToast('Set loaded', 'success', 2000, `${set.name} has been applied`);
    } catch (error) {
      logger.error('Failed to load custom set:', error);
      showToast('Failed to load set', 'error', 3000);
    }
  }, [
    setPhotoboothCanvasSize,
    setPhotoboothFrame,
    setPhotoboothBackground,
    setPhotoboothBackgroundTransform,
    setPhotoboothAutoMatchBackground,
    setPhotoboothOverlays,
    setSelectedCustomSetName,
    setSelectedCustomSetId,
    showToast,
  ]);

  const toggleSetExpanded = useCallback((setId: string) => {
    setExpandedSetIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(setId)) {
        newSet.delete(setId);
      } else {
        newSet.add(setId);
      }
      return newSet;
    });
  }, []);

  useEffect(() => {
    loadCustomSets();
  }, [loadCustomSets]);

  return {
    customSets,
    loadingSets,
    expandedSetIds,
    selectedCustomSetId,
    loadCustomSets,
    handleLoadSet,
    toggleSetExpanded,
  };
}
