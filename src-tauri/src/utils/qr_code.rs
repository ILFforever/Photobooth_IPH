use base64::{engine::general_purpose, Engine as _};
use std::io::Cursor;

pub fn generate_qr_code_base64(url: &str) -> Result<String, String> {
    use image::codecs::png::PngEncoder;
    use image::{ImageEncoder, Luma};
    use qrcode::QrCode;

    let code = QrCode::new(url.as_bytes()).map_err(|e| e.to_string())?;
    let qr_image = code
        .render::<Luma<u8>>()
        .max_dimensions(400, 400)
        .build();

    // Get the raw pixel data and dimensions
    let width = qr_image.width();
    let height = qr_image.height();
    let raw_data = qr_image.into_raw();

    // Encode to PNG buffer
    let mut buffer = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut buffer);
    encoder
        .write_image(
            &raw_data,
            width,
            height,
            image::ExtendedColorType::L8,
        )
        .map_err(|e: image::error::ImageError| e.to_string())?;

    Ok(general_purpose::STANDARD.encode(buffer.get_ref()))
}
