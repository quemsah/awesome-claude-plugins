'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx'

export function TimeFilter({ value, onTimeRangeChange }: { value: string; onTimeRangeChange: (range: string) => void }) {
  return (
    <div className="flex items-center gap-4">
      <span className="font-medium text-sm">Time Range:</span>
      <Select onValueChange={onTimeRangeChange} value={value}>
        <SelectTrigger className="w-44">
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
