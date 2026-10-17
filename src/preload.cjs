const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myholypoly', {
  appInfo: {
    read: () => ipcRenderer.invoke('app:info'),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
    previewUpdate: () => ipcRenderer.invoke('app:preview-update'),
    simulateUpdate: () => ipcRenderer.invoke('app:simulate-update'),
    onUpdateProgress: listener => {
      const handler = (_event, progress) => listener(progress);
      ipcRenderer.on('app:update-progress', handler);
      return () => ipcRenderer.removeListener('app:update-progress', handler);
    },
    openRepository: () => ipcRenderer.invoke('app:open-repository'),
    desktopShortcutStatus: () => ipcRenderer.invoke('app:desktop-shortcut-status'),
    setDesktopShortcut: enabled => ipcRenderer.invoke('app:set-desktop-shortcut', enabled)
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize')
  },
  epoly: {
    status: () => ipcRenderer.invoke('epoly:status'),
    launch: () => ipcRenderer.invoke('epoly:launch'),
    openHomework: () => ipcRenderer.invoke('epoly:open-homework'),
    todayHomework: () => ipcRenderer.invoke('epoly:today-homework'),
    dateHomework: date => ipcRenderer.invoke('epoly:date-homework', date),
    openCalendar: () => ipcRenderer.invoke('epoly:open-calendar'),
    openInstallGuide: () => ipcRenderer.invoke('epoly:open-install-guide')
  },
  polyWeb: {
    open: () => ipcRenderer.invoke('poly-web:open'),
    status: () => ipcRenderer.invoke('poly-web:status'),
    openHomework: () => ipcRenderer.invoke('poly-web:open-homework'),
    dateHomework: date => ipcRenderer.invoke('poly-web:date-homework', date)
  },
  plan: {
    read: () => ipcRenderer.invoke('plan:read'),
    register: draft => ipcRenderer.invoke('plan:register', draft),
    updateItem: (target, item) => ipcRenderer.invoke('plan:update-item', { target, item }),
    toggleLine: (date, itemIndex, lineIndex, checked) => ipcRenderer.invoke('plan:toggle-line', { date, itemIndex, lineIndex, checked }),
    toggleTodayGoal: (date, itemIndex, lineIndex, enabled, goalDate) => ipcRenderer.invoke('plan:toggle-today-goal', { date, itemIndex, lineIndex, enabled, goalDate }),
    deleteItems: targets => ipcRenderer.invoke('plan:delete-items', targets)
  },
  monthlyEvents: {
    read: () => ipcRenderer.invoke('monthly-events:read'),
    save: event => ipcRenderer.invoke('monthly-events:save', event),
    delete: id => ipcRenderer.invoke('monthly-events:delete', id)
  }
});
