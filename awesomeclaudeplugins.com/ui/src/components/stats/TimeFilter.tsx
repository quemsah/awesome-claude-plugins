'use client'

import { trackEvent } from '../../lib/analytics.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx'

export function TimeFilter({ value, onTimeRangeChange }: { value: string; onTimeRangeChange: (range: string) => void }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm font-medium">Time Range:</span>
      <Select
        onValueChange={(range: string) => {
          trackEvent('filter_change', { filter: range })
          onTimeRangeChange(range)
        }}
        value={value}
      >
        <SelectTrigger aria-label="Time range" className="w-44">
          <SelectValue placeholder="Select time range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7days">Last 7 days</SelectItem>
          <SelectItem value="30days">Last 30 days</SelectItem>
          <SelectItem value="all">All time</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
