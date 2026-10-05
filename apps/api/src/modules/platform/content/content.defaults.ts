// Content the site shows before an admin publishes their own version of an
// entry. Also the starting point when an admin creates one of these entries.
import type { ContentKind } from "./content.schemas";

export type DefaultEntry = { slug: string; kind: ContentKind; title: string; seoDescription?: string; data: unknown };

const home = {
  hero: {
    eyebrow: "Tunnels for full-stack teams",
    title: "Your localhost, on the internet. Instantly.",
    subtitle:
      "Share a local backend at a stable HTTPS URL with one line in your server or one command in your terminal. Webhooks, mobile devices and teammates reach your machine without deploys, port forwarding or config.",
    primaryCta: { label: "Start for free", href: "/register" },
    secondaryCta: { label: "Read the docs", href: "/docs" },
    terminal: [
      "$ npx @vhyxvoid/agent --port 3000 --label api",
      "✅  Tunnel active",
      "  Public: https://acme-7f3k2q9a--api.vhyxvoid.com",
      "  Local:  http://localhost:3000",
    ],
  },
  stats: [
    { value: "< 50 ms", label: "typical added latency" },
    { value: "1 line", label: "to embed in Express, Fastify or Next.js" },
    { value: "10 MB", label: "request bodies, streamed responses" },
  ],
  features: {
    title: "Everything a dev tunnel should be",
    subtitle: "Built for the way teams actually develop: many services, many people, one domain.",
    items: [
      { icon: "zap", title: "Zero-config framework integrations", body: "Wrap your Next.js config or add Express/Fastify middleware and the tunnel starts with your dev server. No second process to remember." },
      { icon: "link", title: "Stable URLs per service", body: "Every label gets its own predictable HTTPS hostname, so webhook settings and OAuth redirect URIs survive restarts." },
      { icon: "radio", title: "WebSockets and streaming", body: "Server-Sent Events, chunked responses and WebSocket upgrades pass through, so HMR, live dashboards and AI streaming work." },
      { icon: "shield", title: "Secure by default", body: "Signed requests, replay protection, per-key scopes, revocation that disconnects live agents within a minute, and your backend's own cookies and CORS untouched." },
      { icon: "users", title: "Built for teams", body: "Organizations, roles and invitations. Remove a member and their keys are revoked automatically." },
      { icon: "gauge", title: "Usage you can see", body: "Requests per tunnel and per key, connection history and plan limits in one dashboard." },
    ],
  },
  steps: {
    title: "Live in under a minute",
    items: [
      { title: "Create a free account", body: "Sign up and create an API key with the tunnel:connect scope.", code: "" },
      { title: "Start a tunnel", body: "Run the agent next to your server, or embed it in your app.", code: "npx @vhyxvoid/agent init" },
      { title: "Share the URL", body: "Point webhooks, phones and teammates at your stable HTTPS address.", code: "curl https://acme-7f3k2q9a--api.vhyxvoid.com/health" },
    ],
  },
  diagram: {
    title: "How a request reaches your laptop",
    subtitle: "The agent keeps one outbound connection open. Nothing on your machine listens to the internet.",
    source: [
      "flowchart LR",
      "  caller([Webhook / browser]) --> hub[VhyxVoid hub] --> agent[Agent on your machine] --> app[(localhost:3000)]",
      "",
      "scenario A webhook arrives",
      "  caller -> hub : POST /webhooks/stripe",
      "  hub is active",
      "  hub -> agent : forward over WebSocket",
      "  agent -> app : POST /webhooks/stripe",
      "  app is done",
      "  app -> agent : 200 OK",
      "  agent -> hub : response",
      "  hub -> caller : 200 OK",
      "  hub is done",
    ].join("\n"),
  },
  useCases: {
    title: "What teams use it for",
    items: [
      { title: "Webhook development", body: "Receive Stripe, GitHub and Slack webhooks on your laptop and debug them with breakpoints." },
      { title: "Mobile and device testing", body: "Point a phone or a tablet at your local API over HTTPS." },
      { title: "Demos and reviews", body: "Share a work-in-progress build with a client or a teammate without deploying." },
    ],
  },
  faq: {
    title: "Questions, answered",
    items: [
      { q: "Is my local backend exposed to the whole internet?", a: "Only through the tunnel URL you start, and only while the agent runs. Tunnel hostnames carry a random component, and you can revoke a key to disconnect every agent using it within a minute." },
      { q: "Which frameworks are supported?", a: "Anything that speaks HTTP via the standalone agent. Express, Fastify and Next.js also have zero-config integrations." },
      { q: "Do WebSockets work?", a: "Yes. WebSocket upgrades, Server-Sent Events and chunked responses are relayed through the tunnel." },
      { q: "Can I use it for free?", a: "Yes. The Free plan includes one agent and enough requests for everyday development. Upgrade when your team needs more." },
    ],
  },
  cta: {
    title: "Ship faster from localhost",
    subtitle: "Free forever for individual developers. No credit card required.",
    primaryCta: { label: "Create your free account", href: "/register" },
  },
};

const pricing = {
  title: "Simple pricing that scales with your team",
  subtitle: "Start free. Upgrade when you need more tunnels, teammates and production keys.",
  plans: [
    { plan: "FREE", name: "Free", price: "$0", period: "forever", description: "For individual developers.", highlighted: false, ctaLabel: "Start for free", ctaHref: "/register", features: ["1 concurrent agent", "10,000 requests / month", "3 API keys", "Community support"] },
    { plan: "PRO", name: "Pro", price: "$12", period: "per month", description: "For professionals and small teams.", highlighted: true, ctaLabel: "Start free trial", ctaHref: "/register?plan=pro", features: ["5 concurrent agents", "50,000 requests / month", "Up to 10 members", "Production keys and key rotation", "Priority support"] },
    { plan: "ENTERPRISE", name: "Enterprise", price: "Custom", period: "", description: "For organizations with scale and compliance needs.", highlighted: false, ctaLabel: "Contact sales", ctaHref: "/support", features: ["Unlimited agents and members", "Unlimited requests", "Custom limits", "Dedicated support"] },
  ],
  faq: [
    { q: "What counts as a request?", a: "Every HTTP request that reaches your agent through a tunnel or the SDK. Monthly totals are shown in the dashboard." },
    { q: "Can I cancel any time?", a: "Yes. Manage or cancel your subscription from Billing; you keep your plan until the end of the period." },
    { q: "What happens if a payment fails?", a: "Your tunnels keep running during a 7-day grace period while you update your payment method." },
  ],
};

const legal = (title: string, intro: string) => ({
  body: `# ${title}\n\n_Last updated: ${new Date().getFullYear()}_\n\n${intro}\n\nThis page is a placeholder published by default. An administrator can replace it from **Admin → Content**.\n`,
  showInFooter: true,
  footerGroup: "legal" as const,
});

export const DEFAULT_CONTENT: DefaultEntry[] = [
  { slug: "home", kind: "landing", title: "Home", seoDescription: "Expose your local server at a stable HTTPS URL in seconds.", data: home },
  { slug: "pricing", kind: "pricing", title: "Pricing", seoDescription: "Plans for individual developers and teams.", data: pricing },
  { slug: "terms", kind: "page", title: "Terms of Service", data: legal("Terms of Service", "These terms govern your use of the service.") },
  { slug: "privacy", kind: "page", title: "Privacy Policy", data: legal("Privacy Policy", "This policy explains what data we collect and why.") },
];

export function defaultEntry(slug: string): DefaultEntry | undefined {
  return DEFAULT_CONTENT.find((e) => e.slug === slug);
}
