use serde::Deserializer;

// Custom deserializer helper to accept both int and float for Option<u32>
pub fn deserialize_optional_u32_or_float<'de, D>(
    deserializer: D,
) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    use serde::Deserialize;

    // Try to deserialize as a number (either i64 or f64)
    let value = match Option::<serde_json::Number>::deserialize(deserializer) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };

    match value {
        Some(num) => {
            // Try as i64 first, then as f64
            if let Some(i) = num.as_i64() {
                if i >= 0 && i <= u32::MAX as i64 {
                    Ok(Some(i as u32))
                } else {
                    Err(Error::custom(format!("value {} out of range for u32", i)))
                }
            } else if let Some(f) = num.as_f64() {
                if f >= 0.0 && f.fract() == 0.0 && f <= u32::MAX as f64 {
                    Ok(Some(f as u32))
                } else {
                    Err(Error::custom(format!(
                        "value {} is not a valid integer for u32",
                        f
                    )))
                }
            } else {
                Err(Error::custom("invalid number format"))
            }
        }
        None => Ok(None),
    }
}
