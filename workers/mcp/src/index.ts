// OAuth remote MCP — Cloudflare Worker entry (docs/oauth-mcp-cloudflare.md).
//
// `@cloudflare/workers-oauth-provider` wraps the Worker: it serves the OAuth metadata,
// Dynamic Client Registration (/register), /authorize, /token, refresh and revoke, and
// stores clients/grants/tokens in `OAUTH_KV`. After a successful authorization it calls
// our `apiHandler` (the MCP) with the authenticated user in `ctx.props`.
//
//   • apiRoute     /mcp       → the measure-authoring MCP, run AS the signed-in user
//   • defaultHandler          → /authorize: bridge the login to Supabase (web app)
//
// The existing Supabase Edge MCP (header-auth, for Claude Code) is unaffected.
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { mcpApiHandler } from './mcp-handler';
import { loginHandler } from './login';

export interface Env {
  /** OAuth provider storage (bound in wrangler.toml). */
  OAUTH_KV: KVNamespace;
  /** OAuth helper API injected by the provider (parseAuthRequest / completeAuthorization / …). */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Supabase — user login + the measures/library data (RLS). */
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** HS256 project JWT secret — to mint a short user JWT from the resolved identity. */
  SUPABASE_JWT_SECRET: string;
  /** The web app that runs the Supabase sign-in for the /authorize bridge. */
  WEB_APP_URL: string;
}

/** The authenticated user we stash in the OAuth grant props (→ ctx.props in the MCP). */
export interface UserProps {
  userId: string;
  email?: string;
}

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: mcpApiHandler,
  defaultHandler: loginHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
