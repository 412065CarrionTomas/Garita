/** Full-page navigation to Mercado Pago's checkout; its own module so tests can replace it. */
export function redirectToCheckout(url: string): void {
  window.location.assign(url);
}
