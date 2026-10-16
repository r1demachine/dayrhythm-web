"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(error => {
      console.warn("Не удалось зарегистрировать офлайн-режим DayRhythm:", error);
    });
  }, []);

  return null;
}
