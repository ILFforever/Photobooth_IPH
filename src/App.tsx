import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import "./App.css";

interface Result {
  folder_name: string;
  link: string;
  qr_data: string;
}

interface GoogleAccount {
  email: string;
  name: string;
  picture?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  is_shared_drive: boolean;
}

interface HistoryItem {
  timestamp: string;
  folder_name: string;
  link: string;
  qr_data: string;
}

function App() {
  const [photos_path, setPhotosPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [rootFolder, setRootFolder] = useState<DriveFolder | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [tauriReady, setTauriReady] = useState(false);

  // Upload progress state
  const [uploadProgress, setUploadProgress] = useState<{
    step: string;
    current: number;
    total: number;
    message: string;
  } | null>(null);

  // Navigation state
  const [folderPath, setFolderPath] = useState<{id: string, name: string}[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<DriveFolder | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Gallery state
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [processingImages, setProcessingImages] = useState<string[]>([]);
  const [failedImages, setFailedImages] = useState<{filename: string, type: string, isRaw?: boolean, size?: number}[]>([]);

  // Upload condition checking state
  const [uploadConditionsMet, setUploadConditionsMet] = useState(false);

  // Store actual file paths for uploaded images
  const [imagePaths, setImagePaths] = useState<string[]>([]);

  // Map asset URLs to original file paths (for folder-loaded images)
  const [assetUrlToFilePath, setAssetUrlToFilePath] = useState<Record<string, string>>({});

  // Map thumbnails to actual filenames for deletion
  const [thumbnailToFilename, setThumbnailToFilename] = useState<Record<string, string>>({});

  // Upload cancellation state
  const [uploadCancelled, setUploadCancelled] = useState(false);

  // Cached account confirmation state
  const [showCachedAccountConfirm, setShowCachedAccountConfirm] = useState(false);
  const [cachedAccount, setCachedAccount] = useState<GoogleAccount | null>(null);

  // App menu state
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [aboutTab, setAboutTab] = useState<'features' | 'contact'>('features');
  
  // History state
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [expandedHistoryItem, setExpandedHistoryItem] = useState<string | null>(null);

  // Debug version log
  useEffect(() => {
    console.log("=== APP VERSION: v1.0.7 (Structured Nav) ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Invoke function type:", typeof invoke);
    console.log("Invoke function:", invoke);
    console.log("Window __TAURI_INTERNALS__:", (window as any).__TAURI_INTERNALS__);
    console.log("Window __TAURI__:", (window as any).__TAURI__);
  }, []);

  // Listen for upload progress events
  useEffect(() => {
    if (!tauriReady) return;

    const unlisten = listen<{step: string; current: number; total: number; message: string}>(
      'upload-progress',
      (event) => {
        console.log('Upload progress:', event.payload);
        setUploadProgress(event.payload);
      }
    );

    return () => {
      unlisten.then(fn => fn());
    };
  }, [tauriReady]);

  // Load history when modal opens
  useEffect(() => {
    if (showHistoryModal) {
      const loadHistory = async () => {
        try {
          const items = await invoke<HistoryItem[]>("get_history");
          setHistoryItems(items);
        } catch (e) {
          console.error("Failed to load history:", e);
        }
      };
      loadHistory();
    }
  }, [showHistoryModal]);

  const formatDate = (timestamp: string) => {
    try {
      // timestamp is unix seconds string
      const date = new Date(parseInt(timestamp) * 1000);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      }).format(date);
    } catch (e) {
      return timestamp;
    }
  };

  // Poll upload conditions every 250ms (debugging disabled)
  useEffect(() => {
    const checkUploadConditions = () => {
      const hasImages = selectedImages.length > 0;
      const isLoggedIn = account !== null;
      const hasRootFolder = rootFolder !== null;
      const hasPhotoPath = photos_path !== "";

      const allConditionsMet = hasImages && isLoggedIn && hasRootFolder && hasPhotoPath;

      // Only log when conditions change
      if (allConditionsMet && !uploadConditionsMet) {
        console.log("✅✅✅ ALL UPLOAD CONDITIONS MET! Ready to upload!");
        setUploadConditionsMet(true);
      } else if (!allConditionsMet && uploadConditionsMet) {
        console.log("⚠️ Upload conditions no longer met");
        setUploadConditionsMet(false);
      }
    };

    // Check immediately
    checkUploadConditions();

    // Then check every 250ms
    const interval = setInterval(checkUploadConditions, 250);

    return () => clearInterval(interval);
  }, [selectedImages, account, rootFolder, photos_path, uploadConditionsMet]);

  // Wait for Tauri to be ready
  useEffect(() => {
    const initTauri = async () => {
      console.log("Initializing Tauri...");

      // Wait for window.__TAURI_INTERNALS__ to be available
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds max

      while (attempts < maxAttempts) {
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          console.log("Tauri internals found after", attempts * 100, "ms");
          setTauriReady(true);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      console.error("Tauri internals not found after 5 seconds");
    };
    initTauri();
  }, []);

  // Check if user is already logged in on mount
  useEffect(() => {
    if (!tauriReady) return;

    const checkAccount = async () => {
      try {
        const savedAccount = await invoke<GoogleAccount | null>("get_account");
        if (savedAccount) {
          setAccount(savedAccount);

          // Also check for root folder
          const savedFolder = await invoke<DriveFolder | null>("get_root_folder");
          if (savedFolder) {
            setRootFolder(savedFolder);
          }
        }
      } catch (e) {
        console.error("Failed to check account:", e);
      }
    };
    checkAccount();
  }, [tauriReady]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showAccountMenu) {
        setShowAccountMenu(false);
      }
      if (showAppMenu) {
        setShowAppMenu(false);
      }
    };

    if (showAccountMenu || showAppMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAccountMenu, showAppMenu]);

  const fetchFolders = async (parentId: string | null) => {
    setLoadingFolders(true);
    setError("");
    try {
      const folders = await invoke<DriveFolder[]>("list_drive_folders", { parentId });
      console.log("Received folders:", folders);
      setDriveFolders(folders);
    } catch (e) {
      console.error("Error listing folders:", e);
      setError(String(e));
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleSelectDriveFolder = async () => {
    console.log("=== handleSelectDriveFolder called ===");
    console.log("Account:", account);

    if (!account) {
      console.log("No account, showing error");
      setError("Please sign in with Google first");
      return;
    }

    setSelectingFolder(true);
    setFolderPath([]); // Reset to root
    
    await fetchFolders(null);
    
    setShowFolderPicker(true);
    setSelectingFolder(false);
  };

  const handleNavigateFolder = async (folder: DriveFolder) => {
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    await fetchFolders(folder.id);
  };

  const handleNavigateUp = async () => {
    if (folderPath.length === 0) return;
    const newPath = folderPath.slice(0, -1);
    setFolderPath(newPath);
    const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
    await fetchFolders(parentId);
  };

  const handleConfirmSelection = async (folder: DriveFolder) => {
    try {
      await invoke("set_root_folder", { folder });
      setRootFolder(folder);
      setShowFolderPicker(false);
    } catch (e) {
      setError(String(e));
    }
  };

  // Allows selecting the current directory (if valid, usually mostly for subfolders)
  const handleSelectCurrentDir = async () => {
    if (folderPath.length === 0) {
       setError("Please select a specific folder");
       return;
    }
    const current = folderPath[folderPath.length - 1];
    const folder: DriveFolder = {
        id: current.id,
        name: current.name,
        is_shared_drive: false 
    };
    handleConfirmSelection(folder);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setError("Please enter a folder name");
      return;
    }

    setCreatingFolder(true);
    setError("");
    try {
      const parentId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
      await invoke<DriveFolder>("create_drive_folder", {
        folderName: newFolderName.trim(),
        parentId
      });
      // Refresh the folder list to show the new folder
      await fetchFolders(parentId);
      setNewFolderName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleGenerate = async () => {
    console.log("=== handleGenerate called ===");
    console.log("photos_path:", photos_path);
    console.log("selectedImages.length:", selectedImages.length);
    console.log("rootFolder:", rootFolder);

    if (!photos_path && selectedImages.length === 0) {
      console.log("❌ Validation failed: No photos selected");
      setError("Please add photos first");
      return;
    }

    if (!rootFolder) {
      console.log("❌ Validation failed: No root folder");
      setError("Please select a Drive root folder first");
      return;
    }

    // If we have selected images but no folder path, we need a folder path for the backend
    if (!photos_path && selectedImages.length > 0) {
      console.log("❌ Validation failed: Images selected but no folder path");
      setError("Please use 'Browse > From Folder' to select a folder of images to upload");
      return;
    }

    // Build the file list for upload
    const fileList: string[] = [];

    // Add files from imagePaths (dropped/single images from temp folder)
    fileList.push(...imagePaths);

    // Add files from assetUrlToFilePath (folder-loaded images)
    for (const assetUrl of selectedImages) {
      const originalPath = assetUrlToFilePath[assetUrl];
      if (originalPath && !fileList.includes(originalPath)) {
        fileList.push(originalPath);
      }
    }

    // Add RAW files from failedImages
    for (const failedImg of failedImages) {
      // Construct the full path using photos_path and filename
      const fullPath = `${photos_path}${photos_path.endsWith('\\') || photos_path.endsWith('/') ? '' : '\\'}${failedImg.filename}`;
      if (!fileList.includes(fullPath)) {
        fileList.push(fullPath);
      }
    }

    console.log("✅ Validation passed, starting upload...");
    console.log("Upload parameters:", {
      photosPath: photos_path,
      fileList: fileList,
      fileCount: fileList.length,
      rootFolderId: rootFolder.id,
      rootFolderName: rootFolder.name
    });

    setLoading(true);
    setError("");
    setResult(null);
    setUploadCancelled(false);
    setUploadProgress(null);

    try {
      console.log("🔄 Invoking process_photos...");
      const startTime = Date.now();

      const res = await invoke<Result>("process_photos", {
        photosPath: photos_path,
        fileList: fileList.length > 0 ? fileList : null,
      });

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      // Check if upload was cancelled
      if (uploadCancelled) {
        console.log("⚠️ Upload was cancelled by user");
        setError("Upload cancelled");
        return;
      }

      console.log(`✅ process_photos completed in ${duration}s`);
      console.log("Result:", res);

      setResult(res);
    } catch (e) {
      console.error("❌ process_photos failed:", e);
      console.error("Error type:", typeof e);
      console.error("Error details:", {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      setError(String(e));
    } finally {
      setLoading(false);
      setUploadCancelled(false);
      console.log("=== handleGenerate finished ===");
    }
  };

  const handleCancelUpload = () => {
    console.log("⚠️ User cancelled upload");
    setUploadCancelled(true);
    setLoading(false);
    setError("Upload cancelled by user");
  };

  const handleNew = async () => {
    console.log("🔄 Starting new session");

    // Clear temp images from backend
    try {
      await invoke("clear_temp_images");
      console.log("✅ Cleared temp images");
    } catch (e) {
      console.error("Failed to clear temp images:", e);
    }

    setResult(null);
    setSelectedImages([]);
    setLoadedImages({});
    setImagePaths([]);
    setPhotosPath("");
    setProcessingImages([]);
    setFailedImages([]);
    setError("");
    setUploadCancelled(false);
    setThumbnailToFilename({});
    setAssetUrlToFilePath({});
  };

  const handleCopyLink = () => {
    if (result?.link) {
      navigator.clipboard.writeText(result.link);
    }
  };

  const handleLogin = async (e?: React.MouseEvent, forceFresh: boolean = false) => {
    e?.stopPropagation();

    // Check for cached account first
    if (!forceFresh) {
      try {
        const cached = await invoke<GoogleAccount | null>("check_cached_account");
        if (cached) {
          console.log("Found cached account:", cached);
          setCachedAccount(cached);
          setShowCachedAccountConfirm(true);
          setShowAccountMenu(false);
          return;
        }
      } catch (e) {
        console.log("No cached account or error checking:", e);
      }
    }

    setLoggingIn(true);
    setError("");
    try {
      console.log("Attempting to invoke google_login...");
      const accountData = await invoke<GoogleAccount>("google_login");
      console.log("Login successful:", accountData);
      setAccount(accountData);
      setShowAccountMenu(false);
    } catch (e) {
      console.error("Login error details:", {
        error: e,
        type: typeof e,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleConfirmCachedAccount = async () => {
    if (cachedAccount) {
      setShowCachedAccountConfirm(false);
      setLoggingIn(true);
      setError("");

      try {
        // Call google_login to restore backend auth state from cache
        console.log("Restoring cached session...");
        const accountData = await invoke<GoogleAccount>("google_login");
        console.log("Session restored:", accountData);
        setAccount(accountData);
      } catch (e) {
        console.error("Failed to restore session:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(errorMsg);
        // Fallback to cached account data
        setAccount(cachedAccount);
      } finally {
        setLoggingIn(false);
        setCachedAccount(null);
      }
    }
  };

  const handleUseDifferentAccount = async () => {
    setShowCachedAccountConfirm(false);
    setCachedAccount(null);

    // Delete the cache first
    try {
      await invoke("google_logout");
      console.log("Cache deleted successfully");
    } catch (e) {
      console.error("Failed to delete cache:", e);
    }

    // Force a fresh login
    await handleLogin(undefined, true);
  };

  const handleCancelLogin = () => {
    console.log("User cancelled login");
    setLoggingIn(false);
    setShowAccountMenu(false);
  };

  const handleLogout = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await invoke("google_logout");
      setAccount(null);
      setRootFolder(null);
      setShowAccountMenu(false);
      setResult(null); // Clear results when logging out
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const handleDeleteFolder = (folder: DriveFolder) => {
    setFolderToDelete(folder);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteFolder = async () => {
    if (!folderToDelete) return;

    setDeleting(true);
    setError("");
    try {
      await invoke("delete_drive_folder", { folderId: folderToDelete.id });
      // Refresh the folder list
      const parentId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
      await fetchFolders(parentId);
      setShowDeleteConfirm(false);
      setFolderToDelete(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setFolderToDelete(null);
  };

  // Helper function to format file size
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Helper function to create thumbnail from data URL
  const createThumbnailFromDataUrl = async (dataUrl: string, maxWidth = 800, maxHeight = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        try {
          // Calculate new dimensions while maintaining aspect ratio
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const aspectRatio = width / height;
            if (width > height) {
              width = maxWidth;
              height = width / aspectRatio;
            } else {
              height = maxHeight;
              width = height * aspectRatio;
            }
          }

          // Create canvas and draw resized image
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // Convert to data URL with quality optimization
          const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(thumbnailDataUrl);
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = (err) => {
        reject(new Error(`Failed to load image: ${err}`));
      };

      // Use the data URL directly - no CORS issues
      img.src = dataUrl;
    });
  };

  // Gallery handlers
  const handleRemoveImage = async (imagePath: string) => {
    // Get the filename from the mapping (for dropped images)
    const filename = thumbnailToFilename[imagePath];
    if (filename) {
      // Delete the file from temp storage (for dropped/single images)
      try {
        await invoke("remove_temp_image", { filename });
        console.log(`Deleted temp image: ${filename}`);
      } catch (e) {
        console.error("Failed to delete temp image:", e);
      }
      // Remove from mapping
      setThumbnailToFilename(prev => {
        const next = { ...prev };
        delete next[imagePath];
        return next;
      });
      // Remove from image paths
      setImagePaths(prev => prev.filter(path => !path.endsWith(filename)));
    }

    // For images loaded from folder, remove from the asset URL mapping
    if (assetUrlToFilePath[imagePath]) {
      setAssetUrlToFilePath(prev => {
        const next = { ...prev };
        delete next[imagePath];
        return next;
      });
    }

    setSelectedImages(prev => prev.filter(img => img !== imagePath));
    setLoadedImages(prev => {
      const next = { ...prev };
      delete next[imagePath];
      return next;
    });
  };

  const handleRemoveFailedImage = async (filename: string) => {
    // Delete the file from temp storage
    try {
      await invoke("remove_temp_image", { filename });
      console.log(`Deleted temp image: ${filename}`);
    } catch (e) {
      console.error("Failed to delete temp image:", e);
    }

    // Remove from failed images list
    setFailedImages(prev => prev.filter(img => img.filename !== filename));
    // Remove from image paths
    setImagePaths(prev => prev.filter(path => !path.endsWith(filename)));
  };

  const handleImageLoaded = (path: string) => {
    setLoadedImages(prev => ({ ...prev, [path]: true }));
  };

  // Drag over handlers for visual feedback only (actual drop handled by Tauri)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    console.log("Total files dropped:", files.length);

    const imageFiles = files.filter(file =>
      file.type.startsWith('image/') ||
      /\.(jpg|jpeg|png|raw|raf)$/i.test(file.name)
    );

    console.log(`Filtered to ${imageFiles.length} image files`);

    // Add all files to processing queue immediately to show skeletons
    setProcessingImages(prev => [...prev, ...imageFiles.map(f => f.name)]);

    for (const file of imageFiles) {
      try {
        console.log(`Processing ${file.name}...`);

        // Check if file is a RAW format
        const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
        const isRawFile = ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(fileExt);

        if (isRawFile) {
          console.log(`⚠️ RAW file detected: ${file.name} - skipping thumbnail generation`);
          const fileExtUpper = fileExt.toUpperCase();
          setFailedImages(prev => [...prev, { filename: file.name, type: fileExtUpper, isRaw: true, size: file.size }]);

          // Still save the file for upload
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const savedPath = await invoke<string>("save_dropped_image", {
            imageData: dataUrl,
            filename: file.name
          });
          console.log(`✓ RAW file saved to: ${savedPath}`);

          // Store the saved file path
          setImagePaths(prev => {
            const newPaths = [...prev, savedPath];
            if (newPaths.length > 0) {
              const firstPath = newPaths[0];
              const parentDir = firstPath.substring(0, firstPath.lastIndexOf('\\') || firstPath.lastIndexOf('/'));
              setPhotosPath(parentDir);
            }
            return newPaths;
          });

          continue; // Skip thumbnail generation
        }

        // Read file as data URL
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Generate thumbnail from the data URL before saving
        console.log(`Generating thumbnail for ${file.name}...`);
        let thumbnail: string;
        try {
          thumbnail = await createThumbnailFromDataUrl(dataUrl, 800, 800);
          console.log(`✓ Thumbnail generated (${thumbnail.length} bytes)`);
        } catch (thumbErr) {
          console.error(`Failed to generate thumbnail for ${file.name}:`, thumbErr);
          // Add to failed images with file metadata
          const fileExtUpper = file.name.split('.').pop()?.toUpperCase() || 'FILE';
          setFailedImages(prev => [...prev, { filename: file.name, type: fileExtUpper, isRaw: false, size: file.size }]);
          throw thumbErr; // Re-throw to skip the rest of processing
        }

        // Save the image to app's temp folder and get file path
        console.log(`Saving ${file.name} to temp folder...`);
        const savedPath = await invoke<string>("save_dropped_image", {
          imageData: dataUrl,
          filename: file.name
        });
        console.log(`✓ Saved to: ${savedPath}`);

        // Store the saved file path
        setImagePaths(prev => {
          const newPaths = [...prev, savedPath];

          // Extract common parent directory
          if (newPaths.length > 0) {
            const firstPath = newPaths[0];
            const parentDir = firstPath.substring(0, firstPath.lastIndexOf('\\') || firstPath.lastIndexOf('/'));
            console.log("Setting photos_path to:", parentDir);
            setPhotosPath(parentDir);
          }

          return newPaths;
        });

        // Add thumbnail to display and map it to filename
        setSelectedImages(prev => {
          if (!prev.includes(thumbnail)) {
            console.log(`✓ Added thumbnail for ${file.name}`);
            // Map thumbnail to filename for deletion
            setThumbnailToFilename(mapping => ({ ...mapping, [thumbnail]: file.name }));
            return [...prev, thumbnail];
          }
          console.log(`⚠ Thumbnail already exists for ${file.name}`);
          return prev;
        });

      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err);
        // Don't show error message for thumbnail failures (already tracked in failedImages)
      } finally {
        // Remove from processing queue
        setProcessingImages(prev => prev.filter(name => name !== file.name));
      }
    }

    console.log("✓ All dropped images processed");
  };

  const handleClearGallery = async () => {
    console.log("🗑️ Clearing gallery");

    // Clear temp images from backend
    try {
      await invoke("clear_temp_images");
      console.log("✅ Cleared temp images");
    } catch (e) {
      console.error("Failed to clear temp images:", e);
    }

    setSelectedImages([]);
    setLoadedImages({});
    setImagePaths([]);
    setPhotosPath("");
    setProcessingImages([]);
    setFailedImages([]);
    setThumbnailToFilename({});
    setAssetUrlToFilePath({});
  };

  const handleAddPhotos = () => {
    setShowAddMenu(true);
  };

  const handleAddSingleImage = async () => {
    try {
      console.log("Requesting single file selection...");
      const selected = await invoke<string>("select_file");
      if (selected) {
        console.log("Selected file:", selected);
        console.log("File type:", typeof selected);

        // Extract filename and parent directory
        const filename = selected.split(/[\\/]/).pop() || "image";
        const parentDir = selected.substring(0, selected.lastIndexOf('\\') || selected.lastIndexOf('/'));

        // Set photos_path to the parent directory
        setPhotosPath(parentDir);

        // Check if file is a RAW format
        const fileExt = filename.split('.').pop()?.toLowerCase() || '';
        const isRawFile = ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(fileExt);

        if (isRawFile) {
          console.log(`⚠️ RAW file detected: ${filename} - adding to failed images`);
          const fileExtUpper = fileExt.toUpperCase();

          // Get file size
          try {
            const fileInfo = await invoke<{ size: number }>("get_file_info", { filePath: selected });
            setFailedImages(prev => [...prev, {
              filename,
              type: fileExtUpper,
              isRaw: true,
              size: fileInfo.size
            }]);
          } catch (e) {
            console.error("Failed to get file info:", e);
            setFailedImages(prev => [...prev, {
              filename,
              type: fileExtUpper,
              isRaw: true
            }]);
          }

          // Store the file path for upload
          setImagePaths(prev => [...prev, selected]);
          setShowAddMenu(false);
          return;
        }

        setProcessingImages(prev => [...prev, filename]);

        try {
          // Convert path to asset URL
          const assetUrl = convertFileSrc(selected);
          console.log(`Converted ${selected} -> ${assetUrl}`);
          console.log("Asset URL type:", typeof assetUrl);

          // Test if the URL is accessible
          await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = reject;
            img.src = assetUrl;
          });
          console.log("✓ Image loaded successfully!");

          // Create mapping from asset URL to original file path
          setAssetUrlToFilePath(prev => ({ ...prev, [assetUrl]: selected }));

          setSelectedImages(prev => {
            if (prev.includes(assetUrl)) {
              console.log("Image already exists, skipping");
              return prev;
            }
            return [...prev, assetUrl];
          });
          console.log("Added to selectedImages array");
        } catch (e) {
          console.error("Error processing image:", e);
          // Add to failed images if thumbnail generation fails
          const fileExtUpper = fileExt.toUpperCase() || 'FILE';
          setFailedImages(prev => [...prev, { filename, type: fileExtUpper, isRaw: false }]);
        } finally {
          setProcessingImages(prev => prev.filter(name => name !== filename));
        }
      }
    } catch (e) {
      console.error("Error selecting file:", e);
    }
    setShowAddMenu(false);
  };

  const handleAddFromFolder = async () => {
    try {
      console.log("Requesting folder selection...");
      const selected = await invoke<string>("select_folder");
      if (selected) {
        // Clear previous temp images and state
        try {
          await invoke("clear_temp_images");
          console.log("✅ Cleared previous temp images");
        } catch (e) {
          console.error("Failed to clear temp images:", e);
        }

        setSelectedImages([]);
        setLoadedImages({});
        setImagePaths([]);
        setFailedImages([]);
        setThumbnailToFilename({});
        setAssetUrlToFilePath({});
        setPhotosPath(selected);
        setResult(null);

        // Fetch images with metadata from the selected folder
        console.log("Fetching images from:", selected);
        const imageFiles = await invoke<{path: string, size: number, extension: string}[]>("get_images_with_metadata", { folderPath: selected });
        console.log("Images found:", imageFiles);

        // Separate RAW files from regular images
        const rawFiles = imageFiles.filter(img =>
          ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(img.extension)
        );
        const regularImages = imageFiles.filter(img =>
          !['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(img.extension)
        );

        // Add RAW files to failedImages
        const rawFileFailed = rawFiles.map(img => ({
          filename: img.path.split(/[\\/]/).pop() || "image",
          type: img.extension.toUpperCase(),
          isRaw: true,
          size: img.size
        }));
        setFailedImages(rawFileFailed);

        // Show loading skeletons for regular images
        const filenames = regularImages.map(img => img.path.split(/[\\/]/).pop() || "image");
        setProcessingImages(filenames);

        // Convert regular image paths to asset URLs and create mapping
        const assetUrlMapping: Record<string, string> = {};
        const assetUrls = regularImages.map(img => {
            const src = convertFileSrc(img.path);
            assetUrlMapping[src] = img.path; // Map asset URL to original file path
            console.log(`Converting ${img.path} -> ${src}`);
            return src;
        });
        setAssetUrlToFilePath(assetUrlMapping);

        // Add regular images
        setSelectedImages(assetUrls);

        // Clear processing state after a short delay to allow shimmer to show
        setTimeout(() => {
          setProcessingImages([]);
        }, 100);
      }
    } catch (e) {
      console.error("Error selecting folder or fetching images:", e);
    }
    setShowAddMenu(false);
  };

  return (
    <div className="app-window">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-menu-container">
            <button
              className="app-icon-button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAppMenu(!showAppMenu);
              }}
              title="PhotoBooth QR Generator"
            >
              <span className="app-icon">📸</span>
            </button>

            <AnimatePresence>
              {showAppMenu && (
                <motion.div
                  initial={{ opacity: 0, x: -20, y: "-50%" }}
                  animate={{ opacity: 1, x: 8, y: "-50%" }}
                  exit={{ opacity: 0, x: -20, y: "-50%" }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="app-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="app-menu-item"
                    onClick={() => {
                      setShowHistoryModal(true);
                      setShowAppMenu(false);
                    }}
                  >
                    <span>History</span>
                  </button>
                  <div className="app-menu-divider"></div>
                  <button
                    className="app-menu-item"
                    onClick={() => {
                      setShowAboutModal(true);
                      setShowAppMenu(false);
                    }}
                  >
                    <span>About</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="header-right">
          <div className="account-dropdown-container">
            <button
              className="account-dropdown-button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAccountMenu(!showAccountMenu);
              }}
            >
              {account ? (
                <>
                  <div className="account-avatar">
                    {account.picture ? (
                      <img src={account.picture} alt={account.name} />
                    ) : (
                      <span>{account.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="account-label">Account</span>
                </>
              ) : (
                <>
                  <span className="account-icon">👤</span>
                  <span className="account-label">Account</span>
                </>
              )}
              <span className="dropdown-arrow">▼</span>
            </button>

            <AnimatePresence>
              {showAccountMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="account-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  {account ? (
                    <>
                      <div className="account-menu-header">
                        <div className="account-menu-avatar">
                          {account.picture ? (
                            <img src={account.picture} alt={account.name} />
                          ) : (
                            <span>{account.name.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="account-menu-info">
                          <div className="account-menu-name">{account.name}</div>
                          <div className="account-menu-email">{account.email}</div>
                        </div>
                      </div>
                      <div className="account-menu-divider"></div>
                      <button className="account-menu-item" onClick={handleLogout}>
                        <span>Sign out</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {loggingIn ? (
                        <>
                          <div style={{
                            padding: '24px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px',
                            background: 'var(--bg-primary)',
                            textAlign: 'center'
                          }}>
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                              style={{
                                fontSize: '32px',
                                color: 'var(--accent-blue)'
                              }}
                            >
                              ⟳
                            </motion.div>
                            <div style={{
                              fontSize: '14px',
                              fontWeight: '600',
                              color: 'var(--text-primary)'
                            }}>
                              Signing in...
                            </div>
                            <div style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              lineHeight: '1.4',
                              maxWidth: '240px'
                            }}>
                              Please complete the sign-in process in your browser
                            </div>
                          </div>
                          <div className="account-menu-divider"></div>
                          <button
                            className="account-menu-item"
                            onClick={handleCancelLogin}
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <span>✕</span>
                            <span>Cancel</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="account-menu-item sign-in-item"
                            onClick={handleLogin}
                          >
                            <span>🔐</span>
                            <span>Sign in with Google</span>
                          </button>
                          <div className="account-menu-permission-notice">
                            Will request permission to see and download your Google Drive files
                          </div>
                        </>
                      )}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="app-content">
        <div className="sidebar">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="sidebar-section"
          >
            <h2 className="sidebar-title">Generate QR Code</h2>
            <p className="sidebar-description">
              Select a Drive root folder and upload your photobooth images to generate a shareable QR code and link.
            </p>

            <div className="input-group">
              <label>Drive Root Folder</label>
              <div className="folder-selector">
                <input
                  type="text"
                  value={rootFolder ? rootFolder.name : ""}
                  readOnly
                  placeholder={account ? "Click to select/create root folder..." : "Sign in first..."}
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSelectDriveFolder}
                  disabled={!account || selectingFolder}
                  className="btn-secondary"
                >
                  {selectingFolder ? "..." : rootFolder ? "Change" : "Select"}
                </motion.button>
              </div>
              {rootFolder && (
                <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                  Photos will be organized in encoded folders inside "{rootFolder.name}"
                </p>
              )}
            </div>

            <div className="input-group">
              <label>Add Photos (Local)</label>
              <div className="folder-selector">
                <input
                  type="text"
                  value={selectedImages.length + failedImages.length > 0 ? `${selectedImages.length + failedImages.length} images selected` : ""}
                  readOnly
                  placeholder="Select local file or folder to upload..."
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAddPhotos}
                  disabled={loading}
                  className="btn-secondary"
                >
                  Browse
                </motion.button>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={loading ? handleCancelUpload : handleGenerate}
              disabled={!loading && (!rootFolder || !photos_path)}
              className={loading ? "btn-uploading" : "btn-primary"}
            >
              {loading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="spinner"
                  >
                    ⟳
                  </motion.div>
                  <span className="upload-text">Uploading...</span>
                  <span className="cancel-text">Cancel Upload</span>
                </>
              ) : (
                "Upload & Generate QR Code"
              )}
            </motion.button>

            {/* Upload Progress Display */}
            <AnimatePresence>
              {loading && uploadProgress && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="upload-progress-container"
                >
                  <div className="upload-progress-header">
                    <span className="upload-progress-step">
                      {uploadProgress.step === 'starting' && '🚀 Starting...'}
                      {uploadProgress.step === 'creating_folder' && '📁 Creating Folder...'}
                      {uploadProgress.step === 'scanning' && '🔍 Scanning Files...'}
                      {uploadProgress.step === 'uploading' && '📤 Uploading Files...'}
                      {uploadProgress.step === 'permissions' && '🔓 Setting Permissions...'}
                      {uploadProgress.step === 'qr_code' && '📱 Generating QR Code...'}
                      {uploadProgress.step === 'complete' && '✅ Complete!'}
                    </span>
                    {uploadProgress.total > 0 && (
                      <span className="upload-progress-count">
                        {uploadProgress.current}/{uploadProgress.total}
                      </span>
                    )}
                  </div>
                  <div className="upload-progress-message">{uploadProgress.message}</div>
                  {uploadProgress.total > 0 && uploadProgress.step === 'uploading' && (
                    <div className="upload-progress-bar-container">
                      <motion.div
                        className="upload-progress-bar"
                        initial={{ width: 0 }}
                        animate={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="error-message"
                >
                  <span className="error-icon">⚠️</span>
                  {error}
                </motion.div>
          )}
            </AnimatePresence>
          </motion.div>
        </div>

        <div className="main-panel">
          {/* Main Content Area */}
          <div className="tab-content">
            <AnimatePresence mode="wait">
              {!result ? (
                <motion.div
                  key="gallery"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="gallery-view"
                >
                  {selectedImages.length > 0 || failedImages.length > 0 ? (
                    <div
                      className={`gallery-with-images ${isDragging ? 'dragging' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="image-grid">
                        {selectedImages.map((imagePath, index) => {
                          console.log(`Rendering image ${index}:`, imagePath);
                          const isLoaded = loadedImages[imagePath];
                          return (
                            <motion.div
                              key={imagePath}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="image-card"
                            >
                              {!isLoaded && <div className="shimmer-overlay" />}
                              <img
                                src={imagePath}
                                alt={`Selected ${index + 1}`}
                                onLoad={() => {
                                  console.log(`Image ${index} loaded:`, imagePath);
                                  handleImageLoaded(imagePath);
                                }}
                                onError={(e) => console.error(`Image ${index} failed to load:`, imagePath, e)}
                              />
                              <button
                                className="remove-image-btn"
                                onClick={() => handleRemoveImage(imagePath)}
                                title="Remove image"
                              >
                                ×
                              </button>
                            </motion.div>
                          );
                        })}

                        {/* Show placeholder cards for failed images */}
                        {failedImages.map((failedImg) => (
                          <motion.div
                            key={`failed-${failedImg.filename}`}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="image-card failed-card"
                            data-is-raw={failedImg.isRaw ? "true" : "false"}
                          >
                            <div className="failed-image-content">
                              <div className="failed-icon">{failedImg.isRaw ? '📄' : '⚠️'}</div>
                              <div className="failed-filename">{failedImg.filename}</div>
                              <div className="failed-type">{failedImg.type}</div>
                              {failedImg.size && <div className="failed-size">{formatFileSize(failedImg.size)}</div>}
                              {!failedImg.isRaw && <div className="failed-message">Preview failed</div>}
                            </div>
                            <button
                              className="remove-image-btn"
                              onClick={() => handleRemoveFailedImage(failedImg.filename)}
                              title="Remove failed image"
                            >
                              ×
                            </button>
                          </motion.div>
                        ))}

                        {/* Show loading cards for images being processed */}
                        {processingImages.map((filename) => (
                          <motion.div
                            key={`processing-${filename}`}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="image-card loading-card"
                          />
                        ))}

                        {/* Drop zone placeholder */}
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="drop-placeholder"
                        >
                          <div className="drop-placeholder-content">
                            <span className="drop-placeholder-icon">🖱️</span>
                            <span className="drop-placeholder-text">Drop more photos here</span>
                          </div>
                        </motion.div>
                      </div>
                      <div className="gallery-footer">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleClearGallery}
                          disabled={loading}
                          className="btn-clear-gallery"
                        >
                          🗑️ Clear All ({selectedImages.length + failedImages.length})
                        </motion.button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="drop-zone-content">
                        <div className="drop-zone-icon">📷</div>
                        <h3>No Images Selected</h3>
                        <p>Photos added from the sidebar or dropped here will appear in this gallery.</p>
                        
                        <p className="drop-zone-hint">or drag and drop photos here</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="qr"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="qr-view"
                >
                  <AnimatePresence mode="wait">
                    {result ? (
                      <motion.div
                        key="result"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="result-view"
                      >
                        <div className="result-header">
                          <h2>QR Code Generated</h2>
                          <div className="result-badge">
                            <span className="badge-icon">✓</span>
                            <span>Ready to Share</span>
                          </div>
                        </div>

                        <div className="result-body">
                          <div className="qr-section">
                            <div className="qr-container">
                              <img
                                src={`data:image/png;base64,${result.qr_data}`}
                                alt="QR Code"
                                className="qr-code"
                              />
                            </div>
                            <p className="qr-label">Scan to view photos</p>
                          </div>

                          <div className="info-section">
                            <div className="info-item">
                              <label>Folder Name</label>
                              <div className="info-value">{result.folder_name}</div>
                            </div>

                            <div className="info-item">
                              <label>Share Link</label>
                              <div className="link-container">
                                <input
                                  type="text"
                                  value={result.link}
                                  readOnly
                                  className="link-input"
                                />
                                <motion.button
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                  onClick={handleCopyLink}
                                  className="btn-copy"
                                >
                                  📋 Copy
                                </motion.button>
                              </div>
                            </div>

                            <motion.a
                              href={result.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-open"
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                            >
                              Open in Browser →
                            </motion.a>

                            <motion.button
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={handleNew}
                              className="btn-new"
                            >
                              🔄 New Batch
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="empty-state"
                      >
                        <div className="empty-state-icon">📸</div>
                        <h3>No QR Code Yet</h3>
                        <p>
                          {!account
                            ? "Sign in with Google to get started"
                            : !rootFolder
                            ? "Select a Drive root folder first"
                            : "Select a local photos folder and upload to generate a QR code"
                          }
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Folder Picker Modal */}
      <AnimatePresence>
        {showFolderPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => setShowFolderPicker(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Select Drive Root Folder</h2>
              
              {/* Breadcrumb Navigation */}
              <div className="folder-breadcrumbs">
                <button 
                    onClick={() => { setFolderPath([]); fetchFolders(null); }}
                    className="breadcrumb-item"
                    disabled={folderPath.length === 0}
                >
                    🏠 My Drive
                </button>
                {folderPath.map((item, index) => (
                    <span key={item.id} className="breadcrumb-segment">
                        <span className="breadcrumb-separator">/</span>
                        <button 
                            className="breadcrumb-item"
                            onClick={() => {
                                const newPath = folderPath.slice(0, index + 1);
                                setFolderPath(newPath);
                                fetchFolders(item.id);
                            }}
                        >
                            {item.name}
                        </button>
                    </span>
                ))}
              </div>

              {folderPath.length > 0 && (
                  <button 
                    className="btn-back"
                    onClick={handleNavigateUp}
                  >
                    ← Back
                  </button>
              )}

              <div className="folder-list">
                {loadingFolders ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          style={{ display: 'inline-block', marginBottom: '0.5rem' }}
                        >
                          ⟳
                        </motion.div>
                        <div>Loading...</div>
                    </div>
                ) : driveFolders.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>No folders found</p>
                ) : (
                  driveFolders.map((folder) => (
                    <div
                      key={folder.id}
                      className="folder-row"
                    >
                      <button
                        className="folder-name-btn"
                        onClick={() => handleNavigateFolder(folder)}
                      >
                        <span className="folder-icon">
                            {folder.is_shared_drive ? "🏢" : "📁"}
                        </span>
                        <span className="folder-name-text">{folder.name}</span>
                      </button>

                      <div className="folder-actions">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="folder-delete-btn"
                          onClick={() => handleDeleteFolder(folder)}
                          title="Delete folder"
                        >
                          🗑️
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="folder-select-btn"
                          onClick={() => handleConfirmSelection(folder)}
                        >
                          Select
                        </motion.button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {folderPath.length > 0 && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="btn-primary"
                        style={{ width: '100%' }}
                        onClick={handleSelectCurrentDir}
                      >
                        Select Current Folder: {folderPath[folderPath.length - 1].name}
                      </motion.button>
                  </div>
              )}

              <div className="create-folder-section">
                <h3>Or Create New Folder Here</h3>
                <div className="input-group">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Enter folder name..."
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  />
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleCreateFolder}
                    disabled={creatingFolder || !newFolderName.trim()}
                    className="btn-primary"
                  >
                    {creatingFolder ? "Creating..." : "Create"}
                  </motion.button>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowFolderPicker(false)}
                className="btn-secondary"
                style={{ marginTop: '1rem', width: '100%' }}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Photos Modal */}
      <AnimatePresence>
        {showAddMenu && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => setShowAddMenu(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="modal-content"
              style={{ maxWidth: '400px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Add Photos</h2>
              <div className="add-options" style={{ marginTop: 0, justifyContent: 'center' }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAddSingleImage}
                  className="add-option-btn"
                >
                  <span className="add-option-icon">🖼️</span>
                  <span>Single Image</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAddFromFolder}
                  className="add-option-btn"
                >
                  <span className="add-option-icon">📁</span>
                  <span>From Folder</span>
                </motion.button>
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowAddMenu(false)}
                className="btn-secondary"
                style={{ marginTop: '1.5rem', width: '100%' }}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && folderToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={cancelDelete}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="confirm-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Delete Folder?</h3>
              <p>
                Are you sure you want to delete "<strong>{folderToDelete.name}</strong>"?
                This will permanently delete the folder and all its contents from Google Drive.
              </p>
              <div className="confirm-modal-actions">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={cancelDelete}
                  className="btn-secondary"
                  disabled={deleting}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={confirmDeleteFolder}
                  className="btn-danger"
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      >
                        ⟳
                      </motion.span>
                      Deleting...
                    </>
                  ) : (
                    "Delete"
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cached Account Confirmation Modal */}
      <AnimatePresence>
        {showCachedAccountConfirm && cachedAccount && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => {
              setShowCachedAccountConfirm(false);
              setCachedAccount(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="confirm-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Continue as this user?</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '20px 0', padding: '16px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div className="account-menu-avatar" style={{ width: '48px', height: '48px', fontSize: '20px' }}>
                  {cachedAccount.picture ? (
                    <img src={cachedAccount.picture} alt={cachedAccount.name} />
                  ) : (
                    <span>{cachedAccount.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {cachedAccount.name}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {cachedAccount.email}
                  </div>
                </div>
              </div>
              <p style={{ marginBottom: '24px' }}>
                We found a saved session for this account. Would you like to continue as this user, or sign in with a different account?
              </p>
              <div className="confirm-modal-actions">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUseDifferentAccount}
                  className="btn-secondary"
                >
                  Use Different Account
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleConfirmCachedAccount}
                  className="btn-primary"
                  style={{ width: 'auto' }}
                >
                  Continue as {cachedAccount.name.split(' ')[0]}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => setShowHistoryModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="modal-content"
              style={{ maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0 }}>Upload History</h2>
                {historyItems.length > 0 && (
                   <button 
                     onClick={async () => {
                        try {
                          await invoke("clear_history");
                          setHistoryItems([]);
                        } catch (e) {
                          console.error("Failed to clear history", e);
                        }
                     }}
                     style={{ 
                       background: 'none', 
                       border: 'none', 
                       color: 'var(--text-secondary)',
                       fontSize: '12px',
                       cursor: 'pointer',
                       textDecoration: 'underline'
                     }}
                   >
                     Clear History
                   </button>
                )}
              </div>
              
              <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                {historyItems.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                    No upload history yet. Your previous uploads will appear here.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {historyItems.map((item, index) => (
                      <div 
                        key={index} 
                        style={{ 
                          background: 'var(--bg-primary)', 
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          overflow: 'hidden'
                        }}
                      >
                        <div 
                          onClick={() => setExpandedHistoryItem(expandedHistoryItem === item.timestamp ? null : item.timestamp)}
                          style={{ 
                            padding: '12px 16px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: expandedHistoryItem === item.timestamp ? 'var(--bg-tertiary)' : 'transparent',
                            transition: 'background 0.2s'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                              {item.folder_name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {formatDate(item.timestamp)}
                            </div>
                          </div>
                          <div style={{ 
                            transform: expandedHistoryItem === item.timestamp ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s',
                            color: 'var(--text-secondary)'
                          }}>
                            ▼
                          </div>
                        </div>
                        
                        <AnimatePresence>
                          {expandedHistoryItem === item.timestamp && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              style={{ borderTop: '1px solid var(--border-color)' }}
                            >
                              <div style={{ padding: '16px', display: 'flex', gap: '20px', alignItems: 'start' }}>
                                <div style={{ 
                                  background: 'white', 
                                  padding: '8px', 
                                  borderRadius: '8px',
                                  width: '100px',
                                  height: '100px',
                                  flexShrink: 0
                                }}>
                                  <img 
                                    src={`data:image/png;base64,${item.qr_data}`} 
                                    alt="QR Code"
                                    style={{ width: '100%', height: '100%' }}
                                  />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ marginBottom: '12px' }}>
                                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', display: 'block', marginBottom: '4px' }}>
                                      Link
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                      <input 
                                        type="text" 
                                        value={item.link} 
                                        readOnly 
                                        style={{ 
                                          flex: 1, 
                                          fontSize: '12px', 
                                          padding: '6px 8px',
                                          background: 'var(--bg-secondary)',
                                          border: '1px solid var(--border-color)',
                                          borderRadius: '4px',
                                          color: 'var(--text-primary)',
                                          fontFamily: 'monospace'
                                        }} 
                                      />
                                      <button 
                                        onClick={() => navigator.clipboard.writeText(item.link)}
                                        className="btn-secondary"
                                        style={{ padding: '4px 12px', fontSize: '12px' }}
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  </div>
                                  <a 
                                    href={item.link} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    style={{ 
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      color: 'var(--accent-blue)',
                                      fontSize: '13px',
                                      textDecoration: 'none',
                                      fontWeight: '500'
                                    }}
                                  >
                                    Open in Browser ↗
                                  </a>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowHistoryModal(false)}
                className="btn-primary"
                style={{ width: '100%', marginTop: '1.5rem' }}
              >
                Close
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* About Modal */}
      <AnimatePresence>
        {showAboutModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => setShowAboutModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="modal-content"
              style={{ maxWidth: '500px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '64px', marginBottom: '1rem' }}>📸</div>
                <h2 style={{ marginBottom: '0.5rem' }}>PhotoBooth QR Generator</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Version 1.0.8</p>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Developed by ILFforever for Intania Production House</p>

              </div>

              <div style={{ marginBottom: '1.5rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                <p style={{ marginBottom: '0.5rem', fontSize: '13px' }}>
                  Upload your photobooth images to Google Drive and generate shareable QR codes and links instantly.
                </p>

                <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '8px', marginTop: '0.5rem'}}>
                  <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '0.75rem', position: 'relative' }}>
                    <button
                      onClick={() => setAboutTab('features')}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '0 0 0.5rem 0',
                        fontSize: '13px',
                        fontWeight: '600',
                        color: aboutTab === 'features' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'color 0.2s ease'
                      }}
                    >
                      Features
                      {aboutTab === 'features' && (
                        <motion.div
                          layoutId="aboutUnderline"
                          style={{
                            position: 'absolute',
                            bottom: '-1px',
                            left: 0,
                            right: 0,
                            height: '2px',
                            background: 'var(--accent-blue)',
                            zIndex: 1
                          }}
                        />
                      )}
                    </button>
                    <button
                      onClick={() => setAboutTab('contact')}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '0 0 0.5rem 0',
                        fontSize: '13px',
                        fontWeight: '600',
                        color: aboutTab === 'contact' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'color 0.2s ease'
                      }}
                    >
                      Contact
                      {aboutTab === 'contact' && (
                        <motion.div
                          layoutId="aboutUnderline"
                          style={{
                            position: 'absolute',
                            bottom: '-1px',
                            left: 0,
                            right: 0,
                            height: '2px',
                            background: 'var(--accent-blue)',
                            zIndex: 1
                          }}
                        />
                      )}
                    </button>
                  </div>

                  {aboutTab === 'features' ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ul style={{ fontSize: '13px', paddingLeft: '1.5rem', margin: 0 }}>
                        <li style={{ marginBottom: '0.5rem' }}>Drag & drop or browse to add photos (JPG, PNG, RAW)</li>
                        <li style={{ marginBottom: '0.5rem' }}>Organize uploads in Google Drive folders</li>
                        <li style={{ marginBottom: '0.5rem' }}>Generate shareable QR codes automatically</li>
                        <li>Support for RAW image formats</li>
                      </ul>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <a 
                          href="https://github.com/ILFforever" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.75rem', 
                            color: 'var(--text-primary)', 
                            textDecoration: 'none',
                            padding: '0.5rem',
                            borderRadius: '6px',
                            background: 'var(--bg-secondary)',
                            transition: 'background 0.2s ease'
                          }}
                        >
                          <span style={{ fontSize: '18px' }}>🐙</span>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: '600' }}>GitHub</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@ILFforever</div>
                          </div>
                        </a>
                        <a 
                          href="mailto:intania.productions@gmail.com" 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.75rem', 
                            color: 'var(--text-primary)', 
                            textDecoration: 'none',
                            padding: '0.5rem',
                            borderRadius: '6px',
                            background: 'var(--bg-secondary)',
                            transition: 'background 0.2s ease'
                          }}
                        >
                          <span style={{ fontSize: '18px' }}>📧</span>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: '600' }}>Email</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>intania.productions@gmail.com</div>
                          </div>
                        </a>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowAboutModal(false)}
                className="btn-primary"
                style={{ width: '100%' }}
              >
                Close
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;