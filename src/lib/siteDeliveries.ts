import type { Tone } from '@/components/record/Record'
import type { SdnStatus } from '@/types/database'

export const SDN_STATUS: Record<SdnStatus, { label: string; tone: Tone }> = {
  issued: { label: 'On its way', tone: 'violet' },
  exceptions: { label: 'Waiting for procurement', tone: 'amber' },
  received: { label: 'Received', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}
