import { customAlphabet } from 'nanoid';

// Excludes visually ambiguous characters (0/O, 1/I) so a kid can read a code
// off the big screen and type it correctly on their own phone.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generate = customAlphabet(alphabet, 5);

export function generateGameCode(): string {
  return generate();
}
