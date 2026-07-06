/**
 * Deteccion de links de Google Maps en texto del cliente.
 *
 * Espejo de `Back/shared/src/utils/google-maps-url.ts`. El agente es un
 * deployment independiente (no puede depender de `../Back/shared` porque ese
 * path no existe al desplegar), asi que la copia vive aqui; si cambia el shared
 * del Back, actualizar tambien esta.
 */

const GOOGLE_MAPS_URL_REGEX =
  /^https?:\/\/(?:maps\.app\.goo\.gl\/[^\s]+|(?:www\.)?google\.com\/maps\/[^\s]+|maps\.google\.com\/[^\s]+)/i;

export function isValidGoogleMapsUrl(value: string | null | undefined): boolean {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  return GOOGLE_MAPS_URL_REGEX.test(trimmed);
}

export function extractGoogleMapsUrls(text: string): string[] {
  const matches = text.match(
    /https?:\/\/(?:maps\.app\.goo\.gl\/[a-zA-Z0-9]+|(?:www\.)?google\.com\/maps\/[^\s]+|maps\.google\.com\/[^\s]+)/gi,
  );
  return matches ? [...new Set(matches)] : [];
}
