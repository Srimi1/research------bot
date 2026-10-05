import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const qaServer=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5176'],{stdio:'ignore'});
let browser;
try {
for(let n=0;n<50;n++){try{if((await fetch('http://127.0.0.1:5176')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:900}});
await context.addInitScript(()=>{
const project={id:'fixture-project',title:'Methods UI fixture',topic:'Test fixture',question:'What can I measure?',notes:'My original researcher notes.',version:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const detail={project,sources:[],steps:[],runs:[]};
let event; let cancelPending; window.cancelInvocations=0;
window.research={listProjects:async()=>[project],getProject:async()=>structuredClone(detail),createProject:async()=>detail,saveProject:async(input)=>{detail.project={...detail.project,...input,version:detail.project.version+1};return structuredClone(detail.project)},deleteProject:async()=>{},saveSource:async(_,source)=>source,deleteSource:async()=>{},saveSteps:async(_,steps)=>{detail.steps=structuredClone(steps)},undoNotes:async()=>project,exportProject:async()=>({saved:true}),account:async()=>({signedIn:true,storageAvailable:true,name:'Fixture'}),signIn:async()=>({signedIn:true,storageAvailable:true}),cancelSignIn:async()=>{},signOut:async()=>{},models:async()=>['fixture'],getSettings:async()=>({model:'fixture',maxRequests:20}),saveSettings:async()=>{},onRunEvent:callback=>{event=callback;return()=>{}},cancelRun:async()=>{window.cancelInvocations++;cancelPending?.();},openExternal:async()=>{},run:async(request)=>{
const run={id:crypto.randomUUID(),projectId:project.id,role:request.role,status:'completed',model:'fixture',input:request.text,createdAt:new Date().toISOString()};
event({runId:run.id,projectId:project.id,type:'status',text:'Fixture test'});
if(window.holdNextRun){await new Promise(resolve=>{cancelPending=resolve});run.status='cancelled';detail.runs.unshift(run);return structuredClone(run);} 
if(request.role==='methods')run.result={kind:'methods',question:'How much food is wasted per student?',explanation:'A structured observation can help estimate the amount.',assumptions:['You can access the dining hall.'],options:[{name:'Waste audit',rationale:'Measures actual food waste.',limitations:'Only covers the observation period.'}],steps:[{id:run.id+'-step-one',title:'Define the sample',purpose:'Create consistent measurements.',output:'Sampling protocol',dependsOn:'None',check:'Protocol written',done:false},{id:run.id+'-step-two',title:'Collect observations',purpose:'Gather measurements.',output:'A dataset',dependsOn:'Define the sample',check:'Complete sample',done:false}]};
else if(request.role==='brainstorm')run.result={kind:'brainstorm',ideas:[{title:'Schedules and waste',explanation:'Class schedules may affect leftovers.',assumptions:'Dining times vary.',evidenceNeeded:'Timing and waste observations.',nextStep:'Compare lunch periods.'}]};
detail.runs.unshift(run);return structuredClone(run);
}};
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5176');
await page.getByRole('button',{name:'Explore research methods'}).click();await page.getByText('How much food is wasted per student?',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Working research question'}).inputValue(),'What can I measure?');
await page.getByRole('button',{name:'Use this research question'}).click();assert.equal(await page.getByRole('textbox',{name:'Working research question'}).inputValue(),'How much food is wasted per student?');
await page.getByRole('button',{name:'Accept this plan'}).click();await page.getByRole('button',{name:'Research plan',exact:false}).click();assert.equal(await page.locator('.plan-card').count(),2);await page.getByRole('button',{name:'Complete: Define the sample'}).click();await page.getByRole('button',{name:'Complete: Collect observations'}).click();assert.equal(await page.getByText('2 of 2 complete',{exact:true}).count(),1);
await page.getByRole('button',{name:'Research desk'}).click();await page.getByRole('button',{name:'Explore research methods'}).click();await page.getByRole('button',{name:'Add proposed steps to plan'}).click();await page.getByRole('button',{name:'Research plan',exact:false}).click();assert.equal(await page.locator('.plan-card').count(),4);assert.equal(await page.getByText('2 of 4 complete',{exact:true}).count(),1);
await page.getByRole('button',{name:'Research desk'}).click();await page.getByRole('button',{name:'Ideas',exact:true}).click();await page.getByRole('button',{name:'Explore ideas'}).click();await page.getByText('Schedules and waste',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Your research notes',exact:true}).inputValue(),'My original researcher notes.');await page.getByRole('button',{name:'Save idea to notes'}).click();assert.match(await page.getByRole('textbox',{name:'Your research notes',exact:true}).inputValue(),/My original researcher notes.\n\nIdea to investigate: Schedules and waste/);
await page.evaluate(()=>{window.holdNextRun=true});await page.getByRole('button',{name:'Explore ideas'}).click();await page.getByRole('button',{name:'Research plan',exact:false}).click();await page.getByRole('button',{name:'Cancel active task'}).click();await page.getByRole('button',{name:'Cancel active task'}).waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.cancelInvocations),1);
assert.deepEqual(errors,[]);await page.waitForTimeout(1000);await browser.close();console.log('PASS methods suggestions stay separate, explicit research-question adoption, plan acceptance and rapid completion, new proposed plan appends without overwriting completed steps, brainstorm explicit notes acceptance, global cancellation from another view; zero page errors.');

} finally { await browser?.close();qaServer.kill(); }
