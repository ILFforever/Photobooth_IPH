/**
 * Check if a font family is available and loaded in the browser
 * Uses a technique that renders text with the target font and measures if it differs from a fallback
 */
export function isFontAvailable(fontFamily: string): boolean {
  // Don't check CSS variables
  if (fontFamily.startsWith('var(')) return true;

  // Create a test element
  const testElement = document.createElement('span');
  testElement.style.position = 'absolute';
  testElement.style.left = '-9999px';
  testElement.style.fontSize = '100px';
  testElement.style.fontFamily = 'sans-serif';
  testElement.textContent = 'mmmmmmmmmmlli';

  // Measure with fallback font
  document.body.appendChild(testElement);
  const fallbackWidth = testElement.offsetWidth;
  const fallbackHeight = testElement.offsetHeight;

  // Apply the test font
  testElement.style.fontFamily = `"${fontFamily}", sans-serif`;

  // Measure with test font
  const testWidth = testElement.offsetWidth;
  const testHeight = testElement.offsetHeight;

  // Clean up
  document.body.removeChild(testElement);

  // If dimensions differ, the font is available
  return testWidth !== fallbackWidth || testHeight !== fallbackHeight;
}

/**
 * Get a list of available fonts from a list of font names
 */
export function filterAvailableFonts(fontNames: string[]): string[] {
  return fontNames.filter(isFontAvailable);
}
