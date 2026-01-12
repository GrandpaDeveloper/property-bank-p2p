import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

const QR_PREFIX = "PB1:"; // Property Bank v1

export function encodeQR(obj: unknown): string {
  const json = JSON.stringify(obj);
  const packed = compressToEncodedURIComponent(json);
  return `${QR_PREFIX}${packed}`;
}

export function decodeQR<T>(text: string): T {
  const raw = text.startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
  const json = decompressFromEncodedURIComponent(raw);
  if (!json) throw new Error("QR inválido / no compatible");
  return JSON.parse(json) as T;
}
