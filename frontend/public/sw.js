self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "MailMind", body: event.data.text() };
  }

  const title = payload.title || "MailMind";
  const options = {
    body: payload.body || "",
    icon: "/mailmind-logo.svg",
    badge: "/mailmind-logo.svg",
    data: {
      url: payload.url || "/dashboard",
    },
    tag: payload.tag || "mailmind-notification",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "/dashboard";
  const targetUrl = new URL(rawUrl, self.location.origin).toString();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
