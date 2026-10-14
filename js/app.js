import {$,esc,uid,host,validUrl,normalized,classify,fallbackThumbnail,socialMediaEmbed,videoCollectionTitle,pixivImageProxyUrl} from './utils.js';
import {openDB,migrateLegacy,loadLibrary,storeItem as persistItem,storeSection as persistSection,removeItem as deleteStoredItem,removeSection as deleteStoredSection} from './storage.js';
import {previewUrl,discoverPlaylistUrl,resolveVideoUrl,videoDownloadUrl} from './importer.js';
import {isVideoFile,videoFile} from './video-transcoder.js';
import {consumeShortLibraryShareLink,createItemShareData,createItemsShareData,createShortLibraryShareLink,hasLibraryShareLink,isShortLibraryShareLink,readLibraryShareLink} from './share.js';
import {inspectLibraryBackup} from './backup.js';
import {matchesContentType} from './library-filter.js';

'use strict';
const V={view:'inbox',sectionId:null,q:'',type:'all',sort:'recent',filterSectionId:'',libraryPage:0,selectMode:false,selected:new Set(),mediaIndex:-1,dialogItemId:null,dialogMode:'view',editReturnToViewer:false,dialogReturnFocus:null,items:[],sections:[],downloads:[],downloadPreview:null,downloadFilter:'all',downloadError:'',downloadUrl:'',installPrompt:null,preview:null,previewRequestId:0,showingHiddenMedia:false,watch:null,watchScrollTimer:null,watchResizeObserver:null,shareData:null,pendingBackup:null,pendingShareLink:'',task:null,undo:null};
const LIBRARY_PAGE_SIZE=60;
const UNDO_WINDOW_MS=8000;
const VIDEO_EXTENSION_BY_MIME={'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','video/ogg':'ogv','video/x-matroska':'mkv','video/x-msvideo':'avi','video/x-ms-wmv':'wmv','video/x-flv':'flv','video/mpeg':'mpeg','video/mp2t':'ts','video/dvd':'vob','video/x-ms-asf':'asf','video/3gpp':'3gp','video/3gpp2':'3g2'};
const localMediaUrls=new Map();
let appUpdatePending=false;
let reloadingForAppUpdate=false;
const icon=d=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const icons={inbox:'M3 12h5l1 2h6l1-2h5M5 5h14l2 7v7H3v-7z',star:'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',recent:'M3 12a9 9 0 1 0 3-6.7M3 4v5h5m4-1v5l3 2',archive:'M3 5h18v4H3zM5 9v11h14V9m-9 4h4',section:'M20 20a2 2 0 0 0 1.9-1.4l1-4A2 2 0 0 0 21 12H5a2 2 0 0 0-1.9 1.4l-1 4A2 2 0 0 0 4 20zM3 12V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v5',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',more:'M12 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2',hide:'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.3 4.2 9 7-.3 1.2-1 2.3-1.8 3.2M6.2 6.2C4 7.5 2.5 9.7 2 12c.7 2.8 4 7 10 7 1.2 0 2.3-.2 3.3-.6'};
function toast(message,undo){
 const el=$('#ts');el.replaceChildren(document.createTextNode(message));
 clearTimeout(toast.timer);el.classList.add('on');el.classList.toggle('has-undo',Boolean(undo));
 if(undo){
  const button=document.createElement('button');button.type='button';button.className='toast-undo';button.textContent='Undo';
  button.addEventListener('click',async()=>{button.disabled=true;try{await undo()}catch(error){reportError('Could not undo the last change',error)}finally{clearTimeout(toast.timer);el.classList.remove('on')}});
  el.append(button);toast.timer=setTimeout(()=>{el.classList.remove('on');V.undo=null},UNDO_WINDOW_MS);
 }else{V.undo=null;toast.timer=setTimeout(()=>el.classList.remove('on'),2800)}
}
function startTask(label,total=0,kind=''){
 if(V.task)V.task.controller.abort();
 V.task={label,total,completed:0,kind,controller:new AbortController()};
 renderTaskStatus();
 return V.task;
}
function updateTask(label,completed,total,task=V.task){
 if(!task||V.task!==task)return;
 Object.assign(V.task,{label,completed,total});
 renderTaskStatus();
}
function renderTaskStatus(){
 const el=$('#task-status');if(!el)return;
 if(!V.task){el.hidden=true;el.replaceChildren();return}
 const {label,completed,total,controller}=V.task;
 el.hidden=false;el.replaceChildren();
 const text=document.createElement('span');
 text.textContent=total?`${label} (${completed} of ${total})`:`${label}…`;
 el.append(text);
 if(controller&&!controller.signal.aborted){
  const button=document.createElement('button');button.type='button';button.className='b';button.textContent='Cancel';button.addEventListener('click',cancelTask);el.append(button);
 }
}
function cancelTask(){
 if(!V.task?.controller||V.task.controller.signal.aborted)return;
 V.task.controller.abort();
 updateTask('Stopping',V.task.completed,V.task.total);
}
function finishTask(task=V.task){if(V.task!==task)return;V.task=null;renderTaskStatus()}
function taskCancelled(task){if(!task.controller.signal.aborted)return false;const error=new Error('Operation cancelled.');error.name='AbortError';throw error}
function saveUndo(message,undo){
 V.undo=undo;
 toast(message,async()=>{const action=V.undo;V.undo=null;if(action)await action();await refreshLibrary();render();toast('Change undone.')});
}
function countLabel(count,singular,plural=`${singular}s`){return`${count} ${count===1?singular:plural}`}
function clearUndo(){V.undo=null;const el=$('#ts');el?.querySelector('.toast-undo')?.remove();el?.classList.remove('has-undo')}
async function storeItem(item){clearUndo();return persistItem(item)}
async function storeSection(section){clearUndo();return persistSection(section)}
async function removeItem(id){clearUndo();return deleteStoredItem(id)}
async function removeSection(id){clearUndo();return deleteStoredSection(id)}
function applyTheme(theme,persist=false){const selected=theme==='light'?'light':'dark';document.documentElement.dataset.theme=selected;const button=$('#themeToggle');const icon=document.createElement('img');icon.src=`./icons/${selected==='light'?'moon':'sun'}.svg`;icon.alt='';button.replaceChildren(icon);button.title=`Switch to ${selected==='light'?'dark':'light'} theme`;button.setAttribute('aria-label',button.title);const themeColor=document.querySelector('meta[name="theme-color"]');if(themeColor)themeColor.content=selected==='light'?'#eef2f7':'#0b0b0c';if(persist){try{localStorage.setItem('grabit-theme',selected)}catch(error){reportError('Could not remember theme preference',error)}}}
async function refreshLibrary(){const data=await loadLibrary();for(const url of localMediaUrls.values())URL.revokeObjectURL(url);localMediaUrls.clear();V.items=data.items;V.sections=data.sections}
function loadDownloadHistory(){try{const stored=JSON.parse(localStorage.getItem('grabit-download-history')||'[]');V.downloads=Array.isArray(stored)?stored.filter(entry=>entry&&typeof entry==='object'&&(typeof entry.url==='string'||typeof entry.localMediaId==='string')).slice(0,200):[]}catch(error){console.warn('Could not read download history:',error);V.downloads=[]}}
function storeDownloadHistory(){try{localStorage.setItem('grabit-download-history',JSON.stringify(V.downloads.slice(0,200)))}catch(error){reportError('Could not save download history',error)}}
function show(html,wide=false){closeFilterDropdowns();if(!$('#md').classList.contains('on'))V.dialogReturnFocus=document.activeElement;$('#bx').innerHTML=html;$('#bx').classList.toggle('wide',wide);$('#md').classList.remove('image-view-mode');$('#md').classList.add('on');$('#bx').querySelector('h2')?.setAttribute('id','dialog-title');if($('#bx h2'))$('#bx').setAttribute('aria-labelledby','dialog-title');else $('#bx').removeAttribute('aria-labelledby');const focus=$('#bx input:not([type="hidden"]),#bx textarea,#bx select,#bx button');(focus||$('#bx')).focus()}
function hide(){const returnFocus=V.dialogReturnFocus;if(V.task?.kind==='preview')V.previewRequestId++;if(V.task)cancelTask();$('#md').classList.remove('on','image-view-mode');$('#bx').innerHTML='';V.dialogItemId=null;V.dialogMode='view';V.editReturnToViewer=false;V.dialogReturnFocus=null;if(returnFocus?.isConnected)returnFocus.focus();reloadForAppUpdate()}
function focusCardMenuButton(id){[...document.querySelectorAll('[data-card-menu]')].find(button=>button.dataset.cardMenu===id)?.focus()}
function reloadForAppUpdate(){
 if(!appUpdatePending||reloadingForAppUpdate||$('#md').classList.contains('on'))return;
 if([...document.querySelectorAll('input[type="file"]')].some(input=>input.files?.length))return;
 appUpdatePending=false;reloadingForAppUpdate=true;location.reload();
}
const watchPlayback=main.querySelector('[data-watch-playback]');
if(watchPlayback)watchPlayback.addEventListener('error',()=>{
 const failedItem=V.items.find(entry=>entry.id===watch.itemId);if(!failedItem)return;
 const failedPage=sourcePages(failedItem)[watch.pageIndex],failedMedia=watchPageMedia(failedItem,failedPage)[watch.mediaIndex];
 if(!failedMedia)return;
 failedMedia.playbackUrl='';
 renderWatchPage();
 toast('This stream cannot play directly here. Try the provider player or original page.');
},{once:true});
function watchForAppUpdates(){
 if(!('serviceWorker'in navigator))return;
 let hadController=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!hadController){hadController=true;return}
  appUpdatePending=true;
  if($('#md').classList.contains('on')||[...document.querySelectorAll('input[type="file"]')].some(input=>input.files?.length)){
   toast('An update is ready. Save your open work and close this dialog to apply it.');
   return;
  }
  reloadForAppUpdate();
 });
 navigator.serviceWorker.register('./service-worker.js').then(registration=>{
  const checkForUpdate=()=>registration.update().catch(error=>console.warn('Grabit could not check for an app update:',error));
  checkForUpdate();
  setInterval(()=>{if(document.visibilityState==='visible')checkForUpdate()},5*60*1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdate()});
 }).catch(error=>console.error('Grabit could not register offline support:',error));
}
function sectionName(id){return V.sections.find(s=>s.id===id)?.name||''}
function sectionOptions(selected=[]){return V.sections.map(s=>`<label class="checklist"><input type="checkbox" name="section" value="${esc(s.id)}"${selected.includes(s.id)?' checked':''}> ${esc(s.name)}</label>`).join('')||'<div class="hint">No sections yet. Create one in the sidebar.</div>'}
function destinationOptions(){return`<select class="in" name="destination" aria-label="Save destination"><option value="">Inbox</option>${V.sections.map(section=>`<option value="${esc(section.id)}">${esc(section.name)}</option>`).join('')}</select>`}
function watchUrl(){const url=new URL(location.href);if(V.watch){url.searchParams.set('watch',V.watch.itemId);url.searchParams.set('page',String(V.watch.pageIndex));url.searchParams.set('media',String(V.watch.mediaIndex));url.searchParams.set('scroll',String(Math.max(0,Math.round(V.watch.scrollTop||0))))}else for(const key of ['watch','page','media','scroll'])url.searchParams.delete(key);return url}
function syncWatchUrl(push=false){
 const url=watchUrl();
 history[push?'pushState':'replaceState']({grabitWatch:!!V.watch},'',url);
 try{
  if(V.watch)sessionStorage.setItem('grabit-watch-route',JSON.stringify({itemId:V.watch.itemId,pageIndex:V.watch.pageIndex,mediaIndex:V.watch.mediaIndex,scrollTop:V.watch.scrollTop||0}));
  else sessionStorage.removeItem('grabit-watch-route');
 }catch(error){console.warn('Grabit could not persist the current viewer position for reload:',error)}
}
function readWatchRoute(){
 const params=new URLSearchParams(location.search);
 let route=params.get('watch')?{itemId:params.get('watch'),pageIndex:params.get('page'),mediaIndex:params.get('media'),scrollTop:params.get('scroll')}:null;
 if(!route){
  try{route=JSON.parse(sessionStorage.getItem('grabit-watch-route')||'null')}catch(error){console.warn('Grabit could not restore the saved viewer position:',error)}
 }
 if(!route||typeof route.itemId!=='string'||!route.itemId){V.watch=null;$('#win').classList.remove('watch-mode');$('#main').classList.remove('full-viewer','focused-view');return false}
 const pageIndex=Number(route.pageIndex),mediaIndex=route.mediaIndex===null||route.mediaIndex===undefined?-1:Number(route.mediaIndex),scrollTop=Number(route.scrollTop);
 V.watch={itemId:route.itemId,pageIndex:Number.isFinite(pageIndex)?Math.max(0,pageIndex):0,mediaIndex:Number.isFinite(mediaIndex)?mediaIndex:-1,scrollTop:Number.isFinite(scrollTop)?Math.max(0,scrollTop):0,lastScrollTop:Number.isFinite(scrollTop)?Math.max(0,scrollTop):0,headerHidden:false,showingHidden:false};
 return true;
}
function navItem(view,label,ic,count,sectionId){const current=V.view===view&&(view!=='section'||V.sectionId===sectionId);return `<div class="nv${current?' on':''}" role="button" tabindex="0"${current?' aria-current="page"':''} data-view="${view}"${sectionId?` data-section="${esc(sectionId)}"`:''}>${icon(ic)}<span>${esc(label)}</span>${count?`<em>${count}</em>`:''}</div>`}
function renderNav(){
 const live=V.items.filter(i=>!i.isArchived);
 const counts={inbox:0,favorites:0},sectionCounts=new Map(V.sections.map(section=>[section.id,0]));
 for(const item of live){
  if(!item.hiddenFromInbox)counts.inbox++;
  if(item.isFavorite&&!item.hiddenFromInbox)counts.favorites++;
  for(const id of item.sectionIds||[])if(sectionCounts.has(id))sectionCounts.set(id,sectionCounts.get(id)+1);
 }
 $('#nav').innerHTML=`<div class="sec">Library</div>${navItem('inbox','Inbox',icons.inbox,counts.inbox)}${navItem('favorites','Favorites',icons.star,counts.favorites)}${navItem('recent','Recently added',icons.recent)}${navItem('downloads','Download',icons.download,V.downloads.length)}${navItem('archived','Archived',icons.archive)}
 <div class="sec">Sections<button id="addSection" title="Create section" aria-label="Create section">+</button></div>${V.sections.map(s=>`<div class="section-entry">${navItem('section',s.name,icons.section,sectionCounts.get(s.id)||0,s.id)}<button class="section-manage" data-manage-section="${esc(s.id)}" aria-label="Manage ${esc(s.name)}" title="Manage section">${icon(icons.more)}</button></div>`).join('')}
 <div class="sec">Library tools</div><div class="nv" id="installApp" role="button" tabindex="0">${icon('M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4')}<span>Install Grabit app</span></div><div class="nv" id="exportLibrary" role="button" tabindex="0">${icon('M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4')}<span>Export library</span></div>`;
}
function matchingItems(){
 const q=V.q.trim().toLocaleLowerCase();
 let items=V.items.filter(i=>{
  if(V.view==='archived'?!i.isArchived:i.isArchived)return false;
  if(i.hiddenFromInbox&&V.view!=='section'&&V.view!=='archived')return false;
  if(V.view==='favorites'&&!i.isFavorite)return false;
  if(V.view==='downloads'&&!V.downloads.some(entry=>entry.itemId===i.id))return false;
  if(V.view==='section'&&!(i.sectionIds||[]).includes(V.sectionId))return false;
  if(V.filterSectionId&&!(i.sectionIds||[]).includes(V.filterSectionId))return false;
  if(!matchesContentType(i,V.type))return false;
  if(q&&!`${i.title} ${i.description} ${i.notes} ${i.sourceDomain} ${i.sourceUrl} ${i.originalUrl}`.toLocaleLowerCase().includes(q))return false;
  return true;
 });
 const savedAt=item=>Date.parse(item.savedAt)||0,updatedAt=item=>Date.parse(item.updatedAt)||0;
 items.sort((a,b)=>V.view==='recent'||V.sort==='recent'?savedAt(b)-savedAt(a):V.sort==='oldest'?savedAt(a)-savedAt(b):V.sort==='alphabetical'?a.title.localeCompare(b.title):updatedAt(b)-updatedAt(a));
 return items;
}
function thumbUrl(item){if(item.type==='note')return '';return pixivImageProxyUrl(item.thumbnailUrl||item.media?.find(m=>m.type==='image')?.sourceUrl||item.media?.find(m=>m.thumbnailUrl)?.thumbnailUrl||fallbackThumbnail(item.type))}
function card(item){
 const thumb=thumbUrl(item);const hasMorePlaylistVideos=item.type==='playlist'&&item.sourcePages?.some(page=>page.playlistPaging&&page.playlistHasMore);const labels={bookmark:'WEB',note:'NOTE',image:'IMAGE',video:'VIDEO',gallery:`GALLERY · ${item.media.length}`,playlist:`PLAYLIST · ${item.media.length}${hasMorePlaylistVideos?'+':''}`};
 const image=item.type==='note'?'':`<img class="art" src="${esc(thumb)}" alt="" loading="lazy" decoding="async">`;
 return `<article class="card${item.type==='note'?' note-card':''}${V.selectMode?' selecting':''}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(item.title)}">
 ${image}<span class="bd">${labels[item.type]||'ITEM'}</span><div class="cap">${esc(item.title||'Untitled')}</div>${item.sourceDomain?`<div class="source">${esc(item.sourceDomain)}</div>`:''}
 ${V.selectMode?'':`<button class="card-menu-button" data-card-menu="${esc(item.id)}" aria-label="More actions for ${esc(item.title)}" aria-haspopup="menu" aria-expanded="false">${icon(icons.more)}</button><div class="card-menu" role="menu"><button role="menuitem" data-card-action="moveSection" data-id="${esc(item.id)}">Move to section…</button>${item.sectionIds?.length?`<button role="menuitem" data-card-action="toggleInbox" data-id="${esc(item.id)}">${item.hiddenFromInbox?'Show in Inbox':'Hide from Inbox'}</button>`:''}<button role="menuitem" data-card-action="share" data-id="${esc(item.id)}">Share item…</button><button role="menuitem" data-card-action="edit" data-id="${esc(item.id)}">Edit</button><button role="menuitem" data-card-action="favorite" data-id="${esc(item.id)}">${item.isFavorite?'Remove favorite':'Add to favorites'}</button><button role="menuitem" data-card-action="archive" data-id="${esc(item.id)}">${item.isArchived?'Restore':'Archive'}</button><button role="menuitem" class="d" data-card-action="delete" data-id="${esc(item.id)}">Delete</button></div>`}${V.selectMode?`<input class="select-card" type="checkbox" data-select="${esc(item.id)}" aria-label="Select ${esc(item.title)}"${V.selected.has(item.id)?' checked':''}>`:''}</article>`;
}
function positionCardMenu(menu,button){
 const margin=8,trigger=button.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
 const left=Math.max(margin,Math.min(trigger.right-bounds.width,innerWidth-bounds.width-margin));
 const below=trigger.bottom+6,above=trigger.top-bounds.height-6;
 const top=below+bounds.height<=innerHeight-margin||above<margin?Math.min(below,innerHeight-bounds.height-margin):above;
 menu.style.setProperty('--menu-left',`${left}px`);
 menu.style.setProperty('--menu-top',`${Math.max(margin,top)}px`);
}
function closeCardMenus(){
 document.querySelectorAll('.card-menu.open').forEach(menu=>{
  menu.classList.remove('open');menu.style.removeProperty('--menu-left');menu.style.removeProperty('--menu-top');
  menu.closest('.card')?.classList.remove('menu-open');menu.previousElementSibling?.setAttribute('aria-expanded','false');
 });
}
function titleForView(){return V.view==='section'?sectionName(V.sectionId):({inbox:'Inbox',favorites:'Favorites',recent:'Recently added',downloads:'Download',archived:'Archived'}[V.view]||'Inbox')}
function desktopFilter(id,label,value,options){return`<div class="desktop-filter"><button class="filter-trigger" type="button" data-dropdown-toggle="${id}" aria-label="${label}" aria-controls="${id}-options" aria-haspopup="listbox" aria-expanded="false">${esc(options.find(option=>option.value===value)?.label||label)}<span aria-hidden="true"></span></button><div class="filter-options" id="${id}-options" role="listbox" aria-label="${label}" hidden>${options.map(option=>`<button type="button" role="option" aria-selected="${option.value===value}" data-dropdown-option="${id}" data-value="${esc(option.value)}">${esc(option.label)}</button>`).join('')}</div></div>`}
function closeFilterDropdowns(){document.querySelectorAll('.desktop-filter').forEach(filter=>{filter.querySelector('.filter-trigger')?.setAttribute('aria-expanded','false');const options=filter.querySelector('.filter-options');if(options)options.hidden=true});document.querySelectorAll('.tools.filter-menu-open').forEach(tools=>{tools.classList.remove('filter-menu-open');tools.style.removeProperty('--filter-menu-space')})}
function render(){
 renderNav();$('#ttl').textContent=titleForView();$('#q').hidden=V.view==='downloads';
 if(V.view==='downloads'){renderDownloadHistory();return}
 const items=matchingItems();const main=$('#main');
 const pageCount=Math.ceil(items.length/LIBRARY_PAGE_SIZE);
 V.libraryPage=Math.min(V.libraryPage,Math.max(0,pageCount-1));
 const visibleItems=items.slice(V.libraryPage*LIBRARY_PAGE_SIZE,(V.libraryPage+1)*LIBRARY_PAGE_SIZE);
 const types=['all','bookmark','image','video','gallery','playlist','note'];
 const typeLabels={all:'All types',bookmark:'Websites',image:'Images',video:'Videos',gallery:'Galleries',playlist:'Playlists',note:'Notes'};
 const filterActive=Boolean(V.q.trim()||V.type!=='all'||V.filterSectionId);
 const actions=V.selectMode?`<span class="selection-count" role="status" aria-live="polite">${V.selected.size} selected</span>${items.length?'<button class="b" data-bulk="selectAll">Select all</button>':''}${V.selected.size>1?'<button class="b" data-bulk="share">Share contents</button>':''}${V.selected.size&&V.view!=='inbox'?'<button class="b" data-bulk="inbox">Move to Inbox</button>':''}${V.selected.size?'<button class="b d" data-bulk="delete">Delete</button>':''}<button class="b" data-bulk="done">Done</button>`:items.length?'<button class="b" id="selectMode">Select</button>':'';
 const typeOptions=types.map(type=>({value:type,label:typeLabels[type]}));
 const sortOptions=[{value:'recent',label:'Recently added'},{value:'oldest',label:'Oldest added'},{value:'alphabetical',label:'Alphabetical'},{value:'updated',label:'Recently updated'}];
 const sectionOptions=[{value:'',label:'All sections'},...V.sections.map(section=>({value:section.id,label:section.name}))];
 const sectionFilter=V.view==='inbox'||V.view==='section'?'':`<select class="in" id="sectionFilter" aria-label="Filter by section">${sectionOptions.map(option=>`<option value="${esc(option.value)}"${V.filterSectionId===option.value?' selected':''}>${esc(option.label)}</option>`).join('')}</select>`;
 const sortFilter=V.view==='recent'?'':`<select class="in" id="sortOrder" aria-label="Sort content">${sortOptions.map(option=>`<option value="${option.value}"${V.sort===option.value?' selected':''}>${option.label}</option>`).join('')}</select>`;
 const toolbar=`<div class="tools"><div class="mobile-filters"><select class="in" id="typeFilter" aria-label="Filter by content type">${typeOptions.map(option=>`<option value="${option.value}"${V.type===option.value?' selected':''}>${option.label}</option>`).join('')}</select>${sortFilter}${sectionFilter}</div><div class="desktop-filters">${desktopFilter('typeFilter','Filter by content type',V.type,typeOptions)}${V.view==='recent'?'':desktopFilter('sortOrder','Sort content',V.sort,sortOptions)}${V.view==='inbox'||V.view==='section'?'':desktopFilter('sectionFilter','Filter by section',V.filterSectionId,sectionOptions)}</div>${filterActive?'<button class="b" data-clear-filters>Clear filters</button>':''}${actions}</div>`;
 const empty=V.view==='inbox'?'Your Inbox is empty. Save a link, write a note, or add an image to get started.':V.view==='favorites'?'Items you favorite will appear here.':V.view==='archived'?'Archived items will appear here.':V.view==='section'?'This section is empty. Add content or move items here.':'Your Inbox is empty. Save a link, write a note, or add an image to get started.';
 const pagination=pageCount>1?`<nav class="library-pagination" aria-label="Library pages"><button class="b" data-library-page="${V.libraryPage-1}"${V.libraryPage===0?' disabled':''}>Previous</button><span>Showing ${V.libraryPage*LIBRARY_PAGE_SIZE+1}–${Math.min((V.libraryPage+1)*LIBRARY_PAGE_SIZE,items.length)} of ${items.length}</span><button class="b" data-library-page="${V.libraryPage+1}"${V.libraryPage===pageCount-1?' disabled':''}>Next</button></nav>`:'';
 const emptyMessage=filterActive?'No items match these filters.':empty;
 main.innerHTML=toolbar+(items.length?`<div class="grid">${visibleItems.map(card).join('')}</div>${pagination}`:`<div class="empty">${V.q?`No results for “${esc(V.q)}”.`:esc(emptyMessage)}${filterActive?'<p><button class="b" data-clear-filters>Clear filters</button></p>':''}</div>`);
}
function imageFile(file){return new Promise((resolve,reject)=>{if(!file||!file.type.startsWith('image/')){reject(new Error('Choose a valid image file.'));return}if(file.size>12*1024*1024){reject(new Error('Images must be smaller than 12 MB for local storage.'));return}const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read the selected image.'));reader.onload=()=>{const image=new Image();image.onerror=()=>reject(new Error('The selected file is not a readable image.'));image.onload=()=>{const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');if(!ctx){reject(new Error('Image processing is unavailable.'));return}ctx.drawImage(image,0,0,canvas.width,canvas.height);resolve({data:canvas.toDataURL('image/jpeg',.84),width:canvas.width,height:canvas.height})};image.src=reader.result};reader.readAsDataURL(file)})}
function emptyItem({type,title,sourceUrl='',media=[],thumbnailUrl='',notes='',description='',sectionIds=[]}){
 const now=new Date().toISOString();return{id:uid(),type,title:title.trim()||host(sourceUrl)||'Untitled',description,notes,sourceUrl,originalUrl:sourceUrl,canonicalUrl:normalized(sourceUrl),sourceDomain:host(sourceUrl),thumbnailUrl,media:media.map((m,position)=>({...m,id:m.id||uid(),position})),sectionIds,isFavorite:false,isArchived:false,inbox:sectionIds.length===0,savedAt:now,updatedAt:now};
}
function addDialog(){
 show(`<b>Add to your library</b><p class="hint">Save links, write a note, or upload images and videos.</p><div class="row"><button class="b p" data-action="importDialog">Save links</button><button class="b" data-action="noteDialog">New note</button><button class="b" data-action="uploadDialog">Upload media</button><button class="b" data-action="close">Cancel</button></div>`);
}
function importDialog(){
 V.preview=null;
 show(`<b>Save links</b><p class="hint">Add one or more webpages or media links. Public video lists are saved as playlists, with 10 videos on each page.</p>
 <label for="urls">Webpage or media URLs</label><textarea class="in" id="urls" placeholder="Paste one URL per line" autocomplete="url"></textarea>
 <label for="mediaKind">Media to detect</label><select class="in" id="mediaKind"><option value="all">Auto-detect images and videos</option><option value="image">Images only</option><option value="video">Videos only</option></select>
 <div class="row"><button class="b p" data-action="previewPage">Preview media</button></div><div id="extractionPreview"></div>
 <label for="importTitle">Title (optional; applied when importing one URL)</label><input class="in" id="importTitle" maxlength="240" placeholder="Page title">
 <label for="importDescription">Description (optional)</label><textarea class="in" id="importDescription" maxlength="3000" placeholder="Description"></textarea>
 <label>Save to</label><div id="importSections">${destinationOptions()}</div>
 <p class="hint">Multiple direct links are grouped into a gallery or playlist.</p>
 <div class="row"><button class="b p" id="saveImportButton" data-action="saveImport">Save links</button><button class="b" data-action="close">Cancel</button></div>`);
}
function previewPanel(){
 const state=V.preview;if(!state)return;
 const countSelected=state.pages.reduce((count,page)=>count+page.media.filter(media=>page.selected.has(media.url)).length,0);
 const hiddenCount=new Set(state.pages.flatMap(page=>[...page.hiddenUrls])).size;
 const discoveryStatus=state.discoveryPending?'<p class="hint" role="status">Preparing preview…</p>':'';
 const sections=state.pages.map((page,pageIndex)=>{
  const available=page.media.map((media,mediaIndex)=>({media,mediaIndex})).filter(({media})=>state.showHidden||!page.hiddenUrls.has(media.url));
  const tiles=available.map(({media,mediaIndex})=>`<div class="media-tile ${media.type==='video'?'video-tile':''}">
   ${media.type==='video'&&media.embedUrl?`<img src="${esc(pixivImageProxyUrl(media.thumbnailUrl||fallbackThumbnail('video')))}" alt="" loading="lazy" decoding="async"><span class="play-mark" aria-hidden="true">▶</span>`:media.type==='video'?`<video src="${esc(media.playbackUrl||media.url)}" poster="${esc(pixivImageProxyUrl(media.thumbnailUrl||fallbackThumbnail('video')))}" muted playsinline preload="none" tabindex="-1"></video>`:`<img src="${esc(pixivImageProxyUrl(media.thumbnailUrl||media.url))}" alt="${esc(media.alt||`Image ${mediaIndex+1}`)}" loading="lazy" decoding="async">`}
   <label class="media-select"><input type="checkbox" data-preview-page="${pageIndex}" data-preview-select="${esc(media.url)}"${page.selected.has(media.url)?' checked':''}> Select</label>
   <button class="media-menu-button" data-preview-page="${pageIndex}" data-preview-hide="${esc(media.url)}" aria-label="${page.hiddenUrls.has(media.url)?'Unhide':'Hide'} this media">${page.hiddenUrls.has(media.url)?'Unhide':'Hide'}</button>
  </div>`).join('');
  const gallery=page.media.length?`<div class="media-grid preview-grid">${tiles||'<p class="hint">All media are hidden. Use Show hidden media to restore them.</p>'}</div>`:`<p class="hint">${page.error?'This URL could not be previewed.':'No media was detected; the URL will still be included in the full-page viewer.'}</p>`;
  const warnings=[page.mediaWarning,page.previewWarning,page.truncated?'Only the first 500 media items are shown.': ''].filter(Boolean);
  return`<section class="preview-page"><h3>${pageIndex+1}. ${esc(page.title||host(page.url))} <span>${page.media.length} media${page.error?` · ${esc(page.error)}`:''}</span></h3>${warnings.map(warning=>`<p class="hint" role="status">${esc(warning)}</p>`).join('')}${gallery}</section>`;
 }).join('');
 $('#extractionPreview').innerHTML=`<div class="extraction-preview"><div class="extract-summary"><span><b>${state.pages.length} ${state.pages.length===1?'page':'pages'} previewed</b><br><span class="hint">${countSelected} ${countSelected===1?'media item':'media items'} selected · ${hiddenCount} hidden${state.errors.length?` · ${state.errors.length} ${state.errors.length===1?'preview error':'preview errors'}`:''}</span></span><div><button class="b" data-action="toggleHiddenPreview">${state.showHidden?'Hide previously hidden':'Show previously hidden'} (${hiddenCount})</button></div></div>${discoveryStatus}${sections}</div>`;
 const saveButton=$('#saveImportButton');
 if(saveButton)saveButton.textContent=countSelected?'Save selected media':'Save links for viewing';
}
async function previewPage(requestedUrls){
 const inputs=requestedUrls||$('#urls').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
 const urls=[...new Set(inputs.map(value=>validUrl(value)?.href).filter(Boolean))];
 if(!urls.length){toast('Enter at least one valid webpage or media URL to preview.');return}
 if(urls.length>12){toast('Preview up to 12 URLs at a time.');return}
 if(urls.length!==inputs.length){toast('One or more URLs are invalid; correct them before previewing.');return}
 const button=$('[data-action="previewPage"]');button.disabled=true;button.textContent='Loading pages…';
 const previewRequestId=++V.previewRequestId;
 const task=startTask('Preparing preview',urls.length,'preview'),signal=task.controller.signal;
 try{
  let completed=0;
  const results=await Promise.all(urls.map(async url=>{
   try{
    const page=await extractPageForWatch(url,{signal,includePlaylist:false});
    const mediaKind=$('#mediaKind')?.value||'all';
    if(mediaKind!=='all')page.media=page.media.filter(media=>media.type===mediaKind);
    const canonical=normalized(page.canonicalUrl||url);
    const prior=V.items.filter(item=>item.canonicalUrl===canonical||normalized(item.sourceUrl)===canonical||item.sourceUrls?.some(saved=>normalized(saved)===canonical));
    const hiddenUrls=new Set(prior.flatMap(item=>item.hiddenMediaUrls||[]));
    return{...page,canonicalUrl:canonical,hiddenUrls,selected:new Set(page.media.filter(media=>!hiddenUrls.has(media.url)).map(media=>media.url)),extracted:true};
   }catch(error){if(error.name!=='AbortError')console.warn('Could not prepare a page preview:',error);return{url,canonicalUrl:normalized(url),title:host(url),description:'',media:[],hiddenUrls:new Set(),selected:new Set(),error:error.name==='AbortError'?'Preview stopped.':'This page could not be previewed. You can still save the link.',cancelled:error.name==='AbortError',extracted:false}}
   finally{completed++;updateTask(signal.aborted?'Stopping':'Preparing preview',completed,urls.length,task)}
  }));
  if(V.previewRequestId!==previewRequestId)return;
  const pages=results.filter(page=>!page.cancelled).sort((a,b)=>urls.indexOf(a.url)-urls.indexOf(b.url));
  const errors=pages.filter(page=>page.error).map(page=>({url:page.url,error:page.error}));
  if(!pages.length&&signal.aborted)throw Object.assign(new Error('Preview stopped before any page was loaded.'),{name:'AbortError'});
  if(pages.every(page=>page.error))throw new Error(errors.map(error=>`${host(error.url)}: ${error.error}`).join('; '));
  const candidates=pages.filter(page=>!page.error&&$('#mediaKind')?.value!=='image'&&(!page.playlistPaging||videoCollectionTitle(page.url))&&classify(page.url)==='bookmark'&&!page.media.some(media=>media.type==='video'));
  V.preview={pages,errors,showHidden:false,discoveryPending:candidates.length>0};
  if(urls.length===1&&!$('#importTitle').value.trim())$('#importTitle').value=pages[0].title||'';
  if(urls.length===1&&!$('#importDescription').value.trim())$('#importDescription').value=pages[0].description||'';
  previewPanel();
  const previewState=V.preview;
  if(candidates.length&&!signal.aborted){
   updateTask('Preparing preview',0,candidates.length,task);
   button.textContent='Preparing preview…';
   let completedDiscovery=0;
   await Promise.all(candidates.map(async page=>{
    try{
     const result=await discoverPlaylistUrl(page.url,{}, {signal});
     const known=new Set(page.media.map(media=>media.url));
     const discovered=result.media.filter(media=>!known.has(media.url));
     page.media.push(...discovered);
     for(const media of discovered)if(!page.hiddenUrls.has(media.url))page.selected.add(media.url);
     page.playlistPaging=result.playlistPaging===true;
     page.playlistStart=result.start||1;
     page.playlistHasMore=result.hasMore===true;
     page.playlistHasMoreByStart={[page.playlistStart]:page.playlistHasMore};
     page.mediaWarning=result.mediaWarning||page.mediaWarning||'';
     page.truncated=page.truncated||result.truncated;
    }catch(error){
     if(error.name!=='AbortError'){console.warn('Could not complete a page preview:',error);page.mediaWarning='Some media could not be loaded.';errors.push({url:page.url,error:page.mediaWarning})}
    }finally{
     const done=++completedDiscovery;
     updateTask(signal.aborted?'Stopping':'Preparing preview',done,candidates.length,task);
     if(V.preview===previewState){previewState.discoveryPending=done<candidates.length&&!signal.aborted;previewState.errors=errors;previewPanel()}
    }
   }));
  }
  if(signal.aborted&&V.preview===previewState){previewState.discoveryPending=false;previewState.errors=errors;previewPanel();toast('Preview stopped. You can still save the pages and media found so far.')}
 }catch(error){if(V.previewRequestId===previewRequestId){console.warn('Could not prepare the preview:',error);toast(signal.aborted?'Preview stopped.':'Could not prepare this preview. You can still save the link.')}}
 finally{finishTask(task);if(V.previewRequestId===previewRequestId&&button.isConnected){button.disabled=false;button.textContent='Preview media'}}
}
async function savePreview(){
 const state=V.preview;if(!state)return;
 const chosen=selectedSections($('#importSections')),firstPage=state.pages[0];
 const selected=state.pages.flatMap((page,pageIndex)=>page.media.filter(media=>page.selected.has(media.url)).map(media=>({...media,pageIndex})));
 const existingItems=V.items.filter(item=>state.pages.some(page=>item.canonicalUrl===page.canonicalUrl||normalized(item.sourceUrl)===page.canonicalUrl||item.sourceUrls?.some(saved=>normalized(saved)===page.canonicalUrl)));
 const hiddenMediaUrls=[...new Set([...existingItems.flatMap(item=>item.hiddenMediaUrls||[]),...state.pages.flatMap(page=>[...page.hiddenUrls])])];
 const savedMedia=state.pages.flatMap((page,pageIndex)=>page.media.filter(media=>page.selected.has(media.url)||page.hiddenUrls.has(media.url)).map(media=>({...media,pageIndex,hidden:page.hiddenUrls.has(media.url)})));
 const isVideoCollection=Boolean(videoCollectionTitle(firstPage.url)||firstPage.playlistPaging);
 if(isVideoCollection&&!savedMedia.some(media=>media.type==='video')){toast('Select at least one video to save this playlist.');return}
 const title=$('#importTitle').value.trim()||firstPage.title||host(firstPage.url);
 const description=$('#importDescription').value.trim()||firstPage.description||'';
 try{
  const selectedMedia=savedMedia.filter(entry=>!entry.hidden);
  const allVideos=selectedMedia.length>0&&selectedMedia.every(media=>media.type==='video');
  const type=isVideoCollection?'playlist':!selectedMedia.length?'bookmark':state.pages.length===1&&selectedMedia.length===1?selectedMedia[0].type:allVideos?'playlist':'gallery';
  const item=emptyItem({type, title,description,sourceUrl:firstPage.url,media:savedMedia.map((entry,position)=>({type:entry.type,sourceUrl:entry.url,providerUrl:entry.providerUrl||'',playbackUrl:entry.playbackUrl||'',embedUrl:entry.embedUrl||'',thumbnailUrl:entry.thumbnailUrl||'',alt:entry.alt||'',width:entry.width,height:entry.height,hidden:entry.hidden,position:entry.position??position,pageIndex:entry.pageIndex})),thumbnailUrl:selected.find(media=>media.type==='image')?.url||selected[0]?.thumbnailUrl||fallbackThumbnail(type),sectionIds:chosen});
  item.canonicalUrl=firstPage.canonicalUrl;item.sourceUrls=state.pages.map(page=>page.url);  item.sourcePages=state.pages.map((page,index)=>({url:page.url,canonicalUrl:page.canonicalUrl,title:page.title,description:page.description,index,extracted:page.extracted,refetchOnOpen:videoCollectionTitle(page.url)?false:page.refetchOnOpen===true,playlistPaging:page.playlistPaging===true,playlistStart:page.playlistStart||1,playlistHasMore:page.playlistHasMore===true,playlistHasMoreByStart:page.playlistHasMoreByStart||{[page.playlistStart||1]:page.playlistHasMore===true},mediaWarning:page.mediaWarning||'',previewWarning:page.previewWarning||'',truncated:!!page.truncated,media:savedMedia.filter(media=>media.pageIndex===index).map(({url,...media},position)=>({...media,sourceUrl:url,position:media.position??position,pageIndex:index}))}));item.hiddenMediaUrls=hiddenMediaUrls;
  await storeItem(item);
  await refreshLibrary();V.preview=null;hide();render();toast(`Saved ${state.pages.length} ${state.pages.length===1?'page':'pages'} and ${selected.length} ${selected.length===1?'media item':'media items'}.`);
 }catch(error){reportError('Could not save extracted media',error)}
}
async function toggleMediaVisibility(id,url){
 const item=V.items.find(entry=>entry.id===id);if(!item)return;
 const hidden=new Set(item.hiddenMediaUrls||[]);if(hidden.has(url))hidden.delete(url);else hidden.add(url);
 item.hiddenMediaUrls=[...hidden];if(hidden.has(item.thumbnailUrl))item.thumbnailUrl=defaultThumbnail(item);item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();const updated=V.items.find(entry=>entry.id===id);if(updated){if(V.watch?.itemId===id)renderWatchPage();else renderItemViewer(updated)}}
 catch(error){reportError('Could not update hidden media',error)}
}
function noteDialog(){
 show(`<b>New note</b><label for="noteTitle">Title</label><input class="in" id="noteTitle" maxlength="240" placeholder="Give your note a title"><label for="noteText">Note</label><textarea class="in" id="noteText" maxlength="10000" placeholder="Write your note here…"></textarea><label>Save to</label>${destinationOptions()}<div class="row"><button class="b p" data-action="saveNote">Save note</button><button class="b" data-action="close">Cancel</button></div>`);
}
function uploadDialog(droppedFiles=[]){
 V.droppedFiles=droppedFiles;
 show(`<b>Add media</b><p class="hint">Images are compressed; multiple selected photos are saved together as one gallery. Videos up to 100 MB each are saved on this device. Unsupported video codecs can be converted locally; the original stays private. Conversion uses extra device resources and may not work for every file.</p>${V.droppedFiles?.length?`<p>${V.droppedFiles.length} ${V.droppedFiles.length===1?'file is':'files are'} ready to add.</p>`:''}<label for="imageFiles">Choose images or videos</label><input class="in" id="imageFiles" type="file" accept="image/*,video/*,.mkv,.avi,.wmv,.flv,.mpeg,.mpg,.mts,.m2ts,.ts,.vob,.asf,.3gp,.3g2" multiple><label for="photoGalleryTitle">Photo gallery title (optional)</label><input class="in" id="photoGalleryTitle" maxlength="240" placeholder="Photo gallery"><label>Save to</label>${destinationOptions()}<div class="row"><button class="b p" data-action="saveImages">Add media</button><button class="b" data-action="close">Cancel</button></div>`);
}
function createSection(){show(`<b>New section</b><label for="newSectionName">Name</label><input class="in" id="newSectionName" maxlength="100" placeholder="e.g. Design ideas"><div class="row"><button class="b p" data-action="createSection">Create section</button><button class="b" data-action="close">Cancel</button></div>`)}
async function saveNewSection(){
 const clean=$('#newSectionName').value.trim();if(!clean){toast('Section name cannot be empty.');return}if(V.sections.some(s=>s.name.toLocaleLowerCase()===clean.toLocaleLowerCase())){toast('A section with that name already exists.');return}
 const section={id:uid(),name:clean,description:'',coverImage:'',position:V.sections.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 try{await storeSection(section);V.sections.push(section);hide();render();toast('Section created.')}catch(e){reportError('Could not create section',e)}
}
async function manageSection(id){
 const section=V.sections.find(s=>s.id===id);if(!section)return;
 show(`<b>${esc(section.name)}</b><label for="sectionName">Rename section</label><input class="in" id="sectionName" maxlength="100" value="${esc(section.name)}"><label for="sectionDescription">Description</label><textarea class="in" id="sectionDescription" maxlength="1000">${esc(section.description||'')}</textarea><div class="row"><button class="b p" data-action="saveSection" data-id="${esc(id)}">Save</button><button class="b d" data-action="deleteSection" data-id="${esc(id)}">Delete section…</button><button class="b" data-action="close">Close</button></div>`);
}
function detail(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;
 if(item.type==='note'){V.dialogItemId=id;V.mediaIndex=-1;renderItemViewer(item);return}
 startWatch(id);
}
function startWatch(id){
 const existing=V.watch;
 const item=V.items.find(entry=>entry.id===id);
 V.watch={itemId:id,pageIndex:existing?.itemId===id?existing.pageIndex:0,mediaIndex:existing?.itemId===id?existing.mediaIndex:['image','video'].includes(item?.type)||item?.type==='bookmark'&&item.media?.length===1&&item.media[0].type==='video'?0:-1,scrollTop:0,showingHidden:false};
 syncWatchUrl(!existing);renderWatchPage(true);
}
function orderedMedia(item){return(item.media||[]).slice().sort((a,b)=>(a.position||0)-(b.position||0))}
function mediaSource(media){const blob=media.convertedBlob instanceof Blob?media.convertedBlob:media.storedBlob instanceof Blob?media.storedBlob:null;if(blob){let url=localMediaUrls.get(blob);if(!url){url=URL.createObjectURL(blob);localMediaUrls.set(blob,url)}return url}return pixivImageProxyUrl(media.convertedDataUrl||media.storedDataUrl||media.playbackUrl||media.sourceUrl||'')}
function localVideoAttributes(item,media){if(!media){media=item;item=V.items.find(entry=>entry.media?.some(candidate=>candidate.id===media.id))}const isLocal=media?.type==='video'&&(media.storedBlob instanceof Blob||media.convertedBlob instanceof Blob||media.storedDataUrl?.startsWith('data:video/')||media.convertedDataUrl?.startsWith('data:video/'));return isLocal?`data-local-video="true" data-video-item="${esc(item?.id||'')}" data-video-media="${esc(media.id)}"${media.convertedBlob instanceof Blob||media.convertedDataUrl?' data-video-converted="true"':''}`:''}
function originalVideoBlob(media){if(media.storedBlob instanceof Blob)return media.storedBlob;if(media.storedDataUrl?.startsWith('data:video/'))return fetch(media.storedDataUrl).then(response=>response.blob());return null}
function viewerMedia(item){return orderedMedia(item)}
function sourcePages(item){
 if(Array.isArray(item.sourcePages)&&item.sourcePages.length)return item.sourcePages.map((page,index)=>({...page,index,media:Array.isArray(page.media)?page.media:item.media.filter(media=>(media.pageIndex||0)===index)}));
 return[{url:item.sourceUrl||'',title:item.title||host(item.sourceUrl),description:item.description||'',media:orderedMedia(item),index:0}];
}
function watchPageMedia(item,page){
 const media=page.media||[];
 if(!page.playlistPaging)return media;
 const start=page.playlistStart||1;
 return media.filter(entry=>(entry.position??0)>=start-1&&(entry.position??0)<start+9);
}
function defaultThumbnail(item){
 const hidden=new Set(item.hiddenMediaUrls||[]);
 const media=(item.media||[]).filter(entry=>!hidden.has(entry.sourceUrl));
 const image=media.find(entry=>entry.type==='image');
 if(image)return image.thumbnailUrl||image.storedDataUrl||image.sourceUrl;
 const video=media.find(entry=>entry.type==='video');
 return video?.thumbnailUrl||video?.storedDataUrl||fallbackThumbnail(item.type);
}
function downloadUrl(media){return media.downloadUrl||(!media.providerUrl&&!media.embedUrl?(media.playbackUrl||media.sourceUrl):'')}
function downloadButton(item,media,label='Download',className='b media-download-button',role=''){
 const url=downloadUrl(media);
 const target=url?`data-download-url="${esc(url)}"`:media.storedDataUrl||media.storedBlob instanceof Blob?`data-download-local="${esc(media.id)}"`:'';
 const roleAttribute=role?` role="${role}"`:'';
 const providerUrl=media.type==='video'&&(media.providerUrl||media.embedUrl)?`data-download-video="${esc(media.providerUrl||media.sourceUrl||media.url)}"`:'';
 return target||providerUrl?`<button class="${className}"${roleAttribute} ${providerUrl||target} data-download-title="${esc(item.title)}" data-download-type="${esc(media.type)}" data-download-thumb="${esc(media.thumbnailUrl||'')}" data-download-item="${esc(item.id)}">${label}</button>`:`<button class="${className}"${roleAttribute} disabled title="This provider embed does not expose a downloadable media file.">${label} unavailable</button>`;
}
function mediaExtension(mimeType,type){const subtype=mimeType?.toLowerCase().split('/')[1]||'';return VIDEO_EXTENSION_BY_MIME[mimeType?.toLowerCase()]||(type==='video'&&/^[\w.+-]+$/.test(subtype)?subtype.replace(/^x-/,''):type==='video'?'mp4':'jpg')}
async function downloadMedia(url,{itemId='',localMediaId='',title='Media',type='image',thumbnailUrl='',ytDlp=false,formatId=''}={}){
 if(!url){toast('This media has no downloadable source URL.');return}
 try{
  const blobSource=url instanceof Blob,local=blobSource||typeof url==='string'&&(url.startsWith('data:')||url.startsWith('blob:'));
  const anchor=document.createElement('a');let filename='';
  if(local){
   const blob=blobSource?url:await(await fetch(url)).blob();
   if(!blob.size)throw new Error('The downloaded media file is empty.');
   const objectUrl=URL.createObjectURL(blob);
   filename=`${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')||'media'}.${mediaExtension(blob.type,type)}`;
   anchor.href=objectUrl;anchor.download=filename;setTimeout(()=>URL.revokeObjectURL(objectUrl),60_000);
  }else{
   anchor.href=ytDlp?videoDownloadUrl(url,title,formatId):`/api/download?url=${encodeURIComponent(url)}`;
   anchor.rel='noopener';
   if(ytDlp)anchor.target='_blank';
   filename=ytDlp?title||'video':host(url)||title||'media';
  }
  document.body.append(anchor);anchor.click();anchor.remove();
  V.downloads.unshift({itemId,url:typeof url==='string'?url:'',localMediaId:localMediaId||(blobSource?'local':'')||undefined,title,type,thumbnailUrl,filename,ytDlp,formatId,downloadedAt:new Date().toISOString()});V.downloads=V.downloads.slice(0,200);storeDownloadHistory();renderNav();toast(`Download started: ${filename}`);
 }catch(error){console.error('Media download failed:',error);toast('Could not download this media. Try again or open the original link.')}
}
function renderDownloadHistory(){
 const records=V.downloads;
 const downloads=V.downloadPreview;
 const visibleMedia=downloads?downloads.media.filter(media=>V.downloadFilter==='all'||media.type===V.downloadFilter):[];
 const pageControls=downloads?.playlistPaging?`<div class="row download-page-controls" aria-label="Video list pages"><button class="b" data-download-page="${downloads.start-10}"${downloads.start<=1?' disabled':''}>Previous 10</button><span>Videos ${downloads.start}–${downloads.start+downloads.media.length-1}</span><button class="b" data-download-page="${downloads.start+10}"${downloads.hasMore?'':' disabled'}>Next 10</button></div>`:'';
 const content=downloads?visibleMedia.length?`<h2 class="download-heading">${esc(downloads.title)} <span>${visibleMedia.length} ${V.downloadFilter==='all'?'media '+(visibleMedia.length===1?'item':'items'):`${V.downloadFilter==='video'?'video':'image'} ${visibleMedia.length===1?'item':'items'}`}</span></h2>${pageControls}<p class="hint">Full-size results are sorted largest first. Some sites require sign-in or block downloads.</p>${downloads.warning?`<p class="hint" role="status">${esc(downloads.warning)}</p>`:''}${downloads.truncated?'<p class="hint" role="status">Only the first 500 media items are shown.</p>':''}<div class="download-discovery-grid">${visibleMedia.map((media,index)=>renderDownloadCard(media,index)).join('')}</div>`:`<div class="download-empty"><b>${downloads.media.length?'No '+(V.downloadFilter==='video'?'videos':'images')+' found.':'No downloadable media found.'}</b><p>${downloads.media.length?'Try another media type or URL.':'This page may require sign-in or block direct downloads.'}</p></div>`:'';
 const filters=`<div class="download-filters" role="group" aria-label="Media type filter">${[['all','All media'],['image','Images'],['video','Videos']].map(([type,label])=>`<button class="b${V.downloadFilter===type?' p':''}" type="button" data-download-filter="${type}" aria-pressed="${V.downloadFilter===type}">${label}</button>`).join('')}</div>`;
 const history=records.length?`<div class="download-history">${records.map((entry,index)=>`<article class="download-record"><img src="${esc(entry.thumbnailUrl||fallbackThumbnail(entry.type||'media'))}" alt="" loading="lazy"><div class="download-record-copy"><strong>${esc(entry.title||entry.filename||'Media download')}</strong><span>${esc(entry.filename||host(entry.url||''))} · ${esc(new Date(entry.downloadedAt).toLocaleString())}</span></div><button class="b" data-download-history="${index}">Download again</button></article>`).join('')}</div>`:'<p class="hint">Downloads started from this tool or saved media will appear here.</p>';
 $('#main').innerHTML=`<section class="download-tool"><h2>Download media</h2><p class="hint">Paste a public page or video link. Grabit finds available media and shows it full-size.</p><form class="download-url-form" id="downloadUrlForm"><input class="in" id="downloadUrlInput" type="url" required maxlength="2048" autocomplete="url" placeholder="Paste a webpage or video link" value="${esc(V.downloadUrl)}" aria-label="URL to find downloadable media"><button class="b p" type="submit"${V.downloadError==='loading'?' disabled':''}>${V.downloadError==='loading'?'Finding media…':'Find media'}</button></form>${filters}${V.downloadError&&V.downloadError!=='loading'?`<p class="download-error" role="alert">${esc(V.downloadError)}</p>`:''}${content}</section><section class="download-history-section"><div class="download-history-heading"><h2>Download history</h2><button class="b" data-clear-downloads${records.length?'':' disabled'}>Clear history</button></div>${history}</section>`;
}
function renderDownloadCard(media,index){
 const formats=media.formatOptions||[];
 const formatSelector=formats.length>1?`<label class="download-quality-label" for="quality-${index}">Video quality<select class="in" id="quality-${index}" data-discovery-quality>${formats.map((format,formatIndex)=>`<option value="${esc(format.formatId)}">${format.height?`${format.height}p`:format.width?`${format.width}px`:format.extension.toUpperCase()}${format.width&&format.height?` · ${format.width} × ${format.height}`:''}${format.filesize?` · ${format.filesize<1024*1024?`${Math.round(format.filesize/1024)} KB`:`${(format.filesize/(1024*1024)).toFixed(1)} MB`}`:''}${formatIndex===0?' · highest quality':''}</option>`).join('')}</select></label>`:'';
 const quality=media.width||media.height?`${media.width||'?'} × ${media.height||'?'} px`:media.density?`${media.density}×`:media.type==='video'&&index===0?'Highest listed quality':'';
 const mediaSource=media.playbackUrl||media.url;
 const video=media.type==='video';
 const visual=video&&media.embedUrl&&!media.playbackUrl
  ?`<iframe src="${esc(media.embedUrl)}" title="${esc(media.alt||`Video ${index+1}`)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`
  :video
   ?`<video controls src="${esc(mediaSource)}" poster="${esc(pixivImageProxyUrl(media.thumbnailUrl||fallbackThumbnail('video')))}" playsinline preload="metadata"></video>`
   :`<img src="${esc(pixivImageProxyUrl(mediaSource))}" alt="${esc(media.alt||'')}" loading="lazy" decoding="async">`;
 const canDownload=video?Boolean(media.providerUrl||media.embedUrl||media.url):!media.embedUrl;
 return`<article class="download-discovery-card"><div class="download-discovery-thumb">${visual}</div><div class="download-discovery-copy"><strong>${esc(video?'Video':'Image')} ${index+1}${quality?` · ${esc(quality)}`:''}</strong><span>${esc(host(mediaSource))}</span></div>${formatSelector}${!video&&media.embedUrl?'<p class="hint">This provider does not expose a downloadable image file.</p>':''}${video&&(media.providerUrl||media.embedUrl)&&!media.playbackUrl?`<button class="b" data-discovery-play="${index}">Play</button>`:''}${canDownload?`<button class="b p" data-discovery-download="${index}">${video?'Download video':'Download image'}</button>`:''}</article>`;
}
async function discoverDownloads(start=1,rawUrl=''){
 const input=$('#downloadUrlInput'),url=validUrl(rawUrl||V.downloadUrl||input?.value||'');
 if(!url){V.downloadError='Enter a valid public HTTP or HTTPS URL.';renderDownloadHistory();return}
 V.downloadUrl=url.href;V.downloadError='loading';V.downloadPreview=null;renderDownloadHistory();
 try{
  let page;
  const kind=classify(url.href);
  if(kind==='image'||kind==='video')page={title:host(url.href),media:[{type:kind,url:url.href,thumbnailUrl:kind==='image'?url.href:''}]};
   else{
    try{page=await previewUrl(url.href,start>1?{start}:{})}
    catch(error){console.warn('Could not prepare download preview:',error);page={title:host(url.href),media:[],previewWarning:'Could not prepare this preview. You can still open the original link.'}}
   }
  let media=(Array.isArray(page.media)?page.media:[]).filter(entry=>entry&&typeof entry.url==='string').flatMap(entry=>{
   if(entry.type!=='image'||!Array.isArray(entry.qualityOptions))return[entry];
   return entry.qualityOptions.map(option=>({...entry,...option,url:option.url,sourceUrl:option.url,qualityOptions:undefined}));
  }).sort((a,b)=>(Number(b.width||0)*Number(b.height||0))-(Number(a.width||0)*Number(a.height||0))||(Number(b.quality||0)-Number(a.quality||0)));
  if(V.downloadFilter!=='image'&&!page.playlistPaging&&!media.some(entry=>entry.type==='video'&&(entry.playbackUrl||(!entry.providerUrl&&!entry.embedUrl)))){
   try{media=[...media.filter(entry=>entry.type!=='video'),await resolveVideoUrl(url.href)]}
   catch(error){if(media.length)console.warn('Could not resolve an additional video source:',error);else if(page.previewWarning)throw new Error(page.previewWarning);else throw error}
  }
  V.downloadPreview={title:page.title||host(url.href),media,truncated:!!page.truncated,warning:page.mediaWarning||page.previewWarning||'',playlistPaging:page.playlistPaging===true,start:page.start||1,hasMore:page.hasMore===true};
  V.downloadError='';
  renderDownloadHistory();
 }catch(error){
  console.warn('Could not prepare the download preview:',error);
  V.downloadError='Could not prepare this link. You can still open the original page.';
  renderDownloadHistory();
 }
}
async function installGrabit(){
 if(V.installPrompt){
  await V.installPrompt.prompt();
  const choice=await V.installPrompt.userChoice;
  V.installPrompt=null;
  toast(choice.outcome==='accepted'?'Grabit app installation started.':'Grabit app installation was dismissed.');
  return;
 }
 if(matchMedia('(display-mode: standalone)').matches||navigator.standalone){toast('Grabit is already installed.');return}
 const isApple=/iphone|ipad|ipod/i.test(navigator.userAgent);
 toast(isApple?'To install, use Share, then Add to Home Screen.':'Use your browser menu and choose Install app or Add to Home screen.');
}
function embedPage(url,data){
 const page={url,canonicalUrl:data.canonicalUrl||normalized(url),title:data.title||host(url),description:data.description||'',media:Array.isArray(data.media)?data.media:[],refetchOnOpen:data.refetchOnOpen===true,mediaWarning:data.mediaWarning||'',previewWarning:data.previewWarning||'',truncated:!!data.truncated,playlistPaging:data.playlistPaging===true||videoCollectionTitle(url)!=='',playlistStart:Number.isSafeInteger(data.start)?data.start:1,playlistHasMore:data.hasMore===true};
 const embed=socialMediaEmbed(url);
 if(embed&&!page.playlistPaging&&!(embed.type==='video'&&page.media.filter(media=>media.type==='video').length>1)){
  const sourceMedia=page.media.find(media=>media.type===embed.type)||page.media.find(media=>media.type==='image')||page.media.find(media=>media.type==='video');
  const thumbnail=page.media.find(media=>media.type==='image')?.url||page.media.find(media=>media.type==='video')?.thumbnailUrl||fallbackThumbnail(embed.type);
  const embeddedMedia={type:embed.type,url,sourceUrl:url,providerUrl:embed.type==='video'?url:'',embedUrl:embed.url,thumbnailUrl:thumbnail,downloadUrl:sourceMedia?.type===embed.type?sourceMedia.url:'',alt:page.title};
  if(embed.type==='video'){
   page.media=[embeddedMedia];
   return page;
  }
  page.media=page.media.filter(media=>media.type!=='video'&&media.url!==thumbnail);
  page.media.unshift(embeddedMedia);
 }
 return page;
}
async function extractPageForWatch(url,{signal,includePlaylist=true}={}){
 const kind=classify(url);
 if(kind==='image'||kind==='video')return{url,canonicalUrl:normalized(url),title:host(url),description:'',media:[{type:kind,url,thumbnailUrl:kind==='image'?url:fallbackThumbnail('video')}]};
 if(socialMediaEmbed(url)){
  try{return embedPage(url,await previewUrl(url,includePlaylist?{}:{includePlaylist:false},{signal}))}
  catch(error){if(error.name==='AbortError')throw error;console.warn(`Could not preview social-media URL ${url}; using its provider embed instead.`,error);return embedPage(url,{canonicalUrl:normalized(url),title:host(url),description:'',media:[]})}
 }
 return embedPage(url,await previewUrl(url,includePlaylist?{}:{includePlaylist:false},{signal}));
}
async function loadWatchPage(item){
 const watch=V.watch;if(!watch||watch.itemId!==item.id||watch.loading)return;
 watch.loading=true;watch.extractionAttempted=true;renderWatchPage(false,'Loading page media…');
 try{
  const savedPages=Array.isArray(item.sourcePages)?item.sourcePages:[];
  const urls=Array.isArray(item.sourceUrls)&&item.sourceUrls.length?item.sourceUrls:[item.sourceUrl];
  const pages=[];
  for(let index=0;index<urls.length;index++){
   const url=urls[index];if(!url||!validUrl(url))continue;
   const saved=savedPages.find(page=>normalized(page.url)===normalized(url));
   if(saved?.playlistPaging){
    const start=saved.playlistStart||1;
    try{
     const result=await previewUrl(url,{start});
     const refreshedMedia=result.media.filter(media=>media.type==='video').map((media,position)=>({
      ...media,
      sourceUrl:media.sourceUrl||media.url,
      position:start-1+position,
      pageIndex:index
     }));
     const end=start-1+10;
     const retainedMedia=(saved.media||[]).filter(media=>media.position<start-1||media.position>=end);
     const refreshedByPosition=new Map(refreshedMedia.map(media=>[media.position,media]));
     const media=[...retainedMedia,...Array.from(refreshedByPosition.values())].sort((a,b)=>a.position-b.position);
     const hiddenUrls=new Set(item.hiddenMediaUrls||[]);
     for(const oldMedia of (saved.media||[]).filter(media=>media.position>=start-1&&media.position<end)){
      if(hiddenUrls.has(oldMedia.sourceUrl)){
       hiddenUrls.delete(oldMedia.sourceUrl);
       hiddenUrls.add(oldMedia.embedUrl||oldMedia.sourceUrl);
      }
     }
     item.hiddenMediaUrls=[...hiddenUrls];
     pages.push({...saved,index,playlistStart:result.start||start,playlistHasMore:result.hasMore===true,playlistHasMoreByStart:{...(saved.playlistHasMoreByStart||{}),[start]:result.hasMore===true},mediaWarning:result.mediaWarning||'',media,extracted:true});
    }catch(error){
     console.warn('Could not refresh saved media:',error);
     pages.push({...saved,index,mediaWarning:'Some media could not be refreshed.'});
    }
    continue;
   }
   if(saved?.extracted&&!saved.refetchOnOpen){pages.push({...saved,index,media:(saved.media||[]).map(media=>({...media,type:media.type||'image',sourceUrl:media.sourceUrl||media.url||'',position:media.position||0,pageIndex:index}))});continue}
   try{pages.push({...await extractPageForWatch(url),index,extracted:true})}
   catch(error){
    const cachedMedia=saved?.media||[];
    console.warn('Could not refresh a saved page:',error);
    pages.push({...saved,url,canonicalUrl:saved?.canonicalUrl||normalized(url),title:saved?.title||host(url),description:saved?.description||'',media:cachedMedia,index,extracted:cachedMedia.length>0,...(cachedMedia.length?{mediaWarning:'Some media could not be refreshed.'}:{error:'This page could not be previewed. You can still open the original link.'})});
   }
  }
  if(!pages.length)throw new Error('No valid page URLs are saved for this item.');
  item.sourcePages=pages.map((page,index)=>({...page,index,media:page.media.map((media,position)=>({...media,type:media.type||'image',sourceUrl:media.url||media.sourceUrl||'',position:media.position??position,pageIndex:index,thumbnailUrl:media.thumbnailUrl||''}))}));
  item.media=item.sourcePages.flatMap(page=>page.media);
  if(item.type==='bookmark'&&item.sourcePages.some(page=>page.playlistPaging))item.type='playlist';
  if(item.type==='bookmark'&&item.media.length===1&&item.media[0].type==='video'&&V.watch?.itemId===item.id)V.watch.mediaIndex=0;
  if(!item.thumbnailUrl||item.thumbnailUrl.startsWith('data:image/svg+xml,')||(item.hiddenMediaUrls||[]).includes(item.thumbnailUrl))item.thumbnailUrl=defaultThumbnail(item);
  item.updatedAt=new Date().toISOString();await storeItem(item);await refreshLibrary();
  if(V.watch?.itemId===item.id){V.watch.loading=false;renderWatchPage(false);if(item.sourcePages.some(page=>page.error))toast('Some URLs could not be previewed; use the URL controls to continue or retry.')}
 }catch(error){console.error('Could not load saved page media:',error);if(V.watch?.itemId===item.id){V.watch.loading=false;V.watch.retrying=true;renderWatchPage(false,'Could not load this page right now. Try again or open the original link.')}}
}
async function playVideoInGrabit(item,media,index){
 const watch=V.watch;if(!watch||watch.itemId!==item.id)return;
 watch.mediaIndex=index;watch.loading=true;renderWatchPage(false,'Finding a playable video…');
 try{
  const resolved=await resolveVideoUrl(media.providerUrl||media.sourceUrl||media.url),embedUrl=media.embedUrl;
  Object.assign(media,resolved);if(embedUrl)media.embedUrl=embedUrl;
  watch.loading=false;watch.scrollTop=0;syncWatchUrl();renderWatchPage(true);
 }catch(error){
  watch.loading=false;renderWatchPage();toast(`Could not open a native video stream. The provider player may still work: ${error.message}`);
 }
}
async function findAndPlayVideo(item){
 const watch=V.watch;if(!watch||watch.itemId!==item.id)return;
 const pages=Array.isArray(item.sourcePages)&&item.sourcePages.length?item.sourcePages:sourcePages(item);
 item.sourcePages=pages;
 const page=pages[watch.pageIndex];
 watch.loading=true;renderWatchPage(false,'Preparing video…');
 try{
  const resolved=await resolveVideoUrl(page.url);
  const media={...resolved,alt:resolved.alt||page.title||item.title,position:page.media.length,pageIndex:page.index};
  page.media.push(media);page.extracted=true;page.refetchOnOpen=false;
  item.sourceUrls=Array.isArray(item.sourceUrls)&&item.sourceUrls.length?item.sourceUrls:[page.url];
  item.media=pages.flatMap(source=>source.media);
  const savedPages=pages.map(source=>({...source,media:source.media.map(({playbackUrl,...entry})=>entry)}));
  try{await storeItem({...item,sourcePages:savedPages,media:savedPages.flatMap(source=>source.media)})}
  catch(error){reportError('Could not save the discovered video',error)}
  watch.mediaIndex=watchPageMedia(item,page).length-1;watch.loading=false;syncWatchUrl();renderWatchPage();
 }catch(error){
  console.warn('Could not prepare a playable video:',error);watch.loading=false;renderWatchPage();toast('Could not prepare this video. Try opening the original link.');
 }
}
async function loadPlaylistBatch(item,page,start){
 const watch=V.watch;if(!watch||watch.loading)return;
 const pages=Array.isArray(item.sourcePages)&&item.sourcePages.length?item.sourcePages:[page];
 item.sourcePages=pages;
 const sourcePage=pages[page.index]||page;
 watch.loading=true;renderWatchPage(false,`Loading videos ${start}–${Math.min(start+9,500)}…`);
 try{
  const result=await previewUrl(sourcePage.url,{start});
  const videos=result.media.filter(media=>media.type==='video');
  if(!videos.length)throw new Error('No videos were returned for this playlist page.');
  const batchEnd=start+9;
  const previousBatch=sourcePage.media.filter(media=>media.position>=start-1&&media.position<=batchEnd);
  const hiddenUrls=new Set(item.hiddenMediaUrls||[]);
  for(const oldMedia of previousBatch){
   if(hiddenUrls.has(oldMedia.sourceUrl)){
    hiddenUrls.delete(oldMedia.sourceUrl);
    hiddenUrls.add(oldMedia.embedUrl||oldMedia.sourceUrl);
   }
  }
  item.hiddenMediaUrls=[...hiddenUrls];
  const refreshedMedia=videos.map((media,index)=>({
   ...media,
   sourceUrl:media.sourceUrl||media.url,
   position:start-1+index,
   pageIndex:sourcePage.index
  }));
  sourcePage.media=[
   ...sourcePage.media.filter(media=>media.position<start-1||media.position>batchEnd),
   ...refreshedMedia
  ].sort((a,b)=>a.position-b.position);
  sourcePage.playlistStart=start;sourcePage.playlistHasMore=result.hasMore===true;sourcePage.playlistHasMoreByStart={...(sourcePage.playlistHasMoreByStart||{}),[start]:result.hasMore===true};sourcePage.mediaWarning=result.mediaWarning||'';
  item.media=item.sourcePages.flatMap(source=>source.media);
  item.thumbnailUrl=item.thumbnailUrl||sourcePage.media.find(media=>media.thumbnailUrl)?.thumbnailUrl||fallbackThumbnail('playlist');
  item.updatedAt=new Date().toISOString();await storeItem(item);await refreshLibrary();
  watch.mediaIndex=-1;watch.showingHidden=false;watch.scrollTop=0;watch.loading=false;syncWatchUrl();renderWatchPage(true);
 }catch(error){
  console.warn('Could not load the selected playlist page:',error);watch.loading=false;renderWatchPage();toast('Could not load these videos right now. Please try again.');
 }
}
async function changePlaylistBatch(item,page,start){
 const cachedMedia=page.media.filter(media=>media.position>=start-1&&media.position<start+9);
 if(start>=1&&start<=500&&cachedMedia.length&&cachedMedia.every(media=>media.playbackUrl)){
  page.playlistStart=start;page.playlistHasMore=page.playlistHasMoreByStart?.[start]??page.media.some(media=>media.position>=start+9);
  item.updatedAt=new Date().toISOString();
  try{await storeItem(item);await refreshLibrary()}catch(error){reportError('Could not save playlist position',error);return}
  V.watch.mediaIndex=-1;V.watch.showingHidden=false;V.watch.scrollTop=0;syncWatchUrl();renderWatchPage(true);
  return;
 }
 if(start>=1&&start<=500)await loadPlaylistBatch(item,page,start);
}
function watchMediaTile(item,media,index){
 const hidden=(item.hiddenMediaUrls||[]).includes(media.sourceUrl);
 const poster=pixivImageProxyUrl(media.thumbnailUrl|| (media.type==='image'?media.sourceUrl:fallbackThumbnail('video')));
 const visual=hidden?`<span class="hidden-media-placeholder" aria-hidden="true">${media.type==='video'?'Hidden video':'Hidden image'}</span>`:media.embedUrl&&!media.playbackUrl?`<img src="${esc(poster)}" alt="" loading="lazy"><span class="play-mark" aria-hidden="true">${media.type==='video'?'▶':'↗'}</span>`:media.type==='video'?`<video ${localVideoAttributes(item,media)} src="${esc(mediaSource(media))}" poster="${esc(poster)}" muted playsinline preload="none" tabindex="-1"></video><span class="play-mark" aria-hidden="true">▶</span>`:`<img src="${esc(mediaSource(media))}" alt="${esc(media.alt||item.title)}" loading="lazy" decoding="async">`;
 const ratio=media.width&&media.height?Number(media.height)/Number(media.width):media.type==='video'?0.75:1;
 return`<div class="watch-tile-wrap${hidden?' hidden-media':''}" data-ratio="${Number.isFinite(ratio)&&ratio>0?ratio:1}"><button class="watch-tile" data-watch-media="${index}" aria-label="${hidden?`Hidden ${media.type} ${index+1}`:`Open ${media.type} ${index+1}`}"${hidden?' disabled':''}>${visual}</button><button class="watch-actions-toggle" data-watch-menu aria-label="Show media actions" aria-haspopup="menu" aria-expanded="false">${icon(icons.more)}</button><div class="watch-actions-menu" role="menu"><button class="watch-hide-button" role="menuitem" data-watch-hide="${esc(media.sourceUrl)}">${icon(icons.hide)}<span>${hidden?`Unhide ${media.type}`:`Hide ${media.type}`}</span></button>${hidden?'':downloadButton(item,media,`${icon(icons.download)}<span>Download</span>`,'watch-download-button media-download-button','menuitem')}</div></div>`;
}
function layoutWatchGrid(grid){
 const style=getComputedStyle(grid),columns=style.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,gap=parseFloat(style.columnGap)||12,width=(grid.clientWidth-gap*(columns-1))/columns,heights=Array(columns).fill(0);
 grid.querySelectorAll('.watch-tile-wrap').forEach(tile=>{
  tile.style.position='absolute';tile.style.aspectRatio='';
  const image=tile.querySelector('img'),video=tile.querySelector('video');
  const ratio=image?.naturalWidth&&image?.naturalHeight?image.naturalHeight/image.naturalWidth:video?.videoWidth&&video?.videoHeight?video.videoHeight/video.videoWidth:Number(tile.dataset.ratio)||1;
  const column=heights.indexOf(Math.min(...heights)),height=width*ratio;
  tile.style.left=`${column*(width+gap)}px`;tile.style.top=`${heights[column]}px`;tile.style.width=`${width}px`;tile.style.height=`${height}px`;
  heights[column]+=height+gap;
 });
 grid.style.height=`${Math.max(0,...heights)-gap}px`;
}
function renderWatchPage(pushScroll=false,message=''){
 const watch=V.watch;if(!watch)return;
 const item=V.items.find(entry=>entry.id===watch.itemId);
 $('#win').classList.add('watch-mode');$('#main').classList.add('full-viewer');
 const main=$('#main'),savedScroll=pushScroll?watch.scrollTop:main.scrollTop;
 if(!item){main.classList.remove('focused-view');main.innerHTML=`<div class="watch-error"><p>This saved item is no longer available.</p><button class="b" data-watch-action="back">Back to library</button></div>`;return}
 const pages=sourcePages(item);watch.pageIndex=Math.max(0,Math.min(watch.pageIndex,pages.length-1));const page=pages[watch.pageIndex],media=watchPageMedia(item,page);
 const hiddenUrls=new Set(item.hiddenMediaUrls||[]),hiddenMedia=media.map((entry,index)=>({entry,index})).filter(({entry})=>hiddenUrls.has(entry.sourceUrl));
 const feedMedia=media.map((entry,index)=>({entry,index})).filter(({entry})=>!hiddenUrls.has(entry.sourceUrl));
 const displayedMedia=watch.showingHidden?hiddenMedia:feedMedia;
 watch.mediaIndex=Math.max(-1,Math.min(watch.mediaIndex,media.length-1));const active=watch.mediaIndex>=0?media[watch.mediaIndex]:null;
 const activeHidden=!!active&&(item.hiddenMediaUrls||[]).includes(active.sourceUrl);
 const shouldShowGallery=!active&&(['gallery','playlist'].includes(item.type)||(media.length>1&&['image','video'].includes(item.type)));
 main.classList.toggle('focused-view',!!active&&!shouldShowGallery);
 main.classList.toggle('library-image-view',item.type==='image'&&!!active&&!shouldShowGallery);
 const pageTitle=page.title||item.title||host(page.url);
 const pageControls=page.playlistPaging
  ?`<div class="watch-page-buttons"><button class="watch-page-button" data-watch-action="previousPlaylistBatch" aria-label="Previous 10 videos" title="Previous 10 videos"${page.playlistStart<=1?' disabled':''}>${icon('M15 18l-6-6 6-6')}</button><button class="watch-page-button" data-watch-action="nextPlaylistBatch" aria-label="Next 10 videos" title="Next 10 videos"${!page.playlistHasMore?' disabled':''}>${icon('M9 18l6-6-6-6')}</button></div>`
  :pages.length>1?`<div class="watch-page-buttons"><button class="watch-page-button" data-watch-action="previousPage" aria-label="Previous URL" title="Previous URL"${watch.pageIndex===0?' disabled':''}>${icon('M15 18l-6-6 6-6')}</button><button class="watch-page-button" data-watch-action="nextPage" aria-label="Next URL" title="Next URL"${watch.pageIndex===pages.length-1?' disabled':''}>${icon('M9 18l6-6-6-6')}</button></div>`:'';
 const controls=pageControls?`<div class="watch-controls has-page-navigation">${pageControls}</div>`:'';
 const hasGallery=['gallery','playlist'].includes(item.type)||media.length>1;
 const backAction=active&&hasGallery?'showGrid':'back';
 const backTarget=active&&hasGallery?'media gallery':'library';
 const navigation=`<header class="watch-header"><button class="b watch-back-button" data-watch-action="${backAction}" aria-label="Back to ${backTarget}"><svg class="watch-back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>${active&&hasGallery?'Gallery':'Library'}</span></button><div class="watch-heading"><strong>${esc(item.title)}</strong><span>${pages.length>1?`URL ${watch.pageIndex+1} of ${pages.length} · `:''}${esc(pageTitle)}</span></div>${controls}</header>`;
 let content='';
 if(message)content=`<div class="watch-message">${esc(message)}${item.sourceUrl?`<p><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original webpage</a></p>`:''}<button class="b" data-watch-action="retry">Retry</button></div>`;
 else if(active&&!shouldShowGallery)content=`<div class="watch-stage" data-swipe><button class="b watch-arrow previous" data-watch-action="previousMedia" aria-label="Previous photo"${watch.mediaIndex===0?' disabled':''}>‹</button><div class="watch-stage-content">${activeHidden?`<span class="hidden-media-placeholder">${active.type==='video'?'Hidden video':'Hidden image'}</span>`:active.type==='video'&&active.playbackUrl?`<video data-watch-playback ${localVideoAttributes(active)} controls autoplay playsinline preload="metadata" poster="${esc(active.thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(active))}">Video playback is unavailable in this browser.</video>`:active.embedUrl?`<iframe src="${esc(active.embedUrl)}" title="${esc(active.alt||pageTitle)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`:active.type==='video'?`<video ${localVideoAttributes(active)} controls autoplay playsinline preload="metadata" poster="${esc(active.thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(active))}">Video playback is unavailable in this browser.</video>`:`<img class="watch-active-image${watch.mediaDirection==='next'?' slide-from-right':watch.mediaDirection==='previous'?' slide-from-left':''}" src="${esc(mediaSource(active))}" alt="${esc(active.alt||pageTitle)}">`}</div><button class="b watch-arrow next" data-watch-action="nextMedia" aria-label="Next photo"${watch.mediaIndex===media.length-1?' disabled':''}>›</button></div><div class="watch-stage-caption"><span>${watch.mediaIndex+1} / ${media.length}</span>${activeHidden?`<button class="b" data-watch-hide="${esc(active.sourceUrl)}">Unhide ${active.type}</button>`:active.type==='image'?'':`${downloadButton(item,active)}${active.type==='video'&&(active.providerUrl||active.embedUrl)?`<button class="b" data-watch-action="resolveVideo">Try native player</button>`:''}<button class="b" data-watch-hide="${esc(active.sourceUrl)}">Hide ${active.type}</button>`}</div>`;
 else if(page.error&&!media.length)content=`<div class="watch-message">Could not load this URL: ${esc(page.error)}<p><a href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">Open original webpage</a></p><button class="b p" data-watch-action="resolveSourceVideo">Find and play video</button><button class="b" data-watch-action="retry">Retry</button></div>`;
 else if(media.length)content=`<div class="watch-page-info"><span>${esc(pageTitle)} · ${watch.showingHidden?`${hiddenMedia.length} hidden items`:`${feedMedia.length} items`}</span>${page.url?`<a href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">Open original</a>`:''}${!hasGallery&&!media.some(entry=>entry.type==='video')&&page.url?'<button class="b" data-watch-action="resolveSourceVideo">Find videos</button>':''}${hiddenMedia.length||watch.showingHidden?`<button class="watch-hidden-toggle" data-watch-action="${watch.showingHidden?'showGalleryFeed':'showHiddenMedia'}">${watch.showingHidden?'Back to gallery':`Hidden items (${hiddenMedia.length})`}</button>`:''}</div>${item.type==='playlist'?'':[page.mediaWarning,page.previewWarning,page.truncated?'Only the first 500 media items are shown.':''].filter(Boolean).map(warning=>`<p class="hint" role="status">${esc(warning)}</p>`).join('')}${displayedMedia.length?`<div class="watch-grid">${displayedMedia.map(({entry,index})=>watchMediaTile(item,entry,index)).join('')}</div>`:`<div class="watch-message">${watch.showingHidden?'There are no hidden media on this URL.':'No visible media. Open Hidden items to manage them.'}</div>`}`;
 else content=`<div class="watch-message">${esc(message||'No images or videos were found on this page.')}${page.url?`<p><a href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">Open original webpage</a></p><button class="b p" data-watch-action="resolveSourceVideo">Find and play video</button>`:''}</div>`;
 delete watch.mediaDirection;
 V.watchResizeObserver?.disconnect();V.watchResizeObserver=null;
 const viewerBackdrop=active?.type==='image'&&!activeHidden?`<img class="watch-viewer-backdrop" src="${esc(mediaSource(active))}" alt="" aria-hidden="true">`:'';
 main.innerHTML=`${viewerBackdrop}${navigation}<div class="watch-content${active?' focused-media-view':''}">${content}</div>`;
 main.querySelectorAll('iframe, video').forEach(player=>{player.referrerPolicy='strict-origin-when-cross-origin'});
 const pageInfo=main.querySelector('.watch-page-info > span');
 if(page.playlistPaging&&pageInfo)pageInfo.textContent=`${pageTitle} · Videos ${page.playlistStart}–${page.playlistStart+media.length-1} · ${watch.showingHidden?`${hiddenMedia.length} hidden items`:`${feedMedia.length} items`}`;
 const watchHeader=main.querySelector('.watch-header');
 if(watchHeader){watchHeader.classList.toggle('header-hidden',!active&&!!watch.headerHidden);main.style.setProperty('--watch-header-height',`${watchHeader.offsetHeight}px`)}
 const watchGrid=main.querySelector('.watch-grid');
 if(watchGrid){
  const updateLayout=()=>layoutWatchGrid(watchGrid);
  updateLayout();
  watchGrid.querySelectorAll('img').forEach(image=>image.addEventListener('load',updateLayout,{once:true}));
  V.watchResizeObserver=new ResizeObserver(updateLayout);V.watchResizeObserver.observe(watchGrid);
 }
 main.scrollTop=savedScroll;watch.scrollTop=savedScroll;
 if(message&&message.startsWith('Could not fetch')&&watch.retrying)return;
 const sourceNeedsRefresh=!!item.sourcePages?.some(page=>page.refetchOnOpen);
 if((sourceNeedsRefresh||!(item.type==='image'||item.type==='video'&&item.media?.length))&&!message&&!watch.extractionAttempted&&(!item.sourcePages?.length||item.sourcePages.some(page=>!page.extracted||page.refetchOnOpen))&&!watch.loading)loadWatchPage(item);
}
function mediaTile(item,media,index){
 const source=mediaSource(media),hidden=(item.hiddenMediaUrls||[]).includes(media.sourceUrl);const visual=hidden
  ?`<span class="hidden-media-placeholder" aria-hidden="true">${media.type==='video'?'Hidden video':'Hidden image'}</span>`
  :media.type==='video'
   ?media.embedUrl?`<img src="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" alt="" loading="lazy" decoding="async"><span class="play-mark" aria-hidden="true">▶</span>`:`<video ${localVideoAttributes(media)} src="${esc(source)}" poster="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" muted playsinline preload="none" tabindex="-1"></video><span class="play-mark" aria-hidden="true">▶</span>`
  :media.embedUrl?`<img src="${esc(media.thumbnailUrl||fallbackThumbnail('social'))}" alt="" loading="lazy" decoding="async"><span class="play-mark" aria-hidden="true">↗</span>`:`<img src="${esc(source)}" alt="${esc(item.title)} — image ${index+1}" loading="lazy" decoding="async">`;
 return `<div class="media-tile ${media.type==='video'?'video-tile':''}${hidden?' hidden':''}">
 <button class="media-open" data-action="openMedia" data-index="${index}" aria-label="${hidden?`Hidden ${media.type} ${index+1} of ${item.media.length}`:`Open ${media.type} ${index+1} of ${item.media.length}`}"${hidden?' disabled':''}>${visual}<span class="media-number">${index+1}</span></button>
 ${!hidden&&(downloadUrl(media)||media.storedBlob instanceof Blob||media.storedDataUrl)?downloadButton(item,media):''}
 <button class="media-menu-button" data-media-menu aria-label="Media options" aria-haspopup="menu" aria-expanded="false">${icon(icons.more)}</button>
 <div class="media-menu" role="menu"><button role="menuitem" data-media-visibility="${esc(media.sourceUrl)}">${hidden?`Unhide ${media.type}`:`Hide ${media.type}`}</button></div></div>`;
}
function libraryImageViewer(item,image,index,total,backAction){
 const source=esc(mediaSource(image));
 return `<div class="library-image-viewer"><img class="library-image-backdrop" src="${source}" alt="" aria-hidden="true"><button class="library-image-back" data-action="${backAction}" aria-label="${backAction==='backToGallery'?'Back to image gallery':'Close image viewer'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>${total>1?`<button class="library-image-arrow previous" data-action="mediaPrev" aria-label="Previous image">‹</button>`:''}<div class="library-image-content"><img src="${source}" alt="${esc(item.title)} — image ${index+1}"></div>${total>1?`<button class="library-image-arrow next" data-action="mediaNext" aria-label="Next image">›</button>`:''}<span class="library-image-counter">${index+1} / ${total}</span></div>`;
}
function renderItemViewer(item){
 V.dialogMode='view';const media=viewerMedia(item);if(V.mediaIndex>=media.length)V.mediaIndex=media.length-1;const focused=V.mediaIndex>=0?media[V.mediaIndex]:null;
 const focusedHidden=focused&&(item.hiddenMediaUrls||[]).includes(focused.sourceUrl);
 const shouldShowGallery=!focused&&(['gallery','playlist'].includes(item.type)||(media.length>1&&['image','video'].includes(item.type)));
 let display='',imageViewMode=false;
 if(focused&&!shouldShowGallery){
  if(focusedHidden)display=`<div class="hidden-media-view"><span class="hidden-media-placeholder">${focused.type==='video'?'Hidden video':'Hidden image'}</span></div><div class="row"><button class="b" data-media-visibility="${esc(focused.sourceUrl)}">Unhide ${focused.type}</button>${media.length>1?'<button class="b" data-action="backToGallery">Back to gallery</button>':''}</div>`;
  else if(focused.type==='image'&&!focused.embedUrl){imageViewMode=true;display=libraryImageViewer(item,focused,V.mediaIndex,media.length,'backToGallery')}
  else display=`<div class="focus-media">${focused.embedUrl?`<iframe src="${esc(focused.embedUrl)}" title="${esc(item.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`:focused.type==='video'?`<video ${localVideoAttributes(item,focused)} controls autoplay playsinline preload="metadata" poster="${esc(focused.thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(focused))}">Video playback is unavailable in this browser.</video>`:`<img src="${esc(mediaSource(focused))}" alt="${esc(item.title)} — image ${V.mediaIndex+1}">`}</div><div class="bar media-navigation"><button class="b" data-action="mediaPrev" aria-label="Previous media">‹ Previous</button><span>${V.mediaIndex+1} / ${media.length}</span><button class="b" data-action="mediaNext" aria-label="Next media">Next ›</button></div><div class="row">${downloadButton(item,focused)}<button class="b" data-media-visibility="${esc(focused.sourceUrl)}">${(item.hiddenMediaUrls||[]).includes(focused.sourceUrl)?'Unhide':'Hide'} this media</button><button class="b" data-action="backToGallery">Back to ${item.type==='playlist'?'playlist':'gallery'}</button></div>`;
 }else if(shouldShowGallery||(!focused&&['gallery','playlist'].includes(item.type))){
  const hiddenUrls=new Set(item.hiddenMediaUrls||[]),galleryMedia=media.map((entry,index)=>({entry,index})).filter(({entry})=>hiddenUrls.has(entry.sourceUrl)===V.showingHiddenMedia);
  display=`${hiddenUrls.size||V.showingHiddenMedia?`<div class="row between"><span class="hint">${V.showingHiddenMedia?`${galleryMedia.length} hidden items`:`${media.length-galleryMedia.length} visible items`}</span><button class="watch-hidden-toggle" data-action="toggleHiddenList">${V.showingHiddenMedia?'Back to gallery':`Hidden items (${hiddenUrls.size})`}</button></div>`:''}<div class="media-grid">${galleryMedia.map(({entry,index})=>mediaTile(item,entry,index)).join('')||`<p class="hint">${V.showingHiddenMedia?'No hidden media in this gallery.':'No visible media in this gallery.'}</p>`}</div>`;
 }else if(item.type==='video'&&media[0]){
  const hidden=(item.hiddenMediaUrls||[]).includes(media[0].sourceUrl);
  display=hidden?`<div class="hidden-media-view"><span class="hidden-media-placeholder">Hidden video</span></div><div class="row"><button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">Unhide video</button></div>`:`<div class="focus-media">${media[0].embedUrl?`<iframe src="${esc(media[0].embedUrl)}" title="${esc(item.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`:`<video ${localVideoAttributes(item,media[0])} controls autoplay playsinline preload="metadata" poster="${esc(media[0].thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(media[0]))}">Video playback is unavailable in this browser.</video>`}</div><div class="row">${downloadButton(item,media[0])}<button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">Hide this video</button></div>`;
 }else if(item.type==='image'&&media[0]){
  if((item.hiddenMediaUrls||[]).includes(media[0].sourceUrl))display=`<div class="hidden-media-view"><span class="hidden-media-placeholder">Hidden image</span></div><div class="row"><button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">Unhide image</button></div>`;
  else if(media[0].type==='image'&&!media[0].embedUrl){imageViewMode=true;display=libraryImageViewer(item,media[0],0,1,'close')}
  else display=`<div class="focus-media"><img src="${esc(mediaSource(media[0]))}" alt="${esc(item.title)}"></div><div class="row">${downloadButton(item,media[0])}<button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">${(item.hiddenMediaUrls||[]).includes(media[0].sourceUrl)?'Unhide':'Hide'} this image</button></div>`;
 }else if(item.type==='bookmark'){
  const thumbnail=thumbUrl(item);
  display=thumbnail?`<div class="bookmark-preview"><img src="${esc(thumbnail)}" alt=""></div>`:'<div class="bookmark-preview bookmark-fallback" aria-hidden="true">WEB</div>';
 }
 const details=`<div class="viewer-copy"><h2>${esc(item.title)}</h2>${item.sourceDomain?`<div class="source">${esc(item.sourceDomain)}</div>`:''}${item.sourceUrl&&validUrl(item.sourceUrl)?`<button class="b" data-action="openSource" data-url="${esc(item.sourceUrl)}">Open original</button>`:''}${item.description?`<p>${esc(item.description)}</p>`:''}${item.notes?`<p class="viewer-notes">${esc(item.notes)}</p>`:''}</div>`;
 show(imageViewMode?display:`<div class="viewer-head"><div><span class="bd-inline">${esc(item.type)}${['gallery','playlist'].includes(item.type)?` · ${media.length} ${item.type==='playlist'?'videos':'images'}`:''}</span></div><button class="ib" data-action="close" aria-label="Close viewer">×</button></div>${display}${details}`,true);
 if(imageViewMode)$('#md').classList.add('image-view-mode');
}
function editItem(id,returnToViewer=false){
 const item=V.items.find(x=>x.id===id);if(!item)return;
 V.dialogItemId=id;V.dialogMode='edit';V.editReturnToViewer=returnToViewer;const media=orderedMedia(item);
 const preview=thumbUrl(item);
 const thumbnailValue=item.thumbnailUrl?.startsWith('data:image/')?'':item.thumbnailUrl||'';
 show(`<h2>Edit content</h2>${preview?`<div class="pv"><img src="${esc(preview)}" alt="Current thumbnail"></div>`:''}
 <label for="detailTitle">Title</label><input class="in" id="detailTitle" maxlength="240" value="${esc(item.title)}">
 <label for="detailDescription">Description</label><textarea class="in" id="detailDescription" maxlength="3000">${esc(item.description||'')}</textarea>
 <label for="detailNotes">Personal notes</label><textarea class="in" id="detailNotes" maxlength="10000">${esc(item.notes||'')}</textarea>
 ${item.type!=='note'?`<label for="detailThumb">Custom thumbnail URL (optional)</label><input class="in" id="detailThumb" type="url" placeholder="https://…" value="${esc(thumbnailValue)}">`:''}
 <label for="detailSource">Source URL</label><input class="in" id="detailSource" type="url" value="${esc(item.sourceUrl||'')}">
 ${['gallery','playlist'].includes(item.type)?`<label for="mediaUrls">Media URLs (one per line; order is preserved)</label><textarea class="in" id="mediaUrls">${esc(media.map(m=>m.sourceUrl||m.storedDataUrl||'').join('\n'))}</textarea>`:''}
 <label>Sections (uncheck all to remove this item from its sections)</label><div id="detailSections">${sectionOptions(item.sectionIds||[])}</div>
 <label class="checklist"><input id="detailFavorite" type="checkbox"${item.isFavorite?' checked':''}> Favorite</label>
 <div class="row"><button class="b p" data-action="saveItem" data-id="${esc(item.id)}">Save changes</button><button class="b" data-action="cancelEdit" data-id="${esc(item.id)}">Cancel</button></div>`,true);
}
function moveItemToSectionDialog(id){
 const item=V.items.find(entry=>entry.id===id);if(!item)return;
 if(!V.sections.length){toast('Create a section first, then move this item from its menu.');return}
 show(`<b>Move to section</b><p class="hint">${esc(item.title||'Untitled')} will be moved out of Inbox and into the selected section.</p><label for="itemMoveSection">Destination section</label><select class="in" id="itemMoveSection">${V.sections.map(section=>`<option value="${esc(section.id)}">${esc(section.name)}</option>`).join('')}</select><div class="row"><button class="b p" data-action="confirmMoveToSection" data-id="${esc(id)}">Move item</button><button class="b" data-action="close">Cancel</button></div>`);
}
async function moveItemToSection(id){
 const item=V.items.find(entry=>entry.id===id),sectionId=$('#itemMoveSection')?.value;
 if(!item||!V.sections.some(section=>section.id===sectionId)){toast('Choose a valid section.');return}
 item.sectionIds=[sectionId];item.inbox=false;item.hiddenFromInbox=true;item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();hide();render();toast(`Moved to ${sectionName(sectionId)}.`)}
 catch(error){reportError('Could not move item to section',error)}
}
async function toggleItemInboxVisibility(id){
 const item=V.items.find(entry=>entry.id===id);if(!item)return;
 if(!item.sectionIds?.length){toast('Move this item to a section before hiding it from Inbox.');return}
 item.hiddenFromInbox=!item.hiddenFromInbox;item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();render();toast(item.hiddenFromInbox?'Hidden from Inbox.':'Shown in Inbox.')}
 catch(error){reportError('Could not update Inbox visibility',error)}
}
function selectedSections(root){const destination=root.querySelector('select[name="destination"]');return destination?(destination.value?[destination.value]:[]):[...root.querySelectorAll('input[name="section"]:checked')].map(x=>x.value)}
async function saveImports(){
 const urls=[...new Set($('#urls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];if(!urls.length){toast('Enter at least one URL.');return}
 const valid=[];const invalid=[];for(const raw of urls){const u=validUrl(raw);if(u)valid.push(u.href);else invalid.push(raw)}
 const chosen=selectedSections($('#importSections'));const title=$('#importTitle').value.trim();const description=$('#importDescription').value.trim();
 const duplicates=[];const unique=[];const seen=new Set();
 for(const url of valid){const key=normalized(url);const existing=V.items.find(i=>i.canonicalUrl===key&&!i.isArchived);if(existing||seen.has(key))duplicates.push({url,existing});else{unique.push(url);seen.add(key)}}
 const pending={valid,invalid,chosen,title,description,duplicates,unique};
 if(duplicates.length){V.pendingImport=pending;const first=duplicates.find(x=>x.existing);show(`<b>${duplicates.length===1?'Possible duplicate found':'Possible duplicates found'}</b><p>${countLabel(duplicates.length,'URL')} already exist or appear more than once in this batch. Choose how to continue; duplicates will not be merged automatically.</p><div class="row">${first?`<button class="b" data-action="openDuplicate" data-id="${esc(first.existing.id)}">Open existing item</button>`:''}<button class="b" data-action="continueImport" data-mode="skip">Skip duplicates</button><button class="b" data-action="continueImport" data-mode="section"${chosen.length?'':' disabled'}>Add existing items to selected sections</button><button class="b p" data-action="continueImport" data-mode="save">Save duplicates anyway</button><button class="b" data-action="close">Cancel</button></div>`);return}
 await continueImport(pending,'skip');
}
async function continueImport(pending,mode){
 const {valid,invalid,chosen,title,description,duplicates,unique}=pending;
 const work=mode==='save'?valid:unique;
 const sectionDuplicates=mode==='section'&&chosen.length?duplicates.filter(entry=>entry.existing):[];
 if(!work.length&&!sectionDuplicates.length){await refreshLibrary();hide();render();toast(`No new links were saved.${duplicates.length?` ${countLabel(duplicates.length,'duplicate')} skipped.`:''}${invalid.length?` ${countLabel(invalid.length,'invalid URL')} ignored.`:''}`);return}
 const task=startTask('Saving links',work.length+sectionDuplicates.length,'import');
 const videoCollections=work.filter(url=>videoCollectionTitle(url));
 const otherUrls=work.filter(url=>!videoCollectionTitle(url));
 const kinds=otherUrls.map(classify);let saved=0;const errors=[];
 const saveButton=$('#saveImportButton');
 if(saveButton){saveButton.disabled=true;saveButton.textContent='Saving…'}
 V.preview=null;
 try{
  for(const {existing}of sectionDuplicates){
   taskCancelled(task);
   existing.sectionIds=[...new Set([...(existing.sectionIds||[]),...chosen])];existing.inbox=false;existing.updatedAt=new Date().toISOString();await storeItem(existing);
   updateTask('Saving links',++task.completed,task.total,task);
  }
  for(const url of videoCollections){
   taskCancelled(task);
   try{
    const preview=await previewUrl(url,{}, {signal:task.controller.signal}),videos=preview.media.filter(media=>media.type==='video');
    if(!videos.length)throw new Error(`No videos were found in the creator list ${url}.`);
    const canonicalUrl=preview.canonicalUrl||normalized(url);
    const matchingItems=V.items.filter(item=>item.canonicalUrl===canonicalUrl||normalized(item.sourceUrl)===canonicalUrl||item.sourceUrls?.some(source=>normalized(source)===canonicalUrl));
    const hiddenMediaUrls=[...new Set(matchingItems.flatMap(item=>item.hiddenMediaUrls||[]))];
    const hidden=new Set(hiddenMediaUrls);
    const media=videos.map(({url:mediaUrl,...entry},position)=>({
     ...entry,
     sourceUrl:entry.sourceUrl||mediaUrl,
     hidden:hidden.has(entry.sourceUrl||mediaUrl),
     position:entry.position??position,
     pageIndex:0
    }));
    const page={url,canonicalUrl,title:preview.title||videoCollectionTitle(url),description:preview.description||'',index:0,extracted:true,refetchOnOpen:false,playlistPaging:videoCollectionTitle(url)!=='',playlistStart:preview.start||1,playlistHasMore:preview.hasMore===true,playlistHasMoreByStart:{[preview.start||1]:preview.hasMore===true},truncated:!!preview.truncated,mediaWarning:preview.mediaWarning||'',media};
    const item=emptyItem({type:'playlist',title:work.length===1&&title?title:page.title,description:work.length===1?description:page.description,sourceUrl:url,media,thumbnailUrl:media.find(entry=>entry.thumbnailUrl&&!hidden.has(entry.sourceUrl))?.thumbnailUrl||fallbackThumbnail('playlist'),sectionIds:chosen});
    item.canonicalUrl=canonicalUrl;item.sourceUrls=[url];item.sourcePages=[page];item.hiddenMediaUrls=hiddenMediaUrls;
    await storeItem(item);saved++;updateTask('Saving links',++task.completed,task.total,task);
   }catch(error){if(error.name==='AbortError')throw error;errors.push(`${url}: ${error.message}`);updateTask('Saving links',++task.completed,task.total,task)}
  }
  taskCancelled(task);
  if(otherUrls.length>1&&kinds.every(kind=>kind==='image'||kind==='video')){
   const media=otherUrls.map((url,position)=>({type:kinds[position],sourceUrl:url,thumbnailUrl:kinds[position]==='image'?url:fallbackThumbnail('video'),position,pageIndex:position}));
   const pages=otherUrls.map((url,index)=>({url,canonicalUrl:normalized(url),title:host(url)||url,description:'',index,extracted:true,media:[media[index]]}));
   const type=kinds.every(kind=>kind==='video')?'playlist':'gallery';
   const item=emptyItem({type,title:title||(type==='playlist'?'Video playlist':'Image gallery'),description,sourceUrl:otherUrls[0],media,thumbnailUrl:media.find(entry=>entry.type==='image')?.sourceUrl||media[0].thumbnailUrl,sectionIds:chosen});
   item.sourceUrls=otherUrls;item.sourcePages=pages;await storeItem(item);saved++;task.completed+=otherUrls.length;updateTask('Saving links',task.completed,task.total,task);
  }else if(otherUrls.length>1&&kinds.includes('bookmark')){
   const pages=otherUrls.map((url,index)=>({url,canonicalUrl:normalized(url),title:host(url)||url,description:'',index,extracted:false,media:[]}));
   const item=emptyItem({type:'bookmark',title:title||'Saved webpages',description,sourceUrl:otherUrls[0],thumbnailUrl:fallbackThumbnail('bookmark'),sectionIds:chosen});
   item.sourceUrls=otherUrls;item.sourcePages=pages;await storeItem(item);saved++;task.completed+=otherUrls.length;updateTask('Saving links',task.completed,task.total,task);
  }else{
   for(let index=0;index<otherUrls.length;index++){
    taskCancelled(task);
    try{const url=otherUrls[index],kind=kinds[index],media=kind==='bookmark'?[]:[{type:kind,sourceUrl:url,position:0}];const item=emptyItem({type:kind,title:otherUrls.length===1&&title?title:host(url)||url,description:otherUrls.length===1?description:'',sourceUrl:url,media,thumbnailUrl:kind==='image'?url:'',sectionIds:chosen});await storeItem(item);saved++;updateTask('Saving links',++task.completed,task.total,task)}
    catch(error){if(error.name==='AbortError')throw error;errors.push(`${otherUrls[index]}: ${error.message}`);updateTask('Saving links',++task.completed,task.total,task)}
   }
  }
  await refreshLibrary();finishTask(task);hide();render();  const skipped=mode==='save'?0:duplicates.length-sectionDuplicates.length;
  const status=sectionDuplicates.length&&!saved?`${countLabel(sectionDuplicates.length,'existing item')} added to the selected sections`: `${countLabel(saved,'entry')} saved${sectionDuplicates.length?`; ${countLabel(sectionDuplicates.length,'existing item')} added to the selected sections`:''}`;
  toast(`${status}${skipped?`; ${countLabel(skipped,'duplicate')} skipped`:''}${invalid.length?`; ${countLabel(invalid.length,'invalid URL')} ignored`:''}${errors.length?`; ${countLabel(errors.length,'link')} could not be saved`:''}.`);
  if(invalid.length)console.warn('Invalid URLs skipped:',invalid);if(errors.length)console.error('Some URLs could not be saved:',errors);
 }catch(error){
  await refreshLibrary();finishTask(task);
  if(error.name==='AbortError'){hide();render();toast(`${countLabel(saved,'entry')} saved before stopping.`)}
  else{if(saveButton?.isConnected){saveButton.disabled=false;saveButton.textContent='Save links'}reportError('Could not save imported links',error)}
 }
}
async function saveNote(){
 const title=$('#noteTitle').value.trim(),notes=$('#noteText').value.trim();if(!title&&!notes){toast('Add a title or note text first.');return}
 try{await storeItem(emptyItem({type:'note',title:title||'Untitled note',notes,sectionIds:selectedSections($('#bx'))}));await refreshLibrary();hide();render();toast('Note saved.')}catch(e){reportError('Could not save note',e)}
}
async function saveImages(){
 const files=[...($('#imageFiles')?.files||[]),...(V.droppedFiles||[])]; if(!files.length){toast('Choose at least one image or video.');return}
 const sections=selectedSections($('#bx')),galleryMedia=[];let count=0;const errors=[],task=startTask('Adding media',files.length,'media');
 for(const file of files){
  try{
   taskCancelled(task);
   if(file.type.startsWith('image/')){
    const image=await imageFile(file);taskCancelled(task);
    galleryMedia.push({type:'image',sourceUrl:'',storedDataUrl:image.data,width:image.width,height:image.height,position:galleryMedia.length,alt:file.name.replace(/\.[^.]+$/,'')});
   }else if(isVideoFile(file)){
    const video=await videoFile(file);taskCancelled(task);
    await storeItem(emptyItem({type:'video',title:file.name.replace(/\.[^.]+$/,''),media:[{type:'video',sourceUrl:'',storedBlob:video.blob,mimeType:video.mimeType,size:video.size,position:0}],thumbnailUrl:fallbackThumbnail('video'),sectionIds:sections}));
   }else throw new Error('Choose an image or video file.');
   count++;
  }
  catch(error){if(error.name==='AbortError')break;errors.push(`${file.name}: ${error.message}`)}
  updateTask(task.controller.signal.aborted?'Stopping':'Adding media',++task.completed,files.length,task);
 }
 if(galleryMedia.length){
  try{
   const galleryTitle=$('#photoGalleryTitle')?.value.trim()||'';
   const title=galleryMedia.length>1?galleryTitle||'Photo gallery':galleryMedia[0].alt||'Image';
   const type=galleryMedia.length>1?'gallery':'image';
   await storeItem(emptyItem({type,title,media:galleryMedia,thumbnailUrl:galleryMedia[0].storedDataUrl,sectionIds:sections}));
  }catch(error){count-=galleryMedia.length;errors.push(`Photo gallery: ${error.message}`)}
 }
 V.droppedFiles=[];await refreshLibrary();finishTask(task);hide();render();toast(`${countLabel(count,'file')} saved${task.controller.signal.aborted?' before stopping':''}${errors.length?`; ${countLabel(errors.length,'file')} could not be saved. Try a smaller file or check available storage.`:''}.`);if(errors.length)console.error('Media upload errors:',errors);
}
async function convertSavedVideo(itemId,mediaId){
 const item=V.items.find(entry=>entry.id===itemId),media=item?.media.find(entry=>entry.id===mediaId);
 if(!item||!media||media.type!=='video'){toast('This saved video is no longer available.');return}
 if(media.convertedBlob instanceof Blob||media.convertedDataUrl){toast('A converted copy is already saved for this video.');return}
 const task=startTask('Preparing on-device video conversion',0,'video-conversion');
 try{
  const original=await originalVideoBlob(media);
  if(!original)throw new Error('The original local video file is unavailable.');
  taskCancelled(task);
  const {transcodeForBrowser}=await import('./video-transcoder.js');
  const convertedBlob=await transcodeForBrowser(original,{
   signal:task.controller.signal,
   onStatus:status=>updateTask(status,0,0,task),
   onProgress:progress=>updateTask(`Converting on this device (${Math.round(progress*100)}%)`,0,0,task)
  });
  taskCancelled(task);
  const updated={...item,media:item.media.map(entry=>entry.id===mediaId?{...entry,convertedBlob,convertedMimeType:'video/mp4',convertedSize:convertedBlob.size}:entry),updatedAt:new Date().toISOString()};
  await storeItem(updated);
  await refreshLibrary();
  finishTask(task);
  if(V.watch?.itemId===itemId)renderWatchPage();
  else if(V.dialogItemId===itemId)renderItemViewer(V.items.find(entry=>entry.id===itemId));
  else render();
  toast('A browser-compatible copy was saved on this device. The original video is unchanged.');
 }catch(error){
  finishTask(task);
  if(error.name==='AbortError'){toast('Video conversion cancelled. The original remains saved.');return}
  console.error('On-device video conversion failed:',error);
  toast('Could not convert this video on this device. It may be damaged, protected, or use an unsupported codec; the original remains saved.');
 }
}
async function saveDetail(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;
 const source=$('#detailSource').value.trim();if(source&&!validUrl(source)){toast('Source URL must use http or https.');return}
 const thumb=item.type==='note'?'':$('#detailThumb').value.trim();if(thumb&&!validUrl(thumb)){toast('Thumbnail URL must use http or https.');return}
 let media=item.media||[];
 if(['gallery','playlist'].includes(item.type)){
  const lines=$('#mediaUrls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length){toast('A gallery or playlist must contain at least one media URL.');return}
  if(lines.some(x=>!validUrl(x))){toast('Every media URL must use http or https.');return}
  media=lines.map((url,position)=>({...media.find(m=>m.sourceUrl===url)||{},id:media.find(m=>m.sourceUrl===url)?.id||uid(),type:item.type==='gallery'?'image':'video',sourceUrl:url,storedDataUrl:undefined,position}));
 }
 const updated={...item,title:$('#detailTitle').value.trim()||item.title,description:$('#detailDescription').value.trim(),notes:$('#detailNotes').value.trim(),thumbnailUrl:item.type==='note'?'':thumb||media.find(m=>m.storedDataUrl)?.storedDataUrl||media.find(m=>m.type==='image')?.sourceUrl||'',sourceUrl:source,canonicalUrl:normalized(source),sourceDomain:host(source),media:media.map(entry=>({...entry})),sectionIds:selectedSections($('#detailSections')),isFavorite:$('#detailFavorite').checked,updatedAt:new Date().toISOString()};
 if(['image','video'].includes(item.type)&&updated.media[0]&&source!==item.sourceUrl)updated.media[0].sourceUrl=source;
 updated.inbox=updated.sectionIds.length===0;updated.hiddenFromInbox=Boolean(item.hiddenFromInbox&&updated.sectionIds.length);
 try{
  await storeItem(updated);await refreshLibrary();
  const returnToViewer=V.editReturnToViewer&&V.watch?.itemId===id;
  hide();
  if(returnToViewer){renderWatchPage();document.querySelector('[data-watch-action="edit"]')?.focus()}else{render();focusCardMenuButton(id)}
  toast('Changes saved.');
 }catch(e){reportError('Could not save changes',e)}
}
async function toggleFavorite(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;item.isFavorite=!item.isFavorite;item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();render()}catch(e){reportError('Could not update favorite',e)}
}
async function bulk(action,confirmed=false){
 const items=V.items.filter(i=>V.selected.has(i.id));if(!items.length){toast('Select at least one item.');return}
 if((action==='archive'||action==='delete')&&!confirmed){V.pendingBulkAction=action;show(`<b>${action==='delete'?'Delete selected content':'Archive selected content'}</b><p>${action==='delete'?`Delete ${countLabel(items.length,'item')} from this library? You can undo this for a short time.`:`Archive ${countLabel(items.length,'item')}? You can undo this for a short time.`}</p><div class="row"><button class="b d" data-action="confirmBulk">${action==='delete'?'Delete items':'Archive items'}</button><button class="b" data-action="close">Cancel</button></div>`);return}
 const snapshots=new Map(items.map(item=>[item.id,structuredClone(item)])),changed=[];
 const task=startTask(action==='delete'?'Deleting items':'Updating items',items.length,'bulk');
 const shouldFavorite=!items.every(i=>i.isFavorite);
 try{
  for(const item of items){
   if(task.controller.signal.aborted)break;
   if(action==='inbox'){item.sectionIds=[];item.inbox=true;item.hiddenFromInbox=false}
   if(action==='archive')item.isArchived=true;
   if(action==='favorite')item.isFavorite=shouldFavorite;
   if(action==='delete')await removeItem(item.id);
   else{item.updatedAt=new Date().toISOString();await storeItem(item)}
   changed.push(item.id);updateTask(task.controller.signal.aborted?'Stopping':action==='delete'?'Removing items':'Updating library',changed.length,items.length,task);
  }
  V.selected.clear();await refreshLibrary();finishTask(task);render();
  const undo=async()=>{for(const id of changed)await storeItem(snapshots.get(id))};
  if(changed.length)saveUndo(task.controller.signal.aborted?`${countLabel(changed.length,'item')} changed before cancellation.`:`${countLabel(changed.length,'item')} ${action==='delete'?'deleted':'updated'}.`,undo);
  else toast('No changes were made.');
 }catch(error){
  V.selected.clear();await refreshLibrary();finishTask(task);render();
  if(changed.length)saveUndo(`${countLabel(changed.length,'item')} changed before the operation stopped.`,async()=>{for(const id of changed)await storeItem(snapshots.get(id))});
  reportError('Could not update selected items',error)
 }
}
function blobAsDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not prepare uploaded media for export.'));reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Could not encode uploaded media for export.'));reader.readAsDataURL(blob)})}
async function downloadJson(){
 try{
  const data=await libraryExportData();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`grabit-library-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Library export downloaded.');
 }catch(error){reportError('Could not export library',error)}
}
async function libraryExportData(){
 const items=await Promise.all(V.items.map(async({tags,...item})=>({...item,media:await Promise.all((item.media||[]).map(async media=>{
  const {storedBlob,convertedBlob,...exportMedia}=media;
  if(storedBlob instanceof Blob){exportMedia.storedDataUrl=await blobAsDataUrl(storedBlob);exportMedia.mimeType=media.mimeType||storedBlob.type;exportMedia.size=media.size??storedBlob.size}
  if(convertedBlob instanceof Blob)exportMedia.convertedDataUrl=await blobAsDataUrl(convertedBlob);
  return exportMedia;
 }))})));
 return{format:'grabit-library',version:1,exportedAt:new Date().toISOString(),storage:'metadata and uploaded media data; external media files are referenced by URL',sections:V.sections,items};
}
function shareDialog(data,title,description){
 V.shareData=data;
 show(`<b>${esc(title)}</b><p class="hint">${esc(description)} The content is encrypted in this browser before the link is created. The link is one-time and is consumed after the first successful import. Anyone with the complete link can decrypt it, so share it privately.</p><div class="row"><button class="b p" data-action="createShareLink">Create encrypted one-time link</button><button class="b" data-action="close">Close</button></div><div id="shareLinkOutput" hidden><label for="shareLinkValue">Encrypted share link</label><textarea class="in" id="shareLinkValue" rows="2" readonly></textarea><div class="row"><button class="b" data-action="copyShareLink">Copy link</button></div></div>`);
}
function exportDialog(){
 V.shareData=null;
 show(`<b>Export library</b><p class="hint">A JSON backup includes saved items, sections, and uploaded image/video data. External media is saved as links, not downloaded copies. JSON backups are unencrypted, so store them somewhere private. Importing a backup keeps existing items and skips duplicates.</p><div class="row"><button class="b p" data-action="createShareLink">Create encrypted one-time link</button><button class="b" data-action="downloadExport">Download JSON backup</button><button class="b" data-action="restoreDialog">Import…</button><button class="b" data-action="close">Close</button></div><div id="shareLinkOutput" hidden><label for="shareLinkValue">Encrypted share link</label><textarea class="in" id="shareLinkValue" rows="2" readonly></textarea><div class="row"><button class="b" data-action="copyShareLink">Copy link</button></div></div>`);
}
async function shareItem(id){
 const item=V.items.find(entry=>entry.id===id);if(!item)return;
 try{shareDialog(createItemShareData(await libraryExportData(),id),`Share “${item.title||'Untitled'}”`,'Only this item will be included.');}
 catch(error){reportError('Could not prepare this item for sharing',error)}
}
async function shareSelectedItems(){
 const ids=[...V.selected];if(ids.length<2){toast('Select at least two items to share their contents.');return}
 try{
  const data=createItemsShareData(await libraryExportData(),ids);
  shareDialog(data,'Share selected contents',`${data.items.length} selected items will be included.`);
 }catch(error){reportError('Could not prepare selected items for sharing',error)}
}
function restoreDialog(){
 show(`<b>Import library</b><p class="hint">Imports add content without replacing what is here. Matching items are skipped as duplicates. JSON backups are unencrypted and limited to 30 MB.</p><label for="shareLinkInput">Grabit share link</label><textarea class="in" id="shareLinkInput" rows="2" placeholder="Paste a Grabit share link"></textarea><div class="row"><button class="b p" data-action="importShareLink">Review share link</button></div><label for="restoreFile">JSON backup file</label><input class="in" id="restoreFile" type="file" accept="application/json,.json"><div class="row"><button class="b" data-action="restore">Review JSON backup</button><button class="b" data-action="exportDialog">Back</button></div>`);
}
function confirmLibraryRestore(data,source,shareLink='',summary=null){
 V.pendingBackup=data;
 V.pendingShareLink=shareLink;
 const shareNotice=shareLink?'<p class="hint">This link is used only after a successful import. The imported content is saved in this browser.</p>':'';
 const skipped=summary&&(summary.skippedItems||summary.skippedSections)?`<p class="hint" role="status">Entries that fail validation will be skipped: ${countLabel(summary.skippedItems,'item')}, ${countLabel(summary.skippedSections,'section')}.</p>`:'';
 const fileContents=source==='JSON backup'?'<p class="hint">Uploaded media data is included; external media remains linked to its original URL. This backup is not encrypted.</p>':'';
 show(`<b>Review ${esc(source)}</b><p>Ready to add ${countLabel(summary?.validItems??data.items.length,'item')} and ${countLabel(summary?.validSections??data.sections.length,'section')}. Existing content will remain. Matching items will be skipped as duplicates.</p>${skipped}${fileContents}${shareNotice}<div class="row"><button class="b p" data-action="confirmRestore">Import library</button><button class="b" data-action="close">Cancel</button></div>`);
}
async function createShareLink(){
 const button=$('[data-action="createShareLink"]');
 if(button){button.disabled=true;button.textContent='Preparing link…'}
 try{
  const link=await createShortLibraryShareLink(V.shareData||await libraryExportData(),location.href);
  const output=$('#shareLinkOutput'),field=$('#shareLinkValue');
  if(!output||!field)return;
  field.value=link;output.hidden=false;
  try{await navigator.clipboard.writeText(link);toast('One-time share link created and copied.')}
  catch(error){console.warn('Grabit could not copy the share link automatically:',error);field.focus();field.select();toast('One-time share link created. Copy it from the field above.')}
 }catch(error){console.error('Could not create a library share link:',error);toast(error.message||'Could not create a share link.')}
 finally{if(button?.isConnected){button.disabled=false;button.textContent='Create one-time share link'}}
}
async function copyShareLink(){
 const field=$('#shareLinkValue');if(!field?.value){toast('Create a share link first.');return}
 try{await navigator.clipboard.writeText(field.value);toast('One-time share link copied.')}
 catch(error){console.warn('Grabit could not copy the share link automatically:',error);field.focus();field.select();toast('Copy the one-time share link from the selected field.')}
}
async function importShareLink(){
 const value=$('#shareLinkInput')?.value.trim();if(!value){toast('Paste a Grabit share link first.');return}
 try{confirmLibraryRestore(await readLibraryShareLink(value),'shared library',isShortLibraryShareLink(value)?value:'')}
 catch(error){console.error('Could not read the library share link:',error);toast(error.message||'Could not read the share link.')}
}
async function restoreBackup(){
 const file=$('#restoreFile').files[0];if(!file){toast('Choose a JSON backup file.');return}if(file.size>30*1024*1024){toast('Backup files must be smaller than 30 MB.');return}
 let data;try{data=JSON.parse(await file.text())}catch{toast('This file is not valid JSON.');return}
 try{
  const inspected=inspectLibraryBackup(data);
  if(!inspected.validItems&&!inspected.validSections){toast('This backup contains no valid items or sections to import.');return}
  confirmLibraryRestore(inspected.data,'JSON backup','',inspected);
 }catch(error){toast(error.message||'This is not a supported Grabit library backup.')}
}
async function commitRestore(){
 const data=V.pendingBackup;if(!data)return;V.pendingBackup=null;const shareLink=V.pendingShareLink;V.pendingShareLink=null;
 let added=0,duplicates=0;const sectionMap=new Map(),task=startTask('Importing backup',data.items.length+data.sections.length,'restore');
 try{
  for(const section of data.sections){taskCancelled(task);if(!section||typeof section.name!=='string'||typeof section.id!=='string'){updateTask('Importing backup',++task.completed,task.total,task);continue}let existing=V.sections.find(s=>s.id===section.id||s.name.toLowerCase()===section.name.toLowerCase());if(!existing){existing={...section,position:V.sections.length};await storeSection(existing);V.sections.push(existing)}sectionMap.set(section.id,existing.id);updateTask('Importing backup',++task.completed,task.total,task)}
  await refreshLibrary();
  for(const item of data.items){
   taskCancelled(task);
   if(!item||typeof item.id!=='string'||typeof item.title!=='string'||!['bookmark','note','image','video','gallery','playlist'].includes(item.type)||!Array.isArray(item.media)||!Array.isArray(item.sectionIds))continue;
   if(item.sourceUrl&&!validUrl(item.sourceUrl)){updateTask('Importing backup',++task.completed,task.total,task);continue}
   if(item.media.some(m=>m.sourceUrl&&!validUrl(m.sourceUrl)&&!m.storedDataUrl)){updateTask('Importing backup',++task.completed,task.total,task);continue}
   if(item.canonicalUrl&&V.items.some(x=>x.canonicalUrl===item.canonicalUrl)){duplicates++;updateTask('Importing backup',++task.completed,task.total,task);continue}
   const sectionIds=item.sectionIds.map(oldId=>sectionMap.get(oldId)).filter(Boolean);const now=new Date().toISOString();
   await storeItem({...item,id:V.items.some(x=>x.id===item.id)?uid():item.id,sectionIds,inbox:sectionIds.length===0,savedAt:now,updatedAt:now});added++;updateTask('Importing backup',++task.completed,task.total,task);
  }
  await refreshLibrary();finishTask(task);hide();render();
  let shareMessage='';
  if(shareLink){
   try{await consumeShortLibraryShareLink(shareLink)}
   catch(error){console.error('Imported content, but could not consume the share link:',error);shareMessage=' The import is saved here, but the link may still work.'}
  }
  toast(`Imported ${countLabel(added,'item')}.${duplicates?` ${countLabel(duplicates,'duplicate')} skipped.`:''}${shareMessage}`);
 }catch(error){
  await refreshLibrary();finishTask(task);
  if(error.name==='AbortError'){hide();render();toast(`Import cancelled. ${countLabel(added,'item')} imported before cancellation.`)}
  else reportError('Restore stopped; some earlier records may already have been added',error)
 }
}
function reportError(message,error){console.error(message,error);toast(`${message}. Please try again.`)}
async function manageDelete(id){
 const section=V.sections.find(s=>s.id===id);if(!section)return;
 const count=V.items.filter(i=>(i.sectionIds||[]).includes(id)).length;
 show(`<b>Delete “${esc(section.name)}”?</b><p>${count?`This section contains ${countLabel(count,'item')}. Choose whether to move them to your Inbox or delete them too.`:'This section is empty.'}</p><div class="row">${count?`<button class="b p" data-action="deleteSectionContents" data-id="${esc(id)}" data-mode="inbox">Delete section; move items to Inbox</button><button class="b d" data-action="deleteSectionContents" data-id="${esc(id)}" data-mode="delete">Delete section and items</button>`:`<button class="b d" data-action="deleteSectionContents" data-id="${esc(id)}" data-mode="inbox">Delete section</button>`}<button class="b" data-action="close">Cancel</button></div>`);
}
async function deleteSectionContents(id,mode){
 const items=V.items.filter(i=>(i.sectionIds||[]).includes(id));
 const section=V.sections.find(entry=>entry.id===id);if(!section)return;
 const sectionSnapshot=structuredClone(section),itemSnapshots=items.map(item=>structuredClone(item));
 try{
  if(mode==='delete')for(const item of items)await removeItem(item.id);
  await removeSection(id);
  V.view='inbox';V.sectionId=null;V.libraryPage=0;await refreshLibrary();hide();render();
  saveUndo(mode==='delete'?'Section and items deleted.':'Section deleted; items moved to Inbox.',async()=>{await storeSection(sectionSnapshot);for(const item of itemSnapshots)await storeItem(item)});
 }catch(e){reportError('Could not delete section',e)}
}
$('#add').addEventListener('click',addDialog);
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light',true));
$('#sbt').addEventListener('click',()=>{const win=$('#win'),button=$('#sbt'),mobile=matchMedia('(max-width:760px)').matches;win.classList.toggle(mobile?'open':'hide');button.setAttribute('aria-expanded',String(mobile?win.classList.contains('open'):!win.classList.contains('hide')))});
$('#scrim').addEventListener('click',()=>{$('#win').classList.remove('open');$('#sbt').setAttribute('aria-expanded','false');$('#sbt').focus()});
document.addEventListener('click',e=>{if(e.target.closest('.card-menu-button,.card-menu'))return;closeCardMenus()});
let searchTimer;$('#q').addEventListener('input',e=>{V.q=e.target.value;V.libraryPage=0;clearTimeout(searchTimer);searchTimer=setTimeout(render,180)});
$('#md').addEventListener('click',async e=>{
 if(e.target.id==='md')return;
 const visibility=e.target.closest('[data-media-visibility]');
 if(visibility){await toggleMediaVisibility(V.dialogItemId,visibility.dataset.mediaVisibility);return}
 const mediaMenu=e.target.closest('[data-media-menu]');
 if(mediaMenu){e.stopPropagation();const tile=mediaMenu.closest('.media-tile'),menu=mediaMenu.nextElementSibling,open=!menu.classList.contains('open');$('#bx').querySelectorAll('.media-menu.open').forEach(el=>{el.classList.remove('open');el.closest('.media-tile')?.classList.remove('menu-open')});$('#bx').querySelectorAll('[data-media-menu]').forEach(el=>el.setAttribute('aria-expanded','false'));menu.classList.toggle('open',open);tile.classList.toggle('menu-open',open);mediaMenu.setAttribute('aria-expanded',String(open));return}
 const previewHide=e.target.closest('[data-preview-hide]');
 if(previewHide&&V.preview){const page=V.preview.pages[Number(previewHide.dataset.previewPage)],url=previewHide.dataset.previewHide;if(page.hiddenUrls.has(url)){page.hiddenUrls.delete(url);page.selected.add(url)}else{page.hiddenUrls.add(url);page.selected.delete(url)}previewPanel();return}
 const button=e.target.closest('[data-action]');if(!button)return;
 const action=button.dataset.action,id=button.dataset.id;
 if(action==='close')hide();
 else if(action==='createSection')await saveNewSection();
 else if(action==='importDialog')importDialog();
 else if(action==='noteDialog')noteDialog();
 else if(action==='uploadDialog')uploadDialog();
 else if(action==='import')await saveImports();
 else if(action==='saveImport'){if(V.preview)await savePreview();else await saveImports()}
 else if(action==='previewPage')await previewPage();
 else if(action==='savePreview')await savePreview();
 else if(action==='toggleHiddenPreview'){if(V.preview){V.preview.showHidden=!V.preview.showHidden;previewPanel()}}
 else if(action==='toggleHiddenList'){V.showingHiddenMedia=!V.showingHiddenMedia;V.mediaIndex=-1;const item=V.items.find(entry=>entry.id===V.dialogItemId);if(item)renderItemViewer(item)}
 else if(action==='saveNote')await saveNote();
 else if(action==='saveImages')await saveImages();
 else if(action==='saveItem')await saveDetail(id);
 else if(action==='confirmMoveToSection')await moveItemToSection(id);
 else if(action==='editItem')editItem(id);
 else if(action==='cancelEdit'){const returnToViewer=V.editReturnToViewer&&V.watch?.itemId===id;hide();if(returnToViewer)renderWatchPage();else{render();focusCardMenuButton(id)}}
 else if(action==='openMedia'){V.mediaIndex=Number(button.dataset.index);const item=V.items.find(x=>x.id===V.dialogItemId);if(item)renderItemViewer(item)}
 else if(action==='backToGallery'){V.mediaIndex=-1;const item=V.items.find(x=>x.id===V.dialogItemId);if(item)renderItemViewer(item)}
 else if(action==='toggleViewerFavorite'){await toggleFavorite(id);const item=V.items.find(x=>x.id===id);if(item)renderItemViewer(item)}
 else if(action==='continueImport'){const pending=V.pendingImport;V.pendingImport=null;if(pending)await continueImport(pending,button.dataset.mode)}
 else if(action==='openDuplicate'){const existing=V.items.find(item=>item.id===id);V.pendingImport=null;if(existing){hide();V.mediaIndex=0;detail(id)}}
 else if(action==='confirmBulk'){const bulkAction=V.pendingBulkAction;V.pendingBulkAction=null;hide();if(bulkAction)await bulk(bulkAction,true)}
 else if(action==='confirmRestore')await commitRestore();
 else if(action==='deleteSectionContents')await deleteSectionContents(id,button.dataset.mode);
 else if(action==='confirmDeleteItem'){const item=V.items.find(entry=>entry.id===id);if(!item)return;const snapshot=structuredClone(item);try{await removeItem(id);await refreshLibrary();hide();render();saveUndo('Item deleted.',()=>storeItem(snapshot))}catch(err){reportError('Could not delete item',err)}}
 else if(action==='cancelDeleteItem'){detail(id)}
 else if(action==='mediaPrev'||action==='mediaNext'){const item=V.items.find(x=>x.id===V.dialogItemId);if(item){const length=viewerMedia(item).length;V.mediaIndex=(V.mediaIndex+(action==='mediaPrev'?-1:1)+length)%length;renderItemViewer(item)}}
 else if(action==='downloadExport')await downloadJson();
 else if(action==='createShareLink')await createShareLink();
 else if(action==='copyShareLink')await copyShareLink();
 else if(action==='importShareLink')await importShareLink();
 else if(action==='exportDialog')exportDialog();
 else if(action==='restoreDialog')restoreDialog();
 else if(action==='restore')await restoreBackup();
 else if(action==='openSource'){const url=validUrl(button.dataset.url);if(url)window.open(url.href,'_blank','noopener,noreferrer')}
 else if(action==='archive'){const item=V.items.find(x=>x.id===id);if(!item)return;item.isArchived=!item.isArchived;item.updatedAt=new Date().toISOString();try{await storeItem(item);await refreshLibrary();hide();render();toast(item.isArchived?'Archived.':'Restored from archive.')}catch(err){reportError('Could not update archive status',err)}}
 else if(action==='deleteItem'){show(`<b>Delete this item?</b><p>This removes it from this browser library. You can undo the deletion for a short time.</p><div class="row"><button class="b d" data-action="confirmDeleteItem" data-id="${esc(id)}">Delete item</button><button class="b" data-action="cancelDeleteItem" data-id="${esc(id)}">Cancel</button></div>`,true)}
 else if(action==='saveSection'){const section=V.sections.find(s=>s.id===id),name=$('#sectionName').value.trim();if(!name){toast('Section name cannot be empty.');return}if(V.sections.some(s=>s.id!==id&&s.name.toLowerCase()===name.toLowerCase())){toast('A section with that name already exists.');return}section.name=name;section.description=$('#sectionDescription').value.trim();section.updatedAt=new Date().toISOString();try{await storeSection(section);await refreshLibrary();hide();render();toast('Section updated.')}catch(err){reportError('Could not update section',err)}}
 else if(action==='deleteSection')manageDelete(id);
});
$('#md').addEventListener('change',e=>{
 if(e.target.matches('[data-preview-select]')&&V.preview){const page=V.preview.pages[Number(e.target.dataset.previewPage)],url=e.target.dataset.previewSelect;e.target.checked?page.selected.add(url):page.selected.delete(url);previewPanel()}
 if(e.target.id==='mediaKind'){if(V.task?.kind==='preview')cancelTask();V.previewRequestId++;const previewButton=$('[data-action="previewPage"]');if(previewButton){previewButton.disabled=false;previewButton.textContent='Preview media'}if(V.preview){V.preview=null;$('#extractionPreview').innerHTML='';const saveButton=$('#saveImportButton');if(saveButton)saveButton.textContent='Save links'}}
});
$('#md').addEventListener('input',e=>{
 if(e.target.id==='urls'){if(V.task?.kind==='preview')cancelTask();V.previewRequestId++;const previewButton=$('[data-action="previewPage"]');if(previewButton){previewButton.disabled=false;previewButton.textContent='Preview media'}if(V.preview){V.preview=null;$('#extractionPreview').innerHTML='';const saveButton=$('#saveImportButton');if(saveButton)saveButton.textContent='Save links'}}
});
$('#main').addEventListener('click',async e=>{
 const filterOption=e.target.closest('[data-dropdown-option]');
 if(filterOption){const field=filterOption.dataset.dropdownOption,value=filterOption.dataset.value;if(field==='typeFilter')V.type=value;if(field==='sortOrder')V.sort=value;if(field==='sectionFilter')V.filterSectionId=value;V.libraryPage=0;closeFilterDropdowns();render();document.querySelector(`[data-dropdown-toggle="${field}"]`)?.focus();return}
 const filterToggle=e.target.closest('[data-dropdown-toggle]');
 if(filterToggle){const options=filterToggle.nextElementSibling,opening=options.hidden;closeFilterDropdowns();if(opening){options.hidden=false;filterToggle.setAttribute('aria-expanded','true');const tools=filterToggle.closest('.tools');tools.classList.add('filter-menu-open');tools.style.setProperty('--filter-menu-space',`${options.offsetHeight+6}px`);options.querySelector('[aria-selected="true"]')?.focus()}return}
 if(!e.target.closest('.desktop-filter'))closeFilterDropdowns();
 const libraryPage=e.target.closest('[data-library-page]');
 if(libraryPage){V.libraryPage=Number(libraryPage.dataset.libraryPage);render();$('#main').scrollTo({top:0,behavior:'auto'});return}
 const downloadFilter=e.target.closest('[data-download-filter]');
 if(downloadFilter){V.downloadFilter=downloadFilter.dataset.downloadFilter;renderDownloadHistory();return}
 const downloadPage=e.target.closest('[data-download-page]');
 if(downloadPage){await discoverDownloads(Number(downloadPage.dataset.downloadPage));return}
 const actionToggle=e.target.closest('[data-watch-menu]');
 if(actionToggle){const tile=actionToggle.closest('.watch-tile-wrap'),menu=tile.querySelector('.watch-actions-menu'),open=!tile.classList.contains('show-actions');document.querySelectorAll('.watch-tile-wrap.show-actions').forEach(item=>{item.classList.remove('show-actions');item.querySelector('.watch-actions-menu')?.classList.remove('align-left');item.querySelector('[data-watch-menu]')?.setAttribute('aria-expanded','false')});tile.classList.toggle('show-actions',open);if(open)menu.classList.toggle('align-left',tile.getBoundingClientRect().left<innerWidth/2);actionToggle.setAttribute('aria-expanded',String(open));return}
 if(!e.target.closest('.watch-tile-wrap.show-actions'))document.querySelectorAll('.watch-tile-wrap.show-actions').forEach(item=>{item.classList.remove('show-actions');item.querySelector('.watch-actions-menu')?.classList.remove('align-left');item.querySelector('[data-watch-menu]')?.setAttribute('aria-expanded','false')});
 const discovered=e.target.closest('[data-discovery-download]');
 if(discovered){const media=V.downloadPreview?.media.filter(entry=>V.downloadFilter==='all'||entry.type===V.downloadFilter)[Number(discovered.dataset.discoveryDownload)],formatId=discovered.closest('.download-discovery-card')?.querySelector('[data-discovery-quality]')?.value||'';if(media)await downloadMedia(media.providerUrl||media.embedUrl||media.playbackUrl||media.url,{title:media.alt||V.downloadPreview.title,type:media.type,thumbnailUrl:media.thumbnailUrl||'',ytDlp:media.type==='video'&&!!(media.providerUrl||media.embedUrl),formatId});return}
 const discoveryPlay=e.target.closest('[data-discovery-play]');
 if(discoveryPlay){
  const media=V.downloadPreview?.media.filter(entry=>V.downloadFilter==='all'||entry.type===V.downloadFilter)[Number(discoveryPlay.dataset.discoveryPlay)];
  if(media)try{
   const resolved=await resolveVideoUrl(media.providerUrl||media.embedUrl||media.url),embedUrl=media.embedUrl;
   Object.assign(media,resolved);if(embedUrl)media.embedUrl=embedUrl;
   renderDownloadHistory();
  }catch(error){V.downloadError=error.message||'Could not find a playable video.';renderDownloadHistory()}
  return;
 }
 const downloadButton=e.target.closest('[data-download-url],[data-download-local]');
 if(downloadButton){
  const actionMenu=downloadButton.closest('.watch-actions-menu');
  if(actionMenu){const tile=actionMenu.closest('.watch-tile-wrap');tile.classList.remove('show-actions');actionMenu.classList.remove('align-left');tile.querySelector('[data-watch-menu]')?.setAttribute('aria-expanded','false')}
  const localItem=downloadButton.dataset.downloadLocal?V.items.find(item=>item.id===downloadButton.dataset.downloadItem):null,localMedia=localItem?.media.find(media=>media.id===downloadButton.dataset.downloadLocal),local=localMedia?.storedBlob||localMedia?.storedDataUrl||'';
  await downloadMedia(downloadButton.dataset.downloadUrl||local,{itemId:downloadButton.dataset.downloadItem,localMediaId:localMedia?.storedBlob instanceof Blob?localMedia.id:'',title:downloadButton.dataset.downloadTitle,type:downloadButton.dataset.downloadType,thumbnailUrl:downloadButton.dataset.downloadThumb});return;
 }
 const videoDownload=e.target.closest('[data-download-video]');
 if(videoDownload){await downloadMedia(videoDownload.dataset.downloadVideo,{itemId:videoDownload.dataset.downloadItem,title:videoDownload.dataset.downloadTitle,type:'video',thumbnailUrl:videoDownload.dataset.downloadThumb,ytDlp:true});return}
 const downloadHistory=e.target.closest('[data-download-history]');
 if(downloadHistory){const record=V.downloads[Number(downloadHistory.dataset.downloadHistory)];if(record){const media=record.localMediaId?V.items.find(item=>item.id===record.itemId)?.media.find(entry=>entry.id===record.localMediaId):null;if(record.localMediaId&&!media){toast('The original saved file is no longer available in this library.');return}await downloadMedia(media?.storedBlob||media?.storedDataUrl||record.url,{itemId:record.itemId,localMediaId:record.localMediaId,title:record.title,type:record.type,thumbnailUrl:record.thumbnailUrl,ytDlp:record.ytDlp===true,formatId:record.formatId||''})}return}
 if(e.target.closest('[data-clear-downloads]')){V.downloads=[];storeDownloadHistory();render();return}
 const watchButton=e.target.closest('[data-watch-action]');
 if(watchButton&&V.watch&&['previousPlaylistBatch','nextPlaylistBatch'].includes(watchButton.dataset.watchAction)){
  const item=V.items.find(entry=>entry.id===V.watch.itemId),page=item?.sourcePages?.[V.watch.pageIndex];
  if(item&&page?.playlistPaging){
   const start=page.playlistStart||1;
   await changePlaylistBatch(item,page,start+(watchButton.dataset.watchAction==='nextPlaylistBatch'?10:-10));
  }
  return;
 }
 if(watchButton?.dataset.watchAction==='resolveSourceVideo'&&V.watch){const item=V.items.find(entry=>entry.id===V.watch.itemId);if(item)await findAndPlayVideo(item);return}
 if(watchButton&&V.watch){const action=watchButton.dataset.watchAction,item=V.items.find(entry=>entry.id===V.watch.itemId);if(action==='back'){V.watch=null;syncWatchUrl();$('#win').classList.remove('watch-mode');$('#main').classList.remove('full-viewer','focused-view');render();return} if(action==='edit'&&item){editItem(item.id,true);return}if(action==='retry'&&item){item.sourcePages=null;item.media=[];V.watch.loading=false;V.watch.retrying=false;V.watch.extractionAttempted=false;loadWatchPage(item);return}if(action==='resolveVideo'&&item){const page=sourcePages(item)[V.watch.pageIndex],media=watchPageMedia(item,page)[V.watch.mediaIndex];if(media)await playVideoInGrabit(item,media,V.watch.mediaIndex);return}if(action==='showHiddenMedia'||action==='showGalleryFeed'){V.watch.showingHidden=action==='showHiddenMedia';V.watch.mediaIndex=-1;renderWatchPage();return}if(action==='previousPage'||action==='nextPage'){const count=sourcePages(item).length;V.watch.pageIndex=Math.max(0,Math.min(count-1,V.watch.pageIndex+(action==='previousPage'?-1:1)));V.watch.mediaIndex=-1;V.watch.showingHidden=false;V.watch.scrollTop=0;syncWatchUrl();renderWatchPage(true);return}if(action==='previousMedia'||action==='nextMedia'){const page=sourcePages(item)[V.watch.pageIndex],media=watchPageMedia(item,page);V.watch.mediaIndex=Math.max(0,Math.min(media.length-1,V.watch.mediaIndex+(action==='previousMedia'?-1:1)));V.watch.mediaDirection=action==='nextMedia'?'next':'previous';syncWatchUrl();renderWatchPage();return}if(action==='showGrid'){V.watch.mediaIndex=-1;delete V.watch.mediaDirection;syncWatchUrl();renderWatchPage();return}}
 const watchHide=e.target.closest('[data-watch-hide]');if(watchHide&&V.watch){await toggleMediaVisibility(V.watch.itemId,watchHide.dataset.watchHide);return}
 const watchMediaButton=e.target.closest('[data-watch-media]');
 if(watchMediaButton&&V.watch){
  const index=Number(watchMediaButton.dataset.watchMedia),item=V.items.find(entry=>entry.id===V.watch.itemId),page=sourcePages(item)[V.watch.pageIndex],media=watchPageMedia(item,page)[index];
  if(media?.type==='video'&&(media.providerUrl||media.embedUrl)&&!media.playbackUrl){
   await playVideoInGrabit(item,media,index);
   return;
  }
  V.watch.mediaIndex=index;V.watch.scrollTop=$('#main').scrollTop;syncWatchUrl();renderWatchPage();return
 }
 const menuButton=e.target.closest('[data-card-menu]');if(menuButton){e.stopPropagation();const cardEl=menuButton.closest('.card'),menu=cardEl.querySelector('.card-menu'),open=!menu.classList.contains('open');closeCardMenus();if(open){menu.classList.add('open');cardEl.classList.add('menu-open');menuButton.setAttribute('aria-expanded','true');positionCardMenu(menu,menuButton);menu.querySelector('[role="menuitem"]')?.focus()}return}
 const cardAction=e.target.closest('[data-card-action]');if(cardAction){e.stopPropagation();const id=cardAction.dataset.id,action=cardAction.dataset.cardAction,item=V.items.find(entry=>entry.id===id);if(!item)return;
  const menu=cardAction.closest('.card-menu');if(menu){const trigger=menu.previousElementSibling;closeCardMenus();trigger?.focus()}
  if(action==='share'){await shareItem(id);return}
  if(action==='moveSection'){moveItemToSectionDialog(id);return}
  if(action==='toggleInbox'){await toggleItemInboxVisibility(id);return}
  if(action==='edit'){editItem(id);return}
  if(action==='favorite'){await toggleFavorite(id);return}
  if(action==='archive'){item.isArchived=!item.isArchived;item.updatedAt=new Date().toISOString();try{await storeItem(item);await refreshLibrary();render();toast(item.isArchived?'Archived.':'Restored from archive.')}catch(error){reportError('Could not update archive status',error)}return}
  if(action==='delete'){show(`<b>Delete this item?</b><p>This permanently removes it from this browser library. This cannot be undone.</p><div class="row"><button class="b d" data-action="confirmDeleteItem" data-id="${esc(id)}">Delete permanently</button><button class="b" data-action="cancelDeleteItem" data-id="${esc(id)}">Cancel</button></div>`,true);return}
 }
 if(e.target.closest('#selectMode')){V.selectMode=true;V.selected.clear();render();return}
 if(e.target.closest('[data-clear-filters]')){V.q='';V.type='all';V.filterSectionId='';V.libraryPage=0;$('#q').value='';render();return}
 const bulkButton=e.target.closest('[data-bulk]');if(bulkButton){const action=bulkButton.dataset.bulk;if(action==='done'){V.selectMode=false;V.selected.clear();render()}else if(action==='selectAll'){matchingItems().forEach(i=>V.selected.add(i.id));render()}else if(action==='share')await shareSelectedItems();else await bulk(action);return}
 const select=e.target.closest('[data-select]');if(select){e.stopPropagation();select.checked?V.selected.add(select.dataset.select):V.selected.delete(select.dataset.select);return}
 if(e.target.closest('.card-menu'))return;
 const cardEl=e.target.closest('.card');if(cardEl){if(V.selectMode){V.selected.has(cardEl.dataset.id)?V.selected.delete(cardEl.dataset.id):V.selected.add(cardEl.dataset.id);render()}else{V.mediaIndex=0;detail(cardEl.dataset.id)}}
});
$('#main').addEventListener('keydown',e=>{
 const option=e.target.closest('[data-dropdown-option]'),toggle=e.target.closest('[data-dropdown-toggle]');
 if(e.key==='Escape'&&(option||toggle)){e.preventDefault();const filter=(option||toggle).closest('.desktop-filter');closeFilterDropdowns();filter?.querySelector('.filter-trigger')?.focus();return}
 if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
 if(toggle){e.preventDefault();const menu=toggle.nextElementSibling;if(menu.hidden){toggle.click();return}const selected=menu.querySelector('[aria-selected="true"]');(e.key==='ArrowDown'?selected||menu.querySelector('[role="option"]'):menu.querySelector('[role="option"]:last-child'))?.focus();return}
 if(option){e.preventDefault();const options=[...option.closest('[role="listbox"]').querySelectorAll('[role="option"]')],index=options.indexOf(option),next=(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus()}
});
$('#main').addEventListener('submit',event=>{if(event.target.id==='downloadUrlForm'){event.preventDefault();discoverDownloads(1,$('#downloadUrlInput')?.value||'')}});
$('#main').addEventListener('paste',event=>{if(!event.target.closest('#downloadUrlInput'))return;setTimeout(()=>{const input=$('#downloadUrlInput');if(input?.value.trim())discoverDownloads(1,input.value)},0)});
$('#main').addEventListener('scroll',()=>{
 document.querySelectorAll('.card-menu.open').forEach(menu=>{menu.classList.remove('open');menu.style.removeProperty('--menu-left');menu.style.removeProperty('--menu-top');menu.closest('.card')?.classList.remove('menu-open');menu.previousElementSibling?.setAttribute('aria-expanded','false')});
 if(!V.watch)return;
 const scrollTop=$('#main').scrollTop,previous=V.watch.lastScrollTop??scrollTop,delta=scrollTop-previous;
 V.watch.scrollTop=scrollTop;
 if(V.watch.mediaIndex<0){if(scrollTop<12)V.watch.headerHidden=false;else if(delta>6)V.watch.headerHidden=true;else if(delta< -6)V.watch.headerHidden=false;$('#main .watch-header')?.classList.toggle('header-hidden',V.watch.headerHidden)}
 V.watch.lastScrollTop=scrollTop;
 clearTimeout(V.watchScrollTimer);V.watchScrollTimer=setTimeout(()=>syncWatchUrl(),180);
});
addEventListener('resize',()=>{closeCardMenus();const mobile=matchMedia('(max-width:760px)').matches;$('#sbt').setAttribute('aria-expanded',String(mobile?$('#win').classList.contains('open'):!$('#win').classList.contains('hide')))});
$('#main').addEventListener('touchstart',event=>{if(V.watch&&V.watch.mediaIndex>=0&&event.target.closest('[data-swipe]')){const touch=event.changedTouches[0];V.watch.touchStart={x:touch.clientX,y:touch.clientY}}},{passive:true});
$('#main').addEventListener('touchend',event=>{if(!V.watch||V.watch.mediaIndex<0||!V.watch.touchStart)return;const touch=event.changedTouches[0],deltaX=touch.clientX-V.watch.touchStart.x,deltaY=touch.clientY-V.watch.touchStart.y;delete V.watch.touchStart;if(Math.abs(deltaX)<55||Math.abs(deltaX)<Math.abs(deltaY)*1.2)return;const action=deltaX<0?'nextMedia':'previousMedia';$(`[data-watch-action="${action}"]:not(:disabled)`)?.click()},{passive:true});
addEventListener('popstate',()=>{
 if(!new URLSearchParams(location.search).has('watch'))try{sessionStorage.removeItem('grabit-watch-route')}catch(error){console.warn('Grabit could not clear the saved viewer position:',error)}
 if(readWatchRoute())renderWatchPage(true);else render();
});
$('#main').addEventListener('change',async e=>{
 if(e.target.id==='typeFilter'){V.type=e.target.value;V.libraryPage=0;render()}
 if(e.target.id==='sortOrder'){V.sort=e.target.value;V.libraryPage=0;render()}
 if(e.target.id==='sectionFilter'){V.filterSectionId=e.target.value;V.libraryPage=0;render()}
 if(e.target.matches('[data-select]')){const id=e.target.dataset.select;e.target.checked?V.selected.add(id):V.selected.delete(id);render();document.querySelector(`[data-select="${CSS.escape(id)}"]`)?.focus()}
});
$('#nav').addEventListener('click',e=>{
 if(e.target.closest('#addSection')){createSection();return}
 if(e.target.closest('#installApp')){installGrabit();return}
 if(e.target.closest('#exportLibrary')){exportDialog();return}
 const manage=e.target.closest('[data-manage-section]');if(manage){manageSection(manage.dataset.manageSection);return}
 const item=e.target.closest('[data-view]');if(!item)return;
 const mobile=matchMedia('(max-width:760px)').matches;V.view=item.dataset.view;V.sectionId=item.dataset.section||null;V.filterSectionId='';V.libraryPage=0;V.selectMode=false;V.selected.clear();V.q='';$('#q').value='';$('#win').classList.remove('open');$('#sbt').setAttribute('aria-expanded',String(!mobile&&!$('#win').classList.contains('hide')));render();if(mobile)$('#sbt').focus();else $('#nav [aria-current="page"]')?.focus();
});
$('#nav').addEventListener('dblclick',e=>{const item=e.target.closest('[data-view="section"]');if(item)manageSection(item.dataset.section)});
$('#nav').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-view]')){e.preventDefault();e.target.click()}});
addEventListener('keydown',e=>{
 if($('#md').classList.contains('on')&&e.key==='Tab'){
  const focusable=[...$('#bx').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length);
  if(!focusable.length){e.preventDefault();$('#bx').focus();return}
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  return;
 }
 if(e.key==='Escape'&&$('#md').classList.contains('on')){e.preventDefault();if(V.dialogMode==='edit')$('#bx [data-action="cancelEdit"]')?.click();else hide();return}
 if(e.key==='Escape'&&!$('#md').classList.contains('on')){
  if($('#win').classList.contains('open')){$('#win').classList.remove('open');$('#sbt').setAttribute('aria-expanded','false');$('#sbt').focus();return}
  const actions=$('.watch-tile-wrap.show-actions');
  if(actions){actions.classList.remove('show-actions');actions.querySelector('.watch-actions-menu')?.classList.remove('align-left');const toggle=actions.querySelector('[data-watch-menu]');toggle?.setAttribute('aria-expanded','false');toggle?.focus()}
  else{const menu=$('.card-menu.open');if(menu){menu.classList.remove('open');menu.previousElementSibling?.setAttribute('aria-expanded','false');menu.previousElementSibling?.focus()}}
 }
 const openMenu=e.target.closest('.card-menu[role="menu"]');
 if(openMenu&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
  const items=[...openMenu.querySelectorAll('[role="menuitem"]')],current=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:(current+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
  e.preventDefault();items[next]?.focus();return;
 }
 if(e.key==='/'&&!$('#q').hidden&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$('#q').focus()}
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card'))e.target.click();
 if(V.watch&&V.watch.mediaIndex>=0&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){if(e.key==='ArrowLeft'){$('[data-watch-action="previousMedia"]:not(:disabled)')?.click()}if(e.key==='ArrowRight'){$('[data-watch-action="nextMedia"]:not(:disabled)')?.click()}}
 const item=V.items.find(i=>i.id===V.dialogItemId);
 if($('#md').classList.contains('on')&&V.dialogMode==='view'&&item&&['gallery','playlist'].includes(item.type)&&V.mediaIndex>=0&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){
  if(e.key==='ArrowLeft'){$('[data-action="mediaPrev"]')?.click()}
  if(e.key==='ArrowRight'){$('[data-action="mediaNext"]')?.click()}
 }
});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('beforeinstallprompt',event=>{event.preventDefault();V.installPrompt=event});
addEventListener('appinstalled',()=>{V.installPrompt=null;toast('Grabit was installed successfully.')});
document.addEventListener('error',e=>{const image=e.target;if(!(image instanceof HTMLImageElement)||image.dataset.fallbackApplied)return;image.dataset.fallbackApplied='true';image.src=fallbackThumbnail(image.closest('.card')?.querySelector('.bd')?.textContent||'media')},{capture:true});
document.addEventListener('error',e=>{
 const player=e.target;
 if(!(player instanceof HTMLVideoElement)||player.dataset.localVideo!=='true'||player.closest('.media-open,.watch-tile')||player.nextElementSibling?.classList.contains('local-video-error'))return;
 const item=V.items.find(entry=>entry.id===player.dataset.videoItem),media=item?.media.find(entry=>entry.id===player.dataset.videoMedia);
 if(!item||!media)return;
 const message=document.createElement('div');message.className='local-video-error';message.setAttribute('role','alert');
 const text=document.createElement('p');text.className='hint';text.textContent=player.dataset.videoConverted?'The converted copy still cannot play in this browser. Your original remains saved on this device.':'This video uses a format or codec this browser cannot play directly. Try converting a compatible copy on this device; the original will stay unchanged and will not be uploaded.';
 message.append(text);
 const actions=document.createElement('div');actions.className='row';
 if(player.dataset.videoConverted!=='true'){
  const convert=document.createElement('button');convert.type='button';convert.className='b p';convert.textContent='Convert on this device';convert.addEventListener('click',()=>convertSavedVideo(item.id,media.id));actions.append(convert);
 }
 const download=document.createElement('button');download.type='button';download.className='b';download.textContent='Download original';download.addEventListener('click',async()=>{
  try{const original=await originalVideoBlob(media);if(!original)throw new Error('Original video file is unavailable.');await downloadMedia(original,{itemId:item.id,localMediaId:media.id,title:item.title,type:'video',thumbnailUrl:media.thumbnailUrl||''})}
  catch(error){console.error('Could not download the original video:',error);toast('Could not download the original video.')}
 });actions.append(download);message.append(actions);player.insertAdjacentElement('afterend',message);
},{capture:true});
addEventListener('drop',e=>{e.preventDefault();const dropped=[...e.dataTransfer.files],files=dropped.filter(file=>file.type.startsWith('image/')||isVideoFile(file));if(dropped.length!==files.length)toast('Only image and video files can be added by drag and drop.');if(!files.length)return;uploadDialog(files)});
async function init(){
 try{
  const mobile=matchMedia('(max-width:760px)').matches;$('#sbt').setAttribute('aria-expanded',String(mobile?$('#win').classList.contains('open'):!$('#win').classList.contains('hide')));
  let theme='dark';try{theme=localStorage.getItem('grabit-theme')||theme}catch(error){console.warn('Could not read the saved theme preference:',error)}
  applyTheme(theme);loadDownloadHistory();watchForAppUpdates();await openDB();await migrateLegacy();await refreshLibrary();
  if(hasLibraryShareLink(location.href)){
   const shareUrl=location.href,url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url);
   try{confirmLibraryRestore(await readLibraryShareLink(shareUrl),'shared library',isShortLibraryShareLink(shareUrl)?shareUrl:'')}
   catch(error){console.error('Could not open the library share link:',error);toast(error.message||'Could not open the share link.');render()}
  }else if(readWatchRoute())renderWatchPage(true);else render()
 }
 catch(error){console.error('Grabit could not start its local library:',error);$('#main').innerHTML=`<div class="empty"><b>Grabit could not open local storage.</b><p>${esc(error.message)}</p><p>Check browser storage permissions and available space, then reload.</p></div>`;$('#add').disabled=true}
}
init();
