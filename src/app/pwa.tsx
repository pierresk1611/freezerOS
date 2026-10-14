"use client";
import { useEffect } from "react";
export function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* App stays functional online if registration is unavailable. */
      });
    }
  }, []);
  return null;
}
