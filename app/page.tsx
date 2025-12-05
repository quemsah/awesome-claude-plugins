"use client";

import { useEffect, useState } from "react";
import { Plugin } from "./types.ts";
import { PluginCard } from "../components/PluginCard.tsx";
import { Card, CardContent, CardHeader } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";

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

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="space-y-2 text-center mb-8">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Awesome Claude Plugins
            </h1>
            <p className="text-muted-foreground">
              Discover and explore Claude Code plugins from the community
            </p>
          </div>
          
          <Separator className="mb-8" />
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="h-full">
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-2/3 mb-4" />
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-6 w-12" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-2 text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Awesome Claude Plugins
          </h1>
          <p className="text-muted-foreground">
            Discover and explore Claude Code plugins from the community
          </p>
          <p className="text-sm text-muted-foreground">
            {plugins.length} plugins available
          </p>
        </div>

        <Separator className="mb-8" />

        {plugins.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <p className="text-muted-foreground">No plugins found</p>
            </CardContent>
          </Card>
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
