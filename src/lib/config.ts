// Feature-flag boundary between the static core and the optional collaboration
// layer. The core NEVER imports `src/lib/supabase` directly; it imports only
// this module and the gated `<AnchorComments>` entry-point. When the Supabase
// env vars are absent (the default), `collabEnabled` is false and the whole
// collaboration layer — auth, comments, Supabase client — is never loaded, so
// the tool stays fully functional as a zero-backend static bundle.
//
// NEXT_PUBLIC_* vars are inlined at build time by Next.js, so this resolves to a
// constant in the static export — no runtime backend probe.

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True only when a Supabase backend is configured. Gates the entire collab layer. */
export const collabEnabled = Boolean(supabaseUrl && supabaseAnonKey);

/** OAuth providers offered for sign-in (email magic-link is always available). */
export const authProviders = ['linkedin_oidc', 'google'] as const;
export type OAuthProvider = (typeof authProviders)[number];
