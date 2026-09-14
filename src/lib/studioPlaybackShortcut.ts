/** Leave typing, native controls and already-handled timeline keys alone. */
export function shouldToggleStudioPlayback(event: KeyboardEvent): boolean {
  if (event.key !== " " || event.repeat || event.isComposing || event.defaultPrevented
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return !target.closest('input,textarea,select,button,a,summary,video,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="dialog"],[role="menu"],[role="tab"],[role="checkbox"],[role="switch"]');
}
