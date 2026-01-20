import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Result } from "../types/qr";
import type { UploadProgress } from "../types/qr";
import type { NoPreviewImage } from "../types/qr";

interface UseQRUploadOptions {
  photosPath: string | null;
  imagePaths: string[];
  selectedImages: string[];
  assetUrlToFilePath: Record<string, string>;
  noPreviewImages: NoPreviewImage[];
  setUploadProgress: (progress: UploadProgress | null) => void;
}

export function useQRUpload({
  photosPath,
  imagePaths,
  selectedImages,
  assetUrlToFilePath,
  noPreviewImages,
  setUploadProgress,
}: UseQRUploadOptions) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  const handleGenerate = async (rootFolder: { id: string; name: string } | null) => {
    // Validate inputs
    if (!photosPath && selectedImages.length === 0) {
      setError("Please add photos first");
      return;
    }

    if (!rootFolder) {
      setError("Please select a Drive root folder first");
      return;
    }

    if (!photosPath && selectedImages.length > 0) {
      setError("Please use 'Browse > From Folder' to select a folder of images to upload");
      return;
    }

    // Build file list for upload
    const fileList: string[] = [...imagePaths];

    // Add files from assetUrlToFilePath (folder-loaded images)
    for (const assetUrl of selectedImages) {
      const originalPath = assetUrlToFilePath[assetUrl];
      if (originalPath && !fileList.includes(originalPath)) {
        fileList.push(originalPath);
      }
    }

    // Add RAW files from noPreviewImages
    if (photosPath) {
      for (const img of noPreviewImages) {
        const separator = photosPath.endsWith('\\') || photosPath.endsWith('/') ? '' : '\\';
        const fullPath = `${photosPath}${separator}${img.filename}`;
        if (!fileList.includes(fullPath)) {
          fileList.push(fullPath);
        }
      }
    }

    setLoading(true);
    setError("");
    setResult(null);
    setUploadProgress(null);

    try {
      const res = await invoke<Result>("process_photos", {
        photosPath: photosPath,
        fileList: fileList.length > 0 ? fileList : null,
      });

      setResult(res);
    } catch (e) {
      console.error("Upload failed:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      // Don't show error if it was a user cancellation
      if (!errorMsg.includes("cancelled")) {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelUpload = async () => {
    // Call the Rust command to set the cancellation flag
    try {
      await invoke("cancel_upload");
    } catch (e) {
      console.error("Failed to cancel upload:", e);
    }
    setLoading(false);
  };

  const handleNew = async () => {
    setResult(null);
    setError("");
  };

  const handleCopyLink = () => {
    if (result?.link) {
      navigator.clipboard.writeText(result.link);
    }
  };

  return {
    loading,
    result,
    error,
    setError,
    handleGenerate,
    handleCancelUpload,
    handleNew,
    handleCopyLink,
  };
}
