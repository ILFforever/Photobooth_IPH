use std::sync::{Arc, Mutex, atomic::AtomicBool};
use serde::{Deserialize, Serialize};

// Google Drive authentication type
pub type Auth = yup_oauth2::authenticator::Authenticator<
    hyper_rustls::HttpsConnector<hyper::client::HttpConnector>
>;

#[derive(Serialize, Deserialize, Clone)]
pub struct GoogleAccount {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DriveFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_shared_drive: bool,
}

pub struct AppState {
    pub auth: Mutex<Option<Auth>>,
    pub account: Mutex<Option<GoogleAccount>>,
    pub root_folder: Mutex<Option<DriveFolder>>,
    pub upload_cancelled: Arc<AtomicBool>,
    pub auth_url: Mutex<Option<String>>,
}
