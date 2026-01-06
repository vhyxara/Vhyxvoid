export interface HubRequestEnvelope {
  type: "request";
  requestId: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | null; // BASE64 ONLY
  meta: {
    frontendKey: string;
    ts: number;
    signature: string;
  };
}
