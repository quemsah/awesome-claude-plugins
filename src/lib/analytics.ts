import process from 'node:process'

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-XXXXXXXXXX'
export const isAnalyticsEnabled = (): boolean => process.env.NODE_ENV === 'production' && GA_ID !== 'G-XXXXXXXXXX'
