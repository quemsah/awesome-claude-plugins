'use client'

import * as React from 'react'
import { ResponsiveContainer } from 'recharts'

import { cn } from '../../lib/utils.ts'

type ChartTooltipPayload = {
  name?: string
  value?: number | string
  color?: string
}

const Chart = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div className={cn('', className)} ref={ref} {...props} />
))
Chart.displayName = 'Chart'

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof ResponsiveContainer> & {
    config?: Record<string, unknown>
    children: React.ComponentProps<typeof ResponsiveContainer>['children']
  }
>(({ className, children, ...props }, ref) => (
  <div className={cn('w-full text-xs', className)} ref={ref}>
    <ResponsiveContainer height="100%" width="100%" {...props}>
      {children}
    </ResponsiveContainer>
  </div>
))
ChartContainer.displayName = 'ChartContainer'

const ChartTooltip = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div className={cn('rounded-lg border bg-background p-2 shadow-md', className)} ref={ref} {...props} />
))
ChartTooltip.displayName = 'ChartTooltip'

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    active?: boolean
    payload?: ChartTooltipPayload[]
    label?: string
    accessibilityLayer?: unknown
    allowEscapeViewBox?: unknown
    animationDuration?: unknown
    animationEasing?: unknown
    contentStyle?: unknown
    cursor?: unknown
    cursorStyle?: unknown
    filterNull?: unknown
    isAnimationActive?: unknown
    itemStyle?: unknown
    labelStyle?: unknown
    reverseDirection?: unknown
    useTranslate3d?: unknown
    wrapperStyle?: unknown
    axisId?: unknown
    itemSorter?: unknown
    activeIndex?: unknown
  }
>(
  (
    {
      className,
      active,
      payload,
      label,
      accessibilityLayer: _accessibilityLayer,
      allowEscapeViewBox: _allowEscapeViewBox,
      animationDuration: _animationDuration,
      animationEasing: _animationEasing,
      contentStyle: _contentStyle,
      cursor: _cursor,
      cursorStyle: _cursorStyle,
      filterNull: _filterNull,
      isAnimationActive: _isAnimationActive,
      itemStyle: _itemStyle,
      labelStyle: _labelStyle,
      reverseDirection: _reverseDirection,
      useTranslate3d: _useTranslate3d,
      wrapperStyle: _wrapperStyle,
      axisId: _axisId,
      itemSorter: _itemSorter,
      activeIndex: _activeIndex,
      ...props
    },
    ref
  ) => {
    if (active && payload && payload.length) {
      return (
        <div className={cn('grid gap-2', className)} ref={ref} {...props}>
          {!!label && <p className="font-medium">{label}</p>}
          {payload.map((entry, index) => (
            <p className="text-sm" key={`tooltip-entry-${entry.name}-${index}`}>
              <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      )
    }

    return null
  }
)
ChartTooltipContent.displayName = 'ChartTooltipContent'

export { Chart, ChartContainer, ChartTooltip, ChartTooltipContent }
