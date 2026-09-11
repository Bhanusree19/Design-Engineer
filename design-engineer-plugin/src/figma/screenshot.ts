// The Figma plugin sandbox has no `btoa`/`Buffer`, so we hand-roll a
// Uint8Array -> base64 encoder to send the PNG bytes to the UI/backend as a string.

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;

    base64 += BASE64_CHARS[(triplet >> 18) & 0x3f];
    base64 += BASE64_CHARS[(triplet >> 12) & 0x3f];
    base64 += i + 1 < len ? BASE64_CHARS[(triplet >> 6) & 0x3f] : '=';
    base64 += i + 2 < len ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return base64;
}

export async function exportNodeAsPngBase64(node: SceneNode): Promise<string> {
  const bytes = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: 0.25 },
  });
  return uint8ArrayToBase64(bytes);
}
