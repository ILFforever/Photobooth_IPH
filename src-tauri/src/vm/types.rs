use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct VmLogsResponse {
    pub logs: Vec<String>,
    #[serde(alias = "lineCount")]
    pub line_count: usize,
}
