// Pure snap utility functions — no React imports

export interface SnapGuides {
  centerH: boolean;
  centerV: boolean;
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export interface EdgeSnapGuides {
  horizontal: boolean;
  vertical: boolean;
  centerH: boolean;
  centerV: boolean;
}

export const EMPTY_SNAP_GUIDES: SnapGuides = {
  centerH: false,
  centerV: false,
  left: false,
  right: false,
  top: false,
  bottom: false,
};

export const EMPTY_EDGE_SNAP_GUIDES: EdgeSnapGuides = {
  horizontal: false,
  vertical: false,
  centerH: false,
  centerV: false,
};

/**
 * Returns `target` if `value` is within `threshold` of `target`, otherwise `value`.
 */
export function applySnap(value: number, target: number, threshold: number = 8): number {
  if (Math.abs(value - target) <= threshold) {
    return target;
  }
  return value;
}

export interface ZoneDragSnapResult {
  finalX: number;
  finalY: number;
  guides: SnapGuides;
}

/**
 * Applies snap logic while dragging a zone.
 * Returns the snapped position and which snap guides are active.
 */
export function calculateZoneDragSnap(
  rawX: number,
  rawY: number,
  zoneWidth: number,
  zoneHeight: number,
  frameWidth: number,
  frameHeight: number,
  snapThreshold: number,
): ZoneDragSnapResult {
  const centerX = frameWidth / 2;
  const centerY = frameHeight / 2;

  const zoneCenterX = rawX + zoneWidth / 2;
  const zoneCenterY = rawY + zoneHeight / 2;
  const zoneRightEdge = rawX + zoneWidth;
  const zoneBottomEdge = rawY + zoneHeight;

  const snappedCenterX = applySnap(zoneCenterX, centerX, snapThreshold);
  const snappedCenterY = applySnap(zoneCenterY, centerY, snapThreshold);

  const snappedLeft = applySnap(rawX, 0, snapThreshold);
  const snappedRight = applySnap(zoneRightEdge, frameWidth, snapThreshold);
  const snappedTop = applySnap(rawY, 0, snapThreshold);
  const snappedBottom = applySnap(zoneBottomEdge, frameHeight, snapThreshold);

  const snapToCenterX = snappedCenterX === centerX;
  const snapToCenterY = snappedCenterY === centerY;
  const snapToLeft = snappedLeft === 0;
  const snapToRight = snappedRight === frameWidth;
  const snapToTop = snappedTop === 0;
  const snapToBottom = snappedBottom === frameHeight;

  let finalX = rawX;
  let finalY = rawY;

  const distToLeft = Math.abs(rawX);
  const distToRight = Math.abs(zoneRightEdge - frameWidth);
  const distToCenterX = Math.abs(zoneCenterX - centerX);
  // Suppress center snap if an edge is nearby — edge takes priority when closer than center
  const edgeNearX = distToLeft < distToCenterX || distToRight < distToCenterX;
  const useCenterX = snapToCenterX && !edgeNearX;

  if (useCenterX) {
    finalX = snappedCenterX - zoneWidth / 2;
  } else if (snapToLeft && snapToRight) {
    finalX = distToLeft <= distToRight ? snappedLeft : snappedRight - zoneWidth;
  } else if (snapToLeft) {
    finalX = snappedLeft;
  } else if (snapToRight) {
    finalX = snappedRight - zoneWidth;
  }

  const distToTop = Math.abs(rawY);
  const distToBottom = Math.abs(zoneBottomEdge - frameHeight);
  const distToCenterY = Math.abs(zoneCenterY - centerY);
  const edgeNearY = distToTop < distToCenterY || distToBottom < distToCenterY;
  const useCenterY = snapToCenterY && !edgeNearY;

  if (useCenterY) {
    finalY = snappedCenterY - zoneHeight / 2;
  } else if (snapToTop && snapToBottom) {
    finalY = distToTop <= distToBottom ? snappedTop : snappedBottom - zoneHeight;
  } else if (snapToTop) {
    finalY = snappedTop;
  } else if (snapToBottom) {
    finalY = snappedBottom - zoneHeight;
  }


  return {
    finalX,
    finalY,
    guides: {
      centerH: useCenterX,
      centerV: useCenterY,
      left: snapToLeft,
      right: snapToRight,
      top: snapToTop,
      bottom: snapToBottom,
    },
  };
}

export interface BackgroundDragSnapResult {
  newOffsetX: number;
  newOffsetY: number;
  guides: EdgeSnapGuides;
}

/**
 * Applies snap logic while dragging the background layer.
 */
export function calculateBackgroundDragSnap(
  rawOffsetX: number,
  rawOffsetY: number,
  overflowX: number,
  overflowY: number,
  snapThreshold: number,
): BackgroundDragSnapResult {
  let newOffsetX = rawOffsetX;
  let newOffsetY = rawOffsetY;

  const snapToCenterX = Math.abs(newOffsetX) < snapThreshold;
  const snapToCenterY = Math.abs(newOffsetY) < snapThreshold;

  if (snapToCenterX) newOffsetX = 0;
  if (snapToCenterY) newOffsetY = 0;

  const leftEdgeSnap = Math.abs(newOffsetX - overflowX) < snapThreshold;
  const rightEdgeSnap = Math.abs(newOffsetX + overflowX) < snapThreshold;
  const topEdgeSnap = Math.abs(newOffsetY - overflowY) < snapThreshold;
  const bottomEdgeSnap = Math.abs(newOffsetY + overflowY) < snapThreshold;

  if (leftEdgeSnap) newOffsetX = overflowX;
  if (rightEdgeSnap) newOffsetX = -overflowX;
  if (topEdgeSnap) newOffsetY = overflowY;
  if (bottomEdgeSnap) newOffsetY = -overflowY;

  return {
    newOffsetX,
    newOffsetY,
    guides: {
      horizontal: leftEdgeSnap || rightEdgeSnap,
      vertical: topEdgeSnap || bottomEdgeSnap,
      centerH: snapToCenterX,
      centerV: snapToCenterY,
    },
  };
}

export interface ImageDragSnapResult {
  newOffsetX: number;
  newOffsetY: number;
  guides: EdgeSnapGuides;
}

/**
 * Applies snap logic while panning an image within a zone.
 */
export function calculateImageDragSnap(
  rawOffsetX: number,
  rawOffsetY: number,
  imageBaseCenterX: number,
  imageBaseCenterY: number,
  scaledWidth: number,
  scaledHeight: number,
  containerWidth: number,
  containerHeight: number,
  snapThreshold: number,
): ImageDragSnapResult {
  let newOffsetX = rawOffsetX;
  let newOffsetY = rawOffsetY;

  const containerCenterX = containerWidth / 2;
  const containerCenterY = containerHeight / 2;

  const imageCenterX = imageBaseCenterX + newOffsetX;
  const imageCenterY = imageBaseCenterY + newOffsetY;

  const snapToCenterH = Math.abs(imageCenterX - containerCenterX) < snapThreshold;
  const snapToCenterV = Math.abs(imageCenterY - containerCenterY) < snapThreshold;

  if (snapToCenterH) {
    newOffsetX = containerCenterX - imageBaseCenterX;
  }
  if (snapToCenterV) {
    newOffsetY = containerCenterY - imageBaseCenterY;
  }

  const imageLeft = imageBaseCenterX - scaledWidth / 2 + newOffsetX;
  const imageRight = imageBaseCenterX + scaledWidth / 2 + newOffsetX;
  const imageTop = imageBaseCenterY - scaledHeight / 2 + newOffsetY;
  const imageBottom = imageBaseCenterY + scaledHeight / 2 + newOffsetY;

  const snapToLeft = Math.abs(imageLeft) < snapThreshold;
  const snapToRight = Math.abs(imageRight - containerWidth) < snapThreshold;
  const snapToTop = Math.abs(imageTop) < snapThreshold;
  const snapToBottom = Math.abs(imageBottom - containerHeight) < snapThreshold;

  if (snapToLeft) newOffsetX = -imageBaseCenterX + scaledWidth / 2;
  if (snapToRight) newOffsetX = containerWidth - imageBaseCenterX - scaledWidth / 2;
  if (snapToTop) newOffsetY = -imageBaseCenterY + scaledHeight / 2;
  if (snapToBottom) newOffsetY = containerHeight - imageBaseCenterY - scaledHeight / 2;

  return {
    newOffsetX,
    newOffsetY,
    guides: {
      horizontal: snapToLeft || snapToRight,
      vertical: snapToTop || snapToBottom,
      centerH: snapToCenterH,
      centerV: snapToCenterV,
    },
  };
}
