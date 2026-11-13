'use client';

import type { ReactNode } from 'react';
import { TadsWidgetProvider } from 'react-tads-widget';

export function TadsProvider({ children }: { children: ReactNode }) {
  return <TadsWidgetProvider>{children}</TadsWidgetProvider>;
}
