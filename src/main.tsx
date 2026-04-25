import "@logseq/libs";

import settingSchema from "./settings";

import { handleSync } from "./gTasks";

import "virtual:uno.css";

// @ts-expect-error
const css = (t, ...args) => String.raw(t, ...args);

const pluginId = 'logseq-google-tasks';

function main() {
  console.info(`#${pluginId}: ` + "Logseq Google Tasks Plugin Loading!");

  settingSchema();

  logseq.provideStyle(css`
    .google-tasks-trigger-icon {
      width: 18px;
      height: 18px;
      margin: 0.1em 0.1em 0.1em 0.1em;
      background-size: cover;
      background-image: url('https://www.gstatic.com/images/branding/product/1x/tasks_48dp.png');
    }
  `);




  logseq.App.registerUIItem("toolbar", {
    key: "logseq-google-tasks",
    template: `
    <a data-on-click="syncNow" title="Sync Google Tasks">
      <div class="google-tasks-trigger-icon"></div>
    </a>
  `,
  });

  logseq.App.registerCommandPalette(
    {
      key: "sync-google-tasks-now",
      label: "Google Tasks: Synchronize Now",
    },
    async () => {
      await handleSync(false);
    }
  );

  logseq.App.registerCommandPalette(
    {
      key: "open-google-tasks-settings",
      label: "Google Tasks: Open Settings",
    },
    () => {
      logseq.showSettingsUI();
    }
  );

  logseq.App.registerCommandPalette(
    {
      key: "start-authentication",
      label: "Google Tasks: Start Authentication",
    },
    async () => {
      const clientId = logseq.settings?.client_id;
      if (!clientId) {
        logseq.UI.showMsg("Please enter your Google API Client ID in the settings first.", "error");
        logseq.showSettingsUI();
        return;
      }
      
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `scope=openid%20profile%20email%20https%3A//www.googleapis.com/auth/tasks&` +
        `access_type=offline&` +
        `include_granted_scopes=true&` +
        `response_type=code&` +
        `redirect_uri=http://localhost&` +
        `client_id=${encodeURIComponent(clientId.toString())}&` + 
        `prompt=consent`;

      logseq.App.openExternalLink(authUrl);
      logseq.UI.showMsg("Opening browser! Log in, then paste the localhost URL back into the plugin settings.", "info");
      logseq.showSettingsUI();
    }
  );

  // Background sync daemon Let's use setInterval
  let syncInterval: ReturnType<typeof setInterval> | null = null;
  const startAutoSync = () => {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    if (logseq.settings?.auto_sync_enabled) {
      const mins = Number(logseq.settings?.auto_sync_interval_minutes) || 15;
      const ms = Math.max(1, mins) * 60 * 1000;
      console.info(`#${pluginId}: Starting auto-sync every ${mins} minutes`);
      syncInterval = setInterval(() => {
        console.info(`#${pluginId}: Triggering background sync...`);
        handleSync(true).catch(e => console.error(e));
      }, ms);
    }
  };

  logseq.provideModel({
    async syncNow() {
      await handleSync(false);
    },
  });

  logseq.onSettingsChanged(async () => {
    startAutoSync();

    const authCode = logseq.settings?.auth_code as string | undefined;
    if (authCode && authCode.includes("code=")) {
      try {
        const url = new URL(authCode);
        const code = url.searchParams.get('code');
        if (code) {
          logseq.UI.showMsg("Exchanging auth code for tokens...", "info");
          const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code: code,
              client_id: logseq.settings?.client_id as string,
              client_secret: logseq.settings?.client_secret as string,
              redirect_uri: 'http://localhost',
              grant_type: 'authorization_code'
            })
          });
          const data = await response.json();
          if (data.refresh_token) {
            logseq.updateSettings({
              refresh_token: data.refresh_token,
              access_token: data.access_token,
              auth_code: "" // clean up the pasted url
            });
            logseq.UI.showMsg("Google Tasks Authentication successful! Refresh token saved.", "success");
          } else {
            console.error("Token exchange failed", data);
            logseq.UI.showMsg("Failed to exchange code for token. Check Developer Tools Console.", "error");
          }
        }
      } catch (e) {
        console.error("Failed to parse auth code URL", e);
        logseq.UI.showMsg("Invalid Redirect URL format pasted.", "error");
      }
    }
  });
  
  startAutoSync();


  ;(logseq.App as any).onGoogleAuthTokenReceived((payload: any) => {
    console.info(`#${pluginId}: ` + "Google Auth Token Received");
    console.debug(payload);

    let refresh_token = payload.refresh_token ?? logseq.settings!.refresh_token;

    logseq.updateSettings({
      access_token: payload.access_token,
      refresh_token: refresh_token,
    });

    logseq.UI.showMsg("Google Auth Tokens Received", "success");
  });
}

logseq.ready(main).catch(console.error);
