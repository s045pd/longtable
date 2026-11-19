// Short random ids. Boards get 10 characters (unguessable enough to share by
// link); items get 12 so two people creating at once never collide.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function randomId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const newBoardId = () => randomId(10);
export const BOARD_ID = /^[a-z0-9]{10}$/;
