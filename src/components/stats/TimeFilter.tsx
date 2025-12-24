'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx'

export function TimeFilter({ onTimeRangeChange }: { onTimeRangeChange: (range: string) => void }) {
  const [timeRange, setTimeRange] = useState('all')

  const handleTimeRangeChange = (value: string) => {
    setTimeRange(value)
    onTimeRangeChange(value)
  }

  return (
    <div className="flex items-center gap-4">
      <span className="font-medium text-sm">Time Range:</span>
      <Select onValueChange={handleTimeRangeChange} value={timeRange}>
        <SelectTrigger className="w-[180px]">
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
