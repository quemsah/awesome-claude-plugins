/** Browser-facing: the repository page hands this to the client, so it must be a public origin. */
export const GITHUB_API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com'
export const GITHUB_RAW_URL = process.env.GITHUB_RAW_URL ?? 'https://raw.githubusercontent.com'
