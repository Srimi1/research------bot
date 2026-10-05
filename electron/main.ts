import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store } from './store';
import { AuthService } from './auth';
import { Runner } from './runner';
import { markdownExport } from '../src/shared/export';
import { toResult } from './ipc';
import { MAX_AGENT_INPUT } from '../src/shared/limits';
const dev=process.argv.includes('--dev');
// Tests and portable setups can point the app at a separate data folder. Must run before the instance lock.
if(process.env.RESEARCH_BOT_USER_DATA)app.setPath('userData',process.env.RESEARCH_BOT_USER_DATA);
// A second launch only focuses the first window; it must not open the database or create a window.
const primary=app.requestSingleInstanceLock();if(!primary)app.quit();
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.focus();}});
const id=z.string().uuid();const text=z.string().max(100000);
const sourceSchema=z.object({id,title:z.string().min(1).max(2000),authors:z.array(z.string().max(1000)).max(200),year:z.string().max(50),url:z.string().url().max(3000),doi:z.string().max(500),category:z.enum(['article','report','forum','document']),inspected:z.enum(['metadata','abstract','full-text','user-added']),retrievedAt:z.string().max(100),abstract:text,query:text,method:text,findings:text,limitations:text,notes:text});
const stepSchema=z.object({id,title:text,purpose:text,output:text,dependsOn:text,check:text,done:z.boolean()});
let win:BrowserWindow;let store:Store;let auth:AuthService;let runner:Runner;
function safeExternal(url:string){const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Only public HTTP or HTTPS links can be opened.');const host=parsed.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.localhost')||/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)||host==='[::1]')throw new Error('Local network links are not supported.');return parsed.toString();}
function register(channel:string,handler:(...args:any[])=>unknown){ipcMain.handle(channel,(event,...args)=>toResult(()=>{const url=event.senderFrame?.url;if(event.sender!==win.webContents||!url||(dev?new URL(url).origin!=='http://127.0.0.1:5173':url!==pathToFileURL(join(app.getAppPath(),'dist/index.html')).href))throw new Error('Untrusted application request.');return handler(...args);}));}
app.whenReady().then(()=>{
  if(!primary)return;
  store=new Store(join(app.getPath('userData'),'research.sqlite'));store.failInterruptedRuns();
  const credentials={available:()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),encrypt:(s:string)=>safeStorage.encryptString(s),decrypt:(b:Buffer)=>safeStorage.decryptString(b)};
  auth=new AuthService(join(app.getPath('userData'),'account'),url=>shell.openExternal(url),credentials);
  win=new BrowserWindow({width:1440,height:950,minWidth:860,minHeight:620,title:'Research Bot',backgroundColor:'#f6f5ef',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  runner=new Runner(store,auth,join(app.getAppPath(),'agents'),event=>{if(!win.isDestroyed())win.webContents.send('agents:event',event);});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.on('will-prevent-unload',event=>{const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['Stay','Leave without saving'],defaultId:0,cancelId:0,title:'Unsaved research notes',message:'Your latest changes have not been saved.',detail:'Stay in Research Bot and save your notes before closing.'});if(choice===1)event.preventDefault();});
  register('projects:list',()=>store.listProjects());
  register('projects:create',input=>store.createProject(z.object({title:z.string().trim().min(1).max(200),topic:z.string().max(500)}).parse(input)));
  register('projects:get',value=>store.getProject(id.parse(value)));
  register('projects:save',input=>store.saveProject(z.object({id,title:z.string().trim().min(1).max(200),topic:z.string().max(500),question:text,notes:text,version:z.number().int().nonnegative()}).parse(input)));
  register('projects:delete',value=>{const projectId=id.parse(value);runner.cancelProject(projectId);store.deleteProject(projectId);});
  register('sources:save',(projectId,source)=>{safeExternal(sourceSchema.parse(source).url);return store.saveSource(id.parse(projectId),sourceSchema.parse(source));});
  register('sources:delete',(projectId,sourceId)=>store.deleteSource(id.parse(projectId),id.parse(sourceId)));
  register('steps:save',(projectId,steps)=>store.saveSteps(id.parse(projectId),z.array(stepSchema).max(200).parse(steps)));
  register('notes:undo',value=>store.undoNotes(id.parse(value)));register('notes:redo',value=>store.redoNotes(id.parse(value)));
  register('projects:export',async(value,format)=>{const detail=store.getProject(id.parse(value));const kind=z.enum(['json','markdown']).parse(format);const output=await dialog.showSaveDialog(win,{defaultPath:`${detail.project.title.replace(/[^a-zA-Z0-9_-]/g,'_')}.${kind==='json'?'json':'md'}`,filters:[{name:kind==='json'?'JSON':'Markdown',extensions:[kind==='json'?'json':'md']}]});if(output.canceled||!output.filePath)return {saved:false};await writeFile(output.filePath,kind==='json'?JSON.stringify(detail,null,2):markdownExport(detail),'utf8');return {saved:true,path:output.filePath};});
  register('auth:account',()=>auth.account());register('auth:signin',()=>auth.signIn());register('auth:cancel',()=>auth.cancelSignIn());register('auth:signout',async()=>{runner.stop();await auth.signOut();store.saveSettings({...store.getSettings(),model:''});});register('auth:models',()=>auth.models());
  register('settings:get',()=>store.getSettings());register('settings:save',settings=>store.saveSettings(z.object({model:z.string().max(200),maxRequests:z.number().int().min(1).max(1000)}).parse(settings)));
  register('agents:run',input=>runner.run(z.object({projectId:id,role:z.enum(['methods','evidence','grammar','brainstorm']),text:z.string().min(1).max(MAX_AGENT_INPUT).refine(value=>Boolean(value.trim()),'Enter a research question or passage.'),refresh:z.boolean().optional()}).parse(input)));
  register('agents:cancel',value=>runner.cancel(id.parse(value)));register('external:open',value=>shell.openExternal(safeExternal(z.string().max(3000).parse(value))));
  if(dev)void win.loadURL('http://127.0.0.1:5173');else void win.loadFile(join(app.getAppPath(),'dist/index.html'));
});
app.on('window-all-closed',()=>{runner?.stop();auth?.cancelSignIn();app.quit();});
app.on('before-quit',()=>{runner?.stop();auth?.cancelSignIn();});
app.on('will-quit',()=>store?.close());
