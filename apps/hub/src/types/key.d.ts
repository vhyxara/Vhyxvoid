type UsageKey = string;

interface UsageEntry {
  apiKeyId: string;
  scope: string;
  endpoint: string;
  method: string;
  count: number;
}
