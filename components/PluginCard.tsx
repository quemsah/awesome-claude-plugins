import { Plugin } from "@/app/types";
import Link from "next/link";
import { StarIcon, ForkIcon } from "./Icons";

interface PluginCardProps {
  plugin: Plugin;
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
