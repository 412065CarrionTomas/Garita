import '@testing-library/jest-dom';

globalThis.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

jest.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));

// jsdom no implementa PointerEvent ni la captura del puntero: lo justo para probar arrastres.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
if (!('hasPointerCapture' in Element.prototype)) {
  const pointerCaptures = new WeakMap<Element, number>();
  Object.assign(Element.prototype, {
    setPointerCapture(this: Element, pointerId: number) {
      pointerCaptures.set(this, pointerId);
    },
    releasePointerCapture(this: Element) {
      pointerCaptures.delete(this);
    },
    hasPointerCapture(this: Element, pointerId: number) {
      return pointerCaptures.get(this) === pointerId;
    },
  });
}
