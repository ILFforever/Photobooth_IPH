/// Invoke Windows Photo Printing Wizard for an image file
/// This opens the native Windows photo print dialog (same as right-click > Print)
#[tauri::command]
pub async fn print_image_with_windows_dialog(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        // Convert path to absolute path if not already
        let absolute_path = std::path::Path::new(&file_path)
            .canonicalize()
            .map_err(|e| format!("Failed to resolve path: {}", e))?;

        // Convert path to Windows string format
        let path_str = absolute_path.to_string_lossy().to_string();
        let file_path_wide: HSTRING = path_str.clone().into();

        // Use ShellExecute with "print" verb to invoke Windows Photo Printing Wizard
        // This is equivalent to right-clicking a file and selecting "Print"
        let result = unsafe {
            ShellExecuteW(
                HWND::default(),
                w!("print"),     // The "print" verb invokes the default print handler
                &file_path_wide, // File to print
                PCWSTR::null(),  // No parameters
                PCWSTR::null(),  // Default directory
                SW_SHOWNORMAL,   // Show the window normally
            )
        };

        // ShellExecute returns a value > 32 on success (or an error handle on failure)
        // If the return value is <= 32, it indicates an error
        let result_value = result.0 as i32;
        if result_value <= 32 {
            Err(format!(
                "ShellExecute failed with error code: {}",
                result_value
            ))
        } else {
            Ok(())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Windows photo printing is only available on Windows".to_string())
    }
}
