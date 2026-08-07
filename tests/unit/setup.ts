import '@testing-library/jest-dom/vitest';

/**
 * O jsdom não implementa a Pointer Events API nem `scrollIntoView`, e os
 * primitivos de menu do Radix (Select, DropdownMenu) chamam os dois ao abrir.
 * Sem estes stubs, qualquer teste que abra um seletor estoura com
 * `target.hasPointerCapture is not a function` — falha do ambiente, não do
 * componente.
 */
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
