const {app,BrowserWindow,session,shell}=require('electron');
const path=require('node:path');

function createWindow(){
  const win=new BrowserWindow({width:1440,height:900,minWidth:900,minHeight:600,backgroundColor:'#10181b',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return{action:'deny'};});
  if(process.env.ELECTRON_DEV_URL)win.loadURL(process.env.ELECTRON_DEV_URL);else win.loadFile(path.join(__dirname,'..','dist-client','index.html'));
}
app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='pointerLock'||permission==='fullscreen'));createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

