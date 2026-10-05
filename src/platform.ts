import { Capacitor } from '@capacitor/core';

/** Where this interface runs. Desktop exposes its API through the Electron preload before any script runs. */
export const platform: 'desktop' | 'android' | 'browser' = window.research
  ? 'desktop'
  : Capacitor.isNativePlatform()
    ? 'android'
    : 'browser';
export const isBrowserPreview = platform === 'browser';
