import "@logseq/libs";

export default function settingSchema() {
  logseq.useSettingsSchema([
    {
      key: "client_id",
      type: "string",
      title: "Client ID",
      description: "",
      default: "",
    },
    {
      key: "client_secret",
      type: "string",
      title: "Client Secret",
      description: "",
      default: "",
    },
    {
      key: "access_token",
      type: "string",
      title: "Access Token",
      description: "",
      default: "",
    },
    {
      key: "refresh_token",
      type: "string",
      title: "Refresh Token",
      description: "",
      default: "",
    },
    {
      key: "target_list_name",
      type: "string",
      title: "Target Google Tasks List",
      description: "Local Logseq TODOs will be synced to this list. Use '@default' for your primary list.",
      default: "Logseq Tasks",
    },
    {
      key: "auto_sync_enabled",
      type: "boolean",
      title: "Enable Automatic Background Sync",
      description: "Automatically synchronize tasks in the background.",
      default: false,
    },
    {
      key: "auto_sync_interval_minutes",
      type: "number",
      title: "Auto Sync Interval (Minutes)",
      description: "How often to trigger the automatic background sync. Minimum 1 minute.",
      default: 15,
    },
  ]);
}
