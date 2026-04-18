/**
 * A managed file in the global asset library.
 *
 * Assets are identified by the SHA-256 hash of their content, making them
 * portable across devices: importing the same PNG on two machines produces
 * the same id, so duplicates are never stored.
 */
export interface Asset {
  /** SHA-256 hex hash — the global identity of this file */
  id: string;
  name: string;
  tags: string[];
  /** "overlay" | "background_image" */
  assetType: string;
  fileExt: string;
  fileSize: number;
  importedAt: string;
}

/** Inline asset entry inside a portable .ptbs export bundle */
export interface BundledAsset {
  id: string;
  name: string;
  tags: string[];
  assetType: string;
  fileExt: string;
  /** Base64-encoded file content */
  data: string;
}
