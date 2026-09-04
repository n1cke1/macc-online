// Tiny event channel between the header CTA and the connector panel further down the page.
// Kept out of the button's own module so the gate and the panel can import it without
// pulling in the Supabase auth helpers — the static core must stay backend-free.
export const OPEN_CONNECT_PANEL = 'macc:open-connect-panel';

export function openConnectPanel(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONNECT_PANEL));
}
