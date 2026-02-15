// Modularized Tauri application entry point

// Module declarations
mod state;
mod types;
mod utils;
mod google_drive;
mod frames;
mod backgrounds;
mod settings;
mod history;
mod printing;
mod vm;
mod usb_camera;
mod hdmi_capture;
mod working_folder;
mod custom_sets;
mod photobooth_sessions;

// Re-export state
use state::AppState;
use std::sync::{Arc, atomic::AtomicBool, Mutex};

// Import all command functions
use google_drive::*;
use frames::*;
use backgrounds::*;
use settings::*;
use history::*;
use printing::*;
use vm::*;
use usb_camera::*;
use hdmi_capture::*;
use utils::*;
use working_folder::*;
use custom_sets::*;
use photobooth_sessions::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            auth: Mutex::new(None),
            account: Mutex::new(None),
            root_folder: Mutex::new(None),
            upload_cancelled: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            // Google Drive
            google_login,
            google_logout,
            check_cached_account,
            get_account,
            list_drive_folders,
            create_drive_folder,
            delete_drive_folder,
            set_root_folder,
            get_root_folder,
            process_photos,
            cancel_upload,
            // File helpers
            select_folder,
            select_file,
            get_file_info,
            // Working Folder
            select_working_folder,
            get_images_in_folder,
            get_images_with_metadata,
            save_dropped_image,
            generate_cached_thumbnail,
            generate_cached_thumbnails_batch,
            clear_temp_images,
            remove_temp_image,
            // Frames
            save_frame,
            load_frames,
            delete_frame,
            duplicate_frame,
            // Backgrounds
            save_background,
            load_backgrounds,
            delete_background,
            import_background,
            // Settings
            save_custom_canvas_size,
            get_custom_canvas_sizes,
            delete_custom_canvas_size,
            save_app_setting,
            get_app_setting,
            // Custom Sets
            save_custom_set,
            load_custom_sets,
            get_custom_set,
            delete_custom_set,
            duplicate_custom_set,
            // Photobooth Sessions
            load_ptb_workspace,
            save_ptb_workspace,
            create_photobooth_session,
            list_photobooth_sessions,
            get_current_session,
            set_current_session,
            get_session_data,
            update_session_drive_metadata,
            add_session_drive_upload,
            is_image_uploaded_to_drive,
            clear_session_drive_uploads,
            save_photo_to_working_folder,
            file_exists_in_session,
            save_file_to_session_folder,
            download_photo_from_daemon,
            // History
            get_history,
            clear_history,
            // Printing
            print_image_with_windows_dialog,
            // VM
            get_vm_logs,
            check_vm_online,
            restart_vm,
            // USB Camera
            list_usb_cameras,
            attach_usb_camera,
            detach_usb_camera,
            get_attached_cameras,
            is_camera_attached,
            cleanup_all_cameras,
            attach_all_cameras,
            ensure_usb_filters,
            // HDMI Capture
            list_capture_devices,
            start_hdmi_capture,
            stop_hdmi_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
