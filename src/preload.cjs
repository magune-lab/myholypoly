const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myholypoly', {
  windowControls: {
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
  plan: {
    read: () => ipcRenderer.invoke('plan:read'),
    register: draft => ipcRenderer.invoke('plan:register', draft),
    updateItem: (target, item) => ipcRenderer.invoke('plan:update-item', { target, item }),
    toggleLine: (date, itemIndex, lineIndex, checked) => ipcRenderer.invoke('plan:toggle-line', { date, itemIndex, lineIndex, checked }),
    deleteItems: targets => ipcRenderer.invoke('plan:delete-items', targets)
  }
});
