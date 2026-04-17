use crate::custom_sets::types::OverlayTransform;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DisplayElement {
    pub id: String,
    pub role: String,
    pub source_path: Option<String>,
    pub text_content: Option<String>,
    pub font_size: Option<f32>,
    pub font_color: Option<String>,
    pub font_weight: Option<String>,
    #[serde(default)]
    pub font_family: Option<String>,
    // Collage-specific
    #[serde(default)]
    pub collage_width: Option<f32>,
    #[serde(default)]
    pub collage_height: Option<f32>,
    // Shape-specific
    #[serde(default)]
    pub shape_type: Option<String>,
    #[serde(default)]
    pub shape_fill: Option<String>,
    #[serde(default)]
    pub shape_border_color: Option<String>,
    #[serde(default)]
    pub shape_border_width: Option<f32>,
    #[serde(default)]
    pub shape_width: Option<f32>,
    #[serde(default)]
    pub shape_height: Option<f32>,
    #[serde(default)]
    pub shape_border_radius: Option<f32>,
    pub transform: OverlayTransform,
    pub blend_mode: String,
    pub opacity: f32,
    pub visible: bool,
    pub layer_order: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DisplayLayout {
    pub id: String,
    pub name: String,
    pub background_color: String,
    pub background_image: Option<String>,
    pub elements: Vec<DisplayElement>,
    pub thumbnail: Option<String>,
    pub created_at: String,
    pub modified_at: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub canvas_width: Option<u32>,
    #[serde(default)]
    pub canvas_height: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DisplayLayoutPreview {
    pub id: String,
    pub name: String,
    pub thumbnail: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub is_default: bool,
}
