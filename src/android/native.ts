import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** The Java side lives in android/app/src/main/java/com/researchbot/android/ResearchNativePlugin.java. */
export interface ResearchNativePlugin {
  httpOpen(options: {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    follow: boolean;
    readTimeout?: number;
  }): Promise<{ status: number; statusText: string; headers: Record<string, string> }>;
  httpRead(options: { id: string }): Promise<{ done: boolean; data?: string }>;
  httpClose(options: { id: string }): Promise<void>;
  loopbackStart(): Promise<{ serverId: string; port: number }>;
  loopbackRespond(options: { requestId: string; status: number; body: string; returnToApp?: boolean }): Promise<void>;
  loopbackClose(options: { serverId: string }): Promise<void>;
  addListener(
    event: 'loopbackRequest',
    listener: (event: { serverId: string; requestId: string; method: string; url: string }) => void,
  ): Promise<PluginListenerHandle>;
  encrypt(options: { text: string }): Promise<{ data: string }>;
  decrypt(options: { data: string }): Promise<{ text: string }>;
  fileRead(options: { name: string }): Promise<{ missing?: boolean; data?: string }>;
  fileWrite(options: { name: string; data: string }): Promise<void>;
  fileRemove(options: { name: string }): Promise<void>;
  openUrl(options: { url: string }): Promise<void>;
  saveFile(options: { name: string; mimeType: string; content: string }): Promise<{ saved: boolean; path?: string }>;
  appInfo(): Promise<{
    version: string;
    versionCode: number;
    sdk: number;
    canInstall: boolean;
    webviewVersion?: string;
  }>;
  downloadUpdate(options: { url: string; sha256: string }): Promise<{ version: string }>;
  installUpdate(): Promise<void>;
}

export const Native = registerPlugin<ResearchNativePlugin>('ResearchNative');

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
