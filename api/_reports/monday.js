// Read-only monday helper shared by the reports.

export const mondayToken = () => process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN || "";

export async function monday(token, query) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}
