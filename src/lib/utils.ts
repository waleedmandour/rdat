export function cn(...inputs: any[]): string {
  return inputs.flat().filter(Boolean).join(" ");
}
