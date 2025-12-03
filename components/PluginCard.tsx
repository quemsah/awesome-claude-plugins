import { Plugin } from "@/app/types";
import Link from "next/link";

interface PluginCardProps {
  plugin: Plugin;
}

function StarIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
    </svg>
  );
}

export function PluginCard({ plugin }: PluginCardProps) {
  if (!plugin.repo_name) return null;
  
  return (
    <Link
      href={`/${plugin.repo_name.toLowerCase()}`}
      className="group block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate dark:text-white dark:group-hover:text-blue-400">
            {plugin.repo_name}
          </h3>
          <p className="text-sm text-gray-500 truncate dark:text-gray-400">
            by {plugin.owner}
          </p>
        </div>
      </div>
      
      {plugin.description && (
        <p className="mt-2 text-sm text-gray-600 line-clamp-2 dark:text-gray-300">
          {plugin.description}
        </p>
      )}
      
      <div className="mt-3 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <StarIcon />
          <span>{plugin.stargazers_count?.toLocaleString() ?? 0}</span>
        </div>
        <div className="flex items-center gap-1">
          <ForkIcon />
          <span>{plugin.forks_count?.toLocaleString() ?? 0}</span>
        </div>
      </div>
    </Link>
  );
}
