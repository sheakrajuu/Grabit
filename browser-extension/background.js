import {extractPage} from './extractor.js';

const GRABIT_URL='http://localhost:3000/';
const MAX_TAB_WAIT_MS=15_000;

function dispatchImport(payload){
 window.dispatchEvent(new CustomEvent('grabit:browser-import',{detail:payload}));
}

async function openGrabitImport(payload){
 const response=await fetch(new URL('/api/health',GRABIT_URL),{cache:'no-store'});
 if(!response.ok)throw new Error('Start your local Grabit server before importing a page.');
 const tab=await chrome.tabs.create({url:GRABIT_URL,active:true});
 const deadline=Date.now()+MAX_TAB_WAIT_MS;
 while(Date.now()<deadline){
  const current=await chrome.tabs.get(tab.id);
  if(current.status==='complete')break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const current=await chrome.tabs.get(tab.id);
 if(current.status!=='complete')throw new Error('Grabit did not finish loading in time.');
 await chrome.scripting.executeScript({
  target:{tabId:tab.id},
  world:'MAIN',
  func:dispatchImport,
  args:[payload]
 });
}

chrome.action.onClicked.addListener(async tab=>{
 const tabId=tab.id;
 try{
  if(!Number.isInteger(tabId)||!/^https?:\/\//i.test(tab.url||''))throw new Error('Open a webpage before sending it to Grabit.');
  await chrome.action.setBadgeText({tabId,text:'...'});
  await chrome.action.setTitle({tabId,title:'Grabit is reading this page…'});
  const [result]=await chrome.scripting.executeScript({target:{tabId},func:extractPage});
  if(!result?.result)throw new Error('Could not read this page.');
  await openGrabitImport(result.result);
  await chrome.action.setBadgeText({tabId,text:'OK'});
  await chrome.action.setTitle({tabId,title:`Sent ${result.result.media.length} media items to Grabit`});
 }catch(error){
  console.warn('Grabit browser import failed:',error);
  await chrome.action.setBadgeText({tabId,text:'ERR'});
  await chrome.action.setTitle({tabId,title:`Grabit import failed: ${error.message}`});
 }
});
