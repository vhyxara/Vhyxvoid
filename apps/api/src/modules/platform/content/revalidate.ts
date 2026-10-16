// Tells the website to drop its cached copy of CMS content (pages, footer,
// site settings) as soon as an admin changes it, instead of waiting for the
// 60-second cache. apps/web: app/api/revalidate/route.ts. Off when either
// variable is unset; the website then catches up within a minute.
//
//   WEB_REVALIDATE_URL     e.g. http://web:3000/api/revalidate
//   WEB_REVALIDATE_SECRET  shared with the website (REVALIDATE_SECRET there)
export function notifyWebsite(reason: string): void {
  const url = process.env.WEB_REVALIDATE_URL;
  const secret = process.env.WEB_REVALIDATE_SECRET;
  if (!url || !secret) return;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-revalidate-secret": secret },
    body: JSON.stringify({ tags: ["cms"] }),
    signal: AbortSignal.timeout(3000),
  })
    .then((res) => {
      if (!res.ok) console.warn(`[content] website revalidation after ${reason} answered ${res.status}`);
    })
    .catch((err: Error) => console.warn(`[content] website revalidation after ${reason} failed: ${err.message}`));
}
