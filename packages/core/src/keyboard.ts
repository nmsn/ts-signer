export function findButtonByText<T extends { text: string }>(
  buttons: T[],
  needle: string,
): T | undefined {
  return buttons.find((button) => button.text.includes(needle));
}
