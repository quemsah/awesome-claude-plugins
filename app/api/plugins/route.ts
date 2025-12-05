import { NextResponse } from "next/server";
import pluginsData from "@/data/plugins.json" with { type: "json" };
import { Plugin } from "../../types.ts";

export async function GET() {
  // Extract the plugin data from the json structure
  const plugins: Plugin[] = pluginsData.map((item: { json: Plugin }) => item.json);
  
  // Filter out plugins with null repo_name and sort by stars
  const validPlugins = plugins
    .filter((plugin) => plugin.repo_name !== null)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
  
  return NextResponse.json(validPlugins);
}
