use serde::{Deserialize, Serialize};

// Frame system structures
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FrameZone {
    pub id: String,
    // Fixed positioning system - all in pixels
    pub x: i32,      // X position in pixels from left edge
    pub y: i32,      // Y position in pixels from top edge
    pub width: u32,  // Width in pixels (fixed size)
    pub height: u32, // Height in pixels (fixed size)
    pub rotation: f32, // Rotation in degrees
    // Shape type for the zone
    pub shape: String, // "rectangle", "circle", "rounded_rect", "ellipse", "pill"
    #[serde(
        rename = "borderRadius",
        default,
        deserialize_with = "crate::utils::deserialize_optional_u32_or_float"
    )]
    pub border_radius: Option<u32>, // Border radius in pixels (for rounded_rect shape)
    // Optional spacing properties for distance calculations
    #[serde(rename = "marginRight", default)]
    pub margin_right: Option<u32>, // Distance to next zone on right (in pixels)
    #[serde(rename = "marginBottom", default)]
    pub margin_bottom: Option<u32>, // Distance to next zone below (in pixels)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Frame {
    pub id: String,
    pub name: String,
    pub description: String,
    pub width: u32,  // Canvas width in pixels (1200)
    pub height: u32, // Canvas height in pixels (1800)
    pub zones: Vec<FrameZone>,
    pub thumbnail: Option<String>, // Base64 thumbnail or path
    pub is_default: bool,
    pub created_at: String,
}
