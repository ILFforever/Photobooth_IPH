import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  DisplayLayout,
  DisplayLayoutPreview,
  DisplayElement,
  DisplayElementRole,
  createDefaultLayout,
  createDisplayElement,
} from '../../types/displayLayout';
import { OverlayTransform } from '../../types/overlay';
import { createLogger } from '../../utils/logger';
import { useToast } from '../system/ToastContext';

const logger = createLogger('DisplayLayoutContext');

interface DisplayLayoutContextType {
  layouts: DisplayLayoutPreview[];
  activeLayout: DisplayLayout | null;
  selectedElementId: string | null;
  loading: boolean;
  saving: boolean;
  hasUnsavedChanges: boolean;

  loadLayouts: () => Promise<DisplayLayoutPreview[]>;
  saveLayout: (layout: DisplayLayout) => Promise<DisplayLayout>;
  deleteLayout: (id: string) => Promise<void>;
  duplicateLayout: (id: string) => Promise<void>;
  applyLayout: (id: string) => Promise<void>;
  createNewLayout: () => Promise<void>;
  exportLayout: (id: string, filePath: string) => Promise<void>;
  importLayout: (filePath: string) => Promise<void>;

  addElement: (role: DisplayElementRole, overrides?: Partial<DisplayElement>) => void;
  updateElement: (id: string, updates: Partial<DisplayElement>) => void;
  removeElement: (id: string) => void;
  setSelectedElementId: (id: string | null) => void;

  setBackgroundColor: (color: string) => void;
  setBackgroundImage: (image: string | undefined) => void;
  setLayoutName: (name: string) => void;

  updateActiveLayout: (updates: Partial<DisplayLayout>) => void;
}

const DisplayLayoutContext = createContext<DisplayLayoutContextType | null>(null);

export function useDisplayLayout() {
  const ctx = useContext(DisplayLayoutContext);
  if (!ctx) throw new Error('useDisplayLayout must be used within DisplayLayoutProvider');
  return ctx;
}

export function DisplayLayoutProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [layouts, setLayouts] = useState<DisplayLayoutPreview[]>([]);
  const [activeLayout, setActiveLayout] = useState<DisplayLayout | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const loadLayouts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<DisplayLayoutPreview[]>('load_display_layouts');
      setLayouts(result);
      return result;
    } catch (e) {
      logger.error('Failed to load display layouts:', e);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount: load layouts and auto-create the default if none exist.
  // The ref guard prevents double-invocation in React StrictMode dev builds.
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      const existing = await loadLayouts();
      if (existing.length === 0) {
        try {
          const newLayout = createDefaultLayout();
          const saved = await invoke<DisplayLayout>('save_display_layout', { layout: newLayout });
          setLayouts([{ id: saved.id, name: saved.name, thumbnail: saved.thumbnail, createdAt: saved.createdAt }]);
          setActiveLayout(saved);
        } catch (e) {
          logger.error('Failed to create default display layout:', e);
        }
      }
      // Note: Start with no layout selected - user must explicitly choose or create one
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveLayout = useCallback(async (layout: DisplayLayout): Promise<DisplayLayout> => {
    setSaving(true);
    try {
      const saved = await invoke<DisplayLayout>('save_display_layout', { layout });
      await loadLayouts();
      if (activeLayout && saved.id === activeLayout.id) {
        setActiveLayout(saved);
      }
      setHasUnsavedChanges(false);
      showToast('Layout Saved', 'success', 3000, `"${saved.name}" has been saved.`);
      return saved;
    } catch (e) {
      logger.error('Failed to save display layout:', e);
      showToast('Save Failed', 'error', 5000, 'Could not save the layout. Try again.');
      throw e;
    } finally {
      setSaving(false);
    }
  }, [activeLayout, loadLayouts, showToast]);

  const deleteLayout = useCallback(async (id: string) => {
    try {
      const layoutToDelete = layouts.find(l => l.id === id);
      await invoke('delete_display_layout', { layoutId: id });
      if (activeLayout?.id === id) {
        setActiveLayout(null);
        setSelectedElementId(null);
      }
      await loadLayouts();
      showToast('Layout Deleted', 'success', 3000, `"${layoutToDelete?.name || 'Unnamed'}" has been removed.`);
    } catch (e) {
      logger.error('Failed to delete display layout:', e);
      showToast('Delete Failed', 'error', 5000, 'Could not delete the layout. Try again.');
      throw e;
    }
  }, [activeLayout, layouts, loadLayouts, showToast]);

  const duplicateLayout = useCallback(async (id: string) => {
    try {
      const layoutToDuplicate = layouts.find(l => l.id === id);
      await invoke('duplicate_display_layout', { layoutId: id });
      await loadLayouts();
      showToast('Layout Duplicated', 'success', 3000, `"${layoutToDuplicate?.name || 'Unnamed'}" has been copied.`);
    } catch (e) {
      logger.error('Failed to duplicate display layout:', e);
      showToast('Duplicate Failed', 'error', 5000, 'Could not duplicate the layout. Try again.');
      throw e;
    }
  }, [layouts, loadLayouts, showToast]);

  const applyLayout = useCallback(async (id: string) => {
    try {
      const layout = await invoke<DisplayLayout>('get_display_layout', { layoutId: id });
      setActiveLayout(layout);
      setSelectedElementId(null);
    } catch (e) {
      logger.error('Failed to get display layout:', e);
    }
  }, []);

  const createNewLayout = useCallback(async () => {
    const now = new Date().toISOString();
    const newLayout: DisplayLayout = {
      id: '',
      name: 'New Layout',
      backgroundColor: '#1a1a1a',
      isDefault: false,
      elements: [],
      createdAt: now,
      modifiedAt: now,
    };
    const saved = await saveLayout(newLayout);
    setActiveLayout(saved);
    setSelectedElementId(null);
  }, [saveLayout]);

  const addElement = useCallback((role: DisplayElementRole, overrides?: Partial<DisplayElement>) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => {
      if (!prev) return prev;
      const element = createDisplayElement(role, {
        layerOrder: prev.elements.length,
        ...overrides,
      });
      return { ...prev, elements: [...prev.elements, element] };
    });
  }, []);

  const updateElement = useCallback((id: string, updates: Partial<DisplayElement>) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        elements: prev.elements.map(el =>
          el.id === id ? { ...el, ...updates } : el
        ),
      };
    });
  }, []);

  const removeElement = useCallback((id: string) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        elements: prev.elements.filter(el => el.id !== id),
      };
    });
    setSelectedElementId(prev => prev === id ? null : prev);
  }, []);

  const setBackgroundColor = useCallback((color: string) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => prev ? { ...prev, backgroundColor: color } : prev);
  }, []);

  const setBackgroundImage = useCallback((image: string | undefined) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => prev ? { ...prev, backgroundImage: image } : prev);
  }, []);

  const setLayoutName = useCallback((name: string) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => prev ? { ...prev, name } : prev);
  }, []);

  const updateActiveLayout = useCallback((updates: Partial<DisplayLayout>) => {
    setHasUnsavedChanges(true);
    setActiveLayout(prev => prev ? { ...prev, ...updates } : prev);
  }, []);

  const exportLayout = useCallback(async (id: string, filePath: string) => {
    try {
      await invoke('export_display_layout', { layoutId: id, filePath });
      showToast('Layout Exported', 'success', 3000, 'Layout file saved successfully.');
    } catch (e) {
      logger.error('Failed to export display layout:', e);
      showToast('Export Failed', 'error', 5000, 'Could not export the layout. Try again.');
      throw e;
    }
  }, [showToast]);

  const importLayout = useCallback(async (filePath: string) => {
    try {
      const imported = await invoke<DisplayLayout>('import_display_layout', { filePath });
      await loadLayouts();
      setActiveLayout(imported);
      setSelectedElementId(null);
      showToast('Layout Imported', 'success', 3000, `"${imported.name}" has been imported.`);
    } catch (e) {
      logger.error('Failed to import display layout:', e);
      showToast('Import Failed', 'error', 5000, 'Could not import the layout. The file may be invalid.');
      throw e;
    }
  }, [loadLayouts, showToast]);

  return (
    <DisplayLayoutContext.Provider
      value={{
        layouts,
        activeLayout,
        selectedElementId,
        loading,
        saving,
        hasUnsavedChanges,
        loadLayouts,
        saveLayout,
        deleteLayout,
        duplicateLayout,
        applyLayout,
        createNewLayout,
        exportLayout,
        importLayout,
        addElement,
        updateElement,
        removeElement,
        setSelectedElementId,
        setBackgroundColor,
        setBackgroundImage,
        setLayoutName,
        updateActiveLayout,
      }}
    >
      {children}
    </DisplayLayoutContext.Provider>
  );
}
