"use client";

import { useEffect, useState, use } from "react";
import { Plugin } from "../types";
import Link from "next/link";
import { StarIcon, ForkIcon, EyeIcon, ExternalLinkIcon } from "@/components/Icons";

type RouteParams = { params: Promise<{ plugin: string }> };



export default function PluginPage({ params }: RouteParams) {
  const resolvedParams = use(params);
  const [plugin, setPlugin] = useState<Plugin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`/api/plugins/${resolvedParams.plugin}`);
        if (!resp.ok) {
          setError("Plugin not found");
          return;
        }
        const data = await resp.json() as Plugin;
        setPlugin(data);
      } catch {
        setError("Failed to load plugin");
      } finally {
        setLoading(false);
      }
    })();
  }, [resolvedParams.plugin]);

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </main>
    );
  }

  if (error || !plugin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {error || "Plugin not found"}
          </h1>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            ← Back to all plugins
          </Link>
        </div>
      </main>
    );
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-6"
        >
          ← Back to all plugins
        </Link>

        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                {plugin.repo_name}
              </h1>
              <a
                href={plugin.owner_url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
              >
                by {plugin.owner}
              </a>
            </div>
            <a
              href={plugin.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors"
            >
              <ExternalLinkIcon />
              View on GitHub
            </a>
          </div>

          {plugin.description && (
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-6">
              {plugin.description}
            </p>
          )}

          <div className="flex flex-wrap gap-6 mb-6">
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <StarIcon />
              <span className="font-semibold">{plugin.stargazers_count?.toLocaleString() ?? 0}</span>
              <span>stars</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <ForkIcon />
              <span className="font-semibold">{plugin.forks_count?.toLocaleString() ?? 0}</span>
              <span>forks</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <EyeIcon />
              <span className="font-semibold">{plugin.subscribers_count?.toLocaleString() ?? 0}</span>
              <span>watchers</span>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Updated</dt>
                <dd className="text-gray-900 dark:text-white">{formatDate(plugin.repo_updated)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Added to Catalog</dt>
                <dd className="text-gray-900 dark:text-white">{formatDate(plugin.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </main>
  );
}
