use crate::asset_library::types::BundledAsset;
use crate::backgrounds::Background;
use crate::frames::Frame;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OverlayTransform {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub opacity: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLayer {
    pub id: String,
    /// SHA-256 hash — resolves to a file in the global asset library
    pub asset_id: String,
    pub name: String,
    pub thumbnail: Option<String>,
    pub position: String,
    pub layer_order: i32,
    pub transform: OverlayTransform,
    pub blend_mode: String,
    pub visible: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTransform {
    pub scale: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSize {
    pub width: u32,
    pub height: u32,
    pub name: String,
    pub is_custom: Option<bool>,
    pub created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomSet {
    pub id: String,
    pub name: String,
    pub description: String,

    pub canvas_size: CanvasSize,
    pub auto_match_background: bool,

    pub background: Background,
    pub background_transform: BackgroundTransform,

    pub frame: Frame,

    #[serde(default)]
    pub overlays: Vec<OverlayLayer>,

    pub thumbnail: Option<String>,
    pub created_at: String,
    pub modified_at: String,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomSetPreview {
    pub id: String,
    pub name: String,
    pub description: String,
    pub thumbnail: Option<String>,
    pub created_at: String,
}

/// Portable export format (version 2).
/// All overlay assets (and background image if applicable) are bundled inline
/// so the file is self-contained and can be imported on any device.
#[derive(Serialize, Deserialize)]
pub struct PortableCustomSet {
    pub version: u32,
    pub custom_set: CustomSet,
    /// All asset files referenced by this set (overlays, background image).
    /// On import, each entry is registered into the local asset library —
    /// duplicates are skipped automatically via hash comparison.
    pub assets: Vec<BundledAsset>,
    /// Base64-encoded JPEG thumbnail for the set card preview (set-specific, not in asset library).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_data: Option<String>,
}
