import type { ComponentType, ElementType } from 'react'
import type { Staff, UserRole } from '@/types/database'

export type WidgetSize = 'half' | 'full'

/** One widget on a person's dashboard, in order (dashboard_layouts.widgets). */
export interface LayoutItem {
  key: string
  size: WidgetSize
  /** Pinned pages widget: the paths the person picked. */
  pages?: string[]
}

/** Who is looking: what the widgets filter by, and what decides the defaults. */
export interface WidgetContext {
  userId: string
  role: UserRole | null
  staff: Staff | null
  staffId: string | null
  department: string | null
  /** Named project manager on at least one project, whatever the role. */
  managesProjects: boolean
  /** Site foreman with at least one active project assignment. */
  isSiteForeman: boolean
  isVrfManager: boolean
  isLogisticsOfficer: boolean
}

export type WidgetGroup = 'For you' | 'Finance' | 'Projects & operations' | 'Procurement & stock' | 'People' | 'Sales & design'

export interface WidgetProps {
  ctx: WidgetContext
  item: LayoutItem
  /** Change this widget's own settings (saved with the layout). */
  onItemChange: (item: LayoutItem) => void
}

export interface WidgetDef {
  key: string
  title: string
  description: string
  icon: ElementType
  group: WidgetGroup
  defaultSize: WidgetSize
  /** Offered in "Add widget" to this person (the data is still limited by RLS). */
  available: (ctx: WidgetContext) => boolean
  component: ComponentType<WidgetProps>
}
