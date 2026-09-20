export function shouldLoadAnalytics(railwayEnvironmentName: string | undefined): boolean {
  return railwayEnvironmentName === 'production'
}
