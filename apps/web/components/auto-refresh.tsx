'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Re-reads the page from the server every few seconds while something on it is waiting for someone else: a renter
// waiting for an underwriter, for instance. It stops as soon as the page stops rendering it.
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
