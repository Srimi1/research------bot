/**
 * The Android back gesture closes the newest open layer (a dialog, the project drawer) before
 * leaving the app. Layers register while they are open; desktop and the browser never call back().
 */
const layers: (() => void)[] = [];

export function onBack(close: () => void): () => void {
  layers.push(close);
  return () => {
    const index = layers.lastIndexOf(close);
    if (index !== -1) layers.splice(index, 1);
  };
}

/** Close the newest layer. Returns false when nothing was open. */
export function back(): boolean {
  const close = layers.at(-1);
  if (!close) return false;
  close();
  return true;
}
