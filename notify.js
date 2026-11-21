/* "Briefing is ready" notifications.
   The phone creates a push subscription (its private delivery address). You save it
   once as the PUSH_SUBSCRIPTIONS secret in GitHub; the daily workflow then sends one
   notification after each new edition is published. */
(function () {
  // Public half of the signing key pair; the private half is a GitHub Actions secret.
  const VAPID_PUBLIC_KEY =
    "BGH-vZ3iU66qjkCBC3h9nTcLfgkWExZBzbWnRoJA5GOaKg1o6bqWV9zbMajYRRIYvq_p4HRbN6T4GGwRYmp05HA";
  const SECRETS_URL =
    "https://github.com/ssddss-ctrl/morning-briefing/settings/secrets/actions/new";

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x],
    );
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const root = document.createElement("section");
  root.id = "notify";
  root.hidden = true;
  document.body.append(root);

  function keyBytes(base64url) {
    const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function show(html) {
    root.innerHTML = `<div class="talk-sheet notify-sheet"><div class="talk-head"><div><span class="eyebrow">MORNING ALERT</span><h2>Briefing is ready</h2></div><button class="talk-close" id="notify-close" aria-label="Close">✕</button></div>${html}</div>`;
    root.hidden = false;
    root.querySelector("#notify-close").onclick = () => (root.hidden = true);
  }

  async function currentSubscription() {
    if (!supported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  function showCode(subscription) {
    const code = JSON.stringify(subscription);
    show(`<p class="talk-note">Alerts are allowed on this device. One last step, done once: save this setup code in GitHub so the morning run knows where to send the alert.</p>
      <ol class="talk-steps"><li>Tap <b>Copy setup code</b>.</li><li>Open <a href="${SECRETS_URL}" target="_blank" rel="noopener noreferrer">GitHub → New secret ↗</a> (sign in if asked).</li><li>Name: <b>PUSH_SUBSCRIPTIONS</b>. Paste the code as the value and tap <b>Add secret</b>.</li></ol>
      <p class="talk-note">Treat the code like a password: anyone with it can send alerts to this phone. Using a second device later? Put both codes in the secret inside square brackets, separated by a comma: [code1,code2].</p>
      <textarea class="notify-code" id="notify-code" readonly rows="3">${esc(code)}</textarea>
      <div class="talk-form"><button class="btn primary" id="notify-copy">Copy setup code</button><button class="btn" id="notify-off">Turn alerts off</button></div>
      <p class="talk-status" id="notify-status" role="status"></p>`);
    root.querySelector("#notify-copy").onclick = async () => {
      const status = root.querySelector("#notify-status");
      try {
        await navigator.clipboard.writeText(code);
        status.textContent = "Copied.";
      } catch {
        const box = root.querySelector("#notify-code");
        box.focus();
        box.select();
        status.textContent = "Select the code above and copy it.";
      }
    };
    root.querySelector("#notify-off").onclick = async () => {
      await subscription.unsubscribe().catch(() => {});
      show(
        `<p class="talk-note">Alerts are off on this device. You can also delete the PUSH_SUBSCRIPTIONS secret in GitHub.</p>`,
      );
    };
  }

  async function open() {
    if (iOS && !standalone) {
      return show(
        `<p class="talk-note">On iPhone, alerts only work from the Home Screen app. Add Morning Brief to your Home Screen (Share → Add to Home Screen), open it from there, and tap <b>Alerts</b> again.</p>`,
      );
    }
    if (!supported) {
      return show(`<p class="talk-note">This browser doesn't support web notifications.</p>`);
    }
    const existing = await currentSubscription();
    if (existing) return showCode(existing);
    show(`<p class="talk-note">Get one notification each morning when the new briefing is published, with the top story.</p>
      <div class="talk-form"><button class="btn primary" id="notify-enable">Allow alerts</button></div>
      <p class="talk-status" id="notify-status" role="status"></p>`);
    root.querySelector("#notify-enable").onclick = async () => {
      const status = root.querySelector("#notify-status");
      // Must run directly from the tap on iPhone.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        status.textContent =
          "Notifications were not allowed. You can change this in Settings → Notifications → Morning Brief.";
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
        });
        showCode(subscription);
      } catch {
        status.textContent = "Could not set up alerts on this device. Try again in a moment.";
      }
    };
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-notify]")) open();
  });
})();
