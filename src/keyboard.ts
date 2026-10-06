/**
 * Marks the page with `keyboard-open` while the on-screen keyboard is up, so phone-only chrome such
 * as the bottom bar can step aside. The keyboard is up when a text field has focus and the visible
 * area is clearly shorter than it was before typing started. Focus alone is not enough (Android
 * keeps the field focused after the keyboard closes), and height alone is not enough (split-screen
 * and window resizes shrink it too), so both must hold.
 */
const EDITABLE =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"]';

export function watchKeyboard(root: HTMLElement = document.documentElement): () => void {
  const visibleHeight = () => Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity);
  const typing = () => document.activeElement instanceof Element && document.activeElement.matches(EDITABLE);
  // The height of the window without the keyboard. It follows every resize made while nobody is
  // typing, so split-screen, rotation and window changes become the new normal.
  let fullHeight = visibleHeight();
  const update = () => {
    const height = visibleHeight();
    // The keyboard only ever makes the window shorter, so a taller window is always the new normal,
    // even mid-typing (for example when focus lands before the resize event of leaving split screen).
    if (!typing() || height > fullHeight) fullHeight = height;
    root.classList.toggle('keyboard-open', typing() && height < fullHeight * 0.8);
  };
  // Focus moves before the keyboard opens; read the size again once it has settled.
  const onFocus = () => {
    update();
    setTimeout(update, 300);
  };
  // While focus moves from one field to the next, nothing is focused for a moment, and the
  // shortened window would be taken as the new normal. Wait until focus has landed.
  const onBlur = () => {
    setTimeout(update, 0);
    setTimeout(update, 300);
  };
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onBlur);
  update();
  return () => {
    window.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('resize', update);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onBlur);
  };
}
