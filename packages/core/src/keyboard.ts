export function findButtonByText(
  buttons: { text: string }[],
  needle: string,
): { text: string } | undefined {
  return buttons.find((button) => button.text.includes(needle));
}
