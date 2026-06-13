// DB row types for the collaboration layer, mirroring supabase/migrations.
// Kept hand-written (not generated) so the collab layer has no build step beyond
// the app's. These types are imported ONLY by the collaboration layer.

export type UserRole = 'user' | 'reviewer' | 'owner';
export type CommentTarget = 'curve' | 'project' | 'assumption' | 'scenario' | 'object';
export type CommentStatus = 'open' | 'accepted' | 'rejected' | 'wontfix';
export type ScenarioVisibility = 'private' | 'unlisted' | 'public';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
}

export interface Comment {
  id: string;
  author_id: string;
  target_type: CommentTarget;
  target_id: string;
  scenario_id: string | null;
  parent_id: string | null;
  body: string;
  status: CommentStatus;
  is_pinned: boolean;
  is_deleted: boolean;
  model_version: string;
  created_at: string;
  updated_at: string;
}

/** A comment joined with its author's public profile (for rendering). */
export interface CommentWithAuthor extends Comment {
  author: Pick<Profile, 'display_name' | 'avatar_url' | 'role'> | null;
}

export interface Scenario {
  id: string;
  owner_id: string;
  name: string;
  levers: Record<string, number>;
  visibility: ScenarioVisibility;
  model_version: string;
  created_at: string;
  updated_at: string;
}

/** Anchor describing what a comment thread is attached to. */
export interface Anchor {
  type: CommentTarget;
  id: string;
}
