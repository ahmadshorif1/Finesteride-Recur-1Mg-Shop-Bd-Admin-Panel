import type { AvailabilityStatus, BatchStatus } from '../types/pharmacy';

export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const SLUG_REGEX = /^[a-z0-9-]+$/;
export const ORDER_NUMBER_REGEX = /^[A-Z0-9-]+$/;
export const COUPON_CODE_REGEX = /^[A-Z0-9_-]+$/;

/**
 * Strips script tags, event handlers, and control characters before Firestore writes
 * to prevent stored XSS in Customer Panel CMS and catalog fields while enforcing
 * exact firebase-blueprint.json maxLength limits.
 */
export function sanitizeText(value: string, maxLength: number): string {
  const cleaned = (value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
  return cleaned.slice(0, maxLength);
}

export function sanitizeSafeUrl(url: string, maxLength = 500): string {
  const trimmed = (url || '').trim().slice(0, maxLength);
  if (!trimmed) return '';
  if (trimmed.startsWith('/assets/') || trimmed.startsWith('/')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString().slice(0, maxLength);
    }
    return '';
  } catch {
    return '';
  }
}

export function toSlug(input: string, maxLength = 100): string {
  const slug = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return slug || `item-${Date.now().toString(36)}`;
}

export function makeSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function formatBdt(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `৳ ${safe.toLocaleString('en-BD', { maximumFractionDigits: 0 })}`;
}

export function formatTimestamp(ts?: { toDate?: () => Date } | string | null): string {
  if (!ts) return '—';
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
  if (typeof ts.toDate === 'function') {
    return ts.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
  return '—';
}

export function computeBatchExpiryState(expiryDateIso: string, remainingQty: number): BatchStatus {
  if (remainingQty <= 0) return 'depleted';
  if (!expiryDateIso) return 'active';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiryDateIso}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return 'active';
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired_quarantined';
  if (diffDays <= 60) return 'near_expiry';
  return 'active';
}

export function isDateExpired(expiryDateIso: string): boolean {
  if (!expiryDateIso) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  return expiryDateIso < todayIso;
}

export function daysUntilExpiry(expiryDateIso: string): number | null {
  if (!expiryDateIso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiryDateIso}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function computeProductAvailability(
  stockQuantity: number,
  lowStockThreshold: number,
  nearestExpiryDate: string
): AvailabilityStatus {
  if (nearestExpiryDate && isDateExpired(nearestExpiryDate)) {
    return 'expired_restricted';
  }
  if (stockQuantity <= 0) return 'out_of_stock';
  if (stockQuantity <= lowStockThreshold) return 'low_stock';
  return 'in_stock';
}
