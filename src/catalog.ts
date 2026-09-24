import { KEY_CATALOG, KEY_TYPES } from './config';
import type { KeyType } from './types';

// Yubico's physical-attributes manual groups these models into the same forms.
// Body-pocket profiles remain distinct from shared USB-C connector sockets.
export const MATCHING_MODELS: Record<KeyType, string[]> = {
  A: ['Security Key NFC', 'YubiKey 5 NFC FIPS'],
  C: ['Security Key C NFC', 'YubiKey 5C NFC FIPS'],
  AN: ['YubiKey 5 Nano FIPS'],
  CN: ['YubiKey 5C Nano FIPS'],
  CK: ['YubiKey 5C FIPS'],
  CI: ['YubiKey 5Ci FIPS'],
};
export function searchKeys(query: string): KeyType[] {
  const words = query.toLowerCase().replace(/usb[- ]?/g, 'usb').split(/\s+/).filter(Boolean);
  return KEY_TYPES.filter(type => {
    const key = KEY_CATALOG[type];
    const text = [key.name, key.connector, ...MATCHING_MODELS[type]].join(' ').toLowerCase().replace(/usb[- ]?/g, 'usb');
    return words.every(word => word.length === 1 ? text.split(/[^a-z0-9]+/).includes(word) : text.includes(word));
  });
}
