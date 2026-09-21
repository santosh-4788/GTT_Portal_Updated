/**
 * Saving a downloaded file on Android.
 *
 * Loaded only from the Android build, and only at the moment something is
 * actually downloaded — the website never pulls these plugins into its bundle.
 *
 * The file is written to the app's own cache directory rather than to shared
 * storage. That needs no runtime permission on any Android version, and the
 * share sheet that follows is what gives the user the real choice: open the
 * invoice in a PDF viewer, save it to Downloads, or send it straight to the
 * vendor on WhatsApp or email. Writing to Downloads directly would need
 * storage permissions and would still not offer to send it anywhere.
 */
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** FileReader gives back a data: URL; the plugin wants only the payload. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the downloaded file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Two files downloaded in the same second must not overwrite each other. */
function uniqueName(name: string): string {
  const stamp = Date.now().toString(36);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}-${stamp}`;
  return `${name.slice(0, dot)}-${stamp}${name.slice(dot)}`;
}

export async function saveAndOpen(blob: Blob, filename: string): Promise<void> {
  const data = await blobToBase64(blob);
  const path = uniqueName(filename);

  const written = await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
  });

  try {
    await Share.share({
      title: filename,
      files: [written.uri],
    });
  } catch (err: any) {
    // Dismissing the share sheet rejects. That is a choice, not a failure, and
    // the file is already on disk either way — so it must not surface as an
    // error toast saying the download did not work.
    const message = String(err?.message ?? '').toLowerCase();
    if (message.includes('cancel') || message.includes('abort') || message.includes('dismiss')) return;
    throw new Error(`Saved to the app's files, but could not open it: ${err?.message ?? 'unknown error'}`);
  }
}
