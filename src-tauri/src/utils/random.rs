use rand::Rng;

pub fn generate_random_name() -> String {
    let mut rng = rand::thread_rng();
    let random_string: String = (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 26 {
                (b'A' + idx) as char
            } else {
                (b'0' + (idx - 26)) as char
            }
        })
        .collect();
    format!("PhotoBooth_{}", random_string)
}
