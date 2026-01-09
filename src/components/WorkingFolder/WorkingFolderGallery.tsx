import { useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useWorkingFolder } from '../../contexts/WorkingFolderContext';
import { WorkingImage } from '../../types/assets';
import './WorkingFolderGallery.css';

export function WorkingFolderGallery() {
  const { folderPath, setFolderPath, images, setImages, loading, setLoading, selectedImage, setSelectedImage } = useWorkingFolder();
  const [searchTerm, setSearchTerm] = useState('');

  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      const result = await invoke<{ path: string; images: WorkingImage[] }>('select_working_folder');
      setFolderPath(result.path);
      setImages(result.images);
    } catch (error) {
      console.error('Failed to select working folder:', error);
      alert(`Failed to select folder: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredImages = images.filter(img =>
    img.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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

      {images.length > 0 && (
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
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Scanning folder...</p>
          </div>
        ) : filteredImages.length > 0 ? (
          <div className="images-grid">
            {filteredImages.map((img) => (
              <div
                key={img.path}
                className={`image-item ${selectedImage === img.path ? 'selected' : ''}`}
                onClick={() => setSelectedImage(img.path)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('imagePath', img.path);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                {img.thumbnail ? (
                  <img
                    src={convertFileSrc(img.thumbnail.replace('asset://', ''))}
                    alt={img.filename}
                    className="thumbnail"
                  />
                ) : (
                  <div className="no-thumbnail">
                    <span className="file-ext">{img.extension.toUpperCase()}</span>
                  </div>
                )}
                <div className="image-info">
                  <div className="filename" title={img.filename}>
                    {img.filename}
                  </div>
                  <div className="filesize">{formatFileSize(img.size)}</div>
                </div>
              </div>
            ))}
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
