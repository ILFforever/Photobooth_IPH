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
mod upload_queue;
mod gif_generator;
mod system_requirements;
mod version;
mod ffmpeg_sidecar;
mod display_layouts;
mod ffmpeg_manager;
mod system_fonts;

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
use display_layouts::*;
use photobooth_sessions::*;
use upload_queue::*;
use upload_queue::queue::UploadQueue;
use gif_generator::*;
use ffmpeg_manager::*;
use system_requirements::*;
use version::*;

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
            auth_url: Mutex::new(None),
        })
        .manage(UploadQueueStateWrapper {
            queue: Arc::new(UploadQueue::new()),
        })
        .setup(|app| {
            use tauri::Manager;

            // Set the app handle on the upload queue (processor will start lazily)
            let queue_state = app.state::<UploadQueueStateWrapper>();

            // Spawn a task to set the app handle asynchronously
            let queue = queue_state.queue.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                queue.set_app_handle(app_handle).await;
            });

            // Create splash window on startup
            let _ = tauri::WebviewWindowBuilder::new(
                app,
                "splash",
                tauri::WebviewUrl::App("splash.html".into())
            )
            .title("Photobooth IPH")
            .inner_size(400.0, 320.0)
            .center()
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .devtools(true)
            .build();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Google Drive
            google_login,
            google_logout,
            check_cached_account,
            get_account,
            open_auth_url,
            list_drive_folders,
            create_drive_folder,
            share_drive_folder,
            delete_drive_folder,
            set_root_folder,
            get_root_folder,
            process_photos,
            cancel_upload,
            upload_photo_to_drive,
            // File helpers
            select_folder,
            select_file,
            get_file_info,
            // Working Folder
            open_working_folder,
            select_working_folder,
            get_images_in_folder,
            get_images_with_metadata,
            save_dropped_image,
            generate_cached_thumbnail,
            generate_cached_thumbnail_ultra,
            generate_cached_thumbnails_batch,
            generate_cached_thumbnails_batch_ultra,
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
            export_custom_set,
            import_custom_set,
            update_custom_set_background,
            // Display Layouts
            save_display_layout,
            load_display_layouts,
            get_display_layout,
            delete_display_layout,
            duplicate_display_layout,
            export_display_layout,
            import_display_layout,
            // Photobooth Sessions
            load_ptb_workspace,
            save_ptb_workspace,
            save_delay_settings,
            save_photobooth_settings,
            save_gif_settings,
            save_print_settings,
            create_photobooth_session,
            delete_photobooth_session,
            delete_session_photo,
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
            save_file_to_path,
            download_photo_from_daemon,
            get_photo_exif,
            update_session_qr_setting,
            update_session_naming_scheme,
            // Upload Queue
            enqueue_upload_items,
            get_session_upload_queue,
            get_upload_queue_stats,
            retry_upload,
            cancel_queued_upload,
            remove_session_uploads,
            // History
            get_history,
            clear_history,
            // Printing
            print_image_with_windows_dialog,
            // VM
            get_vm_logs,
            check_vm_online,
            restart_vm,
            shutdown_vm,
            exit_app,
            force_exit_app,
            restart_app,
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
            // System Requirements
            get_system_requirements,
            launch_virtualbox_installer,
            get_app_version,
            get_app_info,
            get_app_status,
            get_vm_version,
            get_vm_status,
            get_version_status,
            check_app_updates,
            check_vm_updates,
            check_all_updates,
            get_version_changelog,
            install_vm_update,
            download_msi_update,
            launch_msi_installer,
            open_vm_update_website,
            extract_iso_to_appdata,
            // App Initialization
            initialize_app,
            close_splash_and_show_main,
            // GIF/Video Generation
            generate_gif,
            check_ffmpeg_installed,
            get_ffmpeg_version,
            get_ffmpeg_size,
            download_ffmpeg_command,
            delete_ffmpeg_command,
            generate_slideshow_video,
            // QR Code
            utils::qr_code::generate_qr_code,
            // System Fonts
            system_fonts::get_system_fonts,
        ])
        .on_window_event(|window, event| {
            use tauri::Emitter;
            // When the main window close is requested, prevent it and let frontend handle cleanup
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    // Notify frontend to show cleanup modal
                    let _ = window.emit("cleanup-requested", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
