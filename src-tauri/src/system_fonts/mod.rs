// System font querying module
#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        get_windows_fonts()
    }

    #[cfg(target_os = "macos")]
    {
        get_macos_fonts()
    }

    #[cfg(target_os = "linux")]
    {
        get_linux_fonts()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(vec!["Arial".to_string(), "Times New Roman".to_string()])
    }
}

#[cfg(target_os = "windows")]
fn get_windows_fonts() -> Result<Vec<String>, String> {
    use std::sync::Mutex;
    use windows::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, FONT_CHARSET, LOGFONTW,
    };
    use windows::Win32::Foundation::{HWND, LPARAM};

    static FONTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

    unsafe extern "system" fn enum_proc(
        lpelfe: *const LOGFONTW,
        _: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
        _: u32,
        _: LPARAM,
    ) -> i32 {
        let lf = &*lpelfe;
        let font_name_slice = &lf.lfFaceName[..];
        if let Ok(font_name_raw) = String::from_utf16(font_name_slice) {
            // Trim null characters - Windows uses fixed-width 32-char strings for font names
            let font_name = font_name_raw.trim_matches('\0');
            if !font_name.is_empty() {
                FONTS.lock().unwrap().push(font_name.to_string());
            }
        }
        1 // Continue enumeration
    }

    let mut logfont = LOGFONTW::default();
    logfont.lfCharSet = FONT_CHARSET(0); // ANSI_CHARSET
    logfont.lfPitchAndFamily = 0;

    let hdc = unsafe { windows::Win32::Graphics::Gdi::GetDC(HWND::default()) };
    if hdc.is_invalid() {
        return Err("Failed to get device context".to_string());
    }

    let result = unsafe {
        EnumFontFamiliesExW(
            hdc,
            &logfont,
            Some(enum_proc),
            LPARAM(0),
            0,
        )
    };

    unsafe { windows::Win32::Graphics::Gdi::ReleaseDC(HWND::default(), hdc) };

    if result != 0 {
        let mut fonts = FONTS.lock().unwrap();
        fonts.sort();
        fonts.dedup();
        Ok(fonts.clone())
    } else {
        Err("Failed to enumerate fonts".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_macos_fonts() -> Result<Vec<String>, String> {
    use std::process::Command;

    let output = Command::new("system_profiler")
        .arg("SPFontsDataType")
        .arg("-xml")
        .output()
        .map_err(|e| format!("Failed to query fonts: {}", e))?;

    let xml = String::from_utf8_lossy(&output.stdout);

    // Parse XML to extract font names
    let mut fonts = Vec::new();
    for line in xml.lines() {
        if line.contains("<name>") {
            if let Some(start) = line.find("<name>") {
                if let Some(end) = line.find("</name>") {
                    let font_name = &line[start + 6..end];
                    // Filter out system fonts and duplicates
                    if !font_name.starts_with('.')
                        && !font_name.contains("LastResort")
                        && !fonts.contains(&font_name.to_string()) {
                        fonts.push(font_name.to_string());
                    }
                }
            }
        }
    }

    fonts.sort();
    Ok(fonts)
}

#[cfg(target_os = "linux")]
fn get_linux_fonts() -> Result<Vec<String>, String> {
    use std::path::Path;

    let mut fonts = Vec::new();
    let font_dirs = [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
    ];

    for font_dir in font_dirs {
        if Path::new(font_dir).exists() {
            if let Ok(entries) = std::fs::read_dir(font_dir) {
                for entry in entries.flatten() {
                    if let Ok(name) = entry.file_name().into_string() {
                        if name.ends_with(".ttf") || name.ends_with(".otf") || name.ends_with(".ttc") {
                            fonts.push(name.replace(".ttf", "").replace(".otf", "").replace(".ttc", ""));
                        }
                    }
                }
            }
        }
    }

    fonts.sort();
    fonts.dedup();
    Ok(fonts)
}
