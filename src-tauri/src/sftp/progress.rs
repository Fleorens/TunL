//! The folder progress adapter shared by the download (tree) and the upload (T56).

use std::sync::Mutex;
use std::time::Instant;

use crate::sftp::transfer::{PROGRESS_INTERVAL, TransferEvent, TransferSink, emit_progress};

/// Shifts the `Progress` of one file's `copy` onto the whole folder: `transferred` counts the bytes of the
/// files already copied, `total` is the folder's, and the rate is measured from the start of the folder.
/// The final `Progress` of each file is held back unless `PROGRESS_INTERVAL` has passed since the last one
/// sent (`last`, shared by the files of the folder), so many small files do not flood the UI; the very last
/// one (the whole folder copied) always goes through.
pub(crate) struct Cumulative<'a> {
    pub(crate) sink: &'a dyn TransferSink,
    pub(crate) offset: u64,
    pub(crate) total: u64,
    pub(crate) start: Instant,
    pub(crate) last: &'a Mutex<Option<Instant>>,
}

impl Cumulative<'_> {
    /// Whether a `Progress` for `transferred` bytes of the folder goes out now (and marks the time if so).
    fn due(&self, transferred: u64) -> bool {
        let now = Instant::now();
        let Ok(mut last) = self.last.lock() else {
            return true;
        };
        let due = transferred >= self.total
            || last.is_none_or(|sent| now.duration_since(sent) >= PROGRESS_INTERVAL);
        if due {
            *last = Some(now);
        }
        due
    }
}

impl TransferSink for Cumulative<'_> {
    fn event(&self, event: TransferEvent) {
        match event {
            TransferEvent::Progress { transferred, .. } => {
                let transferred = self.offset + transferred;
                if self.due(transferred) {
                    emit_progress(
                        self.sink,
                        transferred,
                        Some(self.total),
                        self.start.elapsed(),
                    );
                }
            }
            other => self.sink.event(other),
        }
    }
}
