import pluginsData from "@/data/plugins.json" with { type: "json" };
import { Plugin } from "../../../types.ts";

type RouteParams = { params: Promise<{ plugin: string }> };

export const GET = async (_request: Request, { params }: RouteParams) => {
  const { plugin } = await params;

  if (!plugin) {
    return Response.json({ error: "No plugin name provided." }, { status: 400 });
  }

  // Extract the plugin data from the json structure
  const plugins: Plugin[] = pluginsData.map((item: { json: Plugin }) => item.json);
  
  // Find plugin by repo_name (case-insensitive)
  const pluginData = plugins.find((item) =>
    item.repo_name?.toLowerCase() === plugin.toLowerCase()
  );

  if (!pluginData) {
    return Response.json({ error: "Plugin not found." }, { status: 404 });
  }

  return Response.json(pluginData);
};
