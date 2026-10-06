/**
 * Marks the page with `keyboard-open` while the on-screen keyboard is up, so phone-only chrome such
 * as the bottom bar can step aside. Android resizes the app for the keyboard (adjustResize), so the
 * keyboard shows up as the window losing a large part of its usual height. Closing the keyboard
 * does not blur the text field on Android, so focus alone cannot tell.
 */
export function watchKeyboard(root: HTMLElement = document.documentElement): () => void {
  let fullHeight = window.innerHeight;
  let width = window.innerWidth;
  const update = () => {
    // A rotation changes the full height; start over from the new size.
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      fullHeight = window.innerHeight;
    }
    fullHeight = Math.max(fullHeight, window.innerHeight);
    root.classList.toggle('keyboard-open', window.innerHeight < fullHeight * 0.75);
  };
  window.addEventListener('resize', update);
  update();
  return () => window.removeEventListener('resize', update);
}
