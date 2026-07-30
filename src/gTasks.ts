import "@logseq/libs";

import { IBatchBlock, PageEntity, BlockEntity } from "@logseq/libs/dist/LSPlugin";

import { format, parse } from "date-fns";

const pluginId = 'logseq-google-tasks';

declare var gapi: any;

interface HttpError extends Error {
  status?: number;
}

async function authGapi() {
  if (!logseq.settings!.client_id || !logseq.settings!.client_secret) {
    console.error(`#${pluginId}: ` + "Client ID or Client Secret is not set");
    logseq.UI.showMsg("Client ID or Client Secret is not set", 'error');
    logseq.showSettingsUI();
    return;
  }

  logseq.UI.showMsg("Standard Logseq builds do not natively support Google OAuth prompts. Please generate a Refresh Token manually and paste it into the plugin settings.", 'error');
  logseq.showSettingsUI();
}

export async function purgeLocalTasks() {
  const query = `
    [:find (pull ?b [*])
     :where
     (or 
       [?b :plugin.property._test_plugin/google-task-id]
       [?b :plugin.property.logseq-google-tasks/google-task-id]
       [?b :logseq.property/google-task-id]
     )
    ]
  `;
  const results = await logseq.DB.datascriptQuery(query);
  const blocks = results?.map((r: any) => {
    const b = r[0];
    if (b && typeof b.uuid === 'object' && b.uuid.$uuid$) b.uuid = b.uuid.$uuid$;
    if (b && !b.properties) {
      b.properties = {};
      for (const k of Object.keys(b)) {
        if (typeof k === 'string' && k.includes('/')) b.properties[k] = b[k];
      }
    }
    return b;
  }) || [];

  const total = blocks.length;
  console.info(`#${pluginId}: Found ${total} blocks to purge.`);
  
  if (total === 0) {
    logseq.UI.showMsg("Found 0 blocks to purge.", 'info');
    return;
  }

  let currentToastKey = '';
  for (let i = 0; i < total; i++) {
    const block = blocks[i];
    await logseq.Editor.removeBlock(block.uuid);
    
    if (i % 10 === 0 || i === total - 1) {
      const pct = ((i + 1) / total) * 100;
      const filledLength = Math.round((pct / 100) * 10);
      const bar = `[${'█'.repeat(filledLength)}${'░'.repeat(10 - filledLength)}]`;
      const fullMsg = `${bar} ${Math.round(pct)}% - Purging ${i + 1} of ${total}`;
      
      if (currentToastKey) {
        await logseq.UI.showMsg(fullMsg, 'info', { key: currentToastKey, timeout: 5000 });
      } else {
        currentToastKey = await logseq.UI.showMsg(fullMsg, 'info', { timeout: 5000 });
      }
    }
  }
  
  if (currentToastKey) {
    await logseq.UI.showMsg(`Successfully purged ${total} legacy tasks!`, 'success', { key: currentToastKey, timeout: 3000 });
  }
}

async function initGapi() {
  console.info(`#${pluginId}: ` + "Init GAPI (Native Fetch)");

  if (!logseq.settings!.access_token) {
    return false;
  }

  try {
    const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1', {
      headers: {
        'Authorization': `Bearer ${logseq.settings!.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 401) {
      return false;
    }
    
    if (!response.ok) {
      console.warn("Tasks API returned status:", response.statusText);
      return false;
    }
  } catch (error: any) {
    console.error("Init Error", error);
    return false;
  }

  return true;
}

let lastSyncTime: string | null = null;
let currentToastKey: string = '';

export async function handleSync(isAutoSync: boolean = false) {
  let progress = 0;
  
  const showProgress = async (msg: string, pct: number) => {
    progress = pct;
    if (isAutoSync) return; // Silent if auto sync

    const filledLength = Math.round((pct / 100) * 10);
    const bar = `[${'█'.repeat(filledLength)}${'░'.repeat(10 - filledLength)}]`;
    const fullMsg = `${bar} ${Math.round(pct)}% - ${msg}`;
    
    if (currentToastKey) {
       await logseq.UI.showMsg(fullMsg, 'info', { key: currentToastKey, timeout: 5000 });
    } else {
       currentToastKey = await logseq.UI.showMsg(fullMsg, 'info', { timeout: 5000 });
    }
  };

  await showProgress("Authenticating...", 0);

  if (!logseq.settings!.access_token && !logseq.settings!.refresh_token) {
    console.info(`#${pluginId}: ` + "No tokens, start auth flow.");
    if (!isAutoSync) await authGapi();
    return;
  }

  // We have refresh token, let's try if it is still valid
  if (logseq.settings!.refresh_token) {
    // Can not init GAPI, try to refresh token
    if (!await initGapi()) {
      if (!logseq.settings!.refresh_token) {
        console.error(`#${pluginId}: ` + "Refresh Token is not set, please re-authenticate.");
        if (!isAutoSync) {
            logseq.UI.showMsg("Refresh Token is not set, please re-authenticate.", 'error');
            logseq.showSettingsUI();
        }
        return;
      }

      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: logseq.settings!.client_id as string,
            client_secret: logseq.settings!.client_secret as string,
            refresh_token: logseq.settings!.refresh_token as string,
            grant_type: 'refresh_token',
          }),
        });

        if (!response.ok) {
          throw new Error(`Refresh token failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.access_token) {
          logseq.updateSettings({ access_token: data.access_token });
          logseq.settings!.access_token = data.access_token;
        } else {
          throw new Error('No access token in refresh response');
        }
      } catch (e: any) {
        console.error(`#${pluginId}: Error automatically refreshing Google Tasks token:`, e);
        if (!isAutoSync) {
            logseq.UI.showMsg("Failed to automatically refresh Google Tasks token. Please check your credentials in settings.", 'error');
            logseq.showSettingsUI();
        }
        return;
      }
    }
  }

  await showProgress("Init GAPI...", 5);

  // Can not init GAPI, try to re-authenticate
  if (!await initGapi()) {
    console.error(`#${pluginId}: ` + "Failed to refresh token, trying to re-authenticate.");
    if (!isAutoSync) {
        logseq.UI.showMsg("Failed to refresh token, tring to re-authenticate.", 'warning');
        await authGapi();
    }
    return;
  }

  try {
    await showProgress("Pushing local TODOs to Google...", 10);
    await pushNativeTodosToGoogle();
    
    // Pre-fetch all local Google tasks for fast O(1) lookup
    let allLocalGTasks: any[] = [];
    const query = `
      [:find (pull ?b [*])
       :where
       (or 
         [?b :plugin.property._test_plugin/google-task-id]
         [?b :plugin.property.logseq-google-tasks/google-task-id]
         [?b :logseq.property/google-task-id]
       )
      ]
    `;
    const res = await logseq.DB.datascriptQuery(query);
    allLocalGTasks = res?.map((r: any) => {
      const b = r[0];
      if (b && typeof b.uuid === 'object' && b.uuid.$uuid$) b.uuid = b.uuid.$uuid$;
      return b;
    }) || [];

    // Build dedup map by directly querying DataScript for resolved string values
    // The SDK returns property values as {:db/id N} references, but DataScript
    // can resolve the actual string through the property-value entity's :block/title
    const localTasksByGid = new Map<string, any>();
    const gidQuery = `
      [:find ?uuid ?gid
       :where
       (or
         [?b :plugin.property.logseq-google-tasks/google-task-id ?pv]
         [?b :plugin.property._test_plugin/google-task-id ?pv]
       )
       [?b :block/uuid ?uuid]
       [?pv :block/title ?gid]
      ]
    `;
    try {
      const gidRes = await logseq.DB.datascriptQuery(gidQuery);
      if (gidRes) {
        for (const row of gidRes) {
          let uuid = row[0];
          const gid = row[1];
          if (uuid && typeof uuid === 'object' && uuid.$uuid$) uuid = uuid.$uuid$;
          if (typeof gid === 'string' && gid.length > 0) {
            const block = allLocalGTasks.find((b: any) => b.uuid === uuid);
            if (block) {
              localTasksByGid.set(gid, block);
            }
          }
        }
      }
      console.info(`#${pluginId}: Built dedup map with ${localTasksByGid.size} entries from ${allLocalGTasks.length} local blocks.`);
    } catch (e) {
      console.error(`#${pluginId}: GID DataScript query failed, trying :property.value/content fallback...`, e);
      // Fallback: try :property.value/content instead of :block/title
      try {
        const gidRes2 = await logseq.DB.datascriptQuery(`
          [:find ?uuid ?gid
           :where
           (or
             [?b :plugin.property.logseq-google-tasks/google-task-id ?pv]
             [?b :plugin.property._test_plugin/google-task-id ?pv]
           )
           [?b :block/uuid ?uuid]
           [?pv :property.value/content ?gid]
          ]
        `);
        if (gidRes2) {
          for (const row of gidRes2) {
            let uuid = row[0];
            const gid = row[1];
            if (uuid && typeof uuid === 'object' && uuid.$uuid$) uuid = uuid.$uuid$;
            if (typeof gid === 'string' && gid.length > 0) {
              const block = allLocalGTasks.find((b: any) => b.uuid === uuid);
              if (block) localTasksByGid.set(gid, block);
            }
          }
        }
        console.info(`#${pluginId}: Fallback dedup map with ${localTasksByGid.size} entries.`);
      } catch (e2) {
        console.error(`#${pluginId}: Both GID queries failed!`, e2);
      }
    }
    // Also build a map of resolved google-task-updated timestamps
    const localUpdatedByGid = new Map<string, string>();
    try {
      const updQuery = `
        [:find ?gid-str ?upd-str
         :where
         (or
           [?b :plugin.property.logseq-google-tasks/google-task-id ?gid-pv]
           [?b :plugin.property._test_plugin/google-task-id ?gid-pv]
         )
         [?gid-pv :block/title ?gid-str]
         (or
           [?b :plugin.property.logseq-google-tasks/google-task-updated ?upd-pv]
           [?b :plugin.property._test_plugin/google-task-updated ?upd-pv]
         )
         [?upd-pv :block/title ?upd-str]
        ]
      `;
      const updRes = await logseq.DB.datascriptQuery(updQuery);
      if (updRes) {
        for (const row of updRes) {
          if (typeof row[0] === 'string' && typeof row[1] === 'string') {
            localUpdatedByGid.set(row[0], row[1]);
          }
        }
      }
      console.info(`#${pluginId}: Built updated-timestamp map with ${localUpdatedByGid.size} entries.`);
    } catch (e) {
      console.warn(`#${pluginId}: Could not build updated-timestamp map, will update all tasks.`, e);
    }
    
    let taskLists = await fetchTaskLists() ?? [];
    for (const list of taskLists) {
      const tasks = await fetchTasks(list.id as string, null);
      if (tasks) {
        await syncGoogleTasks(list, tasks, localTasksByGid, localUpdatedByGid, isAutoSync, showProgress);
      }
    }
    
    lastSyncTime = new Date().toISOString();
    
    if (!isAutoSync) {
        await logseq.UI.showMsg("Sync Complete!", 'success');
    }
    currentToastKey = '';
  } catch (error: any) {
    currentToastKey = '';
    let httpError = error as HttpError;
    if (httpError.status === 401) {
      console.error(`#${pluginId}: ` + 'Google Tasks Access token expired, something went wrong.');
      if (!isAutoSync) {
          logseq.UI.showMsg("Google Tasks Access token expired, something went wrong.", 'error');
          logseq.showSettingsUI();
      }
    }
    else {
      console.error(`#${pluginId}: ` + 'Error syncing Google Tasks');
      console.error(error);
      if (!isAutoSync) logseq.UI.showMsg("Error syncing Google Tasks", 'error');
    }
  }
}

async function syncGoogleTasks(list: any, tasks: any[], localTasksByGid: Map<string, any>, localUpdatedByGid: Map<string, string>, isAutoSync: boolean, showProgress: (msg: string, pct: number) => Promise<void>) {
  console.info(`#${pluginId}: ` + "Start Syncing Google Tasks");

  let tasksNew: { [key: string]: any[] } = {};

  let totalTasks = tasks.length;
  let currentTask = 0;
  let skipped = 0;

  for (const task of tasks) {
    currentTask++;
    await showProgress(`Parsing task ${currentTask} of ${totalTasks}`, 20 + Math.round(60 * currentTask / (totalTasks || 1)));
    
    let res: any[] = [];
    if (localTasksByGid && localTasksByGid.has(task.id)) {
      res = [localTasksByGid.get(task.id)];
    }

    if (res && res.length > 1) {
      console.warn(`#${pluginId}: ` + `Multiple tasks with the same id found: ${task.id}`);
    }

    if (res && res.length > 0) {
      // Use the pre-resolved updated timestamp from DataScript
      const localUpdated = localUpdatedByGid.get(task.id);
      if (localUpdated && localUpdated === task.updated) {
        // Timestamps match on Google side, but user may have changed status locally
        await pushLocalChanges(res[0], task);
        skipped++;
        continue;
      }

      console.debug(`#${pluginId}: Update block: ${res[0].uuid} with task: ${task.id} : ${task.title}`);
      await updateTaskBlock(res[0], list, task);
      
      // Throttle: pause briefly every 10 updates to let the IPC bridge breathe
      if (currentTask % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    else {
      // When a task is deleted in Google Tasks, the task is marked as deleted
      // and hidden from UI, then it is deleted asynchronously later.
      if (task.deleted) continue;
      
      console.info(`#${pluginId}: ` + `Insert block for task: ${task.id}`);
      let parentName = await generateParentName(list, task);

      tasksNew[parentName] = tasksNew[parentName] || [];
      tasksNew[parentName].push([list, task]);
    }
  }

  await showProgress("Inserting tasks to Logseq...", 90);

  for (let [parentName, groupTasks] of Object.entries(tasksNew)) {
    let pageEntity = await ensurePage(parentName, false);
    if (!pageEntity) {
      throw new Error(`Unable to create parent page ${parentName}`);
    }

    let pageBlocksTree = await logseq.Editor.getPageBlocksTree(pageEntity.uuid);
    let targetBlock = pageBlocksTree && pageBlocksTree.length > 0 ? pageBlocksTree[pageBlocksTree.length - 1] : null;
    
    let generatedTasks = await Promise.all(groupTasks.map(async ([list, task]: any[]) => {
      return await blockContentGenerate(list, task);
    }));

    if (!targetBlock) {
      const firstTask = generatedTasks[0];
      const createdBlock = await logseq.Editor.appendBlockInPage(pageEntity.uuid, firstTask.content, { properties: firstTask.properties });
      
      if (createdBlock) {
        let remaining = generatedTasks.slice(1);
        while (remaining.length > 0) {
          await logseq.Editor.insertBatchBlock(createdBlock.uuid, remaining.slice(0, 100), { sibling: true });
          remaining = remaining.slice(100);
        }
        
        if (firstTask.children && firstTask.children.length > 0) {
          await logseq.Editor.insertBatchBlock(createdBlock.uuid, firstTask.children, { sibling: false });
        }
      }
    } else {
      let remaining = generatedTasks;
      let refUuid = targetBlock.uuid;
      while (remaining.length > 0) {
        await logseq.Editor.insertBatchBlock(refUuid, remaining.slice(0, 100), { sibling: true });
        remaining = remaining.slice(100);
      }
    }
  }

  await showProgress("Completing...", 100);
}

/**
 * Pushes local Logseq TODOs that are not yet tracked to Google Tasks.
 */
async function pushNativeTodosToGoogle() {
  const targetListName = logseq.settings?.target_list_name || "Logseq Tasks";
  
  // 1. Find or create the list
  const taskLists = await fetchTaskLists() || [];
  let targetList = taskLists.find(l => l.title === targetListName);
  
  if (!targetList) {
    if (targetListName === "@default") {
        targetList = taskLists.find(l => l.id === "@default");
    } else {
        console.info(`#${pluginId}: Creating new task list: ${targetListName}`);
        const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${logseq.settings!.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: targetListName })
        });
        if (!response.ok) {
          const e = new Error(`Failed to create list: ${response.statusText}`) as HttpError;
          e.status = response.status;
          throw e;
        }
        targetList = await response.json();
    }
  }

  if (!targetList) {
      throw new Error(`Could not find or create target list: ${targetListName}`);
  }

  // Use DataScript to find blocks tagged as Task that do NOT have a google-task-id,
  // and resolve their status string properly
  const pushQuery = `
    [:find ?uuid ?status-str
     :where
     [?b :block/tags ?tag]
     [?tag :block/name "task"]
     [?b :block/uuid ?uuid]
     [?b :logseq.property/status ?status-entity]
     [?status-entity :block/title ?status-str]
     (not [?b :plugin.property.logseq-google-tasks/google-task-id _])
     (not [?b :plugin.property._test_plugin/google-task-id _])
    ]
  `;
  
  let blocksToPush: any[] = [];
  try {
    const pushRes = await logseq.DB.datascriptQuery(pushQuery);
    if (pushRes) {
      for (const row of pushRes) {
        let uuid = row[0];
        const statusStr = row[1];
        if (uuid && typeof uuid === 'object' && uuid.$uuid$) uuid = uuid.$uuid$;
        
        const status = (typeof statusStr === 'string' ? statusStr : '').toLowerCase();
        const isAction = ['todo', 'doing', 'now', 'later', 'waiting'].includes(status);
        
        if (isAction) {
          const sdkBlock = await logseq.Editor.getBlock(uuid);
          if (sdkBlock) blocksToPush.push(sdkBlock);
        }
      }
    }
  } catch (e) {
    console.error(`#${pluginId}: Push query failed`, e);
  }

  if (blocksToPush.length === 0) {
    console.info(`#${pluginId}: No new local TODOs to sync.`);
    return;
  }

  console.info(`#${pluginId}: Pushing ${blocksToPush.length} local TODOs to Google Tasks.`);
  
  for (const block of blocksToPush) {
    try {
      let taskTitle = (block.content || "")
        .replace(/\nDEADLINE: [^\n]*/g, '')
        .replace(/\n[^\n]*:: [^\n]*/g, '')
        .replace(/^[^\n]*:: [^\n]*\n/g, '')
        .replace(/#Task/ig, '')
        .trim();

      const localStatus = (block.properties?.status || block.properties?.["logseq.property/status"] || "").toLowerCase();
      const isCompleted = localStatus === "done" || localStatus === "canceled" || localStatus === "cancelled";

      const newTask = {
        title: taskTitle || "Unnamed Task",
        status: isCompleted ? 'completed' : 'needsAction'
      };

      const response = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${targetList.id}/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${logseq.settings!.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newTask)
      });
      if (!response.ok) {
        const e = new Error(`Failed to create task: ${response.statusText}`) as HttpError;
        e.status = response.status;
        throw e;
      }
      const googleTask = await response.json();

      // Update Logseq block with the new IDs
      await logseq.Editor.upsertBlockProperty(block.uuid, "google-task-id", googleTask.id);
      await logseq.Editor.upsertBlockProperty(block.uuid, "google-task-list-id", targetList.id);
      await logseq.Editor.upsertBlockProperty(block.uuid, "google-task-updated", googleTask.updated);
      
      console.debug(`#${pluginId}: Synced local block ${block.uuid} to Google Task ${googleTask.id}`);
    } catch (e) {
      console.error(`#${pluginId}: Failed to sync local block ${block.uuid}`, e);
    }
  }
}

/**
 * Fetches all task lists from the Google Tasks API.
 * @returns {Promise<any[]>} A promise that resolves to an array of task lists.
 */
async function fetchTaskLists(): Promise<gapi.client.tasks.TaskList[] | undefined> {
  let taskLists: any[] = [];
  let nextPageToken;
  do {
    const url = new URL('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    url.searchParams.append('maxResults', '100');
    if (nextPageToken) url.searchParams.append('pageToken', nextPageToken);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${logseq.settings!.access_token}` }
    });
    if (!response.ok) {
      const e = new Error(`Failed to fetch task lists: ${response.statusText}`) as HttpError;
      e.status = response.status;
      throw e;
    }
    const data = await response.json();

    console.debug(data);
    if (data.items) taskLists = taskLists.concat(data.items);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  if (!taskLists || taskLists.length == 0) {
    console.info(`#${pluginId}: ` + 'No task lists found.');
    return;
  }

  return taskLists;
}

/**
 * Fetches tasks from the Google Tasks API for a given task list ID.
 * @param taskListId - The ID of the task list.
 * @returns A promise that resolves to an array of tasks.
 */
async function fetchTasks(taskListId: string, updatedMin: string | null): Promise<gapi.client.tasks.Task[] | undefined> {
  let tasks: any[] = [];
  let nextPageToken;
  do {
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`);
    url.searchParams.append('maxResults', '100');
    url.searchParams.append('showHidden', 'true');
    url.searchParams.append('showDeleted', 'true');
    url.searchParams.append('showCompleted', 'true');
    url.searchParams.append('cacheBuster', Date.now().toString());
    if (updatedMin) url.searchParams.append('updatedMin', updatedMin);
    if (nextPageToken) url.searchParams.append('pageToken', nextPageToken);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${logseq.settings!.access_token}` }
    });
    if (!response.ok) {
      const e = new Error(`Failed to fetch tasks: ${response.statusText}`) as HttpError;
      e.status = response.status;
      throw e;
    }
    const data = await response.json();

    console.debug(data);
    if (data.items) tasks = tasks.concat(data.items);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  if (!tasks || tasks.length == 0) {
    console.info(`#${pluginId}: ` + 'No tasks found.');
    return;
  }

  return tasks;
}

/**
 * Ensures the existence of a page in Logseq.
 * If the page doesn't exist, it creates a new page with the specified name.
 * If the page already exists, it returns the existing page entity.
 *
 * @param page - The name of the page to ensure.
 * @param isJournal - Optional. Specifies whether the page is a journal page. Default is false.
 * @returns A Promise that resolves to the PageEntity of the page, or null if the page couldn't be created.
 */
async function ensurePage(page: string, isJournal: boolean = false): Promise<PageEntity | null> {
  const pageEntity = await logseq.Editor.getPage(page);
  if (!pageEntity) {
    return await logseq.Editor.createPage(page, {}, { journal: isJournal });
  }
  return pageEntity;
}

/**
 * Updates a task block with the provided task information.
 * @param block - The block entity representing the task block.
 * @param list - The task list object or its ID.
 * @param task - The task object.
 */
async function updateTaskBlock(block: BlockEntity, list: gapi.client.tasks.TaskList | string, task: gapi.client.tasks.Task) {
  console.info(`#${pluginId}: ` + `Update block: ${block.uuid} with task: ${task.id} : ${task.title}`);
  console.debug('Remote' + task.updated);
  console.debug(task);
  console.debug('Local ' + block.properties?.["googleTaskUpdated"]);
  console.debug(block);

  // Get list object if list is a string
  if (typeof list === 'string') {
    const res = await fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${list}`, {
      headers: { 'Authorization': `Bearer ${logseq.settings!.access_token}` }
    });
    list = await res.json() as gapi.client.tasks.Task;
  }

  let blockNew = await blockContentGenerate(list, task);

  console.debug(blockNew);

  await logseq.Editor.updateBlock(block.uuid, blockNew.content, { properties: blockNew.properties });

  // Handle notes and links update
  let res: any = await logseq.DB.datascriptQuery(`[:find (pull ?b [*]) :where [?b :block/parent ?a] [?a :block/uuid ?uuid] [(str ?uuid) ?str] [(= ?str "${block.uuid}")]]`);
  if (res) {
    console.debug(res);
    for (let child of res) {
      if (child[0].properties && (child[0].properties["google-task-context"] === "notes" || child[0].properties["google-task-context"] === "links")) {
        await logseq.Editor.removeBlock(child[0].uuid);
      }
    }
  }
  if (blockNew.children && blockNew.children.length > 0) {
    await logseq.Editor.insertBatchBlock(block.uuid, blockNew.children, { sibling: false });
  }
}

/**
 * Generates a batch block based on the provided task.
 * @param list - The task list object.
 * @param task - The task object.
 *   {
 *     "kind": string,
 *     "id": string,
 *     "etag": string,
 *     "title": string,
 *     "updated": string,
 *     "selfLink": string,
 *     "parent": string,
 *     "position": string,
 *     "notes": string,
 *     "status": string,
 *     "due": string,
 *     "completed": string,
 *     "deleted": boolean,
 *     "hidden": boolean,
 *     "links": [
 *       {
 *         "type": string,
 *         "description": string,
 *         "link": string
 *       }
 *     ],
 *     "webViewLink": string
 *   }
 * @returns A promise that resolves to the generated batch block.
 */
async function blockContentGenerate(list: gapi.client.tasks.TaskList, task: gapi.client.tasks.Task): Promise<IBatchBlock> {
  const { preferredDateFormat, preferredTodo } = await logseq.App.getUserConfigs();

  let title = task.title;

  // Create a block for the task title
  const taskBlock: IBatchBlock = {
    content: `${title} #Task`,
  };

  taskBlock.properties = {};
  taskBlock.properties["logseq.property/status"] = task.status === 'completed' ? 'Done' : 'Todo';
  taskBlock.properties["google-task-id"] = task.id;
  taskBlock.properties["google-task-list-id"] = list.id;
  taskBlock.properties["google-task-list-ref"] = `[[GTasks/${list.title}]]`;
  taskBlock.properties["google-task-updated"] = task.updated;
  taskBlock.properties["google-task-webViewLink"] = task.webViewLink;
  if (task.hidden) {
    taskBlock.properties["google-task-hidden"] = task.hidden;
  }
  if (task.deleted) {
    taskBlock.properties["google-task-deleted"] = task.deleted;
  }

  // add completion date to Logseq
  if (logseq.settings?.addCompletionDate && task.completed) {
    const taskCompletedDate = format(new Date(task.completed), preferredDateFormat);
    taskBlock.properties["completed"] = `[[${taskCompletedDate}]]`;
  }

  // Create a child block for the task notes
  if (task.notes) {
    const notesBlock: IBatchBlock = {
      content: task.notes || '',
      properties: {
        "google-task-context": "notes",
      },
      children: [],
    };
    taskBlock.children = [];
    taskBlock.children.push(notesBlock);
  }

  // Create a child block for the task links
  // For now just dump the links as a code block
  // Next step is to parse the links and create proper blocks to reference
  if (task.links && task.links.length > 0) {
    const linksBlock: IBatchBlock = {
      content: `\`\`\`\n${JSON.stringify(task.links, null, 2)}\n\`\`\``,
      properties: {
        "google-task-context": "links",
      },
      children: [],
    };
    taskBlock.children = [];
    taskBlock.children.push(linksBlock);
  }

  return taskBlock;
}

/**
 * Generates the parent name for a task based on the preferred date format.
 * @param list - The list containing the task.
 * @param task - The task for which to generate the parent name.
 * @returns A string representing the parent name.
 * @throws An error if neither the updated date nor the due date is available for the task.
 */
async function generateParentName(list: gapi.client.tasks.TaskList, task: gapi.client.tasks.Task): Promise<string> {
  const { preferredDateFormat } = await logseq.App.getUserConfigs();
  const taskUpdatedDate = task.updated ? new Date(task.updated) : null;
  const taskDueDate = task.due ? new Date(task.due) : null;

  let earliestDate;

  if (taskUpdatedDate && taskDueDate) {
    earliestDate = taskUpdatedDate < taskDueDate ? taskUpdatedDate : taskDueDate;
  } else {
    earliestDate = taskUpdatedDate || taskDueDate;
  }

  if (!earliestDate) {
    throw new Error("Neither updated date nor due date is available for the task.");
  }

  return `${format(earliestDate, preferredDateFormat)}`;
}

/**
 * Pushes local changes to a Google Tasks task based on a Logseq block.
 * @param block - The Logseq block representing the task.
 * @param task - The Google Tasks task to be updated.
 * @returns A Promise that resolves when the task has been updated.
 */
async function pushLocalChanges(block: BlockEntity, task: gapi.client.tasks.Task) {
  const { preferredDateFormat } = await logseq.App.getUserConfigs();

  let needsUpdate = false;
  let taskNew = { ...task };
  let taskTitle = (block.content || "")
    .replace(/\nDEADLINE: [^\n]*/g, '')
    .replace(/\n[^\n]*:: [^\n]*/g, '')
    .replace(/^[^\n]*:: [^\n]*\n/g, '')
    .replace(/#\[\[.*?\]\]/g, '') // Strip Logseq DB 2.0 internal UUID tag refs
    .replace(/#[^\s]+/g, '')      // Strip normal tags like #Task
    .trim();
    
  if (taskTitle !== task.title?.trim()) {
    console.debug(`Title changed locally. Old: "${task.title}", New: "${taskTitle}"`);
    taskNew.title = taskTitle;
    needsUpdate = true;
  }

  // Handle status update — resolve via DataScript since SDK returns {:db/id N}
  let localStatus = '';
  try {
    const statusQuery = `
      [:find ?status-str
       :where
       [?b :block/uuid #uuid "${block.uuid}"]
       [?b :logseq.property/status ?sv]
       [?sv :block/title ?status-str]
      ]
    `;
    const statusRes = await logseq.DB.datascriptQuery(statusQuery);
    if (statusRes && statusRes.length > 0) {
      localStatus = (statusRes[0][0] || '').toLowerCase();
    }
  } catch (e) {
    console.warn(`#${pluginId}: Could not resolve status for block ${block.uuid}`, e);
  }
  const completedMarkers = ['done', 'cancelled', 'canceled'];
  const actionMarkers = ['todo', 'doing', 'now', 'later', 'waiting'];

  if (completedMarkers.includes(localStatus) && task.status === 'needsAction') {
    taskNew.status = 'completed';
    // Logseq by default does not have completed date recorded for tasks.
    // This is now a feature provided by a plugin, which links to a jdournal,
    // page, there is a possiblity that completed date is not recorded.
    if (block.properties?.completed) {
      if (typeof block.properties?.completed == 'string') {
        taskNew.completed = format(parse((block.properties.completed || '').replace(/\[\[|\]\]/g, ''), preferredDateFormat, new Date()), 'yyyy-MM-dd') + 'T00:00:00.000Z'
      }
      else {
        taskNew.completed = format(parse(block.properties.completed[0], preferredDateFormat, new Date()), 'yyyy-MM-dd') + 'T00:00:00.000Z';
      }
    }
    needsUpdate = true;
  }
  if (actionMarkers.includes(localStatus) && task.status === 'completed') {
    taskNew.status = 'needsAction';
    delete taskNew.completed;
    needsUpdate = true;
  }

  // Handle deadline, format is 20240202
  if (block.deadline) {
    let deadlineFormatted = block.deadline.toString().slice(0, 4) + '-' + block.deadline.toString().slice(4, 6) + '-' + block.deadline.toString().slice(6, 8);
    if (!task.due || format(new Date(deadlineFormatted), 'yyyy-MM-dd') !== format(new Date(task.due as string), 'yyyy-MM-dd')) {
      console.debug(format(new Date(deadlineFormatted), 'yyyy-MM-dd') + 'T00:00:00.000Z');
      console.debug(task.due);
      taskNew.due = format(new Date(deadlineFormatted), 'yyyy-MM-dd') + 'T00:00:00.000Z';
      needsUpdate = true;
    }
  }

  // todo handle notes
  // Don't hanlde notes for now, as Logseq does not properly hanlde notes with newlines started '-'
  // Some imported notes are incomplete, we can't really tell if it is a bad import or a local update
  //let res = await logseq.DB.datascriptQuery(`[:find (pull ?b [*]) :where [?b :block/parent ?a] [?a :block/uuid ?uuid] [(str ?uuid) ?str] [(= ?str "${block.uuid}")]]`);
  //if (res) {
  //  for (let child of res) {
  //    if (child[0].properties["google-task-context"] === "notes") {
  //      let taskNotes = child[0].content
  //        .replace(/^(DONE|TODO)? /, '')
  //        .replace(/\nDEADLINE: [^\n]*/g, '')
  //        .replace(/\n[^\n]*:: [^\n]*/g, '')
  //        .replace(/^[^\n]*:: [^\n]*\n/g, '');
  //      if (taskNotes.trim() !== task.notes?.trim()) {
  //        console.debug(taskNotes);
  //        console.debug(task.notes);
  //        //taskNew.notes = taskNotes;
  //        //needsUpdate = true;
  //      }
  //    }
  //  }
  //}

  if (needsUpdate) {
    console.debug(block);
    console.debug(taskNew);

    // Resolve google-task-list-id via DataScript (SDK returns {:db/id N})
    let taskListId: string | null = null;
    try {
      const listIdQuery = `
        [:find ?lid-str
         :where
         [?b :block/uuid #uuid "${block.uuid}"]
         (or
           [?b :plugin.property.logseq-google-tasks/google-task-list-id ?pv]
           [?b :plugin.property._test_plugin/google-task-list-id ?pv]
         )
         [?pv :block/title ?lid-str]
        ]
      `;
      const listIdRes = await logseq.DB.datascriptQuery(listIdQuery);
      if (listIdRes && listIdRes.length > 0) {
        taskListId = listIdRes[0][0];
      }
    } catch (e) {
      console.error(`#${pluginId}: Could not resolve google-task-list-id for block ${block.uuid}`, e);
    }
    
    if (!taskListId) {
      console.warn(`#${pluginId}: Missing google-task-list-id property on block ${block.uuid}, skipping.`);
      return;
    }
    const putRes = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskNew.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${logseq.settings!.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskNew)
    });
    if (!putRes.ok) throw new Error(`Failed to update task: ${putRes.statusText}`);

    const getRes = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskNew.id}`, {
      headers: { 'Authorization': `Bearer ${logseq.settings!.access_token}` }
    });
    if (!getRes.ok) throw new Error(`Failed to fetch updated task: ${getRes.statusText}`);
    let updatedTask = await getRes.json();

    console.debug(updatedTask);

    updateTaskBlock(block, taskListId as string, updatedTask as gapi.client.tasks.Task);

    console.info(`#${pluginId}: ` + `Task ${task.id} has been changed locally`);
  }
}

/**
 * Scans Google Tasks for titles corrupted with Logseq internal refs and fixes them.
 */
export async function fixCorruptedTitles() {
  logseq.UI.showMsg("Scanning Google Tasks for corrupted titles...", "info");
  
  const taskLists = await fetchTaskLists();
  if (!taskLists) {
    logseq.UI.showMsg("Could not fetch task lists.", "error");
    return;
  }

  let fixedCount = 0;
  for (const list of taskLists) {
    const tasks = await fetchTasks(list.id as string, null);
    if (!tasks) continue;

    for (const task of tasks) {
      if (task.title && task.title.includes('#[[')) {
        const newTitle = task.title.replace(/#\[\[.*?\]\]/g, '').trim();
        
        console.info(`#${pluginId}: Fixing corrupted title: "${task.title}" -> "${newTitle}"`);
        
        try {
          const putRes = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks/${task.id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${logseq.settings!.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ...task,
              title: newTitle
            })
          });

          if (putRes.ok) {
            fixedCount++;
          } else {
            console.error(`#${pluginId}: Failed to fix task ${task.id}: ${putRes.statusText}`);
          }
          
          // Google Tasks API strict rate limits: sleep 500ms to stay well under
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            console.error(`#${pluginId}: Failed to fix task ${task.id}`, e);
        }
      }
    }
  }

  if (fixedCount > 0) {
      logseq.UI.showMsg(`Successfully fixed ${fixedCount} corrupted task titles!`, "success");
  } else {
      logseq.UI.showMsg("No corrupted task titles found.", "success");
  }
}
