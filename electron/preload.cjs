const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('zeroPoint',{platform:process.platform,releaseVersion:'0.2.1'});

