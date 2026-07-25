// src/services/geocoding.ts
// 地理编码服务：保存门店地址时把地址字符串转成经纬度（Google Geocoding API）。
//
// 设计要点：
// - 仅在客户端未显式提供经纬度、但有地址时调用。
// - 不阻塞保存：超时 / 失败 / 未配置 key 时返回 null，组织照常保存。
// - 使用 Node 内置 fetch（Node 18+），无需额外依赖。
// - 必须用服务端专用 key（GOOGLE_GEOCODING_API_KEY），不要复用前端浏览器 key。

import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const REQUEST_TIMEOUT_MS = 5000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * 把完整地址字符串地理编码为经纬度；失败返回 null（不抛错）。
 * @param address 单行完整地址，如 "123 Main St, Vancouver, BC V6G 1C7, Canada"
 */
export async function geocodeAddress(address?: string | null): Promise<Coordinates | null> {
  const trimmed = address?.trim();
  if (!trimmed) return null;

  const apiKey = env.googleGeocodingApiKey;
  if (!apiKey) {
    logger.warn('[Geocoding] 未配置 GOOGLE_GEOCODING_API_KEY，跳过地理编码');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${GEOCODING_URL}?address=${encodeURIComponent(trimmed)}&key=${apiKey}`;
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      logger.warn('[Geocoding] 请求失败', { status: response.status, address: trimmed });
      return null;
    }

    const data: any = await response.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      const loc = data.results[0].geometry?.location;
      if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        logger.info('[Geocoding] 成功', { address: trimmed, lat: loc.lat, lng: loc.lng });
        return { latitude: loc.lat, longitude: loc.lng };
      }
    }

    logger.warn('[Geocoding] 无有效结果', { address: trimmed, status: data.status });
    return null;
  } catch (error: any) {
    const reason = error?.name === 'AbortError' ? '超时' : error?.message;
    logger.warn('[Geocoding] 异常（降级为 null）', { address: trimmed, error: reason });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
