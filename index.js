// 态度与状态 · v8.2 · 仓库入口
(function () {
  'use strict';

  // 远程文件下载完成前脚本可能已被关闭；此时不再挂载界面。
  if (window.parent !== window && (window.frameElement === null || window.frameElement?.isConnected === false)) return;

  let doc = document;
  let win = window;

  try {
    if (window.parent && window.parent !== window) {
      doc = window.parent.document;
      win = window.parent;
    }
  } catch (_error) {
    doc = document;
    win = window;
  }

  const ROOT_ID = 'th-current-attitude-window-v7';
  const STYLE_ID = 'th-current-attitude-window-style-v7';
  const PANEL_ID = 'th-current-attitude-window-panel-v7';
  const ORB_ID = 'th-current-attitude-entry-v8';
  const SHORTCUT_NAME = '态度与状态';
  const SWITCH_SHORTCUT_NAME = '切换显示方式';
  const STORAGE_KEY = 'user对各角色的当前态度';
  const LEGACY_STORAGE_KEY = 'user对char的当前态度';
  const PROMPT_ID = 'th-current-attitude-prompt-v5';
  const REGISTRY_KEY = '__thCurrentAttitudeOrbV5Registry';
  const POSITION_STORAGE_KEY = 'th-current-attitude-window-position-v7';
  const ORB_POSITION_STORAGE_KEY = 'th-current-attitude-orb-position-v5';
  const DISPLAY_STORAGE_KEY = 'th-current-attitude-display-mode-v8';
  const OWNER_ATTR = 'data-th-attitude-owner';
  const OWNER_TOKEN = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const SAVE_DELAY_MS = 350;
  const DRAG_THRESHOLD_PX = 6;
  const VIEWPORT_MARGIN_PX = 8;
  const ORB_SIZE_PX = 52;
  const DATA_VERSION = 3;
  const DEFAULT_ENTRY = Object.freeze({ affection: 5, impression: '平平无奇', remark: '', active: true });
  const DEFAULT_USER_STATUS = Object.freeze({ stamina: 100, mood: 50 });

  const LEGACY_IDS = [
    'th-user-char-current-attitude-widget',
    'th-user-char-current-attitude-widget-style',
    'th-user-char-current-attitude-widget-v3',
    'th-user-char-current-attitude-widget-style-v3',
    'th-attitude-circle-widget-v1',
    'th-attitude-circle-widget-style-v1',
  ];
  const LEGACY_PROMPT_IDS = ['th-user-char-current-attitude-prompt-v1'];

  let root = null;
  let panel = null;
  let orb = null;
  let orbCleanup = null;
  let displayMode = 'shortcut';
  let panelCloseTimer = null;
  let dragHandle = null;
  let closeButton = null;
  let targetSelect = null;
  let activeToggle = null;
  let addTargetButton = null;
  let menuButton = null;
  let targetMenu = null;
  let renameTargetButton = null;
  let removeTargetButton = null;
  let targetToolbar = null;
  let targetEditor = null;
  let targetNameInput = null;
  let confirmTargetButton = null;
  let cancelTargetButton = null;
  let attitudeTab = null;
  let userStatusTab = null;
  let attitudeView = null;
  let userStatusView = null;
  let affectionInput = null;
  let impressionInput = null;
  let remarkInput = null;
  let staminaRange = null;
  let staminaNumber = null;
  let moodRange = null;
  let moodNumber = null;
  let status = null;
  let saveTimer = null;
  let retryTimer = null;
  let destroyed = false;
  let mounted = false;
  let openRequested = false;
  let switchRequested = false;
  let hydrating = false;
  let state = createEmptyState();
  let currentView = 'attitude';
  let targetEditMode = null;
  let lastSavedSignature = '';
  let lastPromptContent = '';
  let chatSubscription = null;
  let generationSubscription = null;
  let shortcutSubscription = null;
  let switchSubscription = null;
  let uiCleanup = null;
  let cancelActiveDrag = null;

  function getApi(name) {
    try {
      if (typeof window[name] === 'function') return window[name];
    } catch (_error) {}
    try {
      if (typeof window.TavernHelper?.[name] === 'function') return window.TavernHelper[name];
    } catch (_error) {}
    return null;
  }

  function getEvents() {
    try {
      return window.tavern_events || window.TavernHelper?.tavern_events || null;
    } catch (_error) {
      return null;
    }
  }

  function createEmptyState() {
    return {
      version: DATA_VERSION,
      order: [],
      selectedId: '',
      entries: {},
      suppressedAutoNames: [],
      userStatus: {
        stamina: DEFAULT_USER_STATUS.stamina,
        mood: DEFAULT_USER_STATUS.mood,
      },
    };
  }

  function clampStatusValue(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  function makeEntryId() {
    return 'target-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function cleanName(value) {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function normalizedName(value) {
    return cleanName(value).toLocaleLowerCase();
  }

  function createEntry(name, source = 'manual', values = {}) {
    const parsedAffection = Number(values.affection);
    return {
      id: makeEntryId(),
      name: cleanName(name) || '当前角色',
      affection: Number.isFinite(parsedAffection) ? parsedAffection : DEFAULT_ENTRY.affection,
      impression: String(values.impression ?? DEFAULT_ENTRY.impression),
      remark: String(values.remark ?? DEFAULT_ENTRY.remark).trim(),
      active: values.active !== false,
      source,
    };
  }

  function currentEntry() {
    return state.entries[state.selectedId] || null;
  }

  function findEntryByName(name) {
    const wanted = normalizedName(name);
    if (!wanted) return null;
    for (const id of state.order) {
      const entry = state.entries[id];
      if (entry && normalizedName(entry.name) === wanted) return entry;
    }
    return null;
  }

  function suppressAutoName(name) {
    const wanted = normalizedName(name);
    if (!state.suppressedAutoNames.some(value => normalizedName(value) === wanted)) {
      state.suppressedAutoNames.push(cleanName(name));
    }
  }

  function addEntry(name, source = 'manual', values = {}) {
    const cleaned = cleanName(name);
    if (!cleaned) return { entry: null, added: false };
    const existing = findEntryByName(cleaned);
    if (existing) return { entry: existing, added: false };
    const entry = createEntry(cleaned, source, values);
    state.entries[entry.id] = entry;
    state.order.push(entry.id);
    if (!state.selectedId) state.selectedId = entry.id;
    state.suppressedAutoNames = state.suppressedAutoNames.filter(value => normalizedName(value) !== normalizedName(cleaned));
    return { entry, added: true };
  }

  function macroValue(template) {
    const substitute = getApi('substitudeMacros');
    if (!substitute) return '';
    try {
      const result = String(substitute.call(window, template) ?? '').trim();
      return /\{\{[^}]+\}\}/.test(result) ? '' : result;
    } catch (_error) {
      return '';
    }
  }

  function getParticipantContext() {
    const soloName = cleanName(macroValue('{{charIfNotGroup}}'));
    if (soloName) return { isGroup: false, names: [soloName] };

    const groupValue = macroValue('{{group}}');
    if (groupValue) {
      const names = [...new Set(groupValue.split(/[,，\n]+/).map(cleanName).filter(Boolean))];
      if (names.length) return { isGroup: true, names };
    }

    const currentName = cleanName(macroValue('{{char}}'));
    return { isGroup: false, names: [currentName || '当前角色'] };
  }

  function syncParticipants(seedSolo = false) {
    const participantContext = getParticipantContext();
    const shouldSync = participantContext.isGroup || (seedSolo && state.order.length === 0);
    if (!shouldSync) return false;

    let changed = false;
    const suppressed = new Set(state.suppressedAutoNames.map(normalizedName));
    for (const name of participantContext.names) {
      if (suppressed.has(normalizedName(name))) continue;
      const result = addEntry(name, participantContext.isGroup ? 'group' : 'card');
      if (result.added) changed = true;
    }
    return changed;
  }

  function serializeState() {
    const roles = {};
    for (const id of state.order) {
      const entry = state.entries[id];
      if (!entry) continue;
      roles[id] = {
        名称: entry.name,
        好感: entry.affection,
        印象: entry.impression,
        本轮注入: entry.active,
        来源: entry.source,
      };
      if (entry.remark) roles[id].备注 = entry.remark;
    }
    return {
      版本: DATA_VERSION,
      当前对象: state.selectedId,
      顺序: state.order.filter(id => Boolean(state.entries[id])),
      角色: roles,
      忽略的群成员: [...state.suppressedAutoNames],
      用户状态: {
        体力: state.userStatus.stamina,
        心情: state.userStatus.mood,
      },
    };
  }

  function signature(value = state) {
    if (value !== state) return JSON.stringify(value);
    return JSON.stringify(serializeState());
  }

  function removeLegacyDom() {
    for (const id of LEGACY_IDS) {
      try {
        doc.getElementById(id)?.remove();
      } catch (_error) {}
    }
  }

  function removeCurrentDom(force = false) {
    for (const id of [ROOT_ID, STYLE_ID, ORB_ID]) {
      try {
        const element = doc.getElementById(id);
        if (element && (force || element.getAttribute(OWNER_ATTR) === OWNER_TOKEN)) element.remove();
      } catch (_error) {}
    }
  }

  function injectStyle() {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute(OWNER_ATTR, OWNER_TOKEN);
    style.textContent = `
#${ROOT_ID}, #${ORB_ID} {
  --th-attitude-surface: var(--SmartThemeBlurTintColor, rgba(28,27,34,.97));
  --th-attitude-ink: var(--SmartThemeBodyColor, #f5f3f7);
  --th-attitude-border: var(--SmartThemeBorderColor, rgba(255,255,255,.22));
  --th-attitude-control: color-mix(in srgb, var(--th-attitude-surface) 86%, var(--th-attitude-ink) 14%);
  --th-attitude-control-active: color-mix(in srgb, var(--th-attitude-surface) 78%, var(--th-attitude-ink) 22%);
  font-family: inherit !important;
  translate: none !important;
}
#${ORB_ID} {
  appearance: none !important;
  -webkit-appearance: none !important;
  position: fixed !important;
  width: ${ORB_SIZE_PX}px !important;
  height: ${ORB_SIZE_PX}px !important;
  min-width: ${ORB_SIZE_PX}px !important;
  min-height: ${ORB_SIZE_PX}px !important;
  margin: 0 !important;
  padding: 0 !important;
  display: grid !important;
  place-items: center !important;
  box-sizing: border-box !important;
  border: 1px solid var(--th-attitude-border) !important;
  border-color: color-mix(in srgb, var(--th-attitude-surface) 75%, black 25%) !important;
  border-radius: 50% !important;
  background: var(--th-attitude-surface) !important;
  box-shadow: 0 3px 8px rgba(0,0,0,.15) !important;
  color: var(--th-attitude-ink) !important;
  z-index: 2147483646 !important;
  visibility: visible !important;
  opacity: 1 !important;
  cursor: grab !important;
  touch-action: none !important;
  pointer-events: auto !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  -webkit-user-drag: none !important;
  -webkit-tap-highlight-color: transparent !important;
  transition: transform .16s ease, filter .16s ease !important;
}
#${ORB_ID}:active { transform: scale(.94) !important; }
#${ORB_ID}[data-dragging="true"] { cursor: grabbing !important; transform: scale(.96) !important; }
#${ORB_ID}[aria-expanded="true"] { filter: brightness(1.09) !important; }
#${ORB_ID} svg {
  width: 22px !important;
  height: 22px !important;
  display: block !important;
  fill: currentColor !important;
  opacity: .7 !important;
  pointer-events: none !important;
  transition: opacity .16s ease !important;
}
#${ORB_ID}:active svg, #${ORB_ID}[aria-expanded="true"] svg { opacity: 1 !important; }
#${ROOT_ID} {
  position: fixed !important;
  top: 8px !important;
  left: 8px !important;
  right: auto !important;
  bottom: auto !important;
  width: min(252px, calc(100vw - 16px)) !important;
  max-width: var(--th-window-max-width, calc(100vw - 16px)) !important;
  height: auto !important;
  z-index: 2147483647 !important;
  overflow: visible !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
#${ROOT_ID}[hidden] { display: none !important; }
#${ROOT_ID}, #${ROOT_ID} * { box-sizing: border-box !important; }
#${ROOT_ID} .th-attitude-panel {
  position: relative !important;
  top: auto !important;
  right: auto !important;
  width: 100% !important;
  max-height: var(--th-window-max-height, calc(100vh - 16px)) !important;
  margin: 0 !important;
  padding: 10px !important;
  overflow: auto !important;
  border: 1px solid var(--th-attitude-border) !important;
  border-radius: 14px !important;
  background: var(--th-attitude-surface) !important;
  box-shadow: 0 3px 8px rgba(0,0,0,.15) !important;
  color: var(--th-attitude-ink) !important;
  pointer-events: auto !important;
  overscroll-behavior: contain !important;
}
#${ROOT_ID} .th-attitude-panel[hidden] { display: none !important; }
#${ROOT_ID} .th-attitude-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 5px !important;
  margin: 0 0 7px !important;
  cursor: grab !important;
  touch-action: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
#${ROOT_ID}[data-dragging="true"] .th-attitude-head { cursor: grabbing !important; }
#${ROOT_ID} .th-attitude-grip {
  flex: 0 0 12px !important;
  align-self: stretch !important;
  background: linear-gradient(currentColor, currentColor) center calc(50% - 2px) / 10px 1px no-repeat,
    linear-gradient(currentColor, currentColor) center calc(50% + 2px) / 10px 1px no-repeat !important;
  opacity: .44 !important;
}
#${ROOT_ID} .th-attitude-close {
  appearance: none !important;
  -webkit-appearance: none !important;
  display: grid !important;
  place-items: center !important;
  flex: 0 0 28px !important;
  width: 28px !important;
  height: 30px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 30px !important;
  margin: 0 !important;
  padding: 0 !important;
  font-size: 21px !important;
  line-height: 1 !important;
  cursor: pointer !important;
  opacity: .72 !important;
  -webkit-tap-highlight-color: transparent !important;
}
#${ROOT_ID}[data-display-mode="orb"] .th-attitude-grip,
#${ROOT_ID}[data-display-mode="orb"] .th-attitude-close { display: none !important; }
#${ROOT_ID}[data-display-mode="orb"] .th-attitude-head {
  gap: 8px !important;
  cursor: default !important;
  touch-action: auto !important;
}
#${ROOT_ID}[data-display-mode="orb"] .th-attitude-panel {
  transform-origin: var(--th-orb-origin, right top) !important;
  animation: th-attitude-panel-in .18s ease both !important;
}
#${ROOT_ID}[data-display-mode="orb"][data-closing="true"],
#${ROOT_ID}[data-display-mode="orb"][data-closing="true"] .th-attitude-panel { pointer-events: none !important; }
#${ROOT_ID}[data-display-mode="orb"][data-closing="true"] .th-attitude-panel {
  animation: th-attitude-panel-out .14s ease both !important;
}
#${ROOT_ID} .th-attitude-tabs {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
}
#${ROOT_ID} .th-attitude-tab {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 42px !important;
  min-width: 42px !important;
  min-height: 0 !important;
  height: 25px !important;
  max-height: 25px !important;
  margin: 0 !important;
  padding: 0 5px !important;
  font-size: 12px !important;
  line-height: 1 !important;
  opacity: .58 !important;
  cursor: pointer !important;
  -webkit-tap-highlight-color: transparent !important;
}
#${ROOT_ID} .th-attitude-tab[aria-selected="true"] {
  opacity: .96 !important;
}
#${ROOT_ID} .th-attitude-status {
  margin-left: auto !important;
  font-size: 11px !important;
  line-height: 1.2 !important;
  opacity: .64 !important;
  white-space: nowrap !important;
}
#${ROOT_ID} .th-attitude-status[data-kind="dirty"] { opacity: .84 !important; }
#${ROOT_ID} .th-attitude-status[data-kind="error"] { color: var(--SmartThemeEmColor, #ff949e) !important; opacity: 1 !important; }
#${ROOT_ID} .th-attitude-view[hidden] { display: none !important; }
#${ROOT_ID} .th-attitude-target-wrap {
  position: relative !important;
  margin: 0 0 2px !important;
}
#${ROOT_ID} .th-attitude-target-toolbar {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 48px 30px 30px !important;
  align-items: center !important;
  gap: 5px !important;
}
#${ROOT_ID} .th-attitude-target-editor {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 30px 30px !important;
  align-items: center !important;
  gap: 5px !important;
}
#${ROOT_ID} .th-attitude-target-toolbar[hidden],
#${ROOT_ID} .th-attitude-target-editor[hidden],
#${ROOT_ID} .th-attitude-target-menu[hidden] { display: none !important; }
#${ROOT_ID} .th-attitude-target-select,
#${ROOT_ID} .th-attitude-target-name,
#${ROOT_ID} .th-attitude-mini-button {
  appearance: none !important;
  -webkit-appearance: none !important;
  height: 32px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 32px !important;
  margin: 0 !important;
  font-size: 12px !important;
}
#${ROOT_ID} .th-attitude-target-name {
  border: 1px solid var(--th-attitude-border) !important;
  border-radius: 8px !important;
  outline: none !important;
  background: var(--th-attitude-control) !important;
  color: inherit !important;
  font-family: inherit !important;
}
#${ROOT_ID} .th-attitude-target-select {
  width: 100% !important;
  padding: 0 22px 0 8px !important;
  text-overflow: ellipsis !important;
  cursor: pointer !important;
}
#${ROOT_ID} .th-attitude-select-wrap {
  position: relative !important;
  min-width: 0 !important;
}
#${ROOT_ID} .th-attitude-select-arrow {
  position: absolute !important;
  top: 50% !important;
  right: 8px !important;
  transform: translateY(-50%) !important;
  font-size: 10px !important;
  line-height: 1 !important;
  pointer-events: none !important;
}
#${ROOT_ID} .th-attitude-target-name {
  width: 100% !important;
  padding: 0 9px !important;
}
#${ROOT_ID} .th-attitude-mini-button {
  display: grid !important;
  place-items: center !important;
  padding: 0 !important;
  cursor: pointer !important;
  line-height: 1 !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  -webkit-tap-highlight-color: transparent !important;
}
#${ROOT_ID} .th-attitude-active-toggle {
  width: 48px !important;
  font-size: 11px !important;
  opacity: .52 !important;
}
#${ROOT_ID} .th-attitude-active-toggle[data-active="true"] {
  opacity: .92 !important;
}
#${ROOT_ID} .th-attitude-add,
#${ROOT_ID} .th-attitude-menu-button,
#${ROOT_ID} .th-attitude-editor-confirm,
#${ROOT_ID} .th-attitude-editor-cancel { width: 30px !important; font-size: 16px !important; }
#${ROOT_ID} .th-attitude-target-menu {
  position: absolute !important;
  z-index: 4 !important;
  top: 39px !important;
  right: 0 !important;
  width: 116px !important;
  padding: 5px !important;
  display: grid !important;
  gap: 4px !important;
  border: 1px solid var(--th-attitude-border) !important;
  border-radius: 10px !important;
  background: var(--th-attitude-surface) !important;
  box-shadow: 0 3px 8px rgba(0,0,0,.15) !important;
}
#${ROOT_ID} .th-attitude-target-menu button {
  appearance: none !important;
  width: 100% !important;
  height: 30px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 30px !important;
  margin: 0 !important;
  padding: 0 5px !important;
  font-size: 12px !important;
  text-align: left !important;
}
#${ROOT_ID} .th-attitude-field {
  display: grid !important;
  grid-template-columns: 42px minmax(0, 1fr) !important;
  align-items: center !important;
  gap: 7px !important;
  margin: 5px 0 0 !important;
}
#${ROOT_ID} .th-attitude-label {
  font-size: 12px !important;
  line-height: 1.3 !important;
  font-weight: 650 !important;
  opacity: .88 !important;
}
/* 输入框通过 text_pole 沿用当前美化，只固定小面板所需的尺寸。 */
#${ROOT_ID} .th-attitude-input {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 100% !important;
  min-width: 0 !important;
  height: 32px !important;
  min-height: 0 !important;
  max-height: 32px !important;
  margin: 0 !important;
  padding-block: 0 !important;
  font-size: 13px !important;
}
#${ROOT_ID} .th-user-status-list {
  display: grid !important;
  gap: 7px !important;
  padding: 1px 0 !important;
}
#${ROOT_ID} .th-user-status-field {
  display: grid !important;
  grid-template-columns: 34px minmax(0, 1fr) 38px !important;
  align-items: center !important;
  gap: 7px !important;
  min-height: 32px !important;
}
#${ROOT_ID} .th-user-status-label {
  font-size: 12px !important;
  line-height: 1 !important;
  font-weight: 650 !important;
  opacity: .88 !important;
}
/* 滑块外观由当前美化接管；这里只保留滑杆布局和交互区域。 */
#${ROOT_ID} .th-user-status-range {
  --th-status-progress: 50%;
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 100% !important;
  height: 28px !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  outline: none !important;
  background: linear-gradient(to right,
    color-mix(in srgb, var(--th-attitude-ink) 72%, transparent) 0%,
    color-mix(in srgb, var(--th-attitude-ink) 72%, transparent) var(--th-status-progress),
    color-mix(in srgb, var(--th-attitude-border) 76%, transparent) var(--th-status-progress),
    color-mix(in srgb, var(--th-attitude-border) 76%, transparent) 100%) center / 100% 4px no-repeat !important;
  cursor: pointer !important;
  touch-action: pan-y !important;
  -webkit-tap-highlight-color: transparent !important;
}
#${ROOT_ID} .th-user-status-number,
#${ROOT_ID} .th-user-status-number:focus {
  appearance: textfield !important;
  -moz-appearance: textfield !important;
  width: 38px !important;
  height: 28px !important;
  margin: 0 !important;
  padding: 0 3px !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: none !important;
  background: transparent !important;
  box-shadow: none !important;
  color: inherit !important;
  font: inherit !important;
  font-size: 12px !important;
  font-variant-numeric: tabular-nums !important;
  text-align: center !important;
}
#${ROOT_ID} .th-user-status-number::-webkit-outer-spin-button,
#${ROOT_ID} .th-user-status-number::-webkit-inner-spin-button {
  margin: 0 !important;
  -webkit-appearance: none !important;
}
@keyframes th-attitude-panel-in {
  from { opacity: 0; transform: translateY(var(--th-orb-enter-y, -5px)) scale(.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes th-attitude-panel-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(var(--th-orb-enter-y, -5px)) scale(.97); }
}
@media (prefers-reduced-motion: reduce) {
  #${ORB_ID}, #${ORB_ID} svg { transition: none !important; }
  #${ROOT_ID}[data-display-mode="orb"] .th-attitude-panel { animation: none !important; }
}
@media (max-width: 520px) {
  #${ROOT_ID} {
    width: min(246px, calc(100vw - 16px)) !important;
  }
}
`;
    doc.head.appendChild(style);
  }

  function makeElement(tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function mountOrb() {
    if (orb || destroyed || !doc.body) return;
    const nextOrb = makeElement('button', 'th-attitude-orb');
    nextOrb.id = ORB_ID;
    nextOrb.type = 'button';
    nextOrb.setAttribute(OWNER_ATTR, OWNER_TOKEN);
    nextOrb.setAttribute('aria-controls', PANEL_ID);
    nextOrb.setAttribute('aria-expanded', String(root?.dataset.open === 'true'));
    nextOrb.setAttribute('aria-label', root?.dataset.open === 'true' ? '收起态度与状态' : '展开态度与状态');
    nextOrb.title = '点击打开态度与状态，拖动调整位置';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2.25l2.96 5.99 6.61.96-4.78 4.66 1.13 6.58L12 17.39 6.09 20.5l1.13-6.58-4.78-4.66 6.61-.96L12 2.25z');
    svg.appendChild(path);
    nextOrb.appendChild(svg);
    doc.body.appendChild(nextOrb);
    orb = nextOrb;
    restorePosition(orb, ORB_POSITION_STORAGE_KEY);
    const stopOrbPress = bindHostPressBoundary(orb);
    const stopOrbDrag = bindDrag(orb, orb, ORB_POSITION_STORAGE_KEY, () => setPanelOpen(root?.dataset.open !== 'true'));
    orbCleanup = () => { stopOrbDrag(); stopOrbPress(); };
  }

  function removeOrb() {
    orbCleanup?.();
    orbCleanup = null;
    orb?.remove();
    orb = null;
  }

  function readDisplayMode() {
    try {
      return win.localStorage.getItem(DISPLAY_STORAGE_KEY) === 'orb' ? 'orb' : 'shortcut';
    } catch (_error) {
      return 'shortcut';
    }
  }

  function applyDisplayMode() {
    if (root) root.dataset.displayMode = displayMode;
    if (dragHandle) dragHandle.title = displayMode === 'orb' ? '拖动悬浮球可一起移动面板' : '拖住顶部空白处移动窗口';
    if (displayMode === 'orb') mountOrb();
    else removeOrb();
  }

  function setDisplayMode(mode) {
    if (destroyed || !mounted || (mode !== 'orb' && mode !== 'shortcut')) return;
    const modeChanged = displayMode !== mode;
    cancelActiveDrag?.();
    flushSave();
    closeTargetMenu();
    cancelPanelClose();
    hidePanelNow();
    if (modeChanged) {
      try { win.localStorage.removeItem(POSITION_STORAGE_KEY); } catch (_error) {}
    }
    displayMode = mode;
    applyDisplayMode();
    // 内容共用，展示分开：贴球展开面板 / 独立可拖窗口。
    setPanelOpen(true);
    try {
      win.localStorage.setItem(DISPLAY_STORAGE_KEY, mode);
    } catch (_error) {
      setStatus('偏好未保存', 'error');
    }
  }

  function makeField(labelText, type, className) {
    const label = makeElement('label', 'th-attitude-field');
    const caption = makeElement('span', 'th-attitude-label', labelText);
    const input = makeElement('input', 'th-attitude-input text_pole ' + className);
    input.type = type;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', labelText);
    if (type === 'number') {
      input.step = 'any';
      input.inputMode = 'decimal';
    }
    label.append(caption, input);
    return { label, input };
  }

  function makeStatusField(labelText, key) {
    const field = makeElement('div', 'th-user-status-field');
    field.setAttribute('role', 'group');
    field.setAttribute('aria-label', labelText);
    const caption = makeElement('span', 'th-user-status-label', labelText);
    const range = makeElement('input', 'th-user-status-range th-user-status-' + key + '-range');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.setAttribute('aria-label', labelText + '拉条');

    const number = makeElement('input', 'th-user-status-number th-user-status-' + key + '-number');
    number.type = 'number';
    number.min = '0';
    number.max = '100';
    number.step = '1';
    number.inputMode = 'numeric';
    number.autocomplete = 'off';
    number.setAttribute('aria-label', labelText + '数值');
    number.title = '点击输入 0–100';
    field.append(caption, range, number);
    return { field, range, number };
  }

  function buildRoot() {
    const nextRoot = makeElement('div');
    nextRoot.id = ROOT_ID;
    nextRoot.setAttribute(OWNER_ATTR, OWNER_TOKEN);
    nextRoot.dataset.open = 'false';
    nextRoot.dataset.dragging = 'false';
    nextRoot.hidden = true;

    nextRoot.style.setProperty('position', 'fixed', 'important');
    nextRoot.style.setProperty('top', '8px', 'important');
    nextRoot.style.setProperty('left', '8px', 'important');
    nextRoot.style.setProperty('right', 'auto', 'important');
    nextRoot.style.setProperty('bottom', 'auto', 'important');
    nextRoot.style.setProperty('z-index', '2147483647', 'important');
    nextRoot.style.setProperty('display', 'none', 'important');
    nextRoot.style.setProperty('overflow', 'visible', 'important');
    nextRoot.style.setProperty('visibility', 'visible', 'important');
    nextRoot.style.setProperty('opacity', '1', 'important');

    const nextPanel = makeElement('section', 'th-attitude-panel');
    nextPanel.id = PANEL_ID;
    nextPanel.hidden = true;
    nextPanel.setAttribute('aria-hidden', 'true');
    nextPanel.setAttribute('role', 'dialog');
    nextPanel.setAttribute('aria-modal', 'false');
    nextPanel.setAttribute('aria-label', SHORTCUT_NAME);

    const head = makeElement('div', 'th-attitude-head');
    head.title = '拖住顶部空白处移动窗口';
    const grip = makeElement('span', 'th-attitude-grip');
    grip.setAttribute('aria-hidden', 'true');
    const tabs = makeElement('div', 'th-attitude-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '切换态度与状态');
    const nextAttitudeTab = makeElement('button', 'menu_button th-attitude-tab', '态度');
    nextAttitudeTab.type = 'button';
    nextAttitudeTab.dataset.view = 'attitude';
    nextAttitudeTab.setAttribute('role', 'tab');
    nextAttitudeTab.setAttribute('aria-selected', 'true');
    const nextUserStatusTab = makeElement('button', 'menu_button th-attitude-tab', '状态');
    nextUserStatusTab.type = 'button';
    nextUserStatusTab.dataset.view = 'status';
    nextUserStatusTab.setAttribute('role', 'tab');
    nextUserStatusTab.setAttribute('aria-selected', 'false');
    tabs.append(nextAttitudeTab, nextUserStatusTab);
    const nextStatus = makeElement('span', 'th-attitude-status', '已保存');
    nextStatus.dataset.kind = 'saved';
    nextStatus.setAttribute('role', 'status');
    nextStatus.setAttribute('aria-live', 'polite');
    const nextCloseButton = makeElement('button', 'menu_button th-attitude-close', '×');
    nextCloseButton.type = 'button';
    nextCloseButton.title = '保存并关闭窗口';
    nextCloseButton.setAttribute('aria-label', '保存并关闭窗口');
    head.append(grip, tabs, nextStatus, nextCloseButton);

    const nextAttitudeView = makeElement('div', 'th-attitude-view th-attitude-view-attitude');
    nextAttitudeView.dataset.view = 'attitude';
    nextAttitudeView.setAttribute('role', 'tabpanel');

    const nextUserStatusView = makeElement('div', 'th-attitude-view th-attitude-view-status');
    nextUserStatusView.dataset.view = 'status';
    nextUserStatusView.setAttribute('role', 'tabpanel');
    nextUserStatusView.hidden = true;

    const targetWrap = makeElement('div', 'th-attitude-target-wrap');
    const nextTargetToolbar = makeElement('div', 'th-attitude-target-toolbar');
    const selectWrap = makeElement('div', 'th-attitude-select-wrap');
    const nextTargetSelect = makeElement('select', 'menu_button th-attitude-target-select');
    nextTargetSelect.setAttribute('aria-label', '当前态度对象');
    const selectArrow = makeElement('span', 'th-attitude-select-arrow', '▾');
    selectArrow.setAttribute('aria-hidden', 'true');
    selectWrap.append(nextTargetSelect, selectArrow);

    const nextActiveToggle = makeElement('button', 'menu_button th-attitude-mini-button th-attitude-active-toggle', 'AI读取');
    nextActiveToggle.type = 'button';
    nextActiveToggle.dataset.active = 'true';
    nextActiveToggle.setAttribute('aria-pressed', 'true');
    nextActiveToggle.setAttribute('aria-label', '切换是否让AI读取当前角色的态度记录');

    const nextAddTargetButton = makeElement('button', 'menu_button th-attitude-mini-button th-attitude-add', '＋');
    nextAddTargetButton.type = 'button';
    nextAddTargetButton.setAttribute('aria-label', '添加角色');

    const nextMenuButton = makeElement('button', 'menu_button th-attitude-mini-button th-attitude-menu-button', '⋯');
    nextMenuButton.type = 'button';
    nextMenuButton.setAttribute('aria-label', '管理当前角色');
    nextMenuButton.setAttribute('aria-expanded', 'false');

    nextTargetToolbar.append(selectWrap, nextActiveToggle, nextAddTargetButton, nextMenuButton);

    const nextTargetEditor = makeElement('div', 'th-attitude-target-editor');
    nextTargetEditor.hidden = true;
    const nextTargetNameInput = makeElement('input', 'th-attitude-target-name');
    nextTargetNameInput.type = 'text';
    nextTargetNameInput.autocomplete = 'off';
    nextTargetNameInput.setAttribute('aria-label', '角色名称');
    const nextConfirmTargetButton = makeElement('button', 'menu_button th-attitude-mini-button th-attitude-editor-confirm', '✓');
    nextConfirmTargetButton.type = 'button';
    nextConfirmTargetButton.setAttribute('aria-label', '确认');
    const nextCancelTargetButton = makeElement('button', 'menu_button th-attitude-mini-button th-attitude-editor-cancel', '×');
    nextCancelTargetButton.type = 'button';
    nextCancelTargetButton.setAttribute('aria-label', '取消');
    nextTargetEditor.append(nextTargetNameInput, nextConfirmTargetButton, nextCancelTargetButton);

    const nextTargetMenu = makeElement('div', 'th-attitude-target-menu');
    nextTargetMenu.hidden = true;
    const nextRenameTargetButton = makeElement('button', 'menu_button', '重命名当前角色');
    nextRenameTargetButton.type = 'button';
    const nextRemoveTargetButton = makeElement('button', 'menu_button', '移除当前角色');
    nextRemoveTargetButton.type = 'button';
    nextTargetMenu.append(nextRenameTargetButton, nextRemoveTargetButton);
    targetWrap.append(nextTargetToolbar, nextTargetEditor, nextTargetMenu);

    const affectionField = makeField('好感', 'number', 'th-attitude-affection');
    const impressionField = makeField('印象', 'text', 'th-attitude-impression');
    const remarkField = makeField('备注', 'text', 'th-attitude-remark');
    const nextStaminaField = makeStatusField('体力', 'stamina');
    const nextMoodField = makeStatusField('心情', 'mood');
    const statusList = makeElement('div', 'th-user-status-list');
    statusList.append(nextStaminaField.field, nextMoodField.field);

    nextAttitudeView.append(targetWrap, affectionField.label, impressionField.label, remarkField.label);
    nextUserStatusView.append(statusList);
    nextPanel.append(head, nextAttitudeView, nextUserStatusView);
    nextRoot.append(nextPanel);
    doc.body.appendChild(nextRoot);

    root = nextRoot;
    dragHandle = head;
    closeButton = nextCloseButton;
    panel = nextPanel;
    status = nextStatus;
    targetSelect = nextTargetSelect;
    activeToggle = nextActiveToggle;
    addTargetButton = nextAddTargetButton;
    menuButton = nextMenuButton;
    targetMenu = nextTargetMenu;
    renameTargetButton = nextRenameTargetButton;
    removeTargetButton = nextRemoveTargetButton;
    targetToolbar = nextTargetToolbar;
    targetEditor = nextTargetEditor;
    targetNameInput = nextTargetNameInput;
    confirmTargetButton = nextConfirmTargetButton;
    cancelTargetButton = nextCancelTargetButton;
    attitudeTab = nextAttitudeTab;
    userStatusTab = nextUserStatusTab;
    attitudeView = nextAttitudeView;
    userStatusView = nextUserStatusView;
    affectionInput = affectionField.input;
    impressionInput = impressionField.input;
    remarkInput = remarkField.input;
    staminaRange = nextStaminaField.range;
    staminaNumber = nextStaminaField.number;
    moodRange = nextMoodField.range;
    moodNumber = nextMoodField.number;
  }

  function getViewportSize() {
    const viewport = win.visualViewport;
    return {
      left: Number(viewport?.offsetLeft) || 0,
      top: Number(viewport?.offsetTop) || 0,
      width: Number(viewport?.width) || Number(win.innerWidth) || Number(doc.documentElement?.clientWidth) || 360,
      height: Number(viewport?.height) || Number(win.innerHeight) || Number(doc.documentElement?.clientHeight) || 640,
    };
  }

  function setStyleValue(element, property, value, priority = '') {
    if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== priority) {
      element.style.setProperty(property, value, priority);
    }
  }

  function updateWindowBounds(viewport = getViewportSize()) {
    if (!root) return;
    const margin = VIEWPORT_MARGIN_PX * 2;
    setStyleValue(root, '--th-window-max-width', Math.max(1, viewport.width - margin) + 'px');
    // 贴球面板的高度由可用空间决定，拖动时不先重置为全屏高度再改回来。
    if (displayMode !== 'orb' || !orb || root.hidden) {
      setStyleValue(root, '--th-window-max-height', Math.max(1, viewport.height - margin) + 'px');
    }
  }

  function getRootBox(element = root, viewport = getViewportSize()) {
    const isOrb = element === orb;
    let rect = null;
    if (!isOrb) {
      try { rect = element?.getBoundingClientRect?.() || null; } catch (_error) {}
    }
    // 按压/拖动时球自身会缩放；定位使用未缩放的布局尺寸，避免拖动跳位。
    const width = isOrb ? ORB_SIZE_PX : Number(rect?.width) > 0 ? Number(rect.width) : Math.min(viewport.width - 16, viewport.width <= 520 ? 246 : 252);
    const height = isOrb ? ORB_SIZE_PX : Number(rect?.height) > 0 ? Number(rect.height) : Math.min(currentView === 'status' ? 130 : 210, viewport.height - 16);
    let left = isOrb ? Number.parseFloat(element.style.getPropertyValue('left')) : Number(rect?.left);
    let top = isOrb ? Number.parseFloat(element.style.getPropertyValue('top')) : Number(rect?.top);

    if (!Number.isFinite(left)) left = Number.parseFloat(element?.style?.getPropertyValue('left'));
    if (!Number.isFinite(top)) top = Number.parseFloat(element?.style?.getPropertyValue('top'));
    if (!Number.isFinite(left)) left = viewport.left + VIEWPORT_MARGIN_PX;
    if (!Number.isFinite(top)) top = viewport.top + VIEWPORT_MARGIN_PX;
    return { left, top, width, height };
  }

  function clampPosition(left, top, element = root, viewport = getViewportSize(), box = getRootBox(element, viewport)) {
    const minLeft = viewport.left + VIEWPORT_MARGIN_PX;
    const minTop = viewport.top + VIEWPORT_MARGIN_PX;
    return {
      left: Math.max(minLeft, Math.min(left, Math.max(minLeft, viewport.left + viewport.width - box.width - VIEWPORT_MARGIN_PX))),
      top: Math.max(minTop, Math.min(top, Math.max(minTop, viewport.top + viewport.height - box.height - VIEWPORT_MARGIN_PX))),
    };
  }

  function applyPosition(left, top, element = root) {
    if (!element) return;
    setStyleValue(element, 'left', left + 'px', 'important');
    setStyleValue(element, 'top', top + 'px', 'important');
    setStyleValue(element, 'right', 'auto', 'important');
    setStyleValue(element, 'bottom', 'auto', 'important');
    if (element === orb) positionOrbPanel();
  }

  function savePosition(element = root, key = POSITION_STORAGE_KEY) {
    if (!element) return;
    const viewport = getViewportSize();
    const box = getRootBox(element, viewport);
    const freeWindow = element === root && displayMode === 'shortcut';
    const next = freeWindow ? { left: box.left, top: box.top } : clampPosition(box.left, box.top, element, viewport, box);
    applyPosition(next.left, next.top, element);
    try {
      win.localStorage.setItem(key, JSON.stringify(next));
    } catch (_error) {}
  }

  function restorePosition(element = root, key = POSITION_STORAGE_KEY) {
    if (!element) return;
    let saved = null;
    try {
      saved = JSON.parse(win.localStorage.getItem(key) || 'null');
    } catch (_error) {}
    const viewport = getViewportSize();
    const box = getRootBox(element, viewport);
    const isOrb = element === orb;
    const valid = saved && Number.isFinite(saved.left) && Number.isFinite(saved.top);
    const desiredLeft = valid ? saved.left : viewport.left + (isOrb ? viewport.width - box.width - 11 : (viewport.width - box.width) / 2);
    const desiredTop = valid ? saved.top : viewport.top + (isOrb ? 132 : (viewport.height - box.height) / 2);
    const freeWindow = element === root && displayMode === 'shortcut' && valid;
    const next = freeWindow ? { left: desiredLeft, top: desiredTop }
      : clampPosition(desiredLeft, desiredTop, element, viewport, box);
    applyPosition(next.left, next.top, element);
  }

  function positionOrbPanel() {
    if (destroyed || displayMode !== 'orb' || !orb || !root || root.hidden) return;
    const viewport = getViewportSize();
    updateWindowBounds(viewport);
    const ball = getRootBox(orb, viewport);
    const minTop = viewport.top + VIEWPORT_MARGIN_PX;
    const maxBottom = viewport.top + viewport.height - VIEWPORT_MARGIN_PX;
    const below = Math.max(0, maxBottom - ball.top - ball.height - 10);
    const above = Math.max(0, ball.top - 10 - minTop);
    const desiredHeight = Number(panel.scrollHeight) + 2 || getRootBox().height;
    const opensBelow = below >= desiredHeight || below >= above;
    setStyleValue(root, '--th-window-max-height', 'none');
    const box = getRootBox(root, viewport);
    const desiredLeft = ball.left + ball.width - box.width;
    const next = { left: desiredLeft, top: opensBelow ? ball.top + ball.height + 10 : ball.top - box.height - 10 };
    const side = opensBelow ? 'below' : 'above';
    if (root.dataset.side !== side) root.dataset.side = side;
    setStyleValue(root, '--th-orb-origin', (next.left > desiredLeft ? 'left ' : 'right ') + (opensBelow ? 'top' : 'bottom'));
    setStyleValue(root, '--th-orb-enter-y', opensBelow ? '-5px' : '5px');
    applyPosition(next.left, next.top);
  }

  function keepPositionInViewport() {
    if (destroyed) return;
    cancelActiveDrag?.();
    const viewport = getViewportSize();
    updateWindowBounds(viewport);
    if (orb) {
      const box = getRootBox(orb, viewport);
      const next = clampPosition(box.left, box.top, orb, viewport, box);
      applyPosition(next.left, next.top, orb);
    }
  }

  function setStatus(text, kind = 'saved') {
    if (!status || destroyed) return;
    if (status.textContent !== text) status.textContent = text;
    if (status.dataset.kind !== kind) status.dataset.kind = kind;
  }

  function promptSafeName(value) {
    return cleanName(value).replace(/\{\{/g, '｛｛').replace(/\}\}/g, '｝｝');
  }

  function buildPrompt() {
    const activeEntries = state.order
      .map(id => state.entries[id])
      .filter(entry => entry?.active);
    const lines = [
      '<{{user}}的当前状态>',
      '说明：以下为{{user}}当前的体力与心情指数，用于AI把握其外在表现。角色不直接知晓数值。',
      '体力：' + String(state.userStatus.stamina) + '/100（0为耗尽，100为充沛）',
      '心情：' + String(state.userStatus.mood) + '/100（数值越低越低落，数值越高心情越高涨）',
      '</{{user}}的当前状态>',
    ];

    if (activeEntries.length) {
      lines.push(
        '',
        '<{{user}}对各角色的当前单向态度>',
        '说明：以下记录均以{{user}}为态度主体、对应角色为态度对象，用于AI理解{{user}}面对不同角色时的态度差异。角色不直接知晓数值。',
      );

      for (const entry of activeEntries) {
        const name = promptSafeName(entry.name);
        lines.push(
          '<角色态度>',
          '对象：' + name,
          '{{user}}对' + name + '的好感：' + String(entry.affection),
          '{{user}}对' + name + '的印象：' + entry.impression,
        );
        if (entry.remark) lines.push('{{user}}对' + name + '的备注：' + entry.remark);
        lines.push('</角色态度>');
      }
      lines.push('</{{user}}对各角色的当前单向态度>');
    }
    const template = lines.join('\n');

    const substitute = getApi('substitudeMacros');
    if (!substitute) return template;
    try {
      return substitute.call(window, template);
    } catch (_error) {
      return template;
    }
  }

  function injectPrompt(force = false) {
    const inject = getApi('injectPrompts');
    const uninject = getApi('uninjectPrompts');
    if (!inject && !uninject) return;
    const content = buildPrompt();
    if (!force && content === lastPromptContent) return;

    try {
      if (!content) {
        uninject?.call(window, [PROMPT_ID]);
        lastPromptContent = '';
        return;
      }
      inject?.call(window, [{
        id: PROMPT_ID,
        position: 'in_chat',
        depth: 0,
        role: 'user',
        content,
        should_scan: false,
      }]);
      lastPromptContent = content;
    } catch (error) {
      console.error('[当前态度悬浮窗] 提示词注入失败：', error);
    }
  }

  function uninjectAllPrompts() {
    const uninject = getApi('uninjectPrompts');
    if (!uninject) return;
    try {
      uninject.call(window, [PROMPT_ID, ...LEGACY_PROMPT_IDS]);
    } catch (_error) {}
  }

  function ownsRegistry() {
    try {
      return win[REGISTRY_KEY]?.owner === OWNER_TOKEN;
    } catch (_error) {
      return false;
    }
  }

  function claimRegistry() {
    try {
      const previous = win[REGISTRY_KEY];
      if (previous && previous.owner !== OWNER_TOKEN && typeof previous.dispose === 'function') {
        previous.dispose();
      }
      win[REGISTRY_KEY] = { owner: OWNER_TOKEN, dispose: cleanup };
    } catch (_error) {
      // DOM ownership still prevents an older iframe from removing this instance's UI.
    }
  }

  function readInputs(normalizeInvalid = false) {
    if (!affectionInput || !impressionInput || !remarkInput || hydrating) return true;
    const entry = currentEntry();
    if (!entry) return false;
    const rawAffection = String(affectionInput.value ?? '').trim();
    const parsedAffection = Number(rawAffection);
    if (rawAffection === '' || !Number.isFinite(parsedAffection)) {
      if (normalizeInvalid) {
        affectionInput.value = String(entry.affection);
      } else {
        setStatus('好感需为数字', 'error');
        return false;
      }
    } else {
      entry.affection = parsedAffection;
    }
    entry.impression = String(impressionInput.value ?? '').trim();
    entry.remark = String(remarkInput.value ?? '').trim();
    if (normalizeInvalid) impressionInput.value = entry.impression;
    if (normalizeInvalid) remarkInput.value = entry.remark;
    readStatusNumber(staminaNumber, staminaRange, 'stamina', normalizeInvalid);
    readStatusNumber(moodNumber, moodRange, 'mood', normalizeInvalid);
    return true;
  }

  function setRangeProgress(range, value) {
    if (!range) return;
    const text = String(value);
    if (range.value !== text) range.value = text;
    setStyleValue(range, '--th-status-progress', value + '%');
  }

  function readStatusNumber(numberInput, range, key, normalizeInvalid = false) {
    if (!numberInput || !range || !state.userStatus) return;
    const raw = String(numberInput.value ?? '').trim();
    if (raw === '' || !Number.isFinite(Number(raw))) {
      if (normalizeInvalid) numberInput.value = String(state.userStatus[key]);
      setRangeProgress(range, state.userStatus[key]);
      return;
    }
    const value = clampStatusValue(raw, state.userStatus[key]);
    state.userStatus[key] = value;
    setRangeProgress(range, value);
    if (normalizeInvalid || String(value) !== raw) numberInput.value = String(value);
  }

  function renderTargetOptions() {
    if (!targetSelect) return;
    const ids = state.order.filter(id => Boolean(state.entries[id]));
    const options = Array.from(targetSelect.children);
    const unchanged = options.length === ids.length && options.every((option, index) => (
      option.value === ids[index] && option.textContent === state.entries[ids[index]].name
    ));
    if (unchanged) {
      for (const option of options) {
        const selected = option.value === state.selectedId;
        if (option.selected !== selected) option.selected = selected;
      }
      return;
    }
    const fragment = doc.createDocumentFragment();
    for (const id of ids) {
      const entry = state.entries[id];
      const option = doc.createElement('option');
      option.value = id;
      option.textContent = entry.name;
      option.selected = id === state.selectedId;
      fragment.appendChild(option);
    }
    targetSelect.replaceChildren(fragment);
  }

  function renderState() {
    if (!affectionInput || !impressionInput || !remarkInput || !targetSelect || !activeToggle) return;
    if (!state.entries[state.selectedId]) state.selectedId = state.order.find(id => Boolean(state.entries[id])) || '';
    const entry = currentEntry();
    if (!entry) return;
    hydrating = true;
    renderTargetOptions();
    affectionInput.value = String(entry.affection);
    impressionInput.value = entry.impression;
    remarkInput.value = entry.remark;
    activeToggle.dataset.active = String(entry.active);
    activeToggle.classList.toggle('active', entry.active);
    activeToggle.setAttribute('aria-pressed', String(entry.active));
    activeToggle.textContent = entry.active ? 'AI读取' : '仅保存';
    activeToggle.title = entry.active
      ? '开启：AI会读取该角色的态度记录'
      : '关闭：记录照常保存，AI不会读取';
    activeToggle.setAttribute('aria-label', entry.active
      ? '当前为AI读取；点击后改为仅保存'
      : '当前为仅保存；点击后允许AI读取');
    staminaNumber.value = String(state.userStatus.stamina);
    moodNumber.value = String(state.userStatus.mood);
    setRangeProgress(staminaRange, state.userStatus.stamina);
    setRangeProgress(moodRange, state.userStatus.mood);
    renderView();
    hydrating = false;
  }

  function renderView() {
    const showAttitude = currentView !== 'status';
    currentView = showAttitude ? 'attitude' : 'status';
    if (attitudeView) attitudeView.hidden = !showAttitude;
    if (userStatusView) userStatusView.hidden = showAttitude;
    if (attitudeTab) attitudeTab.setAttribute('aria-selected', String(showAttitude));
    if (userStatusTab) userStatusTab.setAttribute('aria-selected', String(!showAttitude));
    attitudeTab?.classList.toggle('active', showAttitude);
    userStatusTab?.classList.toggle('active', !showAttitude);
    keepPositionInViewport();
  }

  function normalizeSavedState(saved) {
    if (!saved || typeof saved !== 'object' || !saved['角色'] || typeof saved['角色'] !== 'object') return false;
    const nextState = createEmptyState();
    const savedRoles = saved['角色'];
    nextState.suppressedAutoNames = Array.isArray(saved['忽略的群成员'])
      ? saved['忽略的群成员'].map(cleanName).filter(Boolean)
      : [];
    const suppressed = new Set(nextState.suppressedAutoNames.map(normalizedName));
    // 名单是有效记录的边界；旧版合并保存遗留的其他角色不再补回。
    const orderedIds = [...new Set(Array.isArray(saved['顺序'])
      ? saved['顺序'].map(String)
      : Object.keys(savedRoles))];

    for (const id of orderedIds) {
      const raw = savedRoles[id];
      if (!raw || typeof raw !== 'object') continue;
      const name = cleanName(raw['名称']);
      if (!name || suppressed.has(normalizedName(name))) continue;
      const entry = createEntry(name, typeof raw['来源'] === 'string' ? raw['来源'] : 'manual', {
        affection: raw['好感'],
        impression: raw['印象'],
        remark: raw['备注'],
        active: raw['本轮注入'] !== false,
      });
      entry.id = id;
      nextState.entries[id] = entry;
      nextState.order.push(id);
    }
    if (!nextState.order.length) return false;
    nextState.selectedId = nextState.entries[String(saved['当前对象'])]
      ? String(saved['当前对象'])
      : nextState.order[0];
    const savedStatus = saved['用户状态'];
    if (savedStatus && typeof savedStatus === 'object') {
      nextState.userStatus.stamina = clampStatusValue(savedStatus['体力'], DEFAULT_USER_STATUS.stamina);
      nextState.userStatus.mood = clampStatusValue(savedStatus['心情'], DEFAULT_USER_STATUS.mood);
    }
    state = nextState;
    return true;
  }

  function migrateLegacyState(saved) {
    if (!saved || typeof saved !== 'object') return false;
    const participants = getParticipantContext();
    const result = addEntry(participants.names[0] || '当前角色', participants.isGroup ? 'group' : 'card', {
      affection: saved['好感'],
      impression: saved['印象'],
      remark: saved['备注'],
      active: true,
    });
    if (result.entry) state.selectedId = result.entry.id;
    return Boolean(result.entry);
  }

  function loadState() {
    state = createEmptyState();
    const getVariables = getApi('getVariables');
    if (!getVariables) {
      syncParticipants(true);
      return { existed: false, needsPersist: true };
    }
    const variables = getVariables.call(window, { type: 'chat' });
    const saved = variables && typeof variables === 'object' ? variables[STORAGE_KEY] : null;
    const legacy = variables && typeof variables === 'object' ? variables[LEGACY_STORAGE_KEY] : null;
    const existed = normalizeSavedState(saved);
    let needsPersist = Boolean(existed && JSON.stringify(saved) !== signature());

    if (!existed) {
      state = createEmptyState();
      needsPersist = migrateLegacyState(legacy);
    }
    if (syncParticipants(true)) needsPersist = true;
    if (!state.order.length) {
      addEntry('当前角色', 'card');
      needsPersist = true;
    }
    if (!state.entries[state.selectedId]) state.selectedId = state.order[0];
    return { existed, needsPersist: needsPersist || !existed };
  }

  function persistState(options = {}) {
    const force = options.force === true;
    const silent = options.silent === true;
    const updatePrompt = options.updatePrompt !== false;
    const snapshot = serializeState();
    const nextSignature = signature(snapshot);
    const update = getApi('updateVariablesWith');

    try {
      if (force || nextSignature !== lastSavedSignature) {
        if (!update) {
          if (!silent) setStatus('保存接口不可用', 'error');
          return false;
        }
        // 只替换本脚本的完整快照，保留聊天中的其他变量。
        update.call(window, variables => {
          variables[STORAGE_KEY] = snapshot;
          return variables;
        }, { type: 'chat' });
        lastSavedSignature = nextSignature;
      }
      if (updatePrompt) injectPrompt();
      if (!silent) setStatus('已保存', 'saved');
      return true;
    } catch (error) {
      console.error('[当前态度悬浮窗] 保存失败：', error);
      if (!silent) setStatus('保存失败', 'error');
      return false;
    }
  }

  function flushSave(options = {}) {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!readInputs(options.normalizeInvalid !== false)) return false;
    return persistState(options);
  }

  function scheduleSave() {
    if (destroyed || hydrating) return;
    if (!readInputs(false)) return;
    setStatus('待保存', 'dirty');
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistState();
    }, SAVE_DELAY_MS);
  }

  function hydrateChat() {
    if (destroyed || !root) return;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      const loaded = loadState();
      renderState();
      lastSavedSignature = loaded.existed && !loaded.needsPersist ? signature() : '';
      const saved = !loaded.needsPersist || persistState({ force: true, silent: true, updatePrompt: false });
      injectPrompt(true);
      setStatus(saved ? '已保存' : '保存失败', saved ? 'saved' : 'error');
    } catch (error) {
      console.error('[当前态度悬浮窗] 读取失败：', error);
      state = createEmptyState();
      syncParticipants(true);
      if (!state.order.length) addEntry('当前角色', 'card');
      renderState();
      setStatus('读取失败', 'error');
    }
  }

  function closeTargetMenu() {
    if (!targetMenu || !menuButton) return;
    targetMenu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }

  function toggleTargetMenu() {
    if (!targetMenu || !menuButton) return;
    const nextOpen = targetMenu.hidden;
    targetMenu.hidden = !nextOpen;
    menuButton.setAttribute('aria-expanded', String(nextOpen));
  }

  function cancelTargetEdit() {
    targetEditMode = null;
    if (targetEditor) targetEditor.hidden = true;
    if (targetToolbar) targetToolbar.hidden = false;
    if (targetNameInput) targetNameInput.value = '';
  }

  function beginTargetEdit(mode) {
    flushSave({ silent: true, updatePrompt: false });
    closeTargetMenu();
    targetEditMode = mode;
    if (targetToolbar) targetToolbar.hidden = true;
    if (targetEditor) targetEditor.hidden = false;
    if (targetNameInput) {
      targetNameInput.value = mode === 'rename' ? currentEntry()?.name || '' : '';
      targetNameInput.placeholder = mode === 'add' ? '角色名；多个可用逗号分隔' : '角色名称';
      setTimeout(() => {
        targetNameInput?.focus?.();
        if (mode === 'rename') targetNameInput?.select?.();
      }, 0);
    }
  }

  function commitTargetEdit() {
    const rawValue = String(targetNameInput?.value ?? '').trim();
    if (!rawValue) {
      setStatus('请填写角色名', 'error');
      return;
    }

    if (targetEditMode === 'add') {
      const names = rawValue.split(/[,，;；\n]+/).map(cleanName).filter(Boolean);
      let firstEntry = null;
      for (const name of names) {
        const result = addEntry(name, 'manual');
        if (!firstEntry && result.entry) firstEntry = result.entry;
      }
      if (!firstEntry) {
        setStatus('请填写角色名', 'error');
        return;
      }
      state.selectedId = firstEntry.id;
    } else if (targetEditMode === 'rename') {
      const entry = currentEntry();
      const nextName = cleanName(rawValue);
      if (!entry || !nextName) return;
      const duplicate = findEntryByName(nextName);
      if (duplicate && duplicate.id !== entry.id) {
        setStatus('已有同名角色', 'error');
        return;
      }
      if (normalizedName(entry.name) !== normalizedName(nextName)) suppressAutoName(entry.name);
      state.suppressedAutoNames = state.suppressedAutoNames.filter(value => normalizedName(value) !== normalizedName(nextName));
      entry.name = nextName;
      entry.source = 'manual';
    }

    cancelTargetEdit();
    renderState();
    persistState({ force: true });
  }

  function removeCurrentTarget() {
    closeTargetMenu();
    if (state.order.length <= 1) {
      setStatus('至少保留一个角色', 'error');
      return;
    }
    const entry = currentEntry();
    if (!entry) return;
    try {
      if (typeof win.confirm === 'function' && !win.confirm('移除“' + entry.name + '”及其态度记录？')) return;
    } catch (_error) {}

    const index = state.order.indexOf(entry.id);
    suppressAutoName(entry.name);
    state.order = state.order.filter(id => id !== entry.id);
    delete state.entries[entry.id];
    state.selectedId = state.order[Math.min(index, state.order.length - 1)] || state.order[0];
    renderState();
    persistState({ force: true });
  }

  function cancelPanelClose() {
    if (panelCloseTimer !== null) clearTimeout(panelCloseTimer);
    panelCloseTimer = null;
    if (root) root.dataset.closing = 'false';
  }

  function hidePanelNow() {
    if (!root || !panel) return;
    root.dataset.open = 'false';
    root.hidden = true;
    root.style.setProperty('display', 'none', 'important');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  }

  function setPanelOpen(open) {
    if (!root || !panel || destroyed) return;
    if (!open) cancelActiveDrag?.();
    openRequested = open;
    const wasOpen = root.dataset.open === 'true';
    if (!open && root.dataset.closing === 'true') return;
    cancelPanelClose();
    if (open) {
      if (!root.isConnected && doc.body) doc.body.appendChild(root);
      if (!doc.getElementById(STYLE_ID)) injectStyle();
      updateWindowBounds();
    } else {
      closeTargetMenu();
      cancelTargetEdit();
      flushSave();
      if (root.contains(doc.activeElement)) doc.activeElement?.blur?.();
    }
    root.dataset.open = String(open);
    panel.setAttribute('aria-hidden', String(!open));
    if (orb) {
      orb.setAttribute('aria-expanded', String(open));
      orb.setAttribute('aria-label', open ? '收起态度与状态' : '展开态度与状态');
    }
    if (open) {
      root.hidden = false;
      root.style.setProperty('display', 'block', 'important');
      panel.hidden = false;
      if (displayMode === 'orb') positionOrbPanel();
      else if (wasOpen) keepPositionInViewport();
      else restorePosition();
    } else {
      const animate = displayMode === 'orb' && wasOpen && typeof panel.getAnimations === 'function'
        && !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (animate) {
        root.dataset.closing = 'true';
        panelCloseTimer = setTimeout(() => {
          panelCloseTimer = null;
          if (!destroyed && root.dataset.closing === 'true') {
            hidePanelNow();
            root.dataset.closing = 'false';
          }
        }, 160);
      } else hidePanelNow();
    }
  }

  // 悬浮球与面板共用一套拖动；只在拖动期间监听主页面指针事件。
  function bindDrag(handle, element, positionKey, onTap = null) {
    let drag = null;
    let dragFrame = null;
    let suppressClickUntil = 0;

    function captureLayer(target, box) {
      return { target, box, styles: ['translate', 'will-change'].map(property => (
        [property, target.style.getPropertyValue(property), target.style.getPropertyPriority(property)]
      )) };
    }

    function restoreLayer(layer) {
      if (!layer) return;
      for (const [property, value, priority] of layer.styles) {
        if (value) setStyleValue(layer.target, property, value, priority);
        else layer.target.style.removeProperty(property);
      }
    }

    function moveLayer(layer, left, top) {
      setStyleValue(layer.target, 'will-change', 'translate', 'important');
      setStyleValue(layer.target, 'translate', (left - layer.box.left) + 'px ' + (top - layer.box.top) + 'px', 'important');
    }

    function prepareLayers() {
      drag.layer = captureLayer(element, drag.box);
      if (element !== orb || !root || root.hidden) return;
      const box = getRootBox(root, drag.viewport);
      let naturalHeight = box.height;
      const desiredHeight = Number(panel.scrollHeight) + 2 || naturalHeight;
      if (desiredHeight > naturalHeight + 1) {
        // 被屏幕边缘压缩时，只在手势开始测一次自然高度，避免逐帧测量。
        const oldHeight = root.style.getPropertyValue('--th-window-max-height');
        setStyleValue(root, '--th-window-max-height', 'none');
        naturalHeight = getRootBox(root, drag.viewport).height;
        if (oldHeight) setStyleValue(root, '--th-window-max-height', oldHeight);
        else root.style.removeProperty('--th-window-max-height');
      }
      drag.attached = { layer: captureLayer(root, box), naturalHeight, desiredHeight };
    }

    function moveAttachedPanel(ball) {
      const attached = drag.attached;
      if (!attached) return;
      const viewport = drag.viewport;
      const below = Math.max(0, viewport.top + viewport.height - VIEWPORT_MARGIN_PX - ball.top - ORB_SIZE_PX - 10);
      const above = Math.max(0, ball.top - 10 - viewport.top - VIEWPORT_MARGIN_PX);
      const opensBelow = below >= attached.desiredHeight || below >= above;
      const box = { width: attached.layer.box.width, height: Math.max(22, attached.naturalHeight) };
      const desiredLeft = ball.left + ORB_SIZE_PX - box.width;
      const next = { left: desiredLeft, top: opensBelow ? ball.top + ORB_SIZE_PX + 10 : ball.top - box.height - 10 };
      setStyleValue(root, '--th-window-max-height', 'none');
      const side = opensBelow ? 'below' : 'above';
      if (root.dataset.side !== side) root.dataset.side = side;
      setStyleValue(root, '--th-orb-origin', (next.left > desiredLeft ? 'left ' : 'right ') + (opensBelow ? 'top' : 'bottom'));
      setStyleValue(root, '--th-orb-enter-y', opensBelow ? '-5px' : '5px');
      moveLayer(attached.layer, next.left, next.top);
    }

    function renderDrag() {
      dragFrame = null;
      if (!drag || !drag.moved || destroyed) return;
      const freeWindow = element === root && displayMode === 'shortcut';
      const next = freeWindow ? { left: drag.nextLeft, top: drag.nextTop }
        : clampPosition(drag.nextLeft, drag.nextTop, element, drag.viewport, drag.box);
      drag.lastPosition = next;
      if (drag.useLayers) {
        if (!drag.layer) prepareLayers();
        moveLayer(drag.layer, next.left, next.top);
        moveAttachedPanel(next);
      } else applyPosition(next.left, next.top, element);
    }

    function startDrag(event) {
      if (destroyed || !element.isConnected || element.hidden || drag || event.isPrimary === false || event.button !== 0) return;
      if (element === root && displayMode !== 'shortcut') return;
      if (!onTap && event.target?.closest?.('button, input, select, textarea, a')) return;
      const x = Number(event.clientX);
      const y = Number(event.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      suppressClickUntil = 0;
      const viewport = getViewportSize();
      const box = getRootBox(element, viewport);
      drag = { id: event.pointerId, x, y, left: box.left, top: box.top, nextLeft: box.left, nextTop: box.top,
        moved: false, viewport, box, layer: null, attached: null, useLayers: win.CSS?.supports?.('translate', '1px') === true };
      cancelActiveDrag = endDrag;
      element.dataset.dragging = 'true';
      try { handle.setPointerCapture(event.pointerId); } catch (_error) {}
      doc.addEventListener('pointermove', moveDrag, { passive: false, capture: true });
      doc.addEventListener('pointerup', endDrag, true);
      doc.addEventListener('pointercancel', endDrag, true);
      if (!onTap) event.preventDefault();
      event.stopPropagation();
    }

    function moveDrag(event) {
      if (!drag || event.pointerId !== drag.id || destroyed) return;
      const dx = Number(event.clientX) - drag.x;
      const dy = Number(event.clientY) - drag.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true;
      if (drag.moved) {
        drag.nextLeft = drag.left + dx;
        drag.nextTop = drag.top + dy;
        // 使用主页面的帧回调；隐藏的脚本 iframe 不负责渲染时机。
        if (dragFrame === null) dragFrame = win.requestAnimationFrame(renderDrag);
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function endDrag(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      if (dragFrame !== null) {
        win.cancelAnimationFrame(dragFrame);
        renderDrag();
      }
      const finished = drag;
      drag = null;
      if (cancelActiveDrag === endDrag) cancelActiveDrag = null;
      restoreLayer(finished.layer);
      restoreLayer(finished.attached?.layer);
      doc.removeEventListener('pointermove', moveDrag, true);
      doc.removeEventListener('pointerup', endDrag, true);
      doc.removeEventListener('pointercancel', endDrag, true);
      try { handle.releasePointerCapture?.(finished.id); } catch (_error) {}
      element.dataset.dragging = 'false';
      if (finished.moved && !destroyed) {
        if (finished.layer) applyPosition(finished.lastPosition.left, finished.lastPosition.top, element);
        savePosition(element, positionKey);
      }
      if (onTap && (finished.moved || event?.type !== 'pointerup')) {
        suppressClickUntil = Date.now() + 500;
      }
    }

    function handleClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (destroyed || !element.isConnected || (event.detail !== 0 && Date.now() < suppressClickUntil)) return;
      onTap?.();
    }

    handle.addEventListener('pointerdown', startDrag);
    handle.addEventListener('lostpointercapture', endDrag);
    if (onTap) handle.addEventListener('click', handleClick);
    return () => {
      endDrag();
      handle.removeEventListener('pointerdown', startDrag);
      handle.removeEventListener('lostpointercapture', endDrag);
      if (onTap) handle.removeEventListener('click', handleClick);
    };
  }

  // 酒馆在 html 的 touchstart/mousedown 上收起外部工具栏；只隔离本界面的按下事件。
  function bindHostPressBoundary(element) {
    const stopOutsidePress = event => event.stopPropagation();
    element.addEventListener('mousedown', stopOutsidePress);
    element.addEventListener('touchstart', stopOutsidePress, { passive: true });
    return () => {
      element.removeEventListener('mousedown', stopOutsidePress);
      element.removeEventListener('touchstart', stopOutsidePress);
    };
  }

  function bindUi() {
    try { uiCleanup?.(); } catch (_error) {}
    const stopPanelPress = bindHostPressBoundary(root);
    const stopPanelDrag = bindDrag(dragHandle, root, POSITION_STORAGE_KEY);

    function handleClose(event) {
      event.preventDefault();
      event.stopPropagation();
      setPanelOpen(false);
    }

    function handleInput() { scheduleSave(); }
    function handleChange() { flushSave(); }
    function handleBlur() { flushSave(); }
    function handleKeydown(event) {
      if (event.key === 'Escape') setPanelOpen(false);
    }

    function switchView(view) {
      if (view !== 'attitude' && view !== 'status') return;
      flushSave({ silent: true });
      currentView = view;
      closeTargetMenu();
      cancelTargetEdit();
      renderView();
    }

    function handleAttitudeTab(event) {
      event.preventDefault();
      event.stopPropagation();
      switchView('attitude');
    }

    function handleUserStatusTab(event) {
      event.preventDefault();
      event.stopPropagation();
      switchView('status');
    }

    function updateStatusFromRange(range, numberInput, key) {
      const value = clampStatusValue(range?.value, state.userStatus[key]);
      state.userStatus[key] = value;
      if (numberInput) numberInput.value = String(value);
      setRangeProgress(range, value);
      scheduleSave();
    }

    function updateStatusFromNumber(numberInput, range, key, normalizeInvalid = false) {
      const raw = String(numberInput?.value ?? '').trim();
      if (raw === '' || !Number.isFinite(Number(raw))) {
        if (normalizeInvalid && numberInput) numberInput.value = String(state.userStatus[key]);
        return false;
      }
      const value = clampStatusValue(raw, state.userStatus[key]);
      state.userStatus[key] = value;
      setRangeProgress(range, value);
      if (normalizeInvalid || String(value) !== raw) numberInput.value = String(value);
      return true;
    }

    function handleStaminaRange() { updateStatusFromRange(staminaRange, staminaNumber, 'stamina'); }
    function handleMoodRange() { updateStatusFromRange(moodRange, moodNumber, 'mood'); }
    function handleStaminaNumberInput() {
      if (updateStatusFromNumber(staminaNumber, staminaRange, 'stamina')) scheduleSave();
    }
    function handleMoodNumberInput() {
      if (updateStatusFromNumber(moodNumber, moodRange, 'mood')) scheduleSave();
    }
    function handleStaminaNumberCommit() {
      updateStatusFromNumber(staminaNumber, staminaRange, 'stamina', true);
      flushSave();
    }
    function handleMoodNumberCommit() {
      updateStatusFromNumber(moodNumber, moodRange, 'mood', true);
      flushSave();
    }
    function handleStatusNumberKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget?.blur?.();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        renderState();
        setPanelOpen(false);
      }
    }

    function handleTargetSelect() {
      if (hydrating || !targetSelect) return;
      if (!flushSave({ silent: true, updatePrompt: false })) {
        renderState();
        return;
      }
      if (state.entries[targetSelect.value]) state.selectedId = targetSelect.value;
      renderState();
      persistState();
    }

    function handleActiveToggle(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!flushSave({ silent: true, updatePrompt: false })) return;
      const entry = currentEntry();
      if (!entry) return;
      entry.active = !entry.active;
      renderState();
      const saved = persistState({ force: true, silent: true });
      setStatus(saved ? (entry.active ? 'AI会读取' : 'AI不读取') : '保存失败', saved ? 'saved' : 'error');
    }

    function handleAddTarget(event) {
      event.preventDefault();
      event.stopPropagation();
      beginTargetEdit('add');
    }

    function handleMenuButton(event) {
      event.preventDefault();
      event.stopPropagation();
      toggleTargetMenu();
    }

    function handleRenameTarget(event) {
      event.preventDefault();
      event.stopPropagation();
      beginTargetEdit('rename');
    }

    function handleRemoveTarget(event) {
      event.preventDefault();
      event.stopPropagation();
      removeCurrentTarget();
    }

    function handleConfirmTarget(event) {
      event.preventDefault();
      event.stopPropagation();
      commitTargetEdit();
    }

    function handleCancelTarget(event) {
      event.preventDefault();
      event.stopPropagation();
      cancelTargetEdit();
      setStatus('已保存', 'saved');
    }

    function handleTargetNameKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTargetEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelTargetEdit();
      }
    }

    function handleOutsideTargetMenu(event) {
      if (!targetMenu?.hidden && !targetMenu?.parentElement?.contains(event.target)) closeTargetMenu();
    }

    closeButton.addEventListener('click', handleClose);
    win.addEventListener?.('resize', keepPositionInViewport, { passive: true });
    win.visualViewport?.addEventListener('resize', keepPositionInViewport, { passive: true });
    win.visualViewport?.addEventListener('scroll', keepPositionInViewport, { passive: true });

    targetSelect?.addEventListener('change', handleTargetSelect);
    activeToggle?.addEventListener('click', handleActiveToggle);
    addTargetButton?.addEventListener('click', handleAddTarget);
    menuButton?.addEventListener('click', handleMenuButton);
    renameTargetButton?.addEventListener('click', handleRenameTarget);
    removeTargetButton?.addEventListener('click', handleRemoveTarget);
    confirmTargetButton?.addEventListener('click', handleConfirmTarget);
    cancelTargetButton?.addEventListener('click', handleCancelTarget);
    targetNameInput?.addEventListener('keydown', handleTargetNameKeydown);
    attitudeTab?.addEventListener('click', handleAttitudeTab);
    userStatusTab?.addEventListener('click', handleUserStatusTab);
    staminaRange?.addEventListener('input', handleStaminaRange);
    staminaRange?.addEventListener('change', handleStaminaNumberCommit);
    moodRange?.addEventListener('input', handleMoodRange);
    moodRange?.addEventListener('change', handleMoodNumberCommit);
    staminaNumber?.addEventListener('input', handleStaminaNumberInput);
    staminaNumber?.addEventListener('change', handleStaminaNumberCommit);
    staminaNumber?.addEventListener('blur', handleStaminaNumberCommit);
    staminaNumber?.addEventListener('keydown', handleStatusNumberKeydown);
    moodNumber?.addEventListener('input', handleMoodNumberInput);
    moodNumber?.addEventListener('change', handleMoodNumberCommit);
    moodNumber?.addEventListener('blur', handleMoodNumberCommit);
    moodNumber?.addEventListener('keydown', handleStatusNumberKeydown);
    doc.addEventListener('click', handleOutsideTargetMenu);

    for (const input of [affectionInput, impressionInput, remarkInput]) {
      input.addEventListener('input', handleInput);
      input.addEventListener('change', handleChange);
      input.addEventListener('blur', handleBlur);
      input.addEventListener('keydown', handleKeydown);
    }

    uiCleanup = () => {
      stopPanelDrag();
      stopPanelPress();
      removeOrb();
      closeButton?.removeEventListener('click', handleClose);
      win.removeEventListener?.('resize', keepPositionInViewport);
      win.visualViewport?.removeEventListener('resize', keepPositionInViewport);
      win.visualViewport?.removeEventListener('scroll', keepPositionInViewport);
      targetSelect?.removeEventListener('change', handleTargetSelect);
      activeToggle?.removeEventListener('click', handleActiveToggle);
      addTargetButton?.removeEventListener('click', handleAddTarget);
      menuButton?.removeEventListener('click', handleMenuButton);
      renameTargetButton?.removeEventListener('click', handleRenameTarget);
      removeTargetButton?.removeEventListener('click', handleRemoveTarget);
      confirmTargetButton?.removeEventListener('click', handleConfirmTarget);
      cancelTargetButton?.removeEventListener('click', handleCancelTarget);
      targetNameInput?.removeEventListener('keydown', handleTargetNameKeydown);
      attitudeTab?.removeEventListener('click', handleAttitudeTab);
      userStatusTab?.removeEventListener('click', handleUserStatusTab);
      staminaRange?.removeEventListener('input', handleStaminaRange);
      staminaRange?.removeEventListener('change', handleStaminaNumberCommit);
      moodRange?.removeEventListener('input', handleMoodRange);
      moodRange?.removeEventListener('change', handleMoodNumberCommit);
      staminaNumber?.removeEventListener('input', handleStaminaNumberInput);
      staminaNumber?.removeEventListener('change', handleStaminaNumberCommit);
      staminaNumber?.removeEventListener('blur', handleStaminaNumberCommit);
      staminaNumber?.removeEventListener('keydown', handleStatusNumberKeydown);
      moodNumber?.removeEventListener('input', handleMoodNumberInput);
      moodNumber?.removeEventListener('change', handleMoodNumberCommit);
      moodNumber?.removeEventListener('blur', handleMoodNumberCommit);
      moodNumber?.removeEventListener('keydown', handleStatusNumberKeydown);
      doc.removeEventListener('click', handleOutsideTargetMenu);
      for (const input of [affectionInput, impressionInput, remarkInput]) {
        input?.removeEventListener('input', handleInput);
        input?.removeEventListener('change', handleChange);
        input?.removeEventListener('blur', handleBlur);
        input?.removeEventListener('keydown', handleKeydown);
      }
    };
  }

  function bindShortcut() {
    if (shortcutSubscription && switchSubscription) return;
    const appendButtons = typeof appendInexistentScriptButtons === 'function' ? appendInexistentScriptButtons : getApi('appendInexistentScriptButtons');
    appendButtons?.call(window, [
      { name: SHORTCUT_NAME, visible: true },
      { name: SWITCH_SHORTCUT_NAME, visible: true },
    ]);
    // 按钮事件属于脚本 iframe；窗口和视口属于酒馆父页面。
    const subscribe = typeof eventOn === 'function' ? eventOn : getApi('eventOn');
    const buttonEvent = typeof getButtonEvent === 'function' ? getButtonEvent : getApi('getButtonEvent');
    if (!subscribe || !buttonEvent) throw new Error('快捷按钮接口不可用，请通过酒馆助手脚本库导入本文件。');
    if (!shortcutSubscription) shortcutSubscription = subscribe.call(window, buttonEvent.call(window, SHORTCUT_NAME), () => {
      if (destroyed) return;
      openRequested = true;
      if (!mounted) init();
      if (mounted) setPanelOpen(true);
    });
    if (!switchSubscription) switchSubscription = subscribe.call(window, buttonEvent.call(window, SWITCH_SHORTCUT_NAME), () => {
      if (destroyed) return;
      if (!mounted) {
        switchRequested = !switchRequested;
        openRequested = true;
        init();
        return;
      }
      setDisplayMode(displayMode === 'orb' ? 'shortcut' : 'orb');
    });
  }

  function bindTavernEvents() {
    const eventOn = getApi('eventOn');
    const events = getEvents();
    if (!eventOn || !events) return;
    try {
      if (events.CHAT_CHANGED) chatSubscription = eventOn.call(window, events.CHAT_CHANGED, hydrateChat);
      if (events.GENERATION_AFTER_COMMANDS) {
        generationSubscription = eventOn.call(window, events.GENERATION_AFTER_COMMANDS, () => {
          if (destroyed) return;
          flushSave({ silent: true, updatePrompt: false });
          if (syncParticipants(false)) {
            renderState();
            persistState({ force: true, silent: true, updatePrompt: false });
          }
          injectPrompt(true);
        });
      }
    } catch (error) {
      console.error('[当前态度悬浮窗] 事件绑定失败：', error);
    }
  }

  function cleanup() {
    if (destroyed) return;
    const isActiveOwner = ownsRegistry();
    try {
      if (root?.getAttribute(OWNER_ATTR) === OWNER_TOKEN) flushSave({ silent: true, updatePrompt: false });
    } catch (_error) {}
    destroyed = true;
    cancelPanelClose();
    if (saveTimer !== null) clearTimeout(saveTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    saveTimer = null;
    retryTimer = null;
    try { uiCleanup?.(); } catch (_error) {}
    uiCleanup = null;
    try { chatSubscription?.stop?.(); } catch (_error) {}
    try { generationSubscription?.stop?.(); } catch (_error) {}
    try { shortcutSubscription?.stop?.(); } catch (_error) {}
    try { switchSubscription?.stop?.(); } catch (_error) {}
    if (isActiveOwner) {
      uninjectAllPrompts();
      try {
        delete win[REGISTRY_KEY];
      } catch (_error) {}
    }
    removeCurrentDom(false);
  }

  function reportLoadError(error) {
    console.error('[当前态度悬浮窗] 加载失败：', error);
    try {
      window.alert('当前态度悬浮窗加载失败：\n' + (error?.stack || error?.message || error));
    } catch (_error) {}
  }

  function init() {
    if (destroyed || mounted) return;
    try {
      bindShortcut();
      if (!doc?.body || !doc?.head) {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(init, 100);
        return;
      }
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      claimRegistry();
      try { uiCleanup?.(); } catch (_error) {}
      uiCleanup = null;
      removeLegacyDom();
      removeCurrentDom(true);
      uninjectAllPrompts();
      injectStyle();
      displayMode = readDisplayMode();
      buildRoot();
      bindUi();
      applyDisplayMode();
      bindTavernEvents();
      mounted = true;
      hydrateChat();
      if (switchRequested) {
        switchRequested = false;
        setDisplayMode(displayMode === 'orb' ? 'shortcut' : 'orb');
      } else if (openRequested) setPanelOpen(true);
    } catch (error) {
      cleanup();
      reportLoadError(error);
      throw error;
    }
  }

  window.addEventListener('unload', cleanup, { once: true });
  window.addEventListener('pagehide', cleanup, { once: true });
  init();
})();
