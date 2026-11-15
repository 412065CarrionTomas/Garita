/**
 * Opens Mercado Pago's checkout in a new tab. The tab must be opened synchronously inside the
 * click (before awaiting the API), or popup blockers stop it.
 */
export function openCheckoutTab(): Window | null {
  return window.open('about:blank', '_blank');
}

/** Returns true when the checkout opened in the new tab, false when it fell back to this tab. */
export function sendToCheckout(tab: Window | null, url: string): boolean {
  if (tab && !tab.closed) {
    // Cut the link back to Garita so the opened page can't navigate this tab (reverse tabnabbing).
    tab.opener = null;
    tab.location.href = url;
    return true;
  }
  window.location.assign(url);
  return false;
}
