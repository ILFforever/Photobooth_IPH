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
    #[serde(alias = "flipHorizontal")]
    pub flip_horizontal: bool,
    #[serde(alias = "flipVertical")]
    pub flip_vertical: bool,
    pub opacity: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLayer {
    pub id: String,
    pub name: String,
    #[serde(alias = "sourcePath")]
    pub source_path: String,
    pub thumbnail: Option<String>,
    pub position: String,
    #[serde(alias = "layerOrder")]
    pub layer_order: i32,
    pub transform: OverlayTransform,
    #[serde(alias = "blendMode")]
    pub blend_mode: String,
    pub visible: bool,
    #[serde(alias = "createdAt")]
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

    // Canvas configuration
    pub canvas_size: CanvasSize,
    pub auto_match_background: bool,

    // Background configuration
    pub background: Background,
    pub background_transform: BackgroundTransform,

    // Layout/Frame
    pub frame: Frame,

    // Overlays
    #[serde(default)]
    pub overlays: Vec<OverlayLayer>,

    // Metadata
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
