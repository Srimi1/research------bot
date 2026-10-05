import { contextBridge, ipcRenderer } from 'electron';
import type { ResearchAPI, RunEvent } from '../src/shared/types';
const invoke=(channel:string,...args:unknown[])=>ipcRenderer.invoke(channel,...args);
const api:ResearchAPI={
  listProjects:()=>invoke('projects:list'),createProject:input=>invoke('projects:create',input),getProject:id=>invoke('projects:get',id),saveProject:input=>invoke('projects:save',input),deleteProject:id=>invoke('projects:delete',id),
  saveSource:(projectId,source)=>invoke('sources:save',projectId,source),deleteSource:(projectId,sourceId)=>invoke('sources:delete',projectId,sourceId),saveSteps:(projectId,steps)=>invoke('steps:save',projectId,steps),undoNotes:id=>invoke('notes:undo',id),exportProject:(id,format)=>invoke('projects:export',id,format),
  account:()=>invoke('auth:account'),signIn:()=>invoke('auth:signin'),cancelSignIn:()=>invoke('auth:cancel'),signOut:()=>invoke('auth:signout'),models:()=>invoke('auth:models'),getSettings:()=>invoke('settings:get'),saveSettings:settings=>invoke('settings:save',settings),run:request=>invoke('agents:run',request),cancelRun:id=>invoke('agents:cancel',id),openExternal:url=>invoke('external:open',url),
  onRunEvent:callback=>{const listener=(_event:Electron.IpcRendererEvent,data:RunEvent)=>callback(data);ipcRenderer.on('agents:event',listener);return()=>ipcRenderer.removeListener('agents:event',listener);}
};
contextBridge.exposeInMainWorld('research',api);
