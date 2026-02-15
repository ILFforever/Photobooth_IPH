use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomCanvasSize {
    pub width: u32,
    pub height: u32,
    pub name: String,
    #[serde(default)]
    pub created_at: u64, // Unix timestamp
}
