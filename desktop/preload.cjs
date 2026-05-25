const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('tableforgeDesktop', {
  platform: process.platform,
  isDesktop: true,
});
