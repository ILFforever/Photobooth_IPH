import { useState, useRef, useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkingFolder } from '../../contexts/WorkingFolderContext';
import { WorkingImage } from '../../types/assets';
import './WorkingFolderGallery.css';

interface DraggableImageProps {
  img: WorkingImage;
  isSelected: boolean;
  onSelect: () => void;
  refreshTrigger: number;
}

// URL cache for converted file paths - module level cache
let globalRefreshTrigger = 0;
const urlCache = new Map<string, string>();

function getCachedUrl(path: string, currentRefreshTrigger: number): string {
  const cacheKey = `${path}-${currentRefreshTrigger}`;
  if (!urlCache.has(cacheKey)) {
    urlCache.set(cacheKey, convertFileSrc(path.replace('asset://', '')));
  }
  return urlCache.get(cacheKey)!;
}

// Clear old cache entries when refresh trigger changes
function cleanupOldCache(currentRefreshTrigger: number) {
  if (currentRefreshTrigger > globalRefreshTrigger) {
    for (const [key] of urlCache.entries()) {
      if (!key.endsWith(`-${currentRefreshTrigger}`)) {
        urlCache.delete(key);
      }
    }
    globalRefreshTrigger = currentRefreshTrigger;
  }
}

function DraggableImage({ img, isSelected, onSelect, refreshTrigger }: DraggableImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const imageUrl = getCachedUrl(img.thumbnail || img.path, refreshTrigger);

  useEffect(() => {
    cleanupOldCache(refreshTrigger);
  }, [refreshTrigger]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setImageLoaded(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const dragItem = { path: img.path, thumbnail: img.thumbnail || img.path, dimensions: img.dimensions };

  const [{ isDragging }, drag] = useDrag({
    type: 'IMAGE',
    item: dragItem,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  drag(ref);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDimensions = (width: number, height: number) => {
    if (width >= 1920 || height >= 1920) {
      return `${(width / 1000).toFixed(1)}K × ${(height / 1000).toFixed(1)}K`;
    }
    return `${width} × ${height}`;
  };

  return (
    <div
      ref={ref}
      className={`image-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${imageLoaded ? 'loaded' : 'loading'}`}
      onClick={onSelect}
      style={{ opacity: isDragging ? 0.5 : 1, cursor: 'grab' }}
    >
      {img.thumbnail ? (
        <img
          key={`img-${refreshTrigger}`}
          src={imageUrl}
          alt={img.filename}
          className="thumbnail"
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
        />
      ) : (
        <div className="no-thumbnail">
          <span className="file-ext">{img.extension.toUpperCase()}</span>
        </div>
      )}

      {/* Quick Info Bar */}
      <div className="image-info">
        <div className="filename" title={img.filename}>
          {img.filename}
        </div>
        <div className="meta-row">
          <span className="filesize">{formatFileSize(img.size)}</span>
          {img.dimensions && (
            <>
              <span className="separator">•</span>
              <span className="dimensions">{formatDimensions(img.dimensions.width, img.dimensions.height)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Skeleton loader component
function SkeletonImageCard() {
  return (
    <div className="image-item skeleton-loading">
      <div className="skeleton-thumbnail" />
      <div className="image-info">
        <div className="skeleton-text skeleton-filename" />
        <div className="skeleton-text skeleton-meta" />
      </div>
    </div>
  );
}

export function WorkingFolderGallery() {
  const {
    folderPath,
    setFolderPath,
    setImages,
    loading,
    setLoading,
    selectedImage,
    setSelectedImage,
    loadedImagesMap,
    setLoadedImagesMap,
    skeletonCount,
    setSkeletonCount,
    refreshTrigger,
    setRefreshTrigger
  } = useWorkingFolder();

  const [searchTerm, setSearchTerm] = useState('');

  const hasLoadedRef = useRef(false);
  const lastActiveTimeRef = useRef(Date.now());
  const rafIdRef = useRef<number | undefined>(undefined);

  // Time-based sleep detection
  useEffect(() => {
    const updateActiveTime = () => {
      const now = Date.now();
      const elapsed = now - lastActiveTimeRef.current;

      if (elapsed > 2000 && loadedImagesMap.size > 0) {
        setRefreshTrigger(refreshTrigger + 1);
      }

      lastActiveTimeRef.current = now;
      rafIdRef.current = requestAnimationFrame(updateActiveTime);
    };

    rafIdRef.current = requestAnimationFrame(updateActiveTime);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedImagesMap.size, refreshTrigger]);

  // Force refresh when component mounts
  useEffect(() => {
    if (loadedImagesMap.size > 0) {
      setRefreshTrigger(refreshTrigger + 1);
    }
    lastActiveTimeRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedImagesMap.size]);

  // Visibility change handler
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && loadedImagesMap.size > 0) {
        setRefreshTrigger(refreshTrigger + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window focus handler
  useEffect(() => {
    const handleFocus = () => {
      if (loadedImagesMap.size > 0) {
        setRefreshTrigger(refreshTrigger + 1);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up event listeners for progressive loading
  useEffect(() => {
    const unlistenPromises = [
      listen<number>('thumbnail-total-count', (event) => {
        setSkeletonCount(event.payload);
        if (!hasLoadedRef.current || loadedImagesMap.size === 0) {
          setLoadedImagesMap(new Map());
          hasLoadedRef.current = false;
        }
      }),

      listen<{ current: number; total: number; image: WorkingImage }>('thumbnail-loaded', (event) => {
        setLoadedImagesMap(prev => {
          const newMap = new Map(prev);
          newMap.set(event.payload.current - 1, event.payload.image);
          if (event.payload.current === event.payload.total) {
            hasLoadedRef.current = true;
          }
          return newMap;
        });
      }),
    ];

    return () => {
      unlistenPromises.forEach(promise => {
        promise.then(unlisten => unlisten());
      });
    };
  }, [loadedImagesMap.size]);

  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      setImages([]);
      setLoadedImagesMap(new Map());
      setSkeletonCount(0);

      // Don't await - let it run in background while events update the UI
      invoke<{ path: string; images: WorkingImage[] }>('select_working_folder')
        .then(result => {
          setFolderPath(result.path);
          // Set final images from backend (in case any were missed)
          setImages(result.images);
          // Convert array to map with indices
          const finalMap = new Map<number, WorkingImage>();
          result.images.forEach((img, index) => finalMap.set(index, img));
          setLoadedImagesMap(finalMap);
        })
        .catch(error => {
          console.error('Failed to select working folder:', error);
          alert(`Failed to select folder: ${error}`);
        })
        .finally(() => {
          setLoading(false);
        });
    } catch (error) {
      console.error('Failed to select working folder:', error);
      alert(`Failed to select folder: ${error}`);
      setLoading(false);
    }
  };

  // Convert map to sorted array for filtering
  const loadedImages = Array.from(loadedImagesMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, img]) => img);

  const filteredImages = loadedImages.filter(img =>
    img.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Create a stable array of items (images + skeletons) with fixed positions
  const displayItems = loading && skeletonCount > 0
    ? Array.from({ length: skeletonCount }, (_, index) => {
        const img = loadedImagesMap.get(index);
        return img ? { type: 'image', data: img, originalIndex: index } : { type: 'skeleton', index };
      })
    : filteredImages.map(img => ({ type: 'image', data: img }));

  // During loading, sort by original index (file order) - loaded images will naturally appear in correct order
  // Unloaded skeletons remain in their original positions
  const sortedDisplayItems = displayItems; // No extra sorting needed - displayItems is already in correct order

  return (
    <div className="working-folder-gallery">
      <div className="working-folder-header">
        <h3>Working Folder</h3>
        <button onClick={handleSelectFolder} disabled={loading} className="select-folder-btn">
          {loading ? 'Loading...' : folderPath ? 'Change Folder' : 'Select Folder'}
        </button>
      </div>

      {folderPath && (
        <div className="folder-path">
          <span className="path-label">Current:</span>
          <span className="path-value" title={folderPath}>
            {folderPath.split(/[/\\]/).pop() || folderPath}
          </span>
        </div>
      )}

      {loadedImages.length > 0 && (
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search images..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      )}

      <div className="images-container">
        {sortedDisplayItems.length > 0 ? (
          // Progressive loading with stable positions
          <div className="images-grid">
            {sortedDisplayItems.map((item, index) =>
              item.type === 'image' && item.data ? (
                <DraggableImage
                  key={`${item.data.path}-${refreshTrigger}`}
                  img={item.data}
                  isSelected={selectedImage === item.data.path}
                  onSelect={() => setSelectedImage(item.data.path)}
                  refreshTrigger={refreshTrigger}
                />
              ) : (
                <SkeletonImageCard key={`skeleton-${index}`} />
              )
            )}
          </div>
        ) : loading ? (
          // Initial loading state before we know the count
          <div className="empty-state">
            <p>Scanning folder...</p>
          </div>
        ) : folderPath ? (
          <div className="empty-state">
            <p>No images found in this folder</p>
            <small>Supported: JPG, PNG, RAW</small>
          </div>
        ) : (
          <div className="empty-state">
            <p>Select a working folder to begin</p>
            <small>All images in the folder will appear here</small>
          </div>
        )}
      </div>
    </div>
  );
}
