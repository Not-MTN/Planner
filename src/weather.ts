/**
 * Today's weather, from Open-Meteo — no API key, CORS-friendly, free for
 * personal use. Coordinates come from a city search (Open-Meteo geocoding) or
 * the browser's geolocation; results are cached for 30 minutes. Everything is
 * best-effort: the planner works exactly the same with weather off or offline.
 */
import { t } from './i18n';

export interface WeatherSettings {
  enabled: boolean;
  lat: number | null;
  lon: number | null;
  /** Friendly place label, e.g. "Helsinki, Finland". */
  place: string;
}

const SETTINGS_KEY = 'planner-weather';
const CACHE_KEY = 'planner-weather-cache';
const TTL_MS = 30 * 60 * 1000;

export const DEFAULT_WEATHER: WeatherSettings = { enabled: false, lat: null, lon: null, place: '' };

export function loadWeatherSettings(): WeatherSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<WeatherSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_WEATHER;
    return {
      enabled: raw.enabled === true,
      lat: typeof raw.lat === 'number' && Number.isFinite(raw.lat) && raw.lat >= -90 && raw.lat <= 90 ? raw.lat : null,
      lon: typeof raw.lon === 'number' && Number.isFinite(raw.lon) && raw.lon >= -180 && raw.lon <= 180 ? raw.lon : null,
      place: typeof raw.place === 'string' ? raw.place.slice(0, 80) : '',
    };
  } catch {
    return DEFAULT_WEATHER;
  }
}

export function saveWeatherSettings(settings: WeatherSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export interface WeatherNow {
  temp: number;
  feels: number;
  code: number;
  hi: number;
  lo: number;
  fetchedAt: string;
}

interface CacheEntry {
  key: string;
  at: number;
  data: WeatherNow;
}

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function readCache(lat: number, lon: number): WeatherNow | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as CacheEntry | null;
    if (!raw || raw.key !== cacheKey(lat, lon)) return null;
    if (Date.now() - raw.at > TTL_MS) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, data: WeatherNow): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey(lat, lon), at: Date.now(), data } satisfies CacheEntry));
  } catch {
    /* ignore */
  }
}

export async function fetchWeather(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<WeatherNow> {
  const cached = readCache(lat, lon);
  if (cached) return cached;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(t('Weather could not be loaded.'));
  const body = (await response.json()) as {
    current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const data: WeatherNow = {
    temp: Math.round(body.current?.temperature_2m ?? 0),
    feels: Math.round(body.current?.apparent_temperature ?? body.current?.temperature_2m ?? 0),
    code: body.current?.weather_code ?? 3,
    hi: Math.round(body.daily?.temperature_2m_max?.[0] ?? body.current?.temperature_2m ?? 0),
    lo: Math.round(body.daily?.temperature_2m_min?.[0] ?? body.current?.temperature_2m ?? 0),
    fetchedAt: new Date().toISOString(),
  };
  writeCache(lat, lon, data);
  return data;
}

export interface GeoHit {
  lat: number;
  lon: number;
  label: string;
}

export async function geocode(name: string, fetchImpl: typeof fetch = fetch): Promise<GeoHit | null> {
  const query = name.trim();
  if (!query) return null;
  const response = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    results?: Array<{ latitude: number; longitude: number; name: string; country?: string; admin1?: string }>;
  };
  const hit = body.results?.[0];
  if (!hit) return null;
  const label = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
  return { lat: hit.latitude, lon: hit.longitude, label: label.slice(0, 80) };
}

/** WMO weather-code → icon + short label. */
export function weatherInfo(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: t('Clear sky') };
  if (code === 1) return { icon: '🌤️', label: t('Mostly clear') };
  if (code === 2) return { icon: '⛅', label: t('Partly cloudy') };
  if (code === 3) return { icon: '☁️', label: t('Overcast') };
  if (code === 45 || code === 48) return { icon: '🌫️', label: t('Fog') };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: t('Drizzle') };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: t('Rain') };
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: t('Snow') };
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: t('Showers') };
  if (code === 85 || code === 86) return { icon: '🌨️', label: t('Snow showers') };
  if (code >= 95) return { icon: '⛈️', label: t('Thunderstorm') };
  return { icon: '☁️', label: t('Cloudy') };
}
