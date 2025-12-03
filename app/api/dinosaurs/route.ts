import data from "../data.json" with { type: "json" };

export function GET() {
    return Response.json(data);
}
