"use client";

import { Modal } from "./Modal";

const KEYS: [string, string][] = [
  ["C", "Comment: click to pin, drag to draw a box"],
  ["Esc", "Cancel the pin you're placing"],
  ["Space or K", "Play or pause"],
  ["L / J", "Play faster / jump back a second"],
  [", and .", "Back or forward one frame"],
  ["O", "Set the out point of a range"],
  ["+ / −", "Zoom in or out (images)"],
  ["0", "Fit the picture to the screen"],
  ["?", "Show this list"],
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13.5px]">
        {KEYS.map(([k, what]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="num rounded-md border border-room-line bg-room-raised px-2 py-0.5 text-[12px]">{k}</kbd>
            </dt>
            <dd className="text-room-fg-2">{what}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-room-line px-4 text-[13.5px]">
          Close
        </button>
      </div>
    </Modal>
  );
}
