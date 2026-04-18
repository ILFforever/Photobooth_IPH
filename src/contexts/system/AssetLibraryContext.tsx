import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Asset } from '../../types/asset';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AssetLibraryContext');

interface AssetLibraryContextType {
  assets: Asset[];
  /** Synchronously return the browser-compatible URL for an asset, or null if not yet resolved */
  resolveAssetUrl: (assetId: string) => string | null;
  /** Register a file from disk into the library. Returns the Asset (existing or new). */
  registerAsset: (srcPath: string, name: string, tags: string[], assetType: string) => Promise<Asset>;
  /** Delete an asset from the library */
  deleteAsset: (id: string) => Promise<void>;
  /** Rename or retag an asset */
  updateAssetMetadata: (id: string, name: string, tags: string[]) => Promise<Asset>;
  /** Refresh the full asset list from disk */
  refreshAssets: () => Promise<void>;
}

const AssetLibraryContext = createContext<AssetLibraryContextType | undefined>(undefined);

export function AssetLibraryProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  // Map of assetId → browser-compatible URL (convertFileSrc output)
  const urlCache = useRef<Map<string, string>>(new Map());
  // Mutex-like flag to prevent concurrent registration updates
  const isRegistering = useRef<Map<string, boolean>>(new Map());

  const cacheUrl = useCallback((id: string, assetPath: string) => {
    const url = convertFileSrc(assetPath.replace('asset://', ''));
    urlCache.current.set(id, url);
  }, []);

  const resolveAssetUrl = useCallback((assetId: string): string | null => {
    return urlCache.current.get(assetId) ?? null;
  }, []);

  const preloadUrls = useCallback(async (assetList: Asset[]) => {
    const ids = assetList
      .map(a => a.id)
      .filter(id => !urlCache.current.has(id));

    if (ids.length === 0) return;

    // Batch: get all paths in one call
    try {
      const pathMap = await invoke<Record<string, string>>('get_all_asset_paths');
      for (const [id, assetPath] of Object.entries(pathMap)) {
        cacheUrl(id, assetPath);
      }
    } catch (e) {
      logger.warn('Failed to preload asset paths:', e);
    }
  }, [cacheUrl]);

  const refreshAssets = useCallback(async () => {
    try {
      const list = await invoke<Asset[]>('list_assets', {});
      setAssets(list);
      await preloadUrls(list);
    } catch (e) {
      logger.error('Failed to load assets:', e);
    }
  }, [preloadUrls]);

  // Initial load
  useEffect(() => {
    refreshAssets();
  }, [refreshAssets]);

  const registerAsset = useCallback(async (
    srcPath: string,
    name: string,
    tags: string[],
    assetType: string,
  ): Promise<Asset> => {
    const asset = await invoke<Asset>('register_asset', { srcPath, name, tags, assetType });

    // Update cache and list with mutex-like protection
    if (!isRegistering.current.has(asset.id)) {
      isRegistering.current.set(asset.id, true);
      setAssets(prev => {
        const exists = prev.some(a => a.id === asset.id);
        return exists ? prev : [asset, ...prev];
      });
      isRegistering.current.delete(asset.id);
    }

    // Resolve and cache the URL for the newly registered asset
    try {
      const assetPath = await invoke<string>('get_asset_path', { id: asset.id });
      cacheUrl(asset.id, assetPath);
    } catch (e) {
      logger.warn('Failed to resolve path for new asset:', e);
    }

    return asset;
  }, [cacheUrl]);

  const deleteAsset = useCallback(async (id: string) => {
    await invoke('delete_asset', { id });
    urlCache.current.delete(id);
    setAssets(prev => prev.filter(a => a.id !== id));
  }, []);

  const updateAssetMetadata = useCallback(async (id: string, name: string, tags: string[]): Promise<Asset> => {
    const updated = await invoke<Asset>('update_asset_metadata', { id, name, tags });
    setAssets(prev => prev.map(a => a.id === id ? updated : a));
    return updated;
  }, []);

  return (
    <AssetLibraryContext.Provider value={{
      assets,
      resolveAssetUrl,
      registerAsset,
      deleteAsset,
      updateAssetMetadata,
      refreshAssets,
    }}>
      {children}
    </AssetLibraryContext.Provider>
  );
}

export function useAssetLibrary() {
  const context = useContext(AssetLibraryContext);
  if (!context) {
    throw new Error('useAssetLibrary must be used within an AssetLibraryProvider');
  }
  return context;
}
