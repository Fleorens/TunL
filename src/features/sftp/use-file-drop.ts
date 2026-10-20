// Drag-and-drop of files onto the SFTP tab (T26b): the window handler for Tauri, the HTML5 handlers for the mock.
//
// In Tauri the backend reports the dropped files by absolute path (see `onFileDrop`); in the browser the explorer
// gets HTML5 drag events that only carry file names, so the mock builds a path under `MOCK_DROP_DIR` (docs/04 §6).
import { useEffect, useRef, useState } from "react";
import { onFileDrop } from "@/lib/events";
import { MOCK_DROP_DIR } from "@/lib/files";
import { isMockBackend } from "@/lib/ipc";

/** The drag state and the HTML5 handlers the explorer renders on its table trigger (mock only). */
export interface FileDrop {
  dragging: boolean;
  dropProps: DragDropProps;
}

/** The HTML5 drag handlers, typed for the element they are spread onto (the table's `ContextMenuTrigger`). */
export interface DragDropProps {
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
}

/**
 * Follow files dragged onto the tab while it is shown: `dragging` for the overlay, and the HTML5 handlers for the
 * mock. `onFiles` is read from a ref so the window subscription is made once, not on every render.
 */
export function useFileDrop(active: boolean, onFiles: (paths: string[]) => void): FileDrop {
  const filesRef = useRef(onFiles);
  filesRef.current = onFiles;

  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    return onFileDrop({
      onOver: () => setDragging(true),
      onLeave: () => setDragging(false),
      onDrop: (paths) => {
        setDragging(false);
        filesRef.current(paths);
      },
    });
  }, [active]);

  const dropProps: DragDropProps = isMockBackend
    ? {
        onDragOver: (event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event) => {
          // Still inside the zone when leaving one child for another: do not blink the overlay.
          if (
            event.relatedTarget instanceof Element &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return;
          setDragging(false);
        },
        onDrop: (event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(false);
          const paths = Array.from(event.dataTransfer.files).map(
            (file) => `${MOCK_DROP_DIR}/${file.name}`,
          );
          filesRef.current(paths);
        },
      }
    : {};

  return { dragging, dropProps };
}
