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

  logseq.onSettingsChanged(() => {
    startAutoSync();
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
