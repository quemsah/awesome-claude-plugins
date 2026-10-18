export declare const GITHUB_SEGMENT_PATTERN: RegExp
export declare function isGitHubSegment(value: string): boolean
export declare function isValidGitHubOwner(value: string): boolean
export declare function isValidGitHubPathSegment(value: string): boolean
export declare function isValidGitHubRepositoryName(value: string): boolean
export declare function parseGitHubRepository(value: string | undefined): [string, string] | undefined
export declare function parseGitHubOwnerUrl(value: string): string | undefined
export declare function parseGitHubRepositoryUrl(value: string): { owner: string; repo: string } | undefined
export declare function isValidGitBranch(branch: string): boolean
export declare function isValidGitSha(value: unknown): value is string
export declare function getGitHubOwnerUrl(owner: string): string
export declare function getGitHubRepoUrl(owner: string, repoName: string): string
export declare function getGitHubRepoPath(owner: string, repoName: string): string
export declare function encodeGitHubPath(value: string): string
export declare function getGitHubBlobUrl(repoPath: string, ref: string, path: string): string
