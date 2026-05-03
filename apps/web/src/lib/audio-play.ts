/**
 * Reduces clipped first syllables on some browsers/SDKs by letting the element
 * finish decoding/buffering before play().
 */
export async function loadAudioElementThenPlay(el: HTMLAudioElement, settleMs = 85): Promise<void> {
  el.load();
  await new Promise<void>((resolve) => {
    if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      resolve();
      return;
    }
    const timeoutMs = 900;
    const to = window.setTimeout(resolve, timeoutMs);
    const finish = (): void => {
      window.clearTimeout(to);
      el.removeEventListener("canplaythrough", finish);
      el.removeEventListener("loadeddata", finish);
      el.removeEventListener("error", finish);
      resolve();
    };
    el.addEventListener("canplaythrough", finish, { once: true });
    el.addEventListener("loadeddata", finish, { once: true });
    el.addEventListener("error", finish, { once: true });
  });
  await new Promise<void>((r) => window.setTimeout(r, settleMs));
  await el.play();
}
