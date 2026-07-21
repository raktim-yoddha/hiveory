/**
 * GlassChat Platform API Integration Client.
 * Specification from Glasschat.md (https://glasschat.app/platform/v1).
 */

export interface GlassChatConfig {
  baseUrl?: string;
  platformApiKey?: string; // Bearer gcp_...
  appId?: string;
  teamId?: string;
  externalUserId?: string;
  authMode?: "user" | "partner";
}

export interface ProvisionTeamRequest {
  externalTeamId: string;
  tenantId: string;
  name: string;
}

export interface EmbedSessionResponse {
  token: string;
  groupId: string;
  expiresAt?: string;
}

export class GlassChatPlatformAPI {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: GlassChatConfig) {
    this.baseUrl = config.baseUrl || "https://glasschat.app";
    this.apiKey = config.platformApiKey;
  }

  /** POST /platform/v1/teams — Provision a customer workspace team */
  public async provisionTeam(req: ProvisionTeamRequest): Promise<any> {
    if (!this.apiKey) throw new Error("GlassChat Platform API Key (gcp_...) is required for provisioning");
    const res = await fetch(`${this.baseUrl}/platform/v1/teams`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
    });
    if (!res.ok && res.status !== 409) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`GlassChat team provisioning failed (${res.status}): ${err.message || res.statusText}`);
    }
    return res.json().catch(() => null);
  }

  /** POST /platform/v1/teams/:teamId/members — Ensure a team member exists (idempotent). Required before minting an embed session, else the embed-session route returns member_not_found. */
  public async ensureMember(teamId: string, externalId: string, name?: string): Promise<any> {
    if (!this.apiKey) throw new Error("GlassChat Platform API Key (gcp_...) is required for member provisioning");
    const res = await fetch(`${this.baseUrl}/platform/v1/teams/${encodeURIComponent(teamId)}/members`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ externalId, ...(name ? { name } : {}) }),
    });
    // 409 = member already exists — treat as success.
    if (!res.ok && res.status !== 409) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`GlassChat member provisioning failed (${res.status}): ${err.error || err.message || res.statusText}`);
    }
    return res.json().catch(() => null);
  }

  /** POST /platform/v1/teams/:teamId/members/:externalId/embed-session — Issue short-lived embed session token */
  public async issueEmbedSession(teamId: string, externalId: string, appId?: string): Promise<EmbedSessionResponse> {
    if (!this.apiKey) throw new Error("GlassChat Platform API Key (gcp_...) is required for embed sessions");
    const res = await fetch(`${this.baseUrl}/platform/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(externalId)}/embed-session`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(appId ? { appId } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`GlassChat embed session creation failed: ${err.message || res.statusText}`);
    }
    return res.json();
  }

  /** Verify signed webhook header (x-glasschat-signature) using Web Crypto API */
  public static async verifyWebhookSignature(
    signatureHeader: string,
    rawBody: string,
    secret: string
  ): Promise<boolean> {
    try {
      const parts = signatureHeader.split(",");
      const tPart = parts.find((p) => p.startsWith("t="));
      const v1Part = parts.find((p) => p.startsWith("v1="));
      if (!tPart || !v1Part) return false;

      const timestamp = tPart.substring(2);
      const signature = v1Part.substring(3);
      const payload = `${timestamp}.${rawBody}`;

      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const messageData = encoder.encode(payload);

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
      const hashArray = Array.from(new Uint8Array(signatureBuffer));
      const computedHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      return computedHex === signature;
    } catch (e) {
      console.error("GlassChat signature verification error:", e);
      return false;
    }
  }
}
