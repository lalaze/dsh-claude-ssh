export function isGpt(id: string): boolean { return /(?:^|\/)gpt-[a-z0-9]/i.test(id); }
export interface FastState { enabled: boolean; supported: boolean; reason?: string }
export interface Selection { provider: string; model: string }
