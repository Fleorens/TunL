use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch (0 if the system clock is before 1970).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}
