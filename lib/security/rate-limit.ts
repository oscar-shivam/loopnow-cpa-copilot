import { DomainError } from "@/lib/errors/domain-error";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const entries = new Map<string, RateLimitEntry>();
const maximumTrackedKeys = 10_000;

function pruneExpiredEntries(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key);
  }
}

function evictOldestEntry(): void {
  const oldestKey = entries.keys().next().value;
  if (oldestKey) entries.delete(oldestKey);
}

export function enforceRateLimit(key: string, limit = 12, windowMs = 60_000): void {
  const now = Date.now();
  pruneExpiredEntries(now);
  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && entries.size >= maximumTrackedKeys) evictOldestEntry();
    entries.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    throw new DomainError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  }
  current.count += 1;
}

export function resetRateLimitStateForTest(): void {
  entries.clear();
}
