import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';

const tag = '__reshapeFirestoreType';

export function encodeValue(value) {
  if (value instanceof Timestamp) return { [tag]: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { [tag]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { [tag]: 'reference', path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { [tag]: 'bytes', base64: Buffer.from(value).toString('base64') };
  if (value instanceof Date) return { [tag]: 'date', iso: value.toISOString() };
  if (typeof value === 'number' && !Number.isFinite(value)) return { [tag]: 'specialNumber', value: String(value) };
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.hasOwn(value, tag)) throw new Error(`Reserved field name ${tag} in Firestore data`);
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, encodeValue(item)]));
  }
  throw new Error(`Unsupported Firestore value type: ${value?.constructor?.name ?? typeof value}`);
}

export function decodeValue(value, db) {
  if (Array.isArray(value)) return value.map(item => decodeValue(item, db));
  if (value && typeof value === 'object') {
    switch (value[tag]) {
      case 'timestamp': return new Timestamp(value.seconds, value.nanoseconds);
      case 'geopoint': return new GeoPoint(value.latitude, value.longitude);
      case 'reference': return db.doc(value.path);
      case 'bytes': return Buffer.from(value.base64, 'base64');
      case 'date': return new Date(value.iso);
      case 'specialNumber': return Number(value.value);
      case undefined: return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item, db)]));
      default: throw new Error(`Unknown Firestore backup type: ${value[tag]}`);
    }
  }
  return value;
}

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
