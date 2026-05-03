const API_BASE = "";

export function isPushSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function fetchVapidPublicKey() {
  const localKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (localKey) {
    return localKey;
  }
  const response = await fetch(`${API_BASE}/api/push/vapid-key`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to fetch VAPID key");
  }
  const data = await response.json();
  if (!data?.publicKey) {
    throw new Error("Missing VAPID key");
  }
  return data.publicKey;
}

export async function ensureServiceWorker() {
  if (!isPushSupported()) {
    throw new Error("Push not supported");
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  return registration;
}

export async function subscribeForPush() {
  const registration = await ensureServiceWorker();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    const publicKey = await fetchVapidPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const response = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription, timezone }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "Unable to save subscription");
  }

  return subscription;
}

export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    return false;
  }
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return false;
  }

  await subscription.unsubscribe();

  await fetch(`${API_BASE}/api/push/unsubscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  return true;
}

export async function fetchPushStatus() {
  const response = await fetch(`${API_BASE}/api/push/status`, { cache: "no-store" });
  if (!response.ok) {
    return { enabled: false, count: 0 };
  }
  return response.json();
}
