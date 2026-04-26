'use client'

import { openConsentBanner } from './consent-banner'

export function ConsentLink({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openConsentBanner}
      className={className}
    >
      Cookie preferences
    </button>
  )
}
