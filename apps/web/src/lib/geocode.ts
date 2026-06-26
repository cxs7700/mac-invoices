// Address autocomplete via Photon (https://photon.komoot.io) — a free,
// no-key, no-signup geocoder backed by OpenStreetMap data (ODbL; attribution
// shown in the UI). Properties are US-only, so results are filtered to the US.
//
// This module is the single seam for the provider: to move to a keyed free tier
// later (e.g. Geoapify / LocationIQ), only `searchAddresses` needs to change —
// the `AddressSuggestion` shape and callers stay the same.

const PHOTON_URL = 'https://photon.komoot.io/api/'

export interface AddressSuggestion {
  /** Stable key for React lists. */
  id: string
  /** First line, e.g. "123 Main St". */
  primary: string
  /** Locality line, e.g. "Springfield, IL 62704". */
  secondary: string
  /** Full single-line address persisted to the property's `address` field. */
  value: string
}

interface PhotonProperties {
  osm_id?: number
  osm_type?: string
  name?: string
  housenumber?: string
  street?: string
  city?: string
  district?: string
  state?: string
  postcode?: string
  countrycode?: string
}

function toSuggestion(p: PhotonProperties): AddressSuggestion | null {
  // US-only app: drop anything Photon returns from elsewhere.
  if (p.countrycode !== 'US') return null

  const primary = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || ''
  if (!primary) return null

  const cityState = [p.city ?? p.district, p.state].filter(Boolean).join(', ')
  const secondary = [cityState, p.postcode].filter(Boolean).join(' ').trim()
  const value = [primary, secondary].filter(Boolean).join(', ')

  return {
    id: `${p.osm_type ?? ''}${p.osm_id ?? value}`,
    primary,
    secondary,
    value,
  }
}

/**
 * Look up address suggestions for `query`. Returns up to 5 de-duplicated US
 * matches. Pass an AbortSignal to cancel a stale in-flight request.
 */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=10&lang=en`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`)

  const json = (await res.json()) as { features?: { properties: PhotonProperties }[] }

  const seen = new Set<string>()
  const out: AddressSuggestion[] = []
  for (const feature of json.features ?? []) {
    const suggestion = toSuggestion(feature.properties)
    if (suggestion && !seen.has(suggestion.value)) {
      seen.add(suggestion.value)
      out.push(suggestion)
    }
    if (out.length >= 5) break
  }
  return out
}
