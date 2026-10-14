import React, { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';

const shortcuts = [
  ['Select objects', 'V'],
  ['Hand / pan tool', 'H'],
  ['Temporary pan', 'Space + drag'],
  ['Pan with any tool', 'Middle / right drag'],
  ['Scroll board', 'Scroll / trackpad'],
  ['Scroll horizontally', 'Shift + scroll'],
  ['Zoom at pointer', 'Alt / Ctrl / ⌘ + scroll'],
  ['Zoom in / out', '+ / −'],
  ['Fit board to viewport', '0'],
  ['Place token', 'T'],
  ['Draw', 'D'],
  ['Measure distance', 'M'],
  ['Lighting / reveal', 'L'],
  ['Hide area with reveal tool', 'Right drag'],
  ['Add / subtract selection', 'Shift / Alt + drag'],
  ['Move selected objects', 'Arrow keys'],
  ['Copy / paste', 'Ctrl / ⌘ + C / V'],
  ['Duplicate selection', 'Ctrl / ⌘ + D'],
  ['Delete selection', 'Delete / Backspace'],
  ['Undo / redo', 'Ctrl / ⌘ + Z / Shift + Z'],
  ['Show / hide sidebar', 'B'],
  ['Keyboard shortcuts', '?'],
  ['Cancel / deselect', 'Escape'],
];

export function KeyboardShortcutsDialog({ onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget && event.clientX !== 0 && event.clientY !== 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      } }}
    >
      <div className="shortcuts-header">
        <h2 id="shortcuts-title"><Keyboard size={20} /> Keyboard shortcuts</h2>
        <button type="button" className="command" aria-label="Close keyboard shortcuts" onClick={onClose} autoFocus><X size={18} /></button>
      </div>
      <p className="empty-note">Board navigation keys work while the board is focused. Click the board to return to it.</p>
      <dl className="shortcut-list">
        {shortcuts.map(([label, keys]) => (
          <div className="shortcut-row" key={label}>
            <dt>{label}</dt>
            <dd><kbd>{keys}</kbd></dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
