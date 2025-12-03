"use client";

import { useEffect, useState } from "react";
import { Plugin } from "./types";
import { PluginCard } from "@/components/PluginCard";

export default function Home() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`/api/plugins`);
        const allPlugins = await response.json() as Plugin[];
        setPlugins(allPlugins);
      } catch (error) {
        console.error("Failed to fetch plugins:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-2 text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
            Awesome Claude Plugins
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Discover and explore Claude Code plugins from the community
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {plugins.length} plugins available
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {plugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
